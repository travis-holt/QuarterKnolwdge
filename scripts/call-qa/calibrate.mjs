import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCalibrationReport,
  evaluateCalibrationReadiness,
  formatCalibrationMarkdown,
  validateCalibrationFixture,
} from '../../api/_qa-calibration.js';

const DEFAULT_FIXTURES = 'api/fixtures/call-qa-calibration';
const DEFAULT_OUTPUT = 'artifacts/call-qa-calibration';

export function parseArgs(argv) {
  const options = {
    fixtures: DEFAULT_FIXTURES,
    output: DEFAULT_OUTPUT,
    repeat: 1,
    json: false,
    markdown: false,
    coverageOnly: false,
    requireReady: false,
    live: false,
    confirmLive: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fixtures' || arg === '--output' || arg === '--repeat') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else if (arg === '--json') options.json = true;
    else if (arg === '--markdown') options.markdown = true;
    else if (arg === '--coverage-only') options.coverageOnly = true;
    else if (arg === '--require-ready') options.requireReady = true;
    else if (arg === '--live') options.live = true;
    else if (arg === '--confirm-live') options.confirmLive = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  options.repeat = Number(options.repeat);
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 10) {
    throw new Error('--repeat must be an integer from 1 to 10');
  }
  return options;
}

export async function loadCalibrationFixtures(directory) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const fixtures = [];
  const errors = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    let fixture;
    try {
      fixture = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      errors.push(`${entry.name}: invalid JSON (${error.message})`);
      continue;
    }
    const validation = validateCalibrationFixture(fixture);
    if (!validation.valid) {
      errors.push(`${entry.name}:\n  ${validation.errors.join('\n  ')}`);
      continue;
    }
    fixtures.push(fixture);
  }
  if (errors.length) throw new Error(`Calibration fixture validation failed:\n${errors.join('\n')}`);
  return fixtures;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function modelRunFromQa(qa) {
  return {
    model: qa.gradingMetadata.model,
    rubricVersion: qa.gradingMetadata.rubricVersion,
    promptVersion: qa.gradingMetadata.promptVersion,
    scenarioVersion: qa.gradingMetadata.scenarioVersion,
    recommendation: qa.review.recommendation,
    pass: qa.pass,
    score: qa.score,
    criteria: qa.criteria.map((criterion) => ({
      id: criterion.id,
      verdict: criterion.verdict,
      ...(criterion.unresolved ? { unresolved: true } : {}),
      ...(criterion.unverified ? { unverified: true } : {}),
    })),
    autoFails: qa.autoFails.map((autoFail) => autoFail.id),
    reviewFlags: qa.review.reviewFlags.map((flag) => flag.id),
    correctedTurns: qa.correctedTurns ?? 0,
  };
}

function stabilityFor(runs) {
  const recommendations = new Set(runs.map((run) => run.qa.review.recommendation));
  const scores = runs.map((run) => run.qa.score);
  const autoFails = new Set(runs.map((run) =>
    run.qa.autoFails.map((item) => item.id).sort().join(',')));
  const criterionIds = new Set(runs.flatMap((run) => run.qa.criteria.map((criterion) => criterion.id)));
  let stableCriteria = 0;
  for (const id of criterionIds) {
    const verdicts = new Set(runs.map((run) =>
      run.qa.criteria.find((criterion) => criterion.id === id)?.verdict ?? 'missing'));
    if (verdicts.size === 1) stableCriteria += 1;
  }
  return {
    finalVerdictStable: recommendations.size === 1,
    criterionVerdictStability: criterionIds.size ? stableCriteria / criterionIds.size : 0,
    score: {
      minimum: Math.min(...scores),
      maximum: Math.max(...scores),
      variation: Math.max(...scores) - Math.min(...scores),
    },
    reviewRecommendationVariation: [...recommendations].sort(),
    autoFailStable: autoFails.size === 1,
  };
}

async function runLive(fixtures, options, deps, io) {
  const env = deps.env ?? process.env;
  if (env.CALL_QA_CALIBRATION_LIVE !== 'true') {
    throw new Error('--live requires CALL_QA_CALIBRATION_LIVE=true');
  }
  if (!options.confirmLive) throw new Error('--live requires --confirm-live');
  const keyText = String(env.GEMINI_API_KEYS || env.GEMINI_API_KEY || '').trim();
  if (!keyText) throw new Error('--live requires GEMINI_API_KEYS or GEMINI_API_KEY');
  const keys = keyText.split(',').map((key) => key.trim()).filter(Boolean);
  const requestCount = fixtures.length * options.repeat;
  io.log(`Live calibration grading runs: ${requestCount} (up to ${requestCount * 2} model requests if malformed-response retries occur)`);
  const [
    { gradeCallQaTranscript, resolveQaScenarioContext },
    { sopContextFor },
    { getCallQaScenarioById },
  ] = await Promise.all([
    import('../../api/grade-call-qa.js'),
    import('../../api/_sop-context.js'),
    import('../../src/data/callQaScenarios.js'),
  ]);
  const grade = deps.gradeCallQaTranscript ?? gradeCallQaTranscript;
  const liveCases = [];
  const calibratedFixtures = [];

  for (const fixture of fixtures) {
    const scenario = getCallQaScenarioById(fixture.scenarioId);
    const scenarioContext = resolveQaScenarioContext({
      scenario: scenario.scenario,
      department: fixture.department,
      qaScenarioId: fixture.scenarioId,
    });
    const runs = [];
    for (let repeat = 0; repeat < options.repeat; repeat += 1) {
      runs.push(await grade({
        transcript: fixture.transcript,
        scenarioContext,
        captureMetadata: fixture.capture,
        transcriptMetadata: {
          authority: 'local-sanitized-fixture',
          captureVersion: fixture.capture.captureVersion,
          liveModel: fixture.capture.liveModel,
          captureStatus: fixture.capture.captureStatus,
          captureComplete: fixture.capture.captureComplete,
        },
      }, {
        keys,
        sopContextForFresh: async (department) => sopContextFor(department),
      }));
    }
    liveCases.push({
      caseId: fixture.caseId,
      runs,
      stability: stabilityFor(runs),
    });
    calibratedFixtures.push({
      ...fixture,
      capture: { ...fixture.capture, gradingStatus: 'graded' },
      modelRun: modelRunFromQa(runs[0].qa),
    });
  }
  return {
    report: buildCalibrationReport(calibratedFixtures),
    liveRuns: {
      requestCount,
      repeat: options.repeat,
      cases: liveCases,
    },
  };
}

function summary(report) {
  const readiness = report.readiness;
  return [
    `Call QA calibration: ${readiness.state}`,
    `Human cases: ${report.evidenceSummary.evaluatedHumanCaseCount}`,
    `Synthetic examples excluded: ${report.evidenceSummary.syntheticExampleCount}`,
    `Coverage gaps: ${report.coverage.flags.length}`,
    report.evidenceSummary.note,
  ].join('\n');
}

export async function runCalibrationCli(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const io = deps.io ?? console;
  const fixturesDirectory = path.resolve(deps.cwd ?? process.cwd(), options.fixtures);
  const outputDirectory = path.resolve(deps.cwd ?? process.cwd(), options.output);
  const fixtures = await loadCalibrationFixtures(fixturesDirectory);
  let report;
  let liveRuns = null;
  if (options.live) {
    ({ report, liveRuns } = await runLive(fixtures, options, deps, io));
  } else {
    report = buildCalibrationReport(fixtures);
  }
  report.readiness = evaluateCalibrationReadiness(report);
  if (options.coverageOnly) report.coverageOnly = true;
  const markdown = formatCalibrationMarkdown(report);

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'report.json'), stableJson(report));
  await writeFile(path.join(outputDirectory, 'report.md'), markdown);
  if (liveRuns) await writeFile(path.join(outputDirectory, 'live-runs.json'), stableJson(liveRuns));

  if (options.json) io.log(stableJson(report).trimEnd());
  if (options.markdown) io.log(markdown.trimEnd());
  if (!options.json && !options.markdown) io.log(summary(report));

  const ready = report.readiness.state === 'READY_FOR_CLEAN_PASS_CONSIDERATION';
  return { exitCode: options.requireReady && !ready ? 1 : 0, report, outputDirectory };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCalibrationCli()
    .then(({ exitCode }) => { process.exitCode = exitCode; })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
