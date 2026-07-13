// Tests for the /api/supervisor-login + /api/logout endpoints.
import { describe, it, expect, vi } from 'vitest';

const adminMocks = vi.hoisted(() => ({ createCustomToken: vi.fn().mockResolvedValue('firebase-custom-token') }));
vi.mock('./_firebase-admin.js', () => ({
  FirebaseAdminConfigError: class FirebaseAdminConfigError extends Error {},
  getFirebaseAdmin: () => ({ auth: { createCustomToken: adminMocks.createCustomToken } }),
}));

import login from './supervisor-login.js';
import logout from './logout.js';
import { verifySessionToken, SESSION_COOKIE } from './_auth.js';
import { SUPERVISOR_PASSCODE } from '../src/data/config.js';

function mockRes() {
  const state = { code: 200, headers: {}, body: undefined };
  return {
    status: vi.fn(function (c) { state.code = c; return this; }),
    json: vi.fn(function (b) { state.body = b; return this; }),
    setHeader: vi.fn((k, v) => { state.headers[k] = v; }),
    _state: state,
  };
}

function cookieToken(setCookie) {
  const m = /kc_supervisor_session=([^;]+)/.exec(setCookie || '');
  return m ? m[1] : null;
}

describe('POST /api/supervisor-login', () => {
  it('sets an HttpOnly session cookie and returns a Firebase custom token for the correct passcode', async () => {
    const res = mockRes();
    await login({ method: 'POST', body: { passcode: SUPERVISOR_PASSCODE }, headers: {} }, res);
    expect(res._state.code).toBe(200);
    expect(res._state.body).toEqual({ ok: true, customToken: 'firebase-custom-token' });
    expect(adminMocks.createCustomToken).toHaveBeenCalledWith('knowledge-check-supervisor', { role: 'supervisor' });
    const setCookie = res._state.headers['Set-Cookie'];
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    // The cookie carries a verifiable supervisor session.
    const payload = verifySessionToken(cookieToken(setCookie));
    expect(payload.role).toBe('supervisor');
  });

  it('returns 401 for a wrong passcode and sets no cookie', async () => {
    const res = mockRes();
    await login({ method: 'POST', body: { passcode: 'wrong' }, headers: {} }, res);
    expect(res._state.code).toBe(401);
    expect(res._state.body).toEqual({ error: 'Incorrect passcode.' });
    expect(res._state.headers['Set-Cookie']).toBeUndefined();
  });

  it('rejects non-POST methods with 405', async () => {
    const res = mockRes();
    await login({ method: 'GET', body: {}, headers: {} }, res);
    expect(res._state.code).toBe(405);
  });

  it('marks the cookie Secure behind an HTTPS proxy', async () => {
    const res = mockRes();
    await login(
      { method: 'POST', body: { passcode: SUPERVISOR_PASSCODE }, headers: { 'x-forwarded-proto': 'https' } },
      res
    );
    expect(res._state.headers['Set-Cookie']).toContain('Secure');
  });
});

describe('POST /api/logout', () => {
  it('clears the session cookie', () => {
    const res = mockRes();
    logout({ method: 'POST', headers: {} }, res);
    expect(res._state.code).toBe(200);
    expect(res._state.headers['Set-Cookie']).toContain('Max-Age=0');
  });
});
