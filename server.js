// Express server for Railway deployment.
// Serves the Vite-built SPA from dist/ and mounts the /api handlers that were
// originally written as Vercel serverless functions (same req/res signature).

import './load-env.js'; // must be first — populates process.env from .env.local in local dev
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rateLimit } from './api/_rate-limit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// --- API routes (import the same handlers used on Vercel) ---
import generateScenarios from './api/generate-scenarios.js';
import generateCoaching from './api/generate-coaching.js';
import interviewTurn from './api/interview-turn.js';
import gradeInterview from './api/grade-interview.js';
import gradeCallQa from './api/grade-call-qa.js';
import generateAudit from './api/generate-audit.js';
import coachAudit from './api/coach-audit.js';
import sequencePath from './api/sequence-path.js';
import refineSop from './api/refine-sop.js';
import supervisorLogin from './api/supervisor-login.js';
import logout from './api/logout.js';
import health from './api/health.js';
import { attachLiveRelay } from './api/live-relay.js';

app.post('/api/refine-sop', rateLimit({ label: 'refine-sop', max: 6 }), express.json({ limit: '20mb' }), refineSop);
app.use(express.json({ limit: '100kb' }));

// Supervisor session (server-side authorization). Login rate-limited to blunt
// passcode brute-forcing; logout is a plain cookie-clear.
app.post('/api/supervisor-login', rateLimit({ label: 'supervisor-login', max: 10 }), supervisorLogin);
app.post('/api/logout', logout);

app.post('/api/generate-scenarios', rateLimit({ label: 'generate-scenarios', max: 12 }), generateScenarios);
app.post('/api/generate-coaching', rateLimit({ label: 'generate-coaching', max: 20 }), generateCoaching);
app.post('/api/interview-turn', rateLimit({ label: 'interview-turn', max: 30 }), interviewTurn);
app.post('/api/grade-interview', rateLimit({ label: 'grade-interview', max: 20 }), gradeInterview);
app.post('/api/grade-call-qa', rateLimit({ label: 'grade-call-qa', max: 12 }), gradeCallQa);
app.post('/api/generate-audit', rateLimit({ label: 'generate-audit', max: 12 }), generateAudit);
app.post('/api/coach-audit', rateLimit({ label: 'coach-audit', max: 20 }), coachAudit);
app.post('/api/sequence-path', rateLimit({ label: 'sequence-path', max: 12 }), sequencePath);
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
