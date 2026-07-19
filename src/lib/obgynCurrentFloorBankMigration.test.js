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
  OBGYN_CURRENT_FLOOR_BANK_MARKER,
  planObgynCurrentFloorBankMigration,
} from './obgynCurrentFloorBankMigration.js';
import { OBGYN_CURRENT_FLOOR_QUESTIONS } from '../data/questions-obgyn-current-floor-v3.js';
import { OBGYN_CURRENT_FLOOR_AUDITS } from '../data/audits-obgyn-current-floor-v3.js';

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
    expect(OBGYN_CURRENT_FLOOR_BANK_MARKER).toContain('2026-07');
  });
});
