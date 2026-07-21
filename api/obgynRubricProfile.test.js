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
  UnsupportedQaDepartmentError, profileSignature,
} from '../src/data/qaRubricProfiles.js';
import { QA_RUBRIC_VERSION, QA_PASS_THRESHOLD } from '../src/data/qaRubric.js';
import {
  validateQaResponse, scoreQa, assessQa, repairQaVerdictsForScenario,
  verifyNavigatorEvidence, verifyCriterionEvidence,
  findProtectedDisclosureIndex, classifyProtectedDisclosure,
  evaluateVerificationBeforeAccess, extractDateOfBirth,
} from './_qa-rubric.js';
import { buildMessages, gradeCallQaTranscript, buildScenarioContextFromAttempt } from './grade-call-qa.js';
import { qaDomainScoreSummary, resolveScoringProfile } from '../src/lib/qaDomainScoring.js';
import { DOMAINS } from '../src/data/questions.js';
import { COMPETENCY_IDS } from '../src/data/competencies.js';
import { OBGYN_REVIEW_FIXTURES, simulateObgynGrader } from './_qa-obgyn-review-fixtures.js';
import { evaluateCleanPassCandidate } from './_qa-automation-policy.js';
import { validateCalibrationFixture } from './_qa-calibration.js';
import { readFileSync } from 'node:fs';

const OBGYN = QA_RUBRIC_PROFILES.obgyn;
const PEDS = QA_RUBRIC_PROFILES.pediatrics;

/**
 * Build a synthetic profile with the SAME criterion ids as `base` but one
 * criterion altered. Used to prove that criterion ids alone are not profile
 * identity: a swap that changes points or `core` applicability must be caught.
 */
function makeVariantProfile(base, transform) {
  const rubric = base.rubric.map((category) => ({
    ...category,
    criteria: category.criteria.map(transform),
  }));
  const criteria = rubric.flatMap((category) =>
    category.criteria.map((c) => ({ ...c, categoryId: category.id, categoryName: category.name })));
  return {
    ...base,
    rubric,
    criteria,
    criteriaById: new Map(criteria.map((c) => [c.id, c])),
    criterionIds: new Set(criteria.map((c) => c.id)),
    signature: profileSignature({
      department: base.department,
      rubricVersion: base.rubricVersion,
      rubric,
      autoFails: base.autoFails,
      passThreshold: base.passThreshold,
      safetyCriticalCriteria: base.safetyCriticalCriteria,
      repairableCriteria: base.repairableCriteria,
    }),
  };
}

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

describe('historical unknown rubric versions — adversarial', () => {
  const withVersion = (rubricVersion, extra = {}) => ({
    gradingMetadata: { rubricVersion, ...extra },
    criteria: [{ id: 'close-survey', verdict: 'MET' }, { id: 'open-greet', verdict: 'MET' }],
    autoFails: [],
  });

  it('a MISSING-metadata legacy result still uses the historical shared rubric', () => {
    const legacy = { criteria: [{ id: 'open-greet', verdict: 'MET' }], autoFails: [] };
    expect(resolveScoringProfile(legacy)).toBe(PEDS);
    const { domainScores, scoringUnavailable } = qaDomainScoreSummary(legacy);
    expect(scoringUnavailable).toBeUndefined();
    expect(domainScores.intake.score).toBe(100);
  });

  it('a known Pediatrics version resolves to Pediatrics', () => {
    expect(resolveScoringProfile(withVersion(QA_RUBRIC_VERSION))).toBe(PEDS);
  });

  it('a known OB/GYN version resolves to OB/GYN', () => {
    expect(resolveScoringProfile(withVersion(QA_RUBRIC_VERSION_OBGYN))).toBe(OBGYN);
  });

  it('an UNKNOWN recorded version never becomes Pediatrics', () => {
    const unknown = withVersion('qa-rubric-v1');
    expect(profileForGradedAttempt(unknown.gradingMetadata)).toBeNull();
    expect(resolveScoringProfile(unknown)).toBeNull();
  });

  it('an unknown version with department obgyn still resolves to null', () => {
    const unknown = withVersion('qa-rubric-obgyn-v99', { rubricDepartment: 'obgyn' });
    expect(resolveScoringProfile(unknown)).toBeNull();
  });

  it('an unknown version carrying OLD closing ids produces no fabricated scores', () => {
    const unknown = withVersion('qa-rubric-v0');
    const summary = qaDomainScoreSummary(unknown);
    expect(summary.scoringUnavailable).toBe(true);
    expect(summary.scoringUnavailableReason).toBe('unknown-rubric-version');
    expect(summary.domainScores).toBeNull();
    expect(summary.competencyScores).toBeNull();
    expect(summary.recordedRubricVersion).toBe('qa-rubric-v0');
  });

  it('a version/department pair that disagrees is treated as corrupt, not usable', () => {
    // Recorded as the OB/GYN rubric but stamped Pediatrics: do not pick either.
    expect(profileForGradedAttempt({
      rubricVersion: QA_RUBRIC_VERSION_OBGYN, rubricDepartment: 'pediatrics',
    })).toBeNull();
  });

  it('summarizing an unknown-version result does not throw', () => {
    expect(() => qaDomainScoreSummary(withVersion('nope'))).not.toThrow();
  });

  it('shadow automation stays ineligible for an unknown recorded version', () => {
    const attempt = {
      department: 'obgyn',
      qa: { ...withVersion('qa-rubric-v1'), criteria: OBGYN.criteria.map((c) => ({ id: c.id, verdict: 'MET' })) },
    };
    attempt.qa.gradingMetadata = { rubricVersion: 'qa-rubric-v1' };
    const result = evaluateCleanPassCandidate(attempt, {});
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('incomplete-rubric-result');
  });

  it('calibration rejects an unsupported rubric version', () => {
    const fixture = JSON.parse(readFileSync(
      new URL('./fixtures/call-qa-calibration/obgyn-example-pass.json', import.meta.url), 'utf8',
    ));
    fixture.modelRun.rubricVersion = 'qa-rubric-v1';
    const result = validateCalibrationFixture(fixture);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/unsupported rubric version/);
  });
});

describe('historical attempts keep their own rubric', () => {
  it('resolves a stored attempt by its recorded rubric version', () => {
    expect(profileForGradedAttempt({ rubricVersion: QA_RUBRIC_VERSION })).toBe(PEDS);
    expect(profileForGradedAttempt({ rubricVersion: QA_RUBRIC_VERSION_OBGYN })).toBe(OBGYN);
  });

  it('never reinterprets an unknown historical rubric version under a newer profile', () => {
    expect(profileForGradedAttempt({ rubricVersion: 'qa-rubric-v1' }, 'obgyn')).toBeNull();
  });

  // CORRECTED 2026-07-21. This test previously asserted that a metadata-less
  // OB/GYN record resolves to the NEW OB/GYN profile. That was wrong: before
  // department profiles existed, every department — OB/GYN included — was graded
  // under the shared rubric, so a record with no rubric metadata can only have
  // been produced by `qa-rubric-v2`. Resolving it to `qa-rubric-obgyn-v1` would
  // summarize it against `close-offer-help`, a criterion it was never scored on,
  // and silently drop its real `close-survey` / `close-anything-thanks` verdicts.
  it('resolves a metadata-less record to the historical shared rubric, whatever its department', () => {
    expect(profileForGradedAttempt({}, 'obgyn')).toBe(PEDS);
    expect(profileForGradedAttempt(undefined, 'pediatrics')).toBe(PEDS);
    expect(profileForGradedAttempt({ rubricDepartment: 'obgyn' })).toBe(PEDS);
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
  // The prompt contract asks for a verdict on EVERY auto-fail id, and validation
  // now enforces that, so a raw response must answer all of them.
  const noAutoFails = (profile = OBGYN) => profile.autoFails.map((a) => ({
    id: a.id, triggered: false, evidence: '', note: '',
  }));

  it('rejects a Pediatrics-shaped response when the OB/GYN profile is active', () => {
    const pedsResponse = {
      criteria: PEDS.criteria.map((c) => ({ id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '' })),
      autoFails: noAutoFails(),
    };
    const result = validateQaResponse(pedsResponse, OBGYN);
    // Raw validation now rejects the FIRST contract violation it sees — an id the
    // active profile does not define — rather than normalizing the response and
    // only noticing the missing OB/GYN criterion afterwards.
    expect(result.error).toMatch(/unknown criterion "close-survey"/i);
  });

  it('rejects an OB/GYN-shaped response when the Pediatrics profile is active', () => {
    const obgynResponse = { criteria: obgynAllMet(), autoFails: noAutoFails(PEDS) };
    const result = validateQaResponse(obgynResponse, PEDS);
    expect(result.error).toMatch(/unknown criterion "close-offer-help"/i);
  });

  it('stamps the full profile binding onto the validated data', () => {
    const result = validateQaResponse({ criteria: obgynAllMet(), autoFails: noAutoFails() }, OBGYN);
    expect(result.data.profileBinding).toEqual({
      department: 'obgyn',
      rubricVersion: QA_RUBRIC_VERSION_OBGYN,
      signature: OBGYN.signature,
    });
  });

  it('throws rather than mis-scoring when scoreQa gets a mismatched criterion set', () => {
    expect(() => scoreQa(obgynAllMet(), [], [], PEDS))
      .toThrow(/unknown criterion|missing criteria/);
  });

  it('rejects a carried binding that does not match the scoring profile', () => {
    const validated = validateQaResponse({ criteria: obgynAllMet(), autoFails: noAutoFails() }, OBGYN).data;
    expect(() => scoreQa(validated.criteria, [], [], OBGYN, {
      ...validated.profileBinding, signature: 'tampered',
    })).toThrow(/profile-binding-signature-mismatch/);
  });

  it('rejects a MISSING binding when one was expected', () => {
    const validated = validateQaResponse({ criteria: obgynAllMet(), autoFails: noAutoFails() }, OBGYN).data;
    expect(() => scoreQa(validated.criteria, [], [], OBGYN, null))
      .toThrow(/missing-profile-binding/);
  });

  it('detects duplicate and missing criterion ids, not just unknown ones', () => {
    const base = obgynAllMet();
    expect(() => scoreQa([...base, base[0]], [], [], OBGYN)).toThrow(/duplicate criterion/);
    expect(() => scoreQa(base.slice(1), [], [], OBGYN)).toThrow(/missing criteria/);
  });

  it('rejects a same-ID profile whose WEIGHTS differ (IDs are not identity)', () => {
    // Two synthetic profiles with the SAME criterion ids but different points
    // and different `core` applicability. Criterion-id checks alone would let
    // these swap silently; the signature must not.
    const reweighted = makeVariantProfile(OBGYN, (criterion) => (
      criterion.id === 'close-offer-help' ? { ...criterion, points: 9 } : criterion
    ));
    expect(reweighted.signature).not.toBe(OBGYN.signature);
    const validated = validateQaResponse({ criteria: obgynAllMet(), autoFails: noAutoFails() }, OBGYN).data;
    expect(() => scoreQa(validated.criteria, [], [], reweighted, validated.profileBinding))
      .toThrow(/profile-binding-signature-mismatch/);
  });

  it('rejects a same-ID profile whose CORE applicability differs', () => {
    const recored = makeVariantProfile(OBGYN, (criterion) => (
      criterion.id === 'comm-empathy' ? { ...criterion, core: true } : criterion
    ));
    expect(recored.signature).not.toBe(OBGYN.signature);
    const validated = validateQaResponse({ criteria: obgynAllMet(), autoFails: noAutoFails() }, OBGYN).data;
    expect(() => scoreQa(validated.criteria, [], [], recored, validated.profileBinding))
      .toThrow(/profile-binding-signature-mismatch/);
  });

  it('the repair layer refuses to run under a profile that did not validate the verdicts', () => {
    const validated = validateQaResponse({ criteria: obgynAllMet(), autoFails: noAutoFails() }, OBGYN).data;
    expect(() => repairQaVerdictsForScenario(validated, [], { department: 'pediatrics', profile: PEDS }))
      .toThrow(/profile-binding-(department|version|signature)-mismatch/);
  });

  it('carries the binding through the repair layer unchanged', () => {
    const validated = validateQaResponse({ criteria: obgynAllMet(), autoFails: noAutoFails() }, OBGYN).data;
    const repaired = repairQaVerdictsForScenario(validated, [], { department: 'obgyn', profile: OBGYN });
    expect(repaired.profileBinding).toEqual(validated.profileBinding);
  });

  // CORRECTED 2026-07-21: an unknown auto-fail id used to be silently FILTERED
  // out, so a model that invented one looked compliant and the malformed-response
  // retry never ran. It is now a rejection.
  it('rejects an auto-fail id the active profile does not define', () => {
    const result = validateQaResponse(
      {
        criteria: obgynAllMet(),
        autoFails: [...noAutoFails(), { id: 'af-not-real', triggered: true, evidence: 'x y', note: '' }],
      },
      OBGYN,
    );
    expect(result.data).toBeUndefined();
    expect(result.error).toMatch(/unknown auto-fail "af-not-real"/i);
  });
});

// ── Identity verification: ADVERSARIAL ───────────────────────────────────────
//
// These tests try to make the implementation award verification it has not
// earned. The previous quote-only check passed almost all of them, which is why
// the structured contract exists.

describe('structured identity verification — adversarial', () => {
  // Caller states first name, last name and DOB in ONE sentence.
  const ONE_SENTENCE = [
    { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana. How can I help you today?' },
    { role: 'patient', text: 'Hi, this is Maria Alvarez, date of birth March 2nd 1991.' },
    { role: 'navigator', text: 'Thank you Maria, I have your record open.' },
  ];

  // Each identifier arrives in a DIFFERENT turn.
  const SPREAD = [
    { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana. How can I help you today?' },
    { role: 'patient', text: 'Hi, my first name is Maria.' },
    { role: 'navigator', text: 'Thank you. And your last name?' },
    { role: 'patient', text: 'It is Alvarez.' },
    { role: 'navigator', text: 'And your date of birth?' },
    { role: 'patient', text: 'March 2nd 1991.' },
    { role: 'navigator', text: 'Thank you Maria, that all matches.' },
  ];

  const claim = (field, value, role, turnIndex, quote) => ({ field, value, role, turnIndex, quote });

  const scoreVerification = (transcript, identityEvidence, criterionId = 'verify-three') => {
    const criteria = OBGYN.criteria.map((c) => ({
      id: c.id,
      verdict: c.id === criterionId ? 'MET' : 'NA',
      basis: c.id === criterionId ? 'EVIDENCE' : 'ABSENCE',
      evidence: c.id === criterionId ? 'placeholder quote' : '',
      note: '',
      identityEvidence: c.id === criterionId ? identityEvidence : [],
    }));
    const scored = scoreQa(criteria, [], transcript, OBGYN);
    return scored.criteria.find((c) => c.id === criterionId);
  };

  // ── 1. An unanswered question proves nothing ──────────────────────────────
  it('a quoted DOB QUESTION the caller never answered does not verify', () => {
    const transcript = [
      { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana.' },
      { role: 'navigator', text: 'What is your date of birth?' },
    ];
    const result = scoreVerification(transcript, [
      claim('dob', 'date of birth', 'navigator', 1, 'What is your date of birth?'),
    ]);
    expect(result.verdict).toBe('NOT_MET');
    expect(result.unverified).toBe(true);
  });

  // ── 2. Wrong identifier types never substitute ────────────────────────────
  it('a phone number can never satisfy the date of birth', () => {
    const transcript = [
      { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana.' },
      { role: 'patient', text: 'Maria Alvarez, and my number is 555-013-0199.' },
    ];
    const result = scoreVerification(transcript, [
      claim('firstName', 'Maria', 'caller', 1, 'Maria Alvarez, and my number is 555-013-0199'),
      claim('lastName', 'Alvarez', 'caller', 1, 'Maria Alvarez, and my number is 555-013-0199'),
      claim('dob', '555-013-0199', 'caller', 1, 'Maria Alvarez, and my number is 555-013-0199'),
    ]);
    expect(result.verdict).toBe('NOT_MET');
    expect(result.identityVerification.rejectedClaims)
      .toContainEqual({ field: 'dob', reason: 'value-is-not-a-date-of-birth' });
  });

  it('a home address can never satisfy the date of birth', () => {
    const transcript = [
      { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana.' },
      { role: 'patient', text: 'Maria Alvarez, I live at 48 Baker Town Road.' },
    ];
    const result = scoreVerification(transcript, [
      claim('firstName', 'Maria', 'caller', 1, 'Maria Alvarez, I live at 48 Baker Town Road'),
      claim('lastName', 'Alvarez', 'caller', 1, 'Maria Alvarez, I live at 48 Baker Town Road'),
      claim('dob', '48 Baker Town Road', 'caller', 1, 'Maria Alvarez, I live at 48 Baker Town Road'),
    ]);
    expect(result.verdict).toBe('NOT_MET');
  });

  it('a first name alone does not satisfy full-name verification', () => {
    const transcript = [
      { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana.' },
      { role: 'patient', text: 'This is Maria, my date of birth is March 2nd 1991.' },
    ];
    const result = scoreVerification(transcript, [
      claim('firstName', 'Maria', 'caller', 1, 'This is Maria, my date of birth is March 2nd 1991'),
      claim('dob', 'March 2nd 1991', 'caller', 1, 'This is Maria, my date of birth is March 2nd 1991'),
    ]);
    expect(result.verdict).toBe('NOT_MET');
  });

  it('a last name alone does not satisfy full-name verification', () => {
    const transcript = [
      { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana.' },
      { role: 'patient', text: 'Alvarez, born March 2nd 1991.' },
    ];
    const result = scoreVerification(transcript, [
      claim('lastName', 'Alvarez', 'caller', 1, 'Alvarez, born March 2nd 1991'),
      claim('dob', 'March 2nd 1991', 'caller', 1, 'Alvarez, born March 2nd 1991'),
    ]);
    expect(result.verdict).toBe('NOT_MET');
  });

  it('the same single name cannot be claimed as BOTH first and last name', () => {
    const transcript = [
      { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana.' },
      { role: 'patient', text: 'This is Maria, date of birth March 2nd 1991.' },
    ];
    const result = scoreVerification(transcript, [
      claim('firstName', 'Maria', 'caller', 1, 'This is Maria, date of birth March 2nd 1991'),
      claim('lastName', 'Maria', 'caller', 1, 'This is Maria, date of birth March 2nd 1991'),
      claim('dob', 'March 2nd 1991', 'caller', 1, 'This is Maria, date of birth March 2nd 1991'),
    ]);
    expect(result.verdict).toBe('NOT_MET');
    expect(result.identityVerification.rejectedClaims)
      .toContainEqual({ field: 'lastName', reason: 'last-name-duplicates-first-name' });
  });

  // ── 3 & 4. Genuine collection passes ──────────────────────────────────────
  it('identifiers collected across three separate chronological turns verify', () => {
    const result = scoreVerification(SPREAD, [
      claim('firstName', 'Maria', 'caller', 1, 'my first name is Maria'),
      claim('lastName', 'Alvarez', 'caller', 3, 'It is Alvarez'),
      claim('dob', 'March 2nd 1991', 'caller', 5, 'March 2nd 1991'),
    ]);
    expect(result.verdict).toBe('MET');
    expect(result.identityVerification.complete).toBe(true);
    expect(result.identityVerification.completedAtIndex).toBe(5);
  });

  it('a single caller sentence with full name and DOB satisfies all three', () => {
    const result = scoreVerification(ONE_SENTENCE, [
      claim('firstName', 'Maria', 'caller', 1, 'this is Maria Alvarez, date of birth March 2nd 1991'),
      claim('lastName', 'Alvarez', 'caller', 1, 'this is Maria Alvarez, date of birth March 2nd 1991'),
      claim('dob', 'March 2nd 1991', 'caller', 1, 'this is Maria Alvarez, date of birth March 2nd 1991'),
    ]);
    expect(result.verdict).toBe('MET');
    expect(result.identityVerification.completedAtIndex).toBe(1);
  });

  // ── Fabrication guards ────────────────────────────────────────────────────
  it('rejects a claim whose quote is not in the declared turn', () => {
    const result = scoreVerification(ONE_SENTENCE, [
      claim('firstName', 'Maria', 'caller', 1, 'this is Maria Alvarez, date of birth March 2nd 1991'),
      claim('lastName', 'Alvarez', 'caller', 1, 'this is Maria Alvarez, date of birth March 2nd 1991'),
      // The caller's quote attributed to the NAVIGATOR turn it does not appear in.
      claim('dob', 'March 2nd 1991', 'navigator', 2, 'date of birth March 2nd 1991'),
    ]);
    expect(result.verdict).toBe('NOT_MET');
    expect(result.identityVerification.rejectedClaims)
      .toContainEqual({ field: 'dob', reason: 'quote-not-in-declared-turn' });
  });

  it('rejects a claim whose declared role does not match the turn', () => {
    const result = scoreVerification(ONE_SENTENCE, [
      claim('firstName', 'Maria', 'navigator', 1, 'this is Maria Alvarez, date of birth March 2nd 1991'),
      claim('lastName', 'Alvarez', 'caller', 1, 'this is Maria Alvarez, date of birth March 2nd 1991'),
      claim('dob', 'March 2nd 1991', 'caller', 1, 'this is Maria Alvarez, date of birth March 2nd 1991'),
    ]);
    expect(result.verdict).toBe('NOT_MET');
    expect(result.identityVerification.rejectedClaims)
      .toContainEqual({ field: 'firstName', reason: 'role-mismatch' });
  });

  it('rejects a value that does not appear inside its own quote', () => {
    const result = scoreVerification(ONE_SENTENCE, [
      claim('firstName', 'Jennifer', 'caller', 1, 'this is Maria Alvarez, date of birth March 2nd 1991'),
      claim('lastName', 'Alvarez', 'caller', 1, 'this is Maria Alvarez, date of birth March 2nd 1991'),
      claim('dob', 'March 2nd 1991', 'caller', 1, 'this is Maria Alvarez, date of birth March 2nd 1991'),
    ]);
    expect(result.verdict).toBe('NOT_MET');
    expect(result.identityVerification.rejectedClaims)
      .toContainEqual({ field: 'firstName', reason: 'value-not-in-quote' });
  });

  it('a MET claim with NO structured evidence at all loses credit', () => {
    const result = scoreVerification(ONE_SENTENCE, []);
    expect(result.verdict).toBe('NOT_MET');
    expect(result.unverified).toBe(true);
  });

  it('an out-of-range turn index is rejected rather than throwing', () => {
    const result = scoreVerification(ONE_SENTENCE, [
      claim('firstName', 'Maria', 'caller', 99, 'this is Maria Alvarez'),
    ]);
    expect(result.verdict).toBe('NOT_MET');
    expect(result.identityVerification.rejectedClaims)
      .toContainEqual({ field: 'firstName', reason: 'turn-index-out-of-range' });
  });

  // ── Scope limits (unchanged guarantees) ───────────────────────────────────
  it('the identity policy is declared on exactly the two verification criteria', () => {
    const withPolicy = OBGYN.criteria
      .filter((c) => c.evidencePolicy === QA_EVIDENCE_POLICIES.IDENTITY_VERIFICATION)
      .map((c) => c.id);
    expect(withPolicy).toEqual(['verify-three', 'verify-before-access']);
    // Pediatrics is untouched — every criterion stays navigator-only.
    expect(PEDS.criteria.some((c) => c.evidencePolicy)).toBe(false);
  });

  it('caller wording cannot earn an unrelated navigator-performance criterion', () => {
    const quote = 'this is Maria Alvarez, date of birth March 2nd 1991';
    expect(verifyCriterionEvidence(ONE_SENTENCE, quote, OBGYN.criteriaById.get('comm-empathy'), []))
      .toBe(false);
    expect(verifyCriterionEvidence(ONE_SENTENCE, quote, OBGYN.criteriaById.get('close-offer-help'), []))
      .toBe(false);
  });

  it('never lets caller wording verify a navigator auto-fail', () => {
    const criteria = OBGYN.criteria.map((c) => ({
      id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '', identityEvidence: [],
    }));
    const scored = scoreQa(
      criteria,
      [{ id: 'af-scope', evidence: 'this is Maria Alvarez, date of birth March 2nd 1991', note: '' }],
      ONE_SENTENCE, OBGYN,
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
      identityEvidence: [],
    }));
    const scored = scoreQa(criteria, [], callerClaim, OBGYN);
    const knowRule = scored.criteria.find((c) => c.id === 'know-rule');
    expect(knowRule.unresolved).toBe(true);
    expect(knowRule.unresolvedReason).toBe('negative-evidence-not-verified');
    expect(assessQa(scored, callerClaim, { profile: OBGYN }).recommendation).toBe('needs_review');
  });

  // ── Date recognition ──────────────────────────────────────────────────────
  it.each([
    'March 2nd 1991', 'March 2, 1991', 'Mar 2 1991', '2 March 1991',
    '2nd of March 1991', '3/2/1991', '03-02-1991', 'June 4th 2019',
  ])('recognizes %s as a date of birth', (value) => {
    expect(extractDateOfBirth(value)).toBeTruthy();
  });

  it.each([
    '555-013-0199', 'five five five zero one nine nine', '48 Baker Town Road',
    '1991', 'March', 'March 2nd', 'my phone number', 'Apartment 4B',
  ])('does NOT recognize %s as a date of birth', (value) => {
    expect(extractDateOfBirth(value)).toBeNull();
  });
});

// ── Protected disclosure + ordering: ADVERSARIAL ─────────────────────────────

describe('protected-disclosure ordering — adversarial', () => {
  const nav = (text) => ({ role: 'navigator', text });
  const pat = (text) => ({ role: 'patient', text });

  it.each([
    ['appointment', 'Your appointment is Tuesday the 14th at 2:15 with Dr. Reyes.'],
    ['appointment', 'You are all set for Tuesday at 9.'],
    ['priorVisit', 'Your annual was completed last month.'],
    ['priorVisit', 'You had an ultrasound back in March.'],
    ['chart', 'The chart shows two prior visits.'],
    ['chart', 'I can see in your record that you were here in May.'],
    ['order', 'I can see Dr. Smith ordered an ultrasound.'],
    ['order', 'There is an order for lab work.'],
    ['providerNote', 'The note from your provider says to return in two weeks.'],
    ['providerNote', 'Your doctor documented that you should come back.'],
    ['results', 'Your results came back normal.'],
    ['results', 'Your labs look elevated.'],
    ['medication', 'Your prescription was sent last week.'],
    ['account', 'Your balance is forty dollars.'],
    ['clinicalDetail', 'You are 31 weeks along.'],
  ])('recognizes a %s disclosure: %s', (category, text) => {
    expect(classifyProtectedDisclosure(text)).toBe(category);
  });

  it.each([
    'Let me open your chart.',
    'Let me check that.',
    'Let me pull up the schedule.',
    'I can help you with that.',
    'Can I have your first name, last name, and date of birth?',
    'What is your date of birth?',
    'And your last name?',
    'Our office is on Main Street and we open at eight.',
    'One moment please.',
    'Sure.',
  ])('does NOT treat generic wording as disclosure: %s', (text) => {
    expect(classifyProtectedDisclosure(text)).toBeNull();
  });

  it('only NAVIGATOR turns can be a disclosure', () => {
    expect(findProtectedDisclosureIndex([
      pat('Your appointment is Tuesday at 2:15, right?'),
      nav('Let me check that.'),
    ])).toBe(-1);
  });

  it('identifiers completed AFTER a disclosure fail verification-before-access', () => {
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana.'),
      pat('Hi, it is Maria Alvarez. When is my next visit?'),
      nav('Your appointment is Tuesday the 14th at 2:15 with Dr. Reyes.'),
      nav('Let me confirm your date of birth as well please.'),
      pat('March 2nd 1991.'),
    ];
    const evidence = [
      { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 1, quote: 'it is Maria Alvarez' },
      { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 1, quote: 'it is Maria Alvarez' },
      { field: 'dob', value: 'March 2nd 1991', role: 'caller', turnIndex: 4, quote: 'March 2nd 1991' },
    ];
    const order = evaluateVerificationBeforeAccess(transcript, evidence);
    // Identity WAS eventually collected …
    expect(order.identity.complete).toBe(true);
    expect(order.completedAtIndex).toBe(4);
    // … but not before the disclosure at turn 2.
    expect(order.disclosureIndex).toBe(2);
    expect(order.satisfied).toBe(false);
    expect(order.reason).toBe('identifiers-collected-after-disclosure');
  });

  it('identifiers completed BEFORE a disclosure satisfy verification-before-access', () => {
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana.'),
      pat('Hi, this is Maria Alvarez, date of birth March 2nd 1991.'),
      nav('Your appointment is Tuesday the 14th at 2:15 with Dr. Reyes.'),
    ];
    const order = evaluateVerificationBeforeAccess(transcript, [
      { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 1, quote: 'this is Maria Alvarez, date of birth March 2nd 1991' },
      { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 1, quote: 'this is Maria Alvarez, date of birth March 2nd 1991' },
      { field: 'dob', value: 'March 2nd 1991', role: 'caller', turnIndex: 1, quote: 'this is Maria Alvarez, date of birth March 2nd 1991' },
    ]);
    expect(order.satisfied).toBe(true);
    expect(order.reason).toBe('verified-before-disclosure');
  });

  it('a call with no disclosure at all still requires complete identity', () => {
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana.'),
      pat('Hi, this is Maria.'),
    ];
    const order = evaluateVerificationBeforeAccess(transcript, [
      { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 1, quote: 'this is Maria' },
    ]);
    expect(order.satisfied).toBe(false);
    expect(order.reason).toBe('identity-not-verified');
  });

  it('FAILS CLOSED to review when ordering cannot be established', () => {
    // Identity unverifiable → the order is unknowable → unresolved, which the
    // review layer escalates rather than silently awarding the criterion.
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana.'),
      nav('Your appointment is Tuesday the 14th at 2:15.'),
    ];
    const criteria = OBGYN.criteria.map((c) => ({
      id: c.id,
      verdict: c.id === 'verify-before-access' ? 'MET' : 'NA',
      basis: c.id === 'verify-before-access' ? 'EVIDENCE' : 'ABSENCE',
      evidence: c.id === 'verify-before-access' ? 'Your appointment is Tuesday' : '',
      note: '',
      identityEvidence: [],
    }));
    const scored = scoreQa(criteria, [], transcript, OBGYN);
    const item = scored.criteria.find((c) => c.id === 'verify-before-access');
    expect(item.verdict).toBe('NOT_MET');
    expect(item.unresolved).toBe(true);
    expect(item.unresolvedReason).toBe('verification-order-unverified');
    expect(assessQa(scored, transcript, { profile: OBGYN }).recommendation).toBe('needs_review');
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

// ── Whole-prompt contract: ADVERSARIAL ───────────────────────────────────────
//
// The review found the generic instructions contradicted the OB/GYN identity
// policy. These tests inspect the COMPLETE generated prompt, not just the
// department-specific appended block.

describe('complete OB/GYN prompt has no evidence-role contradiction', () => {
  const fullPrompt = (profile, department) => buildMessages(
    'synthetic scenario', [{ role: 'navigator', text: 'hello there' }], department, 'SOP CONTEXT', profile,
  ).systemInstruction;

  it('never states globally that a caller line is invalid for every MET', () => {
    const prompt = fullPrompt(OBGYN, 'obgyn');
    // The old contradictory sentence required EVERY met quote to come from a
    // navigator turn and "never a caller line".
    expect(prompt).not.toMatch(/never a caller\s+line/i);
    expect(prompt).not.toMatch(/MUST put ONE contiguous verbatim quote from a SINGLE NAVIGATOR turn/i);
  });

  it('states the navigator-only default AND the identity exception together', () => {
    const prompt = fullPrompt(OBGYN, 'obgyn');
    expect(prompt).toMatch(/EVIDENCE ROLE RULES/);
    expect(prompt).toMatch(/DEFAULT — NAVIGATOR ONLY/);
    expect(prompt).toMatch(/IDENTITY EXCEPTION/);
    expect(prompt).toMatch(/\[verify-three\]/);
    expect(prompt).toMatch(/\[verify-before-access\]/);
  });

  it('keeps negatives and auto-fails navigator-only in the prompt itself', () => {
    const prompt = fullPrompt(OBGYN, 'obgyn');
    expect(prompt).toMatch(/Every NOT_MET with basis EVIDENCE must quote a NAVIGATOR line/);
    expect(prompt).toMatch(/Every auto-fail must quote a NAVIGATOR line/);
  });

  it('documents the structured identity evidence contract', () => {
    const prompt = fullPrompt(OBGYN, 'obgyn');
    expect(prompt).toMatch(/STRUCTURED IDENTITY EVIDENCE/);
    expect(prompt).toMatch(/"firstName" \| "lastName" \| "dob"/);
    expect(prompt).toMatch(/turnIndex/);
    expect(prompt).toMatch(/A phone number or a home address is NEVER a date of birth/);
    expect(prompt).toMatch(/proves NOTHING/);
  });

  it('removes the survey from generic always-required examples', () => {
    expect(fullPrompt(OBGYN, 'obgyn')).not.toMatch(/never offered the survey/i);
  });

  it('does not claim closing criteria apply identically to every department', () => {
    const prompt = fullPrompt(OBGYN, 'obgyn');
    expect(prompt).not.toMatch(/closing criteria apply to EVERY call/i);
    expect(prompt).toMatch(/CONDITIONAL and are MEANT to be/);
  });

  it('numbers the transcript turns so identity evidence can reference them', () => {
    const { userMessage } = buildMessages(
      'scenario',
      [{ role: 'navigator', text: 'first line' }, { role: 'patient', text: 'second line' }],
      'obgyn', 'SOP', OBGYN,
    );
    expect(userMessage).toContain('[0] Navigator: first line');
    expect(userMessage).toContain('[1] Caller: second line');
  });

  it('Pediatrics keeps navigator-only evidence with NO identity exception', () => {
    const prompt = fullPrompt(PEDS, 'pediatrics');
    expect(prompt).toMatch(/DEFAULT — NAVIGATOR ONLY/);
    expect(prompt).toMatch(/There is NO identity exception in this rubric/);
    expect(prompt).not.toMatch(/STRUCTURED IDENTITY EVIDENCE/);
    // …and its survey + natural-closing behavior is untouched.
    expect(prompt).toContain('[close-survey]');
    expect(prompt).toMatch(/Natural closings count/);
  });
});

// ── Empathy applicability: ADVERSARIAL ───────────────────────────────────────

describe('empathy applies to expressed affect, not subject matter', () => {
  const criterionText = OBGYN.criteriaById.get('comm-empathy').text;
  const instructions = OBGYN.graderInstructions;

  it('no longer treats Women’s Health information as an automatic cue', () => {
    expect(criterionText).not.toMatch(/sensitive pregnancy \/ Women/);
    expect(criterionText).toMatch(/CALLER EXPRESSED/);
  });

  it('names the routine subjects that are explicitly NOT cues', () => {
    for (const subject of ['pregnancy', 'New OB appointment', 'contraception', 'annual GYN visit', 'routine test scheduling']) {
      expect(criterionText.includes(subject) || instructions.includes(subject), subject).toBe(true);
    }
    expect(instructions).toMatch(/TOPIC is NOT a cue/);
    expect(instructions).toMatch(/I need to schedule my New OB appointment/);
  });

  it('still allows an adverse event to trigger empathy without the literal words', () => {
    expect(criterionText).toMatch(/clearly adverse or emotionally sensitive event/);
    expect(instructions).toMatch(/need not use the exact words/);
    expect(instructions).toMatch(/grounded in something the caller actually said/);
  });

  it('routine pregnancy scheduling leaves empathy NA end to end', () => {
    const transcript = [
      { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana. How can I help you today?' },
      { role: 'patient', text: 'I need to schedule my New OB appointment.' },
      { role: 'navigator', text: 'Is there anything else I can help you with today?' },
    ];
    const criteria = OBGYN.criteria.map((c) => ({
      id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '', identityEvidence: [],
    }));
    const scored = scoreQa(criteria, [], transcript, OBGYN);
    // Non-core → the NA stands and empathy's 5 points leave the denominator.
    // The two CORE communication criteria are still coerced NA → NOT_MET, so
    // 10 of the category's 15 points remain applicable.
    expect(scored.criteria.find((c) => c.id === 'comm-empathy').verdict).toBe('NA');
    expect(scored.categories.find((c) => c.id === 'communication').applicablePoints).toBe(10);
    expect(scored.criteria.find((c) => c.id === 'comm-plain').verdict).toBe('NOT_MET');
  });

  it('expressed frustration makes empathy applicable and scorable', () => {
    const transcript = [
      { role: 'navigator', text: 'Thank you for calling Aizer Health, this is Dana. How can I help you today?' },
      { role: 'patient', text: 'I am frustrated because nobody called me back.' },
      { role: 'navigator', text: 'I am sorry you are dealing with that, I understand why that would be frustrating.' },
    ];
    const criteria = OBGYN.criteria.map((c) => ({
      id: c.id,
      verdict: c.id === 'comm-empathy' ? 'MET' : 'NA',
      basis: c.id === 'comm-empathy' ? 'EVIDENCE' : 'ABSENCE',
      evidence: c.id === 'comm-empathy' ? 'I am sorry you are dealing with that' : '',
      note: '', identityEvidence: [],
    }));
    const scored = scoreQa(criteria, [], transcript, OBGYN);
    expect(scored.criteria.find((c) => c.id === 'comm-empathy').verdict).toBe('MET');
  });
});

// ── Repair set follows the ACTIVE profile ────────────────────────────────────

describe('repair layer obeys the active profile repairable set', () => {
  it('honors a profile whose repairable set differs from the global default', () => {
    // Same criterion ids, but only `doc-te` is repairable in this profile.
    const narrowed = { ...OBGYN, repairableCriteria: new Set(['doc-te']) };
    const transcript = [
      { role: 'navigator', text: 'I will send this directly to our MFM coordinator.' },
    ];
    const verdicts = OBGYN.criteria.map((c) => ({
      id: c.id,
      verdict: ['know-rule', 'doc-te'].includes(c.id) ? 'NOT_MET' : 'NA',
      basis: 'ABSENCE',
      evidence: '',
      note: ['know-rule', 'doc-te'].includes(c.id) ? 'The navigator did not name Rebecca Wood.' : '',
      identityEvidence: [],
    }));
    const context = {
      department: 'obgyn',
      metadata: { workflowType: 'mfm_owner', ruleIds: ['mfm_routing'] },
      profile: narrowed,
    };
    const repaired = repairQaVerdictsForScenario({ criteria: verdicts, autoFails: [] }, transcript, context);
    const repairedIds = repaired.repairs.map((r) => r.criterionId);
    // `know-rule` IS repairable in the default (Pediatrics) set but not here.
    expect(repairedIds).not.toContain('know-rule');
    for (const id of repairedIds) expect(narrowed.repairableCriteria.has(id)).toBe(true);
  });
});

// ── Pediatrics invariance ────────────────────────────────────────────────────

describe('Pediatrics behavior is unchanged by the OB/GYN work', () => {
  it('keeps its rubric version, totals, closing shape, and survey criterion', () => {
    expect(PEDS.rubricVersion).toBe(QA_RUBRIC_VERSION);
    expect(PEDS.totalPoints).toBe(100);
    expect(PEDS.passThreshold).toBe(85);
    const closing = PEDS.rubric.find((c) => c.id === 'closing');
    expect(closing.criteria.map((c) => c.id)).toEqual(['close-survey', 'close-anything-thanks']);
    expect(closing.criteria.reduce((s, c) => s + c.points, 0)).toBe(5);
  });

  it('keeps empathy and narration always-required for Pediatrics', () => {
    expect(PEDS.criteriaById.get('comm-empathy').core).toBe(true);
    expect(PEDS.criteriaById.get('control-narrate').core).toBe(true);
  });

  it('has no criterion opting into the identity evidence policy', () => {
    expect(PEDS.identityVerificationCriteria).toEqual([]);
  });

  it('scores a Pediatrics response with no structured identity evidence at all', () => {
    const transcript = [
      { role: 'navigator', text: 'Good morning, thank you for calling Aizer Health, this is Dana.' },
    ];
    const criteria = PEDS.criteria.map((c) => ({
      id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '',
    }));
    expect(() => scoreQa(criteria, [], transcript, PEDS)).not.toThrow();
  });
});

// ── Point totals are locked ──────────────────────────────────────────────────

describe('point totals are locked', () => {
  it('OB/GYN totals exactly 100 and closing exactly 5', () => {
    expect(OBGYN.totalPoints).toBe(100);
    expect(OBGYN.rubric.find((c) => c.id === 'closing').criteria
      .reduce((s, c) => s + c.points, 0)).toBe(5);
  });

  it('every configured profile totals exactly 100 at the same 85 pass mark', () => {
    for (const profile of Object.values(QA_RUBRIC_PROFILES)) {
      expect(profile.totalPoints, profile.department).toBe(100);
      expect(profile.passThreshold, profile.department).toBe(85);
    }
  });
});
