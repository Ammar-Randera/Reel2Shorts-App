import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'reel2shorts.db');

let db = null;

export function initDb() {
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent reads
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      duration_seconds REAL,
      width INTEGER,
      height INTEGER,
      mime_type TEXT,
      status TEXT NOT NULL DEFAULT 'uploaded',
      source_type TEXT NOT NULL DEFAULT 'upload',
      source_url TEXT,
      instagram_shortcode TEXT,
      ai_title TEXT,
      ai_description TEXT,
      ai_hashtags TEXT,
      ai_analysis TEXT,
      policy_result TEXT,
      rejection_reason TEXT,
      youtube_video_id TEXT,
      youtube_url TEXT,
      published_at TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS youtube_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      access_token_encrypted TEXT NOT NULL,
      refresh_token_encrypted TEXT NOT NULL,
      token_expiry TEXT,
      channel_id TEXT,
      channel_title TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS publishing_queue (
      id TEXT PRIMARY KEY,
      video_id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      scheduled_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      publish_interval_minutes INTEGER NOT NULL DEFAULT 10,
      auto_publish INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);
    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
    CREATE INDEX IF NOT EXISTS idx_videos_shortcode ON videos(instagram_shortcode);
    CREATE INDEX IF NOT EXISTS idx_videos_source_url ON videos(source_url);
    CREATE INDEX IF NOT EXISTS idx_publishing_queue_position ON publishing_queue(position);
    CREATE INDEX IF NOT EXISTS idx_publishing_queue_user_id ON publishing_queue(user_id);
    CREATE INDEX IF NOT EXISTS idx_publishing_queue_scheduled ON publishing_queue(scheduled_at);
  `);

  // Run lightweight migrations for existing databases
  try {
    db.exec("ALTER TABLE videos ADD COLUMN source_type TEXT NOT NULL DEFAULT 'upload'");
  } catch {}
  try {
    db.exec("ALTER TABLE videos ADD COLUMN source_url TEXT");
  } catch {}
  try {
    db.exec("ALTER TABLE videos ADD COLUMN instagram_shortcode TEXT");
  } catch {}

  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export default { initDb, getDb, closeDb };
