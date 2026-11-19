import { getDb } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger.js';

/**
 * Add a video to the FIFO publishing queue
 * @param {string} videoId
 * @param {string} userId
 * @returns {Object} Queue entry
 */
export function addToQueue(videoId, userId) {
  const db = getDb();

  // Get user's publish interval
  const settings = db.prepare('SELECT publish_interval_minutes FROM settings WHERE user_id = ?').get(userId);
  const intervalMinutes = settings?.publish_interval_minutes || parseInt(process.env.DEFAULT_PUBLISH_INTERVAL_MINUTES, 10) || 10;

  // Find the last scheduled item for this user
  const lastItem = db.prepare(
    'SELECT scheduled_at FROM publishing_queue WHERE user_id = ? ORDER BY position DESC LIMIT 1'
  ).get(userId);

  // Calculate next position
  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), 0) as maxPos FROM publishing_queue WHERE user_id = ?'
  ).get(userId);
  const nextPosition = (maxPos?.maxPos || 0) + 1;

  // Calculate scheduled time
  let scheduledAt;
  if (lastItem) {
    const lastTime = new Date(lastItem.scheduled_at).getTime();
    const baseTime = Math.max(lastTime, Date.now());
    scheduledAt = new Date(baseTime + intervalMinutes * 60 * 1000);
  } else {
    // Queue is empty, schedule immediately
    scheduledAt = new Date();
  }

  const id = uuidv4();
  const entry = {
    id,
    video_id: videoId,
    user_id: userId,
    position: nextPosition,
    scheduled_at: scheduledAt.toISOString(),
  };

  db.prepare(`
    INSERT INTO publishing_queue (id, video_id, user_id, position, scheduled_at)
    VALUES (@id, @video_id, @user_id, @position, @scheduled_at)
  `).run(entry);

  // Update video status to 'queued'
  db.prepare("UPDATE videos SET status = 'queued', updated_at = datetime('now') WHERE id = ?").run(videoId);

  logger.info(`Added video ${videoId} to queue at position ${nextPosition}, scheduled: ${scheduledAt.toISOString()}`);

  return entry;
}

/**
 * Remove a video from the publishing queue
 * @param {string} videoId
 */
export function removeFromQueue(videoId) {
  const db = getDb();

  const entry = db.prepare('SELECT * FROM publishing_queue WHERE video_id = ?').get(videoId);
  if (!entry) return;

  db.prepare('DELETE FROM publishing_queue WHERE video_id = ?').run(videoId);

  // Reorder remaining positions for this user
  const remaining = db.prepare(
    'SELECT id FROM publishing_queue WHERE user_id = ? ORDER BY position ASC'
  ).all(entry.user_id);

  const updateStmt = db.prepare('UPDATE publishing_queue SET position = ? WHERE id = ?');
  const updateTransaction = db.transaction(() => {
    remaining.forEach((item, index) => {
      updateStmt.run(index + 1, item.id);
    });
  });
  updateTransaction();

  logger.info(`Removed video ${videoId} from queue`);
}

/**
 * Get all queued videos for a user, ordered by position
 * @param {string} userId
 * @returns {Array} Queue entries with video details
 */
export function getQueue(userId) {
  const db = getDb();

  return db.prepare(`
    SELECT
      pq.id as queue_id,
      pq.position,
      pq.scheduled_at,
      pq.created_at as queued_at,
      v.*
    FROM publishing_queue pq
    JOIN videos v ON v.id = pq.video_id
    WHERE pq.user_id = ?
    ORDER BY pq.position ASC
  `).all(userId);
}

/**
 * Get the next video due for publishing (across all users)
 * @returns {Object|null} Queue entry with video and credential details, or null
 */
export function getNextDue() {
  const db = getDb();
  const nowIso = new Date().toISOString();

  return db.prepare(`
    SELECT
      pq.id as queue_id,
      pq.position,
      pq.scheduled_at,
      pq.user_id,
      v.*
    FROM publishing_queue pq
    JOIN videos v ON v.id = pq.video_id
    WHERE (pq.scheduled_at <= ? OR datetime(pq.scheduled_at) <= datetime('now'))
      AND (v.status = 'queued' OR (v.status = 'publishing' AND v.updated_at <= datetime('now', '-5 minutes')))
    ORDER BY pq.scheduled_at ASC
    LIMIT 1
  `).get(nowIso) || null;
}

/**
 * Reorder the queue for a user
 * @param {string} userId
 * @param {string[]} videoIds - New order of video IDs
 */
export function reorderQueue(userId, videoIds) {
  const db = getDb();

  // Get user's publish interval for recalculating scheduled times
  const settings = db.prepare('SELECT publish_interval_minutes FROM settings WHERE user_id = ?').get(userId);
  const intervalMinutes = settings?.publish_interval_minutes || 10;

  const updateStmt = db.prepare(
    'UPDATE publishing_queue SET position = ?, scheduled_at = ? WHERE video_id = ? AND user_id = ?'
  );

  const reorderTransaction = db.transaction(() => {
    let scheduledAt = new Date();
    videoIds.forEach((videoId, index) => {
      if (index > 0) {
        scheduledAt = new Date(scheduledAt.getTime() + intervalMinutes * 60 * 1000);
      }
      updateStmt.run(index + 1, scheduledAt.toISOString(), videoId, userId);
    });
  });

  reorderTransaction();
  logger.info(`Reordered queue for user ${userId}: ${videoIds.length} items`);
}

/**
 * Get queue statistics for a user
 * @param {string} userId
 * @returns {Object} Queue stats
 */
export function getQueueStats(userId) {
  const db = getDb();

  const total = db.prepare(
    'SELECT COUNT(*) as count FROM publishing_queue WHERE user_id = ?'
  ).get(userId)?.count || 0;

  const nextItem = db.prepare(`
    SELECT scheduled_at FROM publishing_queue
    WHERE user_id = ?
    ORDER BY position ASC
    LIMIT 1
  `).get(userId);

  const lastItem = db.prepare(`
    SELECT scheduled_at FROM publishing_queue
    WHERE user_id = ?
    ORDER BY position DESC
    LIMIT 1
  `).get(userId);

  return {
    totalInQueue: total,
    nextScheduledAt: nextItem?.scheduled_at || null,
    estimatedCompletionAt: lastItem?.scheduled_at || null,
  };
}

export default { addToQueue, removeFromQueue, getQueue, getNextDue, reorderQueue, getQueueStats };
