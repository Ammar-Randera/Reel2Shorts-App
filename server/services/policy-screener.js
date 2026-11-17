import logger from '../config/logger.js';

/**
 * Screen a video for YouTube policy, copyright, and reused-content risks.
 * STRICT MODE: When in doubt, REJECT.
 *
 * @param {Object} aiAnalysis - The AI analysis result from ai-analyzer
 * @returns {{ approved: boolean, risks: Array, rejectionReasons: string[], overallRisk: string }}
 */
export function screenVideo(aiAnalysis) {
  const risks = [];
  const rejectionReasons = [];

  if (!aiAnalysis || !aiAnalysis.analysis) {
    return {
      approved: false,
      risks: [{ category: 'ANALYSIS', severity: 'critical', detail: 'No AI analysis available' }],
      rejectionReasons: ['Video could not be analyzed'],
      overallRisk: 'critical',
    };
  }

  const { contentFlags = {}, qualityScore = 0 } = aiAnalysis.analysis;

  // ---- 1. COPYRIGHT: Music ----
  if (contentFlags.copyrightedMusic === true) {
    risks.push({
      category: 'COPYRIGHT_MUSIC',
      severity: 'critical',
      detail: 'Copyrighted music detected in the video',
    });
    rejectionReasons.push('Copyrighted music detected');
  } else if (contentFlags.copyrightedMusicConfidence === 'low' || contentFlags.copyrightedMusicConfidence === 'medium') {
    // STRICT: uncertain = reject
    risks.push({
      category: 'COPYRIGHT_MUSIC',
      severity: 'high',
      detail: `Music copyright status uncertain (confidence: ${contentFlags.copyrightedMusicConfidence})`,
    });
    rejectionReasons.push('Unable to confirm music is copyright-free');
  } else {
    risks.push({ category: 'COPYRIGHT_MUSIC', severity: 'low', detail: 'No copyrighted music detected' });
  }

  // ---- 2. COPYRIGHT: Third-party content ----
  if (contentFlags.thirdPartyContent === true) {
    risks.push({
      category: 'THIRD_PARTY_CONTENT',
      severity: 'critical',
      detail: contentFlags.thirdPartyContentDetail || 'Third-party content detected',
    });
    rejectionReasons.push('Third-party content detected: ' + (contentFlags.thirdPartyContentDetail || 'unspecified'));
  } else {
    risks.push({ category: 'THIRD_PARTY_CONTENT', severity: 'low', detail: 'No third-party content detected' });
  }

  // ---- 3. TRADEMARK ----
  if (contentFlags.trademarkedBrands === true) {
    const detail = contentFlags.trademarkedBrandsDetail || 'Prominent trademark/brand usage detected';
    risks.push({
      category: 'TRADEMARK',
      severity: 'high',
      detail,
    });
    rejectionReasons.push('Trademark/brand usage may cause issues: ' + detail);
  } else {
    risks.push({ category: 'TRADEMARK', severity: 'low', detail: 'No trademark concerns' });
  }

  // ---- 4. REUSED CONTENT ----
  if (contentFlags.appearsReused === true) {
    risks.push({
      category: 'REUSED_CONTENT',
      severity: 'critical',
      detail: contentFlags.appearsReusedDetail || 'Content appears to be reused from another creator',
    });
    rejectionReasons.push('Content appears reused: ' + (contentFlags.appearsReusedDetail || 'flagged by AI analysis'));
  } else {
    risks.push({ category: 'REUSED_CONTENT', severity: 'low', detail: 'Content appears original' });
  }

  // ---- 5. COMMUNITY GUIDELINES ----
  if (contentFlags.explicitAdultContent === true) {
    risks.push({ category: 'EXPLICIT_CONTENT', severity: 'critical', detail: 'Explicit/adult content detected' });
    rejectionReasons.push('Explicit or adult content detected');
  }

  if (contentFlags.violence === true) {
    risks.push({ category: 'VIOLENCE', severity: 'critical', detail: 'Violent content detected' });
    rejectionReasons.push('Violent content detected');
  }

  if (contentFlags.hateSpeech === true) {
    risks.push({ category: 'HATE_SPEECH', severity: 'critical', detail: 'Hate speech detected' });
    rejectionReasons.push('Hate speech detected');
  }

  if (contentFlags.misleadingClaims === true) {
    risks.push({ category: 'MISLEADING', severity: 'high', detail: 'Misleading claims detected' });
    rejectionReasons.push('Misleading claims detected');
  }

  // ---- 6. QUALITY ----
  if (qualityScore < 4) {
    risks.push({
      category: 'QUALITY',
      severity: 'high',
      detail: `Quality score ${qualityScore}/10 is below minimum threshold of 4`,
    });
    rejectionReasons.push(`Video quality too low (${qualityScore}/10, minimum is 4)`);
  } else {
    risks.push({ category: 'QUALITY', severity: 'low', detail: `Quality score: ${qualityScore}/10` });
  }

  // ---- Determine overall risk ----
  const severityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
  let maxSeverity = 'low';

  for (const risk of risks) {
    if ((severityOrder[risk.severity] || 0) > (severityOrder[maxSeverity] || 0)) {
      maxSeverity = risk.severity;
    }
  }

  // Map severity to overall risk label
  const overallRisk = maxSeverity === 'low' ? 'safe' : maxSeverity;

  // STRICT MODE: any medium or above risk -> reject
  const approved = rejectionReasons.length === 0 && (maxSeverity === 'low');

  logger.info(`Policy screening: ${approved ? 'APPROVED' : 'REJECTED'} (risk: ${overallRisk}, reasons: ${rejectionReasons.length})`);

  return {
    approved,
    risks,
    rejectionReasons,
    overallRisk,
  };
}

/**
 * Generate a human-readable screening report
 * @param {Object} screeningResult
 * @returns {string}
 */
export function getReadableReport(screeningResult) {
  const lines = [];
  lines.push(`=== Policy Screening Report ===`);
  lines.push(`Status: ${screeningResult.approved ? '✅ APPROVED' : '❌ REJECTED'}`);
  lines.push(`Overall Risk: ${screeningResult.overallRisk.toUpperCase()}`);
  lines.push('');

  if (screeningResult.rejectionReasons.length > 0) {
    lines.push('Rejection Reasons:');
    for (const reason of screeningResult.rejectionReasons) {
      lines.push(`  ⛔ ${reason}`);
    }
    lines.push('');
  }

  lines.push('Risk Assessment:');
  for (const risk of screeningResult.risks) {
    const icon = risk.severity === 'low' ? '✅' :
                 risk.severity === 'medium' ? '⚠️' :
                 risk.severity === 'high' ? '🔶' : '🔴';
    lines.push(`  ${icon} [${risk.severity.toUpperCase()}] ${risk.category}: ${risk.detail}`);
  }

  return lines.join('\n');
}

export default { screenVideo, getReadableReport };
