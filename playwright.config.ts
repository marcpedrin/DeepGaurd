import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    headless: false, // Extension tests require headed Chrome
    channel: 'chrome',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--disable-extensions-except=dist',
            '--load-extension=dist',
          ],
        },
      },
    },
  ],
});
