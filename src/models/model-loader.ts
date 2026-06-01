/**
 * DeepGuard — ONNX Model Loader
 *
 * Handles lazy loading, caching, and path resolution of ONNX models.
 * The face detection model is now handled by MediaPipe (see face-detector.ts).
 * This loader is responsible only for the deepfake ONNX classifier.
 */

import * as ort from 'onnxruntime-web';
import { MODEL_PATHS } from '../shared/constants';

// Configure ONNX Runtime WASM backend
ort.env.wasm.wasmPaths = chrome.runtime.getURL('');
ort.env.wasm.numThreads = 1;   // Single thread — offscreen doc is not multi-threaded
ort.env.wasm.proxy = false;

type ModelKey = keyof typeof MODEL_PATHS;

const sessionCache = new Map<ModelKey, ort.InferenceSession>();

/**
 * Load an ONNX model by key. Throws if the model file is not present.
 * The caller (DeepfakeClassifier) is responsible for catching this and
 * falling back to frequency-domain analysis.
 */
export async function loadModel(key: ModelKey): Promise<ort.InferenceSession> {
  if (sessionCache.has(key)) {
    return sessionCache.get(key)!;
  }

  const modelPath = MODEL_PATHS[key];
  const modelUrl  = chrome.runtime.getURL(modelPath);

  console.log(`[ModelLoader] Loading model: ${key} from ${modelUrl}`);

  const response = await fetch(modelUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${modelUrl}`);
  }

  const modelBuffer = await response.arrayBuffer();
  const session     = await ort.InferenceSession.create(modelBuffer, {
    executionProviders:    ['wasm'],
    graphOptimizationLevel: 'all',
    enableCpuMemArena:     true,
    enableMemPattern:      true,
    // Limit WASM memory to avoid OOM in the offscreen document
    // (relevant when the ViT model is ~327 MB)
  });

  sessionCache.set(key, session);
  return session;
}

export function clearModelCache(): void {
  sessionCache.clear();
}
