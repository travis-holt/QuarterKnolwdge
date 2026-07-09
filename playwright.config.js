import { defineConfig, devices } from '@playwright/test';

// Playwright end-to-end config for Knowledge Check.
//
// Two test suites live under here:
//   tests/e2e/     — the CI-safe product walkthrough + demo smoke suite (read-only
//                    navigation; no submits, no mic, no AI calls, no destructive writes).
//                    This is the ROUTINE suite. Scripts: `npm run test:e2e` and
//                    `npm run test:e2e:safe` both run it. Safe against live Railway.
//   e2e/           — the DEEP live-data flows (WRITE to Firestore + CALL Gemini).
//                    Run deliberately with `npm run test:e2e:deep`; needs .env.local
//                    (Firebase + Gemini). Do NOT point this at a shared/live URL.
//   `npm run test:e2e:all` runs both.
//
// The app is a Vite SPA served (together with the /api Gemini routes) by the
// Express server in server.js. By default the webServer below runs a production
// build + `npm start`, exactly like Railway, and waits on /api/health before the
// tests run. Local dev needs .env.local (Firebase + Gemini) for the data-backed
// flows to work — the same file `npm start` already loads via load-env.js.
//
// To run against the live Railway deployment instead of a local server, set
// PLAYWRIGHT_BASE_URL — the local webServer is then skipped entirely. Only point
// the SAFE suite at a live URL (the deep suite writes data + calls Gemini):
//   PLAYWRIGHT_BASE_URL=https://quarterknolwdge-production.up.railway.app npm run test:e2e:safe
//
// Run with:  npm run test:e2e            (routine SAFE suite, local server)
//            npm run test:e2e:deep       (deep live-data suite: writes + Gemini)
//            npm run test:e2e:all        (both suites)
//            npm run test:e2e -- --headed (watch it drive a real browser)
//            PLAYWRIGHT_BASE_URL=... npm run test:e2e:safe (safe suite, live URL)
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const useLiveURL = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  // Root testDir so both e2e/ and tests/e2e/ are discovered.
  testDir: '.',
  testMatch: ['e2e/**/*.spec.js', 'tests/e2e/**/*.spec.js'],
  // Don't pick up specs copied into nested worktrees / stress / deps.
  testIgnore: ['**/.codex-worktrees/**', '**/node_modules/**', 'stress/**'],
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // Keep a full trace + screenshot for any failed test so a failed pre-demo
    // walkthrough is debuggable from the HTML report artifacts.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // When targeting a live URL, do not spin up a local server.
  webServer: useLiveURL
    ? undefined
    : {
        command: 'npm run build && npm start',
        url: 'http://localhost:3000/api/health',
        reuseExistingServer: true,
        timeout: 180_000,
      },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
