import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const previewPort = process.env.PHANTOMS_LOCAL_PREVIEW_PORT ?? '4173';
if (!/^\d{4,5}$/.test(previewPort) || Number(previewPort) < 1024 || Number(previewPort) > 65535) throw new Error('Invalid disposable preview port.');

/** Disposable-only dashboard E2E: the runner owns preview startup and fixture seeding. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'dashboard-local.spec.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['line']],
  outputDir: path.resolve('test-results'),
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    baseURL: `http://127.0.0.1:${previewPort}`,
    locale: 'ar-EG',
    colorScheme: 'light',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-localhost',
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
  ],
});
