// ─────────────────────────────────────────────────────────────────────────────
// UNIT TESTS for pure helper functions in the /api handlers.
//
// Only functions that are purely computational (string builders, validators,
// data transformers) are tested here. Functions that call Gemini or Firestore
// are not unit-tested — those require integration fixtures or mocks.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';

import { sanitize, buildPrompt as buildScenarioPrompt } from './generate-scenarios.js';
import { buildDigest }          from './generate-coaching.js';
import { buildSystemInstruction, buildContents, coerceCaseFile } from './interview-turn.js';
import { buildMessages as buildQaMessages } from './grade-call-qa.js';

import { COMPETENCIES }  from '../src/data/competencies.js';
import { DOMAINS }       from '../src/data/questions.js';

const C0 = COMPETENCIES[0].id; // 'sopKnowledge'
const C1 = COMPETENCIES[1].id;
const DOMAIN_ID = DOMAINS[0].id;

// ── sanitize ─────────────────────────────────────────────────────────────────
// validate/repair function for Gemini's raw scenario output

const validRaw = () => ({
  scenario: 'A patient calls wanting to book a well-child visit.',
  competencies: [C0, C1],
  correctOptionId: 'a',
  options: [
    { id: 'a', text: 'Schedule the appointment',       points: 100, rationale: 'Correct per SOP.' },
    { id: 'b', text: 'Tell them to call back later',   points: 20,  rationale: 'Unhelpful.' },
    { id: 'c', text: 'Transfer immediately',           points: 40,  rationale: 'Only for complex cases.' },
    { id: 'd', text: 'Ask for insurance only',         points: 10,  rationale: 'Missing required steps.' },
  ],
});

describe('sanitize', () => {
  it('returns a valid question shape for well-formed input', () => {
    const result = sanitize(validRaw(), DOMAIN_ID);
    expect(result).not.toBeNull();
    expect(result.domainId).toBe(DOMAIN_ID);
    expect(result.scenario).toBe('A patient calls wanting to book a well-child visit.');
    expect(result.options).toHaveLength(4);
    expect(result.correctOptionId).toBe('a');
  });

  it('forces the correctOptionId option to exactly 100 points', () => {
    const raw = validRaw();
    raw.options[0].points = 80; // deliberately not 100
    const result = sanitize(raw, DOMAIN_ID);
    expect(result).not.toBeNull();
    const best = result.options.find((o) => o.id === result.correctOptionId);
    expect(best.points).toBe(100);
  });

  it('caps non-best options at 95 points', () => {
    const raw = validRaw();
    raw.options[1].points = 100; // tie — correctOptionId wins; this becomes non-best
    const result = sanitize(raw, DOMAIN_ID);
    expect(result).not.toBeNull();
    const nonBest = result.options.filter((o) => o.id !== result.correctOptionId);
    for (const o of nonBest) expect(o.points).toBeLessThanOrEqual(95);
  });

  it('falls back to the highest-points option when correctOptionId is missing', () => {
    const raw = validRaw();
    raw.correctOptionId = undefined;
    raw.options[2].points = 100; // make 'c' the highest
    raw.options[0].points = 80;
    const result = sanitize(raw, DOMAIN_ID);
    expect(result).not.toBeNull();
    expect(result.correctOptionId).toBe('c');
  });

  it('returns null when scenario is missing', () => {
    expect(sanitize({ ...validRaw(), scenario: '' }, DOMAIN_ID)).toBeNull();
    expect(sanitize({ ...validRaw(), scenario: '   ' }, DOMAIN_ID)).toBeNull();
    expect(sanitize({ ...validRaw(), scenario: undefined }, DOMAIN_ID)).toBeNull();
  });

  it('returns null when options array is too short', () => {
    expect(sanitize({ ...validRaw(), options: [validRaw().options[0]] }, DOMAIN_ID)).toBeNull();
  });

  it('returns null when any option is missing text or rationale', () => {
    const raw = validRaw();
    raw.options[1].text = '';
    expect(sanitize(raw, DOMAIN_ID)).toBeNull();
  });

  it('returns null when no valid competency ids are present', () => {
    const raw = { ...validRaw(), competencies: ['not-a-real-competency'] };
    expect(sanitize(raw, DOMAIN_ID)).toBeNull();
  });

  it('filters out unknown competency ids and keeps the valid ones', () => {
    const raw = { ...validRaw(), competencies: [C0, 'ghost'] };
    const result = sanitize(raw, DOMAIN_ID);
    expect(result).not.toBeNull();
    expect(result.competencies).toEqual([C0]);
  });

  it('deduplicates competency tags', () => {
    const raw = { ...validRaw(), competencies: [C0, C0, C1] };
    const result = sanitize(raw, DOMAIN_ID);
    expect(result).not.toBeNull();
    expect(result.competencies.filter((c) => c === C0)).toHaveLength(1);
  });

  it('clamps competencies to 3', () => {
    const ids = COMPETENCIES.slice(0, 5).map((c) => c.id);
    const raw = { ...validRaw(), competencies: ids };
    const result = sanitize(raw, DOMAIN_ID);
    expect(result).not.toBeNull();
    expect(result.competencies.length).toBeLessThanOrEqual(3);
  });
});

// ── buildDigest ──────────────────────────────────────────────────────────────

const Q_CORRECT = {
  id: 'q1', domainId: DOMAIN_ID, competencies: [C0], correctOptionId: 'a',
  scenario: 'Patient asks about vaccine schedule.',
  options: [
    { id: 'a', text: 'Follow schedule', points: 100, rationale: 'Best.' },
    { id: 'b', text: 'Refer to nurse',  points: 40,  rationale: 'Partial.' },
  ],
};

const Q_WRONG = {
  id: 'q2', domainId: DOMAIN_ID, competencies: [C0], correctOptionId: 'a',
  scenario: 'Patient needs referral.',
  options: [
    { id: 'a', text: 'Route correctly',  points: 100, rationale: 'SOP says route to X.' },
    { id: 'b', text: 'Tell them to wait', points: 0,  rationale: 'Never delay referrals.' },
  ],
};

describe('buildDigest', () => {
  it('excludes questions answered correctly (100 pts)', () => {
    const digest = buildDigest([Q_CORRECT], { q1: 'a' });
    expect(digest).toHaveLength(0);
  });

  it('includes questions answered below 100 pts', () => {
    const digest = buildDigest([Q_CORRECT], { q1: 'b' });
    expect(digest).toHaveLength(1);
    expect(digest[0]).toContain('Partial');
  });

  it('includes unanswered questions (no answer key → 0 pts)', () => {
    const digest = buildDigest([Q_CORRECT], {});
    expect(digest).toHaveLength(1);
    expect(digest[0]).toContain('no answer');
  });

  it('caps output at 10 items regardless of bank size', () => {
    const big = Array.from({ length: 15 }, (_, i) => ({
      ...Q_WRONG, id: `q${i}`,
    }));
    const answers = {};
    const digest = buildDigest(big, answers);
    expect(digest.length).toBeLessThanOrEqual(10);
  });

  it('includes the domain name and competency in the header line', () => {
    const digest = buildDigest([Q_WRONG], { q2: 'b' });
    const firstLine = digest[0].split('\n')[0];
    expect(firstLine).toContain(DOMAINS.find((d) => d.id === DOMAIN_ID).name);
    expect(firstLine).toContain(C0);
  });

  it('handles questions with missing options gracefully', () => {
    const q = { id: 'qx', domainId: DOMAIN_ID, competencies: [C0], correctOptionId: 'a',
      scenario: 'X', options: undefined };
    expect(() => buildDigest([q], { qx: 'a' })).not.toThrow();
  });
});

// ── buildSystemInstruction ───────────────────────────────────────────────────

describe('buildSystemInstruction', () => {
  it('embeds the caller name', () => {
    const si = buildSystemInstruction('Maria', 'Patient wants to reschedule.');
    expect(si).toContain('Maria');
  });

  it('embeds the scenario text', () => {
    const si = buildSystemInstruction('Maria', 'Patient wants to reschedule.');
    expect(si).toContain('Patient wants to reschedule.');
  });

  it('includes the CRITICAL consistency rule', () => {
    const si = buildSystemInstruction('Maria', 'A scenario');
    expect(si.toUpperCase()).toContain('CRITICAL');
  });

  it('uses the selected department in the caller context', () => {
    const si = buildSystemInstruction('Maria', 'A scenario', { department: 'obgyn' });
    expect(si).toContain('Aizer Health OB/GYN contact centre');
    expect(si).toContain('Department: OB/GYN');
  });

  it('includes the generated opening line when provided', () => {
    const si = buildSystemInstruction('Maria', 'A scenario', {
      openingLine: 'Hi, I need help scheduling my prenatal visit.',
    });
    expect(si).toContain('Hi, I need help scheduling my prenatal visit.');
    expect(si).toContain('first spoken turn');
  });

  it('injects the roleplay-caller operating model guidance', () => {
    const si = buildSystemInstruction('Maria', 'A scenario');
    expect(si).toMatch(/ROLEPLAY AS THE CALLER/i);
  });

  it('renders hidden case notes without leaking the correct SOP answer', () => {
    const si = buildSystemInstruction('Maria', 'A scenario', {
      caseFile: {
        requestSummary: 'refill for albuterol',
        factsToReveal: ['DOB 2019-04-02', 'CVS on Main St'],
        emotionalTone: 'worried',
      },
    });
    expect(si).toMatch(/PRIVATE CASE NOTES/i);
    expect(si).toContain('refill for albuterol');
    expect(si).toMatch(/Reveal a fact only when the navigator asks/i);
  });

  it('includes requiredActions/acceptableNavigatorPaths/criticalMistakes as hidden caller-behavior guidance', () => {
    const si = buildSystemInstruction('Maria', 'A scenario', {
      caseFile: {
        requestSummary: 'refill for albuterol',
        factsToReveal: ['DOB 2019-04-02'],
        requiredActions: ['confirm preferred pharmacy', 'route TE to PEDS Encounters'],
        acceptableNavigatorPaths: ['read back the pharmacy to confirm'],
        criticalMistakes: ['promise the refill will be sent today'],
      },
    });
    // The behavior fields are present…
    expect(si).toContain('confirm preferred pharmacy');
    expect(si).toContain('read back the pharmacy to confirm');
    expect(si).toContain('promise the refill will be sent today');
    // …framed as hidden guidance, not as SOP answers to reveal…
    expect(si).toMatch(/Correct handling to silently expect — never reveal this as SOP guidance/i);
    expect(si).toMatch(/Acceptable safe paths — cooperate if the navigator follows one of these/i);
    expect(si).toMatch(/Critical mistakes to react to naturally/i);
    expect(si).toMatch(/ask a clarifying question or show mild confusion\/frustration, but never explain the SOP answer/i);
    // …and the overall guardrails still stand.
    expect(si).toMatch(/Never tell the navigator what the "correct" procedure is/i);
    expect(si).toMatch(/Reveal a fact only when the navigator asks for it/i);
  });

  it('works without a case file (backward compatible)', () => {
    const si = buildSystemInstruction('Maria', 'A scenario');
    expect(si).not.toMatch(/PRIVATE CASE NOTES/i);
  });
});

// ── coerceCaseFile ────────────────────────────────────────────────────────────

describe('coerceCaseFile', () => {
  it('returns null for absent/empty case files', () => {
    expect(coerceCaseFile(null)).toBeNull();
    expect(coerceCaseFile({})).toBeNull();
    expect(coerceCaseFile('x')).toBeNull();
  });

  it('coerces arrays and strings and keeps a meaningful record', () => {
    const cf = coerceCaseFile({
      workflowType: ' refill ',
      requestSummary: 'needs a refill',
      requiredActions: ['ask pharmacy', 42],
      factsToReveal: ['DOB'],
    });
    expect(cf.workflowType).toBe('refill');
    expect(cf.requiredActions).toEqual(['ask pharmacy', '42']);
    expect(cf.factsToReveal).toEqual(['DOB']);
  });
});

// ── generate-scenarios prompt ─────────────────────────────────────────────────

describe('buildScenarioPrompt (generate-scenarios)', () => {
  it('injects the navigator operating model and mistake types', () => {
    const prompt = buildScenarioPrompt(DOMAINS[0], 3, 'pediatrics', 'SOP');
    expect(prompt).toMatch(/OPERATING MODEL/i);
    expect(prompt).toMatch(/DECISION LOOP/i);
    expect(prompt).toMatch(/MISTAKE TYPES/i);
  });

  it('keeps the content guards against lookup-order-only and refill/PE hard-stop content', () => {
    const prompt = buildScenarioPrompt(DOMAINS[0], 3, 'pediatrics', 'SOP');
    expect(prompt).toMatch(/phone number before date of birth/i);
    expect(prompt).toMatch(/do NOT require PE verification/i);
  });
});

// ── grade-call-qa prompt ──────────────────────────────────────────────────────

describe('buildQaMessages (grade-call-qa)', () => {
  it('injects the qa-grading operating model before the SOP context', () => {
    const { systemInstruction } = buildQaMessages('A scenario', [{ role: 'navigator', text: 'Hi' }], 'pediatrics', 'ZZ_SOP_BODY_MARKER');
    expect(systemInstruction).toMatch(/OPERATING MODEL/i);
    const opIdx = systemInstruction.indexOf('OPERATING MODEL');
    const sopBodyIdx = systemInstruction.indexOf('ZZ_SOP_BODY_MARKER');
    expect(opIdx).toBeGreaterThan(-1);
    expect(opIdx).toBeLessThan(sopBodyIdx);
  });
});

// ── buildContents ─────────────────────────────────────────────────────────────

describe('buildContents', () => {
  it('always starts with a BEGIN_CALL user turn', () => {
    const contents = buildContents([], 'Hello');
    expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'BEGIN_CALL' }] });
  });

  it('appends the navigator message as the final user turn', () => {
    const contents = buildContents([], 'My first reply');
    expect(contents[contents.length - 1]).toEqual({ role: 'user', parts: [{ text: 'My first reply' }] });
  });

  it('maps patient turns to model role and navigator turns to user role', () => {
    const history = [
      { role: 'patient', text: 'Hi, I need help.' },
      { role: 'navigator', text: 'Of course!' },
    ];
    const contents = buildContents(history, 'Next turn');
    expect(contents[1].role).toBe('model'); // patient → model
    expect(contents[2].role).toBe('user');  // navigator → user
  });

  it('produces the correct total count: 1 BEGIN + history + 1 nav message', () => {
    const history = [
      { role: 'patient', text: 'A' },
      { role: 'navigator', text: 'B' },
      { role: 'patient', text: 'C' },
    ];
    const contents = buildContents(history, 'D');
    expect(contents).toHaveLength(1 + 3 + 1); // BEGIN + 3 turns + nav message
  });

  it('handles empty history (init turn scenario)', () => {
    const contents = buildContents([], 'START');
    expect(contents).toHaveLength(2); // BEGIN_CALL + nav message
  });
});
