// Tests for the server-side authorization layer — the security boundary the
// /api handlers run through. Covers the signed-session pipeline (create/verify/
// tamper/expire), cookie helpers, the supervisor-only gate (validateSession),
// and the pilot-open navigator gate (validateSecret).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  serializeSessionCookie,
  clearSessionCookie,
  parseCookies,
  readSession,
  isSecureRequest,
  validateSession,
  validateSecret,
  isValidSecret,
  checkSupervisorPasscode,
  isSupervisorConfigured,
  SESSION_COOKIE,
} from './_auth.js';
import { SUPERVISOR_PASSCODE } from '../src/data/config.js';

function mockRes() {
  const headers = {};
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    setHeader: vi.fn((k, v) => { headers[k] = v; }),
    _headers: headers,
  };
}

// A request carrying a valid supervisor session cookie.
function reqWithSession(token) {
  return { headers: { cookie: `${SESSION_COOKIE}=${token}` }, body: {} };
}

describe('session tokens', () => {
  it('creates a token that verifies and carries the supervisor role', () => {
    const token = createSessionToken({ role: 'supervisor' });
    const payload = verifySessionToken(token);
    expect(payload).toBeTruthy();
    expect(payload.role).toBe('supervisor');
    expect(typeof payload.exp).toBe('number');
  });

  it('rejects a tampered token', () => {
    const token = createSessionToken();
    const [data] = token.split('.');
    expect(verifySessionToken(`${data}.deadbeef`)).toBeNull();
    // Flip a byte in the payload but keep the old signature.
    expect(verifySessionToken(`${data}x.${token.split('.')[1]}`)).toBeNull();
  });

  it('rejects an expired token', () => {
    const now = 1_000_000;
    const token = createSessionToken({}, { ttlMs: 1_000, now });
    expect(verifySessionToken(token, { now: now + 500 })).toBeTruthy();
    expect(verifySessionToken(token, { now: now + 2_000 })).toBeNull();
  });

  it('rejects malformed / missing tokens', () => {
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken('')).toBeNull();
    expect(verifySessionToken('nodot')).toBeNull();
    expect(verifySessionToken('.sig')).toBeNull();
  });
});

describe('cookie helpers', () => {
  it('serializes an HttpOnly, SameSite=Lax, Path=/ session cookie', () => {
    const c = serializeSessionCookie('tok', { ttlMs: 3_600_000 });
    expect(c).toContain(`${SESSION_COOKIE}=tok`);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(c).toContain('Max-Age=3600');
    expect(c).not.toContain('Secure');
  });

  it('adds Secure when requested', () => {
    expect(serializeSessionCookie('tok', { secure: true })).toContain('Secure');
  });

  it('clears the cookie with Max-Age=0', () => {
    expect(clearSessionCookie()).toContain(`${SESSION_COOKIE}=;`);
    expect(clearSessionCookie()).toContain('Max-Age=0');
  });

  it('parses cookies and reads the session round-trip', () => {
    const token = createSessionToken();
    expect(parseCookies({ headers: { cookie: `a=1; ${SESSION_COOKIE}=${token}; b=2` } })[SESSION_COOKIE])
      .toBe(token);
    expect(parseCookies({ headers: {} })).toEqual({});
    expect(readSession(reqWithSession(token)).role).toBe('supervisor');
    expect(readSession({ headers: {} })).toBeNull();
  });
});

describe('isSecureRequest', () => {
  it('detects direct and proxied HTTPS', () => {
    expect(isSecureRequest({ secure: true })).toBe(true);
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'https' } })).toBe(true);
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'https,http' } })).toBe(true);
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'http' } })).toBe(false);
    expect(isSecureRequest({ headers: {} })).toBe(false);
  });
});

describe('passcode', () => {
  it('accepts the configured passcode and rejects others (constant-time)', () => {
    // Default env: SUPERVISOR_PASSCODE_SERVER falls back to the config value.
    expect(checkSupervisorPasscode(SUPERVISOR_PASSCODE)).toBe(true);
    expect(checkSupervisorPasscode('nope')).toBe(false);
    expect(checkSupervisorPasscode(undefined)).toBe(false);
    expect(isSupervisorConfigured()).toBe(true);
  });
});

describe('validateSession (supervisor-only gate)', () => {
  it('allows a request with a valid supervisor session', () => {
    const res = mockRes();
    expect(validateSession(reqWithSession(createSessionToken()), res)).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a request with no session (401)', () => {
    const res = mockRes();
    expect(validateSession({ headers: {}, body: {} }, res)).toBe(true);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authorised.' });
  });

  it('rejects the legacy public secret by default (ALLOW_LEGACY off)', () => {
    const res = mockRes();
    expect(validateSession({ headers: {}, body: { secret: SUPERVISOR_PASSCODE } }, res)).toBe(true);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('validateSecret (navigator/shared gate — pilot-open)', () => {
  it('allows navigator requests with no credential by default', () => {
    const res = mockRes();
    expect(validateSecret({ headers: {}, body: {} }, res)).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows a valid supervisor session too', () => {
    const res = mockRes();
    expect(validateSecret(reqWithSession(createSessionToken()), res)).toBe(false);
  });
});

describe('isValidSecret (WS relay — pilot-open)', () => {
  it('is open by default regardless of the value sent', () => {
    expect(isValidSecret(undefined)).toBe(true);
    expect(isValidSecret('anything')).toBe(true);
  });
});

describe('REQUIRE_SUPERVISOR_SESSION toggle', () => {
  const prev = process.env.REQUIRE_SUPERVISOR_SESSION;
  beforeEach(() => {
    process.env.REQUIRE_SUPERVISOR_SESSION = 'true';
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.REQUIRE_SUPERVISOR_SESSION;
    else process.env.REQUIRE_SUPERVISOR_SESSION = prev;
  });

  it('validateSecret rejects a missing session (401) when the toggle is on', () => {
    const res = mockRes();
    expect(validateSecret({ headers: {}, body: {} }, res)).toBe(true);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authorised.' });
  });

  it('validateSecret allows a valid supervisor session when the toggle is on', () => {
    const res = mockRes();
    expect(validateSecret(reqWithSession(createSessionToken()), res)).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('isValidSecret returns false when the toggle is on and no legacy secret is allowed', () => {
    expect(isValidSecret(undefined)).toBe(false);
    expect(isValidSecret('anything')).toBe(false);
  });
});
