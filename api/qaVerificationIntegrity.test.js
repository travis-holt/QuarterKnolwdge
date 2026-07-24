// ─────────────────────────────────────────────────────────────────────────────
// Correction pass #2 — verification-integrity and historical-version blockers.
//
// Every test here was written to FAIL against the previous head (`a43ca7c`) and
// reproduces one defect the second independent review found by probing the real
// trust boundaries rather than the authored happy-path fixtures.
//
//   B1  a safe opening clause suppressed a protected disclosure later in the
//       SAME navigator turn
//   B2  a name-shaped token was accepted as the patient's identifier without
//       any proof it was the PATIENT's name (navigator/provider/staff/relative)
//   B3  a fabricated free-text evidence quote on an identity criterion was
//       persisted and rendered as observed evidence
//   B4  spoken-word DOBs lost verification credit; impossible calendar dates
//       (February 31) were accepted
//   B5  duplicate / unknown / extra criteria and unknown auto-fail ids were
//       silently normalized away instead of tripping the malformed retry
//   B6  `SUPPORTED_CALL_QA_PROMPT_VERSIONS` declared v3 supported while
//       calibration rejected every v3 fixture
//   B7  a metadata-less OB/GYN record resolved to the NEW OB/GYN profile even
//       though pre-versioning records were graded under the shared rubric
//   B8  the "rubric unavailable" UI state trusted a STORED boolean rather than
//       resolving interpretability at render time
//
// Pure — no Gemini, no network, no Firestore. Synthetic identities only.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  classifyProtectedDisclosure, findProtectedDisclosureIndex,
  findProtectedDisclosure, splitDisclosureClauses,
  extractDateOfBirth, evaluateIdentityEvidence,
  evaluateVerificationBeforeAccess, verifyIdentifierClaim,
} from './_qa-identity-verification.js';
import { validateQaResponse, scoreQa, buildGradeProjection } from './_qa-rubric.js';
import { QA_RUBRIC_PROFILES } from '../src/data/qaRubricProfiles.js';
import {
  CALL_QA_PROMPT_VERSION, SUPPORTED_CALL_QA_PROMPT_VERSIONS,
  isSupportedStoredPromptVersion, isCurrentPromptVersion,
} from './_qa-grading-versions.js';
import { profileForGradedAttempt } from '../src/data/qaRubricProfiles.js';
import { resolveQaScoringState, qaDomainScoreSummary } from '../src/lib/qaDomainScoring.js';
import { QA_RUBRIC_VERSION } from '../src/data/qaRubric.js';

const OBGYN = QA_RUBRIC_PROFILES.obgyn;
const PEDS = QA_RUBRIC_PROFILES.pediatrics;

const nav = (text) => ({ role: 'navigator', text });
const caller = (text) => ({ role: 'caller', text });

// ─────────────────────────────────────────────────────────────────────────────
// B1 — compound-turn protected disclosures
// ─────────────────────────────────────────────────────────────────────────────

describe('B1 · protected disclosure is evaluated clause-by-clause', () => {
  it('finds a disclosure after a safe "let me open your chart" clause', () => {
    const turn = 'Let me open your chart. I can see Dr. Smith ordered an ultrasound.';
    expect(classifyProtectedDisclosure(turn)).toBe('order');
  });

  it('finds a disclosure after a safe clause joined by a semicolon', () => {
    const turn = 'Let me check that; I can see an ultrasound order.';
    expect(classifyProtectedDisclosure(turn)).toBe('order');
  });

  it('finds an appointment disclosure after a safe opener', () => {
    const turn = 'Let me open your chart. Your appointment is Tuesday at 2:15.';
    expect(classifyProtectedDisclosure(turn)).toBe('appointment');
  });

  it('finds a medication disclosure after a courtesy hold clause', () => {
    const turn = 'One moment please, your prescription was sent yesterday.';
    expect(classifyProtectedDisclosure(turn)).toBe('medication');
  });

  it('keeps a genuinely safe single-clause turn safe', () => {
    expect(classifyProtectedDisclosure('Let me open your chart.')).toBeNull();
  });

  it('keeps a safe turn joined by a conjunction safe', () => {
    expect(classifyProtectedDisclosure('Let me check that and I will be right back.')).toBeNull();
  });

  it('does not invent a disclosure from punctuation alone', () => {
    expect(classifyProtectedDisclosure('Sure. Okay. One moment.')).toBeNull();
    expect(classifyProtectedDisclosure('...')).toBeNull();
    expect(classifyProtectedDisclosure('Thanks! Bye.')).toBeNull();
  });

  it('reports the turn index, clause index and clause text of the first disclosure', () => {
    const transcript = [
      nav('Thanks for calling Aizer Women\'s Health, this is Dana. How can I help?'),
      caller('I need to check on something.'),
      nav('Let me open your chart. I can see Dr. Smith ordered an ultrasound.'),
    ];
    const found = findProtectedDisclosure(transcript);
    expect(found.turnIndex).toBe(2);
    expect(found.category).toBe('order');
    expect(found.clauseIndex).toBe(1);
    expect(found.clause).toMatch(/ordered an ultrasound/i);
  });

  it('preserves transcript ordering — the earliest matching clause in the earliest turn wins', () => {
    const transcript = [
      nav('Let me check that. Your appointment is Tuesday.'),
      nav('Your results came back normal.'),
    ];
    const found = findProtectedDisclosure(transcript);
    expect(found.turnIndex).toBe(0);
    expect(found.category).toBe('appointment');
  });

  it('splits conservatively without shredding a protected phrase', () => {
    const clauses = splitDisclosureClauses('Let me open your chart; Dr. Smith ordered an ultrasound.');
    expect(clauses).toHaveLength(2);
    expect(clauses[1]).toContain('ordered an ultrasound');
  });

  it('a safe clause does not suppress a later disclosure for the ordering check', () => {
    // Identity is collected AFTER a real disclosure hidden behind a safe opener.
    const transcript = [
      nav('Let me open your chart. I can see Dr. Smith ordered an ultrasound.'),
      caller('This is Maria Alvarez, date of birth March 2, 1991.'),
    ];
    const identityEvidence = [
      { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 1, quote: 'This is Maria Alvarez' },
      { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 1, quote: 'This is Maria Alvarez' },
      { field: 'dob', value: 'March 2, 1991', role: 'caller', turnIndex: 1, quote: 'date of birth March 2, 1991' },
    ];
    const order = evaluateVerificationBeforeAccess(transcript, identityEvidence);
    expect(order.satisfied).toBe(false);
    expect(order.reason).toBe('identifiers-collected-after-disclosure');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2 — names must be proven to belong to the PATIENT identity
// ─────────────────────────────────────────────────────────────────────────────

describe('B2 · name claims must be bound to the patient identity', () => {
  it('rejects the navigator\'s own name as the patient first name', () => {
    const transcript = [
      nav('Thanks for calling Aizer Women\'s Health, this is Dana. How can I help you today?'),
      caller('My date of birth is March 2, 1991.'),
    ];
    const result = verifyIdentifierClaim(transcript, {
      field: 'firstName', value: 'Dana', role: 'navigator', turnIndex: 0,
      quote: 'this is Dana',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-a-patient-identity-context');
  });

  it('rejects a provider surname as the patient last name', () => {
    const transcript = [
      nav('Your appointment is with Dr. Reyes.'),
    ];
    const result = verifyIdentifierClaim(transcript, {
      field: 'lastName', value: 'Reyes', role: 'navigator', turnIndex: 0,
      quote: 'appointment is with Dr. Reyes',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-a-patient-identity-context');
  });

  it('rejects an unrelated name the caller merely mentioned', () => {
    const transcript = [caller('I spoke with Maria yesterday about this.')];
    const result = verifyIdentifierClaim(transcript, {
      field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 0,
      quote: 'I spoke with Maria yesterday',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-a-patient-identity-context');
  });

  it('accepts a caller self-identification', () => {
    const transcript = [caller('Hi, this is Maria Alvarez.')];
    const first = verifyIdentifierClaim(transcript, {
      field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 0, quote: 'this is Maria Alvarez',
    });
    const last = verifyIdentifierClaim(transcript, {
      field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 0, quote: 'this is Maria Alvarez',
    });
    expect(first.ok).toBe(true);
    expect(last.ok).toBe(true);
  });

  it('accepts an authorized third-party caller naming the patient', () => {
    const transcript = [caller('I\'m calling for my daughter, Maria Alvarez.')];
    const first = verifyIdentifierClaim(transcript, {
      field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 0,
      quote: 'calling for my daughter, Maria Alvarez',
    });
    expect(first.ok).toBe(true);
  });

  it('rejects the third-party caller\'s OWN name and accepts the patient\'s', () => {
    const transcript = [caller('My name is Sarah, but the appointment is for Maria Alvarez.')];
    const sarah = verifyIdentifierClaim(transcript, {
      field: 'firstName', value: 'Sarah', role: 'caller', turnIndex: 0,
      quote: 'the appointment is for Maria Alvarez',
    });
    expect(sarah.ok).toBe(false);

    const maria = verifyIdentifierClaim(transcript, {
      field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 0,
      quote: 'the appointment is for Maria Alvarez',
    });
    expect(maria.ok).toBe(true);
  });

  it('accepts an answer to an explicit patient-identity question', () => {
    const transcript = [
      nav('Can I have the patient\'s first and last name?'),
      caller('Maria Alvarez.'),
    ];
    const first = verifyIdentifierClaim(transcript, {
      field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 1, quote: 'Maria Alvarez',
    });
    const last = verifyIdentifierClaim(transcript, {
      field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 1, quote: 'Maria Alvarez',
    });
    expect(first.ok).toBe(true);
    expect(last.ok).toBe(true);
  });

  it('rejects the review\'s fabricated navigator+provider+DOB identity set', () => {
    const transcript = [
      nav('Thanks for calling, this is Dana.'),
      caller('I need Dr. Reyes.'),
      caller('My date of birth is March 2, 1991.'),
    ];
    const identity = evaluateIdentityEvidence(transcript, [
      { field: 'firstName', value: 'Dana', role: 'navigator', turnIndex: 0, quote: 'this is Dana' },
      { field: 'lastName', value: 'Reyes', role: 'caller', turnIndex: 1, quote: 'I need Dr. Reyes' },
      { field: 'dob', value: 'March 2, 1991', role: 'caller', turnIndex: 2, quote: 'date of birth is March 2, 1991' },
    ]);
    expect(identity.complete).toBe(false);
    expect(identity.verified.firstName).toBeUndefined();
    expect(identity.verified.lastName).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B3 — never display unverified identity evidence as a real quote
// ─────────────────────────────────────────────────────────────────────────────

describe('B3 · identity evidence displayed is server-derived, never model prose', () => {
  const transcript = [
    nav('Thanks for calling Aizer Women\'s Health, this is Dana. How can I help you today?'),
    caller('Hi, this is Maria Alvarez, date of birth March 2, 1991.'),
    nav('Thank you. Is there anything else I can help you with?'),
  ];
  const identityEvidence = [
    { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 1, quote: 'this is Maria Alvarez' },
    { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 1, quote: 'this is Maria Alvarez' },
    { field: 'dob', value: 'March 2, 1991', role: 'caller', turnIndex: 1, quote: 'date of birth March 2, 1991' },
  ];

  function scoreOne(evidenceText) {
    const verdicts = OBGYN.criteria.map((c) => (
      c.id === 'verify-three'
        ? {
          id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: evidenceText, note: '',
          identityEvidence,
        }
        : { id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '', identityEvidence: [] }
    ));
    return scoreQa(verdicts, [], transcript, OBGYN);
  }

  it('does not persist a fabricated free-text quote on a VALID identity claim', () => {
    const scored = scoreOne('The patient was fully verified.');
    const criterion = scored.criteria.find((c) => c.id === 'verify-three');
    expect(criterion.verdict).toBe('MET');
    expect(criterion.evidence).not.toContain('The patient was fully verified');
  });

  it('renders a server-derived summary instead of the model quote', () => {
    const scored = scoreOne('The patient was fully verified.');
    scored.review = { recommendation: 'pass', reviewFlags: [] };
    const projection = buildGradeProjection(scored);
    const strength = projection.strengths.find((s) => s.includes('Verification'));
    expect(strength).toBeDefined();
    expect(strength).not.toContain('The patient was fully verified');
    expect(strength).toMatch(/verified/i);
  });

  it('does not copy the date of birth into generic feedback prose', () => {
    const scored = scoreOne('The patient was fully verified.');
    scored.review = { recommendation: 'pass', reviewFlags: [] };
    const projection = buildGradeProjection(scored);
    const text = [projection.summary, ...projection.strengths, ...projection.improvements].join(' ');
    expect(text).not.toContain('March 2, 1991');
    expect(text).not.toContain('Alvarez');
  });

  it('does not render the model quote when the structured claims are INVALID', () => {
    const verdicts = OBGYN.criteria.map((c) => (
      c.id === 'verify-three'
        ? {
          id: c.id, verdict: 'MET', basis: 'EVIDENCE',
          evidence: 'I confirmed her name and date of birth.', note: '',
          identityEvidence: [],
        }
        : { id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '', identityEvidence: [] }
    ));
    const scored = scoreQa(verdicts, [], transcript, OBGYN);
    scored.review = { recommendation: 'needs_review', reviewFlags: [] };
    const criterion = scored.criteria.find((c) => c.id === 'verify-three');
    expect(criterion.verdict).toBe('NOT_MET');
    const projection = buildGradeProjection(scored);
    const text = [...projection.strengths, ...projection.improvements].join(' ');
    expect(text).not.toContain('I confirmed her name and date of birth');
  });

  it('leaves NON-identity criteria on their existing verified-evidence behavior', () => {
    const verdicts = OBGYN.criteria.map((c) => (
      c.id === 'open-name'
        ? { id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: 'this is Dana', note: '', identityEvidence: [] }
        : { id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '', identityEvidence: [] }
    ));
    const scored = scoreQa(verdicts, [], transcript, OBGYN);
    const criterion = scored.criteria.find((c) => c.id === 'open-name');
    expect(criterion.verdict).toBe('MET');
    expect(criterion.evidence).toBe('this is Dana');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B4 — spoken and calendar-valid DOB parsing
// ─────────────────────────────────────────────────────────────────────────────

describe('B4 · date-of-birth parsing', () => {
  const ACCEPT = [
    'March 2, 1991',
    'March 2nd 1991',
    '2 March 1991',
    '03/02/1991',
    '03-02-1991',
    'March second nineteen ninety-one',
    'March the second, nineteen ninety-one',
    'the second of March nineteen ninety-one',
    'March second nineteen ninety one',
    'Feb 29 2004',
    'december thirty first two thousand',
  ];
  it.each(ACCEPT)('accepts %s', (value) => {
    expect(extractDateOfBirth(value)).toBeTruthy();
  });

  const REJECT = [
    ['February 31, 1991', 'impossible day'],
    ['02/31/1991', 'impossible numeric day'],
    ['February 30 1991', 'impossible day'],
    ['April 31, 1990', 'impossible day'],
    ['February 29, 1991', 'non-leap February 29'],
    ['13/02/1991', 'month 13'],
    ['March 0, 1991', 'day zero'],
    ['1991', 'bare year'],
    ['March 2', 'bare month and day'],
    ['555-013-0199', 'phone number'],
    ['(555) 013-0199', 'phone number'],
    ['1425 Willow Street', 'address'],
    ['my phone number is 5550130199', 'phone number'],
    ['nineteen ninety-one', 'bare spoken year'],
    ['March', 'bare month'],
  ];
  it.each(REJECT)('rejects %s (%s)', (value) => {
    expect(extractDateOfBirth(value)).toBeNull();
  });

  it('accepts a leap day in a real leap year and rejects it otherwise', () => {
    expect(extractDateOfBirth('February 29, 2000')).toBeTruthy();
    expect(extractDateOfBirth('February 29, 1900')).toBeNull();
  });

  it('verifies a spoken DOB end to end through a claim', () => {
    const transcript = [caller('This is Maria Alvarez, born March second nineteen ninety-one.')];
    const result = verifyIdentifierClaim(transcript, {
      field: 'dob', value: 'March second nineteen ninety-one', role: 'caller', turnIndex: 0,
      quote: 'born March second nineteen ninety-one',
    });
    expect(result.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B5 — malformed model output is rejected BEFORE normalization
// ─────────────────────────────────────────────────────────────────────────────

describe('B5 · validateQaResponse rejects malformed raw output', () => {
  function wellFormed(profile = OBGYN) {
    return {
      criteria: profile.criteria.map((c) => ({
        id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '',
      })),
      autoFails: profile.autoFails.map((a) => ({
        id: a.id, triggered: false, evidence: '', note: '',
      })),
    };
  }

  it('accepts a well-formed response', () => {
    expect(validateQaResponse(wellFormed(), OBGYN).error).toBeUndefined();
  });

  it('rejects a duplicate criterion id', () => {
    const parsed = wellFormed();
    parsed.criteria.push({ ...parsed.criteria[0], verdict: 'MET', basis: 'EVIDENCE', evidence: 'x y' });
    expect(validateQaResponse(parsed, OBGYN).error).toMatch(/duplicate/i);
  });

  it('rejects an unknown criterion id', () => {
    const parsed = wellFormed();
    parsed.criteria.push({ id: 'close-survey', verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '' });
    expect(validateQaResponse(parsed, OBGYN).error).toMatch(/unknown criterion/i);
  });

  it('rejects a missing criterion id', () => {
    const parsed = wellFormed();
    parsed.criteria.pop();
    expect(validateQaResponse(parsed, OBGYN).error).toMatch(/missing/i);
  });

  it('rejects a non-object criterion entry instead of skipping it', () => {
    const parsed = wellFormed();
    parsed.criteria.push('not-an-object');
    expect(validateQaResponse(parsed, OBGYN).error).toBeTruthy();
  });

  it('rejects a criterion with a non-string id instead of skipping it', () => {
    const parsed = wellFormed();
    parsed.criteria.push({ id: 42, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '' });
    expect(validateQaResponse(parsed, OBGYN).error).toBeTruthy();
  });

  it('rejects an invalid verdict instead of skipping it', () => {
    const parsed = wellFormed();
    parsed.criteria[0].verdict = 'MAYBE';
    expect(validateQaResponse(parsed, OBGYN).error).toMatch(/verdict/i);
  });

  it('rejects an invalid basis', () => {
    const parsed = wellFormed();
    parsed.criteria[0].basis = 'VIBES';
    expect(validateQaResponse(parsed, OBGYN).error).toMatch(/basis/i);
  });

  it('rejects an unknown auto-fail id instead of filtering it away', () => {
    const parsed = wellFormed();
    parsed.autoFails.push({ id: 'af-invented', triggered: false, evidence: '', note: '' });
    expect(validateQaResponse(parsed, OBGYN).error).toMatch(/auto-fail/i);
  });

  it('rejects a duplicate auto-fail id', () => {
    const parsed = wellFormed();
    parsed.autoFails.push({ ...parsed.autoFails[0] });
    expect(validateQaResponse(parsed, OBGYN).error).toMatch(/duplicate/i);
  });

  it('rejects a missing auto-fail id', () => {
    const parsed = wellFormed();
    parsed.autoFails.pop();
    expect(validateQaResponse(parsed, OBGYN).error).toMatch(/auto-fail/i);
  });

  it('rejects a malformed triggered flag', () => {
    const parsed = wellFormed();
    parsed.autoFails[0].triggered = 'yes';
    expect(validateQaResponse(parsed, OBGYN).error).toMatch(/triggered/i);
  });

  it('rejects a triggered auto-fail with no evidence', () => {
    const parsed = wellFormed();
    parsed.autoFails[0].triggered = true;
    parsed.autoFails[0].evidence = '';
    expect(validateQaResponse(parsed, OBGYN).error).toBeTruthy();
  });

  it('rejects identity evidence on a criterion with no identity policy', () => {
    const parsed = wellFormed();
    const target = parsed.criteria.find((c) => c.id === 'open-name');
    target.identityEvidence = [
      { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 0, quote: 'this is Maria' },
    ];
    expect(validateQaResponse(parsed, OBGYN).error).toMatch(/identity/i);
  });

  it('rejects a malformed identity claim on an identity criterion', () => {
    const parsed = wellFormed();
    const target = parsed.criteria.find((c) => c.id === 'verify-three');
    target.identityEvidence = [{ field: 'firstName' }];
    expect(validateQaResponse(parsed, OBGYN).error).toMatch(/identity/i);
  });

  it('rejects a criteria array with one valid and one silently skippable invalid object', () => {
    const parsed = wellFormed();
    parsed.criteria.push({ verdict: 'MET' });
    expect(validateQaResponse(parsed, OBGYN).error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B6 — prompt-version support must be truthful
// ─────────────────────────────────────────────────────────────────────────────

describe('B6 · prompt-version support policy', () => {
  it('recognizes every declared stored version', () => {
    for (const version of SUPPORTED_CALL_QA_PROMPT_VERSIONS) {
      expect(isSupportedStoredPromptVersion(version)).toBe(true);
    }
  });

  it('recognizes the current version as current', () => {
    expect(isCurrentPromptVersion(CALL_QA_PROMPT_VERSION)).toBe(true);
  });

  it('does not treat an older supported version as current', () => {
    const older = SUPPORTED_CALL_QA_PROMPT_VERSIONS.filter((v) => v !== CALL_QA_PROMPT_VERSION);
    expect(older.length).toBeGreaterThan(0);
    for (const version of older) {
      expect(isSupportedStoredPromptVersion(version)).toBe(true);
      expect(isCurrentPromptVersion(version)).toBe(false);
    }
  });

  it('fails closed on an unknown version', () => {
    expect(isSupportedStoredPromptVersion('call-qa-grader-v99')).toBe(false);
    expect(isCurrentPromptVersion('call-qa-grader-v99')).toBe(false);
    expect(isSupportedStoredPromptVersion('')).toBe(false);
    expect(isSupportedStoredPromptVersion(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B7 — metadata-less history uses the HISTORICAL shared rubric
// ─────────────────────────────────────────────────────────────────────────────

describe('B7 · metadata-less historical results use the historical shared rubric', () => {
  it('resolves a metadata-less OB/GYN record to the shared rubric, not the OB/GYN profile', () => {
    const profile = profileForGradedAttempt({}, 'obgyn');
    expect(profile.rubricVersion).toBe(QA_RUBRIC_VERSION);
    expect(profile.rubricVersion).not.toBe(OBGYN.rubricVersion);
  });

  it('resolves a metadata-less Pediatrics record to the shared rubric', () => {
    expect(profileForGradedAttempt({}, 'pediatrics').rubricVersion).toBe(QA_RUBRIC_VERSION);
  });

  it('resolves a metadata-less record from an unknown department to the shared rubric', () => {
    expect(profileForGradedAttempt({}, 'adultmed').rubricVersion).toBe(QA_RUBRIC_VERSION);
    expect(profileForGradedAttempt(undefined, undefined).rubricVersion).toBe(QA_RUBRIC_VERSION);
  });

  it('still resolves a KNOWN recorded OB/GYN version to the OB/GYN profile', () => {
    const profile = profileForGradedAttempt(
      { rubricVersion: OBGYN.rubricVersion, rubricDepartment: 'obgyn' }, 'obgyn',
    );
    expect(profile).toBe(OBGYN);
  });

  it('still returns null for an unknown recorded version', () => {
    expect(profileForGradedAttempt({ rubricVersion: 'qa-rubric-future-v9' }, 'obgyn')).toBeNull();
  });

  it('projects metadata-less OB/GYN history with the OLD closing ids under the shared rubric', () => {
    const qa = {
      rubricDepartment: 'obgyn',
      criteria: [
        { id: 'close-survey', verdict: 'MET' },
        { id: 'close-anything-thanks', verdict: 'MET' },
      ],
      autoFails: [],
    };
    const summary = qaDomainScoreSummary(qa);
    expect(summary.scoringUnavailable).toBeFalsy();
    expect(summary.domainScores).toBeTruthy();
  });

  it('never gives a metadata-less record the OB/GYN close-offer-help criterion', () => {
    const profile = profileForGradedAttempt({}, 'obgyn');
    expect(profile.criterionIds.has('close-offer-help')).toBe(false);
    expect(profile.criterionIds.has('close-survey')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B8 — unknown rubric state is resolved at render time
// ─────────────────────────────────────────────────────────────────────────────

describe('B8 · QA scoring state is resolved at render time, not read from a stored flag', () => {
  it('withholds projections for an unknown version even with stale stored domainScores', () => {
    const state = resolveQaScoringState({
      gradingMetadata: { rubricVersion: 'qa-rubric-future-v9', rubricDepartment: 'obgyn' },
      domainScores: { intake: { score: 90 } },
    });
    expect(state.scoringUnavailable).toBe(true);
    expect(state.profile).toBeNull();
    expect(state.reason).toBe('unknown-rubric-version');
    expect(state.recordedRubricVersion).toBe('qa-rubric-future-v9');
  });

  it('ignores a stored scoringUnavailable:false on an unknown version', () => {
    const state = resolveQaScoringState({
      gradingMetadata: { rubricVersion: 'qa-rubric-future-v9' },
      scoringUnavailable: false,
      domainScores: { intake: { score: 90 } },
    });
    expect(state.scoringUnavailable).toBe(true);
  });

  it('does not let a stored scoringUnavailable:true override a resolvable version', () => {
    const state = resolveQaScoringState({
      gradingMetadata: { rubricVersion: OBGYN.rubricVersion, rubricDepartment: 'obgyn' },
      scoringUnavailable: true,
    });
    expect(state.scoringUnavailable).toBe(false);
    expect(state.profile).toBe(OBGYN);
  });

  it('renders a known OB/GYN version normally', () => {
    const state = resolveQaScoringState({
      gradingMetadata: { rubricVersion: OBGYN.rubricVersion, rubricDepartment: 'obgyn' },
    });
    expect(state.scoringUnavailable).toBe(false);
    expect(state.profile).toBe(OBGYN);
  });

  it('renders metadata-less history under the shared rubric', () => {
    const state = resolveQaScoringState({ rubricDepartment: 'obgyn' });
    expect(state.scoringUnavailable).toBe(false);
    expect(state.profile).toBe(PEDS);
  });

  it('reports unavailable for a mismatched department/version pair', () => {
    const state = resolveQaScoringState({
      gradingMetadata: { rubricVersion: OBGYN.rubricVersion, rubricDepartment: 'pediatrics' },
    });
    expect(state.scoringUnavailable).toBe(true);
    expect(state.profile).toBeNull();
  });

  it('does not crash on absent QA metadata', () => {
    expect(() => resolveQaScoringState(undefined)).not.toThrow();
    expect(() => resolveQaScoringState(null)).not.toThrow();
    expect(resolveQaScoringState({}).scoringUnavailable).toBe(false);
  });
});
