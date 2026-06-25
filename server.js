// Express server for Railway deployment.
// Serves the Vite-built SPA from dist/ and mounts the /api handlers that were
// originally written as Vercel serverless functions (same req/res signature).

import express from 'express';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

// --- API routes (import the same handlers used on Vercel) ---
import generateScenarios from './api/generate-scenarios.js';
import health from './api/health.js';

app.post('/api/generate-scenarios', generateScenarios);
app.get('/api/health', health);

// --- Static SPA ---
const distDir = join(__dirname, 'dist');
app.use(express.static(distDir));

// SPA catch-all: unknown paths → index.html.
// Express 5 (path-to-regexp v8) no longer accepts a bare '*' — the wildcard
// must be named, so this is '/*splat' instead of '*'.
app.get('/*splat', (_req, res) => {
  res.sendFile(join(distDir, 'index.html'));
});

// Railway injects PORT automatically; fall back to 3000 for local testing.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
