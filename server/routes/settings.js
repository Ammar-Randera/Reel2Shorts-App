import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import logger from '../config/logger.js';

const router = Router();

// GET /api/settings
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb();
    let settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);

    // Create defaults if none exist
    if (!settings) {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO settings (id, user_id, publish_interval_minutes, auto_publish)
        VALUES (?, ?, 10, 1)
      `).run(id, req.user.id);
      settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);
    }

    res.json({
      publishIntervalMinutes: settings.publish_interval_minutes,
      autoPublish: !!settings.auto_publish,
    });
  } catch (err) {
    logger.error(`Get settings error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// PUT /api/settings
router.put('/', authenticate, (req, res) => {
  try {
    const { publishIntervalMinutes, autoPublish } = req.body;
    const db = getDb();

    // Validate
    if (publishIntervalMinutes !== undefined) {
      const interval = parseInt(publishIntervalMinutes, 10);
      if (isNaN(interval) || interval < 1 || interval > 1440) {
        return res.status(400).json({ error: 'publishIntervalMinutes must be between 1 and 1440' });
      }
    }

    // Ensure settings exist
    let settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);
    if (!settings) {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO settings (id, user_id, publish_interval_minutes, auto_publish)
        VALUES (?, ?, 10, 1)
      `).run(id, req.user.id);
    }

    // Update
    if (publishIntervalMinutes !== undefined) {
      db.prepare(
        "UPDATE settings SET publish_interval_minutes = ?, updated_at = datetime('now') WHERE user_id = ?"
      ).run(parseInt(publishIntervalMinutes, 10), req.user.id);
    }

    if (autoPublish !== undefined) {
      db.prepare(
        "UPDATE settings SET auto_publish = ?, updated_at = datetime('now') WHERE user_id = ?"
      ).run(autoPublish ? 1 : 0, req.user.id);
    }

    // Return updated
    settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);

    res.json({
      publishIntervalMinutes: settings.publish_interval_minutes,
      autoPublish: !!settings.auto_publish,
    });
  } catch (err) {
    logger.error(`Update settings error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
