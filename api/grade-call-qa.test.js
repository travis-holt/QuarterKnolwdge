// Tests for the QA-test rubric pipeline (api/_qa-rubric.js + grade-call-qa
// prompt builder). All pure functions — no Gemini, no network.

import { describe, it, expect } from 'vitest';
import {
  QA_RUBRIC, QA_AUTO_FAILS, QA_PASS_THRESHOLD, rubricCriteria,
  verifyEvidence, validateQaResponse, scoreQa, buildGradeProjection,
} from './_qa-rubric.js';
import { buildMessages } from './grade-call-qa.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TRANSCRIPT = [
  { role: 'navigator', text: 'Good morning, thank you for calling Aizer Health, this is Dana. How can I help you today?' },
  { role: 'patient', text: 'Hi, I need a checkup for my son.' },
  { role: 'navigator', text: 'I can help with that. Can I have his first name, last name, and date of birth please?' },
  { role: 'patient', text: 'Sure, Liam Carter, March 2nd 2021.' },
  { role: 'navigator', text: "Thank you, I'm pulling up the schedule now. I understand you want him seen soon." },
  { role: 'navigator', text: 'You are all set for Tuesday at 9 at 48 Baker Town Rd. Please stay on the line for our survey. Is there anything else I can help with? Thank you for calling.' },
];

// A verdict list where everything is MET with real quotes from TRANSCRIPT.
function allMetVerdicts() {
  const quotes = {
    'open-greet': 'Good morning, thank you for calling',
    'open-name': 'this is Dana',
    'open-org': 'Aizer Health',
    'verify-three': 'first name, last name, and date of birth please',
    'verify-before-access': 'Can I have his first name, last name, and date of birth',
    'control-narrate': "I'm pulling up the schedule now",
    'control-guide': 'How can I help you today',
    'doc-reason': 'You are all set for Tuesday at 9',
    'doc-te': 'You are all set for Tuesday',
    'comm-plain': 'You are all set for Tuesday at 9',
    'comm-professional': 'Thank you for calling',
    'comm-empathy': 'I understand you want him seen soon',
    'listen-ack': 'I understand you want him seen soon',
    'listen-gather': 'Can I have his first name, last name',
    'know-rule': 'You are all set for Tuesday at 9',
    'know-details': '48 Baker Town Rd',
    'sched-flow': 'You are all set for Tuesday at 9',
    'sched-recap': 'Tuesday at 9 at 48 Baker Town Rd',
    'close-survey': 'stay on the line for our survey',
    'close-anything-thanks': 'anything else I can help with',
  };
  return rubricCriteria().map((c) => ({ id: c.id, verdict: 'MET', evidence: quotes[c.id], note: '' }));
}

// ── Rubric integrity ─────────────────────────────────────────────────────────

describe('QA_RUBRIC', () => {
  it('totals exactly 100 points', () => {
    expect(rubricCriteria().reduce((s, c) => s + c.points, 0)).toBe(100);
  });

  it('has unique criterion ids', () => {
    const ids = rubricCriteria().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('matches the guide\'s category weights', () => {
    const catPoints = Object.fromEntries(QA_RUBRIC.map((cat) => [
      cat.id, cat.criteria.reduce((s, c) => s + c.points, 0),
    ]));
    expect(catPoints).toEqual({
      opening: 10, verification: 10, callControl: 10, docReason: 10,
      communication: 15, activeListening: 10, knowledge: 15, scheduling: 15, closing: 5,
    });
  });
});

// ── verifyEvidence ───────────────────────────────────────────────────────────

describe('verifyEvidence', () => {
  it('accepts a verbatim quote', () => {
    expect(verifyEvidence(TRANSCRIPT, 'this is Dana')).toBe(true);
  });

  it('accepts a quote with different punctuation/casing', () => {
    expect(verifyEvidence(TRANSCRIPT, 'THANK YOU FOR CALLING, AIZER-HEALTH')).toBe(true);
  });

  it('rejects an invented quote', () => {
    expect(verifyEvidence(TRANSCRIPT, 'I verified your insurance already')).toBe(false);
  });

  it('rejects empty evidence', () => {
    expect(verifyEvidence(TRANSCRIPT, '')).toBe(false);
    expect(verifyEvidence(TRANSCRIPT, null)).toBe(false);
  });

  it('accepts a 4+ word quote whose words all appear in one turn', () => {
    expect(verifyEvidence(TRANSCRIPT, 'pulling up the schedule now I am')).toBe(false); // spans phrasing not in one turn ("I am" vs "I'm")
    expect(verifyEvidence(TRANSCRIPT, 'schedule the pulling now up')).toBe(true); // same words, one turn
  });

  it('does not word-match short quotes across the call', () => {
    expect(verifyEvidence(TRANSCRIPT, 'survey Dana')).toBe(false);
  });

  it('strips a role-label prefix from the quote', () => {
    expect(verifyEvidence(TRANSCRIPT, 'Navigator: this is Dana')).toBe(true);
  });

  it('accepts a stitched multi-line quote when one fragment is genuine', () => {
    expect(verifyEvidence(TRANSCRIPT, 'a line never said...stay on the line for our survey')).toBe(true);
    expect(verifyEvidence(TRANSCRIPT, 'a line never said\nNavigator: pulling up the schedule')).toBe(true);
    expect(verifyEvidence(TRANSCRIPT, '"anything else I can help with" "a line never said"')).toBe(true);
    // Paraphrased sentence stitched to a verbatim one (observed live): the
    // genuine sentence after the "?" boundary carries the evidence.
    expect(verifyEvidence(
      [...TRANSCRIPT, { role: 'navigator', text: 'Wonderful. Thank you for calling Aizer Health, and have a great day!' }],
      'Is there anything more I could help with? Thank you for calling Aizer Health, and have a great day!',
    )).toBe(true);
  });

  it('rejects a stitched quote where no fragment is genuine', () => {
    expect(verifyEvidence(TRANSCRIPT, 'invented line one...another invented line')).toBe(false);
  });

  it('rejects single-word quotes', () => {
    expect(verifyEvidence(TRANSCRIPT, 'survey')).toBe(false);
  });
});

// ── validateQaResponse ───────────────────────────────────────────────────────

describe('validateQaResponse', () => {
  it('accepts a complete response and normalizes verdict case', () => {
    const parsed = {
      criteria: rubricCriteria().map((c) => ({ id: c.id, verdict: 'met', evidence: 'x', note: '' })),
      autoFails: [],
    };
    const out = validateQaResponse(parsed);
    expect(out.data).toBeTruthy();
    expect(out.data.criteria.every((c) => c.verdict === 'MET')).toBe(true);
  });

  it('rejects a response missing criterion ids', () => {
    const parsed = { criteria: [{ id: 'open-greet', verdict: 'MET', evidence: '', note: '' }], autoFails: [] };
    expect(validateQaResponse(parsed).error).toMatch(/Missing verdicts/);
  });

  it('rejects non-object and missing-criteria input', () => {
    expect(validateQaResponse(null).error).toBeTruthy();
    expect(validateQaResponse({}).error).toBeTruthy();
  });

  it('keeps only known, triggered auto-fails', () => {
    const parsed = {
      criteria: rubricCriteria().map((c) => ({ id: c.id, verdict: 'NOT_MET', evidence: '', note: '' })),
      autoFails: [
        { id: 'af-scope', triggered: true, evidence: 'q', note: '' },
        { id: 'af-hipaa', triggered: false, evidence: '', note: '' },
        { id: 'af-invented', triggered: true, evidence: '', note: '' },
      ],
    };
    const out = validateQaResponse(parsed);
    expect(out.data.autoFails).toHaveLength(1);
    expect(out.data.autoFails[0].id).toBe('af-scope');
  });
});

// ── scoreQa ──────────────────────────────────────────────────────────────────

describe('scoreQa', () => {
  it('scores 100 and passes when everything is MET with verified evidence', () => {
    const qa = scoreQa(allMetVerdicts(), [], TRANSCRIPT);
    expect(qa.score).toBe(100);
    expect(qa.pass).toBe(true);
    expect(qa.autoFails).toHaveLength(0);
  });

  it('downgrades MET with unverifiable evidence to NOT_MET (hard gate)', () => {
    const verdicts = allMetVerdicts().map((v) =>
      v.id === 'know-rule' ? { ...v, evidence: 'a line that was never said' } : v);
    const qa = scoreQa(verdicts, [], TRANSCRIPT);
    const c = qa.criteria.find((x) => x.id === 'know-rule');
    expect(c.verdict).toBe('NOT_MET');
    expect(c.unverified).toBe(true);
    expect(qa.score).toBe(91); // lost 9 points
  });

  it('treats NA on a core criterion as NOT_MET', () => {
    const verdicts = allMetVerdicts().map((v) =>
      v.id === 'close-survey' ? { ...v, verdict: 'NA' } : v);
    const qa = scoreQa(verdicts, [], TRANSCRIPT);
    expect(qa.criteria.find((x) => x.id === 'close-survey').verdict).toBe('NOT_MET');
    expect(qa.score).toBe(97);
  });

  it('removes genuine NA criteria from the denominator', () => {
    const naIds = new Set(['sched-flow', 'sched-recap', 'doc-reason', 'doc-te', 'know-details']);
    const verdicts = allMetVerdicts().map((v) =>
      naIds.has(v.id) ? { ...v, verdict: 'NA' } : v);
    const qa = scoreQa(verdicts, [], TRANSCRIPT);
    expect(qa.score).toBe(100); // earned 69 of 69 applicable
    const sched = qa.categories.find((c) => c.id === 'scheduling');
    expect(sched.applicablePoints).toBe(0);
  });

  it('fails below the pass threshold', () => {
    const failing = new Set(['know-rule', 'sched-flow']); // 17 points gone → 83
    const verdicts = allMetVerdicts().map((v) =>
      failing.has(v.id) ? { ...v, verdict: 'NOT_MET' } : v);
    const qa = scoreQa(verdicts, [], TRANSCRIPT);
    expect(qa.score).toBeLessThan(QA_PASS_THRESHOLD);
    expect(qa.pass).toBe(false);
  });

  it('a verified auto-fail zeroes the score and fails the test', () => {
    const qa = scoreQa(allMetVerdicts(), [{ id: 'af-scope', evidence: 'this is Dana', note: '' }], TRANSCRIPT);
    expect(qa.score).toBe(0);
    expect(qa.rawScore).toBe(100);
    expect(qa.pass).toBe(false);
    expect(qa.autoFails).toHaveLength(1);
  });

  it('ignores an auto-fail whose evidence does not verify (anti-hallucination)', () => {
    const qa = scoreQa(allMetVerdicts(), [{ id: 'af-conduct', evidence: 'you are an idiot', note: '' }], TRANSCRIPT);
    expect(qa.score).toBe(100);
    expect(qa.pass).toBe(true);
    expect(qa.autoFails).toHaveLength(0);
  });
});

// ── buildGradeProjection ─────────────────────────────────────────────────────

describe('buildGradeProjection', () => {
  it('projects a pass into the interview grade shape', () => {
    const grade = buildGradeProjection(scoreQa(allMetVerdicts(), [], TRANSCRIPT));
    expect(grade.score).toBe(100);
    expect(grade.summary).toMatch(/PASSED/);
    expect(grade.strengths.length).toBeGreaterThan(0);
    expect(grade.improvements).toHaveLength(0);
  });

  it('leads improvements with the auto-fail', () => {
    const qa = scoreQa(allMetVerdicts(), [{ id: 'af-hipaa', evidence: 'this is Dana', note: '' }], TRANSCRIPT);
    const grade = buildGradeProjection(qa);
    expect(grade.score).toBe(0);
    expect(grade.summary).toMatch(/automatic fail/i);
    expect(grade.improvements[0]).toMatch(/^AUTO-FAIL/);
  });
});

// ── buildMessages ────────────────────────────────────────────────────────────

describe('grade-call-qa buildMessages', () => {
  it('includes every rubric and auto-fail id in the system instruction', () => {
    const { systemInstruction } = buildMessages('scenario', TRANSCRIPT, 'pediatrics');
    for (const c of rubricCriteria()) expect(systemInstruction).toContain(`[${c.id}]`);
    for (const a of QA_AUTO_FAILS) expect(systemInstruction).toContain(`[${a.id}]`);
  });

  it('labels transcript roles as Caller/Navigator', () => {
    const { userMessage } = buildMessages('scenario', TRANSCRIPT, 'pediatrics');
    expect(userMessage).toContain('Caller: Hi, I need a checkup');
    expect(userMessage).toContain('Navigator: Good morning');
  });
});
