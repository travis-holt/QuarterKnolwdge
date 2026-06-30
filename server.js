// Express server for Railway deployment.
// Serves the Vite-built SPA from dist/ and mounts the /api handlers that were
// originally written as Vercel serverless functions (same req/res signature).

import './load-env.js'; // must be first — populates process.env from .env.local in local dev
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

// --- API routes (import the same handlers used on Vercel) ---
import generateScenarios from './api/generate-scenarios.js';
import generateCoaching from './api/generate-coaching.js';
import interviewTurn from './api/interview-turn.js';
import gradeInterview from './api/grade-interview.js';
import generateAudit from './api/generate-audit.js';
import coachAudit from './api/coach-audit.js';
import sequencePath from './api/sequence-path.js';
import health from './api/health.js';
import { attachLiveRelay } from './api/live-relay.js';

app.post('/api/generate-scenarios', generateScenarios);
app.post('/api/generate-coaching', generateCoaching);
app.post('/api/interview-turn', interviewTurn);
app.post('/api/grade-interview', gradeInterview);
app.post('/api/generate-audit', generateAudit);
app.post('/api/coach-audit', coachAudit);
app.post('/api/sequence-path', sequencePath);
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
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Real-time voice practice call (Gemini Live API) — WebSocket relay at /api/live.
attachLiveRelay(server);
