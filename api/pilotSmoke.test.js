import { describe, expect, it, vi } from 'vitest';
import {
  buildPilotSmokeCases,
  evaluatePilotSmokeCases,
  forScenario,
  PILOT_SMOKE_FAILED,
  PILOT_SMOKE_VERIFIED,
  runPilotSmoke,
} from '../scripts/call-qa/pilot-smoke.mjs';
import { evaluateCleanPassCandidate } from './_qa-automation-policy.js';
import { SYNTHETIC_CALIBRATION_SCENARIOS } from './_qa-calibration-scenarios.js';
import { getQaRubricProfile } from '../src/data/qaRubricProfiles.js';

describe('Call QA pilot smoke workflow', () => {
  it('verifies 12-16 rehearsed cases across required outcomes, departments, and Phase 3 behavior', async () => {
    const cases = await buildPilotSmokeCases();
    const report = evaluatePilotSmokeCases(cases);
    expect(cases).toHaveLength(15);
    expect(report).toMatchObject({
      status: PILOT_SMOKE_VERIFIED,
      caseCount: 15,
      departments: ['obgyn', 'pediatrics'],
      rolloutDepartments: ['obgyn'],
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

  it('does not require Pediatrics coverage (outside the scored rollout) but does require OB/GYN', async () => {
    const all = await buildPilotSmokeCases();
    const noPeds = all.filter((item) => item.fixture.department !== 'pediatrics');
    const pedsReport = evaluatePilotSmokeCases(noPeds);
    expect(pedsReport.failures).not.toContainEqual(expect.stringContaining('missing-department:pediatrics'));

    const noObgyn = all.filter((item) => item.fixture.department !== 'obgyn');
    const obgynReport = evaluatePilotSmokeCases(noObgyn);
    expect(obgynReport.failures).toContain('missing-department:obgyn');
  });

  it('fails visibly when required rehearsal coverage is missing', async () => {
    const cases = (await buildPilotSmokeCases())
      .filter((item) => item.category !== 'abandoned-capture');
    const report = evaluatePilotSmokeCases(cases);
    expect(report.status).toBe(PILOT_SMOKE_FAILED);
    expect(report.failures).toContain('missing-category:abandoned-capture');
  });

  it('fails when every grade-failed rehearsal is missing', async () => {
    const cases = (await buildPilotSmokeCases())
      .filter((item) => item.category !== 'grade-failed');
    const report = evaluatePilotSmokeCases(cases);
    expect(report.status).toBe(PILOT_SMOKE_FAILED);
    expect(report.failures).toContain('missing-category:grade-failed');
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

// ── Department fixture integrity (2026-07-21 correction) ────────────────────
//
// The previous implementation translated an old Pediatrics closing verdict onto
// OB/GYN's `close-offer-help`. Those criteria are NOT semantically equivalent —
// a polite goodbye was acceptable under the old rule and must fail the new one —
// so the remap could have concealed exactly the change pilot smoke exists to
// exercise. These tests pin the replacement behavior.

describe('pilot smoke uses real per-department fixtures, not translated labels', () => {
  it('refuses to retarget a fixture onto another department', async () => {
    const cases = await buildPilotSmokeCases();
    const obgyn = cases.find((item) => item.fixture.department === 'obgyn');
    expect(() => forScenario(obgyn.fixture, 'x', 'synthetic-peds-refill-01'))
      .toThrow(/refusing to retarget|not translatable/i);
  });

  it('every case uses a fixture from its own department', async () => {
    for (const item of await buildPilotSmokeCases()) {
      const scenario = SYNTHETIC_CALIBRATION_SCENARIOS.find((s) => s.id === item.fixture.scenarioId);
      expect(item.fixture.department, item.fixture.caseId).toBe(scenario.department);
    }
  });

  it('OB/GYN cases are labelled with the OB/GYN rubric, never Pediatrics closing ids', async () => {
    const obgynProfile = getQaRubricProfile('obgyn');
    for (const item of await buildPilotSmokeCases()) {
      if (item.fixture.department !== 'obgyn' || !item.fixture.humanReview) continue;
      const labelled = Object.keys(item.fixture.humanReview.adjudicated.criteria);
      expect(labelled).toContain('close-offer-help');
      expect(labelled).not.toContain('close-survey');
      expect(labelled).not.toContain('close-anything-thanks');
      expect(item.fixture.modelRun.rubricVersion).toBe(obgynProfile.rubricVersion);
    }
  });

  it('an OB/GYN close-offer-help label matches what the transcript actually does', async () => {
    // The point of the correction: the LABEL must be backed by real transcript
    // behavior, not inherited from a different criterion.
    const offersHelp = (fixture) => fixture.transcript.some((turn) =>
      turn.role === 'navigator' && /anything else i can (help|assist)/i.test(turn.text));

    for (const item of await buildPilotSmokeCases()) {
      if (item.fixture.department !== 'obgyn' || !item.fixture.humanReview) continue;
      const verdict = item.fixture.humanReview.adjudicated.criteria['close-offer-help'];
      if (verdict === 'MET') {
        expect(offersHelp(item.fixture), `${item.fixture.caseId} claims MET`).toBe(true);
      }
      if (verdict === 'NOT_MET') {
        expect(offersHelp(item.fixture), `${item.fixture.caseId} claims NOT_MET`).toBe(false);
      }
    }
  });

  it('a polite goodbye can never be translated into an OB/GYN offer of help', async () => {
    // Directly exercise the semantics the old remap violated: an OB/GYN call
    // that only says thanks/goodbye must carry NOT_MET, and its transcript must
    // genuinely lack an offer.
    const cases = await buildPilotSmokeCases();
    const fail = cases.find((item) => item.fixture.caseId === 'smoke-obgyn-fail');
    expect(fail.fixture.humanReview.adjudicated.criteria['close-offer-help']).toBe('NOT_MET');
    expect(fail.fixture.transcript.some((turn) =>
      turn.role === 'navigator' && /anything else/i.test(turn.text))).toBe(false);
    expect(fail.fixture.transcript.some((turn) =>
      turn.role === 'navigator' && /goodbye/i.test(turn.text))).toBe(true);
  });

  it('actual additional-help wording earns MET on the OB/GYN pass case', async () => {
    const cases = await buildPilotSmokeCases();
    const pass = cases.find((item) => item.fixture.caseId === 'smoke-obgyn-pass');
    expect(pass.fixture.humanReview.adjudicated.criteria['close-offer-help']).toBe('MET');
    expect(pass.fixture.transcript.some((turn) =>
      turn.role === 'navigator' && /anything else i can help/i.test(turn.text))).toBe(true);
  });

  it('survey wording is absent from every OB/GYN rehearsal transcript', async () => {
    for (const item of await buildPilotSmokeCases()) {
      if (item.fixture.department !== 'obgyn') continue;
      for (const turn of item.fixture.transcript ?? []) {
        expect(turn.text).not.toMatch(/survey/i);
      }
    }
  });
});
