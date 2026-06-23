# 🛡️ DeepGuard — Real-Time Deepfake Detection for Google Meet

> **All processing is 100% local. No video frames, audio, or participant data ever leave your device.**

DeepGuard is a Chrome Extension (Manifest V3) that analyses participant video streams in Google Meet calls in real time, estimating the probability that a participant is using a deepfake, AI avatar, face-swap, or synthetic video feed.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🔍 Face Detection | YCrCb skin-tone heuristic with synthetic 478-point mesh fallback |
| ⏱ Temporal Analysis | Frame-to-frame luminance delta tracking for motion consistency |
| 🎭 AI Avatar Detection | Texture variance analysis to detect GAN over-smoothing |
| 📊 Trust Score | Weighted ensemble → Face Auth + Temporal + Lip Sync + Avatar Risk |
| 🎨 Overlay UI | Glassmorphism card per participant with expandable score breakdown |
| 📋 Session Report | Full JSON export of all participants' score history |
| ⚙️ Settings | Toggle analysis modules, FPS, and alert threshold from side panel |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Google Meet Tab (meet.google.com)                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Content Script (self-contained IIFE bundle)             │   │
│  │  ├── MeetObserver  — video-element-first DOM scan        │   │
│  │  ├── FrameCapturer — OffscreenCanvas @ 1–2 FPS           │   │
│  │  ├── LocalAnalyzer — inline YCrCb + temporal analysis    │   │
│  │  └── OverlayManager — Shadow DOM + React per participant  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                  │ chrome.runtime.sendMessage                    │
└──────────────────┼──────────────────────────────────────────────┘
                   │
      ┌────────────▼────────────┐
      │  Background Service     │
      │  Worker (MV3)           │
      │  ├── Tab lifecycle      │
      │  ├── Message routing    │
      │  └── Session storage    │
      └─────────────────────────┘
                   │
      ┌────────────▼────────────┐     ┌──────────────────────┐
      │  Side Panel             │     │  Offscreen Document  │
      │  ├── Live score cards   │     │  (future: ONNX ML)   │
      │  ├── Settings toggles   │     │  ├── InferenceEngine  │
      │  └── JSON export        │     │  ├── FaceDetector     │
      └─────────────────────────┘     │  └── DeepfakeClassif.│
                                      └──────────────────────┘
```

**Current analysis pipeline (inline, no offscreen doc required):**
```
Video Element → FrameCapturer → LocalAnalyzer → TrustReport → Overlay + SidePanel
                (OffscreenCanvas)  (YCrCb skin +    (scored 0–100)
                                   temporal delta)
```

---

## 📁 Project Structure

```
DeepGuard/
├── manifest.json                    ← MV3 manifest
├── package.json
├── vite.config.ts                   ← Two-phase build (IIFE + ES modules)
│
├── src/
│   ├── shared/
│   │   ├── types.ts                 ← All domain types (TrustReport, etc.)
│   │   ├── messaging.ts             ← Typed Chrome message protocol
│   │   └── constants.ts             ← Thresholds, model paths, selectors
│   │
│   ├── background/
│   │   └── service-worker.ts        ← Tab lifecycle, message routing, session
│   │
│   ├── offscreen/
│   │   ├── index.html + index.ts    ← Offscreen document (future ML upgrade)
│   │   ├── inference-engine.ts      ← Pipeline orchestrator
│   │   ├── face-detector.ts         ← MediaPipe FaceLandmarker (optional)
│   │   ├── deepfake-classifier.ts   ← ONNX binary classifier (optional)
│   │   ├── temporal-analyzer.ts     ← Frame-to-frame landmark consistency
│   │   ├── lip-sync-analyzer.ts     ← Audio/visual sync
│   │   ├── avatar-detector.ts       ← Heuristic avatar rules
│   │   └── trust-scorer.ts          ← Weighted ensemble scorer
│   │
│   ├── content/
│   │   ├── index.ts                 ← Entry point + inline analysis engine
│   │   ├── meet-observer.ts         ← Video-element-first participant discovery
│   │   ├── frame-capturer.ts        ← OffscreenCanvas frame extraction
│   │   ├── overlay-manager.ts       ← Shadow DOM + React overlays
│   │   └── audio-capture.ts         ← Microphone RMS level
│   │
│   ├── ui/components/
│   │   ├── TrustCard.tsx            ← Main overlay card (expandable)
│   │   ├── RadialGauge.tsx          ← SVG radial score gauge
│   │   ├── ScoreBar.tsx             ← Sub-score progress bar
│   │   └── StatusBadge.tsx          ← REAL / SUSPICIOUS / SYNTHETIC pill
│   │
│   ├── popup/
│   │   └── Popup.tsx                ← Quick status + enable toggle
│   │
│   ├── sidepanel/
│   │   └── SidePanel.tsx            ← Full session dashboard
│   │
│   └── models/
│       └── README.md                ← Model download + swap guide
│
├── public/icons/                    ← Extension icons (16/32/48/128px)
│
└── tests/
    ├── setup.ts                     ← Chrome API mocks
    ├── unit/                        ← Vitest unit tests
    └── integration/                 ← Pipeline integration tests
```

---

## 🚀 Installation

### Prerequisites

- Node.js 20+
- npm 10+
- Google Chrome 120+

### Steps

```bash
# 1. Enter the project directory
cd DeepGaurd

# 2. Install dependencies
npm install

# 3. Build the extension
npm run build

# 4. Load in Chrome
#    a. Open chrome://extensions
#    b. Enable "Developer mode" (toggle — top right)
#    c. Click "Load unpacked"
#    d. Select the  dist/  folder
#       → Full path: DeepGaurd/DeepGaurd/dist
```

> **After any code change:** run `npm run build`, then click the **↻ refresh icon** on the extension in `chrome://extensions`, then reload your Meet tab.

---

## 🛠️ Build Commands

```bash
npm run build          # Production build → dist/
npm run dev            # Watch mode (rebuilds on save)
npm run type-check     # TypeScript check (no emit)
npm test               # Vitest unit + integration tests
npm run test:coverage  # Coverage report
npm run clean          # Remove dist/
```

---

## ⚙️ How the Build Works

The extension uses a **two-phase Vite build** to work around a Chrome content script restriction:

> Chrome content scripts are injected as **classic `<script>` tags** — they cannot use ES module `import` statements.

| Entry | Format | Why |
|---|---|---|
| `content/index.ts` | **IIFE** (all deps inlined, ~266 KB) | Classic script injection — no imports allowed |
| `background/service-worker.ts` | **ES module** | Service workers support `type: "module"` |
| `popup/`, `sidepanel/`, `offscreen/` | **ES modules** + shared chunks | Run inside HTML pages that support modules |

---

## 📊 Trust Score Explained

```
Trust Score = 0.35 × Face Authenticity      (skin-tone + texture variance)
            + 0.25 × Temporal Consistency    (frame-to-frame luminance delta)
            + 0.20 × Lip Sync               (audio vs. mouth-open ratio)
            + 0.20 × Avatar Risk             (texture uniformity heuristic)
```

| Status | Trust Score | Badge |
|---|---|---|
| 🟢 REAL | ≥ 80% | Green |
| 🟡 SUSPICIOUS | 50–79% | Amber |
| 🔴 LIKELY SYNTHETIC | < 50% | Red |
| ⚫ NO FACE | — | Grey |

---

## 🔬 Analysis Techniques

### Face Detection (Heuristic Fallback)
When the optional MediaPipe model is absent, the extension uses a **YCrCb colour-space skin segmentation** to detect face presence:
- Y (luminance): 80–240
- Cr: 133–173
- Cb: 77–127

Skin pixel ratio > 3% with > 20 skin pixels → face detected.

### Temporal Consistency
Tracks per-participant **average luminance** over a rolling 8-frame buffer:
- Delta < 0.5 → suspiciously static (score: 60%)
- Delta 0.5–30 → natural variation (score: 90%)
- Delta > 30 → erratic (score: 70%)

### Avatar / GAN Detection
Measures **R-channel pixel variance** across the frame:
- Variance < 200 → overly uniform texture (GAN tell) → avatar risk score drops
- Variance 200–400 → mildly uniform
- Variance > 400 → natural texture

### Participant Discovery
Google Meet uses obfuscated class names and does **not** expose `data-participant-id` attributes. DeepGuard uses a **video-element-first** strategy:
1. Queries all `<video>` elements
2. Filters by `videoWidth/Height ≥ 48px` and `readyState ≥ 2`
3. Builds stable IDs from `data-ssrc` / `jsname` ancestor attributes or DOM-path hashing
4. Extracts names from `aria-label`, `data-display-name`, or nearby `<span>` text

---

## 🔒 Privacy

- ✅ All analysis runs **100% locally** in the browser — no cloud calls
- ✅ No video frames, audio, or landmark data are transmitted externally
- ✅ No external APIs are called during analysis
- ✅ Session reports stored locally via `chrome.storage.local`
- ✅ Extension only activates on `https://meet.google.com/*`

---

## 📈 Performance

| Metric | Value | Notes |
|---|---|---|
| Analysis latency | < 5ms / frame | Inline pixel analysis, no ONNX |
| Content script size | ~266 KB | Self-contained IIFE (React + all logic inlined) |
| Frame capture rate | 1–2 FPS | Configurable in settings |
| Max participants | 10 | Parallel per-participant capture jobs |
| Memory footprint | < 50 MB | No ONNX models loaded in basic mode |

---

## 🗺️ Roadmap

- [ ] **MediaPipe FaceLandmarker** integration (478-point 3D mesh) for precise lip-sync
- [ ] **ONNX deepfake classifier** (ViT / MobileNetV3 fine-tuned on FaceForensics++) via offscreen document
- [ ] Alert notifications when trust score drops below threshold
- [ ] Session history view in side panel
- [ ] Firefox support (MV3)

---

## License

MIT © DeepGuard Contributors
