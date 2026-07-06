// Tests for the shared secret gate — the security boundary every /api Gemini
// handler (and the voice relay) runs through. SECRET resolves at import time to
// GENERATION_SECRET || SUPERVISOR_PASSCODE, so derive the expected value the same way.
import { describe, it, expect, vi } from 'vitest';
import { validateSecret, isValidSecret } from './_auth.js';
import { SUPERVISOR_PASSCODE } from '../src/data/config.js';

const SECRET = process.env.GENERATION_SECRET || SUPERVISOR_PASSCODE;

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

describe('validateSecret', () => {
  it('accepts the configured secret (no response sent)', () => {
    const res = mockRes();
    expect(validateSecret({ body: { secret: SECRET } }, res)).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret with 401', () => {
    const res = mockRes();
    expect(validateSecret({ body: { secret: 'nope' } }, res)).toBe(true);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authorised.' });
  });

  it('rejects a missing body/secret with 401', () => {
    const res = mockRes();
    expect(validateSecret({}, res)).toBe(true);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('isValidSecret', () => {
  it('matches only the configured secret', () => {
    expect(isValidSecret(SECRET)).toBe(true);
    expect(isValidSecret('nope')).toBe(false);
    expect(isValidSecret(undefined)).toBe(false);
  });
});
