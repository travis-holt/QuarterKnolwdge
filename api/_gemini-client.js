// ─────────────────────────────────────────────────────────────────────────────
// Shared Gemini client — key loading, a single call, and key rotation.
//
// Every /api Gemini handler uses these helpers so the rotation logic lives in
// ONE place (it was previously copy-pasted across 6 files and had begun to
// drift). The leading `_` keeps Express from turning this module into a route.
//
// geminiWithRotation tries each configured key once, starting from a random
// offset, rotating past transient / quota / permission failures. It returns a
// normalized result the caller maps to an HTTP response:
//
//   { ok: true,  text }                     → 200 from Gemini (text MAY be empty;
//                                              callers validate their own output)
//   { ok: false, reason: 'fatal', status }  → non-rotatable error (our bug)  → 502
//   { ok: false, reason: 'auth' }           → every key failed with 403       → 500
//   { ok: false, reason: 'exhausted' }      → keys rate-limited / overloaded  → 429
// ─────────────────────────────────────────────────────────────────────────────

// gemini-2.5-flash has free-tier availability on the project keys in use (2.0-flash
// returns a free-tier limit of 0 in this region). Swap here if quota/model changes.
const MODEL = 'gemini-2.5-flash';

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

// One Gemini call with a given key → { ok, status, text?, detail? }.
export async function callGemini(apiKey, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return { ok: false, status: resp.status, detail: await resp.text().catch(() => '') };
  const data = await resp.json();
  return { ok: true, status: 200, text: data?.candidates?.[0]?.content?.parts?.[0]?.text };
}

/**
 * Try each key once (random start), rotating past transient/quota/permission
 * failures. See the module header for the return shape. `label` is used only in
 * log lines so the originating handler is identifiable.
 * @param {string[]} keys  non-empty (callers guard `keys.length === 0` first)
 * @param {object} body    the Gemini generateContent request body
 * @param {{label?: string}} [opts]
 */
export async function geminiWithRotation(keys, body, { label = 'gemini' } = {}) {
  const start = Math.floor(Math.random() * keys.length);
  let sawFailure = false;
  let sawNonAuthFailure = false; // a non-403 failure (transient/quota) anywhere

  for (let i = 0; i < keys.length; i++) {
    const idx = (start + i) % keys.length;
    let result;
    try {
      result = await callGemini(keys[idx], body);
    } catch (err) {
      console.error(`${label}: fetch threw on key #${idx} — rotating:`, err);
      sawFailure = true;
      sawNonAuthFailure = true; // a network/transient throw is not an auth problem
      continue;
    }
    if (result.ok) return { ok: true, text: result.text };
    if (ROTATABLE.has(result.status)) {
      sawFailure = true;
      if (result.status === 403) {
        console.error(`${label}: 403 on key #${idx} — auth/billing issue, rotating`);
      } else {
        sawNonAuthFailure = true;
        console.warn(`${label}: key #${idx} returned ${result.status} — rotating`);
      }
      continue;
    }
    console.error(`${label}: non-rotatable error`, result.status, String(result.detail ?? '').slice(0, 200));
    return { ok: false, reason: 'fatal', status: result.status };
  }

  // Every key was tried and failed. If every failure was a 403, surface as auth.
  if (sawFailure && !sawNonAuthFailure) return { ok: false, reason: 'auth' };
  return { ok: false, reason: 'exhausted' };
}
