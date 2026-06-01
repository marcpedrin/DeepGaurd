"""
DeepGuard — Deepfake Classifier Model Converter

Downloads a pre-trained deepfake detection model from Hugging Face
and exports it to ONNX format for use with ONNX Runtime Web.

Target model: dima806/deepfake_vs_real_image_detection
  - ViT-base fine-tuned on real/deepfake face images
  - ~327 MB ONNX export
  - Input: pixel_values [1, 3, 224, 224]  (ViT normalised: mean=0.5, std=0.5)
  - Output: logits [1, 2]  (index 0 = Fake, index 1 = Real)

Usage:
  pip install -r scripts/requirements.txt
  python scripts/convert_deepfake_model.py

The exported deepfake_classifier.onnx is saved to src/models/ and
automatically picked up by the next  npm run build.
"""

import os
import sys
import shutil
from pathlib import Path

ROOT = Path(__file__).parent.parent
MODELS = ROOT / "src" / "models"
MODELS.mkdir(parents=True, exist_ok=True)

OUTPUT_PATH = MODELS / "deepfake_classifier.onnx"
TMP_DIR     = ROOT / ".model_tmp"

def check_deps():
    missing = []
    for pkg in ["torch", "transformers", "optimum", "onnx", "onnxruntime"]:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
    if missing:
        print(f"\n✗ Missing packages: {', '.join(missing)}")
        print("  Run:  pip install -r scripts/requirements.txt\n")
        sys.exit(1)

def main():
    print("\n🛡  DeepGuard — Deepfake Classifier Export")
    print("=" * 50)

    check_deps()

    import torch
    from transformers import AutoFeatureExtractor
    from optimum.onnxruntime import ORTModelForImageClassification

    MODEL_ID = "dima806/deepfake_vs_real_image_detection"

    if OUTPUT_PATH.exists() and OUTPUT_PATH.stat().st_size > 100_000:
        print(f"\n✓ Already exported: {OUTPUT_PATH}")
        size_mb = OUTPUT_PATH.stat().st_size / 1024 / 1024
        print(f"  Size: {size_mb:.1f} MB")
        print("\n✅ Done. Run: npm run build\n")
        return

    print(f"\n→ Downloading model from HuggingFace: {MODEL_ID}")
    print("  (This may take a few minutes on first run — ~300 MB download)")
    print()

    try:
        # Export to ONNX directly using optimum
        model = ORTModelForImageClassification.from_pretrained(
            MODEL_ID,
            export=True,
            provider="CPUExecutionProvider",
        )

        # Save to tmp dir first
        TMP_DIR.mkdir(parents=True, exist_ok=True)
        model.save_pretrained(str(TMP_DIR))

        # Find the model.onnx file
        candidate = TMP_DIR / "model.onnx"
        if not candidate.exists():
            # Some optimum versions save to subdirs
            for f in TMP_DIR.rglob("*.onnx"):
                candidate = f
                break

        if not candidate.exists():
            raise FileNotFoundError("ONNX export did not produce model.onnx")

        shutil.copy(candidate, OUTPUT_PATH)
        shutil.rmtree(TMP_DIR, ignore_errors=True)

        size_mb = OUTPUT_PATH.stat().st_size / 1024 / 1024
        print(f"\n✓ Exported: {OUTPUT_PATH}")
        print(f"  Size: {size_mb:.1f} MB")

    except Exception as e:
        print(f"\n✗ Export failed: {e}")
        print()
        print("  Troubleshooting:")
        print("  1. Ensure you have internet access to huggingface.co")
        print("  2. Try: HF_HUB_ENABLE_HF_TRANSFER=1 python scripts/convert_deepfake_model.py")
        print("  3. Or manually download from:")
        print(f"     https://huggingface.co/{MODEL_ID}")
        print("     and place model.onnx as src/models/deepfake_classifier.onnx")
        print()
        print("  ℹ  The extension still works without the ONNX classifier.")
        print("     DCT frequency-domain analysis is used as a fallback.")
        shutil.rmtree(TMP_DIR, ignore_errors=True)
        sys.exit(1)

    # Print model I/O info for verification
    try:
        import onnxruntime as ort
        sess = ort.InferenceSession(str(OUTPUT_PATH), providers=["CPUExecutionProvider"])
        print("\n  Model I/O verification:")
        for inp in sess.get_inputs():
            print(f"    Input : {inp.name} {inp.shape} ({inp.type})")
        for out in sess.get_outputs():
            print(f"    Output: {out.name} {out.shape} ({out.type})")
        
        # Write a metadata sidecar so the extension knows the input/output names
        meta_path = MODELS / "deepfake_classifier.json"
        import json
        meta = {
            "model_id": MODEL_ID,
            "input_name": sess.get_inputs()[0].name,
            "output_name": sess.get_outputs()[0].name,
            "input_shape": sess.get_inputs()[0].shape,
            "normalization": {"mean": [0.5, 0.5, 0.5], "std": [0.5, 0.5, 0.5]},
            "label_map": {"0": "Fake", "1": "Real"},
        }
        meta_path.write_text(json.dumps(meta, indent=2))
        print(f"\n  Metadata saved: {meta_path.name}")
    except Exception:
        pass  # metadata is optional

    print("\n✅ Done. Run: npm run build\n")


if __name__ == "__main__":
    main()
