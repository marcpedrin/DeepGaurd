/**
 * DeepGuard — Face Detector (MediaPipe FaceLandmarker)
 *
 * Uses @mediapipe/tasks-vision FaceLandmarker for real 478-point 3D face
 * landmark detection. Model file: src/models/face_landmarker.task (~14 MB).
 *
 * Falls back to a lightweight heuristic bounding-box detector when the model
 * file is absent (development / first-run before setup).
 */

import { LANDMARK_INDICES } from '../shared/constants';
import type {
  FaceDetectionResult,
  FaceMesh,
  BoundingBox,
  FaceLandmark,
} from '../shared/types';

// ─── Types from @mediapipe/tasks-vision (imported lazily) ─────────────────────

type FaceLandmarkerInstance = {
  detect(imageData: ImageData): {
    faceLandmarks: Array<Array<{ x: number; y: number; z: number }>>;
    faceBlendshapes?: Array<{ categories: Array<{ categoryName: string; score: number }> }>;
  };
  close(): void;
};

// ─── State ────────────────────────────────────────────────────────────────────

let landmarker: FaceLandmarkerInstance | null = null;
let initState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
let initPromise: Promise<void> | null = null;

// ─── Exported class ───────────────────────────────────────────────────────────

export class FaceDetector {
  private canvas: OffscreenCanvas;

  constructor() {
    this.canvas = new OffscreenCanvas(192, 192);
    // ctx is used only transiently in detectWithMediaPipe — keep canvas for reuse
    this.canvas.getContext('2d');
  }

  async initialize(): Promise<void> {
    if (initState === 'ready') return;
    if (initState === 'loading') return initPromise!;

    initState = 'loading';
    initPromise = loadMediaPipe();
    await initPromise;

    console.log(
      (initState as string) === 'ready'
        ? '[FaceDetector] MediaPipe FaceLandmarker ready (478 landmarks)'
        : '[FaceDetector] MediaPipe unavailable — using heuristic fallback'
    );
  }

  async detect(imageData: ImageData): Promise<FaceDetectionResult> {
    // ── MediaPipe path ─────────────────────────────────────────────────────
    if (initState === 'ready' && landmarker) {
      try {
        return this.detectWithMediaPipe(imageData);
      } catch (err) {
        console.warn('[FaceDetector] MediaPipe inference error:', err);
      }
    }

    // ── Fallback heuristic ─────────────────────────────────────────────────
    return this.detectHeuristic(imageData);
  }

  // ─── MediaPipe inference ──────────────────────────────────────────────────

  private detectWithMediaPipe(imageData: ImageData): FaceDetectionResult {
    const result = landmarker!.detect(imageData);

    if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
      return this.noFaceResult();
    }

    // Convert normalised [0-1] landmarks to pixel coordinates
    const raw = result.faceLandmarks[0];
    const mesh: FaceMesh = raw.map((lm) => ({
      x: lm.x * imageData.width,
      y: lm.y * imageData.height,
      z: lm.z,
    }));

    // Extract blendshapes for mouth / eye ratios if available
    let mouthOpenRatio = 0;
    let eyeBlinkLeft = 0;
    let eyeBlinkRight = 0;

    if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
      const bs = result.faceBlendshapes[0].categories;
      const get = (name: string) =>
        bs.find((c) => c.categoryName === name)?.score ?? 0;

      mouthOpenRatio = get('jawOpen');
      eyeBlinkLeft   = 1 - get('eyeBlinkLeft');   // 0=closed, 1=open
      eyeBlinkRight  = 1 - get('eyeBlinkRight');
    } else {
      // Fall back to geometric computation from landmarks
      mouthOpenRatio = this.computeMouthOpenRatio(mesh);
      ({ eyeBlinkLeft, eyeBlinkRight } = this.computeEyeBlinks(mesh));
    }

    const boundingBox = computeBoundingBox(mesh, 0.99);

    return {
      detected: true,
      boundingBox,
      mesh,
      mouthOpenRatio,
      eyeBlinkLeft,
      eyeBlinkRight,
    };
  }

  // ─── Heuristic fallback ───────────────────────────────────────────────────
  /**
   * When MediaPipe isn't available, use skin-tone colour heuristics + a
   * synthetic 5-point "mesh" to keep the rest of the pipeline running.
   */
  private detectHeuristic(imageData: ImageData): FaceDetectionResult {
    const { data, width, height } = imageData;

    let skinPixels = 0;
    let sumX = 0, sumY = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;

    const step = 4; // sample every 4th pixel
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const idx = (y * width + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];

        // Simple YCrCb skin segmentation (works without models)
        const yy =  0.299 * r + 0.587 * g + 0.114 * b;
        const cr = (r - yy) * 0.713 + 128;
        const cb = (b - yy) * 0.564 + 128;

        if (
          yy > 80 && yy < 230 &&
          cr >= 133 && cr <= 173 &&
          cb >= 77  && cb <= 127
        ) {
          skinPixels++;
          sumX += x; sumY += y;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    const totalSampled = (width / step) * (height / step);
    const skinRatio = skinPixels / totalSampled;

    if (skinRatio < 0.03 || skinPixels < 20) {
      return this.noFaceResult();
    }

    const cx = sumX / skinPixels;
    const cy = sumY / skinPixels;
    const faceW = Math.max(20, maxX - minX);
    const faceH = Math.max(20, maxY - minY);

    // Build a minimal synthetic 5-point "mesh" (eyes, nose, mouth corners, chin)
    const syntheticMesh = buildSyntheticMesh(cx, cy, faceW, faceH);

    const boundingBox: BoundingBox = {
      x: minX, y: minY,
      width: faceW, height: faceH,
      confidence: Math.min(1, skinRatio * 5),
    };

    return {
      detected: true,
      boundingBox,
      mesh: syntheticMesh,
      mouthOpenRatio: 0,
      eyeBlinkLeft: 0.5,
      eyeBlinkRight: 0.5,
    };
  }

  // ─── Geometric landmark computations ──────────────────────────────────────

  private computeMouthOpenRatio(mesh: FaceMesh): number {
    const upperLip = mesh[LANDMARK_INDICES.UPPER_LIP_TOP];
    const lowerLip = mesh[LANDMARK_INDICES.LOWER_LIP_BOTTOM];
    const mouthLeft  = mesh[LANDMARK_INDICES.MOUTH_LEFT];
    const mouthRight = mesh[LANDMARK_INDICES.MOUTH_RIGHT];

    if (!upperLip || !lowerLip || !mouthLeft || !mouthRight) return 0;

    const vertDist  = Math.abs(lowerLip.y - upperLip.y);
    const horizDist = Math.abs(mouthRight.x - mouthLeft.x);

    return horizDist > 0 ? Math.min(1, vertDist / horizDist) : 0;
  }

  private computeEyeBlinks(mesh: FaceMesh): { eyeBlinkLeft: number; eyeBlinkRight: number } {
    const leftTop     = mesh[LANDMARK_INDICES.LEFT_EYE_TOP];
    const leftBottom  = mesh[LANDMARK_INDICES.LEFT_EYE_BOTTOM];
    const rightTop    = mesh[LANDMARK_INDICES.RIGHT_EYE_TOP];
    const rightBottom = mesh[LANDMARK_INDICES.RIGHT_EYE_BOTTOM];

    if (!leftTop || !leftBottom || !rightTop || !rightBottom) {
      return { eyeBlinkLeft: 0.5, eyeBlinkRight: 0.5 };
    }

    const leftH  = Math.abs(leftBottom.y  - leftTop.y);
    const rightH = Math.abs(rightBottom.y - rightTop.y);
    const refW   = 30;  // approximate eye width in pixels at typical video size

    return {
      eyeBlinkLeft:  Math.min(1, leftH  / refW),
      eyeBlinkRight: Math.min(1, rightH / refW),
    };
  }

  private noFaceResult(): FaceDetectionResult {
    return {
      detected: false,
      boundingBox: null,
      mesh: null,
      mouthOpenRatio: 0,
      eyeBlinkLeft: 0,
      eyeBlinkRight: 0,
    };
  }
}

// ─── MediaPipe loader ─────────────────────────────────────────────────────────

async function loadMediaPipe(): Promise<void> {
  try {
    const { FaceLandmarker, FilesetResolver } = await import(
      /* @vite-ignore */ '@mediapipe/tasks-vision'
    );

    // Point FilesetResolver at the locally bundled WASM files
    const wasmBase = chrome.runtime.getURL('mediapipe/');
    const vision   = await FilesetResolver.forVisionTasks(wasmBase);

    const modelPath = chrome.runtime.getURL('models/face_landmarker.task');

    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelPath,
        delegate: 'CPU',  // GPU crashes in offscreen docs on some systems
      },
      numFaces:              1,
      runningMode:           'IMAGE',
      outputFaceBlendshapes: true,
    });

    initState = 'ready';
  } catch (err) {
    console.warn('[FaceDetector] Could not load MediaPipe:', err);
    initState = 'failed';
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function computeBoundingBox(mesh: FaceMesh, confidence: number): BoundingBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const lm of mesh) {
    if (lm.x < minX) minX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y > maxY) maxY = lm.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, confidence };
}

/**
 * Builds a minimal synthetic FaceMesh of exactly 478 placeholder landmarks
 * so that the downstream pipeline can operate without the full MediaPipe model.
 * The 5 key geometric points are set from the face centroid; the rest are
 * filled with plausible positions inside the face box.
 */
function buildSyntheticMesh(cx: number, cy: number, fw: number, fh: number): FaceMesh {
  const mesh: FaceMesh = [];

  // Fill 478 landmarks with interpolated positions inside the face bounding box
  for (let i = 0; i < 478; i++) {
    mesh.push({ x: cx + (Math.random() - 0.5) * fw, y: cy + (Math.random() - 0.5) * fh, z: 0 });
  }

  // Override the key anatomical indices (MediaPipe 478-point map)
  const eyeY   = cy - fh * 0.15;
  const mouthY = cy + fh * 0.25;
  const eyeOff = fw * 0.20;

  mesh[LANDMARK_INDICES.LEFT_EYE_TOP]     = { x: cx - eyeOff, y: eyeY - 5,  z: 0 };
  mesh[LANDMARK_INDICES.LEFT_EYE_BOTTOM]  = { x: cx - eyeOff, y: eyeY + 5,  z: 0 };
  mesh[LANDMARK_INDICES.RIGHT_EYE_TOP]    = { x: cx + eyeOff, y: eyeY - 5,  z: 0 };
  mesh[LANDMARK_INDICES.RIGHT_EYE_BOTTOM] = { x: cx + eyeOff, y: eyeY + 5,  z: 0 };
  mesh[LANDMARK_INDICES.UPPER_LIP_TOP]    = { x: cx,           y: mouthY - 5, z: 0 };
  mesh[LANDMARK_INDICES.LOWER_LIP_BOTTOM] = { x: cx,           y: mouthY + 10, z: 0 };
  mesh[LANDMARK_INDICES.MOUTH_LEFT]       = { x: cx - fw * 0.15, y: mouthY, z: 0 };
  mesh[LANDMARK_INDICES.MOUTH_RIGHT]      = { x: cx + fw * 0.15, y: mouthY, z: 0 };
  mesh[LANDMARK_INDICES.NOSE_TIP]         = { x: cx, y: cy - fh * 0.05, z: 0 };
  mesh[LANDMARK_INDICES.CHIN]             = { x: cx, y: cy + fh * 0.40, z: 0 };

  return mesh;
}

// ─── Exported utilities ───────────────────────────────────────────────────────

export function cropFaceRegion(
  imageData: ImageData,
  bbox: BoundingBox,
  padding = 0.2,
): ImageData | null {
  const { width: imgW, height: imgH, data } = imageData;

  const padX = bbox.width  * padding;
  const padY = bbox.height * padding;

  const x = Math.max(0, Math.floor(bbox.x - padX));
  const y = Math.max(0, Math.floor(bbox.y - padY));
  const w = Math.min(imgW - x, Math.ceil(bbox.width  + 2 * padX));
  const h = Math.min(imgH - y, Math.ceil(bbox.height + 2 * padY));

  if (w <= 0 || h <= 0) return null;

  const cropped = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const srcIdx = ((y + row) * imgW + (x + col)) * 4;
      const dstIdx = (row * w + col) * 4;
      cropped[dstIdx]     = data[srcIdx];
      cropped[dstIdx + 1] = data[srcIdx + 1];
      cropped[dstIdx + 2] = data[srcIdx + 2];
      cropped[dstIdx + 3] = data[srcIdx + 3];
    }
  }

  return new ImageData(cropped, w, h);
}

export function landmarkDistance(a: FaceLandmark, b: FaceLandmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}
