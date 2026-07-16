import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildCalibrationReport,
  evaluateCalibrationReadiness,
  validateCalibrationFixture,
  wilsonInterval,
} from './_qa-calibration.js';
import { CALL_QA_SCENARIOS } from '../src/data/callQaScenarios.js';

const example = JSON.parse(readFileSync(
  new URL('./fixtures/call-qa-calibration/example-pass.json', import.meta.url),
  'utf8',
));

function calibrationFixture({
  caseId = 'cal-test-001',
  source = 'human-pilot',
  scenario = CALL_QA_SCENARIOS[0],
  human = 'pass',
  model = human,
  humanCriteria = { 'open-greet': 'MET', 'know-rule': 'MET' },
  modelCriteria = humanCriteria,
  humanAutoFails = [],
  modelAutoFails = [],
  modelName = 'gemini-2.5-flash',
  capture = {},
  modelRun = {},
} = {}) {
  const reviewRequired = human === 'needs_review';
  const reviewer = (id) => ({
    reviewerId: id,
    criteria: humanCriteria,
    autoFails: humanAutoFails,
    recommendation: human,
  });
  return {
    formatVersion: 1,
    caseId,
    source,
    sanitized: true,
    department: scenario.department,
    scenarioId: scenario.id,
    workflowType: scenario.workflowType,
    difficulty: scenario.difficulty,
    capture: {
      captureStatus: 'captured',
      captureComplete: true,
      captureVersion: 'call-qa-live-transcript-v1',
      liveModel: 'gemini-live-v1',
      gradingStatus: 'graded',
      warnings: [],
      navigatorTurnCount: 3,
      callerTurnCount: 2,
      ...capture,
    },
    transcript: [
      { role: 'patient', text: 'I need help with this request.' },
      { role: 'navigator', text: 'I can help with that request.' },
      { role: 'patient', text: 'Thank you.' },
      { role: 'navigator', text: 'I will follow the correct workflow.' },
      { role: 'navigator', text: 'Goodbye.' },
    ],
    humanReview: {
      reviewerCount: 2,
      adjudicationStatus: 'complete',
      reviewers: [reviewer('reviewer-a'), reviewer('reviewer-b')],
      adjudicated: {
        criteria: humanCriteria,
        autoFails: humanAutoFails,
        recommendation: human,
        finalPass: reviewRequired ? null : human === 'pass',
        reviewRequired,
      },
    },
    modelRun: {
      model: modelName,
      rubricVersion: 'qa-rubric-v1',
      promptVersion: 'call-qa-grader-v1',
      scenarioVersion: 'call-qa-scenarios-v1',
      recommendation: model,
      pass: model !== 'fail',
      score: model === 'fail' ? 70 : 92,
      criteria: Object.entries(modelCriteria).map(([id, verdict]) => ({ id, verdict })),
      autoFails: modelAutoFails,
      reviewFlags: [],
      correctedTurns: 0,
      ...modelRun,
    },
  };
}

function invalid(mutator) {
  const fixture = structuredClone(calibrationFixture());
  mutator(fixture);
  return validateCalibrationFixture(fixture);
}

describe('validateCalibrationFixture', () => {
  it('accepts the committed synthetic example and a human pilot fixture', () => {
    expect(validateCalibrationFixture(example)).toEqual({ valid: true, errors: [] });
    expect(validateCalibrationFixture(calibrationFixture())).toEqual({ valid: true, errors: [] });
  });

  it('rejects missing adjudication and one human reviewer', () => {
    expect(invalid((fixture) => { fixture.humanReview.adjudicationStatus = 'pending'; }).errors.join(' '))
      .toMatch(/adjudication must be complete/);
    expect(invalid((fixture) => { fixture.humanReview.reviewers.pop(); }).errors.join(' '))
      .toMatch(/at least two reviewers/);
  });

  it('rejects duplicate reviewer ids', () => {
    expect(invalid((fixture) => {
      fixture.humanReview.reviewers[1].reviewerId = 'reviewer-a';
    }).errors.join(' ')).toMatch(/duplicate reviewer ids/);
  });

  it('rejects unknown criteria, scenarios, and department/scenario mismatch', () => {
    expect(invalid((fixture) => {
      fixture.humanReview.adjudicated.criteria.unknown = 'MET';
    }).errors.join(' ')).toMatch(/unknown rubric criterion/);
    expect(invalid((fixture) => { fixture.scenarioId = 'unknown'; }).errors.join(' '))
      .toMatch(/unknown scenario id/);
    expect(invalid((fixture) => { fixture.department = 'obgyn'; }).errors.join(' '))
      .toMatch(/scenario belongs to another department/);
  });

  it('rejects invalid transcript roles, empty transcripts, and unsanitized fixtures', () => {
    expect(invalid((fixture) => { fixture.transcript[0].role = 'caller'; }).errors.join(' '))
      .toMatch(/unknown transcript role/);
    expect(invalid((fixture) => { fixture.transcript = []; }).errors.join(' '))
      .toMatch(/non-empty/);
    expect(invalid((fixture) => { fixture.sanitized = false; }).errors.join(' '))
      .toMatch(/must be true/);
  });

  it('rejects recursive prohibited fields and missing model provenance', () => {
    expect(invalid((fixture) => {
      fixture.humanReview.reviewers[0].metadata = { navigatorId: 'secret' };
    }).errors.join(' ')).toMatch(/prohibited field/);
    expect(invalid((fixture) => { delete fixture.modelRun.promptVersion; }).errors.join(' '))
      .toMatch(/provenance is required/);
  });

  it('rejects unsupported format, capture, and grading states', () => {
    expect(invalid((fixture) => { fixture.formatVersion = 2; }).errors.join(' '))
      .toMatch(/unsupported format version/);
    expect(invalid((fixture) => { fixture.capture.captureStatus = 'done'; }).errors.join(' '))
      .toMatch(/unsupported capture status/);
    expect(invalid((fixture) => { fixture.capture.gradingStatus = 'done'; }).errors.join(' '))
      .toMatch(/unsupported grading status/);
  });

  it('rejects unsupported provenance versions instead of mixing them into calibration', () => {
    expect(invalid((fixture) => { fixture.capture.captureVersion = 'capture-v999'; }).errors.join(' '))
      .toMatch(/unsupported capture version/);
    expect(invalid((fixture) => { fixture.modelRun.rubricVersion = 'rubric-v999'; }).errors.join(' '))
      .toMatch(/unsupported rubric version/);
    expect(invalid((fixture) => { fixture.modelRun.promptVersion = 'prompt-v999'; }).errors.join(' '))
      .toMatch(/unsupported prompt version/);
    expect(invalid((fixture) => { fixture.modelRun.scenarioVersion = 'scenario-v999'; }).errors.join(' '))
      .toMatch(/unsupported scenario version/);
  });
});

describe('calibration metrics', () => {
  const fixtures = [
    calibrationFixture({ caseId: 'c1', human: 'pass', model: 'pass' }),
    calibrationFixture({
      caseId: 'c2',
      human: 'pass',
      model: 'fail',
      modelCriteria: { 'open-greet': 'NOT_MET', 'know-rule': 'NOT_MET' },
      humanAutoFails: ['af-scope'],
    }),
    calibrationFixture({
      caseId: 'c3',
      human: 'fail',
      model: 'pass',
      humanCriteria: { 'open-greet': 'NOT_MET', 'know-rule': 'NOT_MET' },
      modelCriteria: { 'open-greet': 'MET', 'know-rule': 'MET' },
      modelAutoFails: ['af-scope'],
      capture: { warnings: ['turn-count-capped', 'turn-length-capped'] },
    }),
    calibrationFixture({
      caseId: 'c4',
      human: 'fail',
      model: 'fail',
      humanCriteria: { 'open-greet': 'NOT_MET', 'know-rule': 'NOT_MET' },
      modelCriteria: { 'open-greet': 'NOT_MET', 'know-rule': 'NOT_MET' },
      humanAutoFails: ['af-scope'],
      modelAutoFails: ['af-scope'],
    }),
    calibrationFixture({
      caseId: 'c5',
      human: 'needs_review',
      model: 'needs_review',
      humanCriteria: { 'open-greet': 'NA', 'know-rule': 'NA' },
      modelCriteria: { 'open-greet': 'NA', 'know-rule': 'NA' },
      modelRun: { reviewFlags: ['low-transcript-confidence'], correctedTurns: 2 },
    }),
    {
      ...calibrationFixture({ caseId: 'c6' }),
      capture: {
        captureStatus: 'abandoned',
        captureComplete: false,
        captureVersion: 'call-qa-live-transcript-v1',
        liveModel: 'gemini-live-v1',
        gradingStatus: 'grade_failed',
        warnings: ['drain-timeout', 'missing-turn-complete'],
        navigatorTurnCount: 1,
        callerTurnCount: 1,
      },
      modelRun: null,
    },
  ];
  const report = buildCalibrationReport(fixtures);

  it('calculates exact confusion-matrix and final-outcome counts', () => {
    expect(report.confusionMatrix).toMatchObject({
      pass: { pass: 1, fail: 1, review: 0 },
      fail: { pass: 1, fail: 1, review: 0 },
      review: { pass: 0, fail: 0, review: 1 },
    });
    expect(report.finalOutcomes).toMatchObject({
      totalEvaluatedCases: 5,
      agreementCount: 3,
      finalVerdictAgreement: 0.6,
      falsePassCount: 1,
      falsePassRate: 0.5,
      falseFailCount: 1,
      falseFailRate: 0.5,
      reviewMissCount: 0,
      correctEscalationToReviewCount: 1,
    });
  });

  it('calculates criterion and safety-critical agreement', () => {
    expect(report.criterionMetrics.criteria['open-greet']).toMatchObject({
      applicableCaseCount: 4,
      comparedCaseCount: 5,
      agreementCount: 3,
      agreement: 0.6,
      naAgreement: 1,
    });
    expect(report.criterionMetrics.criteria['open-greet'].met).toMatchObject({
      precision: 0.5,
      recall: 0.5,
    });
    expect(report.criterionMetrics.safetyCriticalAgreement).toBe(0.5);
  });

  it('calculates auto-fail precision/recall and capture-integrity rates', () => {
    expect(report.autoFailMetrics.autoFails['af-scope']).toMatchObject({
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 1,
      precision: 0.5,
      recall: 0.5,
    });
    expect(report.autoFailMetrics.totalFalseAutomaticAutoFails).toBe(1);
    expect(report.autoFailMetrics.totalMissedHumanAutoFails).toBe(1);
    expect(report.captureMetrics).toMatchObject({
      totalAttempts: 6,
      abandonedCount: 1,
      gradeFailureCount: 1,
      turnCountCappedCount: 1,
      turnLengthCappedCount: 1,
      drainTimeoutCount: 1,
      missingTurnCompleteCount: 1,
      glossaryCorrectedAttemptCount: 1,
    });
  });

  it('reports department/scenario/workflow and version breakdowns', () => {
    expect(report.operationalBreakdowns.department.pediatrics.count).toBe(5);
    expect(report.operationalBreakdowns.scenario['qa-peds-scheduling-001'].count).toBe(5);
    expect(report.operationalBreakdowns.workflowType.new_appointment_scheduling.count).toBe(5);
    expect(report.versionBreakdowns.graderModel).toEqual([
      { value: 'gemini-2.5-flash', count: 5 },
    ]);
    expect(report.coverage.departments.pediatrics.humanCalibrationCaseCount).toBe(6);
  });

  it('calculates Wilson intervals without dependencies', () => {
    expect(wilsonInterval(0, 10)).toEqual({
      count: 0,
      denominator: 10,
      observedRate: 0,
      lower95: 0,
      upper95: 0.277533,
    });
    expect(wilsonInterval(5, 10)).toEqual({
      count: 5,
      denominator: 10,
      observedRate: 0.5,
      lower95: 0.236593,
      upper95: 0.763407,
    });
  });
});

function sufficientFixtures(count = 640) {
  return Array.from({ length: count }, (_, index) => {
    const scenario = CALL_QA_SCENARIOS[index % CALL_QA_SCENARIOS.length];
    const verdict = ['pass', 'fail', 'needs_review'][index % 3];
    return calibrationFixture({
      caseId: `ready-${String(index).padStart(4, '0')}`,
      scenario,
      human: verdict,
      model: verdict,
      humanCriteria: {
        'verify-three': 'MET',
        'verify-before-access': 'MET',
        'know-rule': 'MET',
        'doc-te': 'MET',
      },
      modelCriteria: {
        'verify-three': 'MET',
        'verify-before-access': 'MET',
        'know-rule': 'MET',
        'doc-te': 'MET',
      },
    });
  });
}

describe('calibration readiness', () => {
  it('perfect results with too few cases remain INSUFFICIENT_DATA', () => {
    const report = buildCalibrationReport(sufficientFixtures(10));
    expect(evaluateCalibrationReadiness(report).state).toBe('INSUFFICIENT_DATA');
  });

  it('one false automatic auto-fail fails the safety gate', () => {
    const fixtures = sufficientFixtures();
    fixtures[0].modelRun.autoFails = ['af-scope'];
    expect(evaluateCalibrationReadiness(buildCalibrationReport(fixtures)).state)
      .toBe('FAILS_SAFETY_GATE');
  });

  it('one review miss fails the safety gate', () => {
    const fixtures = sufficientFixtures();
    fixtures[0].humanReview.adjudicated.recommendation = 'needs_review';
    fixtures[0].humanReview.adjudicated.reviewRequired = true;
    fixtures[0].humanReview.adjudicated.finalPass = null;
    fixtures[0].modelRun.recommendation = 'pass';
    expect(evaluateCalibrationReadiness(buildCalibrationReport(fixtures)).state)
      .toBe('FAILS_SAFETY_GATE');
  });

  it('mixed grader versions block readiness when neither population independently qualifies', () => {
    const fixtures = sufficientFixtures(200);
    fixtures.forEach((fixture, index) => {
      fixture.modelRun.model = index % 2 ? 'grader-a' : 'grader-b';
    });
    expect(evaluateCalibrationReadiness(buildCalibrationReport(fixtures)).state)
      .toBe('INSUFFICIENT_DATA');
  });

  it('missing adjudication cannot enter the counted human set', () => {
    const fixture = calibrationFixture();
    fixture.humanReview.adjudicationStatus = 'pending';
    expect(validateCalibrationFixture(fixture).valid).toBe(false);
  });

  it('insufficient department and scenario/workflow coverage block readiness', () => {
    const oneDepartment = Array.from({ length: 240 }, (_, index) =>
      calibrationFixture({
        caseId: `peds-${index}`,
        scenario: CALL_QA_SCENARIOS[index % 8],
      }));
    expect(evaluateCalibrationReadiness(buildCalibrationReport(oneDepartment)).state)
      .toBe('INSUFFICIENT_DATA');

    const missingScenario = sufficientFixtures().filter((fixture) =>
      fixture.scenarioId !== CALL_QA_SCENARIOS[0].id);
    expect(evaluateCalibrationReadiness(buildCalibrationReport(missingScenario)).state)
      .toBe('INSUFFICIENT_DATA');
  });

  it('accuracy threshold failure produces FAILS_ACCURACY_GATE', () => {
    const fixtures = sufficientFixtures();
    let changed = 0;
    for (const fixture of fixtures) {
      if (fixture.humanReview.adjudicated.recommendation === 'pass' && changed < 30) {
        fixture.modelRun.recommendation = 'fail';
        fixture.modelRun.pass = false;
        changed += 1;
      }
    }
    expect(evaluateCalibrationReadiness(buildCalibrationReport(fixtures)).state)
      .toBe('FAILS_ACCURACY_GATE');
  });

  it('a fully sufficient authored population reaches clean-pass consideration', () => {
    const result = evaluateCalibrationReadiness(buildCalibrationReport(sufficientFixtures()));
    expect(result.state).toBe('READY_FOR_CLEAN_PASS_CONSIDERATION');
  });
});
