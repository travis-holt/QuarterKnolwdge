// ─────────────────────────────────────────────────────────────────────────────
// Correction pass #3 — verification-integrity blockers the THIRD review found.
//
// Every test here was written to FAIL against head `c85c875` and reproduces one
// defect the third independent review found by attacking the new trust
// boundaries:
//
//   B1  the three identifiers are not bound to ONE patient identity — a caller's
//       own DOB could pair with a different patient's name, or first/last could
//       come from two different people
//   B2  the name-ownership regexes accept ordinary English ("about my refill",
//       "an appointment", "next Tuesday", a provider-question answer) as a name
//   B3  a normal one-word name answer ("First name?" / "Maria.") is rejected
//   B4  the v5 prompt/schema/server contradict on evidence role (navigator vs
//       caller); the schema advertises a role the server always rejects
//   B5  an identity criterion marked MET with a missing/empty structured payload
//       becomes a navigator deduction instead of a malformed-response retry
//   B6  a safe prefix still suppresses a protected disclosure inside ONE clause
//       ("Okay your labs are normal.")
//   B7  raw criterion evidence/note of the wrong type is coerced to "" instead of
//       rejected
//
// Pure — no Gemini, no network, no Firestore. Synthetic identities only.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  classifyProtectedDisclosure,
  evaluateIdentityEvidence, patientNameSpans, resolvePatientSubject,
} from './_qa-identity-verification.js';
import { validateQaResponse, scoreQa } from './_qa-rubric.js';
import { evidenceRoleRules, RESPONSE_SCHEMA, CALL_QA_PROMPT_VERSION } from './grade-call-qa.js';
import { QA_RUBRIC_PROFILES } from '../src/data/qaRubricProfiles.js';

const OBGYN = QA_RUBRIC_PROFILES.obgyn;
const nav = (text) => ({ role: 'navigator', text });
const caller = (text) => ({ role: 'caller', text });
const claim = (field, value, role, turnIndex, quote) => ({ field, value, role, turnIndex, quote });

// Score a single identity criterion the way the pipeline does.
const scoreVerification = (transcript, identityEvidence, criterionId = 'verify-three') => {
  const criteria = OBGYN.criteria.map((c) => ({
    id: c.id,
    verdict: c.id === criterionId ? 'MET' : 'NA',
    basis: c.id === criterionId ? 'EVIDENCE' : 'ABSENCE',
    evidence: c.id === criterionId ? 'placeholder quote' : '',
    note: '',
    identityEvidence: c.id === criterionId ? identityEvidence : [],
  }));
  return scoreQa(criteria, [], transcript, OBGYN).criteria.find((c) => c.id === criterionId);
};

// ─────────────────────────────────────────────────────────────────────────────
// B1 — one patient identity
// ─────────────────────────────────────────────────────────────────────────────

describe('B1 · all three identifiers must belong to ONE patient', () => {
  it("rejects a caller's own DOB paired with a DIFFERENT patient's name", () => {
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana. How can I help?'),
      caller('My name is Sarah Jones, date of birth March 2, 1991, but the appointment is for Maria Alvarez.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 'caller', 1, 'the appointment is for Maria Alvarez'),
      claim('lastName', 'Alvarez', 'caller', 1, 'the appointment is for Maria Alvarez'),
      claim('dob', 'March 2, 1991', 'caller', 1, 'My name is Sarah Jones, date of birth March 2, 1991'),
    ]);
    expect(result.complete).toBe(false);
  });

  it('rejects first and last name assembled from two different patients', () => {
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana.'),
      caller('I am calling for Maria Smith and my daughter Jane Alvarez.'),
      nav('And a date of birth?'),
      caller('March 2, 1991.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 'caller', 1, 'calling for Maria Smith'),
      claim('lastName', 'Alvarez', 'caller', 1, 'my daughter Jane Alvarez'),
      claim('dob', 'March 2, 1991', 'caller', 3, 'March 2, 1991'),
    ]);
    expect(result.complete).toBe(false);
  });

  it('accepts a third-party caller giving the patient name and DOB', () => {
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana.'),
      caller("I'm calling for my daughter, Maria Alvarez. Her date of birth is March 2, 2021."),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 'caller', 1, "calling for my daughter, Maria Alvarez"),
      claim('lastName', 'Alvarez', 'caller', 1, "calling for my daughter, Maria Alvarez"),
      claim('dob', 'March 2, 2021', 'caller', 1, 'Her date of birth is March 2, 2021'),
    ]);
    expect(result.complete).toBe(true);
    expect(result.subjectConsistent).toBe(true);
  });

  it('produces a value-free canonical audit record', () => {
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana.'),
      caller('Hi, this is Maria Alvarez, date of birth March 2, 1991.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 'caller', 1, 'this is Maria Alvarez, date of birth March 2, 1991'),
      claim('lastName', 'Alvarez', 'caller', 1, 'this is Maria Alvarez, date of birth March 2, 1991'),
      claim('dob', 'March 2, 1991', 'caller', 1, 'this is Maria Alvarez, date of birth March 2, 1991'),
    ]);
    expect(result.complete).toBe(true);
    const audit = JSON.stringify(result.audit ?? {});
    expect(audit).not.toMatch(/Maria|Alvarez|1991/);
    expect(result.audit.completedAtTurn).toBe(1);
    expect(result.audit.subjectConsistent).toBe(true);
  });

  it('the two verification criteria cannot be credited from different arrays', () => {
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana.'),
      caller('Hi, this is Maria Alvarez, date of birth March 2, 1991.'),
    ];
    const good = [
      claim('firstName', 'Maria', 'caller', 1, 'this is Maria Alvarez, date of birth March 2, 1991'),
      claim('lastName', 'Alvarez', 'caller', 1, 'this is Maria Alvarez, date of birth March 2, 1991'),
      claim('dob', 'March 2, 1991', 'caller', 1, 'this is Maria Alvarez, date of birth March 2, 1991'),
    ];
    const other = [
      claim('firstName', 'Alvarez', 'caller', 1, 'this is Maria Alvarez, date of birth March 2, 1991'),
      claim('lastName', 'Maria', 'caller', 1, 'this is Maria Alvarez, date of birth March 2, 1991'),
      claim('dob', 'March 2, 1991', 'caller', 1, 'this is Maria Alvarez, date of birth March 2, 1991'),
    ];
    const criteria = OBGYN.criteria.map((c) => ({
      id: c.id,
      verdict: c.id === 'verify-three' || c.id === 'verify-before-access' ? 'MET' : 'NA',
      basis: c.id === 'verify-three' || c.id === 'verify-before-access' ? 'EVIDENCE' : 'ABSENCE',
      evidence: c.id === 'verify-three' || c.id === 'verify-before-access' ? 'x y z' : '',
      note: '',
      identityEvidence: c.id === 'verify-three' ? good : c.id === 'verify-before-access' ? other : [],
    }));
    const check = validateQaResponse(
      { criteria, autoFails: OBGYN.autoFails.map((a) => ({ id: a.id, triggered: false, evidence: '', note: '' })) },
      OBGYN,
    );
    expect(check.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2 — name-ownership must not accept ordinary English
// ─────────────────────────────────────────────────────────────────────────────

describe('B2 · ordinary request wording is never a patient name', () => {
  it('"this is about my refill" yields no patient name', () => {
    expect(patientNameSpans('This is about my refill.')).toEqual([]);
  });

  it('"calling for an appointment" yields no patient name', () => {
    expect(patientNameSpans("I'm calling for an appointment.")).toEqual([]);
  });

  it('"the appointment is for next Tuesday" yields no patient name', () => {
    expect(patientNameSpans('The appointment is for next Tuesday.')).toEqual([]);
  });

  it('a provider-question answer does not establish patient identity', () => {
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana.'),
      nav('Who is your provider?'),
      caller('Dr. Reyes.'),
      nav('And your date of birth?'),
      caller('March 2, 1991.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Reyes', 'caller', 2, 'Dr. Reyes'),
      claim('lastName', 'Reyes', 'caller', 2, 'Dr. Reyes'),
      claim('dob', 'March 2, 1991', 'caller', 4, 'March 2, 1991'),
    ]);
    expect(result.complete).toBe(false);
  });

  it('stopwords cannot be claimed as names', () => {
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana.'),
      caller('This is about my appointment.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'about', 'caller', 1, 'This is about my appointment'),
      claim('lastName', 'appointment', 'caller', 1, 'This is about my appointment'),
      claim('dob', 'March 2, 1991', 'caller', 1, 'This is about my appointment'),
    ]);
    expect(result.complete).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B3 — one-word name answers
// ─────────────────────────────────────────────────────────────────────────────

describe('B3 · one-word name answers to patient-name questions verify', () => {
  const SPREAD = [
    nav('Thank you for calling Aizer Health, this is Dana.'),
    nav('May I have the patient first name?'),
    caller('Maria.'),
    nav('And the last name?'),
    caller('Alvarez.'),
    nav('And the date of birth?'),
    caller('March 2, 1991.'),
  ];

  it('accepts single-word first and last name answers', () => {
    const result = scoreVerification(SPREAD, [
      claim('firstName', 'Maria', 'caller', 2, 'Maria'),
      claim('lastName', 'Alvarez', 'caller', 4, 'Alvarez'),
      claim('dob', 'March 2, 1991', 'caller', 6, 'March 2, 1991'),
    ]);
    expect(result.verdict).toBe('MET');
  });

  it('accepts a hyphenated surname answer', () => {
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana.'),
      nav('May I have the patient first name?'),
      caller('Maria.'),
      nav('And the last name?'),
      caller('Alvarez-Reyes.'),
      nav('And the date of birth?'),
      caller('March 2, 1991.'),
    ];
    const result = scoreVerification(transcript, [
      claim('firstName', 'Maria', 'caller', 2, 'Maria'),
      claim('lastName', 'Alvarez-Reyes', 'caller', 4, 'Alvarez-Reyes'),
      claim('dob', 'March 2, 1991', 'caller', 6, 'March 2, 1991'),
    ]);
    expect(result.verdict).toBe('MET');
  });

  it('a single unrelated word with no identity question fails', () => {
    const transcript = [
      nav('Thank you for calling Aizer Health, this is Dana.'),
      caller('Okay.'),
    ];
    const result = scoreVerification(transcript, [
      claim('firstName', 'Okay', 'caller', 1, 'Okay'),
    ]);
    expect(result.verdict).toBe('NOT_MET');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B4 — prompt/schema/server contract alignment (caller-only)
// ─────────────────────────────────────────────────────────────────────────────

describe('B4 · the identity contract is caller-only everywhere', () => {
  it('the response schema advertises only the caller role for identity evidence', () => {
    const roleEnum = RESPONSE_SCHEMA.properties.criteria.items.properties.identityEvidence.items.properties.role.enum;
    expect(roleEnum).toEqual(['caller']);
  });

  it('the evidence-role rules never invite navigator-sourced identity claims', () => {
    const text = evidenceRoleRules(OBGYN);
    expect(text).not.toMatch(/caller turns as well as navigator turns/i);
    expect(text).toMatch(/CALLER turn/);
  });

  it('the prompt version moved past v5', () => {
    expect(CALL_QA_PROMPT_VERSION).toBe('call-qa-grader-v8');
  });

  it('validation rejects a navigator-role identity claim', () => {
    const criteria = OBGYN.criteria.map((c) => ({
      id: c.id,
      verdict: c.id === 'verify-three' ? 'MET' : 'NA',
      basis: c.id === 'verify-three' ? 'EVIDENCE' : 'ABSENCE',
      evidence: c.id === 'verify-three' ? 'x y z' : '',
      note: '',
      identityEvidence: c.id === 'verify-three'
        ? [claim('firstName', 'Maria', 'navigator', 0, 'this is Maria')]
        : [],
    }));
    const check = validateQaResponse(
      { criteria, autoFails: OBGYN.autoFails.map((a) => ({ id: a.id, triggered: false, evidence: '', note: '' })) },
      OBGYN,
    );
    expect(check.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B5 — MET identity without a full payload is a malformed response
// ─────────────────────────────────────────────────────────────────────────────

describe('B5 · a MET identity criterion needs a complete structured payload', () => {
  const build = (identityEvidence) => ({
    criteria: OBGYN.criteria.map((c) => ({
      id: c.id,
      verdict: c.id === 'verify-three' ? 'MET' : 'NA',
      basis: c.id === 'verify-three' ? 'EVIDENCE' : 'ABSENCE',
      evidence: c.id === 'verify-three' ? 'x y z' : '',
      note: '',
      identityEvidence: c.id === 'verify-three' ? identityEvidence : [],
    })),
    autoFails: OBGYN.autoFails.map((a) => ({ id: a.id, triggered: false, evidence: '', note: '' })),
  });

  it('rejects a MET identity criterion with an empty identityEvidence array', () => {
    expect(validateQaResponse(build([]), OBGYN).error).toBeTruthy();
  });

  it('rejects a MET identity criterion missing the DOB claim', () => {
    expect(validateQaResponse(build([
      claim('firstName', 'Maria', 'caller', 1, 'this is Maria Alvarez'),
      claim('lastName', 'Alvarez', 'caller', 1, 'this is Maria Alvarez'),
    ]), OBGYN).error).toBeTruthy();
  });

  it('rejects duplicate identifier fields', () => {
    expect(validateQaResponse(build([
      claim('firstName', 'Maria', 'caller', 1, 'this is Maria Alvarez'),
      claim('firstName', 'Maria', 'caller', 1, 'this is Maria Alvarez'),
      claim('lastName', 'Alvarez', 'caller', 1, 'this is Maria Alvarez'),
      claim('dob', 'March 2, 1991', 'caller', 1, 'March 2, 1991'),
    ]), OBGYN).error).toBeTruthy();
  });

  it('accepts a MET identity criterion with a complete distinct payload', () => {
    expect(validateQaResponse(build([
      claim('firstName', 'Maria', 'caller', 1, 'this is Maria Alvarez'),
      claim('lastName', 'Alvarez', 'caller', 1, 'this is Maria Alvarez'),
      claim('dob', 'March 2, 1991', 'caller', 1, 'March 2, 1991'),
    ]), OBGYN).data).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B6 — safe prefix must not suppress a same-clause disclosure
// ─────────────────────────────────────────────────────────────────────────────

describe('B6 · a safe prefix never vouches for a protected disclosure in the same clause', () => {
  it('"Okay your labs are normal." is a results disclosure', () => {
    expect(classifyProtectedDisclosure('Okay your labs are normal.')).toBe('results');
  });

  it('"I can help you confirm your appointment is Tuesday." is an appointment disclosure', () => {
    expect(classifyProtectedDisclosure('I can help you confirm your appointment is Tuesday at 2:15.')).toBe('appointment');
  });

  it('"Let me review your chart which shows you are 20 weeks." discloses', () => {
    expect(classifyProtectedDisclosure('Let me review your chart which shows you are 20 weeks.')).toBeTruthy();
  });

  it('"Sure your prescription was sent yesterday." is a medication disclosure', () => {
    expect(classifyProtectedDisclosure('Sure your prescription was sent yesterday.')).toBe('medication');
  });

  it('keeps a wholly benign clause safe', () => {
    expect(classifyProtectedDisclosure('Okay, let me take a look.')).toBeNull();
    expect(classifyProtectedDisclosure('Sure, one moment please.')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B7 — raw response validation rejects malformed field types
// ─────────────────────────────────────────────────────────────────────────────

describe('B7 · malformed criterion field types are rejected, not coerced', () => {
  const build = (overrides) => ({
    criteria: OBGYN.criteria.map((c) => ({
      id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '',
      ...(c.id === 'comm-empathy' ? overrides : {}),
    })),
    autoFails: OBGYN.autoFails.map((a) => ({ id: a.id, triggered: false, evidence: '', note: '' })),
  });

  it('rejects numeric evidence', () => {
    expect(validateQaResponse(build({ evidence: 123 }), OBGYN).error).toBeTruthy();
  });

  it('rejects object note', () => {
    expect(validateQaResponse(build({ note: {} }), OBGYN).error).toBeTruthy();
  });
});

describe('B8 · first and last name claims have field semantics', () => {
  const fullNameTranscript = [
    nav('May I have the patient full name?'),
    caller('Maria Alvarez.'),
    nav('And the patient date of birth?'),
    caller('March 2, 1991.'),
  ];
  const dob = claim('dob', 'March 2, 1991', 'caller', 3, 'March 2, 1991');

  it.each([
    ['swapped fields', [claim('firstName', 'Alvarez', 'caller', 1, 'Maria Alvarez'), claim('lastName', 'Maria', 'caller', 1, 'Maria Alvarez'), dob]],
    ['full name as firstName', [claim('firstName', 'Maria Alvarez', 'caller', 1, 'Maria Alvarez'), claim('lastName', 'Alvarez', 'caller', 1, 'Maria Alvarez'), dob]],
    ['full name as lastName', [claim('firstName', 'Maria', 'caller', 1, 'Maria Alvarez'), claim('lastName', 'Maria Alvarez', 'caller', 1, 'Maria Alvarez'), dob]],
  ])('rejects %s', (_label, evidence) => {
    expect(evaluateIdentityEvidence(fullNameTranscript, evidence).complete).toBe(false);
  });

  it.each([
    ['Maria Alvarez', 'Alvarez'],
    ['Maria Alvarez-Reyes', 'Alvarez-Reyes'],
    ['Maria O’Connor', 'O’Connor'],
    ['Maria de la Cruz', 'de la Cruz'],
  ])('accepts ordered full name %s', (full, surname) => {
    const transcript = [nav('May I have the patient full name?'), caller(`${full}.`), nav('And the patient DOB?'), caller('March 2, 1991.')];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 'caller', 1, full),
      claim('lastName', surname, 'caller', 1, full),
      claim('dob', 'March 2, 1991', 'caller', 3, 'March 2, 1991'),
    ]);
    expect(result.complete).toBe(true);
  });

  it('rejects typed first-name answer submitted as lastName', () => {
    const transcript = [nav('Patient first name?'), caller('Maria.'), nav('Patient last name?'), caller('Alvarez.'), nav('Patient DOB?'), caller('March 2, 1991.')];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Alvarez', 'caller', 3, 'Alvarez'),
      claim('lastName', 'Maria', 'caller', 1, 'Maria'),
      claim('dob', 'March 2, 1991', 'caller', 5, 'March 2, 1991'),
    ]);
    expect(result.complete).toBe(false);
  });
});

describe('B9 · patient candidates stay discrete', () => {
  const assess = (patientLines, evidence) => evaluateIdentityEvidence([
    nav('May I have the patient full name and DOB?'),
    ...patientLines.map(caller),
  ], evidence);

  it.each([
    ['shared first name', ['Maria Smith.', 'Maria Alvarez, March 2, 1991.']],
    ['shared surname', ['Maria Smith.', 'Jane Smith, March 2, 1991.']],
    ['different names', ['Maria Smith.', 'Jane Alvarez, March 2, 1991.']],
    ['multiple children', ['My daughter Maria Smith needs an appointment.', 'My daughter Jane Smith also needs an appointment. March 2, 1991.']],
  ])('fails closed for %s', (_label, lines) => {
    const result = assess(lines, [
      claim('firstName', 'Maria', 'caller', 1, lines[0]),
      claim('lastName', 'Smith', 'caller', 2, lines[1]),
      claim('dob', 'March 2, 1991', 'caller', 2, lines[1]),
    ]);
    expect(result.complete).toBe(false);
  });

  it('does not treat repeated identical designation as ambiguity', () => {
    const transcript = [nav('Patient full name?'), caller('Maria Alvarez.'), nav('Please repeat the patient full name and DOB.'), caller('Maria Alvarez, March 2, 1991.')];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 'caller', 3, 'Maria Alvarez'),
      claim('lastName', 'Alvarez', 'caller', 3, 'Maria Alvarez'),
      claim('dob', 'March 2, 1991', 'caller', 3, 'March 2, 1991'),
    ]);
    expect(result.complete).toBe(true);
  });

  it('fails closed when a patient designation is corrected to a different name', () => {
    const transcript = [nav('Patient full name?'), caller('Maria Smith.'), caller('Correction, the patient is Maria Alvarez, DOB March 2, 1991.')];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 'caller', 2, 'Maria Alvarez'),
      claim('lastName', 'Alvarez', 'caller', 2, 'Maria Alvarez'),
      claim('dob', 'March 2, 1991', 'caller', 2, 'DOB March 2, 1991'),
    ]);
    expect(result.complete).toBe(false);
  });

  it('fails closed when a typed field sequence changes patients', () => {
    const transcript = [nav('Patient first name?'), caller('Maria.'), nav('Patient first name?'), caller('Jane.'), nav('Patient last name?'), caller('Alvarez.'), nav('Patient DOB?'), caller('March 2, 1991.')];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Jane', 'caller', 3, 'Jane'),
      claim('lastName', 'Alvarez', 'caller', 5, 'Alvarez'),
      claim('dob', 'March 2, 1991', 'caller', 7, 'March 2, 1991'),
    ]);
    expect(result.complete).toBe(false);
  });
});

describe('B10 · DOB ownership follows transcript-level patient context', () => {
  const thirdParty = [
    caller("I'm calling for my daughter, Maria Alvarez."),
    nav('And your date of birth?'),
    caller('March 2, 1991.'),
  ];
  const evidence = [
    claim('firstName', 'Maria', 'caller', 0, 'my daughter, Maria Alvarez'),
    claim('lastName', 'Alvarez', 'caller', 0, 'my daughter, Maria Alvarez'),
    claim('dob', 'March 2, 1991', 'caller', 2, 'March 2, 1991'),
  ];

  it('rejects third-party patient followed by "your DOB"', () => {
    expect(evaluateIdentityEvidence(thirdParty, evidence).complete).toBe(false);
  });

  it('accepts third-party patient followed by patient-linked DOB', () => {
    const transcript = [thirdParty[0], nav('And her date of birth?'), thirdParty[2]];
    expect(evaluateIdentityEvidence(transcript, evidence).complete).toBe(true);
  });

  it('fails closed on an ambiguous DOB pronoun', () => {
    const transcript = [thirdParty[0], nav('And their date of birth?'), thirdParty[2]];
    expect(evaluateIdentityEvidence(transcript, evidence).complete).toBe(false);
  });

  it.each([
    'Her DOB is March 2, 1991 and the phone number is 555-010-1212.',
    'Her DOB is March 2, 1991 and the address is 12 Main Street.',
  ])('still evaluates DOB ownership when the same turn also contains another identifier', (text) => {
    const transcript = [thirdParty[0], nav('What is the patient DOB?'), caller(text)];
    const claims = [...evidence.slice(0, 2), claim('dob', 'March 2, 1991', 'caller', 2, 'Her DOB is March 2, 1991')];
    expect(evaluateIdentityEvidence(transcript, claims).complete).toBe(true);
  });

  it('rejects same-turn caller DOB followed by a different patient designation', () => {
    const transcript = [caller('My DOB is March 2, 1991, and I am calling for Maria Alvarez.')];
    const claims = [
      claim('firstName', 'Maria', 'caller', 0, 'calling for Maria Alvarez'),
      claim('lastName', 'Alvarez', 'caller', 0, 'calling for Maria Alvarez'),
      claim('dob', 'March 2, 1991', 'caller', 0, 'My DOB is March 2, 1991'),
    ];
    expect(evaluateIdentityEvidence(transcript, claims).complete).toBe(false);
  });
});

describe('B11 · untriggered auto-fails are strictly empty', () => {
  const response = (autoFail) => ({
    criteria: OBGYN.criteria.map((c) => ({ id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '', identityEvidence: [] })),
    autoFails: OBGYN.autoFails.map((a) => a.id === autoFail.id ? autoFail : ({ id: a.id, triggered: false, evidence: '', note: '' })),
  });

  it('rejects false plus evidence', () => {
    expect(validateQaResponse(response({ id: 'af-hipaa', triggered: false, evidence: 'Your appointment is Tuesday', note: '' }), OBGYN).error).toBeTruthy();
  });

  it('rejects false plus an accusation in note', () => {
    expect(validateQaResponse(response({ id: 'af-hipaa', triggered: false, evidence: '', note: 'Navigator disclosed the appointment early.' }), OBGYN).error).toBeTruthy();
  });
});
