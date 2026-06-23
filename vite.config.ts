import { defineConfig, build } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

// ── Shared static-copy targets ────────────────────────────────────────────────
const copyTargets = [
  { src: 'node_modules/onnxruntime-web/dist/*.wasm',           dest: '.' },
  { src: 'node_modules/onnxruntime-web/dist/ort-wasm*.mjs',   dest: '.' },
  { src: 'node_modules/@mediapipe/tasks-vision/wasm/*',        dest: 'mediapipe' },
  { src: 'src/models/*.onnx',                                  dest: 'models' },
  { src: 'src/models/face_landmarker.task',                    dest: 'models' },
  { src: 'src/models/deepfake_classifier.json',                dest: 'models' },
  { src: 'src/ui/styles/overlay.css',                          dest: 'content' },
  { src: 'public/icons/*',                                     dest: 'icons' },
  { src: 'src/popup/index.html',                               dest: 'popup' },
  { src: 'src/sidepanel/index.html',                           dest: 'sidepanel' },
  { src: 'src/offscreen/index.html',                           dest: 'offscreen' },
  { src: 'manifest.json',                                      dest: '.' },
];

const sharedResolve = {
  alias: {
    '@shared':     resolve(__dirname, 'src/shared'),
    '@ui':         resolve(__dirname, 'src/ui'),
    '@content':    resolve(__dirname, 'src/content'),
    '@offscreen':  resolve(__dirname, 'src/offscreen'),
    '@background': resolve(__dirname, 'src/background'),
  },
};

const sharedDefine = {
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
};

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({ targets: copyTargets }),

    // ── Custom plugin: build content script + service worker as IIFE ─────────
    // Chrome content scripts are injected as classic <script> tags, NOT as
    // ES modules. They CANNOT use `import` statements. We must bundle them as
    // self-contained IIFE files with all dependencies inlined.
    {
      name: 'build-content-and-sw-as-iife',
      apply: 'build',
      async writeBundle() {
        // Build content/index as a single IIFE
        await build({
          configFile: false,
          plugins: [react()],
          resolve: sharedResolve,
          define: sharedDefine,
          build: {
            outDir:      'dist',
            emptyOutDir: false,   // Don't wipe what the main build wrote
            minify:      false,
            sourcemap:   true,
            target:      'es2022',
            rollupOptions: {
              input:  resolve(__dirname, 'src/content/index.ts'),
              output: {
                format:               'iife',   // ← self-contained, no imports
                entryFileNames:       'content/index.js',
                inlineDynamicImports: true,
                name:                 'DeepGuardContent',
              },
            },
          },
        });

        // Build background/service-worker as a self-contained ES module
        // (service workers support ES modules via "type": "module" in manifest)
        await build({
          configFile: false,
          resolve: sharedResolve,
          define: sharedDefine,
          build: {
            outDir:      'dist',
            emptyOutDir: false,
            minify:      false,
            sourcemap:   true,
            target:      'es2022',
            rollupOptions: {
              input:  resolve(__dirname, 'src/background/service-worker.ts'),
              output: {
                format:               'es',
                entryFileNames:       'background/service-worker.js',
                inlineDynamicImports: true,
              },
            },
          },
        });
      },
    },
  ],

  resolve: sharedResolve,

  build: {
    outDir:      'dist',
    emptyOutDir: true,
    minify:      false,
    sourcemap:   true,
    target:      'es2022',
    rollupOptions: {
      // Main build handles only the UI pages (HTML-backed, can use ES modules)
      input: {
        'offscreen/index': resolve(__dirname, 'src/offscreen/index.ts'),
        'popup/index':     resolve(__dirname, 'src/popup/index.tsx'),
        'sidepanel/index': resolve(__dirname, 'src/sidepanel/index.tsx'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'shared/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            if (assetInfo.name.includes('overlay')) return 'content/overlay.css';
            return 'assets/[name][extname]';
          }
          if (assetInfo.name?.endsWith('.wasm')) return '[name][extname]';
          return 'assets/[name]-[hash][extname]';
        },
      },
      external: [],
    },
  },

  define: sharedDefine,

  optimizeDeps: {
    include: ['@mediapipe/tasks-vision'],
  },

  test: {
    globals:      true,
    environment:  'jsdom',
    setupFiles:   ['./tests/setup.ts'],
    include:      ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include:  ['src/**/*.ts', 'src/**/*.tsx'],
    },
  },
});
