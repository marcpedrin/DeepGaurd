#!/usr/bin/env node
/**
 * DeepGuard — Model Setup Script
 *
 * Downloads the MediaPipe FaceLandmarker model and optionally guides
 * through deepfake classifier setup. Run once before building.
 *
 * Usage:
 *   node scripts/download_models.js
 *   node scripts/download_models.js --skip-classifier
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');
const MODELS    = path.join(ROOT, 'src', 'models');

// ─── URLs ─────────────────────────────────────────────────────────────────────

const FACE_LANDMARKER_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

const FACE_LANDMARKER_DEST = path.join(MODELS, 'face_landmarker.task');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      const size = fs.statSync(dest).size;
      if (size > 100_000) {
        console.log(`  ✓ Already present: ${path.basename(dest)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
        return resolve(dest);
      }
    }

    console.log(`  ↓ Downloading ${path.basename(dest)}...`);
    const file = fs.createWriteStream(dest);
    let downloaded = 0;
    let total = 0;

    const makeRequest = (url) => {
      https.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // Follow redirect
          return makeRequest(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }

        total = parseInt(res.headers['content-length'] || '0', 10);
        let lastLog = 0;

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          const pct = total > 0 ? Math.floor((downloaded / total) * 100) : 0;
          if (pct - lastLog >= 10) {
            process.stdout.write(`\r    ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
            lastLog = pct;
          }
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          process.stdout.write('\n');
          const finalSize = fs.statSync(dest).size;
          console.log(`  ✓ Saved: ${path.basename(dest)} (${(finalSize / 1024 / 1024).toFixed(1)} MB)`);
          resolve(dest);
        });
        res.on('error', (err) => {
          file.close();
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          reject(err);
        });
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
    };

    makeRequest(url);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🛡  DeepGuard — Model Setup\n');
  fs.mkdirSync(MODELS, { recursive: true });

  // ── 1. MediaPipe FaceLandmarker ─────────────────────────────────────────────
  console.log('Step 1/2 — Face Landmark Model (MediaPipe)');
  try {
    await downloadFile(FACE_LANDMARKER_URL, FACE_LANDMARKER_DEST);
  } catch (err) {
    console.error(`  ✗ Failed to download face_landmarker.task: ${err.message}`);
    console.error('    The extension will fall back to stub face detection.');
  }

  // ── 2. Deepfake Classifier ──────────────────────────────────────────────────
  console.log('\nStep 2/2 — Deepfake Classifier');

  const classifierPath = path.join(MODELS, 'deepfake_classifier.onnx');
  if (fs.existsSync(classifierPath) && fs.statSync(classifierPath).size > 100_000) {
    console.log(`  ✓ Already present: deepfake_classifier.onnx`);
  } else {
    console.log('  ℹ  No ONNX classifier found. Two options:');
    console.log();
    console.log('  Option A — Auto-download via Python (recommended):');
    console.log('    pip install -r scripts/requirements.txt');
    console.log('    python scripts/convert_deepfake_model.py');
    console.log();
    console.log('  Option B — The extension will use DCT/frequency-domain');
    console.log('    analysis for deepfake detection (no model file needed).');
    console.log('    This is real inference — just without the neural classifier.');
    console.log();
    console.log('  The extension builds and runs either way. Adding the ONNX');
    console.log('  file improves detection accuracy significantly.');
  }

  // ── 3. Done ─────────────────────────────────────────────────────────────────
  console.log('\n✅  Setup complete. Run:  npm run build\n');
}

main().catch((err) => {
  console.error('\n✗ Setup failed:', err.message);
  process.exit(1);
});
