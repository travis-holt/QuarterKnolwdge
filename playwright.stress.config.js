import { defineConfig, devices } from '@playwright/test';

// Playwright config for the STRESS load test (separate from the e2e suite).
// The concurrency is created INSIDE the test via multiple browser contexts, so
// Playwright itself runs a single worker. Long timeout: 20 concurrent MCQ+coaching
// journeys against live Firebase + Gemini take a while.
export default defineConfig({
  testDir: './stress',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run build && npm start',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
