/**
 * DeepGuard — AI Avatar Detector
 *
 * Heuristic rule engine that detects signatures of:
 *  - Synthesia / HeyGen / talking-head avatars
 *  - Real-time face-swap tools (DeepFaceLive, etc.)
 *  - Replayed video loops
 *  - GAN over-smoothing artifacts
 */

import {
  LOOP_DETECT_WINDOW,
  LOOP_SIMILARITY_THRESHOLD,
  SMOOTH_MOTION_THRESHOLD,
  TEXTURE_VARIANCE_THRESHOLD,
  STATIC_BG_FRAME_THRESHOLD,
  EDGE_ARTIFACT_GRADIENT_THRESHOLD,
} from '../shared/constants';
import type {
  AvatarDetectionResult,
  AvatarFlags,
  FaceMesh,
  ParticipantId,
} from '../shared/types';

interface FrameFingerprint {
  pixelHash: number;
  bgHash: number;
  meshVector: Float32Array;
  jitter: number;
}

export class AvatarDetector {
  /** Rolling history of frame fingerprints per participant */
  private history = new Map<ParticipantId, FrameFingerprint[]>();
  private staticBgCounters = new Map<ParticipantId, number>();
  private prevBgHashes = new Map<ParticipantId, number>();

  analyze(
    participantId: ParticipantId,
    imageData: ImageData,
    mesh: FaceMesh | null,
    jitter: number,
  ): AvatarDetectionResult {
    const fingerprint = this.computeFingerprint(imageData, mesh, jitter);

    if (!this.history.has(participantId)) {
      this.history.set(participantId, []);
    }
    const buffer = this.history.get(participantId)!;
    buffer.push(fingerprint);
    if (buffer.length > LOOP_DETECT_WINDOW + 2) buffer.shift();

    const flags: AvatarFlags = {
      overly_smooth_motion: this.detectOverlySmoothMotion(jitter, mesh),
      video_loop_detected:  this.detectVideoLoop(buffer),
      texture_uniformity:   this.detectTextureUniformity(imageData, mesh),
      edge_artifact:        this.detectEdgeArtifacts(imageData, mesh),
      static_background:    this.detectStaticBackground(participantId, fingerprint.bgHash, mesh),
    };

    const avatarRiskScore = this.computeRiskScore(flags);

    return { avatarRiskScore, flags };
  }

  /**
   * Suspiciously smooth motion: jitter < threshold AND face detected.
   * Real humans always have micro-movements; perfect stillness = synthetic.
   */
  private detectOverlySmoothMotion(jitter: number, mesh: FaceMesh | null): boolean {
    if (!mesh) return false;
    return jitter >= 0 && jitter < SMOOTH_MOTION_THRESHOLD;
  }

  /**
   * Video loop detection: compare current frame fingerprint to one
   * LOOP_DETECT_WINDOW frames ago using cosine similarity.
   */
  private detectVideoLoop(buffer: FrameFingerprint[]): boolean {
    if (buffer.length < LOOP_DETECT_WINDOW + 1) return false;

    const curr = buffer[buffer.length - 1];
    const past = buffer[buffer.length - 1 - LOOP_DETECT_WINDOW];

    const similarity = cosineSimilarity(curr.meshVector, past.meshVector);
    return similarity > LOOP_SIMILARITY_THRESHOLD;
  }

  /**
   * GAN over-smoothing: compute pixel intensity variance in face crop.
   * GAN-generated faces are unnaturally smooth (low texture variance).
   */
  private detectTextureUniformity(imageData: ImageData, mesh: FaceMesh | null): boolean {
    if (!mesh) return false;

    const { data, width } = imageData;
    // Sample a 32×32 patch around nose tip (index 4)
    const noseTip = mesh[4];
    if (!noseTip) return false;

    const cx = Math.round(noseTip.x);
    const cy = Math.round(noseTip.y);
    const patchSize = 16;

    const pixels: number[] = [];
    for (let dy = -patchSize; dy < patchSize; dy++) {
      for (let dx = -patchSize; dx < patchSize; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) continue;
        const idx = (py * width + px) * 4;
        // Luma
        const luma = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        pixels.push(luma);
      }
    }

    if (pixels.length === 0) return false;

    const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    const variance = pixels.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pixels.length;

    return variance < TEXTURE_VARIANCE_THRESHOLD;
  }

  /**
   * Edge artifact detection: look for hard segmentation edges around face boundary.
   * Virtual background / green screen tools often leave compression artifacts.
   */
  private detectEdgeArtifacts(imageData: ImageData, mesh: FaceMesh | null): boolean {
    if (!mesh || mesh.length === 0) return false;

    const { data, width, height } = imageData;

    // Sample points along face outline
    const outlineIndices = [10, 338, 297, 332, 284, 251, 389, 356, 454,
                            323, 361, 288, 397, 365, 379, 378, 400, 377,
                            152, 148, 176, 149, 150, 136, 172, 58, 132,
                            93, 234, 127, 162, 21, 54, 103, 67, 109];

    let highGradientCount = 0;

    for (const idx of outlineIndices) {
      if (idx >= mesh.length) continue;
      const lm = mesh[idx];
      const px = Math.round(lm.x);
      const py = Math.round(lm.y);

      if (px < 1 || py < 1 || px >= width - 1 || py >= height - 1) continue;

      // Sobel gradient magnitude at this landmark
      const gx = this.sobelX(data, width, px, py);
      const gy = this.sobelY(data, width, px, py);
      const magnitude = Math.sqrt(gx * gx + gy * gy);

      if (magnitude > EDGE_ARTIFACT_GRADIENT_THRESHOLD) highGradientCount++;
    }

    // Flag if more than 30% of outline points have high gradient (hard edge)
    return highGradientCount > outlineIndices.length * 0.30;
  }

  private sobelX(data: Uint8ClampedArray, width: number, x: number, y: number): number {
    const luma = (px: number, py: number) => {
      const i = (py * width + px) * 4;
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };
    return (
      -luma(x - 1, y - 1) + luma(x + 1, y - 1) +
      -2 * luma(x - 1, y) + 2 * luma(x + 1, y) +
      -luma(x - 1, y + 1) + luma(x + 1, y + 1)
    );
  }

  private sobelY(data: Uint8ClampedArray, width: number, x: number, y: number): number {
    const luma = (px: number, py: number) => {
      const i = (py * width + px) * 4;
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };
    return (
      -luma(x - 1, y - 1) - 2 * luma(x, y - 1) - luma(x + 1, y - 1) +
       luma(x - 1, y + 1) + 2 * luma(x, y + 1) + luma(x + 1, y + 1)
    );
  }

  /**
   * Static background: if background region pixel hash is identical across
   * N frames while the face is moving, it's a virtual camera / loop.
   */
  private detectStaticBackground(
    participantId: ParticipantId,
    bgHash: number,
    mesh: FaceMesh | null,
  ): boolean {
    if (!mesh) return false;

    const prevHash = this.prevBgHashes.get(participantId);
    this.prevBgHashes.set(participantId, bgHash);

    if (prevHash === undefined) return false;

    if (bgHash === prevHash) {
      const count = (this.staticBgCounters.get(participantId) ?? 0) + 1;
      this.staticBgCounters.set(participantId, count);
      return count >= STATIC_BG_FRAME_THRESHOLD;
    } else {
      this.staticBgCounters.set(participantId, 0);
      return false;
    }
  }

  private computeFingerprint(
    imageData: ImageData,
    mesh: FaceMesh | null,
    jitter: number,
  ): FrameFingerprint {
    const pixelHash = quickHash(imageData.data, 0, imageData.data.length);
    const bgHash = this.computeBackgroundHash(imageData);
    const meshVector = mesh
      ? meshToVector(mesh)
      : new Float32Array(468 * 3).fill(0);

    return { pixelHash, bgHash, meshVector, jitter };
  }

  /** Hash a corner region (background) of the frame */
  private computeBackgroundHash(imageData: ImageData): number {
    const { data, width } = imageData;
    // Top-left 20×20 corner
    return quickHash(data, 0, Math.min(data.length, 20 * width * 4));
  }

  private computeRiskScore(flags: AvatarFlags): number {
    const weights: Record<keyof AvatarFlags, number> = {
      overly_smooth_motion: 0.25,
      video_loop_detected:  0.35,
      texture_uniformity:   0.20,
      edge_artifact:        0.10,
      static_background:    0.10,
    };

    let score = 0;
    for (const [key, weight] of Object.entries(weights)) {
      if (flags[key as keyof AvatarFlags]) score += weight;
    }

    return Math.min(1, score);
  }

  clearParticipant(participantId: ParticipantId): void {
    this.history.delete(participantId);
    this.staticBgCounters.delete(participantId);
    this.prevBgHashes.delete(participantId);
  }

  clearAll(): void {
    this.history.clear();
    this.staticBgCounters.clear();
    this.prevBgHashes.clear();
  }
}

// ─── Math Utilities ───────────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function meshToVector(mesh: FaceMesh): Float32Array {
  const vec = new Float32Array(mesh.length * 3);
  for (let i = 0; i < mesh.length; i++) {
    vec[i * 3]     = mesh[i].x;
    vec[i * 3 + 1] = mesh[i].y;
    vec[i * 3 + 2] = mesh[i].z;
  }
  return vec;
}

function quickHash(data: Uint8ClampedArray, start: number, end: number): number {
  let hash = 2166136261; // FNV-1a 32-bit offset basis
  const step = Math.max(1, Math.floor((end - start) / 256)); // sample 256 bytes max
  for (let i = start; i < end; i += step) {
    hash ^= data[i];
    hash = (hash * 16777619) >>> 0; // 32-bit multiply
  }
  return hash;
}
