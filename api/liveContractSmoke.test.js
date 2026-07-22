// Offline coverage test for the live model-contract smoke command. It never
// invokes Gemini or Firestore — it only asserts the synthetic case set covers
// the required contract scenarios and is privacy-safe by construction.

import { describe, it, expect } from 'vitest';
import { LIVE_CONTRACT_SMOKE_CASES } from '../scripts/call-qa/live-contract-smoke.mjs';

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
