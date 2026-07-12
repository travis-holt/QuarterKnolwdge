// ─────────────────────────────────────────────────────────────────────────────
// Shared Gemini client — key loading, a single call, and key rotation.
//
// Every /api Gemini handler uses these helpers so the rotation logic lives in
// ONE place (it was previously copy-pasted across 6 files and had begun to
// drift). The leading `_` keeps Express from turning this module into a route.
//
// geminiWithRotation tries each configured key once per model (primary model
// first, then any fallback models), starting from a random offset, rotating past
// transient / quota / permission failures. It returns a normalized result the
// caller maps to an HTTP response:
//
//   { ok: true,  text }                     → 200 from Gemini (text MAY be empty;
//                                              callers validate their own output)
//   { ok: false, reason: 'fatal', status }  → non-rotatable error (our bug)  → 502
//   { ok: false, reason: 'auth' }           → every key failed with 403       → 500
//   { ok: false, reason: 'exhausted' }      → keys rate-limited / overloaded  → 429
// ─────────────────────────────────────────────────────────────────────────────

// Primary model. gemini-3.5-flash was tried here (2026-07-09) but its free tier is
// currently unusable: mostly 503 UNAVAILABLE on all 4 project keys, and the rare
// 200 took 50–76 seconds — a random one-minute hang inside a live practice call.
// gemini-2.5-flash (the pre-migration primary) answered on every key in ~3s with
// clean structured output. Revisit 3.5-flash when its free-tier capacity stabilizes.
export const MODEL = 'gemini-2.5-flash';

// First fallback for EVERY endpoint (scored/authoring included). Free-tier rate
// limits and capacity are per MODEL per project, so this is a separate quota
// bucket on the same keys. Probed 2026-07-09: answers on all 4 keys in <1s.
export const STABLE_MODEL = 'gemini-2.5-flash-lite';

// Last-resort overflow model — a THIRD independent quota bucket on the same keys.
// It can 503 under load ("high demand") at times, so it is a cushion, not
// guaranteed capacity — callers opt in via the models chain only where a quality
// dip is acceptable (chat roleplay turns, advisory coaching/grading), never for
// authoring output. Probed 2026-07-09: answers on all 4 keys in <1s.
export const LITE_MODEL = 'gemini-3.1-flash-lite';

// Per-key failures where trying a DIFFERENT key may succeed (quota / rate limit /
// permission / transient overload). A 400 (bad request) is our bug, not the key's,
// so it is NOT rotated — it surfaces immediately as `fatal`.
const ROTATABLE = new Set([429, 403, 503, 500]);

// Configured keys: GEMINI_API_KEYS (comma-separated, preferred) with GEMINI_API_KEY
// as a single-key fallback. De-duped and trimmed.
export function getApiKeys() {
  const multi = (process.env.GEMINI_API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean);
  const single = (process.env.GEMINI_API_KEY || '').trim();
  return [...new Set(multi.length ? multi : single ? [single] : [])];
}

// Warn once at startup if no keys are configured so the problem surfaces in logs
// immediately rather than at first Gemini call.
if (getApiKeys().length === 0) {
  console.warn('_gemini-client: no GEMINI_API_KEYS or GEMINI_API_KEY configured — all Gemini endpoints will fail.');
}

// Strip API keys from any text that might reach the logs — a thrown fetch error
// (or its cause) can embed the full request URL, which carries `?key=<KEY>`.
export function redactKeys(text) {
  return String(text ?? '').replace(/([?&]key=)[^&\s"']+/gi, '$1***');
}

/**
 * Map a failed geminiWithRotation result to the HTTP status + user-facing error
 * every handler sends (the module-header contract: fatal → 502, auth → 500,
 * exhausted → 429). Handlers pass `overrides` to keep endpoint-specific copy.
 * @param {{reason:string, status?:number}} result  a `{ ok:false }` rotation result
 * @param {{fatal?:string, auth?:string, exhausted?:string}} [overrides]
 * @returns {{status:number, error:string}}
 */
export function rotationFailure(result, overrides = {}) {
  if (result.reason === 'fatal') {
    return { status: 502, error: overrides.fatal ?? `Gemini request failed (${result.status}).` };
  }
  if (result.reason === 'auth') {
    return { status: 500, error: overrides.auth ?? 'All Gemini keys have auth or billing failures — check Railway Variables.' };
  }
  return { status: 429, error: overrides.exhausted ?? 'All Gemini keys are rate-limited right now. Try again shortly.' };
}

export const DEFAULT_GEMINI_TIMEOUT_MS = 25_000;

export function geminiTimeoutMs(env = process.env) {
  const configured = Number(env.GEMINI_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_GEMINI_TIMEOUT_MS;
  return Math.max(1_000, Math.min(120_000, Math.round(configured)));
}

// One Gemini call with a given key → { ok, status, text?, detail? }. The abort
// signal is server-owned: browser timeouts no longer leave an upstream fetch
// consuming a socket and quota after the client has gone away.
export async function callGemini(apiKey, body, model = MODEL, timeoutMs = geminiTimeoutMs()) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) return { ok: false, status: resp.status, detail: await resp.text().catch(() => '') };
    const data = await resp.json();
    return { ok: true, status: 200, text: data?.candidates?.[0]?.content?.parts?.[0]?.text };
  } finally {
    clearTimeout(timer);
  }
}

// ── Per-key cooldown ──────────────────────────────────────────────────────────
// A key that just 429'd is rate-limited for the rest of its quota window, and a
// key that just 503'd is hitting a model with no free-tier capacity — either way
// subsequent requests skip it instead of burning a round-trip to re-learn that.
// Keyed per model because quota/capacity buckets are per model per project.
// Gemini's 429 body carries a RetryInfo retryDelay ("32s") — honored when present;
// 503s use the default cooldown so a capacity-dead model is skipped quickly and
// requests fall straight through to the working fallback model.

const cooldowns = new Map(); // `${model}::${key}` → epoch ms when the key is usable again
const DEFAULT_COOLDOWN_MS = 30_000;

function retryDelayMs(detail) {
  const m = String(detail ?? '').match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : DEFAULT_COOLDOWN_MS;
}

// Test hook — cooldown state is module-level and would otherwise leak between tests.
export function resetCooldowns() {
  cooldowns.clear();
}

// Pull the quota that tripped out of a 429 body so Railway logs say WHICH limit
// died (per-minute vs per-day) instead of a bare status code.
function quotaInfo(detail) {
  const t = String(detail ?? '');
  const metric = t.match(/"quotaMetric"\s*:\s*"([^"]+)"/)?.[1];
  const id = t.match(/"quotaId"\s*:\s*"([^"]+)"/)?.[1];
  const value = t.match(/"quotaValue"\s*:\s*"?(\d+)/)?.[1];
  if (!metric && !id && !value) return '';
  const kind = /perday/i.test(id ?? '') ? 'per-DAY' : /perminute/i.test(id ?? '') ? 'per-minute' : '';
  return ` (quota: ${metric?.split('/').pop() ?? id ?? '?'}${value ? ` limit=${value}` : ''}${kind ? ` ${kind}` : ''})`;
}

/**
 * Try each key once per model (random start), rotating past transient/quota/
 * permission failures. Models are tried in order — all keys on models[0], then
 * all keys on models[1], … — because free-tier rate limits are per model per
 * project, so a fallback model is a separate quota bucket on the same keys.
 * See the module header for the return shape. `label` is used only in log lines
 * so the originating handler is identifiable.
 * @param {string[]} keys  non-empty (callers guard `keys.length === 0` first)
 * @param {object} body    the Gemini generateContent request body
 * @param {{label?: string, models?: string[]}} [opts]
 */
export async function geminiWithRotation(keys, body, { label = 'gemini', models = [MODEL] } = {}) {
  let sawFailure = false;
  let sawNonAuthFailure = false; // a non-403 failure (transient/quota) anywhere

  for (const model of models) {
    const start = Math.floor(Math.random() * keys.length);
    for (let i = 0; i < keys.length; i++) {
      const idx = (start + i) % keys.length;
      const cdKey = `${model}::${keys[idx]}`;
      if ((cooldowns.get(cdKey) ?? 0) > Date.now()) continue; // known rate-limited — skip
      let result;
      try {
        result = await callGemini(keys[idx], body, model);
      } catch (err) {
        // Log the message only (redacted) — the raw error object can embed the
        // key-bearing request URL via its cause/stack.
        console.error(`${label}: fetch threw on key #${idx} (${model}) — rotating: ${redactKeys(err?.message ?? err)}`);
        sawFailure = true;
        sawNonAuthFailure = true; // a network/transient throw is not an auth problem
        continue;
      }
      if (result.ok) return { ok: true, text: result.text };
      if (ROTATABLE.has(result.status)) {
        sawFailure = true;
        if (result.status === 403) {
          console.error(`${label}: 403 on key #${idx} (${model}) — auth/billing issue, rotating`);
        } else {
          sawNonAuthFailure = true;
          const quota = result.status === 429 ? quotaInfo(result.detail) : '';
          if (result.status === 429 || result.status === 503) {
            cooldowns.set(cdKey, Date.now() + retryDelayMs(result.detail));
          }
          console.warn(`${label}: key #${idx} (${model}) returned ${result.status}${quota} — rotating`);
        }
        continue;
      }
      console.error(`${label}: non-rotatable error`, result.status, String(result.detail ?? '').slice(0, 200));
      return { ok: false, reason: 'fatal', status: result.status };
    }
  }

  // Every key was tried on every model and failed. All-403 surfaces as auth.
  if (sawFailure && !sawNonAuthFailure) return { ok: false, reason: 'auth' };
  return { ok: false, reason: 'exhausted' };
}
