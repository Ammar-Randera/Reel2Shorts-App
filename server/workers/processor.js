import fs from 'node:fs';
import { getDb } from '../config/database.js';
import logger from '../config/logger.js';
import { getNextDue, removeFromQueue } from '../services/queue-manager.js';
import { publishToYouTube, checkDuplicate, refreshAccessToken } from '../services/youtube-publisher.js';
import { decrypt, encrypt } from '../services/encryption.js';

let workerInterval = null;
let isProcessing = false;

const MAX_RETRY_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS, 10) || 3;
const POLL_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Process a single due video from the publishing queue
 */
export async function processNextDueVideo() {
  if (isProcessing) return;
  isProcessing = true;

  const db = getDb();
  let dueItem = null;

  try {
    dueItem = getNextDue();
    if (!dueItem) {
      isProcessing = false;
      return;
    }

    const { video_id, user_id } = dueItem;
    logger.info(`[QueueWorker] Processing due video ID: ${video_id} ("${dueItem.ai_title || dueItem.original_filename}") for user: ${user_id}`);

    // Check if user has auto-publish enabled in settings
    const userSettings = db.prepare('SELECT auto_publish FROM settings WHERE user_id = ?').get(user_id);
    if (userSettings && userSettings.auto_publish === 0) {
      logger.info(`[QueueWorker] Auto-publish paused for user ${user_id}. Skipping.`);
      isProcessing = false;
      return;
    }

    // Retrieve YouTube credentials
    const credentials = db.prepare('SELECT * FROM youtube_credentials WHERE user_id = ?').get(user_id);
    if (!credentials) {
      logger.error(`[QueueWorker] No YouTube credentials found for user ${user_id}. Failing video.`);
      db.prepare(`
        UPDATE videos SET
          status = 'failed',
          error_message = 'YouTube account not connected. Please connect your YouTube channel in Settings.',
          updated_at = datetime('now')
        WHERE id = ?
      `).run(video_id);
      removeFromQueue(video_id);
      isProcessing = false;
      return;
    }

    // Verify stored video file exists on disk
    if (!dueItem.file_path || !fs.existsSync(dueItem.file_path)) {
      const errMsg = `Storage error: Stored video file not found at ${dueItem.file_path || 'unknown path'}`;
      logger.error(`[QueueWorker] ${errMsg}`);
      db.prepare(`
        UPDATE videos SET
          status = 'failed',
          error_message = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(errMsg, video_id);
      removeFromQueue(video_id);
      isProcessing = false;
      return;
    }

    // Mark video as publishing
    db.prepare("UPDATE videos SET status = 'publishing', updated_at = datetime('now') WHERE id = ?").run(video_id);

    // Decrypt credentials
    let accessToken;
    try {
      accessToken = decrypt(credentials.access_token_encrypted);
    } catch (err) {
      logger.error(`[QueueWorker] Decryption failed for user ${user_id}: ${err.message}`);
      throw new Error(`Credential decryption error: ${err.message}`);
    }

    // Check token expiry; refresh if expired or near expiry (less than 5 minutes remaining)
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
      logger.info(`[QueueWorker] Access token nearing expiry or missing expiry. Refreshing for user ${user_id}...`);
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
          user_id
        );
        logger.info(`[QueueWorker] YouTube access token refreshed successfully for user ${user_id}`);
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

    // Duplicate check
    const isDuplicate = await checkDuplicate(title, {
      accessToken,
      refreshTokenEncrypted: credentials.refresh_token_encrypted,
    });

    if (isDuplicate) {
      logger.warn(`[QueueWorker] Duplicate video detected on YouTube channel: "${title}". Failing.`);
      db.prepare(`
        UPDATE videos SET
          status = 'failed',
          error_message = 'Duplicate video detected on YouTube channel with matching title.',
          updated_at = datetime('now')
        WHERE id = ?
      `).run(video_id);
      removeFromQueue(video_id);
      isProcessing = false;
      return;
    }

    // Publish to YouTube
    logger.info(`[QueueWorker] Uploading video ${video_id} ("${title}") to YouTube Shorts...`);
    const publishResult = await publishToYouTube({
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

    db.prepare(`
      UPDATE videos SET
        status = 'published',
        youtube_video_id = ?,
        youtube_url = ?,
        published_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(publishResult.videoId, publishResult.url, video_id);

    // Remove from queue
    removeFromQueue(video_id);
    logger.info(`[QueueWorker] Successfully published video ${video_id} -> ${publishResult.url}`);

  } catch (err) {
    logger.error(`[QueueWorker] Publishing error: ${err.message}`);

    if (dueItem) {
      const currentRetries = (dueItem.retry_count || 0) + 1;
      if (currentRetries >= MAX_RETRY_ATTEMPTS) {
        logger.error(`[QueueWorker] Video ${dueItem.video_id} exceeded max retries (${MAX_RETRY_ATTEMPTS}). Marking as failed.`);
        db.prepare(`
          UPDATE videos SET
            status = 'failed',
            retry_count = ?,
            error_message = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(currentRetries, `Publishing failed: ${err.message}`, dueItem.video_id);
        removeFromQueue(dueItem.video_id);
      } else {
        logger.warn(`[QueueWorker] Retry ${currentRetries}/${MAX_RETRY_ATTEMPTS} for video ${dueItem.video_id}: ${err.message}`);
        db.prepare(`
          UPDATE videos SET
            status = 'queued',
            retry_count = ?,
            error_message = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(currentRetries, `Attempt failed: ${err.message}`, dueItem.video_id);
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

  // On startup, recover any videos that were left stuck in 'publishing' state
  const db = getDb();
  try {
    const stuck = db.prepare("UPDATE videos SET status = 'queued', updated_at = datetime('now') WHERE status = 'publishing'").run();
    if (stuck.changes > 0) {
      logger.info(`[QueueWorker] Recovered ${stuck.changes} stuck 'publishing' video(s) back to 'queued'.`);
    }
  } catch (recoveryErr) {
    logger.warn(`[QueueWorker] Could not recover stuck videos on startup: ${recoveryErr.message}`);
  }

  logger.info(`[QueueWorker] Starting publishing queue worker (polling interval: ${POLL_INTERVAL_MS / 1000}s)...`);

  // Run first check after 2 seconds
  setTimeout(() => {
    processNextDueVideo().catch(err => {
      logger.error(`[QueueWorker] Initial check error: ${err.message}`);
    });
  }, 2000);

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

export default { startPublishingWorker, stopPublishingWorker, processNextDueVideo };
