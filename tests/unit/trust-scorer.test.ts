/**
 * Unit tests — TrustScorer
 */

import { describe, it, expect } from 'vitest';
import { TrustScorer } from '../../src/offscreen/trust-scorer';
import type {
  DeepfakeClassifierResult,
  TemporalAnalysisResult,
  LipSyncResult,
  AvatarDetectionResult,
} from '../../src/shared/types';

const scorer = new TrustScorer();

const PARTICIPANT_ID = 'test-participant';
const TIMESTAMP      = Date.now();
const FRAME_INDEX    = 1;

function makeClassifier(deepfakeConfidence: number): DeepfakeClassifierResult {
  return { deepfakeConfidence, logits: [1 - deepfakeConfidence, deepfakeConfidence] };
}

function makeTemporal(score: number): TemporalAnalysisResult {
  return {
    temporalConsistency: score,
    jitterScore:   5,
    warpScore:     0.1,
    lightingDelta: 10,
    frameCount:    3,
  };
}

function makeLipSync(confidence: number): LipSyncResult {
  return {
    lipSyncConfidence: confidence,
    audioAvailable:    true,
    mouthOpenRatio:    0.1,
    audioRms:          0.05,
  };
}

function makeAvatar(risk: number): AvatarDetectionResult {
  return {
    avatarRiskScore: risk,
    flags: {
      overly_smooth_motion: false,
      video_loop_detected:  false,
      texture_uniformity:   false,
      edge_artifact:        false,
      static_background:    false,
    },
  };
}

describe('TrustScorer — status thresholds', () => {
  it('returns REAL for a perfectly authentic participant', () => {
    const report = scorer.score(
      PARTICIPANT_ID, FRAME_INDEX, TIMESTAMP,
      makeClassifier(0),     // 0% deepfake
      makeTemporal(1),       // 100% temporal
      makeLipSync(1),        // 100% lip sync
      makeAvatar(0),         // 0% avatar risk
      true, 50,
    );
    expect(report.status).toBe('REAL');
    expect(report.overallTrustScore).toBeGreaterThanOrEqual(80);
  });

  it('returns LIKELY_SYNTHETIC for a fully fake participant', () => {
    const report = scorer.score(
      PARTICIPANT_ID, FRAME_INDEX, TIMESTAMP,
      makeClassifier(1),     // 100% deepfake
      makeTemporal(0),       // 0% temporal
      makeLipSync(0),        // 0% lip sync
      makeAvatar(1),         // 100% avatar risk
      true, 50,
    );
    expect(report.status).toBe('LIKELY_SYNTHETIC');
    expect(report.overallTrustScore).toBeLessThan(50);
  });

  it('returns SUSPICIOUS for a mid-range participant', () => {
    const report = scorer.score(
      PARTICIPANT_ID, FRAME_INDEX, TIMESTAMP,
      makeClassifier(0.4),
      makeTemporal(0.6),
      makeLipSync(0.5),
      makeAvatar(0.3),
      true, 50,
    );
    expect(report.status).toBe('SUSPICIOUS');
    expect(report.overallTrustScore).toBeGreaterThanOrEqual(50);
    expect(report.overallTrustScore).toBeLessThan(80);
  });

  it('returns NO_FACE when face is not detected', () => {
    const report = scorer.score(
      PARTICIPANT_ID, FRAME_INDEX, TIMESTAMP,
      makeClassifier(0),
      makeTemporal(1),
      makeLipSync(1),
      makeAvatar(0),
      false, // <-- no face
      50,
    );
    expect(report.status).toBe('NO_FACE');
    expect(report.faceDetected).toBe(false);
    expect(report.overallTrustScore).toBe(50);
  });
});

describe('TrustScorer — score integrity', () => {
  it('overall trust score is always 0–100', () => {
    for (let i = 0; i < 20; i++) {
      const rand = () => Math.random();
      const report = scorer.score(
        PARTICIPANT_ID, i, TIMESTAMP,
        makeClassifier(rand()),
        makeTemporal(rand()),
        makeLipSync(rand()),
        makeAvatar(rand()),
        true, 50,
      );
      expect(report.overallTrustScore).toBeGreaterThanOrEqual(0);
      expect(report.overallTrustScore).toBeLessThanOrEqual(100);
    }
  });

  it('sub-scores are all 0–100', () => {
    const report = scorer.score(
      PARTICIPANT_ID, 1, TIMESTAMP,
      makeClassifier(0.5),
      makeTemporal(0.7),
      makeLipSync(0.8),
      makeAvatar(0.2),
      true, 50,
    );
    const { scores } = report;
    [scores.faceAuthenticity, scores.temporalConsistency, scores.lipSync, scores.avatarRisk].forEach(
      (s) => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    );
  });

  it('latency is recorded correctly', () => {
    const report = scorer.score(
      PARTICIPANT_ID, 1, TIMESTAMP,
      makeClassifier(0), makeTemporal(1), makeLipSync(1), makeAvatar(0), true, 123,
    );
    expect(report.analysisLatencyMs).toBe(123);
  });
});
