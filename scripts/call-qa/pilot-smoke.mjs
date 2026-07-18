import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCalibrationFixture } from '../../api/_qa-calibration.js';
// The runtime bank is PRIVATE (Admin-only Firestore). Pilot smoke uses only the
// committed non-production synthetic descriptors — it needs no Firestore access
// and can never see a production scenario instance.
import {
  SYNTHETIC_CALIBRATION_SCENARIOS,
  scenarioResolverFrom,
} from '../../api/_qa-calibration-scenarios.js';
import { isActiveQaInterview } from '../../src/lib/phases.js';

export const PILOT_SMOKE_VERIFIED = 'PILOT_SMOKE_VERIFIED';
export const PILOT_SMOKE_FAILED = 'PILOT_SMOKE_FAILED';

const FIXTURE_DIRECTORY = new URL('../../api/fixtures/call-qa-calibration/', import.meta.url);

async function readExample(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURE_DIRECTORY), 'utf8'));
}

const getSyntheticScenario = scenarioResolverFrom(SYNTHETIC_CALIBRATION_SCENARIOS);

function forScenario(base, caseId, scenarioId) {
  const scenario = getSyntheticScenario(scenarioId);
  return {
    ...structuredClone(base),
    caseId,
    department: scenario.department,
    scenarioId: scenario.id,
    workflowType: scenario.workflowType,
    difficulty: scenario.difficulty,
  };
}

function generalFail(base, caseId, scenarioId) {
  const fixture = forScenario(base, caseId, scenarioId);
  fixture.humanReview.reviewers.forEach((reviewer) => { reviewer.autoFails = []; });
  fixture.humanReview.adjudicated.autoFails = [];
  fixture.modelRun.autoFails = [];
  return fixture;
}

function operationalFailure(caseId, scenarioId, captureStatus, gradingStatus) {
  const scenario = getSyntheticScenario(scenarioId);
  return {
    formatVersion: 1,
    caseId,
    source: 'operational-pilot',
    sanitized: true,
    department: scenario.department,
    scenarioId: scenario.id,
    workflowType: scenario.workflowType,
    difficulty: scenario.difficulty,
    capture: {
      captureStatus,
      captureComplete: captureStatus === 'captured',
      captureVersion: 'call-qa-live-transcript-v1',
      liveModel: 'gemini-live-rehearsal',
      gradingStatus,
      warnings: captureStatus === 'capture_incomplete' ? ['missing-turn-complete'] : [],
      navigatorTurnCount: 0,
      callerTurnCount: 0,
    },
    transcript: [],
  };
}

function smokeCase(category, fixture, phase3Complete, extra = {}) {
  return {
    category,
    evidenceUse: 'synthetic-rehearsal-only',
    phase3Complete,
    fixture,
    ...extra,
  };
}

export async function buildPilotSmokeCases() {
  const [pass, fail, review] = await Promise.all([
    readExample('example-pass.json'),
    readExample('example-fail.json'),
    readExample('example-review.json'),
  ]);
  return [
    smokeCase('pass', forScenario(pass, 'smoke-peds-pass', 'synthetic-peds-refill-01'), true),
    smokeCase('pass', forScenario(pass, 'smoke-obgyn-pass', 'synthetic-obgyn-refill-01'), true),
    smokeCase('fail', generalFail(fail, 'smoke-peds-fail', 'synthetic-peds-scheduling-01'), true),
    smokeCase('fail', generalFail(fail, 'smoke-obgyn-fail', 'synthetic-obgyn-new-gyn-01'), true),
    smokeCase('safety-violation', forScenario(fail, 'smoke-peds-safety', 'synthetic-peds-urgent-boundary-01'), true),
    smokeCase('safety-violation', forScenario(fail, 'smoke-obgyn-safety', 'synthetic-obgyn-results-boundary-01'), true),
    smokeCase('needs-review', forScenario(review, 'smoke-peds-review', 'synthetic-peds-urgent-boundary-01'), true),
    smokeCase('needs-review', forScenario(review, 'smoke-obgyn-review', 'synthetic-obgyn-mfm-01'), true),
    smokeCase('incomplete-capture', operationalFailure(
      'smoke-peds-incomplete', 'synthetic-peds-unclear-01', 'capture_incomplete', 'not_started',
    ), false),
    smokeCase('incomplete-capture', operationalFailure(
      'smoke-obgyn-incomplete', 'synthetic-obgyn-unclear-01', 'capture_incomplete', 'not_started',
    ), false),
    smokeCase('abandoned-capture', operationalFailure(
      'smoke-peds-abandoned', 'synthetic-peds-records-01', 'abandoned', 'not_started',
    ), false),
    smokeCase('abandoned-capture', operationalFailure(
      'smoke-obgyn-abandoned', 'synthetic-obgyn-records-01', 'abandoned', 'not_started',
    ), false),
    smokeCase('grade-failed', operationalFailure(
      'smoke-peds-grade-failed', 'synthetic-peds-referral-01', 'captured', 'grade_failed',
    ), false),
    smokeCase('grade-failed', operationalFailure(
      'smoke-obgyn-grade-failed', 'synthetic-obgyn-pregnancy-01', 'captured', 'grade_failed',
    ), false),
    smokeCase(
      'phase3-archived',
      forScenario(pass, 'smoke-peds-archived', 'synthetic-peds-insurance-01'),
      false,
      { qaArchived: true },
    ),
  ];
}

function phase3Interview(item) {
  // Mirrors the navigator-safe projected server Call QA row: Phase 3 requires
  // assessmentType 'call-qa' plus a saved qa result (see src/lib/phases.js).
  return {
    assessmentType: 'call-qa',
    department: item.fixture.department,
    qa: item.fixture.modelRun ? {
      pass: item.fixture.modelRun.pass,
      score: item.fixture.modelRun.score,
      review: { recommendation: item.fixture.modelRun.recommendation },
    } : undefined,
    qaArchived: item.qaArchived === true,
  };
}

function categoryMatches(item) {
  const fixture = item?.fixture;
  const recommendation = fixture?.modelRun?.recommendation;
  const autoFails = fixture?.modelRun?.autoFails ?? [];
  return {
    pass: recommendation === 'pass',
    fail: recommendation === 'fail' && autoFails.length === 0,
    'safety-violation': recommendation === 'fail' && autoFails.length > 0,
    'needs-review': recommendation === 'needs_review',
    'incomplete-capture': fixture?.capture?.captureStatus === 'capture_incomplete',
    'abandoned-capture': fixture?.capture?.captureStatus === 'abandoned',
    'grade-failed': fixture?.capture?.gradingStatus === 'grade_failed',
    'phase3-archived': item?.qaArchived === true,
  }[item?.category] === true;
}

export function evaluatePilotSmokeCases(cases) {
  const failures = [];
  if (!Array.isArray(cases) || cases.length < 12 || cases.length > 16) {
    failures.push(`case-count:${cases?.length ?? 0}/12-16`);
  }
  const ids = new Set();
  const categories = new Set();
  const departments = new Set();
  let phase3Complete = 0;
  let phase3Incomplete = 0;

  for (const [index, item] of (cases ?? []).entries()) {
    const fixture = item?.fixture;
    if (item?.evidenceUse !== 'synthetic-rehearsal-only') {
      failures.push(`case-${index}:invalid-evidence-use`);
    }
    const validation = validateCalibrationFixture(fixture, { scenarios: SYNTHETIC_CALIBRATION_SCENARIOS });
    if (!validation.valid) failures.push(`${fixture?.caseId ?? `case-${index}`}:${validation.errors.join('; ')}`);
    if (ids.has(fixture?.caseId)) failures.push(`${fixture?.caseId}:duplicate-case-id`);
    ids.add(fixture?.caseId);
    categories.add(item?.category);
    departments.add(fixture?.department);
    if (!categoryMatches(item)) failures.push(`${fixture?.caseId}:category-mismatch`);

    const actualPhase3 = isActiveQaInterview(phase3Interview(item), fixture?.department);
    if (actualPhase3) phase3Complete += 1;
    else phase3Incomplete += 1;
    if (actualPhase3 !== item?.phase3Complete) {
      failures.push(`${fixture?.caseId}:phase3-expected-${item?.phase3Complete}`);
    }
  }

  for (const category of [
    'pass',
    'fail',
    'safety-violation',
    'needs-review',
    'incomplete-capture',
    'abandoned-capture',
    'grade-failed',
  ]) {
    if (!categories.has(category)) failures.push(`missing-category:${category}`);
  }
  for (const department of ['pediatrics', 'obgyn']) {
    if (!departments.has(department)) failures.push(`missing-department:${department}`);
  }
  if (!phase3Complete || !phase3Incomplete) failures.push('phase3-behavior-not-exercised');

  return {
    status: failures.length ? PILOT_SMOKE_FAILED : PILOT_SMOKE_VERIFIED,
    caseCount: cases?.length ?? 0,
    departments: [...departments].sort(),
    categories: [...categories].sort(),
    phase3: { complete: phase3Complete, incomplete: phase3Incomplete },
    failures,
    nonProduction: true,
    calibrationAuthority: 'none',
  };
}

export async function runPilotSmoke({ cases, io = console } = {}) {
  const report = evaluatePilotSmokeCases(cases ?? await buildPilotSmokeCases());
  io.log(report.status);
  io.log(`Cases: ${report.caseCount}; departments: ${report.departments.join(', ')}`);
  if (report.failures.length) report.failures.forEach((failure) => io.error(failure));
  return { exitCode: report.failures.length ? 1 : 0, report };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runPilotSmoke()
    .then(({ exitCode }) => { process.exitCode = exitCode; })
    .catch((error) => {
      console.error(PILOT_SMOKE_FAILED);
      console.error(error.message);
      process.exitCode = 1;
    });
}
