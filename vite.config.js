import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend is served at the site root on Vercel (no project sub-path), so `base`
// stays '/' for both dev and build. The serverless Gemini proxy lives in /api and
// is deployed by Vercel alongside this build. (Historical: a GitHub Pages build
// previously needed base '/QuarterKnolwdge/'; that is retired with the Vercel move.)
export default defineConfig({
  base: '/',
  plugins: [react()],
});
