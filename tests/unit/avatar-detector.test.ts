/**
 * Unit tests — AvatarDetector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AvatarDetector } from '../../src/offscreen/avatar-detector';
import type { FaceMesh } from '../../src/shared/types';
import { LOOP_DETECT_WINDOW } from '../../src/shared/constants';

const PARTICIPANT = 'p1';

function makeMesh(scale = 1, noise = 0): FaceMesh {
  return Array.from({ length: 468 }, (_, i) => ({
    x: i * 0.5 * scale + (Math.random() - 0.5) * noise,
    y: i * 0.3 * scale + (Math.random() - 0.5) * noise,
    z: 0,
  }));
}

function makeImageData(variance = 100): ImageData {
  const data = new Uint8ClampedArray(4 * 32 * 32);
  for (let i = 0; i < data.length; i += 4) {
    const base = 128;
    const v = base + (Math.random() - 0.5) * variance;
    data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v));
    data[i + 3] = 255;
  }
  return new ImageData(data, 32, 32);
}

describe('AvatarDetector', () => {
  let detector: AvatarDetector;

  beforeEach(() => { detector = new AvatarDetector(); });

  it('returns low risk for natural, varied frames', () => {
    const mesh = makeMesh(1, 5);
    const imgData = makeImageData(100); // high texture variance
    const result = detector.analyze(PARTICIPANT, imgData, mesh, 8);
    // Shouldn't flag as high risk for a normal participant
    expect(result.avatarRiskScore).toBeLessThan(0.5);
  });

  it('flags overly_smooth_motion for near-zero jitter', () => {
    const mesh = makeMesh(1, 0);
    const imgData = makeImageData(100);
    const result = detector.analyze(PARTICIPANT, imgData, mesh, 0.0001);
    expect(result.flags.overly_smooth_motion).toBe(true);
  });

  it('detects video loop after LOOP_DETECT_WINDOW identical frames', () => {
    const staticMesh = makeMesh(1, 0);
    const staticImg  = makeImageData(0); // zero variance

    // Feed identical frames enough times to trigger loop detection
    for (let i = 0; i <= LOOP_DETECT_WINDOW + 1; i++) {
      detector.analyze(PARTICIPANT, staticImg, staticMesh, 0);
    }
    const result = detector.analyze(PARTICIPANT, staticImg, staticMesh, 0);
    expect(result.flags.video_loop_detected).toBe(true);
  });

  it('flags texture_uniformity for GAN-smooth face (very low variance)', () => {
    const mesh = makeMesh(1, 0);
    const uniformImg = makeImageData(0); // zero variance = perfectly uniform
    const result = detector.analyze(PARTICIPANT, uniformImg, mesh, 5);
    expect(result.flags.texture_uniformity).toBe(true);
  });

  it('risk score is in [0, 1]', () => {
    for (let i = 0; i < 10; i++) {
      const result = detector.analyze(
        PARTICIPANT,
        makeImageData(Math.random() * 200),
        makeMesh(1, Math.random() * 10),
        Math.random() * 20,
      );
      expect(result.avatarRiskScore).toBeGreaterThanOrEqual(0);
      expect(result.avatarRiskScore).toBeLessThanOrEqual(1);
    }
  });

  it('clearParticipant resets state', () => {
    const mesh = makeMesh(1, 0);
    for (let i = 0; i <= LOOP_DETECT_WINDOW + 2; i++) {
      detector.analyze(PARTICIPANT, makeImageData(0), mesh, 0);
    }
    detector.clearParticipant(PARTICIPANT);
    // After reset, loop should not be detected on first frame
    const result = detector.analyze(PARTICIPANT, makeImageData(0), mesh, 0);
    expect(result.flags.video_loop_detected).toBe(false);
  });
});
