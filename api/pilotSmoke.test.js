import { describe, expect, it, vi } from 'vitest';
import {
  buildPilotSmokeCases,
  evaluatePilotSmokeCases,
  PILOT_SMOKE_FAILED,
  PILOT_SMOKE_VERIFIED,
  runPilotSmoke,
} from '../scripts/call-qa/pilot-smoke.mjs';
import { evaluateCleanPassCandidate } from './_qa-automation-policy.js';

describe('Call QA pilot smoke workflow', () => {
  it('verifies 12-16 rehearsed cases across required outcomes, departments, and Phase 3 behavior', async () => {
    const cases = await buildPilotSmokeCases();
    const report = evaluatePilotSmokeCases(cases);
    expect(cases).toHaveLength(15);
    expect(report).toMatchObject({
      status: PILOT_SMOKE_VERIFIED,
      caseCount: 15,
      departments: ['obgyn', 'pediatrics'],
      nonProduction: true,
      calibrationAuthority: 'none',
      failures: [],
    });
    expect(report.categories).toEqual(expect.arrayContaining([
      'pass',
      'fail',
      'safety-violation',
      'needs-review',
      'incomplete-capture',
      'abandoned-capture',
    ]));
    expect(report.phase3.complete).toBeGreaterThan(0);
    expect(report.phase3.incomplete).toBeGreaterThan(0);
  });

  it('fails visibly when required rehearsal coverage is missing', async () => {
    const cases = (await buildPilotSmokeCases())
      .filter((item) => item.category !== 'abandoned-capture');
    const report = evaluatePilotSmokeCases(cases);
    expect(report.status).toBe(PILOT_SMOKE_FAILED);
    expect(report.failures).toContain('missing-category:abandoned-capture');
  });

  it('fails when a rehearsal label does not match the fixture behavior', async () => {
    const cases = await buildPilotSmokeCases();
    cases[0].category = 'safety-violation';
    expect(evaluatePilotSmokeCases(cases).failures)
      .toContain('smoke-peds-pass:category-mismatch');
  });

  it('prints the explicit status and has no readiness or automation authority', async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const result = await runPilotSmoke({ io });
    expect(result.exitCode).toBe(0);
    expect(io.log).toHaveBeenCalledWith(PILOT_SMOKE_VERIFIED);
    expect(result.report).not.toHaveProperty('readiness');
    expect(result.report).not.toHaveProperty('approvedPopulation');

    const eligibility = evaluateCleanPassCandidate({}, result.report);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain('unsupported-calibration-policy');
    expect(eligibility.reasons).toContain('calibration-not-ready');
  });
});
