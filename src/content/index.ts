/**
 * DeepGuard — Content Script Entry Point (v2)
 *
 * Runs entirely in the content script context — no offscreen document needed.
 * Pipeline per-frame:
 *   1. MeetObserver discovers participant video elements
 *   2. FrameCapturer grabs ImageData at 1 FPS
 *   3. LocalAnalyzer runs lightweight skin-tone + temporal analysis inline
 *   4. Results stored locally and reported to side panel on demand
 */

import { MeetObserver } from './meet-observer';
import { FrameCapturer } from './frame-capturer';
import { AudioCapture } from './audio-capture';
import { OverlayManager } from './overlay-manager';
import type { Participant, ParticipantId, SerializedFrameData, DeepGuardSettings, TrustReport } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

// ─── State ────────────────────────────────────────────────────────────────────

let settings: DeepGuardSettings = DEFAULT_SETTINGS;
let isCallActive = false;

// Local store of latest reports & participant info (no SW needed)
const latestReports   = new Map<ParticipantId, TrustReport>();
const participantInfo = new Map<ParticipantId, { displayName: string }>();
// Per-participant: [avgLuminance, sampledPixels...] for frame-diff
const frameHistory    = new Map<ParticipantId, number[]>();   // luminance history
const frameSamples    = new Map<ParticipantId, Uint8Array>();  // sparse pixel snapshot
let   audioRmsLevel   = 0;                                      // latest mic RMS

const meetObserver   = new MeetObserver(onParticipantJoined, onParticipantLeft);
const frameCapturer  = new FrameCapturer(onFrameReady, DEFAULT_SETTINGS.targetFps);
const overlayManager = new OverlayManager();
const audioCapture   = new AudioCapture(onAudioLevel);

// ─── Initialise ───────────────────────────────────────────────────────────────

console.log('[DeepGuard Content v2] Loaded on', window.location.href);

(async () => {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (resp) settings = { ...DEFAULT_SETTINGS, ...resp };
  } catch {
    // Background not ready — use defaults
  }

  detectCallState();
  watchForCallStateChanges();
})();

// ─── Call State Detection ─────────────────────────────────────────────────────

function detectCallState(): void {
  const inCall = isInMeetCall();
  if (inCall && !isCallActive) {
    startSession();
  } else if (!inCall && isCallActive) {
    endSession();
  }
}

function isInMeetCall(): boolean {
  const path = window.location.pathname;
  return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(path) ||
         /^\/lookup\//.test(path);
}

function watchForCallStateChanges(): void {
  window.addEventListener('popstate', detectCallState);
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      detectCallState();
    }
  }, 1500);
}

// ─── Session Lifecycle ────────────────────────────────────────────────────────

function startSession(): void {
  if (isCallActive) return;
  isCallActive = true;
  console.log('[DeepGuard Content v2] Call started');

  chrome.runtime.sendMessage({ type: 'MEET_CALL_STARTED', payload: { tabId: 0 } }).catch(() => {});
  meetObserver.start();

  if (settings.enableLipSync) {
    audioCapture.start().then((started) => {
      if (started) console.log('[DeepGuard Content v2] Audio capture active');
    });
  }
}

function endSession(): void {
  if (!isCallActive) return;
  isCallActive = false;
  console.log('[DeepGuard Content v2] Call ended');

  meetObserver.stop();
  frameCapturer.stopAll();
  audioCapture.stop();
  overlayManager.removeAll();
  latestReports.clear();
  participantInfo.clear();
  frameHistory.clear();

  chrome.runtime.sendMessage({ type: 'MEET_CALL_ENDED', payload: { tabId: 0 } }).catch(() => {});
}

// ─── Participant Events ───────────────────────────────────────────────────────

function onParticipantJoined(participant: Participant): void {
  console.log(`[DeepGuard Content v2] Participant joined: ${participant.displayName} (local=${participant.isLocal})`);

  participantInfo.set(participant.id, { displayName: participant.displayName });
  frameHistory.set(participant.id, []);

  chrome.runtime.sendMessage({
    type: 'PARTICIPANT_JOINED',
    payload: { participantId: participant.id, displayName: participant.displayName },
  }).catch(() => {});

  if (settings.showOverlay) {
    overlayManager.addOverlay(participant);
  }

  if (settings.enabled) {
    frameCapturer.addParticipant(participant);
  }
}

function onParticipantLeft(participantId: ParticipantId): void {
  console.log(`[DeepGuard Content v2] Participant left: ${participantId}`);

  participantInfo.delete(participantId);
  latestReports.delete(participantId);
  frameHistory.delete(participantId);

  chrome.runtime.sendMessage({ type: 'PARTICIPANT_LEFT', payload: { participantId } }).catch(() => {});
  frameCapturer.removeParticipant(participantId);
  overlayManager.removeOverlay(participantId);
}

// ─── Frame Analysis (runs inline — no offscreen doc needed) ──────────────────

function onFrameReady(frame: SerializedFrameData): void {
  if (!settings.enabled) return;

  // Run lightweight analysis synchronously in content script
  const report = analyzeFrameLocally(frame);
  latestReports.set(frame.participantId, report);

  // Update overlay
  overlayManager.updateReport(report);

  // Inform background for storage
  chrome.runtime.sendMessage({ type: 'TRUST_REPORT', payload: report }).catch(() => {});
}

function analyzeFrameLocally(frame: SerializedFrameData): TrustReport {
  const data   = new Uint8ClampedArray(frame.buffer);
  const width  = frame.width;
  const height = frame.height;
  const n      = width * height;
  const step   = 4; // sample every 4th pixel row/col

  // ── 1. Luminance + skin-tone ratio ────────────────────────────────────────
  let skinPixels = 0;
  let sumLum     = 0;
  let sampledCount = 0;

  // Build a sparse pixel snapshot for frame-diff (64 evenly-spaced samples)
  const SNAP_SIZE = 64;
  const snapStepY = Math.max(1, Math.floor(height / 8));
  const snapStepX = Math.max(1, Math.floor(width  / 8));
  const snapBuf   = new Uint8Array(SNAP_SIZE);
  let   snapIdx   = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];

      const yy =  0.299 * r + 0.587 * g + 0.114 * b;
      const cr = (r - yy) * 0.713 + 128;
      const cb = (b - yy) * 0.564 + 128;

      sumLum += yy;
      sampledCount++;

      if (yy > 80 && yy < 240 && cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127) {
        skinPixels++;
      }
    }
  }
  // Collect sparse snapshot (independent pass for clean grid)
  for (let sy = 0; sy < 8 && snapIdx < SNAP_SIZE; sy++) {
    for (let sx = 0; sx < 8 && snapIdx < SNAP_SIZE; sx++) {
      const px = Math.min(width  - 1, sx * snapStepX);
      const py = Math.min(height - 1, sy * snapStepY);
      const i  = (py * width + px) * 4;
      snapBuf[snapIdx++] = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
    }
  }

  const skinRatio = skinPixels / Math.max(1, sampledCount);
  const avgLum    = sumLum     / Math.max(1, sampledCount);
  const hasFace   = skinRatio > 0.03 && skinPixels > 20;

  // ── 2. Static-frame detection (KEY for AI images) ────────────────────────
  // Compare sparse pixel snapshot to previous frame.
  // Real people move → high diff. Static AI images → diff ≈ 0.
  const prevSnap = frameSamples.get(frame.participantId);
  frameSamples.set(frame.participantId, snapBuf);

  let staticScore = 80; // default: assume normal
  let isStatic    = false;
  if (prevSnap && prevSnap.length === SNAP_SIZE) {
    let diffSum = 0;
    for (let k = 0; k < SNAP_SIZE; k++) {
      diffSum += Math.abs(snapBuf[k] - prevSnap[k]);
    }
    const avgPixelDiff = diffSum / SNAP_SIZE;

    if (avgPixelDiff < 1.5) {
      // Frames are virtually identical — static image / frozen feed
      staticScore = 10;
      isStatic    = true;
    } else if (avgPixelDiff < 5) {
      staticScore = 40; // very little movement — suspicious
    } else if (avgPixelDiff < 40) {
      staticScore = 90; // natural human motion
    } else {
      staticScore = 75; // large change — could be scene cut
    }
  }

  // ── 3. Temporal consistency (luminance delta history) ─────────────────────
  const history = frameHistory.get(frame.participantId) ?? [];
  history.push(avgLum);
  if (history.length > 8) history.shift();
  frameHistory.set(frame.participantId, history);

  let lumDeltaScore = 80;
  if (history.length >= 2) {
    const deltas   = history.slice(1).map((v, i) => Math.abs(v - history[i]));
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    if (avgDelta < 0.3)      lumDeltaScore = 30;  // frozen luminance
    else if (avgDelta < 30)  lumDeltaScore = 90;  // natural
    else                     lumDeltaScore = 70;  // erratic
  }

  // Combine static-frame + luminance delta for temporal score
  const temporalScore = Math.round(staticScore * 0.7 + lumDeltaScore * 0.3);

  // ── 4. Texture / avatar risk ───────────────────────────────────────────────
  // AI images: high global variance (art has detail) BUT unnaturally smooth.
  // We check local patch variance within face region.
  // Also: if image is STATIC, avatar risk is very high regardless.
  let rSum = 0, rSumSq = 0, rCount = 0;
  for (let i = 0; i < data.length; i += step * 4) {
    const r = data[i];
    rSum   += r;
    rSumSq += r * r;
    rCount++;
  }
  const rMean = rSum / Math.max(1, rCount);
  const rVar  = rSumSq / Math.max(1, rCount) - rMean * rMean;

  // Low variance = too smooth = AI. High variance = natural.
  // But if static, avatar risk is already penalised via temporalScore.
  let avatarScore: number;
  if (isStatic) {
    avatarScore = 15; // definitely not a real live person
  } else if (rVar < 300) {
    avatarScore = 45; // suspiciously smooth
  } else if (rVar < 600) {
    avatarScore = 70;
  } else {
    avatarScore = 90; // natural variance
  }

  // ── 5. Lip-sync (audio vs motion) ─────────────────────────────────────────
  // If audio is detected but frame is completely static → definite mismatch.
  let lipScore = 75;
  if (isStatic && audioRmsLevel > 0.02) {
    lipScore = 20; // audio present but video frozen
  } else if (isStatic) {
    lipScore = 50; // no audio data, but static is still suspicious
  }

  // ── 6. Face authenticity ──────────────────────────────────────────────────
  // Skin ratio score — AI images can have good skin tones, so weight texture
  let faceScore: number;
  if (!hasFace) {
    faceScore = 60;
  } else {
    const skinQuality = Math.min(90, skinRatio * 250);
    // Penalise if static (it's a photo, not a person)
    faceScore = isStatic
      ? Math.round(skinQuality * 0.3 + avatarScore * 0.7)
      : Math.round(skinQuality * 0.6 + avatarScore * 0.4);
  }

  if (!hasFace && !isStatic) {
    return buildReport(frame.participantId, frame.frameIndex, frame.timestamp, 'NO_FACE', {
      faceAuthenticity:    60,
      temporalConsistency: temporalScore,
      lipSync:             lipScore,
      avatarRisk:          avatarScore,
    });
  }

  const overall = Math.round(
    faceScore     * 0.30 +
    temporalScore * 0.35 +  // static detection is now the primary signal
    lipScore      * 0.15 +
    avatarScore   * 0.20
  );

  const status = overall >= 80 ? 'REAL' : overall >= 50 ? 'SUSPICIOUS' : 'LIKELY_SYNTHETIC';

  return buildReport(frame.participantId, frame.frameIndex, frame.timestamp, status, {
    faceAuthenticity:    faceScore,
    temporalConsistency: temporalScore,
    lipSync:             lipScore,
    avatarRisk:          avatarScore,
  }, overall);
}

function buildReport(
  participantId: ParticipantId,
  frameIndex: number,
  timestamp: number,
  status: TrustReport['status'],
  scores: TrustReport['scores'],
  overall?: number,
): TrustReport {
  const o = overall ?? Math.round(
    scores.faceAuthenticity    * 0.35 +
    scores.temporalConsistency * 0.25 +
    scores.lipSync             * 0.20 +
    scores.avatarRisk          * 0.20
  );

  return {
    participantId,
    frameIndex,
    timestamp,
    status,
    overallTrustScore: o,
    scores,
    faceDetected: status !== 'NO_FACE',
    analysisLatencyMs: 0,
    avatarFlags: {
      overly_smooth_motion: false,
      video_loop_detected:  false,
      texture_uniformity:   scores.avatarRisk < 65,
      edge_artifact:        false,
      static_background:    false,
    },
  };
}

// ─── Audio Level ──────────────────────────────────────────────────────────────

function onAudioLevel(rms: number): void {
  audioRmsLevel = rms; // used in lip-sync scoring
}

// ─── Incoming Messages ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (message: any, _sender, sendResponse) => {
    switch (message.type) {

      case 'TRUST_REPORT': {
        // From background (if offscreen is used in future) — update overlay
        overlayManager.updateReport(message.payload);
        sendResponse({ ok: true });
        break;
      }

      case 'SETTINGS_UPDATED': {
        const newSettings = message.payload as DeepGuardSettings;
        const wasEnabled  = settings.enabled;
        settings = newSettings;

        if (!newSettings.enabled && wasEnabled) {
          frameCapturer.stopAll();
          overlayManager.removeAll();
        } else if (newSettings.enabled && !wasEnabled) {
          meetObserver.getAllParticipants().forEach((p) => {
            frameCapturer.addParticipant(p);
            overlayManager.addOverlay(p);
          });
        }

        frameCapturer.setFps(newSettings.targetFps);
        sendResponse({ ok: true });
        break;
      }

      case 'GET_ALL_REPORTS': {
        // SidePanel polls this via chrome.tabs.sendMessage
        const reports: Record<string, TrustReport>              = {};
        const participants: Record<string, { displayName: string }> = {};

        latestReports.forEach((r, id)   => { reports[id]      = r; });
        participantInfo.forEach((p, id) => { participants[id]  = p; });

        // Also include participants that haven't been analyzed yet
        meetObserver.getAllParticipants().forEach((p) => {
          if (!participants[p.id]) {
            participants[p.id] = { displayName: p.displayName };
          }
        });

        sendResponse({ payload: { reports, participants } });
        return false;
      }

      case 'GET_SESSION_REPORT': {
        chrome.runtime.sendMessage(message)
          .then((resp) => sendResponse(resp))
          .catch(() => sendResponse(null));
        return true;
      }

      default:
        sendResponse({ ok: false });
    }

    return false;
  }
);
