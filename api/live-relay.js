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
// Protocol (all JSON over the browser socket):
//   client → relay   { type:'start', secret, callerName, scenario,
//                      department, openingLine }                      (first msg)
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

import { WebSocketServer } from 'ws';
import { getApiKeys, redactKeys } from './_gemini-client.js';
import { isValidSecret } from './_auth.js';
import { buildSystemInstruction } from './interview-turn.js';

// gemini-3 Live model — confirmed to open a session on the project keys (verified
// via listModels + a live setup handshake). Falls in the bidiGenerateContent set.
// Stable 2.5 alternatives if this preview gets flaky: gemini-2.5-flash-native-audio-latest.
const LIVE_MODEL = 'gemini-3.1-flash-live-preview';
const GEMINI_WS = (key) =>
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`;

function send(sock, obj) {
  if (sock.readyState === 1) sock.send(JSON.stringify(obj));
}

// Bridge one browser socket to a fresh Gemini Live session.
function bridge(client) {
  let upstream = null;
  let closed = false;

  const shutdown = () => {
    if (closed) return;
    closed = true;
    try { upstream?.close(); } catch {}
    try { client.close(); } catch {}
  };

  client.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // First message must be a valid 'start' — it opens the upstream session.
    if (!upstream) {
      if (msg.type !== 'start' || !isValidSecret(msg.secret)) {
        send(client, { type: 'error', message: 'Not authorised.' });
        return shutdown();
      }
      const keys = getApiKeys();
      if (!keys.length) {
        send(client, { type: 'error', message: 'Voice calling is not configured on the server.' });
        return shutdown();
      }
      openUpstream(keys[Math.floor(Math.random() * keys.length)], msg);
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

  function openUpstream(key, startMsg) {
    upstream = new WebSocket(GEMINI_WS(key));

    upstream.onopen = () => {
      upstream.send(JSON.stringify({
        setup: {
          model: `models/${LIVE_MODEL}`,
          generationConfig: { responseModalities: ['AUDIO'] },
          systemInstruction: {
            parts: [{
              text: buildSystemInstruction(startMsg.callerName || 'the caller', startMsg.scenario || '', {
                department: startMsg.department || 'pediatrics',
                openingLine: startMsg.openingLine || '',
              }),
            }],
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      }));
    };

    upstream.onmessage = async (ev) => {
      let txt = ev.data;
      if (txt instanceof Blob) txt = await txt.text();
      else if (txt instanceof ArrayBuffer) txt = Buffer.from(txt).toString('utf8');
      let m;
      try { m = JSON.parse(txt); } catch { return; }

      if (m.setupComplete) {
        // Trigger the patient to open the call (model speaks first).
        send(upstream, { clientContent: { turns: [{ role: 'user', parts: [{ text: 'BEGIN_CALL' }] }], turnComplete: true } });
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
    upstream.onerror = (e) => { console.error('[live-relay] upstream error:', redactKeys(e?.message || e)); send(client, { type: 'error', message: 'Lost connection to the voice service.' }); shutdown(); };
    upstream.onclose = (e) => { console.log('[live-relay] upstream closed', e?.code || '', (e?.reason || '').slice(0, 120)); shutdown(); };
  }
}

/** Attach the /api/live WebSocket relay to an existing http.Server. */
export function attachLiveRelay(server) {
  const wss = new WebSocketServer({ server, path: '/api/live' });
  wss.on('connection', bridge);
  return wss;
}
