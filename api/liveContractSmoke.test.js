// Offline coverage test for the live model-contract smoke command. It never
// invokes Gemini or Firestore — it only asserts the synthetic case set covers
// the required contract scenarios and is privacy-safe by construction.

import { describe, it, expect } from 'vitest';
import {
  LIVE_CONTRACT_SMOKE_CASES, liveSmokeApiKeys, runLiveContractSmoke,
} from '../scripts/call-qa/live-contract-smoke.mjs';

describe('qa:live-contract-smoke case coverage', () => {
  it('covers all ten required contract scenarios', () => {
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
    ]);
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
    const met = { criteria: [{ id: 'verify-three', verdict: 'MET' }] };
    const notMet = { criteria: [{ id: 'verify-three', verdict: 'NOT_MET' }] };
    const caseOne = LIVE_CONTRACT_SMOKE_CASES.find((c) => c.id === '1-volunteered-one-turn');
    expect(caseOne.check(met)).toBe(true);
    expect(typeof caseOne.check(notMet)).toBe('string');
    // The failure message is a rule description, never an identifier value.
    expect(caseOne.check(notMet)).not.toMatch(/Maria|Alvarez|1991/);
  });
});

describe('qa:live-contract-smoke gate behavior', () => {
  it('ignores generic application keys', () => {
    expect(liveSmokeApiKeys({ GEMINI_API_KEY: 'application-key', GEMINI_API_KEYS: 'pool' })).toEqual([]);
  });

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

  it('dedicated smoke key runs all ten cases through injected transport and prints only safe markers', async () => {
    const lines = [];
    const grade = async ({ transcript }) => {
      const text = transcript.map((turn) => turn.text).join(' ');
      const badIdentity = /Sarah Jones|Maria Smith and|without a date|Dr\. Reyes about my results/i.test(text)
        || !/Maria/i.test(text) || !/Alvarez/i.test(text)
        || !/(?:date of birth.{0,12}|born\s+)March/i.test(text);
      const hasHelp = /anything else I can help/i.test(text);
      return { qa: { criteria: [
        { id: 'verify-three', verdict: badIdentity ? 'NOT_MET' : 'MET' },
        { id: 'close-offer-help', verdict: hasHelp ? 'MET' : 'NOT_MET' },
        { id: 'comm-empathy', verdict: 'NA' },
        { id: 'control-narrate', verdict: 'NA' },
      ] } };
    };
    const code = await runLiveContractSmoke({
      env: { CALL_QA_LIVE_SMOKE_API_KEY: 'dedicated-test-key' }, grade,
      write: (line) => lines.push(line),
    });
    const output = lines.join('\n');
    expect(code).toBe(0);
    expect(output).toContain('LIVE_CONTRACT_SMOKE_VERIFIED');
    expect(output).not.toMatch(/Maria|Alvarez|1991|dedicated-test-key/);
  });

  it('failed semantic case exits nonzero with FAILED marker', async () => {
    const lines = [];
    const code = await runLiveContractSmoke({
      env: { CALL_QA_LIVE_SMOKE_API_KEY: 'dedicated-test-key' },
      grade: async () => ({ qa: { criteria: [] } }),
      write: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('LIVE_CONTRACT_SMOKE_FAILED');
  });
});
