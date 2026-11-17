# Reel2Shorts 🎬➡️📱

A production-ready full-stack web application that empowers creators to submit owned or permitted Instagram Reels, analyze video and audio with Google Gemini AI, generate high-converting YouTube Shorts metadata, strictly screen for copyright and policy compliance, and automatically publish to YouTube Shorts via a configurable FIFO queue.

---

## 🚀 Key Features

- **📱 Mobile-Friendly Dashboard**: Clean responsive UI built with React 18, Vite, and Tailwind CSS.
- **📤 Multi-Video Upload**: Upload individual or batches of Instagram Reels (MP4, MOV, WebM, MKV) up to 500MB per file with progress tracking and validation.
- **🔒 Isolated Video Storage**: Local disk storage with UUID-based obfuscated file naming and isolated access controls.
- **🧠 AI Video & Audio Analysis**: Powered by Google Gemini 2.0 Flash (`@google/generative-ai`), extracting topics, quality scores, language, and generating viral Shorts titles, descriptions, and hashtags.
- **🛡️ Strict Automated Policy Screening**:
  - Automatically identifies copyrighted music, logos, third-party content, violence, explicit content, and reused content.
  - **Zero-Tolerance / Strict Mode**: When confidence is medium/low or any risk is flagged, the video is **strictly rejected**.
- **⏱️ FIFO Publishing Queue**:
  - First-In, First-Out execution order.
  - Dynamic drag-and-drop / arrow reordering.
  - Configurable publication intervals (default: 10 minutes between Shorts).
- **🔴 Official YouTube Integration**:
  - Full Google OAuth 2.0 authentication flow with offline access token refreshing.
  - Resumable video uploads via the official YouTube Data API v3.
  - Duplicate detection to prevent identical video uploads.
- **🔄 Background Daemon**: Persistent background processor with automatic retry logic (up to 3 attempts), duplicate checks, and graceful shutdown handling.
- **🔐 Enterprise Security**: AES-256-GCM token encryption, bcryptjs password hashing, JWT authentication, and Express rate limiting.

---

## 🏗️ Architecture

```
reel2shorts/
├── client/                     # Frontend (React 18 + Vite + Tailwind CSS)
│   ├── src/
│   │   ├── api/client.js       # Fetch & XHR upload client
│   │   ├── context/            # AuthContext (JWT + YouTube status)
│   │   ├── components/         # Layout, StatusBadge, VideoCard, UploadZone, QueueList
│   │   ├── pages/              # Dashboard, Upload, VideoDetail, QueuePage, Settings, Login, Register
│   │   ├── App.jsx             # React Router v6 setup & protected routes
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.js
├── server/                     # Backend (Node.js + Express ESM)
│   ├── config/
│   │   ├── database.js         # SQLite with WAL mode & automated schema creation
│   │   └── logger.js           # Winston logger
│   ├── middleware/
│   │   ├── auth.js             # JWT verification & token generator
│   │   └── upload.js           # Multer file storage & type filter
│   ├── services/
│   │   ├── ai-analyzer.js      # Gemini 2.0 Flash video/audio content analysis
│   │   ├── policy-screener.js  # Strict copyright, reused-content, and policy risk evaluator
│   │   ├── youtube-publisher.js# YouTube Data API v3 client, OAuth2, and duplicate checker
│   │   ├── queue-manager.js    # FIFO scheduling engine & interval calculator
│   │   └── encryption.js       # AES-256-GCM symmetric encryption for tokens
│   ├── routes/                 # /api/auth, /api/videos, /api/youtube, /api/settings
│   ├── workers/
│   │   └── processor.js        # Background publishing queue daemon
│   └── index.js                # Express app entry & graceful shutdown
├── uploads/                    # Secure local video storage directory
├── data/                       # SQLite persistent database storage
├── Dockerfile                  # Production multi-stage container
├── docker-compose.yml          # Production container orchestration
├── .env.example
└── README.md
```

---

## 🛠️ Prerequisites

- **Docker** & **Docker Compose** (recommended for cloud or container deployment) OR **Node.js >= 18** and **FFmpeg**.
- **Google Cloud Console Project** with:
  - **YouTube Data API v3** enabled.
  - OAuth 2.0 Client ID (Web Application).
- **Google Gemini API Key** (from [Google AI Studio](https://aistudio.google.com/)).

---

## ⚙️ Configuration & Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description | Example / Default |
|---|---|---|
| `PORT` | Server listening port | `3001` |
| `NODE_ENV` | Application environment | `production` / `development` |
| `JWT_SECRET` | Secret key for signing user auth tokens | 64+ random characters |
| `ENCRYPTION_KEY` | 32-byte hexadecimal key for AES-256-GCM | `openssl rand -hex 32` |
| `GEMINI_API_KEY` | Google Gemini API key | `AIzaSy...` |
| `YOUTUBE_CLIENT_ID` | Google OAuth 2.0 Web Client ID | `xxxx.apps.googleusercontent.com` |
| `YOUTUBE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret | `GOCSPX-xxxx` |
| `YOUTUBE_REDIRECT_URI` | OAuth callback redirect URL | `https://your-domain.com/api/youtube/callback` |
| `DEFAULT_PUBLISH_INTERVAL_MINUTES` | Publishing spacing default | `10` |
| `MAX_RETRY_ATTEMPTS` | Retries on failed uploads | `3` |
| `UPLOAD_DIR` | Video uploads directory path | `./uploads` |
| `MAX_FILE_SIZE_MB` | Max upload size per video in MB | `500` |

---

## ☁️ Cloud Deployment Options

### Option 1: Docker Compose (Any Cloud VPS / Droplet)
1. Clone the repository onto your remote cloud host:
   ```bash
   git clone <repo-url> reel2shorts
   cd reel2shorts
   ```
2. Populate `.env` with your production API keys and secrets.
3. Start the application:
   ```bash
   docker compose up -d --build
   ```
4. The service will be live on port `3001` with automated database persistence and video mounts.

### Option 2: Railway.app / Render
1. Connect this repository to **Railway** or **Render**.
2. Set the environment to use the `Dockerfile`.
3. Add a persistent volume mounted to `/app/uploads` and `/app/data`.
4. Define the environment variables specified in `.env.example`.
5. Update `YOUTUBE_REDIRECT_URI` in Google Cloud Console to match your deployed domain.

### Option 3: Google Cloud Run
1. Build and push the container to Google Artifact Registry:
   ```bash
   gcloud builds submit --tag gcr.io/<PROJECT-ID>/reel2shorts
   ```
2. Deploy to Cloud Run with persistent storage (Cloud Storage volume mount) and environment variables set in Secret Manager.

---

## 🔑 Google Cloud & YouTube OAuth Setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project named `Reel2Shorts`.
3. Navigate to **APIs & Services > Library** and enable **YouTube Data API v3**.
4. Go to **APIs & Services > OAuth consent screen**:
   - Set User Type to **External**.
   - Add scopes: `.../auth/youtube.upload`, `.../auth/youtube.readonly`, and `.../auth/youtube`.
   - Add your test account email under Test Users.
5. Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID**:
   - Application Type: **Web Application**.
   - Authorized redirect URIs: `http://localhost:3001/api/youtube/callback` (or your production cloud URL).
6. Copy the **Client ID** and **Client Secret** into your `.env` file.

---

## 🚦 Strict Acceptance / Rejection Policy

To safeguard creator channels against copyright strikes and demonetization, Reel2Shorts implements a **strict conservative screening policy**:

| Risk Category | Strict Condition | Result |
|---|---|---|
| **Copyrighted Music** | Any commercial track detected OR confidence is low/medium | ❌ **REJECTED** |
| **Third-Party Content** | Watermarks, external creator tags, or clips detected | ❌ **REJECTED** |
| **Reused Content** | Content lacks transformative elements or seems duplicate | ❌ **REJECTED** |
| **Community Guidelines** | Adult content, violence, hate speech, dangerous acts | ❌ **REJECTED** |
| **Quality Score** | AI quality score below 4/10 | ❌ **REJECTED** |
| **Ambiguity** | Any risk flag with uncertain confidence | ❌ **REJECTED** |

*Only videos scoring a clean bill of health across all checks are marked as `Passed Screen` (`analyzed`) and permitted into the publishing queue.*

---

## 📡 REST API Reference

### Authentication
- `POST /api/auth/register` — Create account (`email`, `password`, `displayName`).
- `POST /api/auth/login` — Sign in and receive JWT token.
- `GET /api/auth/me` — Get current user profile and YouTube connection state.
- `POST /api/auth/logout` — Invalidate session.

### Videos
- `POST /api/videos/upload` — Upload single video (`video` form-data).
- `POST /api/videos/upload-multiple` — Batch upload up to 10 videos (`videos` form-data).
- `GET /api/videos` — List videos with optional `?status=` and pagination.
- `GET /api/videos/:id` — Get detailed video report including AI analysis & risk screening.
- `POST /api/videos/:id/queue` — Add eligible video to FIFO publishing queue.
- `DELETE /api/videos/:id/queue` — Dequeue video.
- `POST /api/videos/:id/retry` — Trigger re-analysis of failed or rejected video.
- `DELETE /api/videos/:id` — Delete video and file from storage.

### YouTube & Queue
- `GET /api/youtube/auth-url` — Get OAuth 2.0 consent URL.
- `GET /api/youtube/callback` — OAuth 2.0 exchange endpoint.
- `GET /api/youtube/status` — Connected channel details.
- `DELETE /api/youtube/disconnect` — Disconnect YouTube credentials.
- `GET /api/youtube/queue` — Retrieve current FIFO queue in order.
- `GET /api/youtube/queue/stats` — Queue size and ETA of publishing.
- `PUT /api/youtube/queue/reorder` — Reorder queue (`videoIds` array).

### Settings
- `GET /api/settings` — Get publishing interval and auto-publish status.
- `PUT /api/settings` — Update interval and toggles.

---

## 📄 License

MIT License — Copyright (c) 2026. Built with reliability and creator safety as top priorities.
