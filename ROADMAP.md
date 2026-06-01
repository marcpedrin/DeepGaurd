# DeepGuard — Future Improvement Roadmap

## v1.1 — Model Quality
- [ ] **Fine-tuned EfficientNet-B4** trained on FaceForensics++ C23/C40 compressions
- [ ] **XceptionNet** alternative classifier with swap guide
- [ ] **Quantised INT8 models** with `quantize_dynamic` scripts for all architectures
- [ ] **Model update mechanism** — pull new model weights from a signed GCS URL (opt-in)
- [ ] **Ensemble voting** between multiple classifier heads (majority vote reduces false positives)

## v1.2 — Detection Accuracy
- [ ] **Optical flow** between frames using a lightweight RAFT-tiny ONNX export
- [ ] **GAN artifact frequency analysis** — detect GAN checkerboard artifacts in the DCT domain
- [ ] **BlendFace / SimSwap detection** — signature blending boundary detection
- [ ] **Virtual camera fingerprinting** — detect OBS Virtual Camera, XSplit, ManyCam via MediaDevices API
- [ ] **Replay detection** — perceptual hash similarity across a longer window (30+ frames)

## v1.3 — Platform Support
- [ ] **Firefox** support (MV3 compatible subset — offscreen document polyfill)
- [ ] **Zoom** integration via DOM injection (Zoom Web Client)
- [ ] **Microsoft Teams** (Teams Web App)
- [ ] **Webex** support

## v1.4 — Performance
- [ ] **WebGPU backend** — 10× faster inference via `ort.InferenceSession.create(..., { executionProviders: ['webgpu'] })`
- [ ] **SharedArrayBuffer + Worker** — dedicated inference thread when available
- [ ] **Frame queue prioritisation** — analyse speaking participants more frequently
- [ ] **Adaptive FPS** — dynamically increase to 3–5 FPS when a suspicious participant is detected

## v1.5 — UX & Reporting
- [ ] **Timeline chart** — visual trust score history per participant in the side panel
- [ ] **PDF export** — session authenticity report with logo, timestamps, and participant summaries
- [ ] **Alert notifications** — `chrome.notifications` toast when a participant drops below threshold
- [ ] **Confidence intervals** — display uncertainty range around the trust score
- [ ] **Explanation tooltips** — human-readable explanation of each flag ("Overly smooth motion detected — may indicate a synthetic avatar")

## v2.0 — Advanced Analysis
- [ ] **Audio deepfake detection** — voice cloning detection using LFCC/MFCC feature analysis
- [ ] **Aggregate anomaly correlation** — opt-in server-side correlation of anomaly patterns across sessions (federated, anonymised)
- [ ] **Android Chrome** extension support (Chrome Extensions on Android)
- [ ] **Plug-in model registry** — community-contributed ONNX models with integrity verification
- [ ] **Liveness detection** — challenge-response (blink detection) to confirm live presence
