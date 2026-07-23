// ─────────────────────────────────────────────────────────────────────────────
// Correction pass #5 — trust-boundary blockers the FIFTH review found.
//
// Every test here was written to FAIL against head `da26baa` and reproduces one
// defect the fifth independent review found by attacking the correction-pass-#4
// enforcement:
//
//   B1  a model OMISSION of the structured identity arrays can still create a
//       false VERIFIED af-hipaa that zeroes a genuinely verified call, because
//       an incomplete canonical identity was treated as PROOF that identity was
//       absent rather than as uncertainty.
//   B2  `verifyIdentifierClaim` discards the verified caller quote (returns the
//       value in its place), so a multi-turn third-party DOB whose OWNERSHIP
//       language lives in the caller's answer ("Her DOB is …") is wrongly
//       rejected.
//   B3  typed field answers are flattened across the whole transcript, so a
//       first name from patient A and a last name from an explicitly-announced
//       second patient B are combined into one fake identity.
//   B4  every token after the first is treated as the surname, so
//       "Maria Elena Alvarez" wrongly yields the surname "Elena Alvarez".
//   B5  a provider FULL-NAME question ("your OB's last name", "the doctor's
//       first and last name") bypasses the provider detector and is treated as a
//       patient-name question.
//   B6  verification verdicts can contradict one another
//       (verify-before-access MET while verify-three NOT_MET).
//
// Pure — no Gemini, no network, no Firestore. Synthetic identities only.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  evaluateIdentityEvidence, resolvePatientSubject, verifyIdentifierClaim,
  classifyPatientNameSpans, splitPersonName,
} from './_qa-identity-verification.js';
import { validateQaResponse, scoreQa, assessQa } from './_qa-rubric.js';
import { QA_RUBRIC_PROFILES } from '../src/data/qaRubricProfiles.js';

const OBGYN = QA_RUBRIC_PROFILES.obgyn;
const nav = (text) => ({ role: 'navigator', text });
const caller = (text) => ({ role: 'caller', text });
const claim = (field, value, turnIndex, quote) => ({ field, value, role: 'caller', turnIndex, quote });

const VALID_IDENTITY = (turnIndex = 1) => [
  claim('firstName', 'Maria', turnIndex, 'this is Maria Alvarez'),
  claim('lastName', 'Alvarez', turnIndex, 'this is Maria Alvarez'),
  claim('dob', 'March 2nd 1991', turnIndex, 'date of birth March 2nd 1991'),
];

const NA_ONLY = new Set(['comm-empathy', 'control-narrate']);

// A nav-turn phrase present in every B1 transcript's greeting, so MET criteria
// verify as navigator evidence (scoreQa only checks the quote is in a nav turn).
const NAV_QUOTE = 'this is Dana';

/**
 * Build a full OB/GYN verdicts array (for scoreQa) with per-id overrides.
 * Non-conditional criteria default to MET so a non-zero score is possible — the
 * B1 tests then prove an af-hipaa did (or did not) ZERO an otherwise-scoring
 * call, rather than a call that scored 0 on its own merits.
 */
function verdicts(overrides = {}) {
  return OBGYN.criteria.map((c) => {
    if (overrides[c.id]) return { id: c.id, note: '', identityEvidence: [], ...overrides[c.id] };
    if (NA_ONLY.has(c.id)) return { id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '', identityEvidence: [] };
    if (OBGYN.identityVerificationCriteria.includes(c.id)) {
      return { id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', note: '', identityEvidence: VALID_IDENTITY() };
    }
    return { id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: NAV_QUOTE, note: '', identityEvidence: [] };
  });
}

/** Build a full OB/GYN raw parsed response (for validateQaResponse). */
function parsed({ overrides = {}, autoFails } = {}) {
  const identityIds = new Set(OBGYN.identityVerificationCriteria);
  const criteria = OBGYN.criteria.map((c) => {
    if (overrides[c.id]) return { id: c.id, evidence: '', note: '', identityEvidence: [], ...overrides[c.id] };
    if (NA_ONLY.has(c.id)) return { id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '', identityEvidence: [] };
    if (identityIds.has(c.id)) {
      return { id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: 'this is Maria Alvarez, date of birth March 2nd 1991', note: '', identityEvidence: VALID_IDENTITY() };
    }
    return { id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: 'You are all set for Tuesday the 14th at 9:00', note: '', identityEvidence: [] };
  });
  return { criteria, autoFails: autoFails ?? OBGYN.autoFails.map((a) => ({ id: a.id, triggered: false, evidence: '', note: '' })) };
}

const afHipaa = (evidence, note = 'shared before verification') => [{ id: 'af-hipaa', evidence, note }];

// ─────────────────────────────────────────────────────────────────────────────
// B1 — a model omission must never create a false VERIFIED af-hipaa
// ─────────────────────────────────────────────────────────────────────────────

describe('B1 · af-hipaa never verifies from an incomplete canonical identity', () => {
  // Caller supplies all three identifiers, THEN the navigator confirms an
  // appointment. The model wrongly returns both identity criteria NOT_MET with
  // EMPTY arrays and triggers af-hipaa on the post-verification quote.
  const verifiedThenDisclose = [
    nav('Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?'),
    caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991. I want to check my appointment.'),
    nav('Thank you. Your appointment is Tuesday at 2:15 with Dr. Reyes.'),
  ];

  it('1 · does not zero a verified call when the model omitted identity arrays', () => {
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', identityEvidence: [] },
      'verify-before-access': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', identityEvidence: [] },
    }), afHipaa('Your appointment is Tuesday at 2:15 with Dr. Reyes.'), verifiedThenDisclose, OBGYN);
    expect(scored.score).not.toBe(0);
    expect(scored.autoFails.map((a) => a.id)).not.toContain('af-hipaa');
    const review = assessQa(scored, verifiedThenDisclose, { profile: OBGYN });
    expect(review.recommendation).toBe('needs_review');
    expect(review.safetyRisk).toBe('critical');
  });

  it('2 · valid identity + post-verification disclosure -> no verified auto-fail', () => {
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: VALID_IDENTITY(1) },
      'verify-before-access': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: VALID_IDENTITY(1) },
    }), afHipaa('Your appointment is Tuesday at 2:15 with Dr. Reyes.'), verifiedThenDisclose, OBGYN);
    expect(scored.autoFails.map((a) => a.id)).not.toContain('af-hipaa');
  });

  it('3 · disclosure BEFORE identity completes -> verified auto-fail may stand', () => {
    const transcript = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana.'),
      nav('Your appointment is Tuesday at 2:15 with Dr. Reyes.'),
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991.'),
    ];
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: VALID_IDENTITY(2) },
      'verify-before-access': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', identityEvidence: VALID_IDENTITY(2) },
    }), afHipaa('Your appointment is Tuesday at 2:15 with Dr. Reyes.'), transcript, OBGYN);
    expect(scored.score).toBe(0);
    expect(scored.autoFails.map((a) => a.id)).toContain('af-hipaa');
  });

  it('4 · omitted arrays on a verified-before-disclosure call -> no zero, review, no false privacy conflict', () => {
    // Superseded by correction pass #6: the server now derives the identity
    // chronology INDEPENDENTLY of the model, so it proves this call verified
    // BEFORE the disclosure. The model-triggered af-hipaa is therefore a plain
    // false positive (surfaced, no zero), NOT a deterministic privacy conflict.
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', identityEvidence: [] },
      'verify-before-access': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', identityEvidence: [] },
    }), afHipaa('Your appointment is Tuesday at 2:15 with Dr. Reyes.'), verifiedThenDisclose, OBGYN);
    expect(scored.score).not.toBe(0);
    expect(scored.autoFails.map((a) => a.id)).not.toContain('af-hipaa');
    expect(scored.unverifiedAutoFails.some((a) => a.id === 'af-hipaa')).toBe(true);
    expect(scored.unverifiedAutoFails.some((a) => a.id === 'af-hipaa' && a.privacyConflict)).toBe(false);
    const review = assessQa(scored, verifiedThenDisclose, { profile: OBGYN });
    expect(review.recommendation).toBe('needs_review');
    expect(review.reviewFlags.some((f) => f.id === 'deterministic-privacy-conflict')).toBe(false);
  });

  it('6 · a NON-disclosure quote never verifies af-hipaa', () => {
    const transcript = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana.'),
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991.'),
      nav('Sure, I can help you with that today.'),
    ];
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: VALID_IDENTITY(1) },
      'verify-before-access': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: VALID_IDENTITY(1) },
    }), afHipaa('Sure, I can help you with that today.'), transcript, OBGYN);
    expect(scored.autoFails.map((a) => a.id)).not.toContain('af-hipaa');
    expect(scored.score).not.toBe(0);
  });

  it('8 · deterministic early-disclosure conflict with model af-hipaa=false -> critical review', () => {
    const transcript = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana.'),
      nav('Your appointment is Tuesday at 2:15 with Dr. Reyes.'),
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991.'),
    ];
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: VALID_IDENTITY(2) },
      'verify-before-access': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: VALID_IDENTITY(2) },
    }), [], transcript, OBGYN);
    expect(scored.score).not.toBe(0);
    expect(scored.unverifiedAutoFails.some((a) => a.id === 'af-hipaa' && a.privacyConflict)).toBe(true);
    const review = assessQa(scored, transcript, { profile: OBGYN });
    expect(review.recommendation).toBe('needs_review');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2 — preserve the verified caller quote for DOB ownership
// ─────────────────────────────────────────────────────────────────────────────

describe('B2 · DOB ownership uses the verified caller quote', () => {
  const thirdPartyGenericQuestion = (dobAnswer) => [
    nav('Thank you for calling Aizer Women\'s Health, this is Dana.'),
    caller('I am calling for my daughter, Maria Alvarez.'),
    nav('And the date of birth?'),
    caller(dobAnswer),
  ];

  const evalDob = (transcript, dobQuote, value = 'March 2, 1991') => evaluateIdentityEvidence(transcript, [
    claim('firstName', 'Maria', 1, 'calling for my daughter, Maria Alvarez'),
    claim('lastName', 'Alvarez', 1, 'calling for my daughter, Maria Alvarez'),
    claim('dob', value, 3, dobQuote),
  ]);

  it('1 · "Her DOB is …" answer to a generic question passes', () => {
    const t = thirdPartyGenericQuestion('Her DOB is March 2, 1991.');
    expect(evalDob(t, 'Her DOB is March 2, 1991').complete).toBe(true);
  });

  it('5 · "the patient\'s DOB is …" answer passes', () => {
    const t = thirdPartyGenericQuestion("The patient's DOB is March 2, 1991.");
    expect(evalDob(t, "The patient's DOB is March 2, 1991").complete).toBe(true);
  });

  it('6 · "Maria\'s date of birth is …" answer passes', () => {
    const t = thirdPartyGenericQuestion("Maria's date of birth is March 2, 1991.");
    expect(evalDob(t, "Maria's date of birth is March 2, 1991").complete).toBe(true);
  });

  it('2 · a bare DOB answer to a generic question on a third-party call fails closed', () => {
    // A third-party caller who gives only a bare DOB to a generic "date of birth?"
    // question is ambiguous — it could be the CALLER's own DOB — so the criterion
    // is withheld and routed to review rather than guessed.
    const t = thirdPartyGenericQuestion('March 2, 1991.');
    expect(evalDob(t, 'March 2, 1991').complete).toBe(false);
  });

  it('7 · phone number plus patient-linked DOB in one turn -> ownership can still pass', () => {
    const t = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana.'),
      caller('I am calling for my daughter, Maria Alvarez.'),
      nav('And the date of birth?'),
      caller("Her DOB is March 2, 1991, and her phone is 555-013-0199."),
    ];
    expect(evalDob(t, 'Her DOB is March 2, 1991').complete).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B3 — typed field answers must belong to ONE patient sequence
// ─────────────────────────────────────────────────────────────────────────────

describe('B3 · typed field answers bound to one patient sequence', () => {
  it('1 · a first name from patient A and a last name from an explicit patient B fail closed', () => {
    const transcript = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana.'),
      nav('May I have the first patient first name?'),
      caller('Maria.'),
      nav('Now for the second patient, what is the last name?'),
      caller('Alvarez.'),
      nav('And the second patient\'s date of birth?'),
      caller('March 2, 1991.'),
    ];
    const subject = resolvePatientSubject(transcript);
    expect(subject.ambiguous).toBe(true);
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 2, 'Maria'),
      claim('lastName', 'Alvarez', 4, 'Alvarez'),
      claim('dob', 'March 2, 1991', 6, 'March 2, 1991'),
    ]);
    expect(result.complete).toBe(false);
  });

  it('10 · one uninterrupted direct-patient first/last/DOB sequence still passes', () => {
    const transcript = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana.'),
      nav('May I have the patient first name?'),
      caller('Maria.'),
      nav('And the last name?'),
      caller('Alvarez.'),
      nav('And the date of birth?'),
      caller('March 2, 1991.'),
    ];
    expect(resolvePatientSubject(transcript).ambiguous).toBe(false);
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 2, 'Maria'),
      claim('lastName', 'Alvarez', 4, 'Alvarez'),
      claim('dob', 'March 2, 1991', 6, 'March 2, 1991'),
    ]);
    expect(result.complete).toBe(true);
  });

  it('14 · candidate audit metadata stores no identifier values', () => {
    const transcript = [
      nav('May I have the patient first name?'),
      caller('Maria.'),
      nav('Now for the other patient, the last name?'),
      caller('Alvarez.'),
    ];
    const subject = resolvePatientSubject(transcript);
    expect(JSON.stringify(subject.candidates ?? [])).not.toMatch(/Maria|Alvarez/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B4 — conservative surname / name-component policy
// ─────────────────────────────────────────────────────────────────────────────

describe('B4 · name-component splitting is conservative', () => {
  it('1 · two tokens -> first / last', () => {
    expect(splitPersonName('Maria Alvarez')).toEqual({ firstName: ['Maria'], lastName: ['Alvarez'] });
  });
  it('2 · hyphenated surname stays whole', () => {
    expect(splitPersonName('Maria Alvarez-Reyes')).toEqual({ firstName: ['Maria'], lastName: ['Alvarez-Reyes'] });
  });
  it('4 · recognized particle surname (de la Cruz)', () => {
    expect(splitPersonName('Maria de la Cruz')).toEqual({ firstName: ['Maria'], lastName: ['de', 'la', 'Cruz'] });
  });
  it('particle surname (del Rio)', () => {
    expect(splitPersonName('Maria del Rio')).toEqual({ firstName: ['Maria'], lastName: ['del', 'Rio'] });
  });
  it('5 · ambiguous three-token name is NOT auto-split', () => {
    expect(splitPersonName('Maria Elena Alvarez')).toBeNull();
  });
  it('6 · four-token name with no particle fails closed', () => {
    expect(splitPersonName('Maria Elena Sofia Alvarez')).toBeNull();
  });

  it('rejects "Elena Alvarez" as the surname of a "Maria Elena Alvarez" designation', () => {
    const transcript = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana.'),
      caller('Hi, this is Maria Elena Alvarez.'),
    ];
    const result = verifyIdentifierClaim(transcript, claim('lastName', 'Elena Alvarez', 1, 'this is Maria Elena Alvarez'));
    expect(result.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B5 — provider full-name questions bypass the provider detector
// ─────────────────────────────────────────────────────────────────────────────

describe('B5 · provider full-name questions are not patient questions', () => {
  const answerAfter = (question, answer) => classifyPatientNameSpans(answer, question);

  it('1 · "the doctor\'s first and last name?" -> not a patient question', () => {
    expect(answerAfter("Can I have the doctor's first and last name?", 'Sarah Smith')).toEqual([]);
  });
  it('3 · "what is your OB\'s last name?" -> not a patient question', () => {
    expect(answerAfter("What is your OB's last name?", 'Reyes')).toEqual([]);
  });
  it('4 · "spell the midwife\'s last name" -> not a patient question', () => {
    expect(answerAfter("Please spell the midwife's last name.", 'Reyes')).toEqual([]);
  });
  it('2 · "provider\'s full name?" -> not a patient question', () => {
    expect(answerAfter("Provider's full name?", 'Sarah Smith')).toEqual([]);
  });

  it('5 · "patient\'s first and last name?" IS a patient question', () => {
    const spans = answerAfter("Patient's first and last name?", 'Maria Alvarez');
    expect(spans.length).toBeGreaterThan(0);
  });
  it('6 · "your first and last name?" on a direct call IS a patient question', () => {
    const spans = answerAfter('What is your first and last name?', 'Maria Alvarez');
    expect(spans.length).toBeGreaterThan(0);
  });

  it('7 · a provider name plus a caller DOB never satisfies patient identity', () => {
    const transcript = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana.'),
      nav("What is your OB's last name?"),
      caller('Reyes. My date of birth is March 2, 1991.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('lastName', 'Reyes', 2, 'Reyes'),
      claim('dob', 'March 2, 1991', 2, 'My date of birth is March 2, 1991'),
    ]);
    expect(result.complete).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B6 — verification verdicts must be logically consistent
// ─────────────────────────────────────────────────────────────────────────────

describe('B6 · cross-criterion verdict consistency', () => {
  it('rejects verify-before-access MET while verify-three NOT_MET (malformed -> retry)', () => {
    const response = parsed({ overrides: {
      'verify-three': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', note: 'not collected', identityEvidence: [] },
      'verify-before-access': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', note: '', identityEvidence: VALID_IDENTITY() },
    } });
    expect(validateQaResponse(response, OBGYN).error).toBeTruthy();
  });

  it('allows verify-three MET while verify-before-access NOT_MET (identity completed after disclosure)', () => {
    const response = parsed({ overrides: {
      'verify-three': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', note: '', identityEvidence: VALID_IDENTITY() },
      'verify-before-access': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', note: 'after disclosure', identityEvidence: [] },
    } });
    expect(validateQaResponse(response, OBGYN).error).toBeFalsy();
  });
});
