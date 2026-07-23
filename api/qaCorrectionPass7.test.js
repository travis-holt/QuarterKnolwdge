import { describe, expect, it } from 'vitest';
import {
  classifyAfHipaaEvidence,
  classifyProtectedDisclosure,
  earliestCompleteIdentity,
  evaluateIdentityEvidence,
} from './_qa-identity-verification.js';
import { assessQa, scoreQa } from './_qa-rubric.js';
import { QA_RUBRIC_PROFILES } from '../src/data/qaRubricProfiles.js';

const OBGYN = QA_RUBRIC_PROFILES.obgyn;
const nav = (text) => ({ role: 'navigator', text });
const caller = (text) => ({ role: 'caller', text });
const claim = (field, value, turnIndex, quote) => ({ field, value, role: 'caller', turnIndex, quote });
const GREET = nav('Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?');
const identity = (turnIndex, dobQuote = 'date of birth March 2nd 1991') => [
  claim('firstName', 'Maria', turnIndex, 'Maria Alvarez'),
  claim('lastName', 'Alvarez', turnIndex, 'Maria Alvarez'),
  claim('dob', 'March 2nd 1991', turnIndex, dobQuote),
];

function verdicts(overrides = {}) {
  return OBGYN.criteria.map((criterion) => {
    if (overrides[criterion.id]) return { id: criterion.id, note: '', identityEvidence: [], ...overrides[criterion.id] };
    if (['comm-empathy', 'control-narrate'].includes(criterion.id)) {
      return { id: criterion.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: '', identityEvidence: [] };
    }
    if (OBGYN.identityVerificationCriteria.includes(criterion.id)) {
      return { id: criterion.id, verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', note: '', identityEvidence: identity(2) };
    }
    return { id: criterion.id, verdict: 'MET', basis: 'EVIDENCE', evidence: 'this is Dana', note: '', identityEvidence: [] };
  });
}

describe('correction pass 7 · every identifier binds to one non-null candidate', () => {
  it('rejects a DOB with no candidate after an explicit patient switch', () => {
    const transcript = [
      GREET,
      caller('I am calling for my daughter Maria Alvarez.'),
      nav('Now for my other daughter, what is her DOB?'),
      caller('Her DOB is March 2nd 1991.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 1, 'Maria Alvarez'),
      claim('lastName', 'Alvarez', 1, 'Maria Alvarez'),
      claim('dob', 'March 2nd 1991', 3, 'Her DOB is March 2nd 1991'),
    ]);
    expect(result.complete).toBe(false);
    expect(result.failures.some((failure) => failure.reason === 'identifier-candidate-unresolved')).toBe(true);
  });

  it('preserves a direct-patient identity', () => {
    const transcript = [GREET, caller('This is Maria Alvarez. My DOB is March 2nd 1991.')];
    expect(evaluateIdentityEvidence(transcript, identity(1, 'My DOB is March 2nd 1991')).complete).toBe(true);
  });

  it('preserves a coherent third-party identity', () => {
    const transcript = [GREET, caller('I am calling for my daughter Maria Alvarez. Her DOB is March 2nd 1991.')];
    expect(evaluateIdentityEvidence(transcript, identity(1, 'Her DOB is March 2nd 1991')).complete).toBe(true);
  });
});

describe('correction pass 7 · third-party DOB ownership is shared by evidence and chronology', () => {
  const assess = (line, dobQuote = line) => {
    const transcript = [GREET, caller(line)];
    return {
      evidence: evaluateIdentityEvidence(transcript, identity(1, dobQuote)),
      chronology: earliestCompleteIdentity(transcript),
    };
  };

  it('rejects a third-party designation followed by the caller-owned DOB', () => {
    const transcript = [
      GREET,
      caller('I am calling for my daughter Maria Alvarez.'),
      nav('What is her DOB?'),
      caller('My DOB is March 2nd 1991.'),
    ];
    const result = evaluateIdentityEvidence(transcript, [
      claim('firstName', 'Maria', 1, 'Maria Alvarez'),
      claim('lastName', 'Alvarez', 1, 'Maria Alvarez'),
      claim('dob', 'March 2nd 1991', 3, 'My DOB is March 2nd 1991'),
    ]);
    expect(result.complete).toBe(false);
    expect(earliestCompleteIdentity(transcript).earliestIndex).toBeNull();
  });

  it.each([
    ['My DOB is March 2nd 1991.', 'My DOB is March 2nd 1991'],
    ['My date of birth is March 2nd 1991.', 'My date of birth is March 2nd 1991'],
    ['I was born March 2nd 1991.', 'I was born March 2nd 1991'],
  ])('rejects a same-sentence third-party designation plus caller ownership: %s', (dobText, dobQuote) => {
    const result = assess(`I am calling for my daughter Maria Alvarez. ${dobText}`, dobQuote);
    expect(result.evidence.complete).toBe(false);
    expect(result.chronology.earliestIndex).toBeNull();
  });

  it.each([
    'I am calling for my daughter Maria Alvarez. Her DOB is March 2nd 1991.',
    'I am calling for my daughter Maria Alvarez. The patient\'s DOB is March 2nd 1991.',
    'I am calling for my daughter Maria Alvarez. Maria\'s DOB is March 2nd 1991.',
  ])('accepts patient-linked wording: %s', (line) => {
    const result = assess(line, line.slice(line.indexOf('.') + 2));
    expect(result.evidence.complete).toBe(true);
    expect(result.chronology.earliestIndex).toBe(1);
  });

  it('binds only the patient-linked DOB when caller and patient DOBs are both present', () => {
    const transcript = [
      GREET,
      caller('I am calling for my daughter Maria Alvarez. My DOB is April 4th 1980. Her DOB is March 2nd 1991.'),
    ];
    const callerDob = [
      claim('firstName', 'Maria', 1, 'Maria Alvarez'),
      claim('lastName', 'Alvarez', 1, 'Maria Alvarez'),
      claim('dob', 'April 4th 1980', 1, 'My DOB is April 4th 1980'),
    ];
    expect(evaluateIdentityEvidence(transcript, callerDob).complete).toBe(false);
    expect(evaluateIdentityEvidence(transcript, identity(1, 'Her DOB is March 2nd 1991')).complete).toBe(true);
    expect(earliestCompleteIdentity(transcript).earliestIndex).toBe(1);
  });
});

describe('correction pass 7 · af-hipaa uses its quoted disclosure', () => {
  it('maps a verified quote to its unique turn and clause', () => {
    const transcript = [GREET, nav('Let me check. Your appointment is Tuesday.')];
    const result = classifyAfHipaaEvidence(transcript, 'Your appointment is Tuesday');
    expect(result).toMatchObject({ verified: true, turnIndex: 1, clauseIndex: 1, clause: 'Your appointment is Tuesday' });
  });

  it('does not classify a question requesting appointment information as disclosure', () => {
    expect(classifyProtectedDisclosure('What is your appointment for?')).toBeNull();
  });

  it('does not let an earlier question lend auto-fail authority to a later post-verification quote', () => {
    const transcript = [
      GREET,
      nav('What is your appointment for?'),
      caller('This is Maria Alvarez. My date of birth is March 2nd 1991.'),
      nav('Your appointment is Tuesday.'),
    ];
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: identity(2, 'My date of birth is March 2nd 1991') },
      'verify-before-access': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: identity(2, 'My date of birth is March 2nd 1991') },
    }), [{ id: 'af-hipaa', evidence: 'Your appointment is Tuesday.', note: 'shared before verification' }], transcript, OBGYN);
    expect(scored.score).not.toBe(0);
    expect(scored.autoFails.some((autoFail) => autoFail.id === 'af-hipaa')).toBe(false);
    expect(scored.unverifiedAutoFails.some((autoFail) => autoFail.id === 'af-hipaa')).toBe(true);
    expect(assessQa(scored, transcript, { profile: OBGYN }).recommendation).toBe('needs_review');
  });

  it('still verifies a quoted disclosure before identity', () => {
    const transcript = [GREET, nav('Your appointment is Tuesday.'), caller('This is Maria Alvarez. My DOB is March 2nd 1991.')];
    const scored = scoreQa(verdicts({
      'verify-three': { verdict: 'MET', basis: 'EVIDENCE', evidence: 'x', identityEvidence: identity(2, 'My DOB is March 2nd 1991') },
      'verify-before-access': { verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', identityEvidence: [] },
    }), [{ id: 'af-hipaa', evidence: 'Your appointment is Tuesday.', note: 'shared before verification' }], transcript, OBGYN);
    expect(scored.score).toBe(0);
    expect(scored.autoFails.some((autoFail) => autoFail.id === 'af-hipaa')).toBe(true);
  });
});
