/**
 * DeepGuard — Core Domain Types
 * All processing is local; no data leaves the device.
 */

// ─── Participant ─────────────────────────────────────────────────────────────

export type ParticipantId = string;

export interface Participant {
  id: ParticipantId;
  displayName: string;
  videoElement: HTMLVideoElement;
  isLocal: boolean;
}

// ─── Frame Data ───────────────────────────────────────────────────────────────

export interface FrameData {
  participantId: ParticipantId;
  /** Raw RGBA pixel data (width × height × 4) */
  imageData: ImageData;
  width: number;
  height: number;
  timestamp: number;
  frameIndex: number;
}

export interface SerializedFrameData {
  participantId: ParticipantId;
  /** Transferable pixel buffer */
  buffer: ArrayBuffer;
  width: number;
  height: number;
  timestamp: number;
  frameIndex: number;
}

// ─── Face Detection ───────────────────────────────────────────────────────────

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface FaceLandmark {
  x: number;
  y: number;
  z: number;
}

export type FaceMesh = FaceLandmark[]; // 468 landmarks

export interface FaceDetectionResult {
  detected: boolean;
  boundingBox: BoundingBox | null;
  mesh: FaceMesh | null;
  /** Mouth open ratio for lip-sync */
  mouthOpenRatio: number;
  /** Eye blink state */
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
}

// ─── Detection Sub-Scores ─────────────────────────────────────────────────────

export interface DeepfakeClassifierResult {
  /** 0 = real, 1 = fake */
  deepfakeConfidence: number;
  /** Raw model logits */
  logits: [number, number];
}

export interface TemporalAnalysisResult {
  /** 0 = unstable, 1 = perfectly consistent */
  temporalConsistency: number;
  /** Landmark jitter magnitude */
  jitterScore: number;
  /** Inter-frame optical-flow instability */
  warpScore: number;
  /** Lighting delta between consecutive frames */
  lightingDelta: number;
  /** Frame count used for this analysis */
  frameCount: number;
}

export interface LipSyncResult {
  /** 0 = mismatch, 1 = perfect sync */
  lipSyncConfidence: number;
  /** Whether audio was available for analysis */
  audioAvailable: boolean;
  /** Mouth open ratio at time of analysis */
  mouthOpenRatio: number;
  /** Audio RMS level at time of analysis */
  audioRms: number;
}

export interface AvatarDetectionResult {
  /** 0 = human, 1 = avatar/synthetic */
  avatarRiskScore: number;
  /** Individual heuristic flags */
  flags: AvatarFlags;
}

export interface AvatarFlags {
  /** Suspiciously smooth landmark motion (too-low jitter) */
  overly_smooth_motion: boolean;
  /** High cosine similarity between distant frames — loop detection */
  video_loop_detected: boolean;
  /** GAN over-smoothing: unnaturally uniform texture */
  texture_uniformity: boolean;
  /** Hard green-screen / virtual background artifacts at face edges */
  edge_artifact: boolean;
  /** Background is completely static while face moves */
  static_background: boolean;
}

// ─── Trust Report ─────────────────────────────────────────────────────────────

export type ParticipantStatus = 'REAL' | 'SUSPICIOUS' | 'LIKELY_SYNTHETIC' | 'ANALYZING' | 'NO_FACE';

export interface TrustScores {
  /** Face authenticity from deepfake classifier (0–100) */
  faceAuthenticity: number;
  /** Temporal consistency across frames (0–100) */
  temporalConsistency: number;
  /** Lip-sync confidence (0–100) */
  lipSync: number;
  /** AI avatar risk — inverted: high value = low risk (0–100) */
  avatarRisk: number;
}

export interface TrustReport {
  participantId: ParticipantId;
  timestamp: number;
  frameIndex: number;
  scores: TrustScores;
  /** Weighted aggregate (0–100) */
  overallTrustScore: number;
  status: ParticipantStatus;
  avatarFlags: AvatarFlags;
  faceDetected: boolean;
  analysisLatencyMs: number;
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface SessionReport {
  sessionId: string;
  startTime: number;
  endTime: number;
  participants: ParticipantSessionSummary[];
  extensionVersion: string;
}

export interface ParticipantSessionSummary {
  participantId: ParticipantId;
  displayName: string;
  framesAnalyzed: number;
  averageTrustScore: number;
  lowestTrustScore: number;
  finalStatus: ParticipantStatus;
  scoreHistory: TrustReport[];
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface DeepGuardSettings {
  enabled: boolean;
  targetFps: 1 | 2;
  showOverlay: boolean;
  alertThreshold: number; // 0–100
  enableLipSync: boolean;
  enableAvatarDetection: boolean;
  enableTemporalAnalysis: boolean;
}

export const DEFAULT_SETTINGS: DeepGuardSettings = {
  enabled: true,
  targetFps: 1,
  showOverlay: true,
  alertThreshold: 60,
  enableLipSync: true,
  enableAvatarDetection: true,
  enableTemporalAnalysis: true,
};
