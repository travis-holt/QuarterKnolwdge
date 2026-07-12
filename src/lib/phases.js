// ─────────────────────────────────────────────────────────────────────────────

import { compareTimestampValues } from './time.js';
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
//   qa   — a graded QA interview (interview doc with a `qa` field) exists
//          for the department
//
// State rules: a phase is 'done' when complete; the FIRST incomplete phase in
// order is 'next' (the only startable one); every later incomplete phase is
// 'locked'. Retaking an earlier phase never re-locks later phases.
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE_ORDER = ['mcq', 'spot', 'qa'];

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
  return Boolean(interview?.qa) &&
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
export function buildPhases(done = {}) {
  const firstIncomplete = PHASE_ORDER.find((id) => !done[id]) ?? null;
  return PHASE_ORDER.map((id) => ({
    id,
    state: done[id] ? 'done' : id === firstIncomplete ? 'next' : 'locked',
  }));
}

/** True when every phase is complete. */
export function phasesComplete(done = {}) {
  return PHASE_ORDER.every((id) => done[id]);
}

/** The id of the first incomplete phase, or null when all are done. */
export function nextPhase(done = {}) {
  return PHASE_ORDER.find((id) => !done[id]) ?? null;
}

/** How many phases are complete (0–3). */
export function completedCount(done = {}) {
  return PHASE_ORDER.filter((id) => done[id]).length;
}
