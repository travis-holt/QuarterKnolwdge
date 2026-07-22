// ─────────────────────────────────────────────────────────────────────────────
// Correction pass #6 — trust-boundary blockers the SIXTH review found.
//
// Each test encodes a defect the sixth independent review found against head
// `9c2da51` and asserts the corrected behavior:
//
//   B1  af-hipaa still trusted the MODEL-SELECTED identity occurrence, so a model
//       that submitted only a LATER repetition of an identity could make the
//       server believe verification happened after a disclosure and false-zero a
//       call that was actually verified BEFORE it.
//   B2  af-hipaa/disclosure could be verified from NEGATED / refusal wording or a
//       detached fragment; the containing clause and its refusal context were not
//       classified, and the quote was not required to map uniquely or overlap.
//   B3  identity claims were bound via one global token Set, so a first name from
//       patient A and a last name from an explicitly-switched patient B combined.
//   B4  DOB ownership used the FIRST identical date in the turn, not the exact
//       occurrence contained in the verified quote.
//   B5  lowercase surname particles were dropped from designations before
//       splitPersonName ran ("Maria de la Cruz" -> "Maria Cruz").
//   B6  provider-name detection missed OB-GYN / obstetrician and the "name of the
//       <provider>" grammatical direction.
//   B7  only ONE identity contradiction was rejected; others (complete array +
//       NOT_MET, server-satisfied order + NOT_MET) silently deducted points.
//
// Pure — no Gemini, no network, no Firestore. Synthetic identities only.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  evaluateIdentityEvidence, resolvePatientSubject, verifyIdentifierClaim,
  classifyPatientNameSpans, classifyProtectedDisclosure, classifyAfHipaaEvidence,
  earliestCompleteIdentity, resolveIdentityCandidates,
} from './_qa-identity-verification.js';
import { validateQaResponse, scoreQa, assessQa } from './_qa-rubric.js';
import { QA_RUBRIC_PROFILES } from '../src/data/qaRubricProfiles.js';

const OBGYN = QA_RUBRIC_PROFILES.obgyn;
const nav = (text) => ({ role: 'navigator', text });
const caller = (text) => ({ role: 'caller', text });
const claim = (field, value, turnIndex, quote) => ({ field, value, role: 'caller', turnIndex, quote });
const GREET = 'Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?';
const NAV_QUOTE = 'this is Dana';

const identityAt = (turnIndex, quote = 'this is Maria Alvarez', dobQuote = 'date of birth March 2nd 1991') => [
  claim('firstName', 'Maria', turnIndex, quote),
  claim('lastName', 'Alvarez', turnIndex, quote),
  claim('dob', 'March 2nd 1991', turnIndex, dobQuote),
];

function verdicts(overrides = {}) {
  return OBGYN.criteria.map((c) => {
    if (overrides[c.id]) return { id: c.id, note: '', identityEvidence: [], ...overrides[c.id] };
    if (['comm-empathy', 'control-narrate'].includes(c.id)) return { id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '', identityEvidence: [] };
    if (OBGYN.identityVerificationCriteria.includes(c.id)) return { id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', note: '', identityEvidence: identityAt(1) };
    return { id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: NAV_QUOTE, note: '', identityEvidence: [] };
  });
}
const afHipaa = (evidence) => [{ id: 'af-hipaa', evidence, note: 'shared before verification' }];

// ─────────────────────────────────────────────────────────────────────────────
// B1 — independent earliest-identity chronology drives af-hipaa
// ─────────────────────────────────────────────────────────────────────────────

describe('B1 · af-hipaa uses an independent earliest chronology', () => {
  it('1 · identity before disclosure, repeated after, model selects the later -> no zero', () => {
    const transcript = [
      nav(GREET),
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991. Can you check my appointment?'),
      nav('Your appointment is Tuesday at 2:15 with Dr. Reyes.'),
      caller('Thanks. Just to confirm, this is Maria Alvarez, date of birth March 2nd 1991.'),
    ];
    // Server-independent chronology proves identity complete at turn 1.
    expect(earliestCompleteIdentity(transcript).earliestIndex).toBe(1);
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: identityAt(3) },
      'verify-before-access': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', identityEvidence: [] },
    }), afHipaa('Your appointment is Tuesday at 2:15 with Dr. Reyes.'), transcript, OBGYN);
    expect(scored.score).not.toBe(0);
    expect(scored.autoFails.map((a) => a.id)).not.toContain('af-hipaa');
    const review = assessQa(scored, transcript, { profile: OBGYN });
    expect(review.recommendation).toBe('needs_review');
  });

  it('2 · identity only after disclosure -> verified af-hipaa may stand', () => {
    const transcript = [
      nav(GREET),
      nav('Your appointment is Tuesday at 2:15 with Dr. Reyes.'),
      caller('Oh thanks. This is Maria Alvarez, date of birth March 2nd 1991.'),
    ];
    expect(earliestCompleteIdentity(transcript).earliestIndex).toBe(2);
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: identityAt(2) },
      'verify-before-access': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', identityEvidence: [] },
    }), afHipaa('Your appointment is Tuesday at 2:15 with Dr. Reyes.'), transcript, OBGYN);
    expect(scored.score).toBe(0);
    expect(scored.autoFails.map((a) => a.id)).toContain('af-hipaa');
  });

  it('3 · identity before disclosure, no repetition -> no af-hipaa', () => {
    const transcript = [
      nav(GREET),
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991.'),
      nav('Your appointment is Tuesday at 2:15 with Dr. Reyes.'),
    ];
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: identityAt(1) },
      'verify-before-access': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: identityAt(1) },
    }), afHipaa('Your appointment is Tuesday at 2:15 with Dr. Reyes.'), transcript, OBGYN);
    expect(scored.autoFails.map((a) => a.id)).not.toContain('af-hipaa');
    expect(scored.score).not.toBe(0);
  });

  it('4 · identity occurrence omitted by the model -> review, not zero', () => {
    // Same transcript as (1) but the model omits the early identity entirely.
    const transcript = [
      nav(GREET),
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991. Can you check my appointment?'),
      nav('Your appointment is Tuesday at 2:15 with Dr. Reyes.'),
      caller('Thanks. Just to confirm, this is Maria Alvarez, date of birth March 2nd 1991.'),
    ];
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', identityEvidence: [] },
      'verify-before-access': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', identityEvidence: [] },
    }), afHipaa('Your appointment is Tuesday at 2:15 with Dr. Reyes.'), transcript, OBGYN);
    expect(scored.score).not.toBe(0);
    expect(scored.autoFails.map((a) => a.id)).not.toContain('af-hipaa');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2 — negation / refusal / detached-fragment safety
// ─────────────────────────────────────────────────────────────────────────────

describe('B2 · refusals and detached fragments never verify a disclosure', () => {
  it('1 · "I cannot confirm whether your appointment is Tuesday until I verify you" is NOT a disclosure', () => {
    expect(classifyProtectedDisclosure('I cannot confirm whether your appointment is Tuesday until I verify you.')).toBeNull();
  });
  it('2 · "I cannot confirm anything yet, but your appointment is Tuesday" IS a disclosure', () => {
    expect(classifyProtectedDisclosure('I cannot confirm anything yet, but your appointment is Tuesday.')).toBe('appointment');
  });
  it('3 · "I cannot tell you whether the result is normal" is NOT a disclosure', () => {
    expect(classifyProtectedDisclosure('I cannot tell you whether the result is normal.')).toBeNull();
  });
  it('4 · "I cannot interpret it, but your result is positive" IS a disclosure', () => {
    expect(classifyProtectedDisclosure('I cannot interpret it, but your result is positive.')).toBe('results');
  });

  const verifiedTranscript = (navLine) => [
    nav(GREET),
    caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991.'),
    nav(navLine),
  ];

  it('5 · a quote of only the unsafe substring from a safe refusal never verifies af-hipaa', () => {
    const t = verifiedTranscript('I cannot confirm whether your appointment is Tuesday until I verify you.');
    const ev = classifyAfHipaaEvidence(t, 'your appointment is Tuesday');
    expect(ev.verified).toBe(false);
  });

  it('6 · a quote that maps to more than one navigator turn is ambiguous', () => {
    const t = [
      nav(GREET),
      nav('Your appointment is Tuesday.'),
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991.'),
      nav('Your appointment is Tuesday.'),
    ];
    const ev = classifyAfHipaaEvidence(t, 'Your appointment is Tuesday.');
    expect(ev.ambiguous).toBe(true);
    expect(ev.verified).toBe(false);
  });

  it('7 · a quote that does not overlap the disclosure span never verifies af-hipaa', () => {
    const t = verifiedTranscript('I can see your appointment is Tuesday at 2:15 with Dr. Reyes.');
    const ev = classifyAfHipaaEvidence(t, 'with Dr. Reyes');
    expect(ev.verified).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B3 — identity claims bind to ONE discrete candidate
// ─────────────────────────────────────────────────────────────────────────────

describe('B3 · one-candidate binding', () => {
  it('1 · firstName from patient A + lastName/DOB after an explicit switch to B fails closed', () => {
    const transcript = [
      nav(GREET),
      caller('I am calling for my daughter Maria Smith.'),
      nav('Now for my other daughter, what is the last name?'),
      caller('Alvarez.'),
      nav('And her date of birth?'),
      caller('March 2, 1991.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 1, 'my daughter Maria Smith'),
      claim('lastName', 'Alvarez', 3, 'Alvarez'),
      claim('dob', 'March 2, 1991', 5, 'March 2, 1991'),
    ]);
    expect(result.complete).toBe(false);
  });

  it('4 · same full name, different subject context (caller vs daughter) fails closed', () => {
    const transcript = [
      nav(GREET),
      caller('My name is Maria Alvarez, date of birth March 2, 1980.'),
      nav('And who is the appointment for?'),
      caller('I am calling for my daughter Maria Alvarez.'),
    ];
    expect(resolvePatientSubject(transcript).ambiguous).toBe(true);
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 3, 'my daughter Maria Alvarez'),
      claim('lastName', 'Alvarez', 3, 'my daughter Maria Alvarez'),
      claim('dob', 'March 2, 1980', 1, 'date of birth March 2, 1980'),
    ]);
    expect(result.complete).toBe(false);
  });

  it('6 · two children handled sequentially fails closed', () => {
    const transcript = [
      nav(GREET),
      caller('I am calling for my daughter Maria Smith.'),
      nav('And regarding the other child?'),
      caller('My other daughter, Jane Alvarez.'),
    ];
    expect(resolvePatientSubject(transcript).ambiguous).toBe(true);
  });

  it('10 · one uninterrupted third-party sequence still passes', () => {
    const transcript = [
      nav(GREET),
      caller('I am calling for my daughter, Maria Alvarez. Her date of birth is March 2, 2021.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 1, 'my daughter, Maria Alvarez'),
      claim('lastName', 'Alvarez', 1, 'my daughter, Maria Alvarez'),
      claim('dob', 'March 2, 2021', 1, 'date of birth is March 2, 2021'),
    ]);
    expect(result.complete).toBe(true);
  });

  it('14 · candidate audit metadata carries no identifier values', () => {
    const transcript = [
      nav('First name?'), caller('Maria.'),
      nav('Now for the other patient, the last name?'), caller('Alvarez.'),
    ];
    const { candidates } = resolveIdentityCandidates(transcript);
    const auditView = candidates.map((c) => ({ id: c.id, sequenceId: c.sequenceId, subjectType: c.subjectType, designationTurn: c.designationTurn, anchored: c.anchored }));
    expect(JSON.stringify(auditView)).not.toMatch(/Maria|Alvarez/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B4 — exact DOB occurrence
// ─────────────────────────────────────────────────────────────────────────────

describe('B4 · DOB ownership uses the exact quoted occurrence', () => {
  it('2 · caller DOB and patient DOB identical in one turn; patient-linked quote passes', () => {
    const transcript = [
      nav(GREET),
      caller('I am calling for my daughter, Maria Alvarez.'),
      nav('And the date of birth?'),
      caller('My DOB is March 2, 1991, and her DOB is March 2, 1991.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 1, 'my daughter, Maria Alvarez'),
      claim('lastName', 'Alvarez', 1, 'my daughter, Maria Alvarez'),
      claim('dob', 'March 2, 1991', 3, 'her DOB is March 2, 1991'),
    ]);
    expect(result.complete).toBe(true);
  });

  it('6 · a duplicate identical quote occurring twice fails closed', () => {
    const transcript = [
      nav(GREET),
      caller('I am calling for my daughter, Maria Alvarez.'),
      nav('And the date of birth?'),
      caller('March 2, 1991. Sorry — March 2, 1991.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 1, 'my daughter, Maria Alvarez'),
      claim('lastName', 'Alvarez', 1, 'my daughter, Maria Alvarez'),
      claim('dob', 'March 2, 1991', 3, 'March 2, 1991'),
    ]);
    expect(result.complete).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B5 — lowercase surname particles survive in designations
// ─────────────────────────────────────────────────────────────────────────────

describe('B5 · surname particles preserved through the pipeline', () => {
  it('1 · "This is Maria de la Cruz" verifies the surname "de la Cruz"', () => {
    const transcript = [
      nav(GREET),
      caller('This is Maria de la Cruz, date of birth March 2nd 1991.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 1, 'this is Maria de la Cruz'),
      claim('lastName', 'de la Cruz', 1, 'this is Maria de la Cruz'),
      claim('dob', 'March 2nd 1991', 1, 'date of birth March 2nd 1991'),
    ]);
    expect(result.complete).toBe(true);
  });

  it('7 · ordinary lowercase prose is still rejected as a name', () => {
    expect(classifyPatientNameSpans('I am really scared about this', GREET)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B6 — provider-name question coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('B6 · provider-name questions in both directions', () => {
  const answerAfter = (question, answer) => classifyPatientNameSpans(answer, question);
  it('1 · "OB-GYN\'s last name?" -> not a patient question', () => {
    expect(answerAfter("What is your OB-GYN's last name?", 'Reyes')).toEqual([]);
  });
  it('3 · "first and last name of your doctor?" -> not a patient question', () => {
    expect(answerAfter('Can I get the first and last name of your doctor?', 'Sarah Smith')).toEqual([]);
  });
  it('4 · "full name of the provider?" -> not a patient question', () => {
    expect(answerAfter('What is the full name of the provider?', 'Sarah Smith')).toEqual([]);
  });
  it('5 · "last name of your obstetrician?" -> not a patient question', () => {
    expect(answerAfter('And the last name of your obstetrician?', 'Reyes')).toEqual([]);
  });
  it('6 · "name of the midwife?" -> not a patient question', () => {
    expect(answerAfter('What is the name of the midwife?', 'Reyes')).toEqual([]);
  });
  it('7 · "patient\'s first and last name?" is still a patient question', () => {
    expect(answerAfter("Patient's first and last name?", 'Maria Alvarez').length).toBeGreaterThan(0);
  });
  it('9 · a clinician-name answer plus a caller DOB never completes patient identity', () => {
    const transcript = [
      nav(GREET),
      nav('What is the last name of your obstetrician?'),
      caller('Reyes. And my date of birth is March 2, 1991.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('lastName', 'Reyes', 2, 'Reyes'),
      claim('dob', 'March 2, 1991', 2, 'my date of birth is March 2, 1991'),
    ]);
    expect(result.complete).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B7 — bidirectional identity-verdict consistency
// ─────────────────────────────────────────────────────────────────────────────

describe('B7 · identity verdict contradictions are reconciled, never silently deducted', () => {
  const verifiedTranscript = [
    nav(GREET),
    caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991. I would like to book my annual.'),
    nav('I can book that for you. Is there anything else I can help you with?'),
  ];

  it('A · verify-three NOT_MET with a server-valid complete array -> credited + review', () => {
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', identityEvidence: identityAt(1) },
      'verify-before-access': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: identityAt(1) },
    }), [], verifiedTranscript, OBGYN);
    const vt = scored.criteria.find((c) => c.id === 'verify-three');
    expect(vt.verdict).toBe('MET');
    expect(vt.unresolved).toBe(true);
    const review = assessQa(scored, verifiedTranscript, { profile: OBGYN });
    expect(review.recommendation).toBe('needs_review');
    expect(review.reviewFlags.some((f) => f.id === 'identity-verdict-contradiction')).toBe(true);
  });

  it('B · no disclosure occurred, but verify-before-access NOT_MET -> reconciled to review', () => {
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: identityAt(1) },
      'verify-before-access': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', identityEvidence: [] },
    }), [], verifiedTranscript, OBGYN);
    const vba = scored.criteria.find((c) => c.id === 'verify-before-access');
    expect(vba.verdict).toBe('MET');
    expect(vba.unresolved).toBe(true);
  });

  it('8 · a malformed model verdict never produces a silent navigator deduction', () => {
    // verify-before-access MET while verify-three NOT_MET is impossible -> retry.
    const parsed = {
      criteria: OBGYN.criteria.map((c) => {
        if (['comm-empathy', 'control-narrate'].includes(c.id)) return { id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '', identityEvidence: [] };
        if (c.id === 'verify-three') return { id: c.id, verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', note: 'x', identityEvidence: [] };
        if (c.id === 'verify-before-access') return { id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', note: '', identityEvidence: identityAt(1) };
        return { id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', note: '', identityEvidence: [] };
      }),
      autoFails: OBGYN.autoFails.map((a) => ({ id: a.id, triggered: false, evidence: '', note: '' })),
    };
    expect(validateQaResponse(parsed, OBGYN).error).toBeTruthy();
  });
});
