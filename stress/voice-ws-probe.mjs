// ─────────────────────────────────────────────────────────────────────────────
// VOICE-CALL RELAY CONCURRENCY PROBE (/api/live)
//
// Answers: "how many simultaneous real-time voice practice calls can the server
// relay + Gemini Live sustain?" It opens N concurrent WebSocket sessions directly
// against the relay (no browser mic needed), sends a valid `start`, and records
// per session whether it reached `ready` (Gemini Live session opened) and
// received at least one `audio` chunk (caller actually spoke) — or errored.
//
// This exercises the exact server path a browser voice call uses, minus Web-Audio
// mic capture (not headlessly testable). It uses the Live API's separate PREVIEW
// quota, so keep N modest.
//
// Run against a running server:  node stress/voice-ws-probe.mjs [N]
//   env: STRESS_WS (default ws://localhost:3000/api/live), STRESS_SECRET (0200)
// ─────────────────────────────────────────────────────────────────────────────

import WebSocket from 'ws';

const WS_URL = process.env.STRESS_WS || 'ws://localhost:3000/api/live';
const SECRET = process.env.STRESS_SECRET || '0200';
const N = Number(process.argv[2] || 6);
const SESSION_BUDGET_MS = 25_000;

const START = {
  type: 'start',
  secret: SECRET,
  callerName: 'Dana (parent)',
  scenario: 'A parent is calling to schedule a sick visit for their 4-year-old and is unsure which site to use.',
  department: 'pediatrics',
  openingLine: 'Hi, I need to book a sick visit for my son today if possible.',
};

function oneSession(id) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = { id, ready: false, audioChunks: 0, gotTranscript: false, error: null, ms: 0 };
    let sock;
    try { sock = new WebSocket(WS_URL); } catch (e) { out.error = String(e); return resolve(out); }

    const done = () => {
      out.ms = Date.now() - t0;
      try { sock.close(); } catch { /* ignore */ }
      resolve(out);
    };
    const budget = setTimeout(done, SESSION_BUDGET_MS);

    sock.on('open', () => sock.send(JSON.stringify(START)));
    sock.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'ready') out.ready = true;
      else if (m.type === 'audio') {
        out.audioChunks++;
        // Once we've confirmed real caller audio is flowing, we've proven the
        // session works — end early to free the Live quota for the next probe.
        if (out.audioChunks >= 3) { clearTimeout(budget); done(); }
      } else if (m.type === 'transcript') out.gotTranscript = true;
      else if (m.type === 'error') { out.error = m.message; clearTimeout(budget); done(); }
    });
    sock.on('error', (e) => { out.error = e?.message || String(e); clearTimeout(budget); done(); });
    sock.on('close', () => { clearTimeout(budget); done(); });
  });
}

async function main() {
  console.log(`\n=== Voice relay concurrency probe → ${WS_URL} (N=${N}) ===`);
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: N }, (_, i) => oneSession(i)));
  const wall = Date.now() - t0;

  const ready = results.filter((r) => r.ready).length;
  const withAudio = results.filter((r) => r.audioChunks > 0).length;
  const errored = results.filter((r) => r.error).length;

  console.log('id   ready  audioChunks  transcript  ms     error');
  for (const r of results) {
    console.log(
      `${String(r.id).padStart(2)}   ${r.ready ? 'yes' : 'no '}    ${String(r.audioChunks).padStart(6)}      ` +
      `${r.gotTranscript ? 'yes' : 'no '}       ${String(r.ms).padStart(5)}  ${r.error ? String(r.error).slice(0, 50) : ''}`
    );
  }
  console.log('\n--- SUMMARY ---');
  console.log(`Concurrent sessions attempted : ${N}`);
  console.log(`Reached 'ready' (Live opened) : ${ready}/${N}`);
  console.log(`Received caller audio         : ${withAudio}/${N}`);
  console.log(`Errored                       : ${errored}/${N}`);
  console.log(`Wall time                     : ${wall}ms\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
