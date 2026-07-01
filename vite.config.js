import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend is served at the site root on Vercel (no project sub-path), so `base`
// stays '/' for both dev and build. The serverless Gemini proxy lives in /api and
// is deployed by Vercel alongside this build. (Historical: a GitHub Pages build
// previously needed base '/QuarterKnolwdge/'; that is retired with the Vercel move.)
export default defineConfig({
  base: '/',
  plugins: [react()],
  test: {
    // jest-dom matchers for component tests (used by files with @vitest-environment jsdom)
    setupFiles: ['./src/test-setup.js'],
    // Vitest runs the unit/component tests under src/ + api/ only. The Playwright
    // end-to-end specs live in e2e/ and are run separately via `npm run test:e2e`
    // (they use @playwright/test, not vitest).
    include: ['src/**/*.{test,spec}.{js,jsx}', 'api/**/*.{test,spec}.js'],
  },
});
