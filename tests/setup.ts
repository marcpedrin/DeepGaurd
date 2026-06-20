/**
 * Vitest test setup — mock Chrome APIs for unit/integration tests
 */

import { vi } from 'vitest';

// Mock chrome extension API
const chromeStorage: Record<string, unknown> = {};

globalThis.chrome = {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    getURL: (path: string) => `chrome-extension://test/${path}`,
    getContexts: vi.fn().mockResolvedValue([]),
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
  },
  storage: {
    local: {
      get: vi.fn().mockImplementation((keys: string | string[], cb?: (r: Record<string, unknown>) => void) => {
        const result: Record<string, unknown> = {};
        const keyArr = Array.isArray(keys) ? keys : [keys];
        keyArr.forEach((k) => { result[k] = chromeStorage[k]; });
        if (cb) cb(result);
        return Promise.resolve(result);
      }),
      set: vi.fn().mockImplementation((items: Record<string, unknown>, cb?: () => void) => {
        Object.assign(chromeStorage, items);
        if (cb) cb();
        return Promise.resolve();
      }),
    },
  },
  tabs: {
    sendMessage: vi.fn().mockResolvedValue({}),
    query: vi.fn().mockResolvedValue([]),
  },
  offscreen: {
    createDocument: vi.fn().mockResolvedValue(undefined),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    Reason: { WORKERS: 'WORKERS' },
  },
  sidePanel: {
    open: vi.fn().mockResolvedValue(undefined),
  },
} as unknown as typeof chrome;

// ─── ImageData polyfill (jsdom does not include Canvas APIs) ──────────────────

class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace: string = 'srgb';

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width  = dataOrWidth;
      this.height = widthOrHeight;
      this.data   = new Uint8ClampedArray(dataOrWidth * widthOrHeight * 4);
    } else {
      this.data   = dataOrWidth;
      this.width  = widthOrHeight;
      this.height = height ?? Math.floor(dataOrWidth.length / 4 / widthOrHeight);
    }
  }
}

// Always set our polyfill — jsdom's ImageData doesn't support the Uint8ClampedArray constructor form properly
(globalThis as unknown as Record<string, unknown>).ImageData = MockImageData;


// ─── OffscreenCanvas polyfill ─────────────────────────────────────────────────

if (typeof OffscreenCanvas === 'undefined') {
  class MockOffscreenCanvas {
    width: number;
    height: number;
    constructor(w: number, h: number) { this.width = w; this.height = h; }
    getContext() {
      return {
        drawImage: vi.fn(),
        putImageData: vi.fn(),
        getImageData: vi.fn().mockImplementation((_x: number, _y: number, w: number, h: number) => {
          return new MockImageData(new Uint8ClampedArray(w * h * 4).fill(128), w, h);
        }),
      };
    }
  }
  (globalThis as unknown as Record<string, unknown>).OffscreenCanvas = MockOffscreenCanvas;
}
