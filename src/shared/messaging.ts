/**
 * DeepGuard — Typed Chrome Extension Messaging Protocol
 *
 * All inter-context communication uses this discriminated union.
 * Content Script ↔ Background SW ↔ Offscreen Document
 */

import type {
  ParticipantId,
  SerializedFrameData,
  TrustReport,
  DeepGuardSettings,
  SessionReport,
} from './types';

// ─── Message Directions ───────────────────────────────────────────────────────
//
//  Content → Background: FRAME_READY, PARTICIPANT_JOINED, PARTICIPANT_LEFT,
//                        AUDIO_LEVEL, GET_SETTINGS, GET_SESSION_REPORT
//  Background → Content: TRUST_REPORT, SETTINGS_UPDATED, ANALYSIS_ERROR
//  Background → Offscreen: ANALYZE_FRAME, INIT_ENGINE
//  Offscreen → Background: TRUST_REPORT, ENGINE_READY, ENGINE_ERROR

// ─── Content → Background ────────────────────────────────────────────────────

export interface FrameReadyMessage {
  type: 'FRAME_READY';
  payload: SerializedFrameData;
}

export interface ParticipantJoinedMessage {
  type: 'PARTICIPANT_JOINED';
  payload: {
    participantId: ParticipantId;
    displayName: string;
  };
}

export interface ParticipantLeftMessage {
  type: 'PARTICIPANT_LEFT';
  payload: {
    participantId: ParticipantId;
  };
}

export interface AudioLevelMessage {
  type: 'AUDIO_LEVEL';
  payload: {
    participantId: ParticipantId;
    rms: number;
    timestamp: number;
  };
}

export interface GetSettingsMessage {
  type: 'GET_SETTINGS';
}

export interface UpdateSettingsMessage {
  type: 'UPDATE_SETTINGS';
  payload: Partial<DeepGuardSettings>;
}

export interface GetSessionReportMessage {
  type: 'GET_SESSION_REPORT';
}

export interface MeetCallStartedMessage {
  type: 'MEET_CALL_STARTED';
  payload: { tabId: number };
}

export interface MeetCallEndedMessage {
  type: 'MEET_CALL_ENDED';
  payload: { tabId: number };
}

// ─── Background → Content ────────────────────────────────────────────────────

export interface TrustReportMessage {
  type: 'TRUST_REPORT';
  payload: TrustReport;
}

export interface SettingsUpdatedMessage {
  type: 'SETTINGS_UPDATED';
  payload: DeepGuardSettings;
}

export interface AnalysisErrorMessage {
  type: 'ANALYSIS_ERROR';
  payload: {
    participantId: ParticipantId;
    error: string;
  };
}

// ─── Background ↔ Offscreen ──────────────────────────────────────────────────

export interface AnalyzeFrameMessage {
  type: 'ANALYZE_FRAME';
  payload: SerializedFrameData;
}

export interface InitEngineMessage {
  type: 'INIT_ENGINE';
  payload: {
    modelBaseUrl: string;
  };
}

export interface EngineReadyMessage {
  type: 'ENGINE_READY';
}

export interface EngineErrorMessage {
  type: 'ENGINE_ERROR';
  payload: { error: string };
}

// ─── Popup / Side Panel ──────────────────────────────────────────────────────

export interface GetAllReportsMessage {
  type: 'GET_ALL_REPORTS';
}

export interface AllReportsMessage {
  type: 'ALL_REPORTS';
  payload: {
    reports: Record<ParticipantId, TrustReport>;
    participants: Record<ParticipantId, { displayName: string }>;
  };
}

export interface ExportSessionReportMessage {
  type: 'EXPORT_SESSION_REPORT';
  payload: { format: 'json' | 'pdf' };
}

export interface SessionReportReadyMessage {
  type: 'SESSION_REPORT_READY';
  payload: SessionReport;
}

// ─── Union Types ──────────────────────────────────────────────────────────────

export type ContentToBackgroundMessage =
  | FrameReadyMessage
  | ParticipantJoinedMessage
  | ParticipantLeftMessage
  | AudioLevelMessage
  | GetSettingsMessage
  | UpdateSettingsMessage
  | GetSessionReportMessage
  | MeetCallStartedMessage
  | MeetCallEndedMessage
  | GetAllReportsMessage
  | ExportSessionReportMessage;

export type BackgroundToContentMessage =
  | TrustReportMessage
  | SettingsUpdatedMessage
  | AnalysisErrorMessage
  | AllReportsMessage
  | SessionReportReadyMessage;

export type BackgroundToOffscreenMessage =
  | AnalyzeFrameMessage
  | InitEngineMessage;

export type OffscreenToBackgroundMessage =
  | TrustReportMessage
  | EngineReadyMessage
  | EngineErrorMessage;

export type AnyMessage =
  | ContentToBackgroundMessage
  | BackgroundToContentMessage
  | BackgroundToOffscreenMessage
  | OffscreenToBackgroundMessage;

// ─── Type Guards ──────────────────────────────────────────────────────────────

export function isTrustReportMessage(msg: AnyMessage): msg is TrustReportMessage {
  return msg.type === 'TRUST_REPORT';
}

export function isFrameReadyMessage(msg: AnyMessage): msg is FrameReadyMessage {
  return msg.type === 'FRAME_READY';
}

export function isAnalyzeFrameMessage(msg: AnyMessage): msg is AnalyzeFrameMessage {
  return msg.type === 'ANALYZE_FRAME';
}

// ─── Messenger Utility ────────────────────────────────────────────────────────

export function sendToBackground(
  message: ContentToBackgroundMessage
): Promise<BackgroundToContentMessage | undefined> {
  return chrome.runtime.sendMessage(message);
}

export function sendToContent(
  tabId: number,
  message: BackgroundToContentMessage
): Promise<void> {
  return chrome.tabs.sendMessage(tabId, message);
}
