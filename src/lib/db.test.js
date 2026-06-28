// ─────────────────────────────────────────────────────────────────────────────
// UNIT TESTS for lib/db.js — the Firestore data layer.
//
// Firebase and Firestore are fully mocked so no network calls are made. Tests
// verify: composite-key construction, data shape passed to Firestore, legacy
// fallback reads, and the subscription data-mapping transform.
//
// vi.hoisted() is required because vi.mock() factories are hoisted to the top
// of the file, before const/let declarations. vi.hoisted() lifts the mock
// definitions out too, making them available to the factories.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock objects (must live before vi.mock calls) ─────────────────────

const mocks = vi.hoisted(() => {
  const addDoc      = vi.fn();
  const setDoc      = vi.fn();
  const getDoc      = vi.fn();
  const getDocs     = vi.fn();
  const updateDoc   = vi.fn();
  const deleteDoc   = vi.fn();
  const onSnapshot  = vi.fn();
  const collection  = vi.fn((_, col) => ({ col }));
  const doc         = vi.fn((_, col, id) => ({ id, col }));
  const query       = vi.fn((ref) => ref);
  const where       = vi.fn();
  const writeBatch  = vi.fn();
  const serverTimestamp = vi.fn(() => '__ts__');
  const db = {};
  return { addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot,
    collection, doc, query, where, writeBatch, serverTimestamp, db };
});

vi.mock('firebase/firestore', () => ({
  collection:      mocks.collection,
  doc:             mocks.doc,
  addDoc:          mocks.addDoc,
  setDoc:          mocks.setDoc,
  getDoc:          mocks.getDoc,
  getDocs:         mocks.getDocs,
  onSnapshot:      mocks.onSnapshot,
  serverTimestamp: mocks.serverTimestamp,
  query:           mocks.query,
  where:           mocks.where,
  writeBatch:      mocks.writeBatch,
  updateDoc:       mocks.updateDoc,
  deleteDoc:       mocks.deleteDoc,
}));

vi.mock('./firebase.js', () => ({
  db:                 mocks.db,
  isFirebaseConfigured: true,
}));

// Import the module under test AFTER mocks are registered.
import {
  addToRoster,
  updateRosterEntry,
  setRosterStatus,
  saveResult,
  clearResult,
  getRoster,
  subscribeRoster,
} from './db.js';

beforeEach(() => vi.clearAllMocks());

// ── addToRoster ───────────────────────────────────────────────────────────────

describe('addToRoster', () => {
  it('calls addDoc with trimmed name and pin and a server timestamp', async () => {
    mocks.addDoc.mockResolvedValue({ id: 'new-uuid' });
    const id = await addToRoster('  Ada  ', '  1234  ');
    expect(mocks.addDoc).toHaveBeenCalledOnce();
    const [, data] = mocks.addDoc.mock.calls[0];
    expect(data.name).toBe('Ada');
    expect(data.pin).toBe('1234');
    expect(data.createdAt).toBe('__ts__');
    expect(id).toBe('new-uuid');
  });
});

// ── updateRosterEntry ─────────────────────────────────────────────────────────

describe('updateRosterEntry', () => {
  it('sends only the provided fields (name-only patch)', async () => {
    mocks.updateDoc.mockResolvedValue();
    await updateRosterEntry('uuid-1', { name: 'Bea' });
    const [, data] = mocks.updateDoc.mock.calls[0];
    expect(data).toHaveProperty('name', 'Bea');
    expect(data).not.toHaveProperty('pin');
  });

  it('trims name and coerces pin to string', async () => {
    mocks.updateDoc.mockResolvedValue();
    await updateRosterEntry('uuid-1', { name: '  Cyd  ', pin: 5678 });
    const [, data] = mocks.updateDoc.mock.calls[0];
    expect(data.name).toBe('Cyd');
    expect(data.pin).toBe('5678');
  });

  it('targets the roster collection doc by id', async () => {
    mocks.updateDoc.mockResolvedValue();
    await updateRosterEntry('uuid-abc', { name: 'Dot' });
    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, 'roster', 'uuid-abc');
  });
});

// ── setRosterStatus ───────────────────────────────────────────────────────────

describe('setRosterStatus', () => {
  it('calls updateDoc with the status field', async () => {
    mocks.updateDoc.mockResolvedValue();
    await setRosterStatus('uuid-1', 'inactive');
    const [, data] = mocks.updateDoc.mock.calls[0];
    expect(data).toEqual({ status: 'inactive' });
  });
});

// ── saveResult ────────────────────────────────────────────────────────────────

describe('saveResult', () => {
  it('uses a composite key ${navigatorId}__${department}', async () => {
    mocks.setDoc.mockResolvedValue();
    await saveResult('nav-id', 'Ada', { s1: 80 }, {}, 'obgyn');
    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, 'results', 'nav-id__obgyn');
  });

  it('defaults department to pediatrics', async () => {
    mocks.setDoc.mockResolvedValue();
    await saveResult('nav-id', 'Ada', {});
    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, 'results', 'nav-id__pediatrics');
  });

  it('stores navigatorId, name, department, scores, competencyScores, and answers', async () => {
    mocks.setDoc.mockResolvedValue();
    const scores   = { d1: 70 };
    const cScores  = { c1: 90 };
    const answers  = { q1: 'a' };
    await saveResult('nav-id', 'Ada', scores, cScores, 'pediatrics', answers);
    const [, data] = mocks.setDoc.mock.calls[0];
    expect(data).toMatchObject({ navigatorId: 'nav-id', name: 'Ada', department: 'pediatrics',
      scores, competencyScores: cScores, answers });
    expect(data.submittedAt).toBe('__ts__');
  });
});

// ── clearResult ───────────────────────────────────────────────────────────────

describe('clearResult', () => {
  it('deletes the composite-key doc when it exists', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true });
    mocks.deleteDoc.mockResolvedValue();
    await clearResult('nav-id', 'obgyn');
    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, 'results', 'nav-id__obgyn');
    expect(mocks.deleteDoc).toHaveBeenCalledOnce();
  });

  it('falls back to the legacy plain-id doc when composite does not exist', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    mocks.deleteDoc.mockResolvedValue();
    await clearResult('nav-id', 'pediatrics');
    const ids = mocks.doc.mock.calls.map(([, , id]) => id);
    expect(ids).toContain('nav-id__pediatrics'); // composite tried first
    expect(ids).toContain('nav-id');             // then legacy
    expect(mocks.deleteDoc).toHaveBeenCalledOnce();
  });
});

// ── getRoster ─────────────────────────────────────────────────────────────────

describe('getRoster', () => {
  it('returns roster docs with id merged from the doc snapshot', async () => {
    mocks.getDocs.mockResolvedValue({
      docs: [
        { id: 'id-1', data: () => ({ name: 'Ada', pin: '1111' }) },
        { id: 'id-2', data: () => ({ name: 'Bea', pin: '2222' }) },
      ],
    });
    const roster = await getRoster();
    expect(roster).toEqual([
      { id: 'id-1', name: 'Ada', pin: '1111' },
      { id: 'id-2', name: 'Bea', pin: '2222' },
    ]);
  });
});

// ── subscribeRoster ───────────────────────────────────────────────────────────

describe('subscribeRoster', () => {
  it('invokes the callback with mapped roster data from the snapshot', () => {
    const fakeDocs = [{ id: 'id-1', data: () => ({ name: 'Ada', pin: '1111' }) }];
    mocks.onSnapshot.mockImplementation((ref, cb) => {
      cb({ docs: fakeDocs });
      return () => {};
    });
    const cb = vi.fn();
    subscribeRoster(cb);
    expect(cb).toHaveBeenCalledWith([{ id: 'id-1', name: 'Ada', pin: '1111' }]);
  });

  it('calls onError when the snapshot errors', () => {
    const fakeErr = new Error('Firestore offline');
    mocks.onSnapshot.mockImplementation((ref, cb, errCb) => {
      errCb(fakeErr);
      return () => {};
    });
    const onError = vi.fn();
    subscribeRoster(() => {}, onError);
    expect(onError).toHaveBeenCalledWith(fakeErr);
  });

  it('returns the unsubscribe function', () => {
    const unsub = vi.fn();
    mocks.onSnapshot.mockReturnValue(unsub);
    const result = subscribeRoster(() => {});
    expect(result).toBe(unsub);
  });
});
