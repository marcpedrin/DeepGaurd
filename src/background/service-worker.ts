/**
 * DeepGuard — Background Service Worker (MV3)
 *
 * Responsibilities:
 *  1. Detect Google Meet tab lifecycle (call start / end)
 *  2. Manage the Offscreen Document (create / destroy)
 *  3. Route messages: Content Script ↔ Offscreen Document
 *  4. Maintain per-tab state (participants, latest reports)
 *  5. Persist settings and session data to chrome.storage
 */

import {
  OFFSCREEN_DOCUMENT_URL,
  STORAGE_KEYS,
  EXTENSION_VERSION,
} from '../shared/constants';
import { DEFAULT_SETTINGS } from '../shared/types';
import type {
  DeepGuardSettings,
  TrustReport,
  ParticipantId,
  SessionReport,
  ParticipantSessionSummary,
} from '../shared/types';
import type {
  AnyMessage,
  ContentToBackgroundMessage,
  OffscreenToBackgroundMessage,
  TrustReportMessage,
} from '../shared/messaging';

// ─── State ────────────────────────────────────────────────────────────────────

interface TabState {
  tabId: number;
  sessionId: string;
  startTime: number;
  participants: Map<ParticipantId, { displayName: string }>;
  latestReports: Map<ParticipantId, TrustReport>;
  reportHistory: Map<ParticipantId, TrustReport[]>;
  frameCounters: Map<ParticipantId, number>;
}

const activeTabs = new Map<number, TabState>();
let offscreenReady = false;
let offscreenInitializing = false;
let settings: DeepGuardSettings = DEFAULT_SETTINGS;

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[DeepGuard SW] Extension installed / updated');
  await loadSettings();
});

chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
});

// ─── Tab Monitoring ───────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url?.includes('meet.google.com')) return;

  // New Meet call
  if (!activeTabs.has(tabId)) {
    console.log(`[DeepGuard SW] Meet call detected on tab ${tabId}`);
    activeTabs.set(tabId, createTabState(tabId));
    await ensureOffscreenDocument();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabs.has(tabId)) {
    console.log(`[DeepGuard SW] Tab closed, ending session for tab ${tabId}`);
    finalizeSession(tabId);
    activeTabs.delete(tabId);
    if (activeTabs.size === 0) {
      destroyOffscreenDocument();
    }
  }
});

// ─── Message Routing ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: AnyMessage, sender, sendResponse) => {
    const tabId = sender.tab?.id;

    // Messages from Offscreen Document
    if (!tabId) {
      handleOffscreenMessage(message as OffscreenToBackgroundMessage);
      sendResponse({ ok: true });
      return false;
    }

    // Messages from Content Script
    handleContentMessage(message as ContentToBackgroundMessage, tabId, sendResponse);
    return true; // Keep channel open for async responses
  }
);

// ─── Content Script Message Handlers ─────────────────────────────────────────

function handleContentMessage(
  message: ContentToBackgroundMessage,
  tabId: number,
  sendResponse: (response: unknown) => void
): void {
  const tabState = activeTabs.get(tabId);

  switch (message.type) {
    case 'MEET_CALL_STARTED': {
      if (!activeTabs.has(tabId)) {
        activeTabs.set(tabId, createTabState(tabId));
        ensureOffscreenDocument().catch(console.error);
      }
      sendResponse({ ok: true });
      break;
    }

    case 'MEET_CALL_ENDED': {
      if (tabState) {
        finalizeSession(tabId);
        activeTabs.delete(tabId);
        if (activeTabs.size === 0) destroyOffscreenDocument();
      }
      sendResponse({ ok: true });
      break;
    }

    case 'PARTICIPANT_JOINED': {
      if (tabState) {
        tabState.participants.set(message.payload.participantId, {
          displayName: message.payload.displayName,
        });
        tabState.frameCounters.set(message.payload.participantId, 0);
        tabState.reportHistory.set(message.payload.participantId, []);
        console.log(`[DeepGuard SW] Participant joined: ${message.payload.displayName}`);
      }
      sendResponse({ ok: true });
      break;
    }

    case 'PARTICIPANT_LEFT': {
      if (tabState) {
        tabState.participants.delete(message.payload.participantId);
        tabState.frameCounters.delete(message.payload.participantId);
        console.log(`[DeepGuard SW] Participant left: ${message.payload.participantId}`);
      }
      sendResponse({ ok: true });
      break;
    }

    case 'FRAME_READY': {
      if (!settings.enabled) {
        sendResponse({ ok: false, reason: 'disabled' });
        return;
      }
      if (tabState) {
        const counter = tabState.frameCounters.get(message.payload.participantId) ?? 0;
        tabState.frameCounters.set(message.payload.participantId, counter + 1);
      }
      // Forward to offscreen for inference
      forwardToOffscreen(message).catch(console.error);
      sendResponse({ ok: true });
      break;
    }

    case 'AUDIO_LEVEL': {
      // Forward audio level to offscreen for lip-sync analysis
      forwardToOffscreen(message).catch(console.error);
      sendResponse({ ok: true });
      break;
    }

    case 'GET_SETTINGS': {
      sendResponse(settings);
      break;
    }

    case 'UPDATE_SETTINGS': {
      settings = { ...settings, ...message.payload };
      saveSettings().catch(console.error);
      // Broadcast to all Meet tabs
      broadcastToAllTabs({ type: 'SETTINGS_UPDATED', payload: settings });
      sendResponse(settings);
      break;
    }

    case 'GET_ALL_REPORTS': {
      if (tabState) {
        const reports: Record<ParticipantId, TrustReport> = {};
        const participants: Record<ParticipantId, { displayName: string }> = {};
        tabState.latestReports.forEach((report, id) => {
          reports[id] = report;
        });
        tabState.participants.forEach((p, id) => {
          participants[id] = p;
        });
        sendResponse({ type: 'ALL_REPORTS', payload: { reports, participants } });
      } else {
        sendResponse({ type: 'ALL_REPORTS', payload: { reports: {}, participants: {} } });
      }
      break;
    }

    case 'GET_SESSION_REPORT': {
      if (tabState) {
        sendResponse(buildSessionReport(tabState));
      } else {
        sendResponse(null);
      }
      break;
    }

    case 'EXPORT_SESSION_REPORT': {
      if (tabState) {
        const report = buildSessionReport(tabState);
        sendResponse({ type: 'SESSION_REPORT_READY', payload: report });
      }
      break;
    }

    default:
      sendResponse({ ok: false, reason: 'unknown message type' });
  }
}

// ─── Offscreen Message Handlers ───────────────────────────────────────────────

function handleOffscreenMessage(message: OffscreenToBackgroundMessage): void {
  switch (message.type) {
    case 'ENGINE_READY': {
      offscreenReady = true;
      offscreenInitializing = false;
      console.log('[DeepGuard SW] Inference engine ready');
      break;
    }

    case 'ENGINE_ERROR': {
      offscreenReady = false;
      offscreenInitializing = false;
      console.error('[DeepGuard SW] Engine error:', message.payload.error);
      break;
    }

    case 'TRUST_REPORT': {
      const report = (message as TrustReportMessage).payload;
      // Store and forward to all Meet tabs
      activeTabs.forEach((tabState, tabId) => {
        tabState.latestReports.set(report.participantId, report);
        const history = tabState.reportHistory.get(report.participantId) ?? [];
        history.push(report);
        // Keep last 300 reports per participant (≈5 min at 1 FPS)
        if (history.length > 300) history.shift();
        tabState.reportHistory.set(report.participantId, history);

        chrome.tabs.sendMessage(tabId, { type: 'TRUST_REPORT', payload: report })
          .catch(() => { /* tab may have closed */ });
      });
      break;
    }
  }
}

// ─── Offscreen Document Management ───────────────────────────────────────────

async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenReady || offscreenInitializing) return;

  offscreenInitializing = true;
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_URL)],
  });

  if (existingContexts.length > 0) {
    offscreenReady = true;
    offscreenInitializing = false;
    return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_URL,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'ONNX Runtime Web inference for deepfake detection',
    });
    console.log('[DeepGuard SW] Offscreen document created');
  } catch (err) {
    console.error('[DeepGuard SW] Failed to create offscreen document:', err);
    offscreenInitializing = false;
  }
}

async function destroyOffscreenDocument(): Promise<void> {
  offscreenReady = false;
  offscreenInitializing = false;
  try {
    await chrome.offscreen.closeDocument();
    console.log('[DeepGuard SW] Offscreen document destroyed');
  } catch {
    // Already gone
  }
}

async function forwardToOffscreen(message: AnyMessage): Promise<void> {
  if (!offscreenReady) {
    await ensureOffscreenDocument();
    if (!offscreenReady) return;
  }
  try {
    await chrome.runtime.sendMessage(message);
  } catch (err) {
    console.warn('[DeepGuard SW] Failed to forward to offscreen:', err);
  }
}

// ─── Session Helpers ──────────────────────────────────────────────────────────

function createTabState(tabId: number): TabState {
  return {
    tabId,
    sessionId: `session_${tabId}_${Date.now()}`,
    startTime: Date.now(),
    participants: new Map(),
    latestReports: new Map(),
    reportHistory: new Map(),
    frameCounters: new Map(),
  };
}

function buildSessionReport(tabState: TabState): SessionReport {
  const summaries: ParticipantSessionSummary[] = [];

  tabState.participants.forEach(({ displayName }, participantId) => {
    const history = tabState.reportHistory.get(participantId) ?? [];
    const scores = history.map((r) => r.overallTrustScore);
    const avg = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 50;
    const min = scores.length > 0 ? Math.min(...scores) : 50;
    const lastReport = history[history.length - 1];

    summaries.push({
      participantId,
      displayName,
      framesAnalyzed: tabState.frameCounters.get(participantId) ?? 0,
      averageTrustScore: Math.round(avg),
      lowestTrustScore: Math.round(min),
      finalStatus: lastReport?.status ?? 'ANALYZING',
      scoreHistory: history.slice(-60), // last 60 entries for the report
    });
  });

  return {
    sessionId: tabState.sessionId,
    startTime: tabState.startTime,
    endTime: Date.now(),
    participants: summaries,
    extensionVersion: EXTENSION_VERSION,
  };
}

function finalizeSession(tabId: number): void {
  const tabState = activeTabs.get(tabId);
  if (!tabState) return;

  const report = buildSessionReport(tabState);
  // Persist to storage (keep last 10 sessions)
  chrome.storage.local.get(STORAGE_KEYS.SESSION_REPORTS, (result) => {
    const existing: SessionReport[] = result[STORAGE_KEYS.SESSION_REPORTS] ?? [];
    existing.unshift(report);
    const trimmed = existing.slice(0, 10);
    chrome.storage.local.set({ [STORAGE_KEYS.SESSION_REPORTS]: trimmed });
  });
}

function broadcastToAllTabs(message: AnyMessage): void {
  activeTabs.forEach((_, tabId) => {
    chrome.tabs.sendMessage(tabId, message).catch(() => {});
  });
}

// ─── Settings Persistence ─────────────────────────────────────────────────────

async function loadSettings(): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  if (result[STORAGE_KEYS.SETTINGS]) {
    settings = { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
  }
}

async function saveSettings(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}
