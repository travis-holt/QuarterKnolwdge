// ─────────────────────────────────────────────────────────────────────────────
// Server-side authorization for the /api endpoints.
//
// PILOT HARDENING (2026-07-08): supervisor authorization moved off the public
// frontend passcode and onto a server-issued, HMAC-signed, HttpOnly session
// cookie. The old model shipped SUPERVISOR_PASSCODE in the public JS bundle and
// echoed it back as `body.secret`; that value protected nothing once bundled.
//
// Two gates now exist:
//   • validateSession(req, res)  — supervisor-ONLY authoring/admin endpoints
//     (generate-scenarios, refine-sop). Requires a valid signed session cookie.
//   • validateSecret(req, res)   — navigator/practice + shared endpoints. These
//     are PILOT-GRADE OPEN (rate-limited): navigators authenticate with a PIN
//     against Firestore client-side and have no server credential, so requiring
//     a session here would break practice/coaching/Call-QA flows. A valid
//     supervisor session also passes. Set REQUIRE_SUPERVISOR_SESSION=true to
//     lock these behind a session too (will block navigators — pilot toggle only).
//
// This is NOT full production auth. There is still no per-navigator server-side
// identity; that requires real Firebase Auth (out of scope for this pass).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { SUPERVISOR_PASSCODE } from '../src/data/config.js';

// Server-side supervisor passcode. Prefer an explicit server env var; fall back
// to the public config value so localhost / `npm run dev` keeps working without
// any setup. In production, set SUPERVISOR_PASSCODE_SERVER to a value that is
// NOT the bundled config passcode.
const SUPERVISOR_PASSCODE_SERVER =
  process.env.SUPERVISOR_PASSCODE_SERVER || process.env.SUPERVISOR_PASSCODE || SUPERVISOR_PASSCODE;

// HMAC signing key for session tokens. A dedicated secret is strongly preferred;
// the passcode-derived fallback keeps the pilot working out of the box but means
// rotating the passcode invalidates existing sessions.
const SESSION_SIGNING_SECRET =
  process.env.SESSION_SIGNING_SECRET || `kc-session::${SUPERVISOR_PASSCODE_SERVER}`;

// Legacy body.secret support (off by default). When ALLOW_LEGACY_API_SECRET=true
// the pre-hardening `{ secret }` body value is still accepted, for local tooling
// or a staged rollout. Never on by default.
const ALLOW_LEGACY_API_SECRET = process.env.ALLOW_LEGACY_API_SECRET === 'true';
const LEGACY_SECRET = process.env.GENERATION_SECRET || SUPERVISOR_PASSCODE;

export const SESSION_COOKIE = 'kc_supervisor_session';
export const DEFAULT_TTL_MS = 10 * 60 * 60 * 1000; // 10 hours

// ── Passcode check (constant-time) ───────────────────────────────────────────
/** Constant-time compare of a submitted passcode against the server passcode. */
export function checkSupervisorPasscode(passcode) {
  const a = Buffer.from(String(passcode ?? ''), 'utf8');
  const b = Buffer.from(String(SUPERVISOR_PASSCODE_SERVER), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** True when a server supervisor passcode is configured. */
export function isSupervisorConfigured() {
  return Boolean(SUPERVISOR_PASSCODE_SERVER);
}

// ── Signed session tokens ────────────────────────────────────────────────────
function sign(data) {
  return crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(data).digest('base64url');
}

/**
 * Create a signed session token: "base64url(payload).base64url(hmac)".
 * @param {object} payload      extra claims (role defaults to 'supervisor')
 * @param {object} [opts]
 * @param {number} [opts.ttlMs] lifetime in ms
 * @param {number} [opts.now]   injectable clock for tests
 */
export function createSessionToken(payload = {}, { ttlMs = DEFAULT_TTL_MS, now = Date.now() } = {}) {
  const body = { role: 'supervisor', ...payload, iat: now, exp: now + ttlMs };
  const data = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${data}.${sign(data)}`;
}

/**
 * Verify a session token's signature and expiry.
 * @returns {object|null} the decoded payload, or null if invalid/tampered/expired
 */
export function verifySessionToken(token, { now = Date.now() } = {}) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  if (!data || !providedSig) return null;
  const expectedSig = sign(data);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload;
}

// ── Cookie helpers ───────────────────────────────────────────────────────────
/** Serialize the Set-Cookie value for a fresh session. */
export function serializeSessionCookie(token, { ttlMs = DEFAULT_TTL_MS, secure = false } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Serialize the Set-Cookie value that clears the session. */
export function clearSessionCookie({ secure = false } = {}) {
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Parse the Cookie request header into a plain object. */
export function parseCookies(req) {
  const header = req?.headers?.cookie;
  if (!header || typeof header !== 'string') return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** Read + verify the supervisor session from the request cookies. */
export function readSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  return token ? verifySessionToken(token) : null;
}

/** True when the request is (or is proxied as) HTTPS — used to gate Secure. */
export function isSecureRequest(req) {
  if (req?.secure) return true;
  const proto = req?.headers?.['x-forwarded-proto'];
  if (typeof proto !== 'string') return false;
  return proto.split(',')[0].trim() === 'https';
}

// ── Gates ────────────────────────────────────────────────────────────────────
/**
 * Supervisor-ONLY gate. Requires a valid signed supervisor session cookie.
 * Falls back to the legacy body.secret ONLY when ALLOW_LEGACY_API_SECRET=true.
 * Sends a 401 and returns true if unauthorised; returns false if allowed.
 */
export function validateSession(req, res) {
  if (readSession(req)?.role === 'supervisor') return false;
  if (ALLOW_LEGACY_API_SECRET && req?.body?.secret === LEGACY_SECRET) return false;
  res.status(401).json({ error: 'Not authorised.' });
  return true;
}

/**
 * Navigator/shared gate — PILOT-GRADE OPEN. Navigators have no server credential,
 * so these endpoints stay open (protected by per-IP rate limiting). A valid
 * supervisor session or the legacy secret (when enabled) also passes. When
 * REQUIRE_SUPERVISOR_SESSION=true, behaves like validateSession (pilot toggle;
 * will block navigator flows). Returns false = allowed, true = 401 sent.
 */
export function validateSecret(req, res) {
  if (readSession(req)?.role === 'supervisor') return false;
  if (ALLOW_LEGACY_API_SECRET && req?.body?.secret === LEGACY_SECRET) return false;
  if (process.env.REQUIRE_SUPERVISOR_SESSION === 'true') {
    res.status(401).json({ error: 'Not authorised.' });
    return true;
  }
  return false; // open pilot access (rate-limited elsewhere)
}

/**
 * Plain access check for non-Express callers (the WebSocket live relay). Voice
 * practice is a navigator flow, so this mirrors validateSecret's open-pilot
 * policy: allowed unless REQUIRE_SUPERVISOR_SESSION is set. The legacy secret is
 * accepted when enabled. No session cookie is available at the WS message layer.
 */
export function isValidSecret(secret) {
  if (ALLOW_LEGACY_API_SECRET && secret === LEGACY_SECRET) return true;
  return process.env.REQUIRE_SUPERVISOR_SESSION !== 'true';
}
