// ─────────────────────────────────────────────────────────────────────────────
// Cross-system grading invariants — the executable half of
// docs/GRADING_INVARIANTS.md.
//
// The project has four scoring systems (MCQ check, Spot the Error, Call QA,
// QA domain/competency projections) plus a supervisor final-verdict layer.
// Each system has its own unit tests; THIS file pins the properties that hold
// ACROSS them, so a future change to any one system cannot silently break the
// shared contract (0–100 scale, single level derivation, review-gated repairs,
// preserved AI originals). If a test here fails, read the invariants doc before
// "fixing" the test.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { THRESHOLDS } from '../data/config.js';
import { QA_PASS_THRESHOLD, rubricCriteria } from '../data/qaRubric.js';
import {
  scorePerDomain, scorePerCompetency, scoreToLevel,
  scoreSpotTheError, scoreSpotTheErrorByDomain,
} from './scoring.js';
import { SEED_QUESTIONS, DOMAINS } from '../data/questions.js';
import { qaDomainScoreSummary } from './qaDomainScoring.js';
import { qaFinalVerdict } from './qaFinalReview.js';
import {
  REPAIRABLE_CRITERIA, SAFETY_CRITICAL_CRITERIA, QA_REVIEW_MARGIN,
  repairQaVerdictsForScenario, scoreQa, assessQa,
} from '../../api/_qa-rubric.js';
import { finalizeQaResult } from '../../api/grade-call-qa.js';

// ── I-SCALE: every assessment lands on the same 0–100 integer scale ─────────

describe('invariant: shared 0–100 scale and thresholds', () => {
  it('MCQ domain and competency scores are 0–100 integers', () => {
    const answers = Object.fromEntries(SEED_QUESTIONS.map((q) => [q.id, q.options[0].id]));
    for (const scores of [scorePerDomain(answers, SEED_QUESTIONS), scorePerCompetency(answers, SEED_QUESTIONS)]) {
      for (const value of Object.values(scores)) {
        if (value === null) continue; // untagged competency
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('Spot the Error scores are 0–100 integers on the same scale', () => {
    expect(scoreSpotTheError([true, false, true])).toBe(67);
    const byDomain = scoreSpotTheErrorByDomain([
      { domainId: 'routing', correct: true },
      { domainId: 'routing', correct: false },
      { domainId: 'intake', correct: true },
    ]);
    for (const value of Object.values(byDomain)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('levels derive from scoreToLevel with the documented bands everywhere', () => {
    expect(THRESHOLDS).toEqual({ learning: 60, canTeach: 85 });
    expect(scoreToLevel(59)).toBe('learning');
    expect(scoreToLevel(60)).toBe('solid');
    expect(scoreToLevel(84)).toBe('solid');
    expect(scoreToLevel(85)).toBe('canTeach');
  });

  it('the QA pass mark is the documented 85 and the review margin absorbs rounding', () => {
    expect(QA_PASS_THRESHOLD).toBe(85);
    // A raw ratio that rounds UP to exactly the pass mark (e.g. 84.7 → 85) must
    // always fall inside the borderline review band, never a silent pass.
    expect(QA_REVIEW_MARGIN).toBeGreaterThanOrEqual(1);
  });
});

// ── I-REPAIR: the repair layer is a whitelist, one direction, fully logged ──

const REFILL_TRANSCRIPT = [
  { role: 'navigator', text: 'What is the medication name?' },
  { role: 'navigator', text: 'Which pharmacy do you prefer?' },
  { role: 'navigator', text: 'I will send this request to the refill team and mark it urgent because she is out.' },
  { role: 'patient', text: 'Thank you.' },
];
const REFILL_CONTEXT = {
  scenario: 'A standard pediatric medication refill.',
  department: 'pediatrics',
  metadata: { workflowType: 'prescription_refill' },
};

// A maximally tempting grader payload: EVERY criterion NOT_MET with the exact
// PE / literal-TE note styles the repairs target, plus a triggered auto-fail.
function temptingVerdicts() {
  return {
    criteria: rubricCriteria().map((c) => ({
      id: c.id,
      verdict: 'NOT_MET',
      evidence: '',
      note: c.id === 'know-rule'
        ? 'The navigator failed to ask about the patient PE status.'
        : 'The transcript does not contain evidence that the navigator routed or logged a Telephone Encounter.',
    })),
    autoFails: [{ id: 'af-scope', evidence: 'I will send this request to the refill team and mark it urgent because she is out.', note: '' }],
  };
}

describe('invariant: repair layer boundaries', () => {
  it('repairs only ever touch the whitelisted criteria, only NOT_MET → MET', () => {
    const input = temptingVerdicts();
    const repaired = repairQaVerdictsForScenario(input, REFILL_TRANSCRIPT, REFILL_CONTEXT);
    for (const [index, criterion] of repaired.criteria.entries()) {
      const original = input.criteria[index];
      if (criterion.verdict !== original.verdict) {
        expect(REPAIRABLE_CRITERIA.has(criterion.id)).toBe(true);
        expect(original.verdict).toBe('NOT_MET');
        expect(criterion.verdict).toBe('MET');
        const logged = repaired.repairs.find((r) => r.criterionId === criterion.id);
        expect(logged).toBeDefined();
        expect(logged.originalVerdict).toBe(original.verdict);
        expect(logged.originalNote).toBe(original.note);
        expect(logged.originalEvidence).toBe(original.evidence);
      }
    }
    expect(repaired.repairs.length).toBeGreaterThan(0);
  });

  it('repairs never add, remove, or alter auto-fails', () => {
    const input = temptingVerdicts();
    const repaired = repairQaVerdictsForScenario(input, REFILL_TRANSCRIPT, REFILL_CONTEXT);
    expect(repaired.autoFails).toEqual(input.autoFails);
  });

  it('repairs never mutate the caller-supplied verdicts object', () => {
    const input = temptingVerdicts();
    const snapshot = JSON.parse(JSON.stringify(input));
    repairQaVerdictsForScenario(input, REFILL_TRANSCRIPT, REFILL_CONTEXT);
    expect(input).toEqual(snapshot);
  });

  it('every repairable criterion is also safety-tagged, so an unrepaired miss still forces review on a pass', () => {
    for (const id of REPAIRABLE_CRITERIA) {
      expect(SAFETY_CRITICAL_CRITERIA.has(id)).toBe(true);
    }
  });

  it('a verified auto-fail always wins over repairs: score 0, fail, fail recommendation', () => {
    const input = temptingVerdicts();
    const repaired = repairQaVerdictsForScenario(input, REFILL_TRANSCRIPT, REFILL_CONTEXT);
    const qa = scoreQa(repaired.criteria, repaired.autoFails, REFILL_TRANSCRIPT);
    expect(qa.autoFails).toHaveLength(1);
    expect(qa.score).toBe(0);
    expect(qa.pass).toBe(false);
    expect(assessQa(qa, REFILL_TRANSCRIPT, { repairs: repaired.repairs }).recommendation).toBe('fail');
  });
});

// ── I-PIPE: the finalized QA result is deterministic and self-consistent ────

describe('invariant: finalized QA result consistency', () => {
  function finalized() {
    const input = temptingVerdicts();
    input.autoFails = []; // clean run
    const repaired = repairQaVerdictsForScenario(input, REFILL_TRANSCRIPT, REFILL_CONTEXT);
    const scored = scoreQa(repaired.criteria, repaired.autoFails, REFILL_TRANSCRIPT);
    return finalizeQaResult(scored, REFILL_TRANSCRIPT, 0, repaired.repairs);
  }

  it('grade projection score equals the deterministic qa score', () => {
    const { qa, grade } = finalized();
    expect(grade.score).toBe(qa.score);
    expect(qa.repairCount).toBe(qa.repairs.length);
  });

  it('QA domain/competency projections stay within 0–100 and inherit auto-fail zeroing', () => {
    const { qa } = finalized();
    const { domainScores, competencyScores } = qaDomainScoreSummary(qa);
    for (const scores of [domainScores, competencyScores]) {
      for (const detail of Object.values(scores)) {
        if (detail === null) continue;
        expect(detail.score).toBeGreaterThanOrEqual(0);
        expect(detail.score).toBeLessThanOrEqual(100);
      }
    }
    expect(Object.keys(domainScores).sort()).toEqual(DOMAINS.map((d) => d.id).sort());
  });

  it('same inputs produce an identical result (determinism)', () => {
    expect(JSON.parse(JSON.stringify(finalized()))).toEqual(JSON.parse(JSON.stringify(finalized())));
  });
});

// ── I-SUPERVISOR: human verdicts never overwrite AI originals ───────────────

describe('invariant: supervisor final verdict preserves the AI result', () => {
  const session = {
    qa: { pass: true, score: 92, passThreshold: 85, review: { recommendation: 'pass' } },
    qaFinalReview: { status: 'overridden_fail', finalPass: false, reason: 'Observed a scope issue on review.' },
  };

  it('reads the final verdict without mutating the session or its qa field', () => {
    const snapshot = JSON.parse(JSON.stringify(session));
    const verdict = qaFinalVerdict(session);
    expect(verdict.aiPass).toBe(true);       // AI verdict still visible
    expect(verdict.finalPass).toBe(false);   // supervisor decision separate
    expect(session).toEqual(snapshot);       // nothing overwritten
  });

  it('a pending review keeps the AI verdict as decision support, not a final word', () => {
    const pending = qaFinalVerdict({ qa: session.qa });
    expect(pending.status).toBe('pending');
    expect(pending.finalPass).toBeNull();
    expect(pending.needsSupervisorReview).toBe(true);
  });
});
