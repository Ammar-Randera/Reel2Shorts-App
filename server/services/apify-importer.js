import { ApifyClient } from 'apify-client';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../config/database.js';
import logger from '../config/logger.js';

const ACTOR_ID = 'apify/instagram-reel-scraper';
const DEFAULT_TIMEOUT_SECS = 180; // 3 minutes for actor execution
const DOWNLOAD_TIMEOUT_MS = 60000; // 60 seconds for video stream download

/**
 * Validate and normalize an Instagram Reel URL
 * Supported formats:
 * - https://www.instagram.com/reel/C8XYZ123_/
 * - https://instagram.com/reels/C8XYZ123_/?igsh=...
 * - https://www.instagram.com/p/C8XYZ123_/
 *
 * @param {string} inputUrl
 * @returns {{ isValid: boolean, shortcode?: string, canonicalUrl?: string, error?: string }}
 */
export function parseInstagramUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { isValid: false, error: 'Empty URL provided' };
  }

  const trimmed = inputUrl.trim();
  const match = trimmed.match(/instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/i);

  if (!match || !match[1]) {
    return {
      isValid: false,
      error: `Invalid Instagram Reel URL format: "${trimmed}". Expected https://www.instagram.com/reel/<ID>/`,
    };
  }

  const shortcode = match[1];
  const canonicalUrl = `https://www.instagram.com/reel/${shortcode}/`;

  return {
    isValid: true,
    shortcode,
    canonicalUrl,
    originalUrl: trimmed,
  };
}

/**
 * Check if shortcodes or URLs are already imported in the database
 * @param {string} userId
 * @param {Array<{ shortcode: string, canonicalUrl: string }>} items
 * @returns {Map<string, Object>} Map of shortcode -> existing video record
 */
export function findDuplicates(userId, items) {
  const db = getDb();
  const duplicates = new Map();

  const stmt = db.prepare(`
    SELECT id, original_filename, status, source_url, instagram_shortcode, created_at
    FROM videos
    WHERE user_id = ?
      AND (instagram_shortcode = ? OR source_url = ?)
      AND status != 'failed'
  `);

  for (const item of items) {
    const existing = stmt.get(userId, item.shortcode, item.canonicalUrl);
    if (existing) {
      duplicates.set(item.shortcode, existing);
    }
  }

  return duplicates;
}

/**
 * Call the Apify actor 'apify/instagram-reel-scraper' and retrieve dataset items
 * @param {string[]} targetUrls - List of canonical Instagram Reel URLs
 * @returns {Promise<Array>} Dataset items from Apify
 */
export async function fetchReelsFromApify(targetUrls) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token || token.trim() === '' || token === 'your-apify-api-token') {
    throw new Error(
      'APIFY_API_TOKEN is not configured. Please add your Apify API Token in your environment or Railway variables.'
    );
  }

  logger.info(`Starting Apify actor ${ACTOR_ID} for ${targetUrls.length} Reel URL(s)...`);

  const client = new ApifyClient({ token });

  // Input schema per Apify documentation:
  // "username": array of usernames, profile URLs, or direct Reel URLs
  // "resultsLimit": maximum items to collect
  const actorInput = {
    username: targetUrls,
    resultsLimit: targetUrls.length,
    skipPinnedPosts: false,
    skipTrialReels: false,
  };

  let run;
  try {
    run = await client.actor(ACTOR_ID).call(actorInput, {
      timeout: DEFAULT_TIMEOUT_SECS,
      memory: 2048,
    });
  } catch (actorErr) {
    logger.error(`Apify actor execution failed: ${actorErr.message}`);
    throw new Error(`Apify Reel Scraper failed: ${actorErr.message}`);
  }

  if (!run || run.status !== 'SUCCEEDED') {
    const status = run ? run.status : 'UNKNOWN';
    logger.error(`Apify run ended with non-success status: ${status}`);
    throw new Error(`Apify scraper run completed with status: ${status}`);
  }

  logger.info(`Apify run ${run.id} succeeded. Fetching dataset items...`);

  // Fetch items from the default dataset
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  logger.info(`Retrieved ${items ? items.length : 0} items from Apify dataset.`);

  return items || [];
}

/**
 * Download a remote video URL directly into persistent local storage
 * @param {string} videoUrl - Direct CDN video link
 * @param {string} destinationPath - Target local file path
 * @param {number} maxBytes - Maximum allowed size in bytes
 * @returns {Promise<{ filePath: string, fileSize: number }>}
 */
export async function downloadVideoFile(videoUrl, destinationPath, maxBytes) {
  logger.info(`Downloading video stream to: ${path.basename(destinationPath)}...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(videoUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Video download failed with HTTP status ${response.status}: ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error(
      `Video size (${(parseInt(contentLength, 10) / 1024 / 1024).toFixed(1)}MB) exceeds maximum limit of ${(maxBytes / 1024 / 1024).toFixed(0)}MB.`
    );
  }

  const destDir = path.dirname(destinationPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const fileStream = fs.createWriteStream(destinationPath);

  try {
    await pipeline(Readable.fromWeb(response.body), fileStream);
  } catch (streamErr) {
    // Clean up partial file on failure
    try {
      if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath);
    } catch {}
    throw new Error(`Failed while saving video stream: ${streamErr.message}`);
  }

  const stat = fs.statSync(destinationPath);
  if (stat.size === 0) {
    try {
      fs.unlinkSync(destinationPath);
    } catch {}
    throw new Error('Downloaded video file is empty (0 bytes).');
  }

  logger.info(`Video download complete: ${(stat.size / 1024 / 1024).toFixed(2)} MB saved.`);
  return { filePath: destinationPath, fileSize: stat.size };
}

/**
 * Import Instagram Reels workflow:
 * 1. Validate & normalize URLs
 * 2. Deduplicate against requested batch & existing database records
 * 3. Call Apify actor
 * 4. Match results and extract videoUrl
 * 5. Download videos into persistent storage
 * 6. Insert video records and trigger AI processing pipeline
 *
 * @param {Object} options
 * @param {string[]} options.urls - Raw Instagram URLs provided by user
 * @param {string} options.userId - Authenticated user ID
 * @param {string} options.uploadDir - Storage directory path
 * @param {number} options.maxBytes - Max allowed file size in bytes
 * @param {Function} options.getVideoMetadata - Function to extract ffprobe metadata
 * @param {Function} options.processVideoCallback - Callback to trigger AI & policy pipeline
 * @returns {Promise<{ imported: Array, skippedDuplicates: Array, errors: Array }>}
 */
export async function importInstagramReels({
  urls,
  userId,
  uploadDir,
  maxBytes,
  getVideoMetadata,
  processVideoCallback,
}) {
  const db = getDb();

  const imported = [];
  const skippedDuplicates = [];
  const errors = [];

  // 1. Parse and validate URLs
  const validTargets = [];
  const seenShortcodesInBatch = new Set();

  for (const rawUrl of urls) {
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) continue;

    const parsed = parseInstagramUrl(rawUrl);
    if (!parsed.isValid) {
      errors.push({ url: rawUrl, error: parsed.error });
      continue;
    }

    if (seenShortcodesInBatch.has(parsed.shortcode)) {
      // Duplicate in the same input request
      continue;
    }
    seenShortcodesInBatch.add(parsed.shortcode);
    validTargets.push(parsed);
  }

  if (validTargets.length === 0) {
    return { imported, skippedDuplicates, errors };
  }

  // 2. Check for existing database duplicates
  const duplicatesMap = findDuplicates(userId, validTargets);
  const targetsToScrape = [];

  for (const target of validTargets) {
    if (duplicatesMap.has(target.shortcode)) {
      const existing = duplicatesMap.get(target.shortcode);
      skippedDuplicates.push({
        url: target.canonicalUrl,
        shortcode: target.shortcode,
        existingId: existing.id,
        reason: `Reel has already been imported on ${existing.created_at} (status: ${existing.status})`,
      });
    } else {
      targetsToScrape.push(target);
    }
  }

  if (targetsToScrape.length === 0) {
    return { imported, skippedDuplicates, errors };
  }

  // Ensure upload directory exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // 3. Call Apify actor with all target URLs
  const urlsToQuery = targetsToScrape.map((t) => t.canonicalUrl);
  let datasetItems = [];

  try {
    datasetItems = await fetchReelsFromApify(urlsToQuery);
  } catch (apifyErr) {
    // If the entire Apify call fails, mark all pending targets with the error
    for (const target of targetsToScrape) {
      errors.push({
        url: target.canonicalUrl,
        error: apifyErr.message,
      });
    }
    return { imported, skippedDuplicates, errors };
  }

  // Index dataset items by shortCode and by matching URL
  const itemsByShortcode = new Map();
  for (const item of datasetItems) {
    if (item.shortCode) {
      itemsByShortcode.set(item.shortCode.toLowerCase(), item);
    }
    if (item.url) {
      const parsedItemUrl = parseInstagramUrl(item.url);
      if (parsedItemUrl.isValid) {
        itemsByShortcode.set(parsedItemUrl.shortcode.toLowerCase(), item);
      }
    }
  }

  // 4. Process each targeted Reel
  for (const target of targetsToScrape) {
    const item = itemsByShortcode.get(target.shortcode.toLowerCase());

    if (!item) {
      errors.push({
        url: target.canonicalUrl,
        shortcode: target.shortcode,
        error: 'Apify did not return data for this Reel. It may be private, deleted, or geoblocked.',
      });
      continue;
    }

    // 5. Verify direct video URL
    const videoUrl = item.videoUrl;
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.startsWith('http')) {
      errors.push({
        url: target.canonicalUrl,
        shortcode: target.shortcode,
        error: 'No downloadable video URL found in Instagram metadata. The post may not be a public video Reel.',
      });
      continue;
    }

    // 6. Download the video into persistent storage
    const videoId = uuidv4();
    const storedFilename = `${uuidv4()}.mp4`;
    const destinationPath = path.resolve(uploadDir, storedFilename);

    try {
      const { fileSize } = await downloadVideoFile(videoUrl, destinationPath, maxBytes);

      // Get video duration, width, height via ffprobe
      let metadata = { duration: item.duration || null, width: null, height: null };
      if (getVideoMetadata) {
        try {
          const probeMeta = await getVideoMetadata(destinationPath);
          metadata = {
            duration: probeMeta.duration || item.duration || null,
            width: probeMeta.width || null,
            height: probeMeta.height || null,
          };
        } catch {}
      }

      const originalFilename = `instagram_reel_${target.shortcode}.mp4`;

      const videoRecord = {
        id: videoId,
        user_id: userId,
        original_filename: originalFilename,
        stored_filename: storedFilename,
        file_path: destinationPath,
        file_size: fileSize,
        duration_seconds: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        mime_type: 'video/mp4',
        status: 'uploaded',
        source_type: 'instagram',
        source_url: target.canonicalUrl,
        instagram_shortcode: target.shortcode,
      };

      // Insert into SQLite database
      db.prepare(`
        INSERT INTO videos (
          id, user_id, original_filename, stored_filename, file_path, file_size,
          duration_seconds, width, height, mime_type, status, source_type, source_url, instagram_shortcode
        ) VALUES (
          @id, @user_id, @original_filename, @stored_filename, @file_path, @file_size,
          @duration_seconds, @width, @height, @mime_type, @status, @source_type, @source_url, @instagram_shortcode
        )
      `).run(videoRecord);

      logger.info(`Successfully imported Reel ${target.shortcode} -> Video ID ${videoId}`);

      // 7. Trigger the AI analysis and policy screening pipeline
      if (processVideoCallback) {
        processVideoCallback(videoId).catch((err) => {
          logger.error(`Background processing error for imported video ${videoId}: ${err.message}`);
        });
      }

      imported.push({
        id: videoId,
        shortcode: target.shortcode,
        url: target.canonicalUrl,
        filename: originalFilename,
        caption: item.caption || '',
        duration: metadata.duration,
        fileSize,
      });
    } catch (downloadErr) {
      logger.error(`Download/import error for ${target.canonicalUrl}: ${downloadErr.message}`);
      errors.push({
        url: target.canonicalUrl,
        shortcode: target.shortcode,
        error: downloadErr.message,
      });
    }
  }

  return { imported, skippedDuplicates, errors };
}

export default {
  parseInstagramUrl,
  findDuplicates,
  fetchReelsFromApify,
  downloadVideoFile,
  importInstagramReels,
};
