// ─────────────────────────────────────────────────────────────────────────────
// UNIT TESTS for lib/session.js
//
// localStorage is mocked via Vitest's built-in structuredClone-safe storage
// mock so tests run without a browser DOM. Each test resets the mock store.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSession, setSession, clearSession } from './session.js';

// ── localStorage mock ────────────────────────────────────────────────────────

const store = {};
const localStorageMock = {
  getItem:    (key)        => store[key] ?? null,
  setItem:    (key, value) => { store[key] = String(value); },
  removeItem: (key)        => { delete store[key]; },
  clear:      ()           => { for (const k of Object.keys(store)) delete store[k]; },
};

vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => localStorageMock.clear());

// ─────────────────────────────────────────────────────────────────────────────

describe('getSession', () => {
  it('returns null when nothing is stored', () => {
    expect(getSession()).toBeNull();
  });

  it('returns the stored session after setSession', () => {
    setSession('navigator', 'Ada', 'uuid-123');
    expect(getSession()).toEqual({ role: 'navigator', name: 'Ada', navigatorId: 'uuid-123' });
  });

  it('returns null for navigatorId when not provided', () => {
    setSession('supervisor', 'Supervisor');
    expect(getSession()).toEqual({ role: 'supervisor', name: 'Supervisor', navigatorId: null });
  });

  it('returns null and does not throw when stored JSON is corrupt', () => {
    localStorageMock.setItem('qkc_session', 'not-valid-json{{{');
    expect(getSession()).toBeNull();
  });
});

describe('setSession', () => {
  it('overwrites an existing session', () => {
    setSession('navigator', 'Ada', 'old-id');
    setSession('supervisor', 'Supervisor');
    expect(getSession()).toEqual({ role: 'supervisor', name: 'Supervisor', navigatorId: null });
  });

  it('does not throw if localStorage is unavailable', () => {
    const throwing = {
      ...localStorageMock,
      setItem: () => { throw new Error('Storage full'); },
      getItem: () => null,
    };
    vi.stubGlobal('localStorage', throwing);
    expect(() => setSession('navigator', 'Ada', 'id')).not.toThrow();
    // restore
    vi.stubGlobal('localStorage', localStorageMock);
  });
});

describe('clearSession', () => {
  it('removes the stored session', () => {
    setSession('navigator', 'Bea', 'uuid-456');
    clearSession();
    expect(getSession()).toBeNull();
  });

  it('is a no-op when nothing is stored', () => {
    expect(() => clearSession()).not.toThrow();
    expect(getSession()).toBeNull();
  });

  it('does not throw if localStorage is unavailable', () => {
    const throwing = {
      ...localStorageMock,
      removeItem: () => { throw new Error('Security error'); },
    };
    vi.stubGlobal('localStorage', throwing);
    expect(() => clearSession()).not.toThrow();
    vi.stubGlobal('localStorage', localStorageMock);
  });
});
