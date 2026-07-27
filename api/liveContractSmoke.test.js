// Offline coverage test for the live model-contract smoke command. It never
// invokes Gemini or Firestore — it only asserts the synthetic case set covers
// the required contract scenarios, is privacy-safe by construction, and that the
// dedicated-key resolution and gate markers behave.

import { describe, it, expect } from 'vitest';
import {
  LIVE_CONTRACT_SMOKE_CASES, liveSmokeApiKeys, runLiveContractSmoke,
} from '../scripts/call-qa/live-contract-smoke.mjs';

describe('qa:live-contract-smoke case coverage', () => {
  it('covers all twenty-four required contract scenarios in order', () => {
    const ids = LIVE_CONTRACT_SMOKE_CASES.map((c) => c.id);
    expect(ids).toEqual([
      '1-volunteered-one-turn',
      '2-separate-one-word-answers',
      '3-third-party-patient',
      '4-callers-own-dob-different-patient',
      '5-names-from-two-patients',
      '6-missing-dob',
      '7-provider-name-near-patient',
      '8-explicit-help-close',
      '9-thanks-only-close',
      '10-routine-empathy-na',
      '11-identity-before-repeated-after',
      '12-safe-refusal-not-a-disclosure',
      '13-safe-line-then-genuine-disclosure',
      '14-full-identity-before-disclosure-clean',
      '15-partial-identity-before-disclosure',
      '16-no-identity-before-disclosure',
      '17-model-false-positive-after-verification',
      '18-model-false-negative-before-verification',
      '19-provider-name-ambiguity',
      '20-third-party-dob-ownership',
      // v9 navigator-visible chart + applicability coverage (2026-07-24).
      '21-no-order-correct-no-booking',
      '22-no-order-wrong-booking',
      // v10 caller-volunteered facts and repetitive-question contrast.
      '23-transfer-volunteered-gestational-age',
      '24-transfer-repetitive-pregnancy-question',
    ]);
  });

  // The grader prompt moved to v9, so the gate must actually exercise the NEW
  // contract — rerunning the v7/v8 identity cases under a v9 label would prove
  // nothing about the chart / applicability rules.
  describe('v9 navigator-visible chart cases', () => {
    const v9Ids = ['21-no-order-correct-no-booking', '22-no-order-wrong-booking'];
    const v9Cases = () => v9Ids.map((id) => LIVE_CONTRACT_SMOKE_CASES.find((c) => c.id === id));

    it('sends a real NAVIGATOR-VISIBLE CHART and never any hidden chart facts', () => {
      for (const testCase of v9Cases()) {
        expect(testCase.gradingScenario).toMatch(/NAVIGATOR-VISIBLE CHART/);
        expect(testCase.gradingScenario).not.toMatch(/HIDDEN CHART FACTS/);
        // Explicit negatives — the facts the correct no-booking workflow needs.
        expect(testCase.gradingScenario).toMatch(/Active orders: None on file/);
        expect(testCase.gradingScenario).toMatch(/Future appointments: None on file/);
        // A section the synthetic chart never supplied is never asserted at all.
        expect(testCase.gradingScenario).not.toMatch(/Open Telephone Encounters/);
      }
    });

    it('case 21 requires sched-recap NA and refuses to fail listen-gather on a chart fact', () => {
      const [correct] = v9Cases();
      const base = {
        autoFails: [], unverifiedAutoFails: [], review: { recommendation: 'pass', reviewFlags: [] },
        criteria: [
          { id: 'sched-recap', verdict: 'NA' }, { id: 'listen-gather', verdict: 'MET' },
          { id: 'know-rule', verdict: 'MET' }, { id: 'sched-flow', verdict: 'NA' },
          { id: 'verify-three', verdict: 'MET' },
        ],
      };
      expect(correct.check(base)).toBe(true);
      // Recapping an appointment that should not exist must not be demanded.
      const recapDemanded = { ...base, criteria: base.criteria.map((c) => (c.id === 'sched-recap' ? { ...c, verdict: 'NOT_MET' } : c)) };
      expect(typeof correct.check(recapDemanded)).toBe('string');
      // Nor may the chart-sourced fact be charged to listen-gather.
      const gatherFailed = { ...base, criteria: base.criteria.map((c) => (c.id === 'listen-gather' ? { ...c, verdict: 'NOT_MET' } : c)) };
      expect(typeof correct.check(gatherFailed)).toBe('string');
      // Declining to book without an order is the CORRECT outcome.
      const flowFailed = { ...base, criteria: base.criteria.map((c) => (c.id === 'sched-flow' ? { ...c, verdict: 'NOT_MET' } : c)) };
      expect(typeof correct.check(flowFailed)).toBe('string');
    });

    it('case 22 requires the wrong booking to be caught WITHOUT a second sched-recap penalty', () => {
      const [, wrongBooking] = v9Cases();
      const caught = {
        autoFails: [], unverifiedAutoFails: [], review: { recommendation: 'fail', reviewFlags: [] },
        criteria: [{ id: 'sched-flow', verdict: 'NOT_MET' }, { id: 'sched-recap', verdict: 'NA' }],
      };
      expect(wrongBooking.check(caught)).toBe(true);
      // know-rule alone also counts as capturing the wrong workflow.
      expect(wrongBooking.check({
        ...caught,
        criteria: [{ id: 'know-rule', verdict: 'NOT_MET' }, { id: 'sched-recap', verdict: 'NA' }],
      })).toBe(true);
      // Double-penalizing via sched-recap is rejected.
      expect(typeof wrongBooking.check({
        ...caught,
        criteria: [{ id: 'sched-flow', verdict: 'NOT_MET' }, { id: 'sched-recap', verdict: 'NOT_MET' }],
      })).toBe('string');
      // Letting the wrong booking pass entirely is rejected.
      expect(typeof wrongBooking.check({
        ...caught,
        criteria: [{ id: 'sched-flow', verdict: 'MET' }, { id: 'sched-recap', verdict: 'NA' }],
      })).toBe('string');
    });

    it('keeps every prior identity/privacy case alongside the new ones', () => {
      expect(LIVE_CONTRACT_SMOKE_CASES.length).toBe(24);
      expect(LIVE_CONTRACT_SMOKE_CASES.filter((c) => c.gradingScenario).length).toBe(2);
    });
  });

  it('every case has a synthetic transcript and a check function', () => {
    for (const testCase of LIVE_CONTRACT_SMOKE_CASES) {
      expect(Array.isArray(testCase.transcript)).toBe(true);
      expect(testCase.transcript.length).toBeGreaterThan(1);
      expect(typeof testCase.check).toBe('function');
      expect(['obgyn', 'pediatrics']).toContain(testCase.department);
    }
  });

  it('a check returns true on a satisfying scorecard and a message otherwise', () => {
    const caseOne = LIVE_CONTRACT_SMOKE_CASES.find((c) => c.id === '1-volunteered-one-turn');
    const good = {
      criteria: [{ id: 'verify-three', verdict: 'MET' }, { id: 'verify-before-access', verdict: 'MET' }],
      autoFails: [], unverifiedAutoFails: [], review: { recommendation: 'pass', reviewFlags: [] },
    };
    const bad = { ...good, criteria: [{ id: 'verify-three', verdict: 'NOT_MET' }] };
    expect(caseOne.check(good)).toBe(true);
    expect(typeof caseOne.check(bad)).toBe('string');
    // The failure message is a rule description, never an identifier value.
    expect(caseOne.check(bad)).not.toMatch(/Maria|Alvarez|1991/);
  });
});

// A CORRECT model + deterministic pipeline produces these scorecards for each
// synthetic case. Keyed by case id so the intended outcome is explicit; the
// runner matches a case by transcript reference.
function qaFor(id) {
  const verds = (over = {}) => ({
    'verify-three': 'MET', 'verify-before-access': 'MET', 'close-offer-help': 'MET',
    'comm-empathy': 'NA', 'control-narrate': 'NA', ...over,
  });
  const build = (v, { autoFails = [], unverifiedAutoFails = [], reviewFlags = [], recommendation = 'pass', safetyRisk = 'none', pass = true } = {}) => ({
    criteria: Object.entries(v).map(([cid, verdict]) => ({ id: cid, verdict })),
    autoFails, unverifiedAutoFails, review: { recommendation, safetyRisk, reviewFlags }, pass,
  });
  // A verified-af-hipaa fail (one way to satisfy privacyGated).
  const afHipaaFail = (over = {}) => build(verds({ 'verify-before-access': 'NOT_MET', ...over }),
    { autoFails: [{ id: 'af-hipaa' }], recommendation: 'fail', safetyRisk: 'critical', pass: false });
  // A deterministic privacy-conflict critical review (the other way).
  const privacyConflict = (over = {}) => build(verds({ 'verify-before-access': 'NOT_MET', ...over }), {
    unverifiedAutoFails: [{ id: 'af-hipaa', privacyConflict: true }],
    reviewFlags: [{ id: 'deterministic-privacy-conflict' }],
    recommendation: 'needs_review', safetyRisk: 'critical', pass: false,
  });
  switch (id) {
    case '4-callers-own-dob-different-patient':
    case '5-names-from-two-patients':
    case '6-missing-dob':
    case '7-provider-name-near-patient':
    case '19-provider-name-ambiguity':
      return build(verds({ 'verify-three': 'NOT_MET', 'verify-before-access': 'NOT_MET' }), { recommendation: 'needs_review', pass: false });
    case '9-thanks-only-close':
      return build(verds({ 'close-offer-help': 'NOT_MET' }), { recommendation: 'needs_review', pass: false });
    case '13-safe-line-then-genuine-disclosure':
    case '18-model-false-negative-before-verification':
      return afHipaaFail();
    case '16-no-identity-before-disclosure':
    case '15-partial-identity-before-disclosure':
      return privacyConflict({ 'verify-three': 'NOT_MET' });
    // v9: correct no-order handling — nothing booked, so sched-recap is NA and
    // the chart-sourced fact never counts against listen-gather.
    case '21-no-order-correct-no-booking':
      return build(verds({
        'sched-recap': 'NA', 'sched-flow': 'NA', 'listen-gather': 'MET', 'know-rule': 'MET',
      }));
    // v9: the navigator wrongly booked — caught by sched-flow/know-rule ONLY,
    // never by a second sched-recap penalty.
    case '22-no-order-wrong-booking':
      return build(verds({
        'sched-flow': 'NOT_MET', 'know-rule': 'NOT_MET', 'sched-recap': 'NA', 'listen-gather': 'MET',
      }), { recommendation: 'fail', pass: false });
    case '23-transfer-volunteered-gestational-age':
      return build(verds({ 'listen-gather': 'MET', 'doc-reason': 'MET', 'know-rule': 'MET' }));
    case '24-transfer-repetitive-pregnancy-question':
      return build(verds({ 'listen-ack': 'NOT_MET', 'doc-reason': 'MET', 'know-rule': 'MET' }), { recommendation: 'needs_review', pass: false });
    default:
      // 1,2,3,8,10,11,12,14,17,20 — clean, correct-model scorecards.
      return build(verds());
  }
}

describe('qa:live-contract-smoke dedicated-key resolution', () => {
  it('plural absent, singular present -> singular', () => {
    expect(liveSmokeApiKeys({ CALL_QA_LIVE_SMOKE_API_KEY: 'solo' })).toEqual(['solo']);
  });
  it('plural EMPTY string, singular present -> singular (nullish coalescing bug fixed)', () => {
    expect(liveSmokeApiKeys({ CALL_QA_LIVE_SMOKE_API_KEYS: '', CALL_QA_LIVE_SMOKE_API_KEY: 'solo' })).toEqual(['solo']);
  });
  it('plural whitespace-only, singular present -> singular', () => {
    expect(liveSmokeApiKeys({ CALL_QA_LIVE_SMOKE_API_KEYS: '  , ,  ', CALL_QA_LIVE_SMOKE_API_KEY: 'solo' })).toEqual(['solo']);
  });
  it('plural populated + singular present -> plural (documented precedence)', () => {
    expect(liveSmokeApiKeys({ CALL_QA_LIVE_SMOKE_API_KEYS: 'a,b', CALL_QA_LIVE_SMOKE_API_KEY: 'solo' })).toEqual(['a', 'b']);
  });
  it('duplicate plural keys deduplicate, order preserved', () => {
    expect(liveSmokeApiKeys({ CALL_QA_LIVE_SMOKE_API_KEYS: 'a, b , a' })).toEqual(['a', 'b']);
  });
  it('ignores generic application keys', () => {
    expect(liveSmokeApiKeys({ GEMINI_API_KEY: 'application-key', GEMINI_API_KEYS: 'pool' })).toEqual([]);
  });
});

describe('qa:live-contract-smoke gate behavior', () => {
  it('missing dedicated key is NOT_RUN with a distinct nonzero code', async () => {
    const lines = [];
    expect(await runLiveContractSmoke({ env: {}, write: (line) => lines.push(line) })).toBe(2);
    expect(lines.join('\n')).toContain('LIVE_CONTRACT_SMOKE_NOT_RUN');
  });

  it('explicit allow-skip exits zero but prints SKIPPED, never VERIFIED', async () => {
    const lines = [];
    expect(await runLiveContractSmoke({ env: {}, args: ['--allow-skip'], write: (line) => lines.push(line) })).toBe(0);
    expect(lines.join('\n')).toContain('LIVE_CONTRACT_SMOKE_SKIPPED');
    expect(lines.join('\n')).not.toContain('LIVE_CONTRACT_SMOKE_VERIFIED');
  });

  it('dedicated smoke key runs every case through injected transport and prints only safe markers', async () => {
    const lines = [];
    const grade = async ({ transcript }) => {
      const testCase = LIVE_CONTRACT_SMOKE_CASES.find((c) => c.transcript === transcript);
      return { qa: qaFor(testCase.id) };
    };
    const code = await runLiveContractSmoke({
      env: { CALL_QA_LIVE_SMOKE_API_KEY: 'dedicated-test-key' }, grade,
      write: (line) => lines.push(line),
    });
    const output = lines.join('\n');
    // Surface which case regressed instead of a bare exit-code mismatch.
    expect(lines.filter((l) => l.includes('[FAIL]'))).toEqual([]);
    expect(code).toBe(0);
    expect(output).toContain('LIVE_CONTRACT_SMOKE_VERIFIED');
    expect(output).toContain('call-qa-grader-v10');
    expect(output).not.toMatch(/Maria|Alvarez|1991|dedicated-test-key/);
  });

  it('failed semantic case exits nonzero with FAILED marker', async () => {
    const lines = [];
    const code = await runLiveContractSmoke({
      env: { CALL_QA_LIVE_SMOKE_API_KEY: 'dedicated-test-key' },
      grade: async () => ({ qa: { criteria: [], autoFails: [], unverifiedAutoFails: [], review: { recommendation: 'pass', reviewFlags: [] } } }),
      write: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('LIVE_CONTRACT_SMOKE_FAILED');
  });
});
