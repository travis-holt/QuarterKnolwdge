// Tests for the QA-test rubric pipeline (api/_qa-rubric.js + grade-call-qa
// prompt builder). All pure functions — no Gemini, no network.

import { describe, it, expect } from 'vitest';
import {
  QA_RUBRIC, QA_AUTO_FAILS, QA_PASS_THRESHOLD, QA_REVIEW_MARGIN, rubricCriteria,
  verifyEvidence, validateQaResponse, scoreQa, assessQa, buildGradeProjection,
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

  it('keeps unverified auto-fail reports instead of dropping them silently', () => {
    const qa = scoreQa(allMetVerdicts(), [{ id: 'af-scope', evidence: 'an invented offending line', note: '' }], TRANSCRIPT);
    expect(qa.unverifiedAutoFails).toHaveLength(1);
    expect(qa.unverifiedAutoFails[0].id).toBe('af-scope');
    expect(qa.pass).toBe(true); // it still must not fail the navigator
  });
});

// ── assessQa (confidence + supervisor-review layer) ──────────────────────────

describe('assessQa', () => {
  const clean = () => scoreQa(allMetVerdicts(), [], TRANSCRIPT);

  it('gives a clean strong pass high confidence and no flags', () => {
    const review = assessQa(clean(), TRANSCRIPT, { correctedTurns: 0 });
    expect(review).toEqual({
      recommendation: 'pass', confidence: 'high', safetyRisk: 'none', reviewFlags: [],
    });
  });

  it('recommends fail for a clear miss with high confidence', () => {
    const failing = new Set(['comm-plain', 'comm-professional', 'comm-empathy', 'sched-flow', 'sched-recap']); // −30 → 70
    const verdicts = allMetVerdicts().map((v) => (failing.has(v.id) ? { ...v, verdict: 'NOT_MET' } : v));
    const qa = scoreQa(verdicts, [], TRANSCRIPT);
    const review = assessQa(qa, TRANSCRIPT, { correctedTurns: 0 });
    expect(review.recommendation).toBe('fail');
    expect(review.confidence).toBe('high');
  });

  it('flags a borderline score for review even when it technically passes', () => {
    const drop = new Set(['comm-empathy', 'listen-ack']); // −10 → 90, within the margin
    const verdicts = allMetVerdicts().map((v) => (drop.has(v.id) ? { ...v, verdict: 'NOT_MET' } : v));
    const qa = scoreQa(verdicts, [], TRANSCRIPT);
    expect(Math.abs(qa.score - QA_PASS_THRESHOLD)).toBeLessThanOrEqual(QA_REVIEW_MARGIN);
    const review = assessQa(qa, TRANSCRIPT, { correctedTurns: 0 });
    expect(review.recommendation).toBe('needs_review');
    expect(review.reviewFlags.some((f) => f.id === 'borderline-score')).toBe(true);
  });

  it('surfaces an unverified auto-fail as a critical review flag instead of losing it', () => {
    const qa = scoreQa(allMetVerdicts(), [{ id: 'af-scope', evidence: 'a line never said', note: '' }], TRANSCRIPT);
    const review = assessQa(qa, TRANSCRIPT, { correctedTurns: 0 });
    expect(review.recommendation).toBe('needs_review'); // score is 100, but safety comes first
    expect(review.safetyRisk).toBe('critical');
    expect(review.reviewFlags.some((f) => f.id === 'possible-unsafe-behavior')).toBe(true);
  });

  it('a verified auto-fail recommends fail, critical risk, with a supervisor-confirmation flag', () => {
    const qa = scoreQa(allMetVerdicts(), [{ id: 'af-hipaa', evidence: 'this is Dana', note: '' }], TRANSCRIPT);
    const review = assessQa(qa, TRANSCRIPT, { correctedTurns: 0 });
    expect(review.recommendation).toBe('fail');
    expect(review.safetyRisk).toBe('critical');
    expect(review.reviewFlags.some((f) => f.id === 'requires-supervisor-judgment')).toBe(true);
  });

  it('flags heavy transcript correction as low transcript confidence', () => {
    const review = assessQa(clean(), TRANSCRIPT, { correctedTurns: 4 });
    expect(review.confidence).toBe('medium');
    expect(review.reviewFlags.some((f) => f.id === 'low-transcript-confidence')).toBe(true);
  });

  it('flags a too-short call as low transcript confidence', () => {
    const shortCall = TRANSCRIPT.slice(0, 3); // navigator turns < 3
    const review = assessQa(clean(), shortCall, { correctedTurns: 0 });
    expect(review.reviewFlags.some((f) => f.id === 'low-transcript-confidence')).toBe(true);
  });

  it('flags unverified grader evidence and reduces confidence', () => {
    const verdicts = allMetVerdicts().map((v) =>
      v.id === 'know-rule' ? { ...v, evidence: 'a line never said' } : v);
    const qa = scoreQa(verdicts, [], TRANSCRIPT);
    const review = assessQa(qa, TRANSCRIPT, { correctedTurns: 0 });
    expect(review.confidence).toBe('medium');
    expect(review.reviewFlags.some((f) => f.id === 'unverified-evidence')).toBe(true);
  });

  it('two confidence hits drop confidence to low and force review', () => {
    const verdicts = allMetVerdicts().map((v) =>
      v.id === 'know-rule' ? { ...v, evidence: 'a line never said' } : v);
    const qa = scoreQa(verdicts, [], TRANSCRIPT);
    const review = assessQa(qa, TRANSCRIPT, { correctedTurns: 4 });
    expect(review.confidence).toBe('low');
    expect(review.recommendation).toBe('needs_review');
  });

  it('flags thin rubric coverage when most non-core criteria are NA', () => {
    const naIds = new Set(['sched-flow', 'sched-recap', 'doc-reason', 'doc-te', 'know-details']); // 31 NA points
    const verdicts = allMetVerdicts().map((v) => (naIds.has(v.id) ? { ...v, verdict: 'NA' } : v));
    const qa = scoreQa(verdicts, [], TRANSCRIPT);
    const review = assessQa(qa, TRANSCRIPT, { correctedTurns: 0 });
    expect(review.reviewFlags.some((f) => f.id === 'thin-coverage')).toBe(true);
  });

  it('a missed safety-critical criterion elevates risk and blocks an unreviewed pass', () => {
    const verdicts = allMetVerdicts().map((v) =>
      v.id === 'verify-three' ? { ...v, verdict: 'NOT_MET' } : v); // −6 → 94, still passing
    const qa = scoreQa(verdicts, [], TRANSCRIPT);
    expect(qa.pass).toBe(true);
    const review = assessQa(qa, TRANSCRIPT, { correctedTurns: 0 });
    expect(review.safetyRisk).toBe('elevated');
    expect(review.recommendation).toBe('needs_review');
    expect(review.reviewFlags.some((f) => f.id === 'safety-criterion-missed')).toBe(true);
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
    expect(grade.improvements[0]).toContain('"this is Dana"'); // transcript evidence travels with the finding
  });

  it('quotes the transcript evidence in improvement notes', () => {
    const verdicts = allMetVerdicts().map((v) =>
      v.id === 'know-rule'
        ? { ...v, verdict: 'NOT_MET', evidence: 'You are all set for Tuesday at 9', note: 'Wrong slot per PE frequency rule.' }
        : v);
    const grade = buildGradeProjection(scoreQa(verdicts, [], TRANSCRIPT));
    const item = grade.improvements.find((s) => s.startsWith('Knowledge'));
    expect(item).toContain('Wrong slot per PE frequency rule.');
    expect(item).toContain('"You are all set for Tuesday at 9"');
  });

  it('marks a needs_review result in the stored summary', () => {
    const qa = scoreQa(allMetVerdicts(), [{ id: 'af-scope', evidence: 'a line never said', note: '' }], TRANSCRIPT);
    const review = assessQa(qa, TRANSCRIPT, { correctedTurns: 0 });
    const grade = buildGradeProjection({ ...qa, review });
    expect(grade.summary).toMatch(/FLAGGED FOR SUPERVISOR REVIEW/);
    expect(grade.summary).toMatch(/unconfirmed/i);
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

  it('instructs context-aware judgment and SOP-rule citation in notes', () => {
    const { systemInstruction } = buildMessages('scenario', TRANSCRIPT, 'obgyn');
    expect(systemInstruction).toContain('CONTEXT-AWARE JUDGMENT');
    expect(systemInstruction).toMatch(/NAME the specific SOP rule/);
    expect(systemInstruction).toMatch(/pregnancy-related call routes differently/);
    expect(systemInstruction).toMatch(/lab-result call/i);
  });

  it('does not require PE verification for standard refill calls', () => {
    const { systemInstruction } = buildMessages('scenario', TRANSCRIPT, 'pediatrics');
    expect(systemInstruction).toMatch(/Do NOT require PE verification or deny the refill/);
    expect(systemInstruction).toMatch(/preferred pharmacy/);
  });
});
