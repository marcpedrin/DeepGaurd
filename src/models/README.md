# DeepGuard — ONNX Model Files

This directory holds the ONNX model weights used by the deepfake detection pipeline.

> ⚠️ **The models are NOT bundled in the repository** due to their large file sizes.
> Follow the instructions below to download or swap in your own models.

---

## Required Models

### 1. `deepfake_classifier.onnx`
**Role:** Primary binary deepfake classifier.
**Input:** `[1, 3, 224, 224]` float32 tensor (NCHW, ImageNet normalised)
**Output:** `[1, 2]` float32 logits — `[real_score, fake_score]`

#### Option A — Stub Model (Development)
The extension ships with a built-in stub that returns plausible random outputs when
the `.onnx` file is missing. This is sufficient for UI testing and integration work.

#### Option B — Pre-trained Open-Source Weights
Download a FaceForensics++ compatible checkpoint and export to ONNX:

```bash
# Example: EfficientNet-B4 trained on FaceForensics++
# Repo: https://github.com/ondyari/FaceForensics
pip install torch torchvision timm
python scripts/export_classifier.py --checkpoint ff++_efficientnetb4.pth --output src/models/deepfake_classifier.onnx
```

#### Option C — XceptionNet (FaceForensics++ reference model)
```bash
python scripts/export_classifier.py --arch xception --checkpoint xception_c23.pth --output src/models/deepfake_classifier.onnx
```

---

### 2. `face_mesh.onnx`
**Role:** MediaPipe Face Mesh lite — outputs 468 3D landmarks.
**Input:** `[1, 3, 192, 192]` float32 tensor
**Outputs:**
  - `output_mesh_identity`: `[1, 468, 3]` landmark coordinates
  - `conv_handsegment_pred/Sigmoid:0`: `[1]` face confidence score

#### Download (official MediaPipe ONNX export)
```bash
# From the MediaPipe repository:
python scripts/export_face_mesh.py --output src/models/face_mesh.onnx
```

Or download a pre-exported version:
```
https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
```
Then convert the `.task` file to ONNX using the provided conversion script.

---

## Model Swap Checklist

When swapping in a new model, verify:
- [ ] Input tensor name matches what the loader expects (check `session.inputNames`)
- [ ] Output tensor name matches the classifier's `postprocess()` method
- [ ] Input dimensions match the `CLASSIFIER_INPUT_SIZE` constant in `src/shared/constants.ts`
- [ ] The model uses float32 (or INT8 quantised) precision — float16 may not be supported by WASM backend

---

## Memory Budget

| Model                   | Size    | Memory Usage |
|-------------------------|---------|-------------|
| Face Mesh lite (ONNX)   | ~3 MB   | ~25 MB      |
| EfficientNet-B4 (INT8)  | ~20 MB  | ~80 MB      |
| EfficientNet-B4 (FP32)  | ~74 MB  | ~250 MB     |
| XceptionNet (FP32)      | ~88 MB  | ~300 MB     |

Use quantised INT8 models to stay within the 500 MB target with 10 participants.

---

## Privacy

All models run **entirely in the browser** using ONNX Runtime Web (WASM backend).
No pixel data, landmarks, or inference results are transmitted anywhere.
