/**
 * DeepGuard — Temporal Analyzer
 *
 * Maintains a rolling buffer of face meshes per participant and computes:
 *  - Landmark jitter (frame-to-frame motion magnitude)
 *  - Warp score (sudden non-rigid deformations)
 *  - Lighting delta (inter-frame luminance changes)
 *  - Overall temporal consistency score
 */

import {
  TEMPORAL_BUFFER_SIZE,
  SMOOTH_MOTION_THRESHOLD,
} from '../shared/constants';
import type { FaceMesh, TemporalAnalysisResult, ParticipantId } from '../shared/types';

interface FrameSnapshot {
  mesh: FaceMesh;
  avgLuminance: number;
  timestamp: number;
}

export class TemporalAnalyzer {
  /** Per-participant rolling frame buffer */
  private buffers = new Map<ParticipantId, FrameSnapshot[]>();

  /**
   * Add a new frame snapshot and compute temporal metrics.
   */
  analyze(
    participantId: ParticipantId,
    mesh: FaceMesh,
    imageData: ImageData,
    timestamp: number,
  ): TemporalAnalysisResult {
    const avgLuminance = computeAverageLuminance(imageData);
    const snapshot: FrameSnapshot = { mesh, avgLuminance, timestamp };

    // Update buffer
    if (!this.buffers.has(participantId)) {
      this.buffers.set(participantId, []);
    }
    const buffer = this.buffers.get(participantId)!;
    buffer.push(snapshot);
    if (buffer.length > TEMPORAL_BUFFER_SIZE) buffer.shift();

    // Need at least 2 frames for temporal analysis
    if (buffer.length < 2) {
      return this.defaultResult(buffer.length);
    }

    const jitterScore   = this.computeJitter(buffer);
    const warpScore     = this.computeWarpScore(buffer);
    const lightingDelta = this.computeLightingDelta(buffer);

    // Temporal consistency: high jitter = low consistency (real humans have moderate jitter)
    // Suspiciously smooth (jitter < threshold) or very erratic are both penalised
    const consistencyFromJitter = this.jitterToConsistency(jitterScore);
    const consistencyFromWarp   = Math.max(0, 1 - warpScore * 2);
    const consistencyFromLight  = Math.max(0, 1 - Math.min(1, lightingDelta / 100));

    const temporalConsistency = (
      consistencyFromJitter * 0.5 +
      consistencyFromWarp   * 0.3 +
      consistencyFromLight  * 0.2
    );

    return {
      temporalConsistency: Math.max(0, Math.min(1, temporalConsistency)),
      jitterScore,
      warpScore,
      lightingDelta,
      frameCount: buffer.length,
    };
  }

  /**
   * Compute mean landmark displacement between consecutive frames.
   */
  private computeJitter(buffer: FrameSnapshot[]): number {
    const prev = buffer[buffer.length - 2];
    const curr = buffer[buffer.length - 1];

    if (prev.mesh.length !== curr.mesh.length) return 0;

    let totalDist = 0;
    const n = prev.mesh.length;

    for (let i = 0; i < n; i++) {
      const dx = curr.mesh[i].x - prev.mesh[i].x;
      const dy = curr.mesh[i].y - prev.mesh[i].y;
      totalDist += Math.sqrt(dx * dx + dy * dy);
    }

    return totalDist / n; // mean displacement in pixels
  }

  /**
   * Detect non-rigid warping: variance in per-landmark displacement vectors.
   * High variance → localised warping → potential face-swap artifact.
   */
  private computeWarpScore(buffer: FrameSnapshot[]): number {
    const prev = buffer[buffer.length - 2];
    const curr = buffer[buffer.length - 1];

    if (prev.mesh.length !== curr.mesh.length) return 0;

    const displacements: number[] = [];
    for (let i = 0; i < prev.mesh.length; i++) {
      const dx = curr.mesh[i].x - prev.mesh[i].x;
      const dy = curr.mesh[i].y - prev.mesh[i].y;
      displacements.push(Math.sqrt(dx * dx + dy * dy));
    }

    const mean = displacements.reduce((a, b) => a + b, 0) / displacements.length;
    const variance = displacements.reduce((sum, d) => sum + (d - mean) ** 2, 0)
      / displacements.length;

    // Normalise: variance > 100 → warp score ≈ 1
    return Math.min(1, Math.sqrt(variance) / 10);
  }

  /**
   * Luminance delta between consecutive frames.
   */
  private computeLightingDelta(buffer: FrameSnapshot[]): number {
    const prev = buffer[buffer.length - 2];
    const curr = buffer[buffer.length - 1];
    return Math.abs(curr.avgLuminance - prev.avgLuminance);
  }

  /**
   * Convert jitter magnitude to a consistency score.
   * Real humans: moderate jitter (3–30 px at typical video resolution).
   * Synthetic: either suspiciously smooth (< 1 px) or erratic (> 50 px).
   */
  private jitterToConsistency(jitter: number): number {
    if (jitter < SMOOTH_MOTION_THRESHOLD) {
      // Suspiciously smooth — likely synthetic
      return 0.3;
    } else if (jitter < 2) {
      return 0.7;
    } else if (jitter < 20) {
      // Natural motion range
      return 1.0;
    } else if (jitter < 40) {
      // Getting erratic
      return 0.8;
    } else {
      // Very erratic
      return 0.4;
    }
  }

  private defaultResult(frameCount: number): TemporalAnalysisResult {
    return {
      temporalConsistency: 0.8, // assume OK until we have data
      jitterScore: 0,
      warpScore: 0,
      lightingDelta: 0,
      frameCount,
    };
  }

  clearParticipant(participantId: ParticipantId): void {
    this.buffers.delete(participantId);
  }

  clearAll(): void {
    this.buffers.clear();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeAverageLuminance(imageData: ImageData): number {
  const { data, width, height } = imageData;
  let total = 0;
  const step = 4; // sample every pixel
  let count = 0;

  for (let i = 0; i < data.length; i += step * 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // ITU-R BT.601 luminance
    total += 0.299 * r + 0.587 * g + 0.114 * b;
    count++;
  }

  return count > 0 ? total / count : 0;
}
