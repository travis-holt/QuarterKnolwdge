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
  // authReady gates every read/write and defers each subscription's onSnapshot
  // (see db.js). A resolved promise here keeps the gating a single microtask.
  authReady:          Promise.resolve(true),
}));

// Flush the microtask/task queue so a deferred (authReady-gated) subscription has
// attached its onSnapshot before we assert on it.
const flush = () => new Promise((r) => setTimeout(r, 0));

// Import the module under test AFTER mocks are registered.
import {
  addToRoster,
  updateRosterEntry,
  setRosterStatus,
  saveResult,
  getFloorScores,
  clearResult,
  getRoster,
  subscribeRoster,
  seedQuestionsIfEmpty,
  saveCompletion,
  getCompletions,
  savePairing,
  saveSupervisorFeedback,
  subscribeSupervisorFeedback,
  saveLearningProposal,
  updateLearningProposalStatus,
  subscribeLearningProposals,
  saveDraftAudits,
  getActiveAudits,
  activateAudit,
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

  it('allows a blank pin so the navigator can create one later', async () => {
    mocks.addDoc.mockResolvedValue({ id: 'new-uuid' });
    await addToRoster('Ada');
    const [, data] = mocks.addDoc.mock.calls[0];
    expect(data.pin).toBe('');
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
  beforeEach(() => {
    mocks.writeBatch.mockReturnValue({ set: vi.fn(), commit: vi.fn().mockResolvedValue() });
  });

  it('uses a composite key ${navigatorId}__${department}', async () => {
    await saveResult('nav-id', 'Ada', { s1: 80 }, {}, 'obgyn');
    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, 'results', 'nav-id__obgyn');
  });

  it('defaults department to pediatrics', async () => {
    await saveResult('nav-id', 'Ada', {});
    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, 'results', 'nav-id__pediatrics');
  });

  it('stores Call QA separately from MCQ and Spot results', async () => {
    await saveResult('nav-id', 'Ada', { d1: 88 }, {}, 'obgyn', {}, 'qa');
    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, 'results', 'nav-id__obgyn__qa');
  });

  it('stores result and history in one batch', async () => {
    const batch = { set: vi.fn(), commit: vi.fn().mockResolvedValue() };
    mocks.writeBatch.mockReturnValue(batch);
    const scores   = { d1: 70 };
    const cScores  = { c1: 90 };
    const answers  = { q1: 'a' };
    await saveResult('nav-id', 'Ada', scores, cScores, 'pediatrics', answers);
    expect(batch.set).toHaveBeenCalledTimes(2);
    const [, data] = batch.set.mock.calls[0];
    expect(data).toMatchObject({ navigatorId: 'nav-id', name: 'Ada', department: 'pediatrics',
      scores, competencyScores: cScores, answers });
    expect(data.submittedAt).toBe('__ts__');
    expect(batch.set.mock.calls[1][1]).toMatchObject({ navigatorId: 'nav-id', department: 'pediatrics', scores });
    expect(batch.commit).toHaveBeenCalledOnce();
  });
});

describe('getFloorScores', () => {
  it('returns latest projected result per navigator for one department', async () => {
    mocks.getDocs.mockResolvedValue({
      docs: [
        { id: 'old', data: () => ({ navigatorId: 'n1', name: 'Ada', department: 'obgyn', scores: { d: 40 }, submittedAt: { seconds: 1 } }) },
        { id: 'new', data: () => ({ navigatorId: 'n1', name: 'Ada', department: 'obgyn', scores: { d: 80 }, assessmentType: 'spot', submittedAt: { seconds: 2 } }) },
        { id: 'peds', data: () => ({ navigatorId: 'n2', name: 'Bea', department: 'pediatrics', scores: { d: 99 }, submittedAt: { seconds: 3 } }) },
      ],
    });
    await expect(getFloorScores('obgyn')).resolves.toEqual([
      { navigatorId: 'n1', name: 'Ada', scores: { d: 80 }, assessmentType: 'spot', submittedAt: { seconds: 2 } },
    ]);
  });
});

// ── clearResult ───────────────────────────────────────────────────────────────

describe('clearResult', () => {
  it('deletes MCQ, Spot, and Call QA docs for the department when they exist', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true });
    mocks.deleteDoc.mockResolvedValue();
    await clearResult('nav-id', 'obgyn');
    const ids = mocks.doc.mock.calls.map(([, , id]) => id);
    expect(ids).toContain('nav-id__obgyn');        // MCQ (composite)
    expect(ids).toContain('nav-id__obgyn__spot');  // Spot the Error
    expect(ids).toContain('nav-id__obgyn__qa');    // Call QA Test
    expect(mocks.deleteDoc).toHaveBeenCalledTimes(3);
  });

  it('also targets the legacy plain-id doc for pediatrics and skips non-existent docs', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    mocks.deleteDoc.mockResolvedValue();
    await clearResult('nav-id', 'pediatrics');
    const ids = mocks.doc.mock.calls.map(([, , id]) => id);
    expect(ids).toContain('nav-id__pediatrics');       // MCQ composite
    expect(ids).toContain('nav-id__pediatrics__spot'); // Spot the Error
    expect(ids).toContain('nav-id__pediatrics__qa');   // Call QA Test
    expect(ids).toContain('nav-id');                   // legacy plain-id
    expect(mocks.deleteDoc).not.toHaveBeenCalled();    // none existed → nothing deleted
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

describe('department-scoped helpers', () => {
  it('saveCompletion writes department and getCompletions filters legacy docs as pediatrics', async () => {
    mocks.setDoc.mockResolvedValue();
    await saveCompletion('nav-id', 'Ada', 'routing', 'practice', 'obgyn');
    expect(mocks.setDoc.mock.calls[0][1]).toMatchObject({ department: 'obgyn', domainId: 'routing' });

    mocks.getDocs.mockResolvedValue({
      docs: [
        { id: 'c1', data: () => ({ navigatorId: 'nav-id', domainId: 'routing', department: 'obgyn' }) },
        { id: 'c2', data: () => ({ navigatorId: 'nav-id', domainId: 'intake' }) },
      ],
    });
    await expect(getCompletions('nav-id', 'pediatrics')).resolves.toEqual([
      { id: 'c2', navigatorId: 'nav-id', domainId: 'intake' },
    ]);
  });

  it('savePairing defaults department to pediatrics', async () => {
    mocks.setDoc.mockResolvedValue();
    await savePairing({ domainId: 'routing', mentorName: 'Ada', menteeName: 'Bea' });
    expect(mocks.setDoc.mock.calls[0][1]).toMatchObject({ department: 'pediatrics', status: 'active' });
  });

  it('seedQuestionsIfEmpty adds only missing seed ids', async () => {
    const batch = { set: vi.fn(), commit: vi.fn().mockResolvedValue() };
    mocks.writeBatch.mockReturnValue(batch);
    mocks.getDocs.mockResolvedValue({
      docs: [{ id: 'q1', data: () => ({}) }],
    });
    const seeded = await seedQuestionsIfEmpty([
      { id: 'q1', domainId: 'intake', scenario: 'old', options: [], correctOptionId: 'a' },
      { id: 'q2', domainId: 'routing', scenario: 'new', options: [], correctOptionId: 'a', department: 'obgyn' },
    ]);
    expect(seeded).toBe(true);
    expect(batch.set).toHaveBeenCalledOnce();
    expect(batch.set.mock.calls[0][1]).toMatchObject({ department: 'obgyn', status: 'active' });
  });
});

describe('subscribeRoster', () => {
  it('invokes the callback with mapped roster data from the snapshot', async () => {
    const fakeDocs = [{ id: 'id-1', data: () => ({ name: 'Ada', pin: '1111' }) }];
    mocks.onSnapshot.mockImplementation((ref, cb) => {
      cb({ docs: fakeDocs });
      return () => {};
    });
    const cb = vi.fn();
    subscribeRoster(cb);
    await flush(); // listen is deferred until authReady resolves
    expect(cb).toHaveBeenCalledWith([{ id: 'id-1', name: 'Ada', pin: '1111' }]);
  });

  it('calls onError when the snapshot errors', async () => {
    const fakeErr = new Error('Firestore offline');
    mocks.onSnapshot.mockImplementation((ref, cb, errCb) => {
      errCb(fakeErr);
      return () => {};
    });
    const onError = vi.fn();
    subscribeRoster(() => {}, onError);
    await flush();
    expect(onError).toHaveBeenCalledWith(fakeErr);
  });

  it('returns an unsubscribe function that tears down the underlying listener', async () => {
    const unsub = vi.fn();
    mocks.onSnapshot.mockReturnValue(unsub);
    const result = subscribeRoster(() => {});
    expect(typeof result).toBe('function');
    await flush(); // let the deferred onSnapshot attach
    result();
    expect(unsub).toHaveBeenCalledOnce();
  });
});

// ── Audit bank (pre-generated Spot the Error transcripts) ─────────────────────

describe('audit bank db helpers', () => {
  it('saveDraftAudits batches drafts with status draft, source, and department', async () => {
    const batchSet = vi.fn();
    const batchCommit = vi.fn().mockResolvedValue();
    mocks.writeBatch.mockReturnValue({ set: batchSet, commit: batchCommit });

    const drafts = [{
      domainId: 'routing',
      transcript: [{ speaker: 'Agent', message: 'Hello' }],
      errorIndex: 0,
      hint: 'Look closely',
      modelExplanation: 'Wrong queue.',
    }];
    const ids = await saveDraftAudits(drafts, 'gemini', 'obgyn');

    expect(mocks.collection).toHaveBeenCalledWith(mocks.db, 'audits');
    expect(batchSet).toHaveBeenCalledOnce();
    const [, data] = batchSet.mock.calls[0];
    expect(data).toMatchObject({
      domainId: 'routing',
      errorIndex: 0,
      status: 'draft',
      source: 'gemini',
      department: 'obgyn',
    });
    expect(data.createdAt).toBe('__ts__');
    expect(batchCommit).toHaveBeenCalledOnce();
    expect(ids).toHaveLength(1);
  });

  it('getActiveAudits filters to the requested department (legacy docs = pediatrics)', async () => {
    mocks.getDocs.mockResolvedValue({
      docs: [
        { id: 'a1', data: () => ({ domainId: 'intake', department: 'obgyn' }) },
        { id: 'a2', data: () => ({ domainId: 'routing', department: 'pediatrics' }) },
        { id: 'a3', data: () => ({ domainId: 'boundaries' }) }, // legacy, no department
      ],
    });
    const audits = await getActiveAudits('pediatrics');
    expect(audits.map((a) => a.id)).toEqual(['a2', 'a3']);
  });

  it('activateAudit sets status active on the audits doc', async () => {
    mocks.updateDoc.mockResolvedValue();
    await activateAudit('audit-1');
    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, 'audits', 'audit-1');
    const [, data] = mocks.updateDoc.mock.calls[0];
    expect(data).toEqual({ status: 'active' });
  });
});

describe('learning loop db helpers', () => {
  it('saveSupervisorFeedback stores the target, status, context, and timestamp', async () => {
    mocks.setDoc.mockResolvedValue();
    await saveSupervisorFeedback({
      targetType: 'interviewGrade',
      targetId: 'iv1',
      status: 'needsAdjustment',
      note: 'Too generous',
      context: { score: 88 },
    });
    expect(mocks.collection).toHaveBeenCalledWith(mocks.db, 'supervisorFeedback');
    const [, data] = mocks.setDoc.mock.calls[0];
    expect(data).toMatchObject({
      targetType: 'interviewGrade',
      targetId: 'iv1',
      status: 'needsAdjustment',
      note: 'Too generous',
      context: { score: 88 },
    });
    expect(data.createdAt).toBe('__ts__');
  });

  it('saveLearningProposal writes a pending proposal with reasons', async () => {
    mocks.setDoc.mockResolvedValue();
    await saveLearningProposal({
      type: 'questionRevision',
      title: 'Review q1',
      target: { questionId: 'q1' },
      payload: { draft: true },
      reasons: ['Low correct rate'],
    });
    const [, data] = mocks.setDoc.mock.calls[0];
    expect(data.status).toBe('pending');
    expect(data.reasons).toEqual(['Low correct rate']);
    expect(data.createdAt).toBe('__ts__');
  });

  it('updateLearningProposalStatus stores review metadata and reviewedAt', async () => {
    mocks.updateDoc.mockResolvedValue();
    await updateLearningProposalStatus('proposal-1', 'approved', { note: 'Create draft' });
    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, 'learningProposals', 'proposal-1');
    const [, data] = mocks.updateDoc.mock.calls[0];
    expect(data).toMatchObject({ status: 'approved', review: { note: 'Create draft' } });
    expect(data.reviewedAt).toBe('__ts__');
  });

  it('subscribeSupervisorFeedback maps snapshot docs', async () => {
    const fakeDocs = [{ id: 'fb1', data: () => ({ status: 'helpful' }) }];
    mocks.onSnapshot.mockImplementation((ref, cb) => {
      cb({ docs: fakeDocs });
      return () => {};
    });
    const cb = vi.fn();
    subscribeSupervisorFeedback(cb);
    await flush();
    expect(cb).toHaveBeenCalledWith([{ id: 'fb1', status: 'helpful' }]);
  });

  it('subscribeLearningProposals maps snapshot docs', async () => {
    const fakeDocs = [{ id: 'lp1', data: () => ({ status: 'pending' }) }];
    mocks.onSnapshot.mockImplementation((ref, cb) => {
      cb({ docs: fakeDocs });
      return () => {};
    });
    const cb = vi.fn();
    subscribeLearningProposals(cb);
    await flush();
    expect(cb).toHaveBeenCalledWith([{ id: 'lp1', status: 'pending' }]);
  });
});
