// ─────────────────────────────────────────────────────────────────────────────
// WebSocket relay for the real-time voice practice call (Gemini Live API).
//
//   browser  ⇄  this relay  ⇄  Gemini Live (BidiGenerateContent)
//
// The relay exists so the GEMINI key is never exposed to the browser: the
// browser talks only to us; we hold the key and open the upstream Live socket.
// We also build the patient-caller persona server-side (where the SOP context
// lives), so the client only sends mic audio + the scenario it was given.
//
// AUTH: the first message carries the navigator's server-issued Firebase ID
// token. The relay verifies its role + navigatorId before opening Gemini. The
// per-client-IP concurrency cap and call timer are additional abuse controls.
//
// Protocol (all JSON over the browser socket):
//   client → relay   { type:'start', idToken, navigatorId, callerName,
//                      scenario, department, openingLine, caseFile? } (first msg)
//                    { type:'audio', data }   base64 PCM16 mono @16kHz mic frames
//   relay  → client  { type:'ready' }                                 (call can begin)
//                    { type:'audio', data }   base64 PCM16 mono @24kHz caller voice
//                    { type:'transcript', role:'patient'|'navigator', text }
//                    { type:'interrupted' }   caller cut off — flush playback
//                    { type:'turnComplete' }
//                    { type:'error', message }
//
// Advisory only, like every other AI feature: a relay failure ends the call
// gracefully; it never touches a score directly (grading is a separate REST call).
// ─────────────────────────────────────────────────────────────────────────────

import { WebSocketServer, WebSocket } from 'ws';
import { getApiKeys, redactKeys } from './_gemini-client.js';
import { verifySocketToken } from './_auth.js';
import { clientIp } from './_rate-limit.js';
import { buildSystemInstruction } from './interview-turn.js';

// gemini-3 Live model — confirmed to open a session on the project keys (verified
// via listModels + a live setup handshake). Falls in the bidiGenerateContent set.
// Stable 2.5 alternatives if this preview gets flaky: gemini-2.5-flash-native-audio-latest.
const LIVE_MODEL = 'gemini-3.1-flash-live-preview';
const GEMINI_WS = (key) =>
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`;
const MAX_SESSIONS_PER_IP = 2;
const MAX_CALL_MS = 10 * 60 * 1000;
const START_TIMEOUT_MS = 10_000;
const UPSTREAM_SETUP_TIMEOUT_MS = 12_000;
const activeByIp = new Map();

function send(sock, obj) {
  if (sock.readyState === 1) sock.send(JSON.stringify(obj));
}

// Bridge one browser socket to a fresh Gemini Live session.
function bridge(client, req) {
  const ip = clientIp(req);
  const active = activeByIp.get(ip) ?? 0;
  if (active >= MAX_SESSIONS_PER_IP) {
    send(client, { type: 'error', message: 'Too many active voice sessions. Please try again shortly.' });
    client.close();
    return;
  }
  activeByIp.set(ip, active + 1);
  let upstream = null;
  let starting = false;
  let closed = false;
  const startTimer = setTimeout(() => {
    send(client, { type: 'error', message: 'Voice authentication timed out.' });
    shutdown();
  }, START_TIMEOUT_MS);
  const callTimer = setTimeout(() => {
    send(client, { type: 'error', message: 'Voice call time limit reached.' });
    shutdown();
  }, MAX_CALL_MS);

  const shutdown = () => {
    if (closed) return;
    closed = true;
    clearTimeout(startTimer);
    clearTimeout(callTimer);
    activeByIp.set(ip, Math.max(0, (activeByIp.get(ip) ?? 1) - 1));
    if ((activeByIp.get(ip) ?? 0) === 0) activeByIp.delete(ip);
    try { upstream?.close(); } catch {}
    try { client.close(); } catch {}
  };

  client.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // First message must be a valid 'start' — it opens the upstream session.
    if (!upstream) {
      if (msg.type !== 'start' || starting) {
        send(client, { type: 'error', message: 'Not authorised.' });
        return shutdown();
      }
      starting = true;
      const identity = await verifySocketToken(msg.idToken);
      if (!identity || (
        identity.role === 'navigator' &&
        identity.navigatorId !== msg.navigatorId
      )) {
        send(client, { type: 'error', message: 'Not authorised.' });
        return shutdown();
      }
      const keys = getApiKeys();
      if (!keys.length) {
        send(client, { type: 'error', message: 'Voice calling is not configured on the server.' });
        return shutdown();
      }
      clearTimeout(startTimer);
      openUpstreamWithRotation(keys, msg);
      return;
    }

    // Subsequent messages: forward mic audio frames upstream. Newer Live models
    // require realtimeInput.audio (a single Blob) — the old mediaChunks[] array
    // is deprecated and closes the session with code 1007.
    if (msg.type === 'audio' && msg.data) {
      send(upstream, {
        realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: msg.data } },
      });
    }
  });

  client.on('close', shutdown);
  client.on('error', shutdown);

  function openUpstreamWithRotation(keys, startMsg) {
    const start = Math.floor(Math.random() * keys.length);
    const orderedKeys = keys.map((_, index) => keys[(start + index) % keys.length]);
    let keyIndex = 0;

    const openNext = () => {
      if (closed) return;
      if (keyIndex >= orderedKeys.length) {
        send(client, { type: 'error', message: 'The voice service is unavailable on every configured connection. Try again shortly.' });
        shutdown();
        return;
      }
      const key = orderedKeys[keyIndex++];
      const socket = new WebSocket(GEMINI_WS(key));
      upstream = socket;
      let setupComplete = false;
      let attemptFinished = false;
      const setupTimer = setTimeout(
        () => rotateOrClose('setup timeout'),
        UPSTREAM_SETUP_TIMEOUT_MS,
      );
      setupTimer.unref?.();

      const rotateOrClose = (detail) => {
        if (attemptFinished || closed) return;
        attemptFinished = true;
        clearTimeout(setupTimer);
        if (!setupComplete) {
          console.warn(`[live-relay] upstream key attempt ${keyIndex}/${orderedKeys.length} failed before setup: ${redactKeys(detail)}`);
          try { socket.close(); } catch {}
          openNext();
          return;
        }
        send(client, { type: 'error', message: 'Lost connection to the voice service.' });
        shutdown();
      };

      socket.onopen = () => {
        socket.send(JSON.stringify({
          setup: {
            model: `models/${LIVE_MODEL}`,
            generationConfig: { responseModalities: ['AUDIO'] },
            systemInstruction: {
              parts: [{
                text: buildSystemInstruction(startMsg.callerName || 'the caller', startMsg.scenario || '', {
                  department: startMsg.department || 'pediatrics',
                  openingLine: startMsg.openingLine || '',
                  caseFile: startMsg.caseFile || null,
                }),
              }],
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }));
      };

      socket.onmessage = async (ev) => {
        let txt = ev.data;
        if (txt instanceof Blob) txt = await txt.text();
        else if (txt instanceof ArrayBuffer) txt = Buffer.from(txt).toString('utf8');
        let m;
        try { m = JSON.parse(txt); } catch { return; }

        if (m.setupComplete) {
          setupComplete = true;
          clearTimeout(setupTimer);
          // Trigger the patient to open the call (model speaks first).
          send(socket, { clientContent: { turns: [{ role: 'user', parts: [{ text: 'BEGIN_CALL' }] }], turnComplete: true } });
          send(client, { type: 'ready' });
          return;
        }

        const sc = m.serverContent;
        if (!sc) return;
        for (const part of sc.modelTurn?.parts || []) {
          if (part.inlineData?.data) send(client, { type: 'audio', data: part.inlineData.data });
        }
        if (sc.outputTranscription?.text) send(client, { type: 'transcript', role: 'patient', text: sc.outputTranscription.text });
        if (sc.inputTranscription?.text) send(client, { type: 'transcript', role: 'navigator', text: sc.inputTranscription.text });
        if (sc.interrupted) send(client, { type: 'interrupted' });
        if (sc.turnComplete) send(client, { type: 'turnComplete' });
      };

      // Redact before logging — the error message can carry the key-bearing WS URL.
      socket.onerror = (e) => rotateOrClose(e?.message || e);
      socket.onclose = (e) => rotateOrClose(`${e?.code || ''} ${(e?.reason || '').slice(0, 120)}`);
    };

    openNext();
  }
}

/** Attach the /api/live WebSocket relay to an existing http.Server. */
export function attachLiveRelay(server) {
  const wss = new WebSocketServer({ server, path: '/api/live' });
  wss.on('connection', bridge);
  return wss;
}
