// ─────────────────────────────────────────────────────────────────────────────
// Call QA transcription-provider adapter.
//
// The existing Gemini Live relay remains the realtime AI caller/audio transport.
// For SCORED Call QA attempts only, navigator microphone audio can additionally
// be transcribed by ElevenLabs Scribe v2 Realtime. Practice calls are untouched.
//
// Provider selection is deliberately operational, not a code fork:
//   CALL_QA_TRANSCRIPTION_PROVIDER=gemini      -> current behaviour
//   CALL_QA_TRANSCRIPTION_PROVIDER=elevenlabs  -> Scribe navigator transcript
//
// Removing the variable also returns to Gemini. This gives the owner an immediate
// Railway-variable rollback without changing code or the deterministic grader.
// The ElevenLabs key stays server-side; it is never sent to the browser.
// ─────────────────────────────────────────────────────────────────────────────

import { WebSocketServer, WebSocket } from 'ws';
import { handleConnection, productionDeps } from './live-relay.js';
import { glossaryFor } from './_qa-glossary.js';

export const CALL_QA_TRANSCRIPTION_PROVIDERS = Object.freeze({
  GEMINI: 'gemini',
  ELEVENLABS: 'elevenlabs',
});

export const ELEVENLABS_SCRIBE_MODEL = 'scribe_v2_realtime';
const ELEVENLABS_SCRIBE_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const DEFAULT_SETUP_TIMEOUT_MS = 6_000;
const DEFAULT_TURN_DELAY_MS = 600;
const DEFAULT_VAD_SILENCE_SECS = 0.4;
const FINAL_SILENCE_MS = 600;
const PCM_SAMPLE_RATE = 16_000;
const PCM_BYTES_PER_SAMPLE = 2;

const SCRIBE_FATAL_TYPES = new Set([
  'error', 'auth_error', 'quota_exceeded', 'transcriber_error', 'input_error',
  'unaccepted_terms', 'rate_limited', 'queue_overflow', 'resource_exhausted',
  'session_time_limit_exceeded', 'chunk_size_exceeded', 'insufficient_audio_activity',
]);

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function callQaTranscriptionProvider(env = process.env) {
  const raw = String(env?.CALL_QA_TRANSCRIPTION_PROVIDER ?? '').trim().toLowerCase();
  if (!raw) return CALL_QA_TRANSCRIPTION_PROVIDERS.GEMINI;
  if (raw === CALL_QA_TRANSCRIPTION_PROVIDERS.GEMINI || raw === CALL_QA_TRANSCRIPTION_PROVIDERS.ELEVENLABS) {
    return raw;
  }
  throw new Error('CALL_QA_TRANSCRIPTION_PROVIDER must be "gemini" or "elevenlabs".');
}

export function elevenLabsTurnDelayMs(env = process.env) {
  return Math.round(clampNumber(env?.CALL_QA_ELEVENLABS_TURN_DELAY_MS, DEFAULT_TURN_DELAY_MS, 200, 2_000));
}

export function elevenLabsVadSilenceSecs(env = process.env) {
  return clampNumber(env?.CALL_QA_ELEVENLABS_VAD_SILENCE_SECS, DEFAULT_VAD_SILENCE_SECS, 0.2, 2);
}

export function scribeKeytermsFor(department) {
  const glossaryTerms = glossaryFor(department).map((entry) => entry.canonical);
  const departmentTerms = department === 'obgyn'
    ? [
        'OB Portal', 'MFM', 'BPP', 'GYN', 'Annual GYN', 'New OB', 'OB Urgent',
        'GYN Urgent', 'IUD', 'NST', 'GCT', 'GTT', 'RTO', 'eCW', 'sonogram',
        'postpartum', 'gestational age', 'Dr. Rosenberg', 'Rebecca Wood',
      ]
    : ['PEDS Encounters', 'PE', 'NB PE', 'TE', 'OV', 'F/U', 'Good Samaritan', 'eCW'];

  return [...new Set([...glossaryTerms, ...departmentTerms])]
    .map((term) => String(term ?? '').trim())
    .filter((term) => term && term.length <= 20)
    .slice(0, 50);
}

export function buildScribeRealtimeUrl(department, env = process.env) {
  const url = new URL(ELEVENLABS_SCRIBE_URL);
  url.searchParams.set('model_id', ELEVENLABS_SCRIBE_MODEL);
  url.searchParams.set('audio_format', 'pcm_16000');
  url.searchParams.set('language_code', 'en');
  url.searchParams.set('commit_strategy', 'vad');
  url.searchParams.set('vad_silence_threshold_secs', String(elevenLabsVadSilenceSecs(env)));
  url.searchParams.set('min_speech_duration_ms', '100');
  url.searchParams.set('min_silence_duration_ms', '100');
  url.searchParams.set('no_verbatim', 'false');
  for (const term of scribeKeytermsFor(department)) url.searchParams.append('keyterms', term);
  return url.toString();
}

function finalSilenceBase64() {
  const sampleCount = Math.round((PCM_SAMPLE_RATE * FINAL_SILENCE_MS) / 1000);
  return Buffer.alloc(sampleCount * PCM_BYTES_PER_SAMPLE).toString('base64');
}

function safeSend(client, payload) {
  try {
    if (client?.readyState === 1) client.send(JSON.stringify(payload));
  } catch { /* connection is already disappearing */ }
}

/**
 * Open one server-authenticated Scribe v2 Realtime session and wait until the
 * `session_started` event arrives. A configured ElevenLabs Call QA never silently
 * falls back to Gemini: setup failure aborts before the scored attempt is created,
 * and a mid-call failure abandons the attempt instead of mixing transcript sources.
 */
export function openElevenLabsScribeSession({
  apiKey,
  department,
  env = process.env,
  WebSocketImpl = WebSocket,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!String(apiKey ?? '').trim()) return Promise.reject(new Error('ELEVENLABS_API_KEY is not configured.'));

  return new Promise((resolve, reject) => {
    let ready = false;
    let intentionalClose = false;
    let settled = false;
    let committedHandler = () => {};
    let fatalHandler = () => {};

    const socket = new WebSocketImpl(buildScribeRealtimeUrl(department, env), {
      headers: { 'xi-api-key': String(apiKey).trim() },
    });

    const setupTimeoutMs = Math.round(clampNumber(
      env?.CALL_QA_ELEVENLABS_SETUP_TIMEOUT_MS,
      DEFAULT_SETUP_TIMEOUT_MS,
      2_000,
      15_000,
    ));

    const setupTimer = setTimer(() => {
      if (settled) return;
      settled = true;
      intentionalClose = true;
      try { socket.close(); } catch {}
      reject(new Error('ElevenLabs Scribe setup timed out.'));
    }, setupTimeoutMs);
    setupTimer?.unref?.();

    const fail = (message) => {
      const err = message instanceof Error ? message : new Error(String(message || 'ElevenLabs Scribe failed.'));
      if (!ready && !settled) {
        settled = true;
        clearTimer(setupTimer);
        intentionalClose = true;
        try { socket.close(); } catch {}
        reject(err);
        return;
      }
      if (ready && !intentionalClose) fatalHandler(err);
    };

    socket.on('message', (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      const type = String(event?.message_type ?? '');

      if (type === 'session_started') {
        if (settled) return;
        ready = true;
        settled = true;
        clearTimer(setupTimer);
        resolve({
          model: ELEVENLABS_SCRIBE_MODEL,
          provider: CALL_QA_TRANSCRIPTION_PROVIDERS.ELEVENLABS,
          sendAudio(audioBase64) {
            if (socket.readyState !== 1 || !audioBase64) return false;
            socket.send(JSON.stringify({
              message_type: 'input_audio_chunk',
              audio_base_64: audioBase64,
            }));
            return true;
          },
          flushFinalSilence() {
            if (socket.readyState !== 1) return false;
            socket.send(JSON.stringify({
              message_type: 'input_audio_chunk',
              audio_base_64: finalSilenceBase64(),
            }));
            return true;
          },
          setCommittedHandler(handler) {
            committedHandler = typeof handler === 'function' ? handler : () => {};
          },
          setFatalHandler(handler) {
            fatalHandler = typeof handler === 'function' ? handler : () => {};
          },
          close() {
            intentionalClose = true;
            try { socket.close(); } catch {}
          },
        });
        return;
      }

      if (type === 'committed_transcript') {
        committedHandler(String(event?.text ?? ''));
        return;
      }

      if (SCRIBE_FATAL_TYPES.has(type)) fail(event?.error || event?.message || type);
    });

    socket.on('error', (err) => fail(err?.message || 'ElevenLabs Scribe WebSocket error.'));
    socket.on('close', () => {
      clearTimer(setupTimer);
      if (!intentionalClose) fail('ElevenLabs Scribe connection closed unexpectedly.');
    });
  });
}

function isGeminiMicAudio(payload) {
  return payload?.realtimeInput?.audio?.data ? payload.realtimeInput.audio.data : null;
}

function isGeminiAudioEnd(payload) {
  return payload?.realtimeInput?.audioStreamEnd === true;
}

function hasServerContentPayload(sc) {
  return sc && Object.keys(sc).length > 0;
}

/**
 * Build per-connection dependencies for the existing trusted relay. Only scored
 * test mode calls `selectScenario`, so only scored Call QA opens Scribe. The
 * caller voice/model, private scenario selection, Firestore capture and grader
 * remain exactly where they were.
 */
export function buildTranscriptionProviderDeps({
  client,
  baseDeps = productionDeps(),
  env = process.env,
  openScribe = openElevenLabsScribeSession,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const provider = callQaTranscriptionProvider(env);
  let scribe = null;
  let turnTimer = null;
  let released = false;

  // This listener is registered while the adapter is being built, before the
  // relay gets control of the socket. That matters because handleConnection()
  // can shut the client down after selectScenario() but before createUpstream().
  // Cleanup is intentionally idempotent: relay upstream teardown and socket
  // close/error may all race each other, but Scribe is closed at most once.
  const release = () => {
    if (released) return;
    released = true;
    if (turnTimer) { clearTimer(turnTimer); turnTimer = null; }
    if (scribe) {
      try { scribe.close(); } catch {}
    }
  };

  if (typeof client?.on === 'function') {
    client.on('close', release);
    client.on('error', release);
  }

  const stopForScribeFailure = (err) => {
    if (released) return;
    console.warn(`[call-qa-transcription] ElevenLabs Scribe failed: ${err?.message ?? err}`);
    safeSend(client, {
      type: 'error',
      code: 'call-qa-transcription-unavailable',
      message: 'The Call QA transcription service disconnected. This attempt was not scored; please retake it.',
    });
    // Close Scribe intentionally before closing the client so its own socket-close
    // event cannot re-enter the fatal path or report another error to a gone client.
    release();
    try { client?.close(); } catch {}
  };

  const deps = {
    ...baseDeps,

    async selectScenario(options) {
      const scenario = await baseDeps.selectScenario(options);
      if (!scenario) return scenario;

      if (provider === CALL_QA_TRANSCRIPTION_PROVIDERS.ELEVENLABS) {
        const apiKey = String(env?.ELEVENLABS_API_KEY ?? '').trim();
        if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required when CALL_QA_TRANSCRIPTION_PROVIDER=elevenlabs.');
        if (released) throw new Error('Call QA client disconnected before ElevenLabs Scribe could start.');

        // Keep the resolved session local until the await completes. If the client
        // disappears during the connection handshake, release() has already marked
        // the adapter disposed; close the just-resolved authenticated socket
        // immediately instead of orphaning it.
        const openedScribe = await openScribe({ apiKey, department: scenario.department, env });
        if (released) {
          try { openedScribe.close(); } catch {}
          throw new Error('Call QA client disconnected while ElevenLabs Scribe was starting.');
        }
        scribe = openedScribe;
      }

      return {
        ...scenario,
        transcriptionProvider: provider,
        transcriptionModel: provider === CALL_QA_TRANSCRIPTION_PROVIDERS.ELEVENLABS
          ? ELEVENLABS_SCRIBE_MODEL
          : 'gemini-live-input-transcription',
      };
    },

    createUpstream(key, callbacks) {
      if (provider !== CALL_QA_TRANSCRIPTION_PROVIDERS.ELEVENLABS || !scribe) {
        return baseDeps.createUpstream(key, callbacks);
      }

      scribe.setCommittedHandler((text) => {
        const clean = String(text ?? '').trim();
        if (!clean) return;
        callbacks.onMessage({ serverContent: { inputTranscription: { text: clean } } });
      });
      scribe.setFatalHandler(stopForScribeFailure);

      const wrappedCallbacks = {
        ...callbacks,
        onMessage(message) {
          const originalSc = message?.serverContent;
          if (!originalSc) {
            callbacks.onMessage(message);
            return;
          }

          // Gemini still needs the mic audio to conduct the conversation, but its
          // input transcription is non-authoritative while Scribe is selected.
          const sc = { ...originalSc };
          delete sc.inputTranscription;

          const hadTurnComplete = sc.turnComplete === true;
          if (hadTurnComplete) delete sc.turnComplete;
          if (hasServerContentPayload(sc)) callbacks.onMessage({ ...message, serverContent: sc });

          if (hadTurnComplete) {
            if (turnTimer) clearTimer(turnTimer);
            turnTimer = setTimer(() => {
              turnTimer = null;
              callbacks.onMessage({ serverContent: { turnComplete: true } });
            }, elevenLabsTurnDelayMs(env));
            turnTimer?.unref?.();
          }
        },
      };

      const gemini = baseDeps.createUpstream(key, wrappedCallbacks);
      return {
        send(payload) {
          const audio = isGeminiMicAudio(payload);
          if (audio) scribe.sendAudio(audio);
          // Push a valid 600 ms PCM silence chunk into Scribe before Gemini's
          // End-Call drain. With VAD this flushes a just-finished final utterance
          // without duplicating speech or trusting browser text.
          if (isGeminiAudioEnd(payload)) scribe.flushFinalSilence();
          gemini.send(payload);
        },
        close() {
          release();
          try { gemini.close(); } catch {}
        },
      };
    },
  };

  return deps;
}

/** Attach /api/live while keeping the existing relay as the single capture owner. */
export function attachLiveRelayWithTranscriptionProvider(server, options = {}) {
  const wss = new WebSocketServer({ server, path: '/api/live' });
  wss.on('connection', (client, req) => {
    let deps;
    try {
      // buildTranscriptionProviderDeps registers close/error disposal before this
      // returns, so handleConnection cannot close the client in the gap between a
      // successful Scribe selection and adapter cleanup being installed.
      deps = buildTranscriptionProviderDeps({ client, ...options });
    } catch (err) {
      console.error(`[call-qa-transcription] configuration error: ${err?.message ?? err}`);
      safeSend(client, { type: 'error', message: 'Call QA transcription is not configured correctly.' });
      try { client.close(); } catch {}
      return;
    }
    handleConnection(client, req, deps);
  });
  return wss;
}
