# 🛡 DeepGuard — Real-Time Deepfake Detection for Google Meet

> **All processing is 100% local. No video frames, audio, or participant data ever leave your device.**

DeepGuard is a production-ready Chrome Extension (Manifest V3) that analyses participant video streams in Google Meet calls in real time and estimates the probability that a participant is using a deepfake, AI avatar, face-swap, or synthetic video feed.

---

## Features

| Feature | Details |
|---|---|
| 🔍 Face Detection | MediaPipe Face Mesh (468 landmarks) via ONNX Runtime Web |
| 🤖 Deepfake Classification | MobileNetV3-based binary classifier (FaceForensics++ compatible) |
| ⏱ Temporal Analysis | Jitter, warp artifacts, lighting deltas across frames |
| 👄 Lip Sync | Mouth-open ratio vs. audio RMS mismatch detection |
| 🎭 AI Avatar Detection | Heuristic engine for Synthesia/HeyGen/face-swap signatures |
| 📊 Trust Score | Weighted ensemble → Face Auth + Temporal + Lip Sync + Avatar Risk |
| 🎨 Overlay UI | Non-intrusive glassmorphism card per participant |
| 📋 Session Report | Full JSON export of all participants' score history |
| ⚙️ Settings | Toggle analysis, FPS, alert threshold from side panel |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Google Meet Tab                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Content Script                                          │   │
│  │  ├── MeetObserver (MutationObserver + periodic scan)     │   │
│  │  ├── FrameCapturer (OffscreenCanvas @ 1–2 FPS)           │   │
│  │  ├── AudioCapture (Web Audio API, RMS @ 10 Hz)           │   │
│  │  └── OverlayManager (Shadow DOM + React per participant) │   │
│  └──────────────────────────────────────────────────────────┘   │
│                         │ chrome.runtime.sendMessage            │
└─────────────────────────┼───────────────────────────────────────┘
                          │
             ┌────────────▼────────────┐
             │  Background Service     │
             │  Worker (MV3)           │
             │  ├── Tab lifecycle      │
             │  ├── Message routing    │
             │  └── Session state      │
             └────────────┬────────────┘
                          │
             ┌────────────▼────────────┐
             │  Offscreen Document     │
             │  ├── InferenceEngine    │
             │  │   ├── FaceDetector   │  ← ONNX face_mesh.onnx
             │  │   ├── Deepfake       │  ← ONNX deepfake_classifier.onnx
             │  │   ├── TemporalAnalyzer│
             │  │   ├── LipSyncAnalyzer│
             │  │   ├── AvatarDetector │
             │  │   └── TrustScorer    │
             │  └────────────────────  │
             └─────────────────────────┘
```

**Message flow:**
```
Content Script → [FRAME_READY] → Background SW → [ANALYZE_FRAME] → Offscreen
Offscreen → [TRUST_REPORT] → Background SW → [TRUST_REPORT] → Content Script → Overlay UI
```

---

## Project Structure

```
DeepGuard/
├── manifest.json                    ← MV3 manifest
├── package.json
├── vite.config.ts                   ← Multi-entry build
├── tailwind.config.ts
├── playwright.config.ts
│
├── src/
│   ├── shared/
│   │   ├── types.ts                 ← All domain types
│   │   ├── messaging.ts             ← Typed Chrome message protocol
│   │   └── constants.ts             ← Thresholds, model paths, selectors
│   │
│   ├── background/
│   │   └── service-worker.ts        ← Tab lifecycle, message routing, session
│   │
│   ├── offscreen/
│   │   ├── index.html + index.ts    ← Offscreen document entry
│   │   ├── inference-engine.ts      ← Pipeline orchestrator
│   │   ├── face-detector.ts         ← Face Mesh ONNX inference
│   │   ├── deepfake-classifier.ts   ← Binary classifier
│   │   ├── temporal-analyzer.ts     ← Frame-to-frame consistency
│   │   ├── lip-sync-analyzer.ts     ← Audio/visual sync
│   │   ├── avatar-detector.ts       ← Heuristic avatar rules
│   │   └── trust-scorer.ts          ← Weighted ensemble
│   │
│   ├── content/
│   │   ├── index.ts                 ← Entry point, call detection
│   │   ├── meet-observer.ts         ← DOM participant discovery
│   │   ├── frame-capturer.ts        ← OffscreenCanvas frame extraction
│   │   ├── overlay-manager.ts       ← Shadow DOM + React overlays
│   │   └── audio-capture.ts         ← Microphone RMS level
│   │
│   ├── ui/components/
│   │   ├── TrustCard.tsx            ← Main overlay card
│   │   ├── RadialGauge.tsx          ← SVG score gauge
│   │   ├── ScoreBar.tsx             ← Sub-score progress bar
│   │   └── StatusBadge.tsx          ← REAL / SUSPICIOUS / SYNTHETIC pill
│   │
│   ├── popup/
│   │   ├── index.html + index.tsx
│   │   └── Popup.tsx                ← Quick status + toggle
│   │
│   ├── sidepanel/
│   │   ├── index.html + index.tsx
│   │   └── SidePanel.tsx            ← Full session dashboard
│   │
│   └── models/
│       ├── README.md                ← Model download + swap guide
│       └── model-loader.ts          ← ONNX session cache + stub fallback
│
├── public/icons/                    ← Extension icons (16/32/48/128px)
│
└── tests/
    ├── setup.ts                     ← Chrome API mocks
    ├── unit/                        ← Vitest unit tests
    ├── integration/                 ← Pipeline integration tests
    ├── e2e/                         ← Playwright browser tests
    └── fixtures/mock-meet.html      ← Synthetic Meet page
```

---

## Installation

### Prerequisites

- Node.js 20+
- npm 10+
- Google Chrome 120+

### Steps

```bash
# 1. Clone / open the project
cd DeepGaurd

# 2. Install dependencies
npm install

# 3. (Optional) Download ONNX models — see src/models/README.md
#    Without models, the extension uses built-in stub outputs for development.

# 4. Build the extension
npm run build

# 5. Load in Chrome
#    a. Open chrome://extensions
#    b. Enable "Developer mode" (top right)
#    c. Click "Load unpacked"
#    d. Select the  dist/  folder
```

---

## Build Commands

```bash
npm run build         # Production build to dist/
npm run dev           # Watch mode (rebuilds on save)
npm run type-check    # TypeScript type checking (no emit)
npm test              # Vitest unit + integration tests
npm run test:watch    # Vitest watch mode
npm run test:coverage # Coverage report
npm run test:e2e      # Playwright E2E tests (requires built dist/)
npm run clean         # Remove dist/
```

---

## Adding Real ONNX Models

See [`src/models/README.md`](src/models/README.md) for detailed instructions.

**Quick summary:**
1. Download a FaceForensics++ compatible model checkpoint
2. Export to ONNX using the provided export script
3. Place `deepfake_classifier.onnx` and `face_mesh.onnx` in `src/models/`
4. Run `npm run build` — the models are automatically copied to `dist/models/`

---

## Trust Score Explained

```
Trust Score = 0.35 × Face Authenticity
            + 0.25 × Temporal Consistency
            + 0.20 × Lip Sync
            + 0.20 × (1 − Avatar Risk)
```

| Status          | Trust Score | Badge  |
|-----------------|-------------|--------|
| 🟢 Real         | ≥ 80%       | Green  |
| 🟡 Suspicious   | 50–79%      | Amber  |
| 🔴 Likely Synthetic | < 50%   | Red    |

---

## Privacy

- ✅ All ML inference runs in the browser via ONNX Runtime Web (WASM backend)
- ✅ No video frames, audio samples, or landmark data are transmitted
- ✅ No external APIs are called
- ✅ Session reports are stored locally in `chrome.storage.local`
- ✅ Extension only activates on `https://meet.google.com/*`

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Inference latency | < 200ms / frame | With stub; real model may vary |
| Memory | < 500MB | With INT8 quantised models |
| Frame rate | 1–2 FPS | Configurable |
| Participants | Up to 10 | Parallel per-participant queues |

---

## License

MIT © DeepGuard Contributors
