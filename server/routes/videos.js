import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import ffmpeg from 'fluent-ffmpeg';
import { getDb } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { uploadSingle, uploadMultiple, handleUploadError, UPLOAD_DIR } from '../middleware/upload.js';
import { analyzeVideo } from '../services/ai-analyzer.js';
import { screenVideo } from '../services/policy-screener.js';
import { addToQueue, removeFromQueue } from '../services/queue-manager.js';
import { processNextDueVideo } from '../workers/processor.js';
import { importInstagramReels } from '../services/apify-importer.js';
import logger from '../config/logger.js';

const router = Router();

/**
 * Get video metadata using ffprobe
 */
function getVideoMetadata(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        logger.warn(`ffprobe failed for ${filePath}: ${err.message}`);
        resolve({ duration: null, width: null, height: null });
        return;
      }
      const videoStream = metadata.streams?.find(s => s.codec_type === 'video');
      resolve({
        duration: metadata.format?.duration || null,
        width: videoStream?.width || null,
        height: videoStream?.height || null,
      });
    });
  });
}

/**
 * Process a video: AI analysis + policy screening
 */
async function processVideo(videoId) {
  const db = getDb();

  try {
    // Update status to processing
    db.prepare("UPDATE videos SET status = 'processing', updated_at = datetime('now') WHERE id = ?").run(videoId);

    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
    if (!video) throw new Error('Video not found');

    // Proactively verify file existence on persistent storage
    if (!fsSync.existsSync(video.file_path)) {
      const missingMsg = `Storage error: Video file not found at ${video.file_path}`;
      logger.error(missingMsg);
      db.prepare(`
        UPDATE videos SET
          status = 'failed',
          error_message = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(missingMsg, videoId);
      return;
    }

    logger.info(`Processing video: ${video.original_filename} (${videoId})`);

    // Run AI analysis
    const aiResult = await analyzeVideo(video.file_path, video.mime_type);

    // Update with AI results
    db.prepare(`
      UPDATE videos SET
        ai_title = ?,
        ai_description = ?,
        ai_hashtags = ?,
        ai_analysis = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      aiResult.title,
      aiResult.description,
      JSON.stringify(aiResult.hashtags),
      JSON.stringify(aiResult.analysis),
      videoId
    );

    // Run policy screening
    const policyResult = screenVideo(aiResult);

    db.prepare(`
      UPDATE videos SET
        policy_result = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(policyResult), videoId);

    if (policyResult.approved) {
      db.prepare("UPDATE videos SET status = 'analyzed', updated_at = datetime('now') WHERE id = ?").run(videoId);
      logger.info(`Video ${videoId} approved by policy screener`);
    } else {
      const rejectionReason = policyResult.rejectionReasons.join('; ');
      db.prepare(`
        UPDATE videos SET
          status = 'rejected',
          rejection_reason = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(rejectionReason, videoId);
      logger.info(`Video ${videoId} rejected: ${rejectionReason}`);
    }
  } catch (err) {
    logger.error(`Processing failed for video ${videoId}: ${err.message}`);
    db.prepare(`
      UPDATE videos SET
        status = 'failed',
        error_message = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(`Processing error: ${err.message}`, videoId);
  }
}

// POST /api/videos/upload
router.post('/upload', authenticate, (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err) return handleUploadError(err, req, res, next);
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const db = getDb();
    const videoId = uuidv4();
    const filePath = path.resolve(req.file.path);

    // Verify file actually exists and has positive size on storage
    if (!fsSync.existsSync(filePath)) {
      logger.error(`Uploaded file verification failed: File not found at ${filePath}`);
      return res.status(500).json({ error: 'Storage error: Uploaded file could not be verified on persistent storage.' });
    }

    const fileStat = fsSync.statSync(filePath);
    if (fileStat.size === 0) {
      try { fsSync.unlinkSync(filePath); } catch {}
      return res.status(400).json({ error: 'Uploaded video file is empty (0 bytes).' });
    }

    // Get video metadata
    const metadata = await getVideoMetadata(filePath);

    const video = {
      id: videoId,
      user_id: req.user.id,
      original_filename: req.file.originalname,
      stored_filename: req.file.filename,
      file_path: filePath,
      file_size: req.file.size,
      duration_seconds: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      mime_type: req.file.mimetype,
      status: 'uploaded',
    };

    db.prepare(`
      INSERT INTO videos (id, user_id, original_filename, stored_filename, file_path, file_size,
        duration_seconds, width, height, mime_type, status)
      VALUES (@id, @user_id, @original_filename, @stored_filename, @file_path, @file_size,
        @duration_seconds, @width, @height, @mime_type, @status)
    `).run(video);

    logger.info(`Video uploaded: ${req.file.originalname} (${videoId})`);

    // Trigger async processing (don't await)
    processVideo(videoId).catch(err => {
      logger.error(`Async processing error for ${videoId}: ${err.message}`);
    });

    res.status(201).json({ video });
  } catch (err) {
    logger.error(`Upload error: ${err.message}`);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// POST /api/videos/upload-multiple
router.post('/upload-multiple', authenticate, (req, res, next) => {
  uploadMultiple(req, res, (err) => {
    if (err) return handleUploadError(err, req, res, next);
    next();
  });
}, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No video files provided' });
    }

    const db = getDb();
    const videos = [];

    for (const file of req.files) {
      const videoId = uuidv4();
      const filePath = path.resolve(file.path);

      // Verify file actually exists and has positive size on storage
      if (!fsSync.existsSync(filePath)) {
        logger.error(`Uploaded file verification failed: File not found at ${filePath}`);
        return res.status(500).json({ error: 'Storage error: One or more files could not be verified on persistent storage.' });
      }

      const fileStat = fsSync.statSync(filePath);
      if (fileStat.size === 0) {
        try { fsSync.unlinkSync(filePath); } catch {}
        return res.status(400).json({ error: `Uploaded video file "${file.originalname}" is empty (0 bytes).` });
      }

      const metadata = await getVideoMetadata(filePath);

      const video = {
        id: videoId,
        user_id: req.user.id,
        original_filename: file.originalname,
        stored_filename: file.filename,
        file_path: filePath,
        file_size: file.size,
        duration_seconds: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        mime_type: file.mimetype,
        status: 'uploaded',
      };

      db.prepare(`
        INSERT INTO videos (id, user_id, original_filename, stored_filename, file_path, file_size,
          duration_seconds, width, height, mime_type, status)
        VALUES (@id, @user_id, @original_filename, @stored_filename, @file_path, @file_size,
          @duration_seconds, @width, @height, @mime_type, @status)
      `).run(video);

      videos.push(video);

      // Trigger async processing (don't await)
      processVideo(videoId).catch(err => {
        logger.error(`Async processing error for ${videoId}: ${err.message}`);
      });
    }

    logger.info(`${videos.length} videos uploaded`);
    res.status(201).json({ videos });
  } catch (err) {
    logger.error(`Multi-upload error: ${err.message}`);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// POST /api/videos/import-reels
router.post('/import-reels', authenticate, async (req, res) => {
  try {
    const { urls, url } = req.body;
    let urlList = [];

    if (Array.isArray(urls)) {
      urlList = urls;
    } else if (typeof url === 'string') {
      urlList = [url];
    } else if (typeof urls === 'string') {
      urlList = urls.split(/[\n,]+/).map(u => u.trim()).filter(Boolean);
    }

    if (urlList.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one valid Instagram Reel URL.' });
    }

    if (urlList.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 Reel URLs can be imported at once.' });
    }

    const maxBytes = (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 500) * 1024 * 1024;

    const results = await importInstagramReels({
      urls: urlList,
      userId: req.user.id,
      uploadDir: UPLOAD_DIR,
      maxBytes,
      getVideoMetadata,
      processVideoCallback: processVideo,
    });

    const isPartialSuccess = results.imported.length > 0 || results.skippedDuplicates.length > 0;

    res.status(isPartialSuccess || results.errors.length === 0 ? 200 : 400).json({
      success: isPartialSuccess,
      results,
    });
  } catch (err) {
    logger.error(`Import Reels endpoint error: ${err.message}`);
    res.status(500).json({ error: err.message || 'Failed to import Instagram Reels' });
  }
});

// GET /api/videos
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb();
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let query = 'SELECT * FROM videos WHERE user_id = ?';
    const params = [req.user.id];

    if (status) {
      const statuses = status.split(',').map(s => s.trim());
      const placeholders = statuses.map(() => '?').join(',');
      query += ` AND status IN (${placeholders})`;
      params.push(...statuses);
    }

    // Get total count
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const { total } = db.prepare(countQuery).get(...params);

    // Get status counts
    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM videos WHERE user_id = ? GROUP BY status
    `).all(req.user.id);

    const counts = {};
    for (const sc of statusCounts) {
      counts[sc.status] = sc.count;
    }

    // Get paginated results
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10), offset);

    const videos = db.prepare(query).all(...params);

    // Parse JSON fields
    const parsed = videos.map(v => ({
      ...v,
      ai_hashtags: v.ai_hashtags ? JSON.parse(v.ai_hashtags) : null,
      ai_analysis: v.ai_analysis ? JSON.parse(v.ai_analysis) : null,
      policy_result: v.policy_result ? JSON.parse(v.policy_result) : null,
    }));

    res.json({
      videos: parsed,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
      counts,
    });
  } catch (err) {
    logger.error(`List videos error: ${err.message}`);
    res.status(500).json({ error: 'Failed to list videos' });
  }
});

// GET /api/videos/:id
router.get('/:id', authenticate, (req, res) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Check queue position
    const queueEntry = db.prepare('SELECT position, scheduled_at FROM publishing_queue WHERE video_id = ?').get(video.id);

    const parsed = {
      ...video,
      ai_hashtags: video.ai_hashtags ? JSON.parse(video.ai_hashtags) : null,
      ai_analysis: video.ai_analysis ? JSON.parse(video.ai_analysis) : null,
      policy_result: video.policy_result ? JSON.parse(video.policy_result) : null,
      queuePosition: queueEntry?.position || null,
      scheduledAt: queueEntry?.scheduled_at || null,
    };

    res.json({ video: parsed });
  } catch (err) {
    logger.error(`Get video error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get video' });
  }
});

// POST /api/videos/:id/queue
router.post('/:id/queue', authenticate, (req, res) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.status !== 'analyzed') {
      return res.status(400).json({ error: `Cannot queue video with status '${video.status}'. Must be 'analyzed'.` });
    }

    // Check policy approval
    const policyResult = video.policy_result ? JSON.parse(video.policy_result) : null;
    if (!policyResult || !policyResult.approved) {
      return res.status(400).json({ error: 'Video did not pass policy screening' });
    }

    // Check YouTube connection
    const ytCreds = db.prepare('SELECT id FROM youtube_credentials WHERE user_id = ?').get(req.user.id);
    if (!ytCreds) {
      return res.status(400).json({ error: 'Please connect your YouTube account first' });
    }

    const entry = addToQueue(req.params.id, req.user.id);

    // Trigger publishing worker immediately in background if video is due
    setImmediate(() => {
      processNextDueVideo().catch(err => {
        logger.error(`Immediate publish worker error: ${err.message}`);
      });
    });

    res.json({ message: 'Added to publishing queue', entry });
  } catch (err) {
    logger.error(`Queue video error: ${err.message}`);
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

// DELETE /api/videos/:id/queue
router.delete('/:id/queue', authenticate, (req, res) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    removeFromQueue(req.params.id);
    db.prepare("UPDATE videos SET status = 'analyzed', updated_at = datetime('now') WHERE id = ?").run(req.params.id);

    res.json({ message: 'Removed from queue' });
  } catch (err) {
    logger.error(`Dequeue video error: ${err.message}`);
    res.status(500).json({ error: 'Failed to remove from queue' });
  }
});

// POST /api/videos/:id/retry
router.post('/:id/retry', authenticate, (req, res) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.status !== 'failed' && video.status !== 'rejected') {
      return res.status(400).json({ error: `Cannot retry video with status '${video.status}'` });
    }

    // Reset video for reprocessing
    db.prepare(`
      UPDATE videos SET
        status = 'uploaded',
        ai_title = NULL, ai_description = NULL, ai_hashtags = NULL, ai_analysis = NULL,
        policy_result = NULL, rejection_reason = NULL, error_message = NULL,
        retry_count = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(req.params.id);

    // Trigger reprocessing
    processVideo(req.params.id).catch(err => {
      logger.error(`Retry processing error for ${req.params.id}: ${err.message}`);
    });

    res.json({ message: 'Video queued for reprocessing' });
  } catch (err) {
    logger.error(`Retry video error: ${err.message}`);
    res.status(500).json({ error: 'Failed to retry video' });
  }
});

// DELETE /api/videos/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Remove from queue if queued
    removeFromQueue(req.params.id);

    // Delete file from disk
    try {
      await fs.unlink(video.file_path);
    } catch (unlinkErr) {
      logger.warn(`Could not delete file ${video.file_path}: ${unlinkErr.message}`);
    }

    // Delete database record
    db.prepare('DELETE FROM videos WHERE id = ?').run(req.params.id);

    logger.info(`Video deleted: ${req.params.id}`);
    res.json({ message: 'Video deleted' });
  } catch (err) {
    logger.error(`Delete video error: ${err.message}`);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

export default router;
