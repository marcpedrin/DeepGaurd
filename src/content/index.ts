/**
 * DeepGuard — Content Script Entry Point
 *
 * Bootstraps on meet.google.com:
 *  1. Detects call state
 *  2. Starts MeetObserver for participant discovery
 *  3. Starts FrameCapturer per participant
 *  4. Starts AudioCapture for lip-sync
 *  5. Manages overlay UI via OverlayManager
 *  6. Routes messages to/from background SW
 */

import { MeetObserver } from './meet-observer';
import { FrameCapturer } from './frame-capturer';
import { AudioCapture } from './audio-capture';
import { OverlayManager } from './overlay-manager';
import type { Participant, ParticipantId, SerializedFrameData, DeepGuardSettings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

// ─── State ────────────────────────────────────────────────────────────────────

let settings: DeepGuardSettings = DEFAULT_SETTINGS;
let isCallActive = false;

const meetObserver   = new MeetObserver(onParticipantJoined, onParticipantLeft);
const frameCapturer  = new FrameCapturer(onFrameReady, DEFAULT_SETTINGS.targetFps);
const overlayManager = new OverlayManager();
const audioCapture   = new AudioCapture(onAudioLevel);

// ─── Initialise ───────────────────────────────────────────────────────────────

(async () => {
  console.log('[DeepGuard Content] Initializing on', window.location.href);

  // Fetch current settings from background
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (resp) settings = { ...DEFAULT_SETTINGS, ...resp };
  } catch {
    // Background may not be ready yet — use defaults
  }

  // Detect if already in a call
  detectCallState();

  // Watch URL for navigation between Meet pages (SPA)
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
  // Meet call URLs contain a room code path segment
  const path = window.location.pathname;
  // Typical patterns: /xyz-abcd-efg or /lookup/xxx
  return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(path) ||
         /^\/lookup\//.test(path);
}

function watchForCallStateChanges(): void {
  // Meet is a SPA; we watch for popstate and periodic checks
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

  console.log('[DeepGuard Content] Call started');

  chrome.runtime.sendMessage({
    type: 'MEET_CALL_STARTED',
    payload: { tabId: 0 },
  }).catch(() => {});

  meetObserver.start();

  if (settings.enableLipSync) {
    audioCapture.start().then((started) => {
      if (started) console.log('[DeepGuard Content] Audio capture active');
    });
  }
}

function endSession(): void {
  if (!isCallActive) return;
  isCallActive = false;

  console.log('[DeepGuard Content] Call ended');

  meetObserver.stop();
  frameCapturer.stopAll();
  audioCapture.stop();
  overlayManager.removeAll();

  chrome.runtime.sendMessage({
    type: 'MEET_CALL_ENDED',
    payload: { tabId: 0 },
  }).catch(() => {});
}

// ─── Participant Events ───────────────────────────────────────────────────────

function onParticipantJoined(participant: Participant): void {
  console.log(`[DeepGuard Content] Participant joined: ${participant.displayName}`);

  chrome.runtime.sendMessage({
    type: 'PARTICIPANT_JOINED',
    payload: {
      participantId: participant.id,
      displayName: participant.displayName,
    },
  }).catch(() => {});

  if (settings.showOverlay) {
    overlayManager.addOverlay(participant);
  }

  if (settings.enabled) {
    frameCapturer.addParticipant(participant);
  }
}

function onParticipantLeft(participantId: ParticipantId): void {
  console.log(`[DeepGuard Content] Participant left: ${participantId}`);

  chrome.runtime.sendMessage({
    type: 'PARTICIPANT_LEFT',
    payload: { participantId },
  }).catch(() => {});

  frameCapturer.removeParticipant(participantId);
  overlayManager.removeOverlay(participantId);
}

// ─── Frame Ready ──────────────────────────────────────────────────────────────

function onFrameReady(frame: SerializedFrameData): void {
  if (!settings.enabled) return;

  chrome.runtime.sendMessage(
    {
      type: 'FRAME_READY',
      payload: frame,
    },
    // transferable — not supported in chrome.runtime.sendMessage, so we do a copy above
  ).catch(() => {});
}

// ─── Audio Level ──────────────────────────────────────────────────────────────

function onAudioLevel(rms: number): void {
  // Send audio level for local participant (self) — used for lip-sync
  const localParticipants = meetObserver.getAllParticipants().filter((p) => p.isLocal);
  const participantId = localParticipants[0]?.id ?? 'local';

  chrome.runtime.sendMessage({
    type: 'AUDIO_LEVEL',
    payload: { participantId, rms, timestamp: Date.now() },
  }).catch(() => {});
}

// ─── Incoming Messages from Background ───────────────────────────────────────

chrome.runtime.onMessage.addListener(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (message: any, _sender, sendResponse) => {
    switch (message.type) {
      case 'TRUST_REPORT': {
        overlayManager.updateReport(message.payload);
        sendResponse({ ok: true });
        break;
      }

      case 'SETTINGS_UPDATED': {
        const newSettings = message.payload as DeepGuardSettings;
        const wasEnabled = settings.enabled;

        settings = newSettings;

        // Apply setting changes
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

        if (newSettings.enableLipSync && !audioCapture.isActive) {
          audioCapture.start();
        } else if (!newSettings.enableLipSync && audioCapture.isActive) {
          audioCapture.stop();
        }

        sendResponse({ ok: true });
        break;
      }

      case 'ANALYSIS_ERROR': {
        console.warn('[DeepGuard Content] Analysis error:', message.payload?.error);
        sendResponse({ ok: true });
        break;
      }

      // ── Proxy requests from Popup / SidePanel to the background SW ──────
      // Popup and SidePanel use chrome.tabs.sendMessage to reach the content
      // script; we proxy these to the background service worker which holds state.
      case 'GET_ALL_REPORTS':
      case 'GET_SESSION_REPORT': {
        chrome.runtime.sendMessage(message)
          .then((resp) => sendResponse(resp))
          .catch(() => sendResponse(null));
        return true; // keep channel open for async response
      }

      default:
        sendResponse({ ok: false });
    }

    return false;
  }
);
