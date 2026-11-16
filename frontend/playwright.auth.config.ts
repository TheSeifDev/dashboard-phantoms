import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const previewPort = process.env.PHANTOMS_LOCAL_PREVIEW_PORT ?? '4173';
if (!/^\d{4,5}$/.test(previewPort) || Number(previewPort) < 1024 || Number(previewPort) > 65535) {
  throw new Error('Invalid disposable preview port.');
}

/** Disposable-only Auth E2E: the runner owns preview startup and fixture lifecycle. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'auth-local.spec.ts',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [[path.resolve('scripts/auth-safe-reporter.mjs'), { outputFile: path.resolve('test-results/auth-evidence.json') }]],
  outputDir: path.resolve('test-results/auth-e2e'),
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    baseURL: `http://127.0.0.1:${previewPort}`,
    locale: 'ar-EG',
    colorScheme: 'light',
    serviceWorkers: 'block',
    screenshot: 'off',
    video: 'off',
    trace: 'off',
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-auth-localhost',
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
  ],
});
