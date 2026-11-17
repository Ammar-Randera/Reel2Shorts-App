import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../config/logger.js';

const MAX_INLINE_SIZE = 20 * 1024 * 1024; // 20MB for inline data
const ANALYSIS_TIMEOUT = 120_000; // 120 seconds

const ANALYSIS_PROMPT = `You are a professional video content analyst. Analyze this video carefully and return a JSON object with the following structure. Be thorough and accurate.

Return ONLY valid JSON matching this schema — no markdown, no explanation, just the JSON object:

{
  "title": "A concise, engaging YouTube Shorts title (max 100 characters). Make it catchy and relevant.",
  "description": "A YouTube Shorts description (max 500 characters). Include a call to action. Do not include hashtags here.",
  "hashtags": ["array", "of", "10", "to", "15", "relevant", "hashtags", "without", "the", "hash", "symbol"],
  "analysis": {
    "categories": ["array of content categories/topics detected"],
    "language": "primary language detected (ISO 639-1 code)",
    "qualityScore": 7,
    "contentFlags": {
      "copyrightedMusic": false,
      "copyrightedMusicConfidence": "high",
      "trademarkedBrands": false,
      "trademarkedBrandsDetail": "",
      "thirdPartyContent": false,
      "thirdPartyContentDetail": "",
      "explicitAdultContent": false,
      "violence": false,
      "hateSpeech": false,
      "misleadingClaims": false,
      "appearsReused": false,
      "appearsReusedDetail": ""
    }
  }
}

RULES:
- "qualityScore" is 1-10 (10 = professional quality, 1 = unwatchable)
- For confidence fields, use "high", "medium", or "low"
- "copyrightedMusic": true if you detect any recognizable copyrighted music or songs
- "trademarkedBrands": true if prominent trademarked logos/brands are featured
- "thirdPartyContent": true if content appears to be from another creator
- "appearsReused": true if the content looks like it was taken from another platform/creator
- Be CONSERVATIVE: if you're unsure about copyright/reuse, set confidence to "low" and the flag to true
- Return ONLY the JSON object, no other text`;

/**
 * Analyze a video file using Google Gemini API
 * @param {string} filePath - Absolute path to the video file
 * @param {string} mimeType - MIME type of the video
 * @returns {Promise<Object>} Analysis result with title, description, hashtags, analysis
 */
export async function analyzeVideo(filePath, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-gemini-api-key') {
    throw new Error('GEMINI_API_KEY is not configured. Set it in your .env file.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const stat = await fs.stat(filePath);
  logger.info(`Analyzing video: ${path.basename(filePath)} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);

  let result;

  if (stat.size <= MAX_INLINE_SIZE) {
    // Inline data approach for smaller files
    const fileBuffer = await fs.readFile(filePath);
    const base64Data = fileBuffer.toString('base64');

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), ANALYSIS_TIMEOUT);

    try {
      result = await model.generateContent([
        {
          inlineData: {
            mimeType: mimeType || 'video/mp4',
            data: base64Data,
          },
        },
        { text: ANALYSIS_PROMPT },
      ]);
    } finally {
      clearTimeout(timeout);
    }
  } else {
    // For larger files, do a text-only analysis based on metadata
    logger.warn(`Video too large for inline analysis (${(stat.size / 1024 / 1024).toFixed(1)}MB). Using metadata-only analysis.`);

    const metadataPrompt = `${ANALYSIS_PROMPT}

NOTE: The video file is too large to analyze directly. Based on the filename "${path.basename(filePath)}" and file type "${mimeType}", provide a conservative analysis. Mark all copyright/reuse flags as uncertain (set flags to true with low confidence) since you cannot view the content directly.`;

    result = await model.generateContent(metadataPrompt);
  }

  const responseText = result.response.text();
  logger.debug(`Gemini raw response: ${responseText.substring(0, 500)}`);

  // Parse JSON from response - handle markdown code blocks
  let parsed;
  try {
    // Try direct JSON parse first
    parsed = JSON.parse(responseText);
  } catch {
    // Try extracting from markdown code block
    const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1].trim());
    } else {
      // Try finding JSON object in the text
      const objectMatch = responseText.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        parsed = JSON.parse(objectMatch[0]);
      } else {
        throw new Error('Failed to parse AI response as JSON');
      }
    }
  }

  // Validate required fields
  if (!parsed.title || !parsed.description || !parsed.hashtags || !parsed.analysis) {
    throw new Error('AI response missing required fields (title, description, hashtags, analysis)');
  }

  // Enforce constraints
  parsed.title = parsed.title.substring(0, 100);
  parsed.description = parsed.description.substring(0, 500);
  parsed.hashtags = (parsed.hashtags || []).slice(0, 15).map(h => h.replace(/^#/, ''));

  logger.info(`Analysis complete: "${parsed.title}" (quality: ${parsed.analysis.qualityScore}/10)`);

  return parsed;
}

export default { analyzeVideo };
