/**
 * Integration tests — Full inference pipeline
 * Tests the complete chain: InferenceEngine.analyzeFrame() → TrustReport
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// ─── Mock MediaPipe (dynamic import, loaded lazily) ───────────────────────────
vi.mock('@mediapipe/tasks-vision', () => {
  const FaceLandmarker = {
    createFromOptions: vi.fn().mockResolvedValue({
      detect: vi.fn().mockImplementation((imageData: ImageData) => ({
        faceLandmarks: [
          // 478 normalised landmarks
          Array.from({ length: 478 }, (_, i) => ({
            x: 0.3 + (i % 22) * 0.018,
            y: 0.2 + Math.floor(i / 22) * 0.02,
            z: 0,
          })),
        ],
        faceBlendshapes: [{
          categories: [
            { categoryName: 'jawOpen',      score: 0.1 },
            { categoryName: 'eyeBlinkLeft', score: 0.05 },
            { categoryName: 'eyeBlinkRight', score: 0.05 },
          ],
        }],
      })),
      close: vi.fn(),
    }),
  };

  const FilesetResolver = {
    forVisionTasks: vi.fn().mockResolvedValue({}),
  };

  return { FaceLandmarker, FilesetResolver };
});

// ─── Mock ONNX Runtime (deepfake classifier) ──────────────────────────────────
vi.mock('onnxruntime-web', () => {
  class Tensor {
    type: string; data: Float32Array; dims: number[];
    constructor(type: string, data: Float32Array, dims: number[]) {
      this.type = type; this.data = data; this.dims = dims;
    }
    dispose() {}
  }

  const InferenceSession = {
    create: vi.fn().mockResolvedValue({
      inputNames:  ['pixel_values'],
      outputNames: ['logits'],
      run: vi.fn().mockResolvedValue({
        logits: new Tensor('float32', new Float32Array([0.3, 0.7]), [1, 2]),
      }),
    }),
  };

  return {
    default: { env: { wasm: { wasmPaths: '', numThreads: 1, proxy: false } }, InferenceSession, Tensor },
    InferenceSession,
    Tensor,
    env: { wasm: { wasmPaths: '', numThreads: 1, proxy: false } },
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

import { InferenceEngine } from '../../src/offscreen/inference-engine';
import type { FrameData } from '../../src/shared/types';

function makeFrameData(participantId = 'p1', frameIndex = 1): FrameData {
  const width = 64, height = 64;
  // Fill with skin-tone pixels so heuristic face detection triggers
  const data = new Uint8ClampedArray(4 * width * height);
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = 180 + Math.random() * 40;  // R — warm skin tone
    data[i + 1] = 110 + Math.random() * 40;  // G
    data[i + 2] =  80 + Math.random() * 30;  // B
    data[i + 3] = 255;
  }
  return {
    participantId,
    imageData: new ImageData(data, width, height),
    width,
    height,
    timestamp: Date.now(),
    frameIndex,
  };
}

describe('InferenceEngine — full pipeline', () => {
  let engine: InferenceEngine;

  beforeAll(async () => {
    engine = new InferenceEngine();
    await engine.initialize();
  });

  it('analyzeFrame returns a valid TrustReport', async () => {
    const frame  = makeFrameData();
    const report = await engine.analyzeFrame(frame);

    expect(report).toBeDefined();
    expect(report.participantId).toBe('p1');
    expect(report.overallTrustScore).toBeGreaterThanOrEqual(0);
    expect(report.overallTrustScore).toBeLessThanOrEqual(100);
    expect(['REAL', 'SUSPICIOUS', 'LIKELY_SYNTHETIC', 'ANALYZING', 'NO_FACE'])
      .toContain(report.status);
  });

  it('all sub-scores are 0–100', async () => {
    const report = await engine.analyzeFrame(makeFrameData());
    const { scores } = report;
    [scores.faceAuthenticity, scores.temporalConsistency, scores.lipSync, scores.avatarRisk].forEach(
      (s) => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    );
  });

  it('handles multiple participants independently', async () => {
    const [r1, r2] = await Promise.all([
      engine.analyzeFrame(makeFrameData('participant-A', 1)),
      engine.analyzeFrame(makeFrameData('participant-B', 1)),
    ]);
    expect(r1.participantId).toBe('participant-A');
    expect(r2.participantId).toBe('participant-B');
  });

  it('records analysis latency', async () => {
    const report = await engine.analyzeFrame(makeFrameData());
    expect(report.analysisLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('updateAudioLevel does not throw', () => {
    expect(() => engine.updateAudioLevel('p1', 0.05)).not.toThrow();
  });

  it('clearParticipant does not throw', () => {
    expect(() => engine.clearParticipant('p1')).not.toThrow();
  });

  it('processes 10 participants in reasonable time', async () => {
    const ids   = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const start = performance.now();
    await Promise.all(ids.map((id) => engine.analyzeFrame(makeFrameData(id))));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10_000); // DCT analysis adds some time
  });
});
