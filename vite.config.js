import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Self-contained prototype — no backend, no proxy, in-memory state only.
// `base` is set for production builds so assets resolve under the GitHub Pages
// project path (https://<user>.github.io/QuarterKnolwdge/). Dev stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/QuarterKnolwdge/' : '/',
  plugins: [react()],
}));
