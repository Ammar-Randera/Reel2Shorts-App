import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initDb, closeDb } from './config/database.js';
import logger from './config/logger.js';
import authRoutes from './routes/auth.js';
import videoRoutes from './routes/videos.js';
import youtubeRoutes from './routes/youtube.js';
import settingsRoutes from './routes/settings.js';
import { startPublishingWorker, stopPublishingWorker } from './workers/processor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Trust reverse proxy (Railway / Cloudflare) to ensure accurate rate-limiting
app.set('trust proxy', 1);

// Ensure Storage & Upload Directories exist and are writable
function ensureStorageDirectories() {
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads'));
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      logger.info(`Storage: Created uploads directory: ${uploadDir}`);
    } else {
      logger.info(`Storage: Uploads directory exists: ${uploadDir}`);
    }

    // Verify write permissions with a temporary probe file
    const probeFile = path.join(uploadDir, `.probe-${Date.now()}`);
    fs.writeFileSync(probeFile, 'ok');
    fs.unlinkSync(probeFile);
    logger.info(`Storage: Verified read/write access to ${uploadDir}`);
  } catch (err) {
    logger.error(`Storage: Directory verification failure for ${uploadDir}: ${err.message}`);
    throw err;
  }
}

// Initialize Database & Storage
try {
  initDb();
  logger.info('Database initialized successfully.');
  ensureStorageDirectories();
} catch (initErr) {
  logger.error(`Application initialization failure: ${initErr.message}`);
  process.exit(1);
}

// Security & Optimization Middleware
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiter for API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests per 15 min window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Reel2Shorts API',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Mount Routes
app.use('/api/auth', apiLimiter, authRoutes);
app.use('/api/videos', apiLimiter, videoRoutes);
app.use('/api/youtube', apiLimiter, youtubeRoutes);
app.use('/api/settings', apiLimiter, settingsRoutes);

// In production, serve static files from client/dist
const clientDistPath = path.resolve(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDistPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  const indexPath = path.join(clientDistPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(404).send('Application UI is building or not found. Please visit /api/health');
    }
  });
});

// Central error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled Express Error: ${err.stack || err.message}`);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

// Start Server
const server = app.listen(PORT, () => {
  logger.info(`Reel2Shorts server running on port ${PORT} (Environment: ${process.env.NODE_ENV || 'development'})`);
  // Start background worker for publishing queue
  startPublishingWorker();
});

// Graceful Shutdown
function handleShutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  stopPublishingWorker();
  server.close(() => {
    logger.info('HTTP server closed.');
    closeDb();
    logger.info('Database connection closed.');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Force shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export default app;
