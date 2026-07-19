import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  serverTimestamp: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('./firebase.js', () => ({
  db: {},
  authReady: Promise.resolve(true),
}));

import {
  OBGYN_CURRENT_FLOOR_AUDIT_MARKER,
  OBGYN_CURRENT_FLOOR_BANK_MARKER,
  planObgynCurrentFloorBankMigration,
  runObgynCurrentFloorBankMigration,
} from './obgynCurrentFloorBankMigration.js';
import { OBGYN_CURRENT_FLOOR_QUESTIONS } from '../data/questions-obgyn-current-floor-v3.js';
import {
  OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION,
  OBGYN_CURRENT_FLOOR_AUDITS,
} from '../data/audits-obgyn-current-floor-v3.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

describe('OB/GYN current-floor assessment-bank migration planner', () => {
  it('archives stale active non-manual OB/GYN content only', () => {
    const currentQuestionId = OBGYN_CURRENT_FLOOR_QUESTIONS[0].id;
    const currentAuditId = OBGYN_CURRENT_FLOOR_AUDITS[0].id;
    const plan = planObgynCurrentFloorBankMigration(
      [
        { id: 'old-ob-active', department: 'obgyn', status: 'active', source: 'seed' },
        { id: 'manual-ob-active', department: 'obgyn', status: 'active', source: 'manual' },
        { id: 'old-ob-draft', department: 'obgyn', status: 'draft', source: 'gemini' },
        { id: 'peds-active', department: 'pediatrics', status: 'active', source: 'seed' },
        { id: currentQuestionId, department: 'obgyn', status: 'active', source: 'older-run' },
      ],
      [
        { id: 'old-audit-active', department: 'obgyn', status: 'active', source: 'gemini' },
        { id: 'manual-audit-active', department: 'obgyn', status: 'active', source: 'manual' },
        { id: 'old-audit-archived', department: 'obgyn', status: 'archived', source: 'gemini' },
        { id: 'peds-audit-active', department: 'pediatrics', status: 'active', source: 'gemini' },
        { id: currentAuditId, department: 'obgyn', status: 'active', source: 'older-run' },
      ]
    );
    expect(plan.questionIdsToArchive).toEqual(['old-ob-active']);
    expect(plan.auditIdsToArchive).toEqual(['old-audit-active']);
    expect(plan.questionIdsToUpsert).toContain(currentQuestionId);
    expect(plan.auditIdsToUpsert).toContain(currentAuditId);
  });

  it('plans the complete stable replacement bank', () => {
    const plan = planObgynCurrentFloorBankMigration([], []);
    expect(plan.questionIdsToUpsert).toHaveLength(24);
    expect(plan.auditIdsToUpsert).toHaveLength(30);
    expect(OBGYN_CURRENT_FLOOR_BANK_MARKER)
      .toBe('2026-07-obgyn-current-floor-assessment-bank-v3-answer-balance');
    expect(OBGYN_CURRENT_FLOOR_AUDIT_MARKER)
      .toBe('2026-07-obgyn-current-floor-audit-bank-v4-challenging-calls');
  });

  it('refreshes only audits when the complete-bank marker already exists', async () => {
    vi.clearAllMocks();
    collection.mockImplementation((_db, name) => ({ name }));
    doc.mockImplementation((_db, name, id) => ({ name, id }));
    getDoc
      .mockResolvedValueOnce({ exists: () => true })
      .mockResolvedValueOnce({ exists: () => false });
    getDocs.mockResolvedValue({ docs: [] });
    serverTimestamp.mockReturnValue('server-time');
    const batch = {
      update: vi.fn(),
      set: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    writeBatch.mockReturnValue(batch);

    await expect(runObgynCurrentFloorBankMigration()).resolves.toBe(true);

    expect(getDocs).toHaveBeenCalledTimes(1);
    expect(collection).toHaveBeenCalledWith({}, 'audits');
    expect(batch.set).toHaveBeenCalledTimes(OBGYN_CURRENT_FLOOR_AUDITS.length + 1);
    expect(batch.set.mock.calls.some(([ref]) => ref.name === 'questions')).toBe(false);
    const auditWrites = batch.set.mock.calls.filter(([ref]) => ref.name === 'audits');
    expect(auditWrites).toHaveLength(OBGYN_CURRENT_FLOOR_AUDITS.length);
    expect(auditWrites.every(([, payload]) => payload.source === OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION))
      .toBe(true);
    expect(batch.commit).toHaveBeenCalledOnce();
  });
});
