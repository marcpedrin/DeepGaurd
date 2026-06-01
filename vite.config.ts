import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        // ── ONNX Runtime Web WASM ──────────────────────────────────────────
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: '.',
        },
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm*.js',
          dest: '.',
        },

        // ── MediaPipe Tasks Vision WASM ────────────────────────────────────
        // Copied to dist/mediapipe/ so chrome.runtime.getURL('mediapipe/') works
        {
          src: 'node_modules/@mediapipe/tasks-vision/wasm/*',
          dest: 'mediapipe',
        },

        // ── Model files ────────────────────────────────────────────────────
        {
          src: 'src/models/*.onnx',
          dest: 'models',
        },
        {
          // MediaPipe face landmarker model (downloaded by npm run setup)
          src: 'src/models/face_landmarker.task',
          dest: 'models',
        },
        {
          // Optional deepfake classifier metadata sidecar
          src: 'src/models/deepfake_classifier.json',
          dest: 'models',
        },

        // ── Extension assets ───────────────────────────────────────────────
        {
          src: 'public/icons/*',
          dest: 'icons',
        },
        {
          src: 'src/popup/index.html',
          dest: 'popup',
        },
        {
          src: 'src/sidepanel/index.html',
          dest: 'sidepanel',
        },
        {
          src: 'src/offscreen/index.html',
          dest: 'offscreen',
        },
        {
          src: 'manifest.json',
          dest: '.',
        },
      ],
    }),
  ],

  resolve: {
    alias: {
      '@shared':     resolve(__dirname, 'src/shared'),
      '@ui':         resolve(__dirname, 'src/ui'),
      '@content':    resolve(__dirname, 'src/content'),
      '@offscreen':  resolve(__dirname, 'src/offscreen'),
      '@background': resolve(__dirname, 'src/background'),
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,   // Keep readable for extension debugging
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'content/index':             resolve(__dirname, 'src/content/index.ts'),
        'content/overlay':           resolve(__dirname, 'src/ui/styles/overlay.css'),
        'offscreen/index':           resolve(__dirname, 'src/offscreen/index.ts'),
        'popup/index':               resolve(__dirname, 'src/popup/index.tsx'),
        'sidepanel/index':           resolve(__dirname, 'src/sidepanel/index.tsx'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'shared/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            if (assetInfo.name.includes('overlay')) return 'content/overlay.css';
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
      // Prevent Rollup from trying to bundle the mediapipe dynamic import
      external: [],
    },
  },

  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },

  // Optimise mediapipe for browser (it uses optional chaining etc.)
  optimizeDeps: {
    include: ['@mediapipe/tasks-vision'],
  },

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
    },
  },
});
