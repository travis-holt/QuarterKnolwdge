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
//   • validateSecret(req, res)   — navigator/practice + shared endpoints. Requires
//     a server-issued Firebase ID token carrying role/navigatorId claims.
//
// The localStorage role remains only a UI convenience. It cannot authorize an
// API or Firestore request; server verification + Firestore claims are the trust
// boundary.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { SUPERVISOR_PASSCODE } from '../src/data/config.js';
import { FirebaseAdminConfigError, getFirebaseAdmin } from './_firebase-admin.js';

// Server-side supervisor passcode. The bundled demo value is allowed only in a
// local/test process. Railway/Vercel/production must provide an explicit secret;
// otherwise the login endpoint fails closed instead of promoting a public value
// from the JavaScript bundle into an administrator credential.
const IS_DEPLOYED = process.env.NODE_ENV === 'production'
  || Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.VERCEL);
const SUPERVISOR_PASSCODE_SERVER =
  process.env.SUPERVISOR_PASSCODE_SERVER
  || process.env.SUPERVISOR_PASSCODE
  || (IS_DEPLOYED ? '' : SUPERVISOR_PASSCODE);

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

export function bearerToken(req) {
  const header = req?.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/** Verify and cache the Firebase identity carried by an HTTP request. */
export async function readFirebaseIdentity(req) {
  if (Object.prototype.hasOwnProperty.call(req ?? {}, '_firebaseIdentity')) {
    return req._firebaseIdentity;
  }
  const token = bearerToken(req);
  if (!token) {
    if (req) req._firebaseIdentity = null;
    return null;
  }
  const identity = await getFirebaseAdmin().auth.verifyIdToken(token, true);
  if (req) req._firebaseIdentity = identity;
  return identity;
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
export async function validateSession(req, res) {
  if (ALLOW_LEGACY_API_SECRET && req?.body?.secret === LEGACY_SECRET) return false;
  try {
    const [session, identity] = await Promise.all([
      Promise.resolve(readSession(req)),
      readFirebaseIdentity(req),
    ]);
    if (session?.role === 'supervisor' && identity?.role === 'supervisor') {
      req.identity = identity;
      return false;
    }
  } catch (err) {
    if (err instanceof FirebaseAdminConfigError || err?.code === 'firebase-admin-not-configured') {
      res.status(503).json({ error: 'Server authentication is not configured.' });
      return true;
    }
  }
  res.status(401).json({ error: 'Not authorised.' });
  return true;
}

/**
 * Navigator/shared gate. Requires a verified server-issued Firebase identity;
 * rate limiting is an additional abuse control, never the authorization layer.
 * Returns false = allowed, true = response already sent.
 */
export async function validateSecret(req, res) {
  if (ALLOW_LEGACY_API_SECRET && req?.body?.secret === LEGACY_SECRET) return false;
  try {
    const identity = await readFirebaseIdentity(req);
    if (identity?.role === 'supervisor' || (
      identity?.role === 'navigator' &&
      typeof identity.navigatorId === 'string' &&
      identity.navigatorId.length > 0
    )) {
      req.identity = identity;
      return false;
    }
  } catch (err) {
    if (err instanceof FirebaseAdminConfigError || err?.code === 'firebase-admin-not-configured') {
      res.status(503).json({ error: 'Server authentication is not configured.' });
      return true;
    }
  }
  res.status(401).json({ error: 'Not authorised.' });
  return true;
}

/** Role-constrained Firebase gate for protected projection/data endpoints. */
export async function validateAppUser(req, res, roles = ['navigator', 'supervisor']) {
  if (await validateSecret(req, res)) return true;
  if (!roles.includes(req.identity?.role)) {
    res.status(403).json({ error: 'Insufficient permission.' });
    return true;
  }
  return false;
}

/**
 * Plain access check for non-Express callers (the WebSocket live relay). The
 * first WS message must carry a verified server-issued Firebase ID token.
 */
export async function verifySocketToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;
  try {
    const identity = await getFirebaseAdmin().auth.verifyIdToken(idToken, true);
    if (identity?.role === 'supervisor') return identity;
    if (identity?.role === 'navigator' && identity.navigatorId) return identity;
    return null;
  } catch {
    return null;
  }
}
