import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));

vi.mock('./_firebase-admin.js', () => ({
  FirebaseAdminConfigError: class FirebaseAdminConfigError extends Error {},
  getFirebaseAdmin: () => ({ auth: { verifyIdToken: mocks.verifyIdToken } }),
}));

import {
  bearerToken,
  checkSupervisorPasscode,
  clearSessionCookie,
  createSessionToken,
  isSecureRequest,
  isSupervisorConfigured,
  parseCookies,
  readSession,
  serializeSessionCookie,
  SESSION_COOKIE,
  validateSecret,
  validateSession,
  verifySessionToken,
  verifySocketToken,
} from './_auth.js';
import { SUPERVISOR_PASSCODE } from '../src/data/config.js';

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

function request({ cookie, token, body = {} } = {}) {
  return {
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  };
}

beforeEach(() => mocks.verifyIdToken.mockReset());

describe('signed supervisor session', () => {
  it('round-trips and rejects tampering/expiry', () => {
    const now = 1_000_000;
    const token = createSessionToken({}, { ttlMs: 1_000, now });
    expect(verifySessionToken(token, { now: now + 500 })?.role).toBe('supervisor');
    expect(verifySessionToken(token, { now: now + 2_000 })).toBeNull();
    const [data] = token.split('.');
    expect(verifySessionToken(`${data}.bad`)).toBeNull();
  });

  it('serializes and clears a secure HttpOnly cookie', () => {
    const cookie = serializeSessionCookie('tok', { ttlMs: 3_600_000, secure: true });
    expect(cookie).toContain(`${SESSION_COOKIE}=tok`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(clearSessionCookie()).toContain('Max-Age=0');
  });

  it('parses cookies and detects proxied HTTPS', () => {
    const token = createSessionToken();
    const req = request({ cookie: `a=1; ${SESSION_COOKIE}=${token}` });
    expect(parseCookies(req)[SESSION_COOKIE]).toBe(token);
    expect(readSession(req)?.role).toBe('supervisor');
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'https,http' } })).toBe(true);
  });
});

describe('server passcode', () => {
  it('uses a constant-time server-side comparison', () => {
    expect(checkSupervisorPasscode(SUPERVISOR_PASSCODE)).toBe(true);
    expect(checkSupervisorPasscode('wrong')).toBe(false);
    expect(isSupervisorConfigured()).toBe(true);
  });
});

describe('Firebase identity gates', () => {
  it('extracts only a Bearer token', () => {
    expect(bearerToken(request({ token: 'abc' }))).toBe('abc');
    expect(bearerToken({ headers: { authorization: 'Basic abc' } })).toBeNull();
  });

  it('allows a navigator ID token on shared endpoints', async () => {
    mocks.verifyIdToken.mockResolvedValue({ role: 'navigator', navigatorId: 'nav-1', uid: 'navigator:nav-1' });
    const req = request({ token: 'nav-token' });
    const res = mockRes();
    expect(await validateSecret(req, res)).toBe(false);
    expect(req.identity.navigatorId).toBe('nav-1');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects missing, invalid, or claim-less tokens', async () => {
    const missingRes = mockRes();
    expect(await validateSecret(request(), missingRes)).toBe(true);
    expect(missingRes.status).toHaveBeenCalledWith(401);

    mocks.verifyIdToken.mockResolvedValue({ uid: 'anonymous' });
    const claimlessRes = mockRes();
    expect(await validateSecret(request({ token: 'claimless' }), claimlessRes)).toBe(true);
    expect(claimlessRes.status).toHaveBeenCalledWith(401);
  });

  it('requires both the HttpOnly session and supervisor Firebase claim for authoring', async () => {
    mocks.verifyIdToken.mockResolvedValue({ role: 'supervisor', uid: 'supervisor' });
    const cookie = `${SESSION_COOKIE}=${createSessionToken()}`;
    const allowed = request({ cookie, token: 'supervisor-token' });
    expect(await validateSession(allowed, mockRes())).toBe(false);

    const noCookie = mockRes();
    expect(await validateSession(request({ token: 'supervisor-token' }), noCookie)).toBe(true);
    expect(noCookie.status).toHaveBeenCalledWith(401);
  });

  it('verifies WebSocket tokens and rejects navigator claims without an id', async () => {
    mocks.verifyIdToken
      .mockResolvedValueOnce({ role: 'navigator', navigatorId: 'nav-1' })
      .mockResolvedValueOnce({ role: 'navigator' });
    await expect(verifySocketToken('good')).resolves.toMatchObject({ navigatorId: 'nav-1' });
    await expect(verifySocketToken('bad')).resolves.toBeNull();
  });
});
