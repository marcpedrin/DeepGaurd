/**
 * DeepGuard — Application Constants
 */

// ─── Model Paths (relative to extension root) ────────────────────────────────

export const MODEL_PATHS = {
  /** ONNX deepfake binary classifier (ViT fine-tuned on deepfake faces) */
  DEEPFAKE_CLASSIFIER: 'models/deepfake_classifier.onnx',
} as const;

/** MediaPipe FaceLandmarker model (downloaded by npm run setup) */
export const FACE_LANDMARKER_MODEL = 'models/face_landmarker.task';

/** MediaPipe Tasks Vision WASM directory (relative to extension root) */
export const MEDIAPIPE_WASM_PATH = 'mediapipe/';

// ─── Inference Dimensions ─────────────────────────────────────────────────────

export const CLASSIFIER_INPUT_SIZE  = 224;  // px — deepfake classifier input
export const MEDIAPIPE_LANDMARKS    = 478;  // MediaPipe FaceLandmarker (vs. 468 in old mesh)

export const DEFAULT_FPS = 1;                // frames per second
export const FRAME_INTERVAL_MS = 1000;       // 1 FPS default
export const MIN_VIDEO_DIMENSION = 48;       // skip if video is smaller than this
export const MAX_PARTICIPANTS = 10;

// ─── Temporal Analysis ────────────────────────────────────────────────────────

export const TEMPORAL_BUFFER_SIZE = 8;      // number of frames to keep in buffer
export const LOOP_DETECT_WINDOW = 6;        // compare frame N with frame N-6
export const LOOP_SIMILARITY_THRESHOLD = 0.97; // cosine similarity threshold for loop
export const SMOOTH_MOTION_THRESHOLD = 0.002;  // jitter below this = suspiciously smooth
export const LIGHTING_DELTA_THRESHOLD = 50;    // pixel intensity delta for lighting change

// ─── Trust Score Weights ──────────────────────────────────────────────────────

export const TRUST_WEIGHTS = {
  faceAuthenticity: 0.35,
  temporalConsistency: 0.25,
  lipSync: 0.20,
  avatarRisk: 0.20,   // inverted internally
} as const;

// ─── Status Thresholds ────────────────────────────────────────────────────────

export const STATUS_THRESHOLDS = {
  REAL: 80,        // ≥ 80 → REAL
  SUSPICIOUS: 50,  // 50–79 → SUSPICIOUS
  // < 50 → LIKELY_SYNTHETIC
} as const;

// ─── Lip Sync ─────────────────────────────────────────────────────────────────

export const MOUTH_OPEN_RATIO_THRESHOLD = 0.05;  // mouth open if ratio > this
export const AUDIO_RMS_THRESHOLD = 0.02;          // audio active if RMS > this
export const LIP_SYNC_HISTORY_SIZE = 10;          // frames of history for sync scoring

// ─── Avatar Detection ─────────────────────────────────────────────────────────

/** Variance of pixel intensity in face crop below which texture is deemed 'too uniform' */
export const TEXTURE_VARIANCE_THRESHOLD = 400;
/** Edge artifact detection: Laplacian gradient at face boundary */
export const EDGE_ARTIFACT_GRADIENT_THRESHOLD = 30;
/** How many frames of static background before flagging */
export const STATIC_BG_FRAME_THRESHOLD = 5;

// ─── ImageNet Normalisation (for classifier) ──────────────────────────────────

export const IMAGENET_MEAN = [0.485, 0.456, 0.406];
export const IMAGENET_STD  = [0.229, 0.224, 0.225];

// ─── Face Landmark Indices (MediaPipe 478-point FaceLandmarker) ─────────────────
//
// Official map: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
// Key indices verified against the MediaPipe FaceLandmarks478 spec.

export const LANDMARK_INDICES = {
  // Mouth outline
  UPPER_LIP_TOP:    13,   // top of upper lip (centre)
  LOWER_LIP_BOTTOM: 14,   // bottom of lower lip (centre)
  MOUTH_LEFT:       61,   // left mouth corner
  MOUTH_RIGHT:      291,  // right mouth corner
  // Eyes — upper and lower eyelids (for blink ratio)
  LEFT_EYE_TOP:     159,  // left eye upper eyelid
  LEFT_EYE_BOTTOM:  145,  // left eye lower eyelid
  RIGHT_EYE_TOP:    386,  // right eye upper eyelid
  RIGHT_EYE_BOTTOM: 374,  // right eye lower eyelid
  // Nose
  NOSE_TIP:         1,    // nose tip
  // Chin / jaw
  CHIN:             152,  // chin bottom
  // Forehead
  FOREHEAD:         10,   // top of forehead
  // Cheeks (for face box)
  LEFT_CHEEK:       234,
  RIGHT_CHEEK:      454,
} as const;

// ─── Google Meet DOM ──────────────────────────────────────────────────────────

/** Attribute selector strategies for participant video tiles */
export const MEET_SELECTORS = {
  /** Primary: data-participant-id attribute (stable) */
  PARTICIPANT_BY_DATA_ATTR: '[data-participant-id]',
  /** Fallback: video elements within Meet grid */
  VIDEO_ELEMENTS: 'video[autoplay]',
  /** Name label siblings */
  PARTICIPANT_NAME_LABEL: '[data-self-name], [data-display-name]',
  /** Meet grid container */
  GRID_CONTAINER: '[jsname="r4nke"], [jscontroller]',
} as const;

// ─── Storage Keys ─────────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  SETTINGS: 'deepguard_settings',
  SESSION_REPORTS: 'deepguard_session_reports',
} as const;

// ─── Extension ────────────────────────────────────────────────────────────────

export const EXTENSION_VERSION = '1.0.0';
export const OFFSCREEN_DOCUMENT_URL = 'offscreen/index.html';
export const MAX_ANALYSIS_LATENCY_MS = 200;
export const MAX_MEMORY_MB = 500;
