/**
 * E2E tests — Google Meet simulation
 * Uses Playwright to load a mock Meet page and verify overlay rendering.
 */

import { test, expect } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '../../dist');
const MOCK_MEET_URL  = `file://${path.resolve(__dirname, '../fixtures/mock-meet.html')}`;

// Launch browser with extension loaded
test.use({
  // Playwright Chrome with extension requires a persistent context
  contextOptions: {
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  },
});

test.describe('DeepGuard overlay — Mock Meet', () => {
  test('overlay card appears when a video element is present', async ({ page }) => {
    await page.goto(MOCK_MEET_URL);

    // Wait for the extension content script to inject overlays
    await page.waitForTimeout(3000);

    // The overlay root elements should be in the DOM
    const overlayCount = await page.$$eval(
      '[data-deepguard-id]',
      (els) => els.length,
    );
    expect(overlayCount).toBeGreaterThanOrEqual(1);
  });

  test('overlay shows participant name', async ({ page }) => {
    await page.goto(MOCK_MEET_URL);
    await page.waitForTimeout(3000);

    // Check shadow DOM content for participant name
    const hasName = await page.evaluate(() => {
      const overlays = document.querySelectorAll('[data-deepguard-id]');
      for (const overlay of overlays) {
        const shadow = overlay.shadowRoot;
        const card = shadow?.querySelector('.dg-name');
        if (card && card.textContent && card.textContent.length > 0) return true;
      }
      return false;
    });
    expect(hasName).toBe(true);
  });

  test('overlay shows ANALYZING state initially', async ({ page }) => {
    await page.goto(MOCK_MEET_URL);
    await page.waitForTimeout(1000); // Before analysis completes

    const hasAnalyzing = await page.evaluate(() => {
      const overlays = document.querySelectorAll('[data-deepguard-id]');
      for (const overlay of overlays) {
        const shadow = overlay.shadowRoot;
        const badge = shadow?.querySelector('.dg-badge.analyzing');
        if (badge) return true;
      }
      return false;
    });
    expect(hasAnalyzing).toBe(true);
  });

  test('popup renders without errors', async ({ context }) => {
    const popupPage = await context.newPage();
    const extensionId = await getExtensionId(context);
    if (!extensionId) {
      test.skip(true, 'Extension ID not found — skipping popup test');
      return;
    }

    await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await expect(popupPage.locator('#toggle-enabled')).toBeVisible({ timeout: 5000 });
  });
});

async function getExtensionId(context: Parameters<typeof test.use>[0]['contextOptions'] extends infer T ? never : never): Promise<string | null> {
  // @ts-ignore — accessing playwright internals
  const backgrounds = context.serviceWorkers();
  if (backgrounds.length > 0) {
    const url = backgrounds[0].url();
    const match = url.match(/chrome-extension:\/\/([^/]+)\//);
    return match?.[1] ?? null;
  }
  return null;
}
