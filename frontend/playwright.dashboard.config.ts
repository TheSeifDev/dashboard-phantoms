import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

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
    baseURL: 'http://127.0.0.1:4173',
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
