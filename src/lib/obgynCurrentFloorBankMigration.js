// Marker-gated, non-destructive replacement of the OB/GYN MCQ and Spot-the-
// Error banks with current-floor content.
//
// The migration archives only active, non-manual OB/GYN assessment content.
// Pediatrics, drafts, manual supervisor-authored items, and history remain
// untouched. The new curated items are upserted under stable IDs and activated.
import { db, authReady } from './firebase.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  OBGYN_CURRENT_FLOOR_BANK_VERSION,
  OBGYN_CURRENT_FLOOR_QUESTIONS,
} from '../data/questions-obgyn-current-floor-v3.js';
import {
  OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION,
  OBGYN_CURRENT_FLOOR_AUDITS,
} from '../data/audits-obgyn-current-floor-v3.js';

const QUESTIONS = 'questions';
const AUDITS = 'audits';
const MIGRATIONS = 'contentMigrations';
export const OBGYN_CURRENT_FLOOR_BANK_MARKER =
  '2026-07-obgyn-current-floor-assessment-bank-v3-answer-balance';
export const OBGYN_CURRENT_FLOOR_AUDIT_MARKER =
  '2026-07-obgyn-current-floor-audit-bank-v4-challenging-calls';

const departmentOf = (row) => row?.department ?? 'pediatrics';

function idsToArchive(rows, incomingIds) {
  return rows
    .filter((row) => (
      departmentOf(row) === 'obgyn'
      && (row.status ?? 'active') === 'active'
      && row.source !== 'manual'
      && !incomingIds.has(row.id)
    ))
    .map((row) => row.id)
    .sort();
}

/** Pure migration planner used by tests and the write path. */
export function planObgynCurrentFloorBankMigration(questionRows = [], auditRows = []) {
  const questionIds = new Set(OBGYN_CURRENT_FLOOR_QUESTIONS.map((item) => item.id));
  const auditIds = new Set(OBGYN_CURRENT_FLOOR_AUDITS.map((item) => item.id));
  return {
    questionIdsToArchive: idsToArchive(questionRows, questionIds),
    auditIdsToArchive: idsToArchive(auditRows, auditIds),
    questionIdsToUpsert: [...questionIds].sort(),
    auditIdsToUpsert: [...auditIds].sort(),
  };
}

function questionPayload(question) {
  return {
    domainId: question.domainId,
    competencies: question.competencies ?? [],
    scenario: question.scenario,
    options: question.options,
    correctOptionId: question.correctOptionId,
    sourceSopVersion: question.sourceSopVersion,
    sourceRuleVersion: question.sourceRuleVersion,
    sourceAuthority: question.sourceAuthority,
    ruleIds: question.ruleIds ?? [],
    workflowType: question.workflowType ?? null,
    department: 'obgyn',
    status: 'active',
    source: OBGYN_CURRENT_FLOOR_BANK_VERSION,
    createdAt: serverTimestamp(),
  };
}

function auditPayload(audit) {
  return {
    domainId: audit.domainId,
    transcript: audit.transcript,
    errorIndex: audit.errorIndex,
    hint: audit.hint ?? '',
    modelExplanation: audit.modelExplanation,
    workflowType: audit.workflowType,
    sourceSopVersion: audit.sourceSopVersion,
    sourceRuleVersion: audit.sourceRuleVersion,
    sourceAuthority: audit.sourceAuthority,
    ruleIds: audit.ruleIds ?? [],
    errorKind: audit.errorKind ?? 'workflow_error',
    expectedCorrection: audit.expectedCorrection ?? '',
    requiredChartFacts: audit.requiredChartFacts ?? [],
    difficulty: audit.difficulty ?? 'medium',
    department: 'obgyn',
    status: 'active',
    source: OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION,
    createdAt: serverTimestamp(),
  };
}

/**
 * Runs once when the supervisor app initializes. Existing content is archived,
 * never deleted. No production write happens merely by importing this module.
 */
export async function runObgynCurrentFloorBankMigration() {
  await authReady;

  const bankMarkerRef = doc(db, MIGRATIONS, OBGYN_CURRENT_FLOOR_BANK_MARKER);
  const auditMarkerRef = doc(db, MIGRATIONS, OBGYN_CURRENT_FLOOR_AUDIT_MARKER);
  const [bankMarker, auditMarker] = await Promise.all([
    getDoc(bankMarkerRef),
    getDoc(auditMarkerRef),
  ]);
  if (bankMarker.exists() && auditMarker.exists()) return false;

  // Fresh environments still need the complete current-floor bank. The same
  // batch records the audit-v4 marker because the imported audits are already
  // the challenging-call revision.
  if (!bankMarker.exists()) {
    const [questionSnap, auditSnap] = await Promise.all([
      getDocs(collection(db, QUESTIONS)),
      getDocs(collection(db, AUDITS)),
    ]);
    const questionRows = questionSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const auditRows = auditSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const plan = planObgynCurrentFloorBankMigration(questionRows, auditRows);

    const batch = writeBatch(db);
    for (const id of plan.questionIdsToArchive) {
      batch.update(doc(db, QUESTIONS, id), {
        status: 'archived',
        archivedReason: OBGYN_CURRENT_FLOOR_BANK_VERSION,
        replacedByVersion: OBGYN_CURRENT_FLOOR_BANK_VERSION,
        archivedAt: serverTimestamp(),
      });
    }
    for (const id of plan.auditIdsToArchive) {
      batch.update(doc(db, AUDITS, id), {
        status: 'archived',
        archivedReason: OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION,
        replacedByVersion: OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION,
        archivedAt: serverTimestamp(),
      });
    }
    for (const question of OBGYN_CURRENT_FLOOR_QUESTIONS) {
      batch.set(doc(db, QUESTIONS, question.id), questionPayload(question));
    }
    for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
      batch.set(doc(db, AUDITS, audit.id), auditPayload(audit));
    }
    batch.set(bankMarkerRef, {
      version: OBGYN_CURRENT_FLOOR_BANK_MARKER,
      reason: OBGYN_CURRENT_FLOOR_BANK_VERSION,
      completedAt: serverTimestamp(),
      archivedQuestions: plan.questionIdsToArchive.length,
      archivedAudits: plan.auditIdsToArchive.length,
      insertedQuestions: OBGYN_CURRENT_FLOOR_QUESTIONS.length,
      insertedAudits: OBGYN_CURRENT_FLOOR_AUDITS.length,
      department: 'obgyn',
    });
    if (!auditMarker.exists()) {
      batch.set(auditMarkerRef, {
        version: OBGYN_CURRENT_FLOOR_AUDIT_MARKER,
        reason: OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION,
        completedAt: serverTimestamp(),
        archivedAudits: plan.auditIdsToArchive.length,
        insertedAudits: OBGYN_CURRENT_FLOOR_AUDITS.length,
        department: 'obgyn',
      });
    }
    await batch.commit();
    return true;
  }

  // Existing environments already have the current MCQs, so the v4 follow-up
  // refreshes only OB/GYN audits and leaves every question document untouched.
  const auditSnap = await getDocs(collection(db, AUDITS));
  const auditRows = auditSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const auditIds = new Set(OBGYN_CURRENT_FLOOR_AUDITS.map((item) => item.id));
  const auditIdsToArchive = idsToArchive(auditRows, auditIds);

  const batch = writeBatch(db);
  for (const id of auditIdsToArchive) {
    batch.update(doc(db, AUDITS, id), {
      status: 'archived',
      archivedReason: OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION,
      replacedByVersion: OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION,
      archivedAt: serverTimestamp(),
    });
  }
  for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
    batch.set(doc(db, AUDITS, audit.id), auditPayload(audit));
  }
  batch.set(auditMarkerRef, {
    version: OBGYN_CURRENT_FLOOR_AUDIT_MARKER,
    reason: OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION,
    completedAt: serverTimestamp(),
    archivedAudits: auditIdsToArchive.length,
    insertedAudits: OBGYN_CURRENT_FLOOR_AUDITS.length,
    department: 'obgyn',
  });
  await batch.commit();
  return true;
}
