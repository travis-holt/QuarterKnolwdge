import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildCalibrationReport,
  evaluateCalibrationReadiness,
  validateCalibrationFixture,
  wilsonInterval,
} from './_qa-calibration.js';
import { SYNTHETIC_CALIBRATION_SCENARIOS as CALL_QA_SCENARIOS, SYNTHETIC_SCENARIO_VERSION } from './_qa-calibration-scenarios.js';
import { rubricCriteria } from '../src/data/qaRubric.js';
import { getQaRubricProfile } from '../src/data/qaRubricProfiles.js';

const example = JSON.parse(readFileSync(
  new URL('./fixtures/call-qa-calibration/example-pass.json', import.meta.url),
  'utf8',
));
const RUBRIC_IDS = rubricCriteria().map((criterion) => criterion.id);
// Simulates an operator-supplied private-bank manifest so readiness-gate tests
// exercise the gates themselves rather than the missing-evidence reason.
const PRIVATE_EVIDENCE = { scenarios: CALL_QA_SCENARIOS, scenarioEvidence: 'private-manifest' };

// A fixture must label the rubric of ITS OWN department. Passing the department
// keeps OB/GYN fixtures on the OB/GYN criterion set (close-offer-help, no
// survey criterion) and Pediatrics fixtures on the historical shared set.
function criterionIdsFor(department = 'pediatrics') {
  return [...(getQaRubricProfile(department)?.criterionIds ?? RUBRIC_IDS)];
}

function completeCriteria(overrides = {}, fallback = 'NA', department = 'pediatrics') {
  return Object.fromEntries(criterionIdsFor(department).map((id) => [id, overrides[id] ?? fallback]));
}

function calibrationFixture({
  caseId = 'cal-test-001',
  source = 'human-pilot',
  scenario = CALL_QA_SCENARIOS[0],
  human = 'pass',
  model = human,
  humanCriteria = { 'open-greet': 'MET', 'know-rule': 'MET' },
  modelCriteria,
  humanAutoFails = [],
  modelAutoFails = [],
  modelName = 'gemini-2.5-flash',
  capture = {},
  modelRun = {},
} = {}) {
  const reviewRequired = human === 'needs_review';
  const humanLabels = completeCriteria(humanCriteria, 'NA', scenario.department);
  const modelLabels = completeCriteria(modelCriteria ?? humanCriteria, 'NA', scenario.department);
  const reviewer = (id) => ({
    reviewerId: id,
    criteria: humanLabels,
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
        criteria: humanLabels,
        autoFails: humanAutoFails,
        recommendation: human,
        finalPass: reviewRequired ? null : human === 'pass',
        reviewRequired,
      },
    },
    modelRun: modelRun === null ? null : {
      model: modelName,
      rubricVersion: getQaRubricProfile(scenario.department).rubricVersion,
      promptVersion: 'call-qa-grader-v4',
      scenarioVersion: SYNTHETIC_SCENARIO_VERSION,
      recommendation: model,
      pass: model !== 'fail',
      score: model === 'fail' ? 70 : 92,
      criteria: Object.entries(modelLabels).map(([id, verdict]) => ({ id, verdict })),
      autoFails: modelAutoFails,
      reviewFlags: [],
      correctedTurns: 0,
      ...modelRun,
    },
  };
}

function operationalFixture({
  caseId = 'operational-test-001',
  scenario = CALL_QA_SCENARIOS[0],
  captureStatus = 'abandoned',
  gradingStatus = captureStatus === 'abandoned' ? 'not_started' : 'grade_failed',
  transcript,
  capture = {},
} = {}) {
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
      liveModel: 'gemini-live-v1',
      gradingStatus,
      warnings: [],
      ...capture,
    },
    ...(transcript === undefined ? {} : { transcript }),
  };
}

function invalid(mutator) {
  const fixture = structuredClone(calibrationFixture());
  mutator(fixture);
  return validateCalibrationFixture(fixture);
}

describe('validateCalibrationFixture', () => {
  it('accepts grading fixtures and terminal operational-pilot failures', () => {
    expect(validateCalibrationFixture(example)).toEqual({ valid: true, errors: [] });
    expect(validateCalibrationFixture(calibrationFixture())).toEqual({ valid: true, errors: [] });
    expect(validateCalibrationFixture(operationalFixture())).toEqual({ valid: true, errors: [] });
    expect(validateCalibrationFixture(operationalFixture({
      captureStatus: 'capture_incomplete',
      gradingStatus: 'not_started',
      transcript: [],
      capture: { navigatorTurnCount: 0, callerTurnCount: 0 },
    }))).toEqual({ valid: true, errors: [] });
    expect(validateCalibrationFixture(operationalFixture({
      captureStatus: 'captured',
      gradingStatus: 'grade_failed',
    }))).toEqual({ valid: true, errors: [] });
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

  it('requires every rubric criterion exactly once for reviewers, adjudication, and model output', () => {
    expect(invalid((fixture) => {
      delete fixture.humanReview.reviewers[0].criteria['open-greet'];
    }).errors.join(' ')).toMatch(/missing rubric criterion/);
    expect(invalid((fixture) => {
      delete fixture.humanReview.adjudicated.criteria['open-greet'];
    }).errors.join(' ')).toMatch(/missing rubric criterion/);
    expect(invalid((fixture) => {
      fixture.modelRun.criteria.pop();
    }).errors.join(' ')).toMatch(/missing rubric criterion/);
    expect(invalid((fixture) => {
      fixture.modelRun.criteria.push({ ...fixture.modelRun.criteria[0] });
    }).errors.join(' ')).toMatch(/duplicate criterion/);
  });

  it('enforces adjudicated outcome consistency and model pass relationships', () => {
    expect(invalid((fixture) => {
      fixture.humanReview.adjudicated.finalPass = false;
    }).errors.join(' ')).toMatch(/inconsistent/);
    expect(invalid((fixture) => {
      fixture.humanReview.adjudicated.recommendation = 'needs_review';
    }).errors.join(' ')).toMatch(/inconsistent/);
    expect(invalid((fixture) => {
      fixture.modelRun.pass = false;
    }).errors.join(' ')).toMatch(/pass must be true/);
    expect(invalid((fixture) => {
      fixture.modelRun.recommendation = 'fail';
    }).errors.join(' ')).toMatch(/false for fail/);
    expect(validateCalibrationFixture(calibrationFixture({
      human: 'needs_review',
      model: 'needs_review',
      modelRun: { pass: false },
    })).valid).toBe(true);
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
      .toMatch(/does not match the referenced scenario version/);
  });

  it('enforces capture/grading state and transcript-count integrity', () => {
    expect(invalid((fixture) => {
      fixture.capture.captureComplete = false;
    }).errors.join(' ')).toMatch(/must be true for captured/);
    expect(invalid((fixture) => {
      fixture.capture.captureStatus = 'active';
      fixture.capture.captureComplete = false;
    }).errors.join(' ')).toMatch(/inconsistent with active/);
    expect(invalid((fixture) => {
      fixture.capture.captureStatus = 'abandoned';
      fixture.capture.captureComplete = false;
    }).errors.join(' ')).toMatch(/inconsistent with abandoned/);
    expect(invalid((fixture) => {
      fixture.capture.gradingStatus = 'grade_failed';
    }).errors.join(' ')).toMatch(/must be null unless gradingStatus is graded/);
    expect(invalid((fixture) => {
      fixture.capture.navigatorTurnCount += 1;
    }).errors.join(' ')).toMatch(/must match navigator transcript turns/);
    expect(invalid((fixture) => {
      fixture.capture.callerTurnCount += 1;
    }).errors.join(' ')).toMatch(/must match patient transcript turns/);
    expect(validateCalibrationFixture(calibrationFixture({
      capture: { captureStatus: 'capture_incomplete', captureComplete: false },
    })).valid).toBe(true);
    expect(validateCalibrationFixture(calibrationFixture({
      capture: { gradingStatus: 'grade_failed' },
      modelRun: null,
    })).errors.join(' ')).toMatch(/use operational-pilot/);
  });

  it('validates operational transcript data when present and rejects non-failure evidence', () => {
    const validTranscript = [
      { role: 'patient', text: 'The call disconnected.' },
      { role: 'navigator', text: 'I will reconnect.' },
    ];
    expect(validateCalibrationFixture(operationalFixture({
      captureStatus: 'capture_incomplete',
      gradingStatus: 'not_started',
      transcript: validTranscript,
      capture: { navigatorTurnCount: 1, callerTurnCount: 1 },
    })).valid).toBe(true);
    const badRole = operationalFixture({
      captureStatus: 'capture_incomplete',
      gradingStatus: 'not_started',
      transcript: validTranscript,
      capture: { navigatorTurnCount: 1, callerTurnCount: 1 },
    });
    badRole.transcript[0].role = 'caller';
    expect(validateCalibrationFixture(badRole).errors.join(' ')).toMatch(/unknown transcript role/);
    expect(validateCalibrationFixture(operationalFixture({
      captureStatus: 'capture_incomplete',
      gradingStatus: 'not_started',
      transcript: validTranscript,
      capture: { navigatorTurnCount: 2, callerTurnCount: 1 },
    })).errors.join(' ')).toMatch(/must match navigator transcript turns/);
    expect(validateCalibrationFixture(operationalFixture({
      captureStatus: 'captured',
      gradingStatus: 'not_started',
    })).errors.join(' ')).toMatch(/must represent an abandoned, capture-incomplete, or grade-failed attempt/);
    expect(validateCalibrationFixture(operationalFixture({
      captureStatus: 'capture_incomplete',
      gradingStatus: 'graded',
    })).errors.join(' ')).toMatch(/terminal and ungraded/);
    const withLabels = operationalFixture();
    withLabels.humanReview = calibrationFixture().humanReview;
    withLabels.modelRun = calibrationFixture().modelRun;
    expect(validateCalibrationFixture(withLabels).errors.join(' '))
      .toMatch(/humanReview.*omitted.*modelRun.*omitted/);
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
    operationalFixture({
      caseId: 'c6',
      captureStatus: 'abandoned',
      capture: { warnings: ['drain-timeout', 'missing-turn-complete'] },
    }),
    operationalFixture({
      caseId: 'c7',
      captureStatus: 'captured',
      gradingStatus: 'grade_failed',
    }),
  ];
  const report = buildCalibrationReport(fixtures, PRIVATE_EVIDENCE);

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
      totalAttempts: 7,
      abandonedCount: 1,
      gradeFailureCount: 1,
      criticalCaptureFailureCount: 2,
      turnCountCappedCount: 1,
      turnLengthCappedCount: 1,
      drainTimeoutCount: 1,
      missingTurnCompleteCount: 1,
      glossaryCorrectedAttemptCount: 1,
    });
    expect(report.evidenceSummary).toMatchObject({
      evaluatedHumanCaseCount: 5,
      operationalPilotFixtureCount: 2,
      captureEvidenceFixtureCount: 7,
    });
    expect(report.finalOutcomes.totalEvaluatedCases).toBe(5);
  });

  it('reports department/scenario/workflow and version breakdowns', () => {
    expect(report.operationalBreakdowns.department.pediatrics.count).toBe(5);
    expect(report.operationalBreakdowns.scenario['synthetic-peds-refill-01'].count).toBe(5);
    expect(report.operationalBreakdowns.workflowType.prescription_refill.count).toBe(5);
    expect(report.operationalBreakdowns.captureStatus.abandoned.count).toBe(1);
    expect(report.operationalBreakdowns.gradingStatus.grade_failed.count).toBe(1);
    expect(report.versionBreakdowns.graderModel).toEqual([
      { value: 'gemini-2.5-flash', count: 5 },
    ]);
    expect(report.coverage.departments.pediatrics.humanCalibrationCaseCount).toBe(5);
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
    expect(wilsonInterval(0, 0)).toEqual({
      count: 0,
      denominator: 0,
      observedRate: null,
      lower95: null,
      upper95: null,
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
    const report = buildCalibrationReport(sufficientFixtures(10), PRIVATE_EVIDENCE);
    expect(evaluateCalibrationReadiness(report).state).toBe('INSUFFICIENT_DATA');
  });

  it('one false automatic auto-fail fails the safety gate', () => {
    const fixtures = sufficientFixtures();
    fixtures[0].modelRun.autoFails = ['af-scope'];
    expect(evaluateCalibrationReadiness(buildCalibrationReport(fixtures, PRIVATE_EVIDENCE)).state)
      .toBe('FAILS_SAFETY_GATE');
  });

  it('one review miss fails the safety gate', () => {
    const fixtures = sufficientFixtures();
    fixtures[0].humanReview.adjudicated.recommendation = 'needs_review';
    fixtures[0].humanReview.adjudicated.reviewRequired = true;
    fixtures[0].humanReview.adjudicated.finalPass = null;
    fixtures[0].modelRun.recommendation = 'pass';
    expect(evaluateCalibrationReadiness(buildCalibrationReport(fixtures, PRIVATE_EVIDENCE)).state)
      .toBe('FAILS_SAFETY_GATE');
  });

  it('mixed grader versions block readiness when neither population independently qualifies', () => {
    const fixtures = sufficientFixtures(200);
    fixtures.forEach((fixture, index) => {
      fixture.modelRun.model = index % 2 ? 'grader-a' : 'grader-b';
    });
    expect(evaluateCalibrationReadiness(buildCalibrationReport(fixtures, PRIVATE_EVIDENCE)).state)
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
    expect(evaluateCalibrationReadiness(buildCalibrationReport(oneDepartment, PRIVATE_EVIDENCE)).state)
      .toBe('INSUFFICIENT_DATA');

    const missingScenario = sufficientFixtures().filter((fixture) =>
      fixture.scenarioId !== CALL_QA_SCENARIOS[0].id);
    expect(evaluateCalibrationReadiness(buildCalibrationReport(missingScenario, PRIVATE_EVIDENCE)).state)
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
    expect(evaluateCalibrationReadiness(buildCalibrationReport(fixtures, PRIVATE_EVIDENCE)).state)
      .toBe('FAILS_ACCURACY_GATE');
  });

  it('a fully sufficient authored population reaches clean-pass consideration', () => {
    const result = evaluateCalibrationReadiness(buildCalibrationReport(sufficientFixtures(), PRIVATE_EVIDENCE));
    expect(result.state).toBe('READY_FOR_CLEAN_PASS_CONSIDERATION');
  });

  it.each([
    ['all-pass', () => sufficientFixtures().map((fixture) => calibrationFixture({
      caseId: fixture.caseId,
      scenario: CALL_QA_SCENARIOS.find((scenario) => scenario.id === fixture.scenarioId),
      human: 'pass',
      model: 'pass',
    }))],
    ['all-fail', () => sufficientFixtures().map((fixture) => calibrationFixture({
      caseId: fixture.caseId,
      scenario: CALL_QA_SCENARIOS.find((scenario) => scenario.id === fixture.scenarioId),
      human: 'fail',
      model: 'fail',
    }))],
    ['all-review', () => sufficientFixtures().map((fixture) => calibrationFixture({
      caseId: fixture.caseId,
      scenario: CALL_QA_SCENARIOS.find((scenario) => scenario.id === fixture.scenarioId),
      human: 'needs_review',
      model: 'needs_review',
    }))],
  ])('%s populations remain insufficient', (_name, build) => {
    expect(evaluateCalibrationReadiness(buildCalibrationReport(build(), PRIVATE_EVIDENCE)).state)
      .toBe('INSUFFICIENT_DATA');
  });

  it('severely imbalanced outcome populations remain insufficient', () => {
    const fixtures = sufficientFixtures().map((fixture, index) => {
      const human = index < 500 ? 'pass' : index < 580 ? 'fail' : 'needs_review';
      return calibrationFixture({
        caseId: fixture.caseId,
        scenario: CALL_QA_SCENARIOS.find((scenario) => scenario.id === fixture.scenarioId),
        human,
        model: human,
      });
    });
    expect(evaluateCalibrationReadiness(buildCalibrationReport(fixtures, PRIVATE_EVIDENCE)).state)
      .toBe('INSUFFICIENT_DATA');
  });

  it('zero-denominator Wilson bounds are unavailable and cannot pass readiness', () => {
    const report = buildCalibrationReport(sufficientFixtures().map((fixture) =>
      calibrationFixture({
        caseId: fixture.caseId,
        scenario: CALL_QA_SCENARIOS.find((scenario) => scenario.id === fixture.scenarioId),
        human: 'pass',
        model: 'pass',
      })), PRIVATE_EVIDENCE);
    expect(report.finalOutcomes.falsePassInterval.upper95).toBeNull();
    expect(evaluateCalibrationReadiness(report).state).toBe('INSUFFICIENT_DATA');
  });

  it('failed and abandoned captures cannot hide behind enough successful graded cases', () => {
    const fixtures = sufficientFixtures();
    for (let index = 0; index < 20; index += 1) {
      fixtures.push(operationalFixture({ caseId: `abandoned-${index}` }));
      fixtures.push(operationalFixture({
        caseId: `grade-failed-${index}`,
        captureStatus: 'captured',
        gradingStatus: 'grade_failed',
      }));
    }
    const report = buildCalibrationReport(fixtures, PRIVATE_EVIDENCE);
    expect(report.captureMetrics).toMatchObject({
      abandonedCount: 20,
      gradeFailureCount: 20,
      criticalCaptureFailureCount: 40,
    });
    expect(report.evidenceSummary.evaluatedHumanCaseCount).toBe(640);
    expect(report.finalOutcomes.totalEvaluatedCases).toBe(640);
    expect(report.evidenceSummary.operationalPilotFixtureCount).toBe(40);
    expect(evaluateCalibrationReadiness(report).state).toBe('FAILS_SAFETY_GATE');
  });
});
