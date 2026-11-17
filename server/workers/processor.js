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
async function processNextDueVideo() {
  if (isProcessing) return;
  isProcessing = true;

  const db = getDb();

  try {
    const dueItem = getNextDue();
    if (!dueItem) {
      isProcessing = false;
      return;
    }

    const { video_id, user_id, id: videoRecordId } = dueItem;
    logger.info(`[QueueWorker] Processing due video ID: ${video_id} for user: ${user_id}`);

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
          error_message = 'YouTube account not connected. Please connect in Settings.',
          updated_at = datetime('now')
        WHERE id = ?
      `).run(video_id);
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
      throw err;
    }

    // Check token expiry; refresh if expired or near expiry
    if (credentials.token_expiry) {
      const expiry = new Date(credentials.token_expiry).getTime();
      const now = Date.now();
      if (expiry - now < 5 * 60 * 1000) { // less than 5 minutes remaining
        logger.info(`[QueueWorker] Access token nearing expiry. Refreshing for user ${user_id}...`);
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
        } catch (refreshErr) {
          logger.error(`[QueueWorker] Failed to refresh token: ${refreshErr.message}`);
        }
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
    const publishResult = await publishToYouTube({
      filePath: dueItem.file_path,
      title,
      description,
      hashtags,
      accessToken,
      refreshTokenEncrypted: credentials.refresh_token_encrypted,
    });

    // Mark as published
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
    logger.error(`[QueueWorker] Publishing error for video: ${err.message}`);

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
        `).run(currentRetries, `Max retries exceeded. Last error: ${err.message}`, dueItem.video_id);
        removeFromQueue(dueItem.video_id);
      } else {
        logger.warn(`[QueueWorker] Retry ${currentRetries}/${MAX_RETRY_ATTEMPTS} for video ${dueItem.video_id}`);
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

  logger.info(`[QueueWorker] Starting publishing queue worker (polling interval: ${POLL_INTERVAL_MS / 1000}s)...`);
  // Run first check immediately after 2 seconds
  setTimeout(() => {
    processNextDueVideo();
  }, 2000);

  workerInterval = setInterval(() => {
    processNextDueVideo();
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

export default { startPublishingWorker, stopPublishingWorker };
