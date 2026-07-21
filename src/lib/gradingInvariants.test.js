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
  QA_RUBRIC_PROFILES, QA_EVIDENCE_POLICIES, getQaRubricProfile,
} from '../data/qaRubricProfiles.js';
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
  evaluateQaDeterministicFindings, findOverPromiseLine, findClinicalAdviceLine, isUncertainRoutingLanguage,
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
    // Capability bands (2026-07-20 redesign): 0–39 Critical · 40–64 Learning ·
    // 65–89 Solid · 90–100 Can-Teach. Non-overlapping, centralized in config.js.
    expect(THRESHOLDS).toEqual({ critical: 40, solid: 65, canTeach: 90 });
    expect(scoreToLevel(0)).toBe('critical');
    expect(scoreToLevel(39)).toBe('critical');
    expect(scoreToLevel(40)).toBe('learning');
    expect(scoreToLevel(64)).toBe('learning');
    expect(scoreToLevel(65)).toBe('solid');
    expect(scoreToLevel(89)).toBe('solid');
    expect(scoreToLevel(90)).toBe('canTeach');
    expect(scoreToLevel(100)).toBe('canTeach');
  });

  it('the capability pass mark is independent of the Call QA rubric pass mark', () => {
    // QA_PASS_THRESHOLD (85) grades one call against the rubric; THRESHOLDS
    // classifies a navigator's six-domain average. They are separate scales and
    // must never be conflated.
    expect(QA_PASS_THRESHOLD).not.toBe(THRESHOLDS.canTeach);
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
  { role: 'navigator', text: 'What is the best callback number to reach you?' },
  { role: 'navigator', text: 'I will send this request to the PEDS Encounters queue and mark it urgent because she is out.' },
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
    autoFails: [{ id: 'af-scope', evidence: 'I will send this request to the PEDS Encounters queue and mark it urgent because she is out.', note: '' }],
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

// ── I-CONFLICT: the deterministic conflict layer is not a repair layer ──────

describe('invariant: deterministic findings are review flags, never repairs', () => {
  const allMet = () => rubricCriteria().map((c) => ({ id: c.id, verdict: 'MET', evidence: 'What is the medication name?', note: '' }));
  const WRONG_ROUTE = [
    { role: 'navigator', text: 'What is the medication name?' },
    { role: 'navigator', text: 'Which pharmacy do you prefer?' },
    { role: 'navigator', text: 'I will send this refill request to the billing team.' },
  ];

  it('a model-positive verdict contradicting the routing policy cannot become a confident silent pass', () => {
    const criteria = allMet();
    const findings = evaluateQaDeterministicFindings(criteria, WRONG_ROUTE, REFILL_CONTEXT);
    expect(findings.some((f) => f.id === 'model-routing-conflict')).toBe(true);
    const scored = scoreQa(criteria, [], WRONG_ROUTE);
    const { qa } = finalizeQaResult(scored, WRONG_ROUTE, 0, [], { verified: true, status: 'verified' }, [], findings);
    expect(qa.review.recommendation).toBe('needs_review');
    expect(qa.deterministicFindings).toEqual(findings); // never hidden
    expect(qa.criteria).toEqual(scored.criteria);       // never a repair: verdicts untouched
    expect(qa.score).toBe(scored.score);                // score preserved for auditability
    expect(qa.repairs).toEqual([]);                     // findings are not logged as repairs
  });

  it('safe disclaimer language only negates matching language within its own clause', () => {
    expect(findOverPromiseLine([{ role: 'navigator', text: 'I cannot promise approval or exact timing.' }])).toBeNull();
    expect(findOverPromiseLine([{ role: 'navigator', text: 'I can’t promise timing, but I guarantee approval today.' }])).toBeTruthy();
    expect(findClinicalAdviceLine([{ role: 'navigator', text: 'I can’t tell you if it is safe to wait — that is for the nurse.' }])).toBeNull();
    expect(findClinicalAdviceLine([{ role: 'navigator', text: 'I can’t tell you if it is safe to wait, but take twice the dose tonight.' }])).toBeTruthy();
  });

  it('unknown or uncertain routing evidence cannot support an outcome-improving repair', () => {
    expect(isUncertainRoutingLanguage('I think PEDS Encounters handles this.')).toBe(true);
    const hedged = [
      { role: 'navigator', text: 'What is the medication name?' },
      { role: 'navigator', text: 'Which pharmacy do you prefer?' },
      { role: 'navigator', text: 'What is the best callback number to reach you?' },
      { role: 'navigator', text: 'She is completely out of the medication.' },
      { role: 'navigator', text: 'I think PEDS Encounters handles this.' },
    ];
    const input = temptingVerdicts();
    input.autoFails = [];
    expect(repairQaVerdictsForScenario(input, hedged, REFILL_CONTEXT).repairs).toEqual([]);
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

// ── I-PROFILE: department rubric profiles (2026-07-21) ──────────────────────
//
// The Call QA rubric is department-based. These invariants hold ACROSS every
// configured profile, so adding a department cannot quietly weaken the shared
// contract or let one department inherit another's rubric.

describe('invariant: department rubric profiles', () => {
  const profiles = Object.values(QA_RUBRIC_PROFILES);

  it('every profile totals exactly 100 points and passes at the shared threshold', () => {
    for (const profile of profiles) {
      expect(profile.totalPoints, profile.department).toBe(100);
      expect(profile.passThreshold, profile.department).toBe(QA_PASS_THRESHOLD);
    }
  });

  it('every profile has unique criterion ids, unique category ids, and no empty categories', () => {
    for (const profile of profiles) {
      const criterionIds = profile.criteria.map((c) => c.id);
      expect(new Set(criterionIds).size, profile.department).toBe(criterionIds.length);
      const categoryIds = profile.rubric.map((c) => c.id);
      expect(new Set(categoryIds).size, profile.department).toBe(categoryIds.length);
      for (const category of profile.rubric) {
        expect(category.criteria.length, `${profile.department}/${category.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('every repairable criterion is also safety-critical in the same profile (R10)', () => {
    for (const profile of profiles) {
      for (const id of profile.repairableCriteria) {
        expect(profile.safetyCriticalCriteria.has(id), `${profile.department}/${id}`).toBe(true);
        expect(profile.criterionIds.has(id), `${profile.department}/${id}`).toBe(true);
      }
    }
  });

  it('every safety-critical criterion actually exists in its own profile', () => {
    for (const profile of profiles) {
      for (const id of profile.safetyCriticalCriteria) {
        expect(profile.criterionIds.has(id), `${profile.department}/${id}`).toBe(true);
      }
    }
  });

  it('profiles carry distinct rubric versions so stored results stay attributable', () => {
    const versions = profiles.map((profile) => profile.rubricVersion);
    expect(new Set(versions).size).toBe(versions.length);
    for (const version of versions) expect(version).toMatch(/\S/);
  });

  it('an unsupported department resolves to null and never inherits another rubric', () => {
    for (const department of ['adultmed', 'behavioral', '', null, undefined, 'constructor']) {
      expect(getQaRubricProfile(department)).toBeNull();
    }
  });

  it('a criterion opting into a relaxed evidence policy names a known policy', () => {
    const known = new Set(Object.values(QA_EVIDENCE_POLICIES));
    for (const profile of profiles) {
      for (const criterion of profile.criteria) {
        if (!criterion.evidencePolicy) continue;
        expect(known.has(criterion.evidencePolicy), `${profile.department}/${criterion.id}`).toBe(true);
      }
    }
  });

  it('no auto-fail may relax navigator-only evidence', () => {
    // Auto-fails accuse the navigator of an explicit unsafe statement, so they
    // must never carry an evidence-policy relaxation.
    for (const profile of profiles) {
      for (const autoFail of profile.autoFails) {
        expect(autoFail.evidencePolicy, `${profile.department}/${autoFail.id}`).toBeUndefined();
      }
    }
  });

  it('validation and scoring cannot be run against different profiles', () => {
    const obgyn = QA_RUBRIC_PROFILES.obgyn;
    const verdicts = obgyn.criteria.map((c) => ({
      id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '',
    }));
    expect(() => scoreQa(verdicts, [], [], QA_RUBRIC_PROFILES.pediatrics)).toThrow(/not part of rubric profile/);
  });
});
