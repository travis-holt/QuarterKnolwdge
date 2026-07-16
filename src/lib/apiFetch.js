// ─────────────────────────────────────────────────────────────────────────────
// apiFetch — shared client helper for calls to the /api/* endpoints.
//
// Handles: AbortController timeout, Content-Type header, same-origin cookie
// credentials, error-body parsing, and timeout error shaping — all of which were
// previously duplicated across Interview.jsx, SpotTheError.jsx, Coaching.jsx,
// and SupervisorApp.jsx.
//
// SECURITY (2026-07-08): this no longer injects the public SUPERVISOR_PASSCODE as
// `body.secret`. Supervisor-only endpoints now authorize via the server-issued
// HttpOnly session cookie (set by /api/supervisor-login), sent automatically with
// `credentials: 'same-origin'`. Every protected request also carries the current
// Firebase ID token in Authorization; rate limiting is defense-in-depth. See
// api/_auth.js.
//
// Usage:
//   const data = await apiFetch('/api/generate-audit', { domain, department }, 25_000);
//   // throws on non-2xx or timeout; returns parsed JSON on success
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST to an /api endpoint with a timeout. Sends the supervisor session cookie
 * (same-origin) when present; no secret is injected into the body.
 * @param {string} endpoint  - e.g. '/api/generate-audit'
 * @param {object} body      - request payload
 * @param {number} timeoutMs - AbortController timeout in ms
 * @returns {Promise<object>} parsed JSON response
 * @throws {Error} on non-2xx, timeout, or network failure; AbortError name is
 *                 preserved so callers can detect timeouts via err.name === 'AbortError'
 */
export async function apiFetch(endpoint, body, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { getFirebaseIdToken } = await import('./firebase.js');
    const idToken = await getFirebaseIdToken();
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error = new Error(err.error || `Request failed (${res.status})`);
      error.status = res.status; // let callers branch on the HTTP status (e.g. 422)
      throw error;
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** Shape a caught fetch error into a user-facing message string. */
export function fetchErrorMessage(err, timeoutMessage, fallbackMessage) {
  if (err?.name === 'AbortError') return timeoutMessage;
  return err?.message || fallbackMessage;
}

/**
 * Run an async worker over a list with BOUNDED concurrency (rate-limit friendly
 * fan-out for the Gemini endpoints). Returns Promise.allSettled-shaped results,
 * in input order. Used by SpotTheError (H3) and the supervisor audit-bank
 * generation.
 * @param {any[]} items
 * @param {number} limit    max workers in flight
 * @param {(item:any, i:number) => Promise<any>} worker
 * @returns {Promise<{status:'fulfilled',value:any}|{status:'rejected',reason:any}[]>}
 */
export async function runPooled(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runner = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await worker(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}
