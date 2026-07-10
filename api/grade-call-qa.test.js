// Tests for the QA-test rubric pipeline (api/_qa-rubric.js + grade-call-qa
// prompt builder). All pure functions — no Gemini, no network.

import { describe, it, expect } from 'vitest';
import {
  QA_RUBRIC, QA_AUTO_FAILS, QA_PASS_THRESHOLD, QA_REVIEW_MARGIN, rubricCriteria,
  verifyEvidence, validateQaResponse, getRefillWorkflowSignals, repairQaVerdictsForScenario, scoreQa, assessQa, buildGradeProjection,
} from './_qa-rubric.js';
import { buildMessages, finalizeQaResult } from './grade-call-qa.js';
import { COMPETENCY_IDS } from '../src/data/competencies.js';
import { DOMAINS } from '../src/data/questions.js';

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

  it('tags every criterion with valid domainIds and competencyIds', () => {
    const domainIds = new Set(DOMAINS.map((d) => d.id));
    for (const criterion of rubricCriteria()) {
      expect(Array.isArray(criterion.domainIds)).toBe(true);
      expect(criterion.domainIds.length).toBeGreaterThan(0);
      expect(Array.isArray(criterion.competencyIds)).toBe(true);
      expect(criterion.competencyIds.length).toBeGreaterThan(0);
      for (const domainId of criterion.domainIds) expect(domainIds.has(domainId)).toBe(true);
      for (const competencyId of criterion.competencyIds) expect(COMPETENCY_IDS.has(competencyId)).toBe(true);
    }
  });

  it('tags every auto-fail with valid domainIds and competencyIds', () => {
    const domainIds = new Set(DOMAINS.map((d) => d.id));
    for (const autoFail of QA_AUTO_FAILS) {
      expect(Array.isArray(autoFail.domainIds)).toBe(true);
      expect(autoFail.domainIds.length).toBeGreaterThan(0);
      expect(Array.isArray(autoFail.competencyIds)).toBe(true);
      expect(autoFail.competencyIds.length).toBeGreaterThan(0);
      for (const domainId of autoFail.domainIds) expect(domainIds.has(domainId)).toBe(true);
      for (const competencyId of autoFail.competencyIds) expect(COMPETENCY_IDS.has(competencyId)).toBe(true);
    }
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

describe('finalizeQaResult', () => {
  it('adds QA-only domain/competency scores and a scoring version without changing pass/fail', () => {
    const scored = scoreQa(allMetVerdicts(), [], TRANSCRIPT);
    const { qa, grade } = finalizeQaResult(scored, TRANSCRIPT, 0);
    expect(qa.pass).toBe(scored.pass);
    expect(qa.score).toBe(scored.score);
    expect(qa.domainScoreVersion).toBe('2026-07-09-v1');
    expect(qa.domainScores.intake).toEqual(expect.objectContaining({ score: 100 }));
    expect(qa.competencyScores.communication).toEqual(expect.objectContaining({ score: 100 }));
    expect(grade.score).toBe(scored.score);
  });
});

describe('repairQaVerdictsForScenario', () => {
  const refillTranscript = [
    { role: 'navigator', text: 'What is the medication name?' },
    { role: 'navigator', text: 'Which pharmacy do you prefer?' },
    { role: 'navigator', text: 'I will send this request to the refill team and mark it urgent because she is out.' },
  ];
  const repairedVerdicts = () => allMetVerdicts().map((criterion) => criterion.id === 'know-rule'
    ? { ...criterion, verdict: 'NOT_MET', evidence: '', note: 'The navigator failed to ask about the patient PE status.' }
    : criterion.id === 'doc-te'
      ? { ...criterion, verdict: 'NOT_MET', evidence: '', note: 'The transcript does not contain evidence that the navigator routed or logged a Telephone Encounter.' }
      : criterion);

  it('restores PE-only refill knowledge and natural routing wording without changing other rules', () => {
    const repaired = repairQaVerdictsForScenario(
      { criteria: repairedVerdicts(), autoFails: [] }, refillTranscript,
      { scenario: 'A standard pediatric medication refill.', department: 'pediatrics', metadata: { workflowType: 'prescription_refill' } },
    );
    expect(repaired.criteria.find((c) => c.id === 'know-rule').verdict).toBe('MET');
    expect(repaired.criteria.find((c) => c.id === 'doc-te').evidence).toContain('send this request');
    expect(repaired.repairs.map((repair) => repair.rule)).toEqual(expect.arrayContaining([
      'standard-refill-no-pe-requirement', 'natural-message-routing-wording',
    ]));
  });

  it('does not repair an incomplete or over-promised refill', () => {
    const incomplete = refillTranscript.filter((turn) => !turn.text.includes('pharmacy'));
    const repaired = repairQaVerdictsForScenario(
      { criteria: repairedVerdicts(), autoFails: [] }, incomplete,
      { scenario: 'A standard pediatric medication refill.', department: 'pediatrics', metadata: { workflowType: 'prescription_refill' } },
    );
    expect(repaired.repairs).toHaveLength(0);
    const promised = refillTranscript.map((turn) => turn.text.includes('send this')
      ? { ...turn, text: 'I will make sure the doctor approves it and sends it today.' } : turn);
    expect(repairQaVerdictsForScenario(
      { criteria: repairedVerdicts(), autoFails: [] }, promised,
      { scenario: 'A standard pediatric medication refill.', department: 'pediatrics', metadata: { workflowType: 'prescription_refill' } },
    ).repairs).toHaveLength(0);
  });

  it('keeps PE requirements when the scenario is a referral', () => {
    const repaired = repairQaVerdictsForScenario(
      { criteria: repairedVerdicts(), autoFails: [] }, refillTranscript,
      { scenario: 'A pediatric referral where physical exam status is the governing issue.', department: 'pediatrics', metadata: { workflowType: 'referral' } },
    );
    expect(repaired.criteria.find((c) => c.id === 'know-rule').verdict).toBe('NOT_MET');
  });

  it('does not treat a provider mention as a routing action', () => {
    const transcript = [
      { role: 'navigator', text: 'What is the medication name?' },
      { role: 'navigator', text: 'Which pharmacy do you prefer?' },
      { role: 'navigator', text: 'Which provider prescribed it?' },
    ];
    const repaired = repairQaVerdictsForScenario(
      { criteria: repairedVerdicts(), autoFails: [] }, transcript,
      { scenario: 'A standard pediatric medication refill.', department: 'pediatrics', metadata: { workflowType: 'prescription_refill' } },
    );
    expect(repaired.criteria.find((c) => c.id === 'doc-te').verdict).toBe('NOT_MET');
    expect(repaired.repairs.some((repair) => repair.criterionId === 'doc-te')).toBe(false);
  });

  it('accepts an action plus destination as natural routing evidence', () => {
    const transcript = [
      { role: 'navigator', text: 'What is the medication name?' },
      { role: 'navigator', text: 'Which pharmacy do you prefer?' },
      { role: 'navigator', text: 'I will send this request to the refill team and mark it urgent because she is out.' },
    ];
    const repaired = repairQaVerdictsForScenario(
      { criteria: repairedVerdicts(), autoFails: [] }, transcript,
      { scenario: 'A standard pediatric medication refill.', department: 'pediatrics', metadata: { workflowType: 'prescription_refill' } },
    );
    expect(repaired.criteria.find((c) => c.id === 'doc-te')).toMatchObject({ verdict: 'MET', evidence: expect.stringContaining('send this request') });
    expect(repaired.repairs.some((repair) => repair.rule === 'natural-message-routing-wording')).toBe(true);
  });

  it('does not treat standalone nurse or provider wording as routing evidence', () => {
    expect(getRefillWorkflowSignals([
      { role: 'navigator', text: 'Was it the nurse who called you?' },
      { role: 'navigator', text: 'Who is the provider on the bottle?' },
    ]).naturalRoutingLine).toBeNull();
  });

  it.each([
    'Did you send this request already?',
    'Can you send this request to the pharmacy?',
    'Could you message the nurse?',
    'Was this request forwarded to the provider?',
    'Did someone put in a note?',
    'Has the team received the message?',
    'Do you want me to send a request?',
    'Should I put in a note?',
    'Maybe the nurse can call.',
    'Someone should send the request.',
    'You can send a request.',
    'The caller said the nurse would call.',
  ])('rejects routing questions, history, or hypotheticals: %s', (line) => {
    expect(getRefillWorkflowSignals([{ role: 'navigator', text: line }]).naturalRoutingLine).toBeNull();
  });

  it.each([
    'I’ll send this request to the refill team.',
    'I will send a message to the nurse.',
    'I’m going to route this to the clinical team.',
    'I can put in a message for the provider.',
    'Let me send this over.',
    'I’m forwarding the request now.',
    'We’ll put in a note.',
    'I’ll let the nurse know.',
    'I’ll have the team follow up.',
    'The team will call you back.',
    'The provider will review the request.',
    'PEDS Encounters will review the message.',
  ])('accepts a committed routing or follow-up line: %s', (line) => {
    expect(getRefillWorkflowSignals([{ role: 'navigator', text: line }]).naturalRoutingLine).toBe(line);
  });

  it('never uses caller wording as routing evidence', () => {
    expect(getRefillWorkflowSignals([
      { role: 'patient', text: 'I will send a message to the nurse.' },
      { role: 'navigator', text: 'Which provider prescribed it?' },
    ]).naturalRoutingLine).toBeNull();
  });

  it('does not repair doc-te from a routing question', () => {
    const transcript = [
      { role: 'navigator', text: 'What is the medication name?' },
      { role: 'navigator', text: 'Which pharmacy do you prefer?' },
      { role: 'navigator', text: 'Did you send this request already?' },
    ];
    const repaired = repairQaVerdictsForScenario(
      { criteria: repairedVerdicts(), autoFails: [] }, transcript,
      { scenario: 'A standard pediatric medication refill.', department: 'pediatrics', metadata: { workflowType: 'prescription_refill' } },
    );
    expect(getRefillWorkflowSignals(transcript).naturalRoutingLine).toBeNull();
    expect(repaired.criteria.find((criterion) => criterion.id === 'doc-te').verdict).toBe('NOT_MET');
    expect(repaired.repairs.some((repair) => repair.criterionId === 'doc-te')).toBe(false);
  });

  it('distinguishes safe expectations from a real approval promise', () => {
    const safeLine = 'The team will review it and follow up, but I cannot promise approval or exact timing.';
    expect(getRefillWorkflowSignals([{ role: 'navigator', text: safeLine }])).toMatchObject({
      naturalRoutingLine: safeLine,
      overPromise: false,
    });
    expect(getRefillWorkflowSignals([
      { role: 'navigator', text: 'I can’t guarantee it will be completed today.' },
    ]).overPromise).toBe(false);
    const transcript = [
      { role: 'navigator', text: 'What is the medication name?' },
      { role: 'navigator', text: 'Which pharmacy do you prefer?' },
      { role: 'navigator', text: 'I will make sure the doctor approves it and sends it today.' },
    ];
    expect(getRefillWorkflowSignals(transcript).overPromise).toBe(true);
    expect(repairQaVerdictsForScenario(
      { criteria: repairedVerdicts(), autoFails: [] }, transcript,
      { scenario: 'A standard pediatric medication refill.', department: 'pediatrics', metadata: { workflowType: 'prescription_refill' } },
    ).repairs).toHaveLength(0);
  });

  it.each([
    [
      [refillTranscript[1], refillTranscript[2]],
      'missing medication',
    ],
    [
      [refillTranscript[0], refillTranscript[2]],
      'missing pharmacy',
    ],
    [
      [refillTranscript[0], refillTranscript[1], { role: 'navigator', text: 'I will send this request to the referral coordinator.' }],
      'wrong destination',
    ],
    [
      [...refillTranscript, { role: 'navigator', text: 'You should take twice the dose until then.' }],
      'clinical advice',
    ],
  ])('does not repair an unsafe or incomplete refill: %s', (transcript) => {
    expect(repairQaVerdictsForScenario(
      { criteria: repairedVerdicts(), autoFails: [] }, transcript,
      { scenario: 'A standard pediatric medication refill.', department: 'pediatrics', metadata: { workflowType: 'prescription_refill' } },
    ).repairs).toHaveLength(0);
  });

  // ── Hardened gates (evidence-model re-review) ──────────────────────────────

  const repairContext = { scenario: 'A standard pediatric medication refill.', department: 'pediatrics', metadata: { workflowType: 'prescription_refill' } };
  const withRoutingLine = (text) => [refillTranscript[0], refillTranscript[1], { role: 'navigator', text }];

  it.each([
    'I will go ahead and send this request over to the billing team.',
    'I will send this to the front desk, they handle it.',
    'Let me forward this to the records team.',
    'I am sending this over to the scheduling team.',
  ])('never repairs from a commitment to a wrong destination: %s', (line) => {
    const repaired = repairQaVerdictsForScenario(
      { criteria: repairedVerdicts(), autoFails: [] }, withRoutingLine(line), repairContext,
    );
    expect(repaired.repairs).toHaveLength(0);
    expect(repaired.criteria.find((c) => c.id === 'doc-te').verdict).toBe('NOT_MET');
    expect(repaired.criteria.find((c) => c.id === 'know-rule').verdict).toBe('NOT_MET');
  });

  it('never repairs from a destination-less commitment ("I\'ll send it")', () => {
    expect(repairQaVerdictsForScenario(
      { criteria: repairedVerdicts(), autoFails: [] }, withRoutingLine("Okay, I'll send it right now."), repairContext,
    ).repairs).toHaveLength(0);
  });

  it.each([
    'I can send it to the nurse — do you want me to?',
    'Would you like me to put in a message for the provider?',
    'I could route this to the clinical team if you want me to.',
  ])('never treats an offer-question as a commitment: %s', (line) => {
    expect(getRefillWorkflowSignals([{ role: 'navigator', text: line }]).committedRoutingLine ?? null).toBeNull();
  });

  it('does not repair know-rule when the grader note mixes PE with another failure', () => {
    const mixedNote = (note) => allMetVerdicts().map((criterion) => criterion.id === 'know-rule'
      ? { ...criterion, verdict: 'NOT_MET', evidence: '', note } : criterion);
    for (const note of [
      'Did not verify PE status and routed the request to the wrong queue.',
      'Did not check the physical exam status; also skipped identity verification (no identifiers collected).',
      'PE status not confirmed and the preferred pharmacy was never collected.',
    ]) {
      expect(repairQaVerdictsForScenario(
        { criteria: mixedNote(note), autoFails: [] }, refillTranscript, repairContext,
      ).repairs).toHaveLength(0);
    }
  });

  it('does not repair doc-te when the grader says the routing was WRONG (not just unworded)', () => {
    const verdicts = allMetVerdicts().map((criterion) => criterion.id === 'doc-te'
      ? { ...criterion, verdict: 'NOT_MET', evidence: '', note: 'The navigator did not say a Telephone Encounter was created and routed the request to the wrong destination.' }
      : criterion);
    expect(repairQaVerdictsForScenario(
      { criteria: verdicts, autoFails: [] }, refillTranscript, repairContext,
    ).repairs).toHaveLength(0);
  });

  it('records the original grader verdict, note, and evidence on every repair', () => {
    const repaired = repairQaVerdictsForScenario(
      { criteria: repairedVerdicts(), autoFails: [] }, refillTranscript, repairContext,
    );
    expect(repaired.repairs.length).toBeGreaterThan(0);
    for (const repair of repaired.repairs) {
      expect(repair.originalVerdict).toBe('NOT_MET');
      expect(repair.originalNote.length).toBeGreaterThan(0);
      expect(repair.originalEvidence).toBeDefined();
    }
  });

  it('safe deferral language ("I can\'t tell you if it\'s safe to wait") is not clinical advice', () => {
    expect(getRefillWorkflowSignals([
      { role: 'navigator', text: "I can't tell you whether it's safe to wait — that's a question for the nurse." },
    ]).clinicalAdvice).toBe(false);
    expect(getRefillWorkflowSignals([
      { role: 'navigator', text: "It's safe to give her another dose tonight." },
    ]).clinicalAdvice).toBe(true);
  });

  it('"I\'ll definitely pass this along to the nurse" is not an over-promise', () => {
    expect(getRefillWorkflowSignals([
      { role: 'navigator', text: "I'll definitely pass this along to the nurse right away." },
    ]).overPromise).toBe(false);
    expect(getRefillWorkflowSignals([
      { role: 'navigator', text: 'It will definitely be approved by tomorrow.' },
    ]).overPromise).toBe(true);
  });
});

describe('assessQa — repair outcome-flip gate', () => {
  const flipTranscript = [
    { role: 'navigator', text: 'What is the medication name?' },
    { role: 'navigator', text: 'Which pharmacy do you prefer?' },
    { role: 'navigator', text: 'I will send this request to the refill team and mark it urgent because she is out.' },
    { role: 'patient', text: 'Thank you.' },
  ];

  function scoredWithRepairs(extraNotMet = []) {
    const verdicts = allMetVerdicts().map((c) => {
      if (c.id === 'know-rule' || c.id === 'doc-te') {
        return { ...c, verdict: 'MET', evidence: 'I will send this request to the refill team and mark it urgent because she is out.' };
      }
      if (extraNotMet.includes(c.id)) return { ...c, verdict: 'NOT_MET', evidence: '', note: 'Missed.' };
      return { ...c, verdict: 'MET', evidence: 'I will send this request to the refill team and mark it urgent because she is out.' };
    });
    return scoreQa(verdicts, [], flipTranscript);
  }

  const repairs = [
    { criterionId: 'know-rule', rule: 'standard-refill-no-pe-requirement', from: 'NOT_MET', to: 'MET', reason: 'r', evidence: 'e', originalVerdict: 'NOT_MET', originalNote: 'n', originalEvidence: '' },
    { criterionId: 'doc-te', rule: 'natural-message-routing-wording', from: 'NOT_MET', to: 'MET', reason: 'r', evidence: 'e', originalVerdict: 'NOT_MET', originalNote: 'n', originalEvidence: '' },
  ];

  it('a repair that flips fail→pass forces needs_review with the repair-changed-outcome flag', () => {
    // Score 95 (outside the borderline band): with the 13 repaired points
    // removed the call would have scored 82 and failed, so only the flip gate
    // can produce the needs_review here.
    const qa = scoredWithRepairs(['comm-empathy']);
    expect(qa.pass).toBe(true);
    expect(qa.score).toBe(95);
    const review = assessQa(qa, flipTranscript, { repairs });
    expect(review.reviewFlags.map((f) => f.id)).toContain('repair-changed-outcome');
    expect(review.recommendation).toBe('needs_review');
  });

  it('a repair that does not change the outcome keeps a confident pass', () => {
    const qa = scoredWithRepairs([]);
    expect(qa.pass).toBe(true);
    const review = assessQa(qa, flipTranscript, { repairs });
    expect(review.reviewFlags.map((f) => f.id)).not.toContain('repair-changed-outcome');
    expect(review.reviewFlags.map((f) => f.id)).toContain('fairness-repair-applied');
    expect(review.recommendation).toBe('pass');
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
    expect(systemInstruction).toMatch(/system-visible/i);
    expect(systemInstruction).toMatch(/send the request/i);
    expect(systemInstruction).toMatch(/send a message/i);
    expect(systemInstruction).toMatch(/exact TE/i);
  });
});
