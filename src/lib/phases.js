// ─────────────────────────────────────────────────────────────────────────────

import { compareTimestampValues } from './time.js';
import { isCallQaRolloutDept } from '../data/callQaScenarios.js';
// 3-phase assessment flow — pure helpers (no React, no Firestore).
//
// The department assessment is a fixed sequence of three phases:
//   1. 'mcq'  — multiple-choice scenario check
//   2. 'spot' — Spot the Error (full profile, one item per domain)
//   3. 'qa'   — Call QA Test (graded voice call) — the final phase
//
// Completion is DERIVED from stored data, never persisted as a flag:
//   mcq  — an MCQ result doc exists for the department
//   spot — a Spot result doc exists for the department
//   qa   — a server/projected Call QA interview (`assessmentType:'call-qa'` +
//          a `qa` field) exists
//          for the department
//
// State rules: a phase is 'done' when complete; the FIRST incomplete phase in
// order is 'next' (the only startable one); every later incomplete phase is
// 'locked'. Retaking an earlier phase never re-locks later phases.
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE_ORDER = ['mcq', 'spot', 'qa'];

// Scored Call QA rollout scope (currently OB/GYN only). Departments outside
// the rollout run a two-phase assessment (MCQ → Spot the Error): the scored
// Call QA phase is neither shown nor required, so completion never becomes
// impossible for a department with no private scenario bank. Historical QA
// attempts stay readable regardless of rollout scope.
export function phaseOrderForDept(department) {
  return isCallQaRolloutDept(department) ? PHASE_ORDER : PHASE_ORDER.filter((id) => id !== 'qa');
}

export const PHASE_META = {
  mcq: {
    num: 1,
    title: 'Multiple choice',
    glyph: '📝',
    desc: 'Work through scenario questions and choose the best action. Measures every domain and competency.',
  },
  spot: {
    num: 2,
    title: 'Spot the Error',
    glyph: '🔍',
    desc: 'Read call transcripts and find where the agent broke policy — one per domain, one click each.',
  },
  qa: {
    num: 3,
    title: 'Call QA Test',
    glyph: '🎯',
    desc: 'The final phase: a graded voice call scored against the full quality scorecard. Pass or fail. Needs a mic.',
  },
};

export function isActiveQaInterview(interview, department = 'pediatrics') {
  return interview?.assessmentType === 'call-qa' &&
    Boolean(interview?.qa) &&
    !interview?.qaArchived &&
    (interview.department ?? 'pediatrics') === department;
}

export function latestQaForDept(interviews = [], department = 'pediatrics') {
  return [...interviews]
    .filter((interview) => isActiveQaInterview(interview, department))
    .sort((a, b) => compareTimestampValues(b.endedAt, a.endedAt))[0] ?? null;
}

/**
 * Build the per-phase display state from a completion map.
 * @param {{mcq?:boolean, spot?:boolean, qa?:boolean}} done
 * @returns {{id:string, state:'done'|'next'|'locked'}[]} one entry per phase, in order
 */
export function buildPhases(done = {}, order = PHASE_ORDER) {
  const firstIncomplete = order.find((id) => !done[id]) ?? null;
  return order.map((id) => ({
    id,
    state: done[id] ? 'done' : id === firstIncomplete ? 'next' : 'locked',
  }));
}

/** True when every phase in the (department-scoped) order is complete. */
export function phasesComplete(done = {}, order = PHASE_ORDER) {
  return order.every((id) => done[id]);
}

/** The id of the first incomplete phase, or null when all are done. */
export function nextPhase(done = {}, order = PHASE_ORDER) {
  return order.find((id) => !done[id]) ?? null;
}

/** How many phases are complete (0–order.length). */
export function completedCount(done = {}, order = PHASE_ORDER) {
  return order.filter((id) => done[id]).length;
}
