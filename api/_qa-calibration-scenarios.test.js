import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  SYNTHETIC_CALIBRATION_SCENARIOS,
  SYNTHETIC_SCENARIO_VERSION,
  scenarioResolverFrom,
  validateScenarioManifest,
} from './_qa-calibration-scenarios.js';
import { buildCalibrationReport, buildScenarioCoverageReport, evaluateCalibrationReadiness } from './_qa-calibration.js';
import { loadPrivateScenarioManifest } from '../scripts/call-qa/calibrate.mjs';
import { DOMAINS } from '../src/data/questions.js';
import { COMPETENCY_IDS } from '../src/data/competencies.js';

describe('synthetic calibration scenario descriptors', () => {
  it('are explicitly non-production with no calibration authority', () => {
    for (const scenario of SYNTHETIC_CALIBRATION_SCENARIOS) {
      expect(scenario.nonProduction).toBe(true);
      expect(scenario.calibrationAuthority).toBe('none');
      expect(scenario.evidenceUse).toBe('synthetic-rehearsal-only');
      expect(scenario.version).toBe(SYNTHETIC_SCENARIO_VERSION);
    }
  });

  it('contain structural metadata only — no runtime instance fields', () => {
    for (const scenario of SYNTHETIC_CALIBRATION_SCENARIOS) {
      for (const field of ['openingLine', 'publicBriefing', 'callerName', 'gradingContext',
        'hiddenChartState', 'callerCaseFile', 'expectedActions', 'criticalMisses', 'scoringNotes']) {
        expect(scenario).not.toHaveProperty(field);
      }
    }
  });

  it('use valid domain and competency ids for both assessed departments', () => {
    const domainIds = new Set(DOMAINS.map((domain) => domain.id));
    const departments = new Set();
    for (const scenario of SYNTHETIC_CALIBRATION_SCENARIOS) {
      departments.add(scenario.department);
      scenario.domainIds.forEach((id) => expect(domainIds.has(id)).toBe(true));
      scenario.competencyIds.forEach((id) => expect(COMPETENCY_IDS.has(id)).toBe(true));
    }
    expect([...departments].sort()).toEqual(['obgyn', 'pediatrics']);
  });

  it('resolves ids and returns null for unknowns', () => {
    const resolve = scenarioResolverFrom();
    expect(resolve('synthetic-peds-refill-01')?.workflowType).toBe('prescription_refill');
    expect(resolve('qa-peds-refill-001')).toBeNull();
  });
});

describe('private scenario manifest validation', () => {
  const entry = {
    id: 'private-x-01', version: 'private-v9', department: 'pediatrics',
    workflowType: 'prescription_refill', difficulty: 'medium',
    domainIds: ['classification'], competencyIds: ['communication'],
  };

  it('accepts metadata-only entries', () => {
    const result = validateScenarioManifest({ scenarios: [entry] });
    expect(result.valid).toBe(true);
    expect(result.scenarios[0]).toMatchObject({ id: 'private-x-01', version: 'private-v9' });
  });

  it('rejects private instance fields so answers cannot enter operator tooling', () => {
    for (const field of ['openingLine', 'gradingContext', 'hiddenChartState', 'callerCaseFile',
      'expectedActions', 'criticalMisses', 'scoringNotes', 'publicBriefing', 'callerName']) {
      const result = validateScenarioManifest({ scenarios: [{ ...entry, [field]: 'leak' }] });
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain(field);
    }
  });

  it('rejects duplicates and incomplete entries', () => {
    expect(validateScenarioManifest({ scenarios: [entry, entry] }).valid).toBe(false);
    expect(validateScenarioManifest({ scenarios: [{ ...entry, id: '' }] }).valid).toBe(false);
    expect(validateScenarioManifest({ scenarios: [{ ...entry, domainIds: [] }] }).valid).toBe(false);
    expect(validateScenarioManifest(null).valid).toBe(false);
  });

  it('loadPrivateScenarioManifest reads and validates an ignored local file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'qa-manifest-'));
    const file = path.join(dir, 'call-qa-private-manifest.json');
    await writeFile(file, JSON.stringify({ scenarios: [entry] }));
    await expect(loadPrivateScenarioManifest(file)).resolves.toHaveLength(1);
    await writeFile(file, JSON.stringify({ scenarios: [{ ...entry, gradingContext: 'leak' }] }));
    await expect(loadPrivateScenarioManifest(file)).rejects.toThrow(/gradingContext/);
  });
});

describe('coverage evidence honesty', () => {
  it('synthetic-only coverage reports missing runtime-bank evidence for rollout departments only', () => {
    const coverage = buildScenarioCoverageReport(SYNTHETIC_CALIBRATION_SCENARIOS, [], {});
    expect(coverage.scenarioEvidence).toBe('synthetic-only');
    const missing = coverage.flags.filter((flag) => flag.id === 'runtime-bank-evidence-missing');
    // OB/GYN is the only scored-rollout department; Pediatrics needs no private bank.
    expect(missing.map((flag) => flag.department)).toEqual(['obgyn']);
  });

  it('a private manifest below the OB/GYN minimum is flagged, at/above is not', () => {
    const short = Array.from({ length: 14 }, (_, index) => ({
      id: `o-${index}`, version: 'v1', department: 'obgyn',
      workflowType: 'prescription_refill', difficulty: 'medium',
      domainIds: ['classification'], competencyIds: ['communication'],
    }));
    const coverage = buildScenarioCoverageReport(short, [], { scenarioEvidence: 'private-manifest' });
    const flags = coverage.flags.filter((flag) => flag.id === 'private-bank-below-minimum');
    expect(flags.map((flag) => flag.department)).toEqual(['obgyn']); // 14 < 15
    expect(coverage.flags.some((flag) => flag.id === 'runtime-bank-evidence-missing')).toBe(false);

    const full = Array.from({ length: 15 }, (_, index) => ({
      id: `o-${index}`, version: 'v1', department: 'obgyn',
      workflowType: 'prescription_refill', difficulty: 'medium',
      domainIds: ['classification'], competencyIds: ['communication'],
    }));
    const fullCoverage = buildScenarioCoverageReport(full, [], { scenarioEvidence: 'private-manifest' });
    expect(fullCoverage.flags.some((flag) => flag.id === 'private-bank-below-minimum')).toBe(false);
  });

  it('readiness without private-bank evidence carries the scenarioEvidence reason', () => {
    const report = buildCalibrationReport([]);
    const readiness = evaluateCalibrationReadiness(report);
    expect(readiness.state).toBe('INSUFFICIENT_DATA');
    expect(readiness.reasons.join(' ')).toContain('scenarioEvidence:synthetic-only');
  });
});
