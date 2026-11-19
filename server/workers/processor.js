import fs from 'node:fs';
import { getDb } from '../config/database.js';
import logger from '../config/logger.js';
import { getNextDue, removeFromQueue } from '../services/queue-manager.js';
import { publishToYouTube, checkDuplicate, refreshAccessToken } from '../services/youtube-publisher.js';
import { decrypt, encrypt } from '../services/encryption.js';

let workerInterval = null;
let isProcessing = false;
let isPaused = false; // Emergency pause switch

const MAX_RETRY_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS, 10) || 3;
const POLL_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Pause automatic queue publishing
 */
export function pausePublishing() {
  isPaused = true;
  logger.info('[QueueWorker] Automatic publishing PAUSED by control call.');
}

/**
 * Resume automatic queue publishing
 */
export function resumePublishing() {
  isPaused = false;
  logger.info('[QueueWorker] Automatic publishing RESUMED.');
}

/**
 * Check if publishing is currently paused
 */
export function isPublishingPaused() {
  return isPaused || process.env.PAUSE_PUBLISHING === 'true';
}

/**
 * Process a single due video from the publishing queue.
 * Guarantees that:
 * 1. Each queue item is published at most once.
 * 2. An atomic database lock is acquired before initiating upload.
 * 3. Already-published videos with an existing YouTube ID are never uploaded again.
 * 4. YouTube upload ID is persisted immediately upon upload success in a transaction.
 */
export async function processNextDueVideo() {
  if (isProcessing) return;
  if (isPublishingPaused()) {
    logger.debug('[QueueWorker] Worker tick skipped: publishing is currently paused.');
    return;
  }

  isProcessing = true;
  const db = getDb();
  let dueItem = null;
  let videoId = null;
  let queueId = null;
  let publishResult = null;

  try {
    dueItem = getNextDue();
    if (!dueItem) {
      isProcessing = false;
      return;
    }

    // Explicitly resolve videoId and queueId (handles both naming conventions)
    videoId = dueItem.video_id || dueItem.id;
    queueId = dueItem.queue_id;
    const userId = dueItem.user_id || dueItem.video_user_id;

    if (!videoId) {
      logger.error('[QueueWorker] CRITICAL: Missing videoId in queue record. Deleting invalid queue entry.');
      if (queueId) {
        db.prepare('DELETE FROM publishing_queue WHERE id = ?').run(queueId);
      }
      isProcessing = false;
      return;
    }

    logger.info(`[QueueWorker] Evaluating due video ID: ${videoId} ("${dueItem.ai_title || dueItem.original_filename}") for user: ${userId}`);

    // HARD GUARD 1: Query fresh state directly from videos table to ensure no stale queue data
    const freshVideo = db.prepare('SELECT id, status, youtube_video_id, youtube_url, published_at FROM videos WHERE id = ?').get(videoId);

    if (!freshVideo) {
      logger.warn(`[QueueWorker] Video ${videoId} not found in database. Removing stale queue record.`);
      removeFromQueue(videoId);
      isProcessing = false;
      return;
    }

    // HARD GUARD 2: NEVER upload if video already has a YouTube ID or status 'published'
    if (freshVideo.status === 'published' || freshVideo.youtube_video_id || freshVideo.published_at) {
      logger.warn(`[QueueWorker] SAFETY STOP: Video ${videoId} is ALREADY published (YouTube ID: ${freshVideo.youtube_video_id}). Cleaning queue entry and skipping upload.`);
      // Ensure DB status reflects published
      if (freshVideo.status !== 'published') {
        db.prepare("UPDATE videos SET status = 'published', updated_at = datetime('now') WHERE id = ?").run(videoId);
      }
      removeFromQueue(videoId);
      isProcessing = false;
      return;
    }

    // Check if user has auto-publish enabled in settings
    const userSettings = db.prepare('SELECT auto_publish FROM settings WHERE user_id = ?').get(userId);
    if (userSettings && userSettings.auto_publish === 0) {
      logger.info(`[QueueWorker] Auto-publish paused for user ${userId}. Skipping.`);
      isProcessing = false;
      return;
    }

    // HARD GUARD 3: Check local database for title duplicate to prevent duplicate uploads to the same channel
    const candidateTitle = dueItem.ai_title || dueItem.original_filename;
    const localDuplicate = db.prepare(`
      SELECT id, youtube_video_id, youtube_url, ai_title, original_filename
      FROM videos
      WHERE user_id = ?
        AND id != ?
        AND (status = 'published' OR (youtube_video_id IS NOT NULL AND youtube_video_id != ''))
        AND (LOWER(TRIM(ai_title)) = LOWER(TRIM(?)) OR LOWER(TRIM(original_filename)) = LOWER(TRIM(?)))
      LIMIT 1
    `).get(userId, videoId, candidateTitle, dueItem.original_filename);

    if (localDuplicate) {
      logger.warn(`[QueueWorker] DUPLICATE DETECTED: Video "${candidateTitle}" matches already-published video ${localDuplicate.id} (YouTube ID: ${localDuplicate.youtube_video_id}). Aborting upload.`);
      db.prepare(`
        UPDATE videos SET
          status = 'failed',
          error_message = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(`Duplicate prevented: This video title was already published to your YouTube channel (Video ID: ${localDuplicate.youtube_video_id}).`, videoId);
      removeFromQueue(videoId);
      isProcessing = false;
      return;
    }

    // Retrieve YouTube credentials
    const credentials = db.prepare('SELECT * FROM youtube_credentials WHERE user_id = ?').get(userId);
    if (!credentials) {
      logger.error(`[QueueWorker] No YouTube credentials found for user ${userId}. Failing video.`);
      db.prepare(`
        UPDATE videos SET
          status = 'failed',
          error_message = 'YouTube account not connected. Please connect your YouTube channel in Settings.',
          updated_at = datetime('now')
        WHERE id = ?
      `).run(videoId);
      removeFromQueue(videoId);
      isProcessing = false;
      return;
    }

    // Verify stored video file exists on disk
    if (!dueItem.file_path || !fs.existsSync(dueItem.file_path)) {
      const errMsg = `Storage error: Video file not found at ${dueItem.file_path || 'unknown path'}`;
      logger.error(`[QueueWorker] ${errMsg}`);
      db.prepare(`
        UPDATE videos SET
          status = 'failed',
          error_message = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(errMsg, videoId);
      removeFromQueue(videoId);
      isProcessing = false;
      return;
    }

    // HARD GUARD 4: ATOMIC JOB CLAIM / LOCK
    // Transition status from 'queued' to 'publishing' ONLY if currently 'queued' and no YouTube ID exists.
    // If another worker or thread already modified it, changes will be 0 and we immediately abort.
    const claimLock = db.prepare(`
      UPDATE videos
      SET status = 'publishing', updated_at = datetime('now')
      WHERE id = ?
        AND status = 'queued'
        AND (youtube_video_id IS NULL OR youtube_video_id = '')
        AND published_at IS NULL
    `).run(videoId);

    if (claimLock.changes === 0) {
      logger.warn(`[QueueWorker] Atomic claim failed for video ${videoId} (changes=0). Another worker or state change claimed it. Aborting.`);
      isProcessing = false;
      return;
    }

    logger.info(`[QueueWorker] Atomic lock acquired for video ${videoId}. Starting publishing pipeline.`);

    // Decrypt credentials
    let accessToken;
    try {
      accessToken = decrypt(credentials.access_token_encrypted);
    } catch (err) {
      logger.error(`[QueueWorker] Decryption failed for user ${userId}: ${err.message}`);
      throw new Error(`Credential decryption error: ${err.message}`);
    }

    // Check token expiry; refresh if expired or near expiry (within 5 minutes)
    let shouldRefresh = false;
    if (credentials.token_expiry) {
      const expiry = new Date(credentials.token_expiry).getTime();
      if (expiry - Date.now() < 5 * 60 * 1000) {
        shouldRefresh = true;
      }
    } else {
      shouldRefresh = true;
    }

    if (shouldRefresh) {
      logger.info(`[QueueWorker] Access token nearing expiry or missing expiry. Refreshing for user ${userId}...`);
      try {
        const newTokens = await refreshAccessToken(credentials.refresh_token_encrypted);
        accessToken = newTokens.access_token;
        const encNewAccess = encrypt(accessToken);
        db.prepare(`
          UPDATE youtube_credentials SET
            access_token_encrypted = ?,
            token_expiry = ?,
            updated_at = datetime('now')
          WHERE user_id = ?
        `).run(
          encNewAccess,
          newTokens.expiry_date ? new Date(newTokens.expiry_date).toISOString() : null,
          userId
        );
        logger.info(`[QueueWorker] YouTube access token refreshed successfully for user ${userId}`);
      } catch (refreshErr) {
        logger.error(`[QueueWorker] Failed to refresh YouTube access token: ${refreshErr.message}`);
        throw new Error(`YouTube authentication expired: ${refreshErr.message}. Please reconnect in Settings.`);
      }
    }

    const title = dueItem.ai_title || dueItem.original_filename;
    const description = dueItem.ai_description || '';
    let hashtags = [];
    if (dueItem.ai_hashtags) {
      try {
        hashtags = JSON.parse(dueItem.ai_hashtags);
      } catch {}
    }

    // Publish to YouTube
    logger.info(`[QueueWorker] Uploading video ${videoId} ("${title}") to YouTube Shorts...`);
    publishResult = await publishToYouTube({
      filePath: dueItem.file_path,
      title,
      description,
      hashtags,
      accessToken,
      refreshTokenEncrypted: credentials.refresh_token_encrypted,
    });

    // Mark as published ONLY after YouTube returns a valid video ID
    if (!publishResult || !publishResult.videoId) {
      throw new Error('YouTube did not return a valid video ID upon publishing');
    }

    // HARD GUARD 5: ATOMIC COMPLETION TRANSACTION
    // In a single atomic database transaction:
    // 1. Mark video as 'published' with YouTube ID and URL
    // 2. Remove video from publishing_queue
    const completeTransaction = db.transaction(() => {
      const updateRes = db.prepare(`
        UPDATE videos SET
          status = 'published',
          youtube_video_id = ?,
          youtube_url = ?,
          published_at = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(publishResult.videoId, publishResult.url, videoId);

      db.prepare('DELETE FROM publishing_queue WHERE video_id = ? OR id = ?').run(videoId, queueId);

      // Reorder remaining queue items for user
      const remaining = db.prepare(
        'SELECT id FROM publishing_queue WHERE user_id = ? ORDER BY position ASC'
      ).all(userId);
      const reorderStmt = db.prepare('UPDATE publishing_queue SET position = ? WHERE id = ?');
      remaining.forEach((item, idx) => {
        reorderStmt.run(idx + 1, item.id);
      });

      return updateRes.changes;
    });

    const rowsUpdated = completeTransaction();
    logger.info(`[QueueWorker] SUCCESS: Video ${videoId} published to YouTube (${publishResult.url}). Database committed: ${rowsUpdated} row(s).`);

  } catch (err) {
    logger.error(`[QueueWorker] Publishing error for video ${videoId || 'unknown'}: ${err.message}`);

    // POST-UPLOAD CRITICAL SAFETY NET:
    // If upload already succeeded on YouTube but a subsequent code line threw,
    // IMMEDIATELY persist the YouTube ID and mark Published so it can NEVER be retried.
    //
    // If the DB write itself fails, we MUST NOT leave the video in 'publishing' status,
    // because the startup integrity check resets all 'publishing' videos with no
    // youtube_video_id back to 'queued', which would cause a second upload.
    //
    // Strategy:
    //   Attempt 1-3: Write status='published' + youtube_video_id (retries on transient errors).
    //   If all three fail: Write status='failed' with the YouTube ID embedded in error_message.
    //     → 'failed' videos are NEVER touched by startup check 3 (which only resets 'publishing').
    //     → 'failed' videos are NEVER returned by getNextDue() (which requires status='queued').
    //     → The YouTube ID is preserved in error_message so it can be recovered manually.
    if (publishResult && publishResult.videoId && videoId) {
      logger.error(`[QueueWorker] POST-UPLOAD SAFETY NET TRIGGERED: YouTube upload succeeded (${publishResult.videoId}) but an error occurred. Attempting to persist published status.`);

      let safetyNetSaved = false;

      // Attempt up to 3 times to write the published status (guards against transient DB errors)
      for (let attempt = 1; attempt <= 3 && !safetyNetSaved; attempt++) {
        try {
          db.prepare(`
            UPDATE videos SET
              status = 'published',
              youtube_video_id = ?,
              youtube_url = ?,
              published_at = datetime('now'),
              updated_at = datetime('now')
            WHERE id = ?
          `).run(publishResult.videoId, publishResult.url, videoId);
          removeFromQueue(videoId);
          safetyNetSaved = true;
          logger.info(`[QueueWorker] Safety net: successfully persisted published status for video ${videoId} on attempt ${attempt}.`);
        } catch (persistErr) {
          logger.error(`[QueueWorker] Safety net write attempt ${attempt}/3 failed for video ${videoId}: ${persistErr.message}`);
        }
      }

      // All 3 write attempts failed — fall back to 'failed' status.
      // CRITICAL: We must NOT leave the video as 'publishing'. If the server restarts with
      // status='publishing' and no youtube_video_id, startup check 3 would reset it to
      // 'queued', and the worker would upload the video to YouTube again.
      // Setting status='failed' permanently blocks automatic re-upload while preserving
      // the YouTube video ID in error_message for manual recovery.
      if (!safetyNetSaved) {
        const recoveryMessage = `UPLOAD_SUCCEEDED_UNRECORDED: Video was successfully uploaded to YouTube (ID: ${publishResult.videoId}, URL: ${publishResult.url}) but the database could not be updated after ${3} attempts. Manual intervention required to record this publication. DO NOT re-upload.`;
        logger.error(`[QueueWorker] CRITICAL: All safety net write attempts exhausted for video ${videoId}. YouTube ID: ${publishResult.videoId}. Falling back to 'failed' status to prevent re-upload on restart.`);
        try {
          db.prepare(`
            UPDATE videos SET
              status = 'failed',
              error_message = ?,
              updated_at = datetime('now')
            WHERE id = ?
          `).run(recoveryMessage, videoId);
          removeFromQueue(videoId);
          logger.error(`[QueueWorker] Video ${videoId} marked as 'failed' with YouTube ID in error_message. It will NOT be automatically re-uploaded. Manual DB update required: set youtube_video_id='${publishResult.videoId}', status='published'.`);
        } catch (finalErr) {
          // This is the absolute last resort. If even the 'failed' status write fails,
          // the video stays 'publishing'. Log it prominently and do NOT reset isProcessing
          // so the worker stops processing until the server is restarted and the startup
          // check can re-evaluate the state.
          logger.error(`[QueueWorker] FATAL: Cannot write ANY status update for video ${videoId}. YouTube ID: ${publishResult.videoId}. DB error: ${finalErr.message}. The video remains in 'publishing' state. Startup check will reset it to 'queued' on next restart — MANUAL DB INTERVENTION REQUIRED before restarting.`);
        }
      }

      isProcessing = false;
      return;
    }

    if (videoId) {
      const currentRetries = (dueItem?.retry_count || 0) + 1;
      if (currentRetries >= MAX_RETRY_ATTEMPTS) {
        logger.error(`[QueueWorker] Video ${videoId} exceeded max retries (${MAX_RETRY_ATTEMPTS}). Marking as failed.`);
        db.prepare(`
          UPDATE videos SET
            status = 'failed',
            retry_count = ?,
            error_message = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(currentRetries, `Publishing failed: ${err.message}`, videoId);
        removeFromQueue(videoId);
      } else {
        logger.warn(`[QueueWorker] Retry ${currentRetries}/${MAX_RETRY_ATTEMPTS} for video ${videoId}: ${err.message}`);
        db.prepare(`
          UPDATE videos SET
            status = 'queued',
            retry_count = ?,
            error_message = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(currentRetries, `Attempt failed: ${err.message}`, videoId);
      }
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Start the publishing queue background worker loop
 */
export function startPublishingWorker() {
  if (workerInterval) return;

  const db = getDb();

  // Startup Database Consistency & De-duplication check (wrapped in atomic transaction):
  try {
    const startupTx = db.transaction(() => {
      // 0. Auto-recover any video where YouTube upload succeeded but previous safety net DB write failed
      const unrecorded = db.prepare(`
        SELECT id, error_message FROM videos
        WHERE error_message LIKE 'UPLOAD_SUCCEEDED_UNRECORDED%'
      `).all();

      for (const item of unrecorded) {
        const idMatch = item.error_message.match(/ID:\s*([a-zA-Z0-9_-]+)/);
        const urlMatch = item.error_message.match(/URL:\s*(https?:\/\/[^\s,\)]+)/);
        if (idMatch && idMatch[1]) {
          const ytId = idMatch[1];
          const ytUrl = urlMatch ? urlMatch[1] : `https://youtube.com/shorts/${ytId}`;
          db.prepare(`
            UPDATE videos SET
              status = 'published',
              youtube_video_id = ?,
              youtube_url = ?,
              published_at = datetime('now'),
              updated_at = datetime('now'),
              error_message = NULL
            WHERE id = ?
          `).run(ytId, ytUrl, item.id);
          logger.info(`[QueueWorker] Startup check: Auto-recovered unrecorded upload for video ${item.id} -> YouTube ID: ${ytId}`);
        }
      }

      // 1. Any video that already has a youtube_video_id MUST be marked 'published' and removed from queue
      const syncPublished = db.prepare(`
        UPDATE videos SET status = 'published', published_at = datetime('now'), updated_at = datetime('now')
        WHERE (youtube_video_id IS NOT NULL AND youtube_video_id != '')
          AND status != 'published'
      `).run();
      if (syncPublished.changes > 0) {
        logger.info(`[QueueWorker] Startup check: Synchronized ${syncPublished.changes} video(s) with existing YouTube IDs to 'published'.`);
      }

      // 2. Remove all published videos from publishing_queue
      const cleanQueue = db.prepare(`
        DELETE FROM publishing_queue WHERE video_id IN (
          SELECT id FROM videos WHERE status = 'published' OR (youtube_video_id IS NOT NULL AND youtube_video_id != '')
        )
      `).run();
      if (cleanQueue.changes > 0) {
        logger.info(`[QueueWorker] Startup check: Purged ${cleanQueue.changes} already-published entry/entries from publishing_queue.`);
      }

      // 3. For any video stuck in 'publishing' with NO YouTube ID and NOT unrecorded, safely reset to 'queued'
      const resetStuck = db.prepare(`
        UPDATE videos SET status = 'queued', updated_at = datetime('now')
        WHERE status = 'publishing'
          AND (youtube_video_id IS NULL OR youtube_video_id = '')
          AND (error_message IS NULL OR error_message NOT LIKE 'UPLOAD_SUCCEEDED_UNRECORDED%')
      `).run();
      if (resetStuck.changes > 0) {
        logger.info(`[QueueWorker] Startup check: Reset ${resetStuck.changes} stranded 'publishing' video(s) back to 'queued'.`);
      }
    });

    startupTx();
  } catch (syncErr) {
    logger.error(`[QueueWorker] Startup database integrity check error: ${syncErr.message}`);
  }

  logger.info(`[QueueWorker] Starting publishing queue worker (polling interval: ${POLL_INTERVAL_MS / 1000}s)...`);

  // First poll after 5 seconds to allow full server readiness
  setTimeout(() => {
    processNextDueVideo().catch(err => {
      logger.error(`[QueueWorker] Initial check error: ${err.message}`);
    });
  }, 5000);

  workerInterval = setInterval(() => {
    processNextDueVideo().catch(err => {
      logger.error(`[QueueWorker] Periodic check error: ${err.message}`);
    });
  }, POLL_INTERVAL_MS);
}

/**
 * Stop publishing worker (graceful shutdown)
 */
export function stopPublishingWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info('[QueueWorker] Publishing worker stopped.');
  }
}

export default { startPublishingWorker, stopPublishingWorker, processNextDueVideo, pausePublishing, resumePublishing, isPublishingPaused };
