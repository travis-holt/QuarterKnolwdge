import { defineConfig, devices } from '@playwright/test';

// Playwright end-to-end config for Knowledge Check.
//
// The app is a Vite SPA served (together with the /api Gemini routes) by the
// Express server in server.js. So the webServer below runs a production build +
// `npm start`, exactly like Railway, and waits on /api/health before the tests
// run. Local dev needs .env.local (Firebase + Gemini) for the flows to work —
// the same file `npm start` already loads via load-env.js.
//
// Run with:  npm run test:e2e            (headless)
//            npm run test:e2e -- --headed (watch it drive a real browser)
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm start',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
