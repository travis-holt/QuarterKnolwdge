// ─────────────────────────────────────────────────────────────────────────────
// Department Call QA rubric profiles + the OB/GYN profile.
//
// Covers: profile architecture and fail-closed resolution, the OB/GYN opening /
// verification / closing / empathy / listening / narration / documentation
// rules, the identity-verification evidence policy, prompt contract, scoring
// and persistence, and the eight synthetic manual-review fixtures.
//
// Pure — no Gemini, no network, no Firestore.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  QA_RUBRIC_PROFILES, QA_PROFILE_DEPARTMENTS, QA_EVIDENCE_POLICIES,
  QA_RUBRIC_VERSION_OBGYN, OBGYN_VERIFICATION_IDENTIFIERS,
  getQaRubricProfile, requireQaRubricProfile, profileForGradedAttempt,
  UnsupportedQaDepartmentError,
} from '../src/data/qaRubricProfiles.js';
import { QA_RUBRIC_VERSION, QA_PASS_THRESHOLD } from '../src/data/qaRubric.js';
import {
  validateQaResponse, scoreQa, assessQa,
  verifyIdentityEvidence, verifyNavigatorEvidence, verifyCriterionEvidence,
  findProtectedDisclosureIndex,
} from './_qa-rubric.js';
import { buildMessages, gradeCallQaTranscript, buildScenarioContextFromAttempt } from './grade-call-qa.js';
import { qaDomainScoreSummary, resolveScoringProfile } from '../src/lib/qaDomainScoring.js';
import { DOMAINS } from '../src/data/questions.js';
import { COMPETENCY_IDS } from '../src/data/competencies.js';
import { OBGYN_REVIEW_FIXTURES, simulateObgynGrader } from './_qa-obgyn-review-fixtures.js';

const OBGYN = QA_RUBRIC_PROFILES.obgyn;
const PEDS = QA_RUBRIC_PROFILES.pediatrics;

// ── Profile architecture ─────────────────────────────────────────────────────

describe('department rubric profile resolution', () => {
  it('resolves obgyn to the dedicated OB/GYN profile', () => {
    const profile = getQaRubricProfile('obgyn');
    expect(profile).toBe(OBGYN);
    expect(profile.department).toBe('obgyn');
    expect(profile.rubricVersion).toBe(QA_RUBRIC_VERSION_OBGYN);
  });

  it('keeps pediatrics on the historical shared rubric, unchanged', () => {
    expect(PEDS.rubricVersion).toBe(QA_RUBRIC_VERSION);
    expect(PEDS.criterionIds.has('close-survey')).toBe(true);
    expect(PEDS.criterionIds.has('close-anything-thanks')).toBe(true);
    expect(PEDS.criterionIds.has('close-offer-help')).toBe(false);
    // Every Pediatrics criterion still core/non-core exactly as before.
    expect(PEDS.criteriaById.get('comm-empathy').core).toBe(true);
    expect(PEDS.criteriaById.get('control-narrate').core).toBe(true);
  });

  it('returns null for an unsupported department instead of inheriting another rubric', () => {
    for (const department of ['adultmed', 'behavioral', 'cardiology', '', null, undefined]) {
      expect(getQaRubricProfile(department)).toBeNull();
    }
    expect(QA_PROFILE_DEPARTMENTS).toEqual(['pediatrics', 'obgyn']);
  });

  it('requireQaRubricProfile throws a typed error for an unsupported department', () => {
    expect(() => requireQaRubricProfile('behavioral')).toThrow(UnsupportedQaDepartmentError);
    expect(() => requireQaRubricProfile(undefined)).toThrow(/no Call QA rubric profile/i);
  });

  it('never resolves an unsupported department through prototype keys', () => {
    expect(getQaRubricProfile('constructor')).toBeNull();
    expect(getQaRubricProfile('toString')).toBeNull();
    expect(getQaRubricProfile('__proto__')).toBeNull();
  });
});

describe('OB/GYN profile integrity', () => {
  it('totals exactly 100 points', () => {
    expect(OBGYN.totalPoints).toBe(100);
  });

  it('keeps the pass threshold at 85', () => {
    expect(OBGYN.passThreshold).toBe(85);
    expect(OBGYN.passThreshold).toBe(QA_PASS_THRESHOLD);
    expect(PEDS.passThreshold).toBe(85);
  });

  it('closing totals exactly 5 points in a single criterion', () => {
    const closing = OBGYN.rubric.find((category) => category.id === 'closing');
    expect(closing.criteria).toHaveLength(1);
    expect(closing.criteria[0].id).toBe('close-offer-help');
    expect(closing.criteria.reduce((sum, c) => sum + c.points, 0)).toBe(5);
  });

  it('keeps every other category weight identical to the shared rubric', () => {
    const weights = (profile) => Object.fromEntries(profile.rubric.map((category) => [
      category.id, category.criteria.reduce((sum, c) => sum + c.points, 0),
    ]));
    expect(weights(OBGYN)).toEqual(weights(PEDS));
  });

  it('has unique criterion ids and unique category ids', () => {
    for (const profile of Object.values(QA_RUBRIC_PROFILES)) {
      const criterionIds = profile.criteria.map((c) => c.id);
      expect(new Set(criterionIds).size).toBe(criterionIds.length);
      const categoryIds = profile.rubric.map((c) => c.id);
      expect(new Set(categoryIds).size).toBe(categoryIds.length);
    }
  });

  it('tags every criterion and auto-fail with valid domain and competency ids', () => {
    const domainIds = new Set(DOMAINS.map((d) => d.id));
    for (const profile of Object.values(QA_RUBRIC_PROFILES)) {
      for (const item of [...profile.criteria, ...profile.autoFails]) {
        expect(item.domainIds.length).toBeGreaterThan(0);
        expect(item.competencyIds.length).toBeGreaterThan(0);
        for (const id of item.domainIds) expect(domainIds.has(id)).toBe(true);
        for (const id of item.competencyIds) expect(COMPETENCY_IDS.has(id)).toBe(true);
      }
    }
  });

  it('preserves the union of the removed closing criteria coverage', () => {
    const removed = ['close-survey', 'close-anything-thanks']
      .map((id) => PEDS.criteriaById.get(id));
    const expectedDomains = new Set(removed.flatMap((c) => c.domainIds));
    const expectedCompetencies = new Set(removed.flatMap((c) => c.competencyIds));
    const replacement = OBGYN.criteriaById.get('close-offer-help');
    expect(new Set(replacement.domainIds)).toEqual(expectedDomains);
    expect(new Set(replacement.competencyIds)).toEqual(expectedCompetencies);
  });

  it('resolves auto-fails from the same profile, with the same verification definition', () => {
    const hipaa = OBGYN.autoFails.find((autoFail) => autoFail.id === 'af-hipaa');
    const verifyThree = OBGYN.criteriaById.get('verify-three');
    // Both must name all three identifiers and both must reject substitutes.
    for (const identifier of OBGYN_VERIFICATION_IDENTIFIERS) {
      expect(hipaa.text).toContain(identifier);
      expect(verifyThree.text).toContain(identifier);
    }
    expect(hipaa.text).toMatch(/does NOT substitute/);
    expect(verifyThree.text).toMatch(/does NOT substitute/);
    // The Pediatrics auto-fail still allows address/phone, unchanged.
    expect(PEDS.autoFails.find((a) => a.id === 'af-hipaa').text).toMatch(/3-point identity verification/);
  });

  it('keeps every repairable criterion inside the safety-critical set (invariant R10)', () => {
    for (const profile of Object.values(QA_RUBRIC_PROFILES)) {
      for (const id of profile.repairableCriteria) {
        expect(profile.safetyCriticalCriteria.has(id)).toBe(true);
      }
    }
  });

  it('marks empathy and narration conditional, and keeps listen-gather strict', () => {
    expect(OBGYN.criteriaById.get('comm-empathy').core).toBe(false);
    expect(OBGYN.criteriaById.get('control-narrate').core).toBe(false);
    expect(OBGYN.criteriaById.get('listen-gather').core).toBe(true);
    expect(OBGYN.criteriaById.get('control-guide').core).toBe(true);
    expect(OBGYN.criteriaById.get('close-offer-help').core).toBe(true);
  });

  it('drops Pediatrics-only documentation examples from the OB/GYN rubric', () => {
    const docReason = OBGYN.criteriaById.get('doc-reason').text;
    expect(docReason).not.toMatch(/Shots PE UTD|Good Samaritan|\bGS\b/);
    expect(docReason).not.toMatch(/\bPE\b/);
    // The underlying standard is intact.
    expect(docReason).toMatch(/accurate/i);
    expect(docReason).toMatch(/No invented diagnosis/i);
  });
});

// ── Historical attempts ──────────────────────────────────────────────────────

describe('historical attempts keep their own rubric', () => {
  it('resolves a stored attempt by its recorded rubric version', () => {
    expect(profileForGradedAttempt({ rubricVersion: QA_RUBRIC_VERSION })).toBe(PEDS);
    expect(profileForGradedAttempt({ rubricVersion: QA_RUBRIC_VERSION_OBGYN })).toBe(OBGYN);
  });

  it('never reinterprets an unknown historical rubric version under a newer profile', () => {
    expect(profileForGradedAttempt({ rubricVersion: 'qa-rubric-v1' }, 'obgyn')).toBeNull();
  });

  it('falls back to the stored department only when no version was recorded', () => {
    expect(profileForGradedAttempt({}, 'obgyn')).toBe(OBGYN);
    expect(profileForGradedAttempt(undefined, 'pediatrics')).toBe(PEDS);
  });

  it('summarizes a stored OB/GYN result under the rubric that graded it', () => {
    const stored = {
      gradingMetadata: { rubricDepartment: 'obgyn', rubricVersion: QA_RUBRIC_VERSION_OBGYN },
      criteria: [{ id: 'close-offer-help', verdict: 'MET' }],
      autoFails: [],
    };
    expect(resolveScoringProfile(stored)).toBe(OBGYN);
    const { domainScores } = qaDomainScoreSummary(stored);
    // close-offer-help splits across documentation + intake.
    expect(domainScores.documentation.criteria).toContain('close-offer-help');
    expect(domainScores.intake.criteria).toContain('close-offer-help');
  });

  it('renders a legacy result with old criterion ids safely under the old rubric', () => {
    const legacy = {
      gradingMetadata: { rubricVersion: QA_RUBRIC_VERSION },
      criteria: [{ id: 'close-survey', verdict: 'MET' }, { id: 'close-anything-thanks', verdict: 'MET' }],
      autoFails: [],
    };
    const { domainScores } = qaDomainScoreSummary(legacy);
    expect(domainScores.documentation.criteria).toContain('close-survey');
    expect(domainScores.intake.criteria).toContain('close-anything-thanks');
  });

  it('summarizes a metadata-less legacy result without throwing', () => {
    const { domainScores, competencyScores } = qaDomainScoreSummary({
      criteria: [{ id: 'open-greet', verdict: 'MET' }], autoFails: [],
    });
    expect(domainScores.intake.score).toBe(100);
    expect(competencyScores.communication.score).toBe(100);
  });
});

// ── Validation / scoring pairing ─────────────────────────────────────────────

describe('validation and scoring cannot use different rubrics', () => {
  const obgynAllMet = () => OBGYN.criteria.map((c) => ({
    id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: 'ok quote', note: '',
  }));

  it('rejects a Pediatrics-shaped response when the OB/GYN profile is active', () => {
    const pedsResponse = { criteria: PEDS.criteria.map((c) => ({ id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '' })), autoFails: [] };
    const result = validateQaResponse(pedsResponse, OBGYN);
    expect(result.error).toMatch(/close-offer-help/);
  });

  it('rejects an OB/GYN-shaped response when the Pediatrics profile is active', () => {
    const obgynResponse = { criteria: obgynAllMet(), autoFails: [] };
    const result = validateQaResponse(obgynResponse, PEDS);
    expect(result.error).toMatch(/close-survey|close-anything-thanks/);
  });

  it('stamps the validating profile version onto the validated data', () => {
    const result = validateQaResponse({ criteria: obgynAllMet(), autoFails: [] }, OBGYN);
    expect(result.data.rubricVersion).toBe(QA_RUBRIC_VERSION_OBGYN);
  });

  it('throws rather than mis-scoring when scoreQa gets a mismatched criterion set', () => {
    expect(() => scoreQa(obgynAllMet(), [], [], PEDS))
      .toThrow(/not part of rubric profile "pediatrics"/);
  });

  it('rejects an auto-fail id the active profile does not define', () => {
    const result = validateQaResponse(
      { criteria: obgynAllMet(), autoFails: [{ id: 'af-not-real', triggered: true, evidence: 'x', note: '' }] },
      OBGYN,
    );
    expect(result.data.autoFails).toEqual([]);
  });
});

// ── Identity-verification evidence policy ────────────────────────────────────

describe('identity-verification evidence policy', () => {
  const transcript = [
    { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana.' },
    { role: 'patient', text: 'Hi, this is Maria Alvarez, date of birth March 2nd 1991.' },
    { role: 'navigator', text: 'Thank you Maria, I have your record open.' },
  ];

  it('verifies a caller-volunteered identifier quote for verification criteria', () => {
    expect(verifyIdentityEvidence(transcript, 'this is Maria Alvarez, date of birth March 2nd 1991')).toBe(true);
    // The SAME quote is not navigator evidence.
    expect(verifyNavigatorEvidence(transcript, 'this is Maria Alvarez, date of birth March 2nd 1991')).toBe(false);
  });

  it('applies only to criteria that opt in', () => {
    const quote = 'this is Maria Alvarez, date of birth March 2nd 1991';
    expect(verifyCriterionEvidence(transcript, quote, OBGYN.criteriaById.get('verify-three'))).toBe(true);
    // An unrelated navigator-performance criterion cannot be earned by caller wording.
    expect(verifyCriterionEvidence(transcript, quote, OBGYN.criteriaById.get('comm-empathy'))).toBe(false);
    expect(verifyCriterionEvidence(transcript, quote, OBGYN.criteriaById.get('close-offer-help'))).toBe(false);
  });

  it('declares the policy on exactly the two verification criteria', () => {
    const withPolicy = OBGYN.criteria
      .filter((c) => c.evidencePolicy === QA_EVIDENCE_POLICIES.IDENTITY_VERIFICATION)
      .map((c) => c.id);
    expect(withPolicy).toEqual(['verify-three', 'verify-before-access']);
    // Pediatrics is untouched — every criterion stays navigator-only.
    expect(PEDS.criteria.some((c) => c.evidencePolicy)).toBe(false);
  });

  it('never lets caller wording verify a navigator auto-fail', () => {
    const criteria = OBGYN.criteria.map((c) => ({
      id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '',
    }));
    const scored = scoreQa(
      criteria,
      [{ id: 'af-scope', evidence: 'this is Maria Alvarez, date of birth March 2nd 1991', note: '' }],
      transcript,
      OBGYN,
    );
    expect(scored.autoFails).toEqual([]);
    expect(scored.unverifiedAutoFails).toHaveLength(1);
  });

  it("cannot verify an unsafe navigator-action accusation from a caller's words", () => {
    const callerClaim = [
      { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana.' },
      { role: 'patient', text: 'You told me to just take twice the dose.' },
    ];
    const criteria = OBGYN.criteria.map((c) => ({
      id: c.id,
      verdict: c.id === 'know-rule' ? 'NOT_MET' : 'NA',
      basis: c.id === 'know-rule' ? 'EVIDENCE' : 'ABSENCE',
      evidence: c.id === 'know-rule' ? 'You told me to just take twice the dose' : '',
      note: '',
    }));
    const scored = scoreQa(criteria, [], callerClaim, OBGYN);
    const knowRule = scored.criteria.find((c) => c.id === 'know-rule');
    expect(knowRule.unresolved).toBe(true);
    expect(knowRule.unresolvedReason).toBe('negative-evidence-not-verified');
    const review = assessQa(scored, callerClaim, { profile: OBGYN });
    expect(review.recommendation).toBe('needs_review');
  });

  it('preserves transcript order for verification-before-access', () => {
    const late = [
      { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana.' },
      { role: 'navigator', text: 'Your appointment is Tuesday the 14th at 2:15.' },
      { role: 'patient', text: 'Thanks. My date of birth is March 2nd 1991 by the way.' },
    ];
    expect(findProtectedDisclosureIndex(late)).toBe(1);
    // Collected — but after the disclosure, so it cannot satisfy before-access.
    expect(verifyIdentityEvidence(late, 'My date of birth is March 2nd 1991')).toBe(true);
    expect(verifyIdentityEvidence(late, 'My date of birth is March 2nd 1991', { requireBeforeDisclosure: true })).toBe(false);
  });

  it('reports no disclosure for a call that never shares a protected specific', () => {
    expect(findProtectedDisclosureIndex(transcript)).toBe(-1);
  });
});

// ── Prompt contract ──────────────────────────────────────────────────────────

describe('OB/GYN grader prompt contract', () => {
  const build = (profile, department) => buildMessages(
    'synthetic scenario', [{ role: 'navigator', text: 'hello' }], department, 'SOP', profile,
  );

  it('enumerates the OB/GYN criteria and never the survey criterion', () => {
    const { systemInstruction, userMessage } = build(OBGYN, 'obgyn');
    expect(systemInstruction).toContain('[close-offer-help]');
    expect(systemInstruction).not.toContain('[close-survey]');
    expect(systemInstruction).not.toContain('[close-anything-thanks]');
    expect(userMessage).toContain(`ALL ${OBGYN.criteria.length} criteria ids`);
  });

  it('removes the "any polite sign-off is sufficient" allowance for OB/GYN', () => {
    const { systemInstruction } = build(OBGYN, 'obgyn');
    expect(systemInstruction).not.toMatch(/any polite sign-off/i);
    expect(systemInstruction).not.toMatch(/Natural closings count/i);
    expect(systemInstruction).toMatch(/polite sign-off WITHOUT an offer of further help is NOT_MET/);
  });

  it('does not require the survey and marks survey wording score-neutral', () => {
    const { systemInstruction } = build(OBGYN, 'obgyn');
    expect(systemInstruction).toMatch(/OB\/GYN runs NO patient survey/);
    expect(systemInstruction).toMatch(/never deduct for it/);
  });

  it('states the exact three identifiers and rejects substitutes', () => {
    const { systemInstruction } = build(OBGYN, 'obgyn');
    expect(systemInstruction).toMatch(/patient first name, patient last name, patient date of birth/);
    expect(systemInstruction).toMatch(/phone number or home address does NOT substitute/);
    expect(systemInstruction).toMatch(/\[af-hipaa\] auto-fail uses this SAME definition/);
  });

  it('makes empathy and narration explicitly conditional', () => {
    const { systemInstruction } = build(OBGYN, 'obgyn');
    expect(systemInstruction).toMatch(/\[comm-empathy\] is CONDITIONAL/);
    expect(systemInstruction).toMatch(/\[control-narrate\] is CONDITIONAL/);
    expect(systemInstruction).toMatch(/never require the exact phrases "I understand" or "I hear you"/i);
    expect(systemInstruction).toMatch(/CANNOT observe dead air, hold duration, or delay/);
  });

  it('keeps Pediatrics prompt guidance intact and OB/GYN rules out of it', () => {
    const { systemInstruction } = build(PEDS, 'pediatrics');
    expect(systemInstruction).toContain('[close-survey]');
    expect(systemInstruction).toMatch(/Natural closings count/);
    expect(systemInstruction).toMatch(/WORKFLOW FAIRNESS RULES/);
    expect(systemInstruction).not.toMatch(/DEPARTMENT GRADING RULES \(OB\/GYN\)/);
  });

  it('defaults to the department profile when none is passed explicitly', () => {
    expect(() => buildMessages('s', [], 'behavioral', 'SOP')).toThrow(UnsupportedQaDepartmentError);
  });
});

// ── Scored runtime fail-closed ───────────────────────────────────────────────

describe('scored runtime fails closed on an unsupported department', () => {
  const scenarioContext = (department) => ({
    verified: true, status: 'verified', qaScenarioId: 'x', department,
    scenarioVersion: 'v1', gradingScenario: 'context', ruleIds: [],
    repairContext: { department, metadata: {} },
  });

  it('refuses to grade a department with no rubric profile', async () => {
    await expect(gradeCallQaTranscript({
      transcript: [{ role: 'navigator', text: 'hello there' }],
      scenarioContext: scenarioContext('behavioral'),
    }, { keys: ['k'], geminiWithRotation: async () => { throw new Error('must not call the grader'); } }))
      .rejects.toMatchObject({ httpStatus: 422 });
  });

  it('refuses to grade an attempt with no stored department', async () => {
    const context = buildScenarioContextFromAttempt({
      assessmentType: 'call-qa', captureAuthority: 'server', qaScenarioId: 'x',
      scenarioSnapshot: { gradingContext: 'c', expectedActions: [], criticalMisses: [], scoringNotes: [] },
    });
    expect(context.department).toBeNull();
    await expect(gradeCallQaTranscript({
      transcript: [{ role: 'navigator', text: 'hello there' }], scenarioContext: context,
    }, { keys: ['k'], geminiWithRotation: async () => { throw new Error('must not call the grader'); } }))
      .rejects.toMatchObject({ httpStatus: 422 });
  });
});

// ── Deterministic scoring / persistence ──────────────────────────────────────

describe('OB/GYN scoring and persistence', () => {
  const transcript = [
    { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana. How can I help you today?' },
    { role: 'patient', text: 'This is Maria Alvarez, date of birth March 2nd 1991.' },
    { role: 'navigator', text: 'Is there anything else I can help you with today?' },
  ];
  const verdicts = (overrides = {}) => OBGYN.criteria.map((c) => ({
    id: c.id,
    verdict: overrides[c.id] ?? 'MET',
    basis: (overrides[c.id] ?? 'MET') === 'MET' ? 'EVIDENCE' : 'ABSENCE',
    evidence: (overrides[c.id] ?? 'MET') === 'MET'
      ? (c.evidencePolicy ? 'This is Maria Alvarez, date of birth March 2nd 1991' : 'Thank you for calling Aizer Health, this is Dana')
      : '',
    note: '',
  }));

  it('is deterministic: identical verdicts produce identical scores', () => {
    const a = scoreQa(verdicts(), [], transcript, OBGYN);
    const b = scoreQa(verdicts(), [], transcript, OBGYN);
    expect(a.score).toBe(b.score);
    expect(a.categories).toEqual(b.categories);
  });

  it('keeps the 85 pass threshold on the scorecard', () => {
    expect(scoreQa(verdicts(), [], transcript, OBGYN).passThreshold).toBe(85);
  });

  it('does not coerce a conditional NA into NOT_MET', () => {
    const scored = scoreQa(verdicts({ 'comm-empathy': 'NA', 'control-narrate': 'NA' }), [], transcript, OBGYN);
    for (const id of ['comm-empathy', 'control-narrate']) {
      expect(scored.criteria.find((c) => c.id === id).verdict).toBe('NA');
    }
    // Those points leave the applicable denominator rather than being lost.
    expect(scored.categories.find((c) => c.id === 'communication').applicablePoints).toBe(10);
    expect(scored.categories.find((c) => c.id === 'callControl').applicablePoints).toBe(5);
  });

  it('still coerces a CORE NA into NOT_MET', () => {
    const scored = scoreQa(verdicts({ 'close-offer-help': 'NA' }), [], transcript, OBGYN);
    expect(scored.criteria.find((c) => c.id === 'close-offer-help').verdict).toBe('NOT_MET');
  });

  it('stamps the rubric department and version onto the scorecard', () => {
    const scored = scoreQa(verdicts(), [], transcript, OBGYN);
    expect(scored.rubricDepartment).toBe('obgyn');
    expect(scored.rubricVersion).toBe(QA_RUBRIC_VERSION_OBGYN);
  });

  it('never lists a survey criterion as applicable in a new OB/GYN result', () => {
    const scored = scoreQa(verdicts(), [], transcript, OBGYN);
    expect(scored.criteria.map((c) => c.id)).not.toContain('close-survey');
    expect(scored.criteria.map((c) => c.id)).toContain('close-offer-help');
  });

  it('keeps auto-fail zeroing and the supervisor-review flag intact', () => {
    const scored = scoreQa(
      verdicts(),
      [{ id: 'af-scope', evidence: 'Thank you for calling Aizer Health, this is Dana', note: '' }],
      transcript, OBGYN,
    );
    expect(scored.score).toBe(0);
    expect(scored.pass).toBe(false);
    const review = assessQa(scored, transcript, { profile: OBGYN });
    expect(review.recommendation).toBe('fail');
    expect(review.reviewFlags.map((f) => f.id)).toContain('requires-supervisor-judgment');
  });
});

// ── Manual-review fixtures, executed ─────────────────────────────────────────

describe('OB/GYN synthetic manual-review fixtures', () => {
  const runFixture = (fixture) => {
    const parsed = simulateObgynGrader(fixture, OBGYN);
    const check = validateQaResponse(parsed, OBGYN);
    expect(check.error).toBeUndefined();
    const scored = scoreQa(check.data.criteria, check.data.autoFails, fixture.transcript, OBGYN);
    const review = assessQa(scored, fixture.transcript, { profile: OBGYN });
    return { scored, review };
  };

  it('covers all eight documented review scenarios', () => {
    expect(OBGYN_REVIEW_FIXTURES).toHaveLength(8);
    expect(new Set(OBGYN_REVIEW_FIXTURES.map((f) => f.id)).size).toBe(8);
    for (const fixture of OBGYN_REVIEW_FIXTURES) {
      expect(fixture.department).toBe('obgyn');
      expect(fixture.demonstrates).toEqual(expect.any(String));
    }
  });

  it.each(OBGYN_REVIEW_FIXTURES.map((fixture) => [fixture.id, fixture]))(
    'behaves as documented: %s', (_id, fixture) => {
      const { scored, review } = runFixture(fixture);
      const verdictOf = (id) => scored.criteria.find((c) => c.id === id)?.verdict;

      for (const id of fixture.expect.naCriteria ?? []) expect(verdictOf(id)).toBe('NA');
      for (const id of fixture.expect.metCriteria ?? []) expect(verdictOf(id)).toBe('MET');
      for (const id of fixture.expect.notMetCriteria ?? []) expect(verdictOf(id)).toBe('NOT_MET');

      if (fixture.expect.closingEarned != null) {
        expect(scored.categories.find((c) => c.id === 'closing').earned)
          .toBe(fixture.expect.closingEarned);
      }
      if (fixture.expect.autoFailed != null) {
        expect(scored.autoFails.length > 0).toBe(fixture.expect.autoFailed);
      }
      if (fixture.expect.score != null) expect(scored.score).toBe(fixture.expect.score);
      if (fixture.expect.pass != null) expect(scored.pass).toBe(fixture.expect.pass);
      if (fixture.expect.recommendation) {
        expect(review.recommendation).toBe(fixture.expect.recommendation);
      }
      for (const flag of fixture.expect.reviewFlags ?? []) {
        expect(review.reviewFlags.map((f) => f.id)).toContain(flag);
      }
    },
  );

  it('routes an incomplete-verification call to a supervisor even when it scores above the pass mark', () => {
    const { scored, review } = runFixture(
      OBGYN_REVIEW_FIXTURES.find((f) => f.id === 'obgyn-review-phone-instead-of-dob'),
    );
    // Verification is only 10 of 100 points, so the NUMERIC score can pass...
    expect(scored.score).toBeGreaterThanOrEqual(scored.passThreshold);
    // ...but a missed safety-critical criterion can never be a confident pass.
    expect(review.recommendation).toBe('needs_review');
    expect(review.safetyRisk).toBe('elevated');
  });

  it('earns full closing points for a volunteered-identity routine call', () => {
    const { scored } = runFixture(OBGYN_REVIEW_FIXTURES[0]);
    expect(scored.categories.find((c) => c.id === 'closing').earned).toBe(5);
    expect(scored.categories.find((c) => c.id === 'verification').earned).toBe(10);
  });

  it('loses exactly the closing points for a thanks-and-goodbye ending', () => {
    const strong = runFixture(OBGYN_REVIEW_FIXTURES[0]).scored;
    const weak = runFixture(OBGYN_REVIEW_FIXTURES[1]).scored;
    expect(weak.categories.find((c) => c.id === 'closing').earned).toBe(0);
    // Every other category is unchanged between the two calls.
    for (const category of strong.categories) {
      if (category.id === 'closing') continue;
      expect(weak.categories.find((c) => c.id === category.id).earned).toBe(category.earned);
    }
  });

  it('forces supervisor review when verification fails before disclosure', () => {
    const { review } = runFixture(OBGYN_REVIEW_FIXTURES[5]);
    expect(review.recommendation).toBe('fail');
    expect(review.safetyRisk).toBe('critical');
  });
});

// ── Closing-rule semantics ───────────────────────────────────────────────────

describe('OB/GYN closing rule', () => {
  const closingCall = (finalLine) => [
    { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana. How can I help you today?' },
    { role: 'patient', text: 'This is Maria Alvarez, date of birth March 2nd 1991.' },
    { role: 'navigator', text: finalLine },
  ];
  const scoreClosing = (finalLine, { verdict = 'MET' } = {}) => {
    const criteria = OBGYN.criteria.map((c) => ({
      id: c.id,
      verdict: c.id === 'close-offer-help' ? verdict : 'NA',
      basis: c.id === 'close-offer-help' && verdict === 'MET' ? 'EVIDENCE' : 'ABSENCE',
      evidence: c.id === 'close-offer-help' && verdict === 'MET' ? finalLine : '',
      note: '',
    }));
    return scoreQa(criteria, [], closingCall(finalLine), OBGYN);
  };

  it.each([
    'Is there anything else I can help you with today?',
    'Anything else I can assist you with?',
    "Is there anything more you'd like help with today?",
    'Can I help you with anything else?',
    // A paraphrase that is in no hardcoded list — the meaning is what counts.
    'Before I let you go, was there another thing you needed sorted out?',
  ])('awards all five closing points for a natural offer: %s', (line) => {
    expect(scoreClosing(line).categories.find((c) => c.id === 'closing').earned).toBe(5);
  });

  it.each([
    'Thank you.',
    'Have a good day.',
    'Goodbye.',
    'Thank you as well, goodbye.',
    'Please stay on the line for a short survey.',
  ])('awards zero closing points for a sign-off without an offer: %s', (line) => {
    // A correct grader returns NOT_MET here; the score must reflect exactly 0.
    expect(scoreClosing(line, { verdict: 'NOT_MET' }).categories.find((c) => c.id === 'closing').earned).toBe(0);
  });

  it('caps a survey-plus-offer close at the normal five points', () => {
    const line = 'Please stay on the line for a survey. Is there anything else I can help you with today?';
    const scored = scoreClosing(line);
    expect(scored.categories.find((c) => c.id === 'closing').earned).toBe(5);
    expect(scored.categories.find((c) => c.id === 'closing').possible).toBe(5);
  });

  it('never penalizes survey wording', () => {
    const withSurvey = scoreClosing('Please stay on the line for a survey. Is there anything else I can help you with today?');
    const withoutSurvey = scoreClosing('Is there anything else I can help you with today?');
    expect(withSurvey.score).toBe(withoutSurvey.score);
  });
});
