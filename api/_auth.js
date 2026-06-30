// ─────────────────────────────────────────────────────────────────────────────
// Shared secret validation for /api Gemini endpoints.
//
// Every handler calls validateSecret(req, res) at the top of its handler body
// and returns early if it responds with 401. This replaces the identical
// three-line block that was copy-pasted across the REST handlers.
// ─────────────────────────────────────────────────────────────────────────────

import { SUPERVISOR_PASSCODE } from '../src/data/config.js';

const SECRET = process.env.GENERATION_SECRET || SUPERVISOR_PASSCODE;

/**
 * Validate the `secret` field in the request body against the configured
 * server-side secret. Sends a 401 and returns true if invalid; returns false
 * (no response sent) if valid, so the caller can continue.
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {boolean} true = invalid (response already sent), false = valid
 */
export function validateSecret(req, res) {
  if ((req.body?.secret) !== SECRET) {
    res.status(401).json({ error: 'Not authorised.' });
    return true;
  }
  return false;
}

/** Plain secret check for non-Express callers (e.g. the WebSocket live relay). */
export function isValidSecret(secret) {
  return secret === SECRET;
}
