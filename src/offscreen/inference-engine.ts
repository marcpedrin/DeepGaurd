/**
 * DeepGuard — Inference Engine
 *
 * Orchestrates the full deepfake detection pipeline per frame:
 *  1. Face Detection (face mesh)
 *  2. Deepfake Classification (binary classifier)
 *  3. Temporal Analysis
 *  4. Lip Sync Analysis
 *  5. Avatar Detection
 *  6. Trust Scoring
 */

import { FaceDetector, cropFaceRegion } from './face-detector';
import { DeepfakeClassifier } from './deepfake-classifier';
import { TemporalAnalyzer } from './temporal-analyzer';
import { LipSyncAnalyzer } from './lip-sync-analyzer';
import { AvatarDetector } from './avatar-detector';
import { TrustScorer } from './trust-scorer';
import type { FrameData, TrustReport, ParticipantId } from '../shared/types';

export class InferenceEngine {
  private faceDetector    = new FaceDetector();
  private classifier      = new DeepfakeClassifier();
  private temporalAnalyzer = new TemporalAnalyzer();
  private lipSyncAnalyzer = new LipSyncAnalyzer();
  private avatarDetector  = new AvatarDetector();
  private trustScorer     = new TrustScorer();
  private frameCounters   = new Map<ParticipantId, number>();

  private isInitialized = false;

  async initialize(): Promise<void> {
    console.log('[InferenceEngine] Initializing models...');
    await Promise.all([
      this.faceDetector.initialize(),
      this.classifier.initialize(),
    ]);
    this.isInitialized = true;
    console.log('[InferenceEngine] All models loaded');
  }

  async analyzeFrame(frame: FrameData): Promise<TrustReport> {
    const startTime = performance.now();
    const { participantId, imageData, timestamp, frameIndex } = frame;

    // Track frame counter per participant
    const count = (this.frameCounters.get(participantId) ?? 0) + 1;
    this.frameCounters.set(participantId, count);

    // ── Step 1: Face Detection ─────────────────────────────────────────────
    const faceResult = await this.faceDetector.detect(imageData);

    if (!faceResult.detected || !faceResult.boundingBox || !faceResult.mesh) {
      const latency = performance.now() - startTime;
      // Return a neutral report with NO_FACE status
      return this.trustScorer.score(
        participantId, frameIndex, timestamp,
        { deepfakeConfidence: 0, logits: [1, 0] },
        { temporalConsistency: 0.8, jitterScore: 0, warpScore: 0, lightingDelta: 0, frameCount: count },
        { lipSyncConfidence: 0.75, audioAvailable: false, mouthOpenRatio: 0, audioRms: 0 },
        { avatarRiskScore: 0, flags: { overly_smooth_motion: false, video_loop_detected: false, texture_uniformity: false, edge_artifact: false, static_background: false } },
        false,
        latency,
      );
    }

    // ── Step 2: Crop face region for classifier ────────────────────────────
    const faceCrop = cropFaceRegion(imageData, faceResult.boundingBox) ?? imageData;

    // ── Step 3: Deepfake Classification ────────────────────────────────────
    const classifierResult = await this.classifier.classify(faceCrop);

    // ── Step 4: Temporal Analysis ──────────────────────────────────────────
    const temporalResult = this.temporalAnalyzer.analyze(
      participantId,
      faceResult.mesh,
      imageData,
      timestamp,
    );

    // ── Step 5: Lip Sync Analysis ──────────────────────────────────────────
    const lipSyncResult = this.lipSyncAnalyzer.analyze(
      participantId,
      faceResult.mouthOpenRatio,
      timestamp,
    );

    // ── Step 6: Avatar Detection ───────────────────────────────────────────
    const avatarResult = this.avatarDetector.analyze(
      participantId,
      imageData,
      faceResult.mesh,
      temporalResult.jitterScore,
    );

    // ── Step 7: Trust Scoring ──────────────────────────────────────────────
    const latency = performance.now() - startTime;
    const report = this.trustScorer.score(
      participantId,
      frameIndex,
      timestamp,
      classifierResult,
      temporalResult,
      lipSyncResult,
      avatarResult,
      true,
      latency,
    );

    if (latency > 200) {
      console.warn(`[InferenceEngine] Frame ${frameIndex} latency: ${latency.toFixed(1)}ms (> 200ms target)`);
    }

    return report;
  }

  /** Called when audio level update arrives from content script */
  updateAudioLevel(participantId: ParticipantId, rms: number): void {
    this.lipSyncAnalyzer.updateAudioLevel(participantId, rms);
  }

  clearParticipant(participantId: ParticipantId): void {
    this.temporalAnalyzer.clearParticipant(participantId);
    this.lipSyncAnalyzer.clearParticipant(participantId);
    this.avatarDetector.clearParticipant(participantId);
    this.frameCounters.delete(participantId);
  }
}
