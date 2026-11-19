import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { encrypt, decrypt } from '../services/encryption.js';
import { getAuthUrl, handleCallback, getChannelInfo } from '../services/youtube-publisher.js';
import { getQueue, getQueueStats, reorderQueue } from '../services/queue-manager.js';
import { processNextDueVideo, pausePublishing, resumePublishing, isPublishingPaused } from '../workers/processor.js';
import logger from '../config/logger.js';

const router = Router();

// GET /api/youtube/auth-url
router.get('/auth-url', authenticate, (req, res) => {
  try {
    const url = getAuthUrl(req.user.id);
    res.json({ url });
  } catch (err) {
    logger.error(`YouTube auth URL error: ${err.message}`);
    res.status(500).json({ error: 'Failed to generate YouTube authorization URL' });
  }
});

// GET /api/youtube/callback
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      logger.warn(`YouTube OAuth error: ${error}`);
      return res.redirect('/settings?youtube=error&reason=' + encodeURIComponent(error));
    }

    if (!code || !state) {
      return res.redirect('/settings?youtube=error&reason=missing_params');
    }

    // Parse state to get userId
    let userId;
    try {
      const stateObj = JSON.parse(state);
      userId = stateObj.userId;
    } catch {
      return res.redirect('/settings?youtube=error&reason=invalid_state');
    }

    // Exchange code for tokens
    const tokens = await handleCallback(code);

    if (!tokens.refresh_token) {
      return res.redirect('/settings?youtube=error&reason=no_refresh_token');
    }

    // Get channel info
    const channelInfo = await getChannelInfo(tokens.access_token);

    // Encrypt tokens
    const accessTokenEncrypted = encrypt(tokens.access_token);
    const refreshTokenEncrypted = encrypt(tokens.refresh_token);

    // Store/update credentials
    const db = getDb();
    const existing = db.prepare('SELECT id FROM youtube_credentials WHERE user_id = ?').get(userId);

    if (existing) {
      db.prepare(`
        UPDATE youtube_credentials SET
          access_token_encrypted = ?,
          refresh_token_encrypted = ?,
          token_expiry = ?,
          channel_id = ?,
          channel_title = ?,
          updated_at = datetime('now')
        WHERE user_id = ?
      `).run(
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        channelInfo.channelId,
        channelInfo.channelTitle,
        userId
      );
    } else {
      db.prepare(`
        INSERT INTO youtube_credentials (id, user_id, access_token_encrypted, refresh_token_encrypted,
          token_expiry, channel_id, channel_title)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(),
        userId,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        channelInfo.channelId,
        channelInfo.channelTitle
      );
    }

    logger.info(`YouTube connected for user ${userId}: ${channelInfo.channelTitle}`);
    res.redirect('/settings?youtube=connected');
  } catch (err) {
    logger.error(`YouTube callback error: ${err.message}`);
    res.redirect('/settings?youtube=error&reason=' + encodeURIComponent(err.message));
  }
});

// GET /api/youtube/status
router.get('/status', authenticate, (req, res) => {
  try {
    const db = getDb();
    const creds = db.prepare(
      'SELECT channel_id, channel_title, token_expiry, updated_at FROM youtube_credentials WHERE user_id = ?'
    ).get(req.user.id);

    if (!creds) {
      return res.json({ connected: false });
    }

    res.json({
      connected: true,
      channelId: creds.channel_id,
      channelTitle: creds.channel_title,
      tokenExpiry: creds.token_expiry,
      lastUpdated: creds.updated_at,
    });
  } catch (err) {
    logger.error(`YouTube status error: ${err.message}`);
    res.status(500).json({ error: 'Failed to check YouTube status' });
  }
});

// DELETE /api/youtube/disconnect
router.delete('/disconnect', authenticate, (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM youtube_credentials WHERE user_id = ?').run(req.user.id);
    logger.info(`YouTube disconnected for user ${req.user.id}`);
    res.json({ message: 'YouTube disconnected' });
  } catch (err) {
    logger.error(`YouTube disconnect error: ${err.message}`);
    res.status(500).json({ error: 'Failed to disconnect YouTube' });
  }
});

// GET /api/youtube/queue
router.get('/queue', authenticate, (req, res) => {
  try {
    const queue = getQueue(req.user.id);
    // Parse JSON fields
    const parsed = queue.map(v => ({
      ...v,
      ai_hashtags: v.ai_hashtags ? JSON.parse(v.ai_hashtags) : null,
      ai_analysis: v.ai_analysis ? JSON.parse(v.ai_analysis) : null,
      policy_result: v.policy_result ? JSON.parse(v.policy_result) : null,
    }));
    res.json({ queue: parsed });
  } catch (err) {
    logger.error(`Get queue error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get queue' });
  }
});

// GET /api/youtube/queue/stats
router.get('/queue/stats', authenticate, (req, res) => {
  try {
    const stats = getQueueStats(req.user.id);
    // Also return the user's configured publish interval so frontend can display it
    const db = getDb();
    const settings = db.prepare('SELECT publish_interval_minutes FROM settings WHERE user_id = ?').get(req.user.id);
    const intervalMinutes = settings?.publish_interval_minutes
      || parseInt(process.env.DEFAULT_PUBLISH_INTERVAL_MINUTES, 10)
      || 10;
    res.json({ ...stats, intervalMinutes });
  } catch (err) {
    logger.error(`Queue stats error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get queue stats' });
  }
});

// PUT /api/youtube/queue/reorder
router.put('/queue/reorder', authenticate, (req, res) => {
  try {
    const { videoIds } = req.body;
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return res.status(400).json({ error: 'videoIds array is required' });
    }

    reorderQueue(req.user.id, videoIds);
    const updatedQueue = getQueue(req.user.id);
    res.json({ message: 'Queue reordered', queue: updatedQueue });
  } catch (err) {
    logger.error(`Reorder queue error: ${err.message}`);
    res.status(500).json({ error: 'Failed to reorder queue' });
  }
});

// POST /api/youtube/queue/process
router.post('/queue/process', authenticate, (req, res) => {
  try {
    processNextDueVideo().catch(err => {
      logger.error(`Manual queue process error: ${err.message}`);
    });
    res.json({ message: 'Publishing worker triggered' });
  } catch (err) {
    logger.error(`Trigger queue error: ${err.message}`);
    res.status(500).json({ error: 'Failed to trigger worker' });
  }
});

// POST /api/youtube/queue/pause
router.post('/queue/pause', authenticate, (_req, res) => {
  pausePublishing();
  res.json({ message: 'Automatic publishing paused', paused: true });
});

// POST /api/youtube/queue/resume
router.post('/queue/resume', authenticate, (_req, res) => {
  resumePublishing();
  res.json({ message: 'Automatic publishing resumed', paused: false });
});

export default router;
