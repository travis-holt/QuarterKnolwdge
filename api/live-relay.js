// ─────────────────────────────────────────────────────────────────────────────
// WebSocket relay for the real-time voice practice/QA call (Gemini Live API).
//
//   browser  ⇄  this relay  ⇄  Gemini Live (BidiGenerateContent)
//
// The relay exists so the GEMINI key is never exposed to the browser: the
// browser talks only to us; we hold the key and open the upstream Live socket.
//
// PR 2 — SERVER-AUTHORITATIVE CALL QA TRANSCRIPT. For a scored Call QA test
// (mode:'test') the relay is now the single source of truth for the transcript:
//   • Navigator identity comes from the verified Firebase token (never the body).
//   • The curated scenario is loaded and validated server-side (never trusted
//     from the browser).
//   • A server-owned attempt document is created BEFORE the call starts.
//   • Gemini Live's inputTranscription (navigator) / outputTranscription (caller)
//     are captured HERE, coalesced, checkpointed to Firestore, and finalized.
//   • Ending the call runs a bounded drain handshake so the final utterance is
//     not lost to an immediate socket teardown.
//   • Browser transcript messages are IGNORED. Captions forwarded to the browser
//     are a NON-AUTHORITATIVE visual mirror only.
//
// Practice mode (mode:'practice', the default) keeps its prior generated-scenario
// behavior — advisory only, browser-graded, no server attempt/capture.
//
// The connection handler takes an injectable `deps` object so the whole capture
// + drain state machine is unit-testable with fake client / upstream sockets, a
// fake clock, a fake identity verifier, a fake scenario resolver, and a fake
// Firestore repository — no real Gemini or emulator required.
// ─────────────────────────────────────────────────────────────────────────────

import { WebSocketServer, WebSocket } from 'ws';
import { getApiKeys, redactKeys } from './_gemini-client.js';
import { verifySocketToken } from './_auth.js';
import { getFirebaseAdmin } from './_firebase-admin.js';
import { clientIp } from './_rate-limit.js';
import { buildSystemInstruction } from './interview-turn.js';
import { getCallQaScenarioById } from '../src/data/callQaScenarios.js';
import { TranscriptCapture } from './_call-qa-transcript.js';
import {
  buildAttemptDoc, createAttempt, checkpointTranscript, finalizeCapture,
  CAPTURE_STATUS,
} from './_call-qa-attempts.js';

// gemini-3 Live model — confirmed to open a session on the project keys.
const LIVE_MODEL = 'gemini-3.1-flash-live-preview';
const GEMINI_WS = (key) =>
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`;
const MAX_SESSIONS_PER_IP = 2;
const MAX_CALL_MS = 10 * 60 * 1000;
const START_TIMEOUT_MS = 10_000;
const UPSTREAM_SETUP_TIMEOUT_MS = 12_000;

// Bounded transcript-drain window after the navigator clicks End Call. The relay
// signals end-of-audio upstream, then waits at most this long for a final
// transcription boundary before finalizing. Configurable so ops can tune it.
export const CALL_QA_DRAIN_TIMEOUT_MS = Number(process.env.CALL_QA_DRAIN_TIMEOUT_MS) || 8_000;
// Minimum spacing between transcript checkpoints so we do not write Firestore on
// every fragment; a turn boundary always flushes regardless.
export const CALL_QA_CHECKPOINT_INTERVAL_MS = 3_000;

const ASSESSED_DEPTS = ['pediatrics', 'obgyn'];

const activeByIp = new Map();

function send(sock, obj) {
  if (sock && sock.readyState === 1) sock.send(JSON.stringify(obj));
}

// End-of-audio signal for the Gemini Live BidiGenerateContent protocol. This
// tells the model the client has stopped streaming audio so it can complete its
// final turn — used during the End Call drain. NOTE: verify against the current
// official Gemini Live docs before changing; keep it a single constant so a
// protocol update is a one-line edit, never a guess scattered through the relay.
const AUDIO_STREAM_END = { realtimeInput: { audioStreamEnd: true } };

// ── Production dependency wiring ─────────────────────────────────────────────
function realCreateUpstream(key, { onOpen, onMessage, onClose, onError }) {
  const socket = new WebSocket(GEMINI_WS(key));
  socket.onopen = () => onOpen();
  socket.onmessage = async (ev) => {
    let txt = ev.data;
    if (txt instanceof Blob) txt = await txt.text();
    else if (txt instanceof ArrayBuffer) txt = Buffer.from(txt).toString('utf8');
    let m;
    try { m = JSON.parse(txt); } catch { return; }
    onMessage(m);
  };
  socket.onerror = (e) => onError(e?.message || e);
  socket.onclose = (e) => onClose({ code: e?.code, reason: (e?.reason || '').slice(0, 120) });
  return {
    send: (obj) => { if (socket.readyState === 1) socket.send(JSON.stringify(obj)); },
    close: () => { try { socket.close(); } catch {} },
  };
}

export function productionDeps() {
  return {
    verifyToken: verifySocketToken,
    getApiKeys,
    buildSystemInstruction,
    resolveScenario: getCallQaScenarioById,
    loadRosterName: async (navigatorId) => {
      const snap = await getFirebaseAdmin().db.collection('roster').doc(navigatorId).get();
      return snap.exists ? String(snap.data().name ?? '') : '';
    },
    db: () => getFirebaseAdmin().db,
    createUpstream: realCreateUpstream,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t),
    clientIp,
    liveModel: LIVE_MODEL,
  };
}

// ── Connection handler ───────────────────────────────────────────────────────
export function handleConnection(client, req, depsInput) {
  const deps = { ...productionDeps(), ...(depsInput || {}) };
  const ip = deps.clientIp(req);
  const active = activeByIp.get(ip) ?? 0;
  if (active >= MAX_SESSIONS_PER_IP) {
    send(client, { type: 'error', message: 'Too many active voice sessions. Please try again shortly.' });
    client.close();
    return;
  }
  activeByIp.set(ip, active + 1);

  const session = {
    upstream: null,
    starting: false,
    closed: false,
    mode: 'practice',
    // Test-mode capture state
    attemptId: null,
    capture: null,          // TranscriptCapture
    ended: false,           // navigator clicked End; stop forwarding audio
    finalized: false,       // capture terminal state written
    turnCompleteObserved: false,
    lastCheckpointAt: 0,
    drainTimer: null,
    scenario: null,
    department: 'pediatrics',
    navigatorId: null,
  };

  const startTimer = deps.setTimer(() => {
    send(client, { type: 'error', message: 'Voice authentication timed out.' });
    shutdown('start-timeout');
  }, START_TIMEOUT_MS);
  const callTimer = deps.setTimer(() => {
    send(client, { type: 'error', message: 'Voice call time limit reached.' });
    endTestCapture('call-timeout', false).finally(() => shutdown('call-timeout'));
  }, MAX_CALL_MS);

  function releaseIp() {
    activeByIp.set(ip, Math.max(0, (activeByIp.get(ip) ?? 1) - 1));
    if ((activeByIp.get(ip) ?? 0) === 0) activeByIp.delete(ip);
  }

  function shutdown(reason) {
    if (session.closed) return;
    session.closed = true;
    deps.clearTimer(startTimer);
    deps.clearTimer(callTimer);
    if (session.drainTimer) deps.clearTimer(session.drainTimer);
    releaseIp();
    try { session.upstream?.close(); } catch {}
    try { client.close(); } catch {}
  }

  // Checkpoint the server transcript at a turn boundary (bounded/debounced).
  async function checkpoint({ force = false } = {}) {
    if (session.mode !== 'test' || !session.attemptId || !session.capture) return;
    const now = deps.now();
    if (!force && now - session.lastCheckpointAt < CALL_QA_CHECKPOINT_INTERVAL_MS) return;
    session.lastCheckpointAt = now;
    try {
      await checkpointTranscript(deps.db(), session.attemptId, {
        transcript: session.capture.toArray(),
        navigatorTurnCount: session.capture.navigatorTurnCount,
        callerTurnCount: session.capture.callerTurnCount,
        turnCompleteObserved: session.turnCompleteObserved,
        warnings: session.capture.warnings,
        now,
      });
    } catch (err) {
      console.warn(`[live-relay] checkpoint failed for attempt ${session.attemptId}: ${err?.message ?? err}`);
    }
  }

  // Finalize a test-mode capture exactly once. `captureComplete` distinguishes a
  // clean drain from an uncertain/interrupted one; `abandoned` marks a call the
  // navigator never ended cleanly.
  async function endTestCapture(drainReason, captureComplete, { abandoned = false } = {}) {
    if (session.mode !== 'test' || !session.attemptId || session.finalized) return;
    session.finalized = true;
    if (session.drainTimer) { deps.clearTimer(session.drainTimer); session.drainTimer = null; }
    const transcript = session.capture ? session.capture.toArray() : [];
    const captureStatus = abandoned
      ? CAPTURE_STATUS.ABANDONED
      : (captureComplete ? CAPTURE_STATUS.CAPTURED : CAPTURE_STATUS.INCOMPLETE);
    const captureMetadata = {
      endedBy: abandoned ? 'disconnect' : 'navigator',
      drainReason,
      turnCompleteObserved: session.turnCompleteObserved,
      navigatorTurnCount: session.capture?.navigatorTurnCount ?? 0,
      callerTurnCount: session.capture?.callerTurnCount ?? 0,
      transcriptTurnCount: transcript.length,
      captureComplete,
      warnings: session.capture?.warnings ?? [],
    };
    try {
      await finalizeCapture(deps.db(), session.attemptId, {
        transcript, captureStatus, captureMetadata, now: deps.now(),
      });
    } catch (err) {
      console.warn(`[live-relay] finalize failed for attempt ${session.attemptId}: ${err?.message ?? err}`);
    }
  }

  // ── Client → relay ─────────────────────────────────────────────────────────
  client.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // First message must be a valid 'start'.
    if (!session.upstream && !session.starting) {
      if (msg.type !== 'start') {
        send(client, { type: 'error', message: 'Not authorised.' });
        return shutdown('bad-start');
      }
      session.starting = true;
      await handleStart(msg);
      return;
    }
    if (!session.upstream) return; // still starting; ignore

    if (msg.type === 'audio' && msg.data) {
      // After End Call we stop forwarding mic frames (server drain in progress).
      if (session.ended) return;
      session.upstream.send({
        realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: msg.data } },
      });
      return;
    }

    // Browser-supplied transcript is NEVER authoritative — ignore it entirely.
    if (msg.type === 'transcript') return;

    if (msg.type === 'end') {
      handleEndCall();
      return;
    }
  });

  client.on('close', () => {
    // Unexpected browser disappearance without a clean End handshake: persist the
    // latest checkpoint as an abandoned/incomplete capture; never auto-grade it.
    if (session.mode === 'test' && session.attemptId && !session.finalized) {
      endTestCapture('client-disconnect', false, { abandoned: true }).finally(() => shutdown('client-close'));
      return;
    }
    shutdown('client-close');
  });
  client.on('error', () => shutdown('client-error'));

  // ── Start handling ───────────────────────────────────────────────────────
  async function handleStart(msg) {
    const identity = await deps.verifyToken(msg.idToken);
    if (!identity) {
      send(client, { type: 'error', message: 'Not authorised.' });
      return shutdown('unauthorised');
    }

    session.mode = msg.mode === 'test' ? 'test' : 'practice';

    if (session.mode === 'test') {
      // Scored QA test: server owns identity + scenario. Require the navigator
      // role and derive navigatorId from the token, never the body.
      if (identity.role !== 'navigator' || !identity.navigatorId) {
        send(client, { type: 'error', message: 'Only a signed-in navigator can take a Call QA test.' });
        return shutdown('not-navigator');
      }
      const department = String(msg.department ?? '');
      if (!ASSESSED_DEPTS.includes(department)) {
        send(client, { type: 'error', message: 'That department does not have a Call QA test.' });
        return shutdown('bad-department');
      }
      const scenario = deps.resolveScenario(String(msg.qaScenarioId ?? ''));
      if (!scenario || scenario.department !== department) {
        send(client, { type: 'error', message: 'That Call QA scenario is not available.' });
        return shutdown('bad-scenario');
      }

      session.navigatorId = identity.navigatorId;
      session.department = department;
      session.scenario = scenario;

      let name = '';
      try { name = await deps.loadRosterName(identity.navigatorId); } catch { name = ''; }

      // Create the server-owned attempt BEFORE the call starts.
      try {
        const attemptDoc = buildAttemptDoc({
          navigatorId: identity.navigatorId,
          name,
          department,
          scenario,
          liveModel: deps.liveModel ?? LIVE_MODEL,
          now: deps.now(),
        });
        session.attemptId = await createAttempt(deps.db(), attemptDoc);
      } catch (err) {
        console.warn(`[live-relay] attempt create failed: ${err?.message ?? err}`);
        send(client, { type: 'error', message: 'Could not begin a server-recorded attempt. Try again.' });
        return shutdown('attempt-create-failed');
      }
      session.capture = new TranscriptCapture();
    }

    const keys = deps.getApiKeys();
    if (!keys.length) {
      send(client, { type: 'error', message: 'Voice calling is not configured on the server.' });
      return shutdown('no-keys');
    }
    deps.clearTimer(startTimer);
    openUpstreamWithRotation(keys, msg);
  }

  // ── Upstream (Gemini Live) with key rotation ─────────────────────────────
  function openUpstreamWithRotation(keys, startMsg) {
    const start = Math.floor(Math.random() * keys.length);
    const orderedKeys = keys.map((_, index) => keys[(start + index) % keys.length]);
    let keyIndex = 0;

    const openNext = () => {
      if (session.closed) return;
      if (keyIndex >= orderedKeys.length) {
        send(client, { type: 'error', message: 'The voice service is unavailable on every configured connection. Try again shortly.' });
        return shutdown('upstream-exhausted');
      }
      const key = orderedKeys[keyIndex++];
      let setupComplete = false;
      let attemptFinished = false;

      const setupTimer = deps.setTimer(() => rotateOrClose('setup timeout'), UPSTREAM_SETUP_TIMEOUT_MS);
      setupTimer?.unref?.();

      const rotateOrClose = (detail) => {
        if (attemptFinished || session.closed) return;
        attemptFinished = true;
        deps.clearTimer(setupTimer);
        if (!setupComplete) {
          console.warn(`[live-relay] upstream key attempt ${keyIndex}/${orderedKeys.length} failed before setup: ${redactKeys(detail)}`);
          try { upstream.close(); } catch {}
          openNext();
          return;
        }
        send(client, { type: 'error', message: 'Lost connection to the voice service.' });
        // A mid-call upstream drop in test mode is an incomplete capture.
        if (session.mode === 'test' && session.attemptId && !session.finalized) {
          endTestCapture('upstream-closed', false).finally(() => shutdown('upstream-closed'));
        } else {
          shutdown('upstream-closed');
        }
      };

      const persona = session.mode === 'test'
        ? deps.buildSystemInstruction(session.scenario.callerName, session.scenario.scenario, {
            department: session.department,
            openingLine: session.scenario.openingLine || '',
            caseFile: null,
          })
        : deps.buildSystemInstruction(startMsg.callerName || 'the caller', startMsg.scenario || '', {
            department: startMsg.department || 'pediatrics',
            openingLine: startMsg.openingLine || '',
            caseFile: startMsg.caseFile || null,
          });

      const upstream = deps.createUpstream(key, {
        onOpen: () => {
          upstream.send({
            setup: {
              model: `models/${deps.liveModel ?? LIVE_MODEL}`,
              generationConfig: { responseModalities: ['AUDIO'] },
              systemInstruction: { parts: [{ text: persona }] },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          });
        },
        onMessage: (m) => handleUpstreamMessage(m, {
          markSetup: () => {
            setupComplete = true;
            deps.clearTimer(setupTimer);
          },
        }),
        onError: (detail) => rotateOrClose(detail),
        onClose: (info) => rotateOrClose(`${info?.code || ''} ${info?.reason || ''}`),
      });
      session.upstream = upstream;
    };

    openNext();
  }

  function handleUpstreamMessage(m, { markSetup }) {
    if (m.setupComplete) {
      markSetup();
      // Trigger the caller to open the call (model speaks first).
      session.upstream.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'BEGIN_CALL' }] }], turnComplete: true } });
      const ready = { type: 'ready' };
      if (session.mode === 'test') {
        ready.attemptId = session.attemptId;
        ready.scenario = {
          id: session.scenario.id,
          title: session.scenario.title,
          callerName: session.scenario.callerName,
          department: session.department,
          version: session.scenario.version ?? null,
        };
      }
      send(client, ready);
      return;
    }

    const sc = m.serverContent;
    if (!sc) return;

    for (const part of sc.modelTurn?.parts || []) {
      if (part.inlineData?.data) send(client, { type: 'audio', data: part.inlineData.data });
    }
    // Caller (patient) transcription.
    if (sc.outputTranscription?.text) {
      if (session.mode === 'test' && session.capture) session.capture.add('patient', sc.outputTranscription.text);
      send(client, { type: 'transcript', role: 'patient', text: sc.outputTranscription.text });
    }
    // Navigator transcription.
    if (sc.inputTranscription?.text) {
      if (session.mode === 'test' && session.capture) session.capture.add('navigator', sc.inputTranscription.text);
      send(client, { type: 'transcript', role: 'navigator', text: sc.inputTranscription.text });
    }
    if (sc.interrupted) send(client, { type: 'interrupted' });
    if (sc.turnComplete) {
      session.turnCompleteObserved = true;
      send(client, { type: 'turnComplete' });
      // Turn boundary → checkpoint the server transcript (debounced).
      checkpoint();
      // If the navigator has already ended, a post-end turnComplete means the
      // final utterance has drained — finalize now.
      if (session.mode === 'test' && session.ended && !session.finalized) {
        finishDrain('turn-complete');
      }
    }
  }

  // ── End Call handshake (test mode) ───────────────────────────────────────
  function handleEndCall() {
    if (session.mode !== 'test') {
      // Practice mode has no server capture; just tear down.
      return shutdown('practice-end');
    }
    if (session.ended) return;
    session.ended = true;
    // Signal end-of-audio upstream so the model finishes its final turn, then
    // wait (bounded) for a final transcription boundary before finalizing.
    session.upstream.send(AUDIO_STREAM_END);
    session.turnCompleteObserved = false; // watch for a NEW post-end boundary
    session.drainTimer = deps.setTimer(() => finishDrain('drain-timeout'), CALL_QA_DRAIN_TIMEOUT_MS);
    session.drainTimer?.unref?.();
  }

  async function finishDrain(reason) {
    if (session.finalized) return;
    const clean = reason === 'turn-complete';
    await endTestCapture(reason, clean);
    send(client, {
      type: 'captured',
      attemptId: session.attemptId,
      captureComplete: clean,
      ...(clean ? {} : { warning: 'The final part of the call may not have been captured. This attempt will be flagged for supervisor review.' }),
    });
    shutdown('captured');
  }
}

/** Attach the /api/live WebSocket relay to an existing http.Server. */
export function attachLiveRelay(server, deps) {
  const wss = new WebSocketServer({ server, path: '/api/live' });
  wss.on('connection', (client, req) => handleConnection(client, req, deps));
  return wss;
}
