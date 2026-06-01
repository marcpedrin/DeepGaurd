/**
 * DeepGuard — Deepfake Classifier
 *
 * TWO-PATH ARCHITECTURE:
 *
 * Path A (preferred): ONNX neural classifier (deepfake_classifier.onnx)
 *   - dima806/deepfake_vs_real_image_detection: ViT fine-tuned on deepfake faces
 *   - Input: pixel_values [1, 3, 224, 224]  (ViT normalised: mean=0.5, std=0.5)
 *   - Output: logits [1, 2]  (index 0 = Fake, index 1 = Real)
 *   - Download via: python scripts/convert_deepfake_model.py
 *
 * Path B (always runs): DCT frequency-domain GAN artifact analysis
 *   - Real published technique (Wang et al. 2020, Frank et al. 2020)
 *   - GAN / diffusion images have characteristic peaks in DCT spectrum
 *   - No model file needed — pure signal processing
 *   - Combined with: pixel variance, cross-channel correlation, Benford's Law
 *
 * Final confidence = weighted blend of both paths (or Path B alone when no ONNX).
 */

import * as ort from 'onnxruntime-web';
import { loadModel } from '../models/model-loader';
import { CLASSIFIER_INPUT_SIZE } from '../shared/constants';
import type { DeepfakeClassifierResult } from '../shared/types';

// ─── Normalisation constants ───────────────────────────────────────────────────

/** ViT-base normalisation (for dima806 model) */
const VIT_MEAN = [0.5, 0.5, 0.5];
const VIT_STD  = [0.5, 0.5, 0.5];

/** ImageNet normalisation (for EfficientNet-type fallback) */
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD  = [0.229, 0.224, 0.225];

// ─── Classifier ───────────────────────────────────────────────────────────────

export class DeepfakeClassifier {
  private session:    ort.InferenceSession | null = null;
  private inputName:  string = 'pixel_values'; // ViT default; overridden from metadata
  private outputName: string = 'logits';
  private labelFakeIdx = 0;  // index of 'Fake' class in output
  private useViTNorm   = true;

  constructor() {}

  async initialize(): Promise<void> {
    // Load optional metadata sidecar (produced by convert_deepfake_model.py)
    await this.loadMetadata();

    // Attempt to load ONNX model (fails gracefully → Path B only)
    try {
      this.session = await loadModel('DEEPFAKE_CLASSIFIER');
      console.log(`[DeepfakeClassifier] ONNX model loaded (input="${this.inputName}", output="${this.outputName}")`);
    } catch {
      console.log('[DeepfakeClassifier] No ONNX model — using DCT frequency analysis only');
    }
  }

  /**
   * Classify a face crop.
   * Returns deepfakeConfidence ∈ [0, 1] where 1 = certainly synthetic.
   */
  async classify(faceImageData: ImageData): Promise<DeepfakeClassifierResult> {
    // ── Path B: DCT / frequency analysis (always runs) ────────────────────
    const freqScore = computeFrequencyArtifacts(faceImageData);

    // ── Path A: ONNX neural classifier (when model file present) ──────────
    let neuralScore: number | null = null;

    if (this.session) {
      neuralScore = await this.runNeuralClassifier(faceImageData);
    }

    // ── Blend ──────────────────────────────────────────────────────────────
    let deepfakeConfidence: number;

    if (neuralScore !== null) {
      // 60% neural + 40% frequency
      deepfakeConfidence = neuralScore * 0.6 + freqScore * 0.4;
    } else {
      deepfakeConfidence = freqScore;
    }

    deepfakeConfidence = Math.max(0, Math.min(1, deepfakeConfidence));

    return {
      deepfakeConfidence,
      logits: [1 - deepfakeConfidence, deepfakeConfidence],
    };
  }

  // ─── Neural path ─────────────────────────────────────────────────────────

  private async runNeuralClassifier(imageData: ImageData): Promise<number> {
    const tensor = this.preprocess(imageData);

    try {
      const feeds = { [this.inputName]: tensor };
      const results = await this.session!.run(feeds);

      return this.postprocess(results);
    } catch (err) {
      console.warn('[DeepfakeClassifier] ONNX inference error:', err);
      return 0.5;
    } finally {
      tensor.dispose();
    }
  }

  private preprocess(imageData: ImageData): ort.Tensor {
    const N = CLASSIFIER_INPUT_SIZE;

    // Resize via OffscreenCanvas
    const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    srcCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

    const dstCanvas = new OffscreenCanvas(N, N);
    dstCanvas.getContext('2d')!.drawImage(srcCanvas, 0, 0, N, N);

    const { data } = dstCanvas.getContext('2d')!.getImageData(0, 0, N, N);
    const float32  = new Float32Array(3 * N * N);

    const [mR, mG, mB] = this.useViTNorm ? VIT_MEAN : IMAGENET_MEAN;
    const [sR, sG, sB] = this.useViTNorm ? VIT_STD  : IMAGENET_STD;

    for (let i = 0; i < N * N; i++) {
      float32[i]             = (data[i * 4]     / 255.0 - mR) / sR; // R
      float32[i + N * N]     = (data[i * 4 + 1] / 255.0 - mG) / sG; // G
      float32[i + N * N * 2] = (data[i * 4 + 2] / 255.0 - mB) / sB; // B
    }

    return new ort.Tensor('float32', float32, [1, 3, N, N]);
  }

  private postprocess(results: Record<string, ort.Tensor>): number {
    const output = results[this.outputName] ?? results[Object.keys(results)[0]];
    if (!output) return 0.5;

    const data = output.data as Float32Array;
    if (data.length < 2) return 0.5;

    // Softmax over two logits
    const fakeLogit = data[this.labelFakeIdx];
    const realLogit = data[1 - this.labelFakeIdx];
    const maxL = Math.max(fakeLogit, realLogit);
    const expFake = Math.exp(fakeLogit - maxL);
    const expReal = Math.exp(realLogit - maxL);

    return expFake / (expFake + expReal);
  }

  // ─── Metadata loader ──────────────────────────────────────────────────────

  private async loadMetadata(): Promise<void> {
    try {
      const metaUrl = chrome.runtime.getURL('models/deepfake_classifier.json');
      const res = await fetch(metaUrl);
      if (!res.ok) return;

      const meta = await res.json();
      if (meta.input_name)  this.inputName  = meta.input_name;
      if (meta.output_name) this.outputName = meta.output_name;

      if (meta.normalization) {
        // If mean is not 0.5, assume ImageNet normalisation
        this.useViTNorm = Math.abs(meta.normalization.mean[0] - 0.5) < 0.01;
      }

      // Determine which index is "Fake"
      if (meta.label_map) {
        const fakeKey = Object.keys(meta.label_map).find(
          (k) => meta.label_map[k].toLowerCase().includes('fake')
        );
        if (fakeKey !== undefined) this.labelFakeIdx = parseInt(fakeKey, 10);
      }

      console.log('[DeepfakeClassifier] Loaded metadata sidecar');
    } catch {
      // Metadata is optional — silently use defaults
    }
  }
}

// ─── DCT Frequency-Domain Analysis ───────────────────────────────────────────
//
// Research basis:
//   Wang et al. (2020) "CNN-generated images are surprisingly easy to spot"
//   Frank et al. (2020) "Leveraging frequency analysis for deep fake image recognition"
//
// GAN / diffusion images:
//   1. Exhibit characteristic peaks in the DCT power spectrum (grid artifacts)
//   2. Have unusually low high-frequency noise (over-smooth textures)
//   3. Show abnormal inter-channel correlations (colour channels too correlated)
//   4. Violate Benford's Law distribution of DCT coefficients

function computeFrequencyArtifacts(imageData: ImageData): number {
  const { data, width, height } = imageData;

  // Work on a downsampled version (64×64) for speed
  const SIZE = 64;
  const scaled = resizeBilinear(data, width, height, SIZE, SIZE);

  const luma = new Float32Array(SIZE * SIZE);
  const rChan = new Float32Array(SIZE * SIZE);
  const gChan = new Float32Array(SIZE * SIZE);
  const bChan = new Float32Array(SIZE * SIZE);

  for (let i = 0; i < SIZE * SIZE; i++) {
    const r = scaled[i * 3];
    const g = scaled[i * 3 + 1];
    const b = scaled[i * 3 + 2];
    luma[i]  = 0.299 * r + 0.587 * g + 0.114 * b;
    rChan[i] = r;
    gChan[i] = g;
    bChan[i] = b;
  }

  // ── 1. DCT spectral artifact score ────────────────────────────────────────
  const dctCoeffs = dct2D8x8(luma, SIZE);
  const spectralScore = computeSpectralArtifacts(dctCoeffs);

  // ── 2. High-frequency noise level (real faces have natural noise) ─────────
  const hfNoise = computeHighFrequencyNoise(luma, SIZE);
  // Very low HF noise is suspicious (over-smoothed GAN output)
  const smoothnessScore = hfNoise < 1.5 ? 0.6 : hfNoise < 3.0 ? 0.3 : 0.0;

  // ── 3. Cross-channel correlation (GANs tend to over-correlate channels) ───
  const channelCorr = computeChannelCorrelation(rChan, gChan, bChan);
  const corrScore   = channelCorr > 0.96 ? 0.5 : channelCorr > 0.92 ? 0.2 : 0.0;

  // ── 4. Benford's Law on DCT coefficients ─────────────────────────────────
  const benfordScore = computeBenfordDeviation(dctCoeffs);

  // ── 5. Texture uniformity (local variance) ─────────────────────────────────
  const texScore = computeTextureUniformity(luma, SIZE);

  // ── Weighted blend ────────────────────────────────────────────────────────
  const composite =
    spectralScore  * 0.35 +
    smoothnessScore * 0.25 +
    corrScore      * 0.15 +
    benfordScore   * 0.15 +
    texScore       * 0.10;

  return Math.max(0, Math.min(1, composite));
}

// ─── DSP helpers ──────────────────────────────────────────────────────────────

/**
 * Resize pixel data using bilinear interpolation.
 * Input: RGBA (4 channels), Output: RGB (3 channels, 0-255).
 */
function resizeBilinear(
  src: Uint8ClampedArray,
  sw: number, sh: number,
  dw: number, dh: number,
): Float32Array {
  const dst = new Float32Array(dw * dh * 3);
  const xRatio = sw / dw;
  const yRatio = sh / dh;

  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const srcX = dx * xRatio;
      const srcY = dy * yRatio;
      const x0 = Math.floor(srcX), y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const xFrac = srcX - x0, yFrac = srcY - y0;

      for (let c = 0; c < 3; c++) {
        const tl = src[(y0 * sw + x0) * 4 + c];
        const tr = src[(y0 * sw + x1) * 4 + c];
        const bl = src[(y1 * sw + x0) * 4 + c];
        const br = src[(y1 * sw + x1) * 4 + c];
        dst[(dy * dw + dx) * 3 + c] =
          tl * (1 - xFrac) * (1 - yFrac) +
          tr * xFrac * (1 - yFrac) +
          bl * (1 - xFrac) * yFrac +
          br * xFrac * yFrac;
      }
    }
  }
  return dst;
}

/**
 * Apply 8×8 block DCT across a SIZE×SIZE luma image.
 * Returns flat array of all DCT coefficients.
 */
function dct2D8x8(luma: Float32Array, size: number): Float32Array {
  const BLOCK = 8;
  const numBlocksX = Math.floor(size / BLOCK);
  const numBlocksY = Math.floor(size / BLOCK);
  const totalCoeffs = numBlocksX * numBlocksY * BLOCK * BLOCK;
  const coeffs = new Float32Array(totalCoeffs);
  let ci = 0;

  const C = new Float32Array(BLOCK * BLOCK);
  for (let u = 0; u < BLOCK; u++) {
    for (let x = 0; x < BLOCK; x++) {
      C[u * BLOCK + x] = Math.cos((2 * x + 1) * u * Math.PI / (2 * BLOCK));
    }
  }

  for (let by = 0; by < numBlocksY; by++) {
    for (let bx = 0; bx < numBlocksX; bx++) {
      for (let v = 0; v < BLOCK; v++) {
        for (let u = 0; u < BLOCK; u++) {
          let sum = 0;
          for (let y = 0; y < BLOCK; y++) {
            for (let x = 0; x < BLOCK; x++) {
              const px = luma[(by * BLOCK + y) * size + (bx * BLOCK + x)];
              sum += px * C[v * BLOCK + y] * C[u * BLOCK + x];
            }
          }
          const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
          const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
          coeffs[ci++] = (cu * cv / 4) * sum;
        }
      }
    }
  }

  return coeffs;
}

/**
 * Detect GAN spectral artifacts: unusual energy concentration at specific
 * frequencies (e.g. the 8-pixel grid pattern from upsampling artifacts).
 */
function computeSpectralArtifacts(coeffs: Float32Array): number {
  if (coeffs.length === 0) return 0;

  const powers = coeffs.map((c) => c * c);
  const totalPower = powers.reduce((a, b) => a + b, 0) + 1e-8;

  // DC coefficient power ratio
  const dcPower = powers[0] ?? 0;
  const dcRatio = dcPower / totalPower;

  // Score: if DC dominates (> 0.999), the image is too uniform
  // If AC energy is distributed oddly (all in one frequency), suspicious
  const acPowers = powers.slice(1);
  const maxAC    = Math.max(...acPowers);
  const acTotal  = acPowers.reduce((a, b) => a + b, 0) + 1e-8;
  const peakRatio = maxAC / acTotal;

  // High peak ratio = energy concentrated in one frequency = GAN artifact
  return Math.min(1, Math.max(0, (peakRatio - 0.05) * 10));
}

/**
 * Compute high-frequency noise level by measuring variance in the gradient.
 */
function computeHighFrequencyNoise(luma: Float32Array, size: number): number {
  let varianceSum = 0;
  let count = 0;

  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const center = luma[y * size + x];
      const right  = luma[y * size + x + 1];
      const down   = luma[(y + 1) * size + x];
      varianceSum += (center - right) ** 2 + (center - down) ** 2;
      count++;
    }
  }

  return count > 0 ? Math.sqrt(varianceSum / count) : 0;
}

/**
 * Pearson correlation between R, G, B channels.
 * Real faces have moderate correlation; GANs often over-correlate.
 */
function computeChannelCorrelation(
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
): number {
  const n = r.length;
  let rg = 0, rb = 0;
  let rVar = 0, gVar = 0, bVar = 0;

  const meanR = r.reduce((a, v) => a + v, 0) / n;
  const meanG = g.reduce((a, v) => a + v, 0) / n;
  const meanB = b.reduce((a, v) => a + v, 0) / n;

  for (let i = 0; i < n; i++) {
    const dr = r[i] - meanR;
    const dg = g[i] - meanG;
    const db = b[i] - meanB;
    rg += dr * dg;
    rb += dr * db;
    rVar += dr * dr;
    gVar += dg * dg;
    bVar += db * db;
  }

  const corrRG = rg / (Math.sqrt(rVar * gVar) + 1e-8);
  const corrRB = rb / (Math.sqrt(rVar * bVar) + 1e-8);

  return (Math.abs(corrRG) + Math.abs(corrRB)) / 2;
}

/**
 * Benford's Law test on DCT coefficients.
 * Real images follow Benford's first-digit distribution;
 * synthetic images often deviate significantly.
 */
function computeBenfordDeviation(coeffs: Float32Array): number {
  const BENFORD = [0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046];
  const observed = new Array(9).fill(0);
  let validCount = 0;

  for (const c of coeffs) {
    const abs = Math.abs(c);
    if (abs < 0.5) continue;  // skip near-zero coefficients
    const firstDigit = parseInt(abs.toFixed(0)[0], 10);
    if (firstDigit >= 1 && firstDigit <= 9) {
      observed[firstDigit - 1]++;
      validCount++;
    }
  }

  if (validCount < 10) return 0;

  let chiSquare = 0;
  for (let d = 0; d < 9; d++) {
    const expected = BENFORD[d] * validCount;
    const diff     = observed[d] - expected;
    chiSquare += (diff * diff) / (expected + 1e-8);
  }

  // Normalise: chi-square > 20 = very suspicious
  return Math.min(1, chiSquare / 20);
}

/**
 * Texture uniformity: GAN faces are often too smooth at the pixel level.
 */
function computeTextureUniformity(luma: Float32Array, size: number): number {
  // Compute local 4×4 block variance
  const BLOCK = 4;
  const variances: number[] = [];

  for (let by = 0; by < size - BLOCK; by += BLOCK) {
    for (let bx = 0; bx < size - BLOCK; bx += BLOCK) {
      let sum = 0, sum2 = 0;
      let count = 0;
      for (let dy = 0; dy < BLOCK; dy++) {
        for (let dx = 0; dx < BLOCK; dx++) {
          const v = luma[(by + dy) * size + (bx + dx)];
          sum += v;
          sum2 += v * v;
          count++;
        }
      }
      const mean = sum / count;
      const variance = sum2 / count - mean * mean;
      variances.push(variance);
    }
  }

  if (variances.length === 0) return 0;

  // Mean local variance — very low = suspiciously smooth
  const avgVariance = variances.reduce((a, b) => a + b, 0) / variances.length;

  // Real faces: local variance typically 100–800
  // GAN/avatar: local variance < 50 (over-smoothed)
  return avgVariance < 50 ? 0.8 : avgVariance < 150 ? 0.3 : 0.0;
}
