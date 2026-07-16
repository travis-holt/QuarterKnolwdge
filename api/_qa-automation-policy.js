export const CALL_QA_CLEAN_PASS_SHADOW_POLICY_VERSION =
  'call-qa-clean-pass-shadow-v1';

export function callQaAutomationMode(env = process.env) {
  return String(env?.CALL_QA_AUTOMATION_MODE ?? '').trim().toLowerCase() === 'shadow'
    ? 'shadow'
    : 'off';
}

function approvedVersions(calibrationReport) {
  const population = calibrationReport?.readiness?.approvedPopulation ??
    calibrationReport?.approvedPopulation;
  if (!population) return null;
  const [model, rubricVersion, promptVersion, scenarioVersion, captureVersion, liveModel] =
    population.split(' | ');
  return { model, rubricVersion, promptVersion, scenarioVersion, captureVersion, liveModel };
}

export function evaluateCleanPassCandidate(attempt, calibrationReport) {
  const reasons = [];
  const fail = (condition, reason) => { if (condition) reasons.push(reason); };
  const qa = attempt?.qa;
  const review = qa?.review;
  const capture = attempt?.captureMetadata;
  const grading = qa?.gradingMetadata;
  const approved = approvedVersions(calibrationReport);
  const readiness = calibrationReport?.readiness?.state ?? calibrationReport?.readinessState;

  fail(attempt?.assessmentType !== 'call-qa', 'not-call-qa');
  fail(attempt?.captureAuthority !== 'server', 'not-server-authoritative');
  fail(attempt?.captureStatus !== 'captured', 'capture-not-complete');
  fail(capture?.captureComplete !== true, 'capture-metadata-incomplete');
  fail(attempt?.gradingStatus !== 'graded', 'grading-not-complete');
  fail(qa?.pass !== true, 'ai-result-not-pass');
  fail(review?.recommendation !== 'pass', 'recommendation-not-pass');
  fail(review?.confidence !== 'high', 'confidence-not-high');
  fail(review?.safetyRisk !== 'none', 'safety-risk-present');
  fail((qa?.autoFails?.length ?? -1) !== 0, 'auto-fail-present');
  fail((qa?.unverifiedAutoFails?.length ?? -1) !== 0, 'unverified-auto-fail-present');
  fail(!Array.isArray(qa?.criteria) || qa.criteria.some((criterion) =>
    criterion?.unresolved || criterion?.unverified), 'unresolved-criterion');
  fail((qa?.deterministicFindings?.length ?? -1) !== 0, 'deterministic-finding');
  fail((qa?.repairs?.length ?? -1) !== 0, 'fairness-repair');
  fail((review?.reviewFlags?.length ?? -1) !== 0, 'review-flag');
  fail(!Array.isArray(capture?.warnings) || capture.warnings.length !== 0, 'capture-warning');
  fail((capture?.warnings ?? []).some((warning) =>
    ['turn-count-capped', 'turn-length-capped'].includes(warning)), 'transcript-cap');
  fail(!grading?.model || !grading?.rubricVersion || !grading?.promptVersion ||
    !grading?.scenarioVersion || !attempt?.captureVersion || !attempt?.liveModel,
  'missing-grading-provenance');
  fail(readiness !== 'READY_FOR_CLEAN_PASS_CONSIDERATION', 'calibration-not-ready');
  fail(!approved, 'approved-population-missing');
  if (approved && grading) {
    fail(grading.model !== approved.model, 'wrong-model-version');
    fail(grading.rubricVersion !== approved.rubricVersion, 'wrong-rubric-version');
    fail(grading.promptVersion !== approved.promptVersion, 'wrong-prompt-version');
    fail(grading.scenarioVersion !== approved.scenarioVersion, 'wrong-scenario-version');
    fail(attempt.captureVersion !== approved.captureVersion, 'wrong-capture-version');
    fail(attempt.liveModel !== approved.liveModel, 'wrong-live-model-version');
  }
  fail(Boolean(attempt?.qaFinalReview && attempt.qaFinalReview.status !== 'pending'),
    'final-supervisor-review-exists');

  return {
    eligible: reasons.length === 0,
    policyVersion: CALL_QA_CLEAN_PASS_SHADOW_POLICY_VERSION,
    reasons: [...new Set(reasons)].sort(),
  };
}

export function buildShadowAutomationAssessment(attempt, calibrationReport, env = process.env) {
  const mode = callQaAutomationMode(env);
  if (mode !== 'shadow') return null;
  return { mode, ...evaluateCleanPassCandidate(attempt, calibrationReport) };
}
