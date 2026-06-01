/**
 * DeepGuard — Offscreen Document Entry Point
 *
 * Receives ANALYZE_FRAME messages from the background SW,
 * runs the inference pipeline, and returns TRUST_REPORT.
 */

import { InferenceEngine } from './inference-engine';
import type { AnyMessage, AnalyzeFrameMessage, AudioLevelMessage } from '../shared/messaging';
import type { SerializedFrameData } from '../shared/types';

const engine = new InferenceEngine();

// ─── Initialise ───────────────────────────────────────────────────────────────

(async () => {
  try {
    await engine.initialize();
    chrome.runtime.sendMessage({ type: 'ENGINE_READY' });
  } catch (err) {
    console.error('[DeepGuard Offscreen] Initialization failed:', err);
    chrome.runtime.sendMessage({
      type: 'ENGINE_ERROR',
      payload: { error: String(err) },
    });
  }
})();

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: AnyMessage, _sender, sendResponse) => {
  if (message.type === 'ANALYZE_FRAME') {
    handleAnalyzeFrame(message as AnalyzeFrameMessage)
      .then((report) => sendResponse({ ok: true, report }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async
  }

  if (message.type === 'AUDIO_LEVEL') {
    engine.updateAudioLevel(
      (message as AudioLevelMessage).payload.participantId,
      (message as AudioLevelMessage).payload.rms
    );
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// ─── Frame Analysis ───────────────────────────────────────────────────────────

async function handleAnalyzeFrame(message: AnalyzeFrameMessage): Promise<void> {
  const frame = message.payload;
  const imageData = deserializeFrame(frame);

  const report = await engine.analyzeFrame({
    participantId: frame.participantId,
    imageData,
    width: frame.width,
    height: frame.height,
    timestamp: frame.timestamp,
    frameIndex: frame.frameIndex,
  });

  // Send trust report back through background SW
  chrome.runtime.sendMessage({ type: 'TRUST_REPORT', payload: report });
}

function deserializeFrame(frame: SerializedFrameData): ImageData {
  const uint8 = new Uint8ClampedArray(frame.buffer);
  return new ImageData(uint8, frame.width, frame.height);
}
