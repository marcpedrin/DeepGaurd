/**
 * Unit tests — TemporalAnalyzer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TemporalAnalyzer } from '../../src/offscreen/temporal-analyzer';
import type { FaceMesh } from '../../src/shared/types';

const PARTICIPANT = 'p1';

function makeMesh(baseX = 0, noise = 0): FaceMesh {
  return Array.from({ length: 468 }, (_, i) => ({
    x: baseX + i * 0.5 + (Math.random() - 0.5) * noise,
    y: i * 0.3        + (Math.random() - 0.5) * noise,
    z: 0,
  }));
}

function makeImageData(luma = 128): ImageData {
  const data = new Uint8ClampedArray(4 * 10 * 10).fill(luma);
  return new ImageData(data, 10, 10);
}

describe('TemporalAnalyzer', () => {
  let analyzer: TemporalAnalyzer;

  beforeEach(() => { analyzer = new TemporalAnalyzer(); });

  it('returns default result when only one frame available', () => {
    const result = analyzer.analyze(PARTICIPANT, makeMesh(0, 2), makeImageData(), Date.now());
    expect(result.temporalConsistency).toBe(0.8);
    expect(result.frameCount).toBe(1);
  });

  it('returns high consistency for stable natural motion (jitter 2–20 px)', () => {
    // Feed 3 frames with moderate natural jitter
    analyzer.analyze(PARTICIPANT, makeMesh(0, 5), makeImageData(), Date.now());
    const r2 = analyzer.analyze(PARTICIPANT, makeMesh(3, 5), makeImageData(), Date.now() + 1000);
    const r3 = analyzer.analyze(PARTICIPANT, makeMesh(6, 5), makeImageData(), Date.now() + 2000);

    expect(r3.temporalConsistency).toBeGreaterThan(0.6);
    expect(r3.frameCount).toBe(3);
  });

  it('penalises suspiciously smooth motion (jitter ≈ 0)', () => {
    const staticMesh = makeMesh(0, 0); // perfectly still
    analyzer.analyze(PARTICIPANT, staticMesh, makeImageData(), Date.now());
    const result = analyzer.analyze(PARTICIPANT, staticMesh, makeImageData(), Date.now() + 1000);
    // Overly smooth → consistency reduced
    expect(result.temporalConsistency).toBeLessThan(0.8);
  });

  it('clearParticipant resets buffer', () => {
    analyzer.analyze(PARTICIPANT, makeMesh(0, 5), makeImageData(), Date.now());
    analyzer.analyze(PARTICIPANT, makeMesh(3, 5), makeImageData(), Date.now() + 1000);
    analyzer.clearParticipant(PARTICIPANT);
    const result = analyzer.analyze(PARTICIPANT, makeMesh(0, 5), makeImageData(), Date.now() + 2000);
    expect(result.frameCount).toBe(1); // buffer was reset
  });

  it('all output values are in [0, 1]', () => {
    for (let i = 0; i < 10; i++) {
      const result = analyzer.analyze(
        PARTICIPANT,
        makeMesh(i * 2, 5 + Math.random() * 20),
        makeImageData(50 + Math.random() * 150),
        Date.now() + i * 1000,
      );
      expect(result.temporalConsistency).toBeGreaterThanOrEqual(0);
      expect(result.temporalConsistency).toBeLessThanOrEqual(1);
      expect(result.warpScore).toBeGreaterThanOrEqual(0);
      expect(result.warpScore).toBeLessThanOrEqual(1);
    }
  });
});
