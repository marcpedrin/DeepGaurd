/**
 * DeepGuard — Trust Scorer
 *
 * Combines all sub-detector results into a final weighted trust score
 * and maps it to a human-readable status.
 */

import { TRUST_WEIGHTS, STATUS_THRESHOLDS } from '../shared/constants';
import type {
  DeepfakeClassifierResult,
  TemporalAnalysisResult,
  LipSyncResult,
  AvatarDetectionResult,
  TrustReport,
  TrustScores,
  ParticipantStatus,
  ParticipantId,
} from '../shared/types';

export class TrustScorer {
  /**
   * Compute the final trust report from all sub-scores.
   *
   * All sub-scores are in [0, 1] where:
   *   - faceAuthenticity: 0 = definitely fake, 1 = definitely real
   *   - temporalConsistency: 0 = unstable, 1 = consistent
   *   - lipSync: 0 = mismatch, 1 = perfect sync
   *   - avatarRisk: 0 = no avatar flags, 1 = all flags set
   */
  score(
    participantId: ParticipantId,
    frameIndex: number,
    timestamp: number,
    classifier: DeepfakeClassifierResult,
    temporal: TemporalAnalysisResult,
    lipSync: LipSyncResult,
    avatar: AvatarDetectionResult,
    faceDetected: boolean,
    latencyMs: number,
  ): TrustReport {

    // Convert all sub-scores to 0–100 scale
    const faceAuthenticity     = (1 - classifier.deepfakeConfidence) * 100;
    const temporalConsistency  = temporal.temporalConsistency * 100;
    const lipSyncScore         = lipSync.lipSyncConfidence * 100;
    const avatarRiskPenalty    = avatar.avatarRiskScore * 100;
    // Avatar risk is inverted: low avatarRisk → high trust contribution
    const avatarTrustComponent = 100 - avatarRiskPenalty;

    const scores: TrustScores = {
      faceAuthenticity:    Math.round(Math.max(0, Math.min(100, faceAuthenticity))),
      temporalConsistency: Math.round(Math.max(0, Math.min(100, temporalConsistency))),
      lipSync:             Math.round(Math.max(0, Math.min(100, lipSyncScore))),
      avatarRisk:          Math.round(Math.max(0, Math.min(100, avatarTrustComponent))),
    };

    // Weighted ensemble
    const raw =
      scores.faceAuthenticity    * TRUST_WEIGHTS.faceAuthenticity +
      scores.temporalConsistency * TRUST_WEIGHTS.temporalConsistency +
      scores.lipSync             * TRUST_WEIGHTS.lipSync +
      scores.avatarRisk          * TRUST_WEIGHTS.avatarRisk;

    const overallTrustScore = Math.round(Math.max(0, Math.min(100, raw)));

    // If no face detected, mark as NO_FACE and give neutral score
    if (!faceDetected) {
      return {
        participantId,
        timestamp,
        frameIndex,
        scores,
        overallTrustScore: 50,
        status: 'NO_FACE',
        avatarFlags: avatar.flags,
        faceDetected: false,
        analysisLatencyMs: latencyMs,
      };
    }

    const status = this.scoreToStatus(overallTrustScore);

    return {
      participantId,
      timestamp,
      frameIndex,
      scores,
      overallTrustScore,
      status,
      avatarFlags: avatar.flags,
      faceDetected: true,
      analysisLatencyMs: latencyMs,
    };
  }

  private scoreToStatus(score: number): ParticipantStatus {
    if (score >= STATUS_THRESHOLDS.REAL)        return 'REAL';
    if (score >= STATUS_THRESHOLDS.SUSPICIOUS)  return 'SUSPICIOUS';
    return 'LIKELY_SYNTHETIC';
  }
}
