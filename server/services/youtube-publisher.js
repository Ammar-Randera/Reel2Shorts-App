import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt } from './encryption.js';
import logger from '../config/logger.js';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube',
];

/**
 * Create an OAuth2 client
 */
function createOAuth2Client() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;

  if (!clientId || !clientSecret) {
    throw new Error('YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must be configured');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Generate the YouTube OAuth consent URL
 * @param {string} userId - User ID to include in state
 * @returns {string} OAuth consent URL
 */
export function getAuthUrl(userId) {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to get refresh token
    state: JSON.stringify({ userId }),
  });
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from callback
 * @returns {Promise<{ access_token: string, refresh_token: string, expiry_date: number }>}
 */
export async function handleCallback(code) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    logger.warn('No refresh token received. User may need to revoke access and re-authorize.');
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || '',
    expiry_date: tokens.expiry_date,
  };
}

/**
 * Refresh an expired access token
 * @param {string} refreshTokenEncrypted - Encrypted refresh token
 * @returns {Promise<{ access_token: string, expiry_date: number }>}
 */
export async function refreshAccessToken(refreshTokenEncrypted) {
  const oauth2Client = createOAuth2Client();
  const refreshToken = decrypt(refreshTokenEncrypted);

  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();

  return {
    access_token: credentials.access_token,
    expiry_date: credentials.expiry_date,
  };
}

/**
 * Publish a video to YouTube Shorts
 * @param {Object} options
 * @param {string} options.filePath - Path to the video file
 * @param {string} options.title - Video title
 * @param {string} options.description - Video description
 * @param {string[]} options.hashtags - Array of hashtags
 * @param {string} options.accessToken - Decrypted access token
 * @param {string} options.refreshTokenEncrypted - Encrypted refresh token (for auto-refresh)
 * @returns {Promise<{ videoId: string, url: string }>}
 */
export async function publishToYouTube({ filePath, title, description, hashtags, accessToken, refreshTokenEncrypted }) {
  const oauth2Client = createOAuth2Client();

  // Set up credentials with auto-refresh
  const refreshToken = decrypt(refreshTokenEncrypted);
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  // Ensure title has #Shorts for YouTube Shorts discovery
  let shortTitle = title;
  if (!shortTitle.toLowerCase().includes('#shorts')) {
    shortTitle = `${shortTitle} #Shorts`;
  }
  // YouTube title limit is 100 characters
  shortTitle = shortTitle.substring(0, 100);

  // Build description with hashtags
  const hashtagString = hashtags.map(h => `#${h.replace(/^#/, '')}`).join(' ');
  const fullDescription = `${description}\n\n${hashtagString}`.substring(0, 5000);

  logger.info(`Publishing to YouTube: "${shortTitle}"`);

  const fileStream = fs.createReadStream(filePath);

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: shortTitle,
        description: fullDescription,
        categoryId: '22', // People & Blogs
        defaultLanguage: 'en',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
        license: 'youtube',
      },
    },
    media: {
      body: fileStream,
    },
  });

  const videoId = response.data.id;
  const url = `https://youtube.com/shorts/${videoId}`;

  logger.info(`Published successfully: ${url}`);

  return { videoId, url };
}

/**
 * Check if a video with a similar title already exists on the channel
 * @param {string} title - Video title to check
 * @param {Object} credentials - { accessToken, refreshTokenEncrypted }
 * @returns {Promise<boolean>} true if a potential duplicate exists
 */
export async function checkDuplicate(title, credentials) {
  try {
    const oauth2Client = createOAuth2Client();
    const refreshToken = decrypt(credentials.refreshTokenEncrypted);
    oauth2Client.setCredentials({
      access_token: credentials.accessToken,
      refresh_token: refreshToken,
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Search for videos on the user's channel with matching title
    const cleanTitle = title.replace(/#\w+/g, '').trim();
    const response = await youtube.search.list({
      part: ['snippet'],
      forMine: true,
      type: ['video'],
      q: cleanTitle,
      maxResults: 5,
    });

    const items = response.data.items || [];
    for (const item of items) {
      const existingTitle = (item.snippet.title || '').toLowerCase().replace(/#\w+/g, '').trim();
      const newTitle = cleanTitle.toLowerCase();
      // Check for high similarity (exact match after removing hashtags)
      if (existingTitle === newTitle) {
        logger.warn(`Duplicate detected: "${item.snippet.title}" matches "${title}"`);
        return true;
      }
    }

    return false;
  } catch (err) {
    logger.error(`Duplicate check failed: ${err.message}`);
    // On error, return false to allow the publish attempt
    // The YouTube API will reject true duplicates anyway
    return false;
  }
}

/**
 * Get YouTube channel info
 * @param {string} accessToken - Valid access token
 * @returns {Promise<{ channelId: string, channelTitle: string }>}
 */
export async function getChannelInfo(accessToken) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const response = await youtube.channels.list({
    part: ['snippet'],
    mine: true,
  });

  const channel = response.data.items?.[0];
  if (!channel) {
    throw new Error('No YouTube channel found for this account');
  }

  return {
    channelId: channel.id,
    channelTitle: channel.snippet.title,
  };
}

export default { getAuthUrl, handleCallback, refreshAccessToken, publishToYouTube, checkDuplicate, getChannelInfo };
