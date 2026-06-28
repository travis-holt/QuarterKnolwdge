// ─────────────────────────────────────────────────────────────────────────────
// apiFetch — shared client helper for calls to the /api/* endpoints.
//
// Handles: AbortController timeout, Content-Type header, SUPERVISOR_PASSCODE
// injection, error-body parsing, and timeout error shaping — all of which were
// previously duplicated across Interview.jsx, SpotTheError.jsx, Coaching.jsx,
// and SupervisorApp.jsx.
//
// Usage:
//   const data = await apiFetch('/api/generate-audit', { domain, department }, 25_000);
//   // throws on non-2xx or timeout; returns parsed JSON on success
// ─────────────────────────────────────────────────────────────────────────────

import { SUPERVISOR_PASSCODE } from '../data/config.js';

/**
 * POST to an /api endpoint with a timeout and automatic secret injection.
 * @param {string} endpoint  - e.g. '/api/generate-audit'
 * @param {object} body      - request payload (secret is added automatically)
 * @param {number} timeoutMs - AbortController timeout in ms
 * @returns {Promise<object>} parsed JSON response
 * @throws {Error} on non-2xx, timeout, or network failure; AbortError name is
 *                 preserved so callers can detect timeouts via err.name === 'AbortError'
 */
export async function apiFetch(endpoint, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, secret: SUPERVISOR_PASSCODE }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** Shape a caught fetch error into a user-facing message string. */
export function fetchErrorMessage(err, timeoutMessage, fallbackMessage) {
  if (err.name === 'AbortError') return timeoutMessage;
  return err.message || fallbackMessage;
}
