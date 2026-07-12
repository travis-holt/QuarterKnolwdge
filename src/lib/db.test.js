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
  const runTransaction = vi.fn();
  const serverTimestamp = vi.fn(() => '__ts__');
  const db = {};
  return { addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot,
    collection, doc, query, where, writeBatch, runTransaction, serverTimestamp, db };
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
  runTransaction:  mocks.runTransaction,
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
  archiveQaAttempts,
  saveInterview,
  updateQaFinalReview,
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
  runContentQualityFixesMigration,
  runMcqV2OperatingModelMigration,
  activateSop,
  archiveSop,
} from './db.js';
import { ALL_V2_QUESTIONS } from '../data/questions-v2.js';

beforeEach(() => vi.clearAllMocks());

// ── addToRoster ───────────────────────────────────────────────────────────────

describe('addToRoster', () => {
  it('stores a trimmed name and PIN status without persisting PIN material', async () => {
    mocks.addDoc.mockResolvedValue({ id: 'new-uuid' });
    const id = await addToRoster('  Ada  ', '  1234  ');
    expect(mocks.addDoc).toHaveBeenCalledOnce();
    const [, data] = mocks.addDoc.mock.calls[0];
    expect(data.name).toBe('Ada');
    expect(data.pinSet).toBe(false);
    expect(data).not.toHaveProperty('pin');
    expect(data.createdAt).toBe('__ts__');
    expect(id).toBe('new-uuid');
  });

  it('marks a new navigator as needing server-side PIN setup', async () => {
    mocks.addDoc.mockResolvedValue({ id: 'new-uuid' });
    await addToRoster('Ada');
    const [, data] = mocks.addDoc.mock.calls[0];
    expect(data.pinSet).toBe(false);
    expect(data).not.toHaveProperty('pin');
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

  it('trims names and ignores client-supplied PIN fields', async () => {
    mocks.updateDoc.mockResolvedValue();
    await updateRosterEntry('uuid-1', { name: '  Cyd  ', pin: 5678 });
    const [, data] = mocks.updateDoc.mock.calls[0];
    expect(data.name).toBe('Cyd');
    expect(data).not.toHaveProperty('pin');
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
    expect(batch.set.mock.calls[1][1]).toMatchObject({ navigatorId: 'nav-id', department: 'pediatrics', scores, answers });
    expect(batch.commit).toHaveBeenCalledOnce();
  });

  it('atomically stores a passed mini-check completion with the updated result', async () => {
    const batch = { set: vi.fn(), commit: vi.fn().mockResolvedValue() };
    mocks.writeBatch.mockReturnValue(batch);
    await saveResult(
      'nav-id',
      'Ada',
      { routing: 75 },
      {},
      'pediatrics',
      { q1: 'a' },
      'mcq',
      { domainId: 'routing', kind: 'minicheck', passed: true, score: 75 },
    );

    expect(batch.set).toHaveBeenCalledTimes(3);
    expect(batch.set.mock.calls[2][1]).toMatchObject({
      navigatorId: 'nav-id',
      domainId: 'routing',
      kind: 'minicheck',
      passed: true,
      score: 75,
    });
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

describe('archiveQaAttempts', () => {
  it('archives only matching active QA attempts', async () => {
    const batch = { update: vi.fn(), commit: vi.fn().mockResolvedValue() };
    mocks.writeBatch.mockReturnValue(batch);
    mocks.getDocs.mockResolvedValue({
      docs: [
        { id: 'keep-practice', data: () => ({ navigatorId: 'nav-id', department: 'obgyn', transcript: [] }) },
        { id: 'keep-archived', data: () => ({ navigatorId: 'nav-id', department: 'obgyn', qa: { score: 91 }, qaArchived: true }) },
        { id: 'keep-other-dept', data: () => ({ navigatorId: 'nav-id', department: 'pediatrics', qa: { score: 88 } }) },
        { id: 'keep-other-nav', data: () => ({ navigatorId: 'other-nav', department: 'obgyn', qa: { score: 87 } }) },
        { id: 'archive-me', data: () => ({ navigatorId: 'nav-id', department: 'obgyn', qa: { score: 83 } }) },
      ],
    });

    await expect(archiveQaAttempts('nav-id', 'obgyn')).resolves.toBe(1);

    expect(batch.update).toHaveBeenCalledOnce();
    expect(batch.update).toHaveBeenCalledWith(
      { id: 'archive-me', col: 'interviews' },
      expect.objectContaining({
        qaArchived: true,
        qaArchivedAt: '__ts__',
        qaArchivedReason: 'Supervisor reset',
        qaArchivedBy: 'supervisor',
      })
    );
    expect(batch.commit).toHaveBeenCalledOnce();
  });
});

// ── getRoster ─────────────────────────────────────────────────────────────────

describe('saveInterview', () => {
  it('stores generated defaults when no metadata is provided', async () => {
    mocks.setDoc.mockResolvedValue();
    await saveInterview('nav-id', 'Ada', 'routing', 'Scenario', 'Caller', [], 'pediatrics');

    const [, data] = mocks.setDoc.mock.calls[0];
    expect(data).toMatchObject({
      navigatorId: 'nav-id',
      name: 'Ada',
      department: 'pediatrics',
      domainId: 'routing',
      scenarioSource: 'generated',
      qaScenarioId: null,
      domainIds: ['routing'],
      competencyIds: [],
      expectedActions: [],
      criticalMisses: [],
    });
    expect(data.endedAt).toBe('__ts__');
  });

  it('stores compact curated QA scenario metadata', async () => {
    mocks.setDoc.mockResolvedValue();
    const metadata = {
      scenarioSource: 'curated',
      qaScenarioId: 'qa-peds-referral-001',
      qaScenarioTitle: 'Parent calling about referral status',
      workflowType: 'referral',
      difficulty: 'medium',
      domainIds: ['intake', 'routing'],
      competencyIds: ['sopApplication', 'communication'],
      expectedActions: ['Identify the patient.'],
      criticalMisses: ['Promises approval.'],
    };

    await saveInterview('nav-id', 'Ada', 'routing', 'Scenario', 'Caller', [], 'pediatrics', metadata);

    expect(mocks.setDoc.mock.calls[0][1]).toMatchObject(metadata);
  });
});

describe('updateQaFinalReview', () => {
  it('writes confirmed_pass with finalPass true', async () => {
    mocks.updateDoc.mockResolvedValue();
    await updateQaFinalReview('iv-1', { status: 'confirmed_pass' });
    expect(mocks.updateDoc).toHaveBeenCalledWith(
      { id: 'iv-1', col: 'interviews' },
      {
        qaFinalReview: {
          status: 'confirmed_pass',
          finalPass: true,
          reason: '',
          reviewedAt: '__ts__',
          reviewedBy: 'supervisor',
        },
      }
    );
  });

  it('writes confirmed_fail with finalPass false', async () => {
    mocks.updateDoc.mockResolvedValue();
    await updateQaFinalReview('iv-1', { status: 'confirmed_fail' });
    expect(mocks.updateDoc.mock.calls[0][1].qaFinalReview.finalPass).toBe(false);
  });

  it('writes overridden_pass with required reason and finalPass true', async () => {
    mocks.updateDoc.mockResolvedValue();
    await updateQaFinalReview('iv-1', { status: 'overridden_pass', reason: 'Navigator routed correctly.' });
    expect(mocks.updateDoc.mock.calls[0][1]).toEqual({
      qaFinalReview: {
        status: 'overridden_pass',
        finalPass: true,
        reason: 'Navigator routed correctly.',
        reviewedAt: '__ts__',
        reviewedBy: 'supervisor',
      },
    });
  });

  it('rejects override with empty reason', async () => {
    await expect(updateQaFinalReview('iv-1', { status: 'overridden_fail', reason: '   ' }))
      .rejects.toThrow(/Override reason is required/);
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects invalid status', async () => {
    await expect(updateQaFinalReview('iv-1', { status: 'pending' }))
      .rejects.toThrow(/Invalid QA final review status/);
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });
});

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

describe('activateSop', () => {
  it('uses a transactionally contested department pointer and archives the previous active SOP', async () => {
    mocks.getDocs.mockResolvedValue({ docs: [{ id: 'legacy', data: () => ({ status: 'active' }) }] });
    const transaction = {
      get: vi.fn(async (ref) => {
        if (ref.col === 'sops') {
          return { exists: () => true, data: () => ({ department: 'pediatrics', title: 'New', body: 'Body', version: 2 }) };
        }
        return { exists: () => true, data: () => ({ sopId: 'previous' }) };
      }),
      update: vi.fn(),
      set: vi.fn(),
    };
    mocks.runTransaction.mockImplementation(async (_db, fn) => fn(transaction));

    await activateSop('next', 'pediatrics');

    expect(mocks.runTransaction).toHaveBeenCalledOnce();
    const archivedIds = transaction.update.mock.calls
      .filter(([, patch]) => patch.status === 'archived')
      .map(([ref]) => ref.id);
    expect(archivedIds).toEqual(expect.arrayContaining(['previous', 'legacy']));
    expect(transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({ col: 'activeSops', id: 'pediatrics' }),
      expect.objectContaining({ sopId: 'next', body: 'Body' }),
    );
  });

  it('clears the live pointer atomically when the active SOP is archived', async () => {
    const transaction = {
      get: vi.fn(async (ref) => (
        ref.col === 'sops'
          ? { exists: () => true, data: () => ({ department: 'obgyn' }) }
          : { exists: () => true, data: () => ({ sopId: 'live-sop' }) }
      )),
      update: vi.fn(),
      delete: vi.fn(),
    };
    mocks.runTransaction.mockImplementation(async (_db, fn) => fn(transaction));

    await archiveSop('live-sop');

    expect(transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ col: 'sops', id: 'live-sop' }),
      { status: 'archived' },
    );
    expect(transaction.delete).toHaveBeenCalledWith(
      expect.objectContaining({ col: 'activeSops', id: 'obgyn' }),
    );
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
      workflowType: 'general_workflow',
      errorKind: 'workflow_error',
      difficulty: 'medium',
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

  it('runContentQualityFixesMigration patches only failing seeds, archives blocked content, and records a marker', async () => {
    mocks.getDoc.mockImplementation((ref) => {
      if (ref.col === 'contentMigrations') {
        return Promise.resolve({ exists: () => false });
      }
      if (ref.id === 'q-int-1') {
        return Promise.resolve({
          id: 'q-int-1',
          exists: () => true,
          data: () => ({
            status: 'active',
            scenario: 'What do you ask first, phone number or DOB?',
            options: [{ text: 'Phone first', rationale: 'Phone must be first.' }],
          }),
        });
      }
      if (ref.id === 'q-obgyn-int-1') {
        return Promise.resolve({
          id: 'q-obgyn-int-1',
          exists: () => true,
          data: () => ({
            status: 'active',
            scenario: 'A caller asks about a sibling. What keeps you in the correct chart?',
            options: [{ text: 'Confirm the patient and authorized caller before opening the chart.' }],
          }),
        });
      }
      return Promise.resolve({ exists: () => false });
    });
    mocks.getDocs
      .mockResolvedValueOnce({
        docs: [
          { id: 'q-bad', data: () => ({
            status: 'active',
            scenario: 'What do you ask first, phone number or DOB?',
            options: [{ text: 'Phone first', rationale: 'Phone must be first.' }],
          }) },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          { id: 'a-bad', data: () => ({
            status: 'active',
            transcript: [{ speaker: 'Agent', message: 'I cannot refill this because the PE is not current.' }],
            hint: 'Look at the refill handling.',
            modelExplanation: 'The agent should have checked PE before processing the refill.',
          }) },
        ],
      });
    mocks.updateDoc.mockResolvedValue();

    await runContentQualityFixesMigration();

    expect(mocks.updateDoc).toHaveBeenCalledWith(
      { id: 'q-int-1', col: 'questions' },
      expect.objectContaining({ scenario: expect.stringContaining('family account') })
    );
    expect(mocks.updateDoc).not.toHaveBeenCalledWith(
      { id: 'q-obgyn-int-1', col: 'questions' },
      expect.anything()
    );
    expect(mocks.updateDoc).toHaveBeenCalledWith(
      { id: 'q-bad', col: 'questions' },
      expect.objectContaining({ status: 'archived', archivedReason: 'content-quality-fix-2026-07' })
    );
    expect(mocks.updateDoc).toHaveBeenCalledWith(
      { id: 'a-bad', col: 'audits' },
      expect.objectContaining({ status: 'archived', archivedReason: 'content-quality-fix-2026-07' })
    );
    expect(mocks.setDoc).toHaveBeenCalledWith(
      { id: '2026-07-content-quality-fixes-v2', col: 'contentMigrations' },
      expect.objectContaining({
        version: '2026-07-content-quality-fixes-v2',
        completedAt: '__ts__',
        patchedSeeds: 1,
        archivedQuestions: 1,
        archivedAudits: 1,
      })
    );
  });

  it('runContentQualityFixesMigration skips scanning when its marker already exists', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true });

    await expect(runContentQualityFixesMigration()).resolves.toBe(false);

    expect(mocks.getDocs).not.toHaveBeenCalled();
    expect(mocks.updateDoc).not.toHaveBeenCalled();
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});

describe('runMcqV2OperatingModelMigration', () => {
  it('archives active generated/seed MCQs, preserves manual, inserts v2 active, and records counts', async () => {
    const batch = { set: vi.fn(), commit: vi.fn().mockResolvedValue() };
    mocks.writeBatch.mockReturnValue(batch);
    // marker doc does not exist yet
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    // current active question bank the migration scans + archives
    mocks.getDocs.mockResolvedValue({
      docs: [
        { id: 'q-int-1', data: () => ({ status: 'active', department: 'pediatrics', source: 'seed' }) },
        { id: 'q-obgyn-rt-2', data: () => ({ status: 'active', department: 'obgyn', source: 'gemini' }) },
        { id: 'q-manual', data: () => ({ status: 'active', department: 'pediatrics', source: 'manual' }) },
        { id: 'q-adult', data: () => ({ status: 'active', department: 'adult', source: 'seed' }) },
        { id: 'q-already-archived', data: () => ({ status: 'archived', department: 'pediatrics', source: 'seed' }) },
      ],
    });
    mocks.updateDoc.mockResolvedValue();
    mocks.setDoc.mockResolvedValue();

    await expect(runMcqV2OperatingModelMigration()).resolves.toBe(true);

    // The two active generated/seed peds+obgyn docs are archived (not deleted).
    expect(mocks.deleteDoc).not.toHaveBeenCalled();
    const archivedIds = mocks.updateDoc.mock.calls.map(([ref]) => ref.id);
    expect(archivedIds).toEqual(expect.arrayContaining(['q-int-1', 'q-obgyn-rt-2']));
    expect(archivedIds).not.toContain('q-manual');   // manual preserved
    expect(archivedIds).not.toContain('q-adult');     // other department untouched
    expect(archivedIds).not.toContain('q-already-archived');
    for (const [ref, patch] of mocks.updateDoc.mock.calls) {
      if (ref.col !== 'questions') continue;
      expect(patch).toMatchObject({
        status: 'archived',
        archivedReason: 'mcq-v2-operating-model-2026-07',
        replacedByVersion: 'mcq-v2-operating-model-2026-07',
      });
    }

    // All v2 questions inserted as active in a single batch.
    expect(batch.set).toHaveBeenCalledTimes(ALL_V2_QUESTIONS.length);
    expect(batch.set.mock.calls[0][1]).toMatchObject({
      status: 'active',
      source: 'mcq-v2-operating-model-2026-07',
    });
    expect(batch.commit).toHaveBeenCalledOnce();

    // Marker records what happened.
    expect(mocks.setDoc).toHaveBeenCalledWith(
      { id: '2026-07-mcq-v2-operating-model', col: 'contentMigrations' },
      expect.objectContaining({
        version: '2026-07-mcq-v2-operating-model',
        reason: 'mcq-v2-operating-model-2026-07',
        archivedQuestions: 2,
        insertedQuestions: ALL_V2_QUESTIONS.length,
        departments: ['pediatrics', 'obgyn'],
      })
    );
  });

  it('does not rerun when its marker already exists', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true });

    await expect(runMcqV2OperatingModelMigration()).resolves.toBe(false);

    expect(mocks.getDocs).not.toHaveBeenCalled();
    expect(mocks.updateDoc).not.toHaveBeenCalled();
    expect(mocks.setDoc).not.toHaveBeenCalled();
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
