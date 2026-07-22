import { ASSESSED_DEPTS } from '../src/data/departments.js';
import { DOMAINS } from '../src/data/questions.js';
import { COMPETENCIES } from '../src/data/competencies.js';
import { CALL_QA_COVERAGE_BLUEPRINT, isCallQaRolloutDept } from '../src/data/callQaScenarios.js';
import {
  SYNTHETIC_CALIBRATION_SCENARIOS,
  scenarioResolverFrom,
} from './_qa-calibration-scenarios.js';
import {
  VERDICTS,
} from '../src/data/qaRubric.js';
import {
  QA_RUBRIC_PROFILES, getQaRubricProfile,
} from '../src/data/qaRubricProfiles.js';
import { CALL_QA_CAPTURE_VERSION } from './_call-qa-attempts.js';
import {
  isSupportedStoredPromptVersion, isCurrentPromptVersion, SUPPORTED_CALL_QA_PROMPT_VERSIONS,
} from './_qa-grading-versions.js';
import {
  CALL_QA_CALIBRATION_GATES,
  CALL_QA_CALIBRATION_POLICY_VERSION,
} from './_qa-calibration-gates.js';

export const CALL_QA_CALIBRATION_FORMAT_VERSION = 1;
export const CALIBRATION_SOURCES = new Set([
  'synthetic-example',
  'human-pilot',
  'operational-pilot',
]);
export const CALIBRATION_RECOMMENDATIONS = new Set(['pass', 'fail', 'needs_review']);
export const CALIBRATION_CAPTURE_STATUSES = new Set([
  'active', 'captured', 'capture_incomplete', 'abandoned',
]);
export const CALIBRATION_GRADING_STATUSES = new Set([
  'not_started', 'grading', 'graded', 'grade_failed',
]);

// Calibration is DEPARTMENT-AWARE: a fixture is validated and its criterion
// metrics are computed against the rubric profile of its OWN department, so an
// OB/GYN case is never labelled with Pediatrics criteria (or vice versa). A
// fixture whose department has no profile fails validation rather than being
// silently checked against someone else's rubric.
function profileForFixtureDepartment(department) {
  return getQaRubricProfile(department);
}

// ── Provenance compatibility (correction pass #3, B8) ────────────────────────
//
// A graded fixture must be validated against the rubric that ACTUALLY graded it,
// resolved from the RECORDED rubric version — never the current department
// profile. A genuine pre-profile OB/GYN call was graded under the historical
// shared rubric (`qa-rubric-v2`) with the old closing ids, and it must validate
// under THAT rubric. An impossible tuple (v3 + `qa-rubric-obgyn-v1`, or a NEW
// OB/GYN run claiming the shared rubric) is rejected rather than accepted.
//
// department → rubricVersion → the prompt versions that legitimately produced it.
const CALL_QA_PROVENANCE_COMPATIBILITY = Object.freeze({
  pediatrics: {
    // Pediatrics keeps the shared rubric across every prompt version.
    'qa-rubric-v2': new Set(SUPPORTED_CALL_QA_PROMPT_VERSIONS),
  },
  obgyn: {
    // OB/GYN was graded under the SHARED rubric ONLY in the pre-profile v3 era.
    'qa-rubric-v2': new Set(['call-qa-grader-v3']),
    // The dedicated OB/GYN profile was introduced with prompt v4 and is current.
    'qa-rubric-obgyn-v1': new Set(['call-qa-grader-v4', 'call-qa-grader-v5', 'call-qa-grader-v6']),
  },
});

/** Is (department, rubricVersion, promptVersion) a real historical/current tuple? */
export function callQaProvenanceCompatible(department, rubricVersion, promptVersion) {
  const allowed = CALL_QA_PROVENANCE_COMPATIBILITY[department]?.[rubricVersion];
  return Boolean(allowed && allowed.has(promptVersion));
}

/**
 * The rubric profile that ACTUALLY graded a fixture, resolved by the RECORDED
 * rubric version (not the current department profile). Returns null for a
 * missing/unknown recorded version.
 */
function gradingProfileForFixture(fixture) {
  const version = String(fixture?.modelRun?.rubricVersion ?? '').trim();
  if (!version) return null;
  return Object.values(QA_RUBRIC_PROFILES).find((profile) => profile.rubricVersion === version) ?? null;
}

// Every rubric version any configured profile can legitimately produce.
const SUPPORTED_RUBRIC_VERSIONS = new Set(
  Object.values(QA_RUBRIC_PROFILES).map((profile) => profile.rubricVersion),
);

// The union of every profile's criteria, used for cross-department aggregate
// reporting. Each metric records which departments actually define it, and a
// case only contributes to a criterion its own profile contains.
const ALL_CRITERIA = (() => {
  const byId = new Map();
  for (const profile of Object.values(QA_RUBRIC_PROFILES)) {
    for (const criterion of profile.criteria) {
      const existing = byId.get(criterion.id);
      if (existing) existing.departments.add(profile.department);
      else byId.set(criterion.id, { ...criterion, departments: new Set([profile.department]) });
    }
  }
  return [...byId.values()];
})();

// The union of every profile's auto-fail definitions, for cross-department
// aggregate reporting (same rules as ALL_CRITERIA).
const ALL_AUTO_FAILS = (() => {
  const byId = new Map();
  for (const profile of Object.values(QA_RUBRIC_PROFILES)) {
    for (const autoFail of profile.autoFails) {
      if (!byId.has(autoFail.id)) byId.set(autoFail.id, autoFail);
    }
  }
  return [...byId.values()];
})();

// A criterion is treated as safety-critical in reporting when ANY configured
// department marks it so — reporting must never under-state safety scope.
function isSafetyCriticalAnywhere(criterionId) {
  return Object.values(QA_RUBRIC_PROFILES)
    .some((profile) => profile.safetyCriticalCriteria.has(criterionId));
}
const PROHIBITED_KEYS = new Set([
  'navigatorid', 'patientid', 'employeeid', 'firebaseid', 'firebasedocumentid',
  'firestoredocumentid', 'documentid', 'email', 'emailaddress', 'phone',
  'phonenumber', 'supervisorpasscode', 'apikey', 'apikeys', 'authtoken',
  'accesstoken', 'refreshtoken', 'privatekey', 'serviceaccount',
  'serviceaccountjson', 'credentials', 'firebasetoken', 'navigatorname',
  'patientname', 'employeename', 'fullname', 'firstname', 'lastname',
  'dateofbirth', 'dob', 'address', 'streetaddress',
]);
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?:\+?\d[\s().-]*){10,}/;

const rate = (count, denominator) => denominator ? count / denominator : 0;
const round = (value) => Number(value.toFixed(6));

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function scanProhibited(value, path, errors, seen = new Set()) {
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      if (EMAIL.test(value)) addError(errors, path, 'email addresses are prohibited');
      if (PHONE.test(value)) addError(errors, path, 'phone numbers are prohibited');
    }
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (PROHIBITED_KEYS.has(normalized)) addError(errors, `${path}.${key}`, 'prohibited field');
    scanProhibited(child, `${path}.${key}`, errors, seen);
  }
}

function validateCriteria(criteria, path, errors, profile) {
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) {
    addError(errors, path, 'must be an object keyed by rubric criterion id');
    return;
  }
  if (!profile) return; // department already flagged; do not guess a rubric
  for (const [id, verdict] of Object.entries(criteria)) {
    if (!profile.criterionIds.has(id)) addError(errors, `${path}.${id}`, 'unknown rubric criterion for this department');
    if (!VERDICTS.has(verdict)) addError(errors, `${path}.${id}`, 'invalid verdict');
  }
  for (const id of profile.criterionIds) {
    if (!Object.prototype.hasOwnProperty.call(criteria, id)) {
      addError(errors, `${path}.${id}`, 'missing rubric criterion; use NA when inapplicable');
    }
  }
}

function validateAutoFails(autoFails, path, errors, profile) {
  if (!Array.isArray(autoFails)) {
    addError(errors, path, 'must be an array');
    return;
  }
  if (!profile) return;
  for (const [index, item] of autoFails.entries()) {
    const id = typeof item === 'string' ? item : item?.id;
    if (!profile.autoFailIds.has(id)) addError(errors, `${path}[${index}]`, 'unknown auto-fail id for this department');
  }
}

function validateReviewer(reviewer, index, errors, profile) {
  const path = `humanReview.reviewers[${index}]`;
  if (!/^reviewer-[a-z0-9-]+$/.test(String(reviewer?.reviewerId ?? ''))) {
    addError(errors, `${path}.reviewerId`, 'must be a pseudonymous reviewer-* id');
  }
  validateCriteria(reviewer?.criteria, `${path}.criteria`, errors, profile);
  validateAutoFails(reviewer?.autoFails, `${path}.autoFails`, errors, profile);
  if (!CALIBRATION_RECOMMENDATIONS.has(reviewer?.recommendation)) {
    addError(errors, `${path}.recommendation`, 'invalid recommendation');
  }
}

function validateHumanReview(fixture, errors, profile) {
  const review = fixture?.humanReview;
  if (!review || typeof review !== 'object') {
    addError(errors, 'humanReview', 'is required');
    return;
  }
  if (!Array.isArray(review.reviewers)) {
    addError(errors, 'humanReview.reviewers', 'must be an array');
  } else {
    review.reviewers.forEach((reviewer, index) => validateReviewer(reviewer, index, errors, profile));
    const ids = review.reviewers.map((reviewer) => reviewer?.reviewerId);
    if (new Set(ids).size !== ids.length) {
      addError(errors, 'humanReview.reviewers', 'duplicate reviewer ids');
    }
    if (review.reviewerCount !== review.reviewers.length) {
      addError(errors, 'humanReview.reviewerCount', 'must match the reviewers array length');
    }
  }
  if (fixture.source === 'human-pilot' && (review.reviewers?.length ?? 0) < 2) {
    addError(errors, 'humanReview.reviewers', 'human-pilot fixtures require at least two reviewers');
  }
  if (fixture.source === 'human-pilot' && review.adjudicationStatus !== 'complete') {
    addError(errors, 'humanReview.adjudicationStatus', 'human-pilot adjudication must be complete');
  }
  if (!['pending', 'complete'].includes(review.adjudicationStatus)) {
    addError(errors, 'humanReview.adjudicationStatus', 'unsupported adjudication status');
  }
  const adjudicated = review.adjudicated;
  if (!adjudicated || typeof adjudicated !== 'object') {
    addError(errors, 'humanReview.adjudicated', 'is required');
    return;
  }
  validateCriteria(adjudicated.criteria, 'humanReview.adjudicated.criteria', errors, profile);
  validateAutoFails(adjudicated.autoFails, 'humanReview.adjudicated.autoFails', errors, profile);
  if (!CALIBRATION_RECOMMENDATIONS.has(adjudicated.recommendation)) {
    addError(errors, 'humanReview.adjudicated.recommendation', 'invalid recommendation');
  }
  if (typeof adjudicated.finalPass !== 'boolean' && adjudicated.finalPass !== null) {
    addError(errors, 'humanReview.adjudicated.finalPass', 'must be boolean or null');
  }
  if (typeof adjudicated.reviewRequired !== 'boolean') {
    addError(errors, 'humanReview.adjudicated.reviewRequired', 'must be boolean');
  }
  const expected = {
    pass: { finalPass: true, reviewRequired: false },
    fail: { finalPass: false, reviewRequired: false },
    needs_review: { finalPass: null, reviewRequired: true },
  }[adjudicated.recommendation];
  if (expected && (
    adjudicated.finalPass !== expected.finalPass ||
    adjudicated.reviewRequired !== expected.reviewRequired
  )) {
    addError(errors, 'humanReview.adjudicated', 'recommendation, finalPass, and reviewRequired are inconsistent');
  }
}

function validateModelRun(fixture, errors, expectedScenarioVersion = null, profile = null) {
  const gradingStatus = fixture?.capture?.gradingStatus;
  const run = fixture?.modelRun;
  if (gradingStatus !== 'graded') {
    if (run != null) addError(errors, 'modelRun', 'must be null unless gradingStatus is graded');
    return;
  }
  if (!run || typeof run !== 'object') {
    addError(errors, 'modelRun', 'is required for graded fixtures');
    return;
  }
  for (const field of ['model', 'rubricVersion', 'promptVersion', 'scenarioVersion']) {
    if (!String(run[field] ?? '').trim()) addError(errors, `modelRun.${field}`, 'provenance is required');
  }
  // A run must declare a rubric version this repo still knows how to interpret.
  // The `profile` passed here is the rubric that ACTUALLY graded the record
  // (resolved by the recorded version, not the current department profile), and
  // the (department, rubricVersion, promptVersion) compatibility is enforced by
  // the caller's provenance-matrix check — so a genuine historical OB/GYN record
  // graded under the shared rubric is validated against that shared rubric.
  if (run.rubricVersion && !SUPPORTED_RUBRIC_VERSIONS.has(run.rubricVersion)) {
    addError(errors, 'modelRun.rubricVersion', 'unsupported rubric version');
  }
  // Prompt-version policy (corrected 2026-07-21). `SUPPORTED_CALL_QA_PROMPT_VERSIONS`
  // declares which versions this repo can still INTERPRET; that is not the same
  // as which a fixture may be produced under. Genuine stored evidence
  // (human-pilot / operational-pilot) may carry any supported version, because
  // it records what actually happened. An authored `synthetic-example` is
  // written NOW, so it must not claim to be output from a retired prompt — that
  // would manufacture a historical population that never existed. An unknown
  // version fails closed either way, and the readiness gates keep populations
  // from blending (see `requireSinglePromptVersion`).
  if (run.promptVersion && !isSupportedStoredPromptVersion(run.promptVersion)) {
    addError(errors, 'modelRun.promptVersion', 'unsupported prompt version');
  } else if (run.promptVersion
    && fixture.source === 'synthetic-example'
    && !isCurrentPromptVersion(run.promptVersion)) {
    addError(errors, 'modelRun.promptVersion',
      'a synthetic example must use the current prompt version; only genuine stored evidence may carry a historical one');
  }
  if (run.scenarioVersion && expectedScenarioVersion && run.scenarioVersion !== expectedScenarioVersion) {
    addError(errors, 'modelRun.scenarioVersion', 'does not match the referenced scenario version');
  }
  if (!CALIBRATION_RECOMMENDATIONS.has(run.recommendation)) {
    addError(errors, 'modelRun.recommendation', 'invalid recommendation');
  }
  if (typeof run.pass !== 'boolean') addError(errors, 'modelRun.pass', 'must be boolean');
  if ((run.recommendation === 'pass' && run.pass !== true) ||
      (run.recommendation === 'fail' && run.pass !== false)) {
    addError(errors, 'modelRun', 'pass must be true for pass and false for fail recommendations');
  }
  if (!Number.isFinite(run.score)) addError(errors, 'modelRun.score', 'must be numeric');
  if (!Array.isArray(run.criteria)) {
    addError(errors, 'modelRun.criteria', 'must be an array');
  } else {
    const ids = new Set();
    run.criteria.forEach((criterion, index) => {
      if (profile && !profile.criterionIds.has(criterion?.id)) {
        addError(errors, `modelRun.criteria[${index}].id`, 'unknown rubric criterion for this department');
      }
      if (!VERDICTS.has(criterion?.verdict)) {
        addError(errors, `modelRun.criteria[${index}].verdict`, 'invalid verdict');
      }
      if (ids.has(criterion?.id)) addError(errors, `modelRun.criteria[${index}].id`, 'duplicate criterion');
      ids.add(criterion?.id);
    });
    for (const id of profile?.criterionIds ?? []) {
      if (!ids.has(id)) addError(errors, `modelRun.criteria.${id}`, 'missing rubric criterion; use NA when inapplicable');
    }
  }
  validateAutoFails(run.autoFails, 'modelRun.autoFails', errors, profile);
  if (!Array.isArray(run.reviewFlags)) addError(errors, 'modelRun.reviewFlags', 'must be an array');
}

function isOperationalPilot(fixture) {
  return fixture?.source === 'operational-pilot';
}

export function validateCalibrationFixture(fixture, { scenarios = SYNTHETIC_CALIBRATION_SCENARIOS } = {}) {
  const resolveScenario = scenarioResolverFrom(scenarios);
  const errors = [];
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
    return { valid: false, errors: ['fixture: must be an object'] };
  }
  if (fixture.formatVersion !== CALL_QA_CALIBRATION_FORMAT_VERSION) {
    addError(errors, 'formatVersion', 'unsupported format version');
  }
  if (!String(fixture.caseId ?? '').trim()) addError(errors, 'caseId', 'is required');
  if (!CALIBRATION_SOURCES.has(fixture.source)) addError(errors, 'source', 'unsupported source');
  if (fixture.sanitized !== true) addError(errors, 'sanitized', 'must be true');
  if (!ASSESSED_DEPTS.includes(fixture.department)) addError(errors, 'department', 'unknown department');
  // The rubric profile of the fixture's OWN department decides which criterion
  // and auto-fail ids are legal. A department with no profile cannot be
  // calibrated at all — it is never checked against another department's rubric.
  const profile = profileForFixtureDepartment(fixture.department);
  if (!profile) addError(errors, 'department', 'no Call QA rubric profile is configured for this department');

  const scenario = resolveScenario(fixture.scenarioId);
  if (!scenario) addError(errors, 'scenarioId', 'unknown scenario id');
  else {
    if (scenario.department !== fixture.department) addError(errors, 'scenarioId', 'scenario belongs to another department');
    if (fixture.workflowType !== scenario.workflowType) addError(errors, 'workflowType', 'does not match scenario');
    if (fixture.difficulty !== scenario.difficulty) addError(errors, 'difficulty', 'does not match scenario');
  }

  // Synthetic examples are non-production rehearsal material and must say so.
  if (fixture.source === 'synthetic-example') {
    if (fixture.nonProduction !== true) addError(errors, 'nonProduction', 'synthetic examples must set nonProduction: true');
    if (fixture.calibrationAuthority !== 'none') addError(errors, 'calibrationAuthority', "synthetic examples must set calibrationAuthority: 'none'");
    if (fixture.evidenceUse !== 'synthetic-rehearsal-only') addError(errors, 'evidenceUse', "synthetic examples must set evidenceUse: 'synthetic-rehearsal-only'");
  }

  const capture = fixture.capture;
  const operationalPilot = isOperationalPilot(fixture);
  if (!capture || typeof capture !== 'object') {
    addError(errors, 'capture', 'is required');
  } else {
    if (!CALIBRATION_CAPTURE_STATUSES.has(capture.captureStatus)) {
      addError(errors, 'capture.captureStatus', 'unsupported capture status');
    }
    if (!CALIBRATION_GRADING_STATUSES.has(capture.gradingStatus)) {
      addError(errors, 'capture.gradingStatus', 'unsupported grading status');
    }
    if (typeof capture.captureComplete !== 'boolean') {
      addError(errors, 'capture.captureComplete', 'must be boolean');
    }
    const expectedComplete = capture.captureStatus === 'captured';
    if (CALIBRATION_CAPTURE_STATUSES.has(capture.captureStatus) &&
        capture.captureComplete !== expectedComplete) {
      addError(errors, 'capture.captureComplete', `must be ${expectedComplete} for ${capture.captureStatus}`);
    }
    const allowedGradingStates = {
      active: new Set(['not_started']),
      abandoned: new Set(['not_started']),
      captured: CALIBRATION_GRADING_STATUSES,
      capture_incomplete: CALIBRATION_GRADING_STATUSES,
    }[capture.captureStatus];
    if (allowedGradingStates && !allowedGradingStates.has(capture.gradingStatus)) {
      addError(errors, 'capture.gradingStatus', `is inconsistent with ${capture.captureStatus}`);
    }
    if (!String(capture.captureVersion ?? '').trim()) {
      addError(errors, 'capture.captureVersion', 'is required');
    } else if (capture.captureVersion !== CALL_QA_CAPTURE_VERSION) {
      addError(errors, 'capture.captureVersion', 'unsupported capture version');
    }
    if (!String(capture.liveModel ?? '').trim()) addError(errors, 'capture.liveModel', 'is required');
    if (!Array.isArray(capture.warnings)) addError(errors, 'capture.warnings', 'must be an array');
    for (const field of ['navigatorTurnCount', 'callerTurnCount']) {
      if ((!operationalPilot || capture[field] != null) &&
          (!Number.isInteger(capture[field]) || capture[field] < 0)) {
        addError(errors, `capture.${field}`, 'must be a non-negative integer');
      }
    }
    if (operationalPilot) {
      const isOperationalFailure =
        capture.captureStatus === 'abandoned' ||
        capture.captureStatus === 'capture_incomplete' ||
        capture.gradingStatus === 'grade_failed';
      if (!isOperationalFailure) {
        addError(errors, 'capture', 'operational-pilot fixtures must represent an abandoned, capture-incomplete, or grade-failed attempt');
      }
      if (['grading', 'graded'].includes(capture.gradingStatus)) {
        addError(errors, 'capture.gradingStatus', 'operational-pilot fixtures must be terminal and ungraded');
      }
    } else if (capture.gradingStatus !== 'graded') {
      addError(errors, 'capture.gradingStatus', 'grading fixtures must be graded; use operational-pilot for capture or grading failures');
    }
  }

  const hasTranscript = Object.prototype.hasOwnProperty.call(fixture, 'transcript');
  if (!operationalPilot && (!Array.isArray(fixture.transcript) || fixture.transcript.length === 0)) {
    addError(errors, 'transcript', 'must be a non-empty array');
  } else if (hasTranscript && !Array.isArray(fixture.transcript)) {
    addError(errors, 'transcript', 'must be an array when provided');
  } else if (Array.isArray(fixture.transcript)) {
    let navigatorTurns = 0;
    let callerTurns = 0;
    fixture.transcript.forEach((turn, index) => {
      if (!['patient', 'navigator'].includes(turn?.role)) {
        addError(errors, `transcript[${index}].role`, 'unknown transcript role');
      }
      if (turn?.role === 'navigator') navigatorTurns += 1;
      if (turn?.role === 'patient') callerTurns += 1;
      if (!String(turn?.text ?? '').trim()) addError(errors, `transcript[${index}].text`, 'must be non-empty');
    });
    if (!operationalPilot && navigatorTurns === 0) addError(errors, 'transcript', 'missing navigator turns');
    if (capture && capture.navigatorTurnCount != null &&
        capture.navigatorTurnCount !== navigatorTurns) {
      addError(errors, 'capture.navigatorTurnCount', 'must match navigator transcript turns');
    }
    if (capture && capture.callerTurnCount != null &&
        capture.callerTurnCount !== callerTurns) {
      addError(errors, 'capture.callerTurnCount', 'must match patient transcript turns');
    }
  }

  if (operationalPilot) {
    if (fixture.humanReview != null) {
      addError(errors, 'humanReview', 'must be omitted for operational-pilot fixtures');
    }
    if (fixture.modelRun != null) {
      addError(errors, 'modelRun', 'must be omitted for operational-pilot fixtures');
    }
  } else {
    // Validate human + model criteria against the rubric that ACTUALLY graded the
    // record — resolved by the recorded rubric version — and reject an impossible
    // (department, rubricVersion, promptVersion) provenance tuple.
    const gradingProfile = gradingProfileForFixture(fixture) ?? profile;
    const recordedRubric = String(fixture?.modelRun?.rubricVersion ?? '').trim();
    const recordedPrompt = String(fixture?.modelRun?.promptVersion ?? '').trim();
    if (recordedRubric && recordedPrompt
      && SUPPORTED_RUBRIC_VERSIONS.has(recordedRubric)
      && isSupportedStoredPromptVersion(recordedPrompt)
      && !callQaProvenanceCompatible(fixture.department, recordedRubric, recordedPrompt)) {
      addError(errors, 'modelRun',
        `incompatible provenance: ${fixture.department} + ${recordedRubric} + ${recordedPrompt} `
        + 'is not a valid historical or current combination');
    }
    validateHumanReview(fixture, errors, gradingProfile);
    validateModelRun(fixture, errors, scenario?.version ?? null, gradingProfile);
  }
  scanProhibited(fixture, 'fixture', errors);
  return { valid: errors.length === 0, errors };
}

function criterionMap(criteria) {
  if (Array.isArray(criteria)) {
    return new Map(criteria.map((criterion) => [criterion.id, criterion]));
  }
  return new Map(Object.entries(criteria ?? {}).map(([id, verdict]) => [id, { id, verdict }]));
}

function autoFailSet(autoFails) {
  return new Set((autoFails ?? []).map((item) => typeof item === 'string' ? item : item?.id).filter(Boolean));
}

function outcome(review) {
  if (review?.reviewRequired || review?.recommendation === 'needs_review') return 'review';
  return review?.recommendation === 'pass' ? 'pass' : 'fail';
}

export function evaluateCalibrationCase(fixture) {
  const validation = validateCalibrationFixture(fixture);
  if (!validation.valid) {
    const error = new Error(`Invalid calibration fixture ${fixture?.caseId ?? '<unknown>'}:\n${validation.errors.join('\n')}`);
    error.validationErrors = validation.errors;
    throw error;
  }
  const human = fixture.humanReview?.adjudicated;
  const evaluable = Boolean(human && fixture.capture.gradingStatus === 'graded' && fixture.modelRun);
  return {
    caseId: fixture.caseId,
    source: fixture.source,
    department: fixture.department,
    scenarioId: fixture.scenarioId,
    workflowType: fixture.workflowType,
    difficulty: fixture.difficulty,
    humanOutcome: human ? outcome(human) : null,
    modelOutcome: evaluable ? outcome(fixture.modelRun) : null,
    humanCriteria: criterionMap(human?.criteria),
    modelCriteria: criterionMap(fixture.modelRun?.criteria),
    humanAutoFails: autoFailSet(human?.autoFails),
    modelAutoFails: autoFailSet(fixture.modelRun?.autoFails),
    evaluable: Boolean(evaluable),
    fixture,
  };
}

export function wilsonInterval(count, denominator, z = 1.959963984540054) {
  if (!denominator) {
    return { count, denominator, observedRate: null, lower95: null, upper95: null };
  }
  const p = count / denominator;
  const z2 = z * z;
  const center = (p + z2 / (2 * denominator)) / (1 + z2 / denominator);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * denominator)) / denominator)
    / (1 + z2 / denominator);
  return {
    count,
    denominator,
    observedRate: round(p),
    lower95: round(Math.max(0, center - margin)),
    upper95: round(Math.min(1, center + margin)),
  };
}

function emptyConfusionMatrix() {
  return Object.fromEntries(['pass', 'fail', 'review'].map((human) => [
    human,
    { pass: 0, fail: 0, review: 0 },
  ]));
}

function ratioMetric(tp, fp, fn, tn) {
  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    trueNegatives: tn,
    precision: rate(tp, tp + fp),
    recall: rate(tp, tp + fn),
    agreement: rate(tp + tn, tp + fp + fn + tn),
  };
}

function buildCriterionMetrics(cases) {
  const metrics = {};
  let applicableCorrect = 0;
  let applicableTotal = 0;
  let weightedCorrect = 0;
  let weightedTotal = 0;
  let safetyCorrect = 0;
  let safetyTotal = 0;
  let nonSafetyCorrect = 0;
  let nonSafetyTotal = 0;

  // Iterate the UNION of every department profile's criteria. A case only
  // contributes to a criterion its own department rubric actually defines
  // (`humanCriteria`/`modelCriteria` simply have no entry otherwise), so
  // OB/GYN-only and Pediatrics-only criteria never dilute each other.
  for (const definition of ALL_CRITERIA) {
    const comparisons = cases.flatMap((item) => {
      const human = item.humanCriteria.get(definition.id);
      const model = item.modelCriteria.get(definition.id);
      return human && model ? [{ item, human, model }] : [];
    });
    const applicable = comparisons.filter(({ human }) => human.verdict !== 'NA');
    const agreementCount = comparisons.filter(({ human, model }) => human.verdict === model.verdict).length;
    const applicableAgreement = applicable.filter(({ human, model }) => human.verdict === model.verdict).length;
    const binary = (positive) => {
      let tp = 0; let fp = 0; let fn = 0; let tn = 0;
      for (const { human, model } of comparisons) {
        if (human.verdict === positive && model.verdict === positive) tp += 1;
        else if (human.verdict !== positive && model.verdict === positive) fp += 1;
        else if (human.verdict === positive && model.verdict !== positive) fn += 1;
        else tn += 1;
      }
      return ratioMetric(tp, fp, fn, tn);
    };
    const naHuman = comparisons.filter(({ human }) => human.verdict === 'NA');
    const unresolved = comparisons.filter(({ model }) => model.unresolved || model.unverified).length;
    const escalated = comparisons.filter(({ item }) => item.modelOutcome === 'review').length;
    const disagreementExamples = comparisons
      .filter(({ human, model }) => human.verdict !== model.verdict)
      .map(({ item }) => item.caseId)
      .sort();
    metrics[definition.id] = {
      applicableCaseCount: applicable.length,
      comparedCaseCount: comparisons.length,
      agreementCount,
      agreement: rate(agreementCount, comparisons.length),
      met: binary('MET'),
      notMet: binary('NOT_MET'),
      naAgreement: rate(naHuman.filter(({ model }) => model.verdict === 'NA').length, naHuman.length),
      evidenceUnresolvedCount: unresolved,
      reviewEscalationCount: escalated,
      disagreementExamples,
      safetyCritical: isSafetyCriticalAnywhere(definition.id),
      // Which department rubrics define this criterion at all.
      departments: [...definition.departments].sort(),
    };
    applicableCorrect += applicableAgreement;
    applicableTotal += applicable.length;
    weightedCorrect += applicableAgreement * definition.points;
    weightedTotal += applicable.length * definition.points;
    if (isSafetyCriticalAnywhere(definition.id)) {
      safetyCorrect += applicableAgreement;
      safetyTotal += applicable.length;
    } else {
      nonSafetyCorrect += applicableAgreement;
      nonSafetyTotal += applicable.length;
    }
  }
  const agreements = Object.values(metrics)
    .filter((metric) => metric.comparedCaseCount > 0)
    .map((metric) => metric.agreement);
  return {
    criteria: metrics,
    macroAgreement: rate(agreements.reduce((sum, value) => sum + value, 0), agreements.length),
    weightedAgreement: rate(weightedCorrect, weightedTotal),
    applicableAgreement: rate(applicableCorrect, applicableTotal),
    safetyCriticalAgreement: rate(safetyCorrect, safetyTotal),
    safetyCriticalComparedCount: safetyTotal,
    safetyCriticalDisagreementInterval: wilsonInterval(safetyTotal - safetyCorrect, safetyTotal),
    nonSafetyAgreement: rate(nonSafetyCorrect, nonSafetyTotal),
  };
}

function buildAutoFailMetrics(cases) {
  const metrics = {};
  let aggregateTp = 0; let aggregateFp = 0; let aggregateFn = 0; let aggregateTn = 0;
  for (const definition of ALL_AUTO_FAILS) {
    let tp = 0; let fp = 0; let fn = 0; let tn = 0; let escalated = 0;
    for (const item of cases) {
      const human = item.humanAutoFails.has(definition.id);
      const model = item.modelAutoFails.has(definition.id);
      if (human && model) tp += 1;
      else if (!human && model) fp += 1;
      else if (human && !model) fn += 1;
      else tn += 1;
      if (model && item.modelOutcome === 'review') escalated += 1;
    }
    metrics[definition.id] = { ...ratioMetric(tp, fp, fn, tn), escalatedToReview: escalated };
    aggregateTp += tp; aggregateFp += fp; aggregateFn += fn; aggregateTn += tn;
  }
  const aggregate = ratioMetric(aggregateTp, aggregateFp, aggregateFn, aggregateTn);
  return {
    autoFails: metrics,
    totalFalseAutomaticAutoFails: aggregateFp,
    totalMissedHumanAutoFails: aggregateFn,
    precision: aggregate.precision,
    recall: aggregate.recall,
    agreement: aggregate.agreement,
    falsePositiveInterval: wilsonInterval(aggregateFp, aggregateFp + aggregateTn),
  };
}

function hasWarning(item, warning) {
  return (item.fixture.capture.warnings ?? []).includes(warning);
}

function hasReviewFlag(item, flag) {
  return (item.fixture.modelRun?.reviewFlags ?? []).some((itemFlag) =>
    (typeof itemFlag === 'string' ? itemFlag : itemFlag?.id) === flag);
}

function buildCaptureMetrics(items) {
  const total = items.length;
  const count = (predicate) => items.filter(predicate).length;
  const clean = count((item) =>
    item.fixture.capture.captureStatus === 'captured' &&
    item.fixture.capture.captureComplete === true &&
    (item.fixture.capture.warnings ?? []).length === 0);
  const incomplete = count((item) => item.fixture.capture.captureStatus === 'capture_incomplete');
  const abandoned = count((item) => item.fixture.capture.captureStatus === 'abandoned');
  const gradeFailed = count((item) => item.fixture.capture.gradingStatus === 'grade_failed');
  const criticalCaptureFailure = count((item) =>
    item.fixture.capture.captureComplete !== true ||
    item.fixture.capture.captureStatus === 'capture_incomplete' ||
    item.fixture.capture.captureStatus === 'abandoned' ||
    item.fixture.capture.gradingStatus === 'grade_failed');
  const criticalOmission = count((item) =>
    item.fixture.capture.captureStatus === 'capture_incomplete' ||
    hasWarning(item, 'drain-timeout') ||
    hasWarning(item, 'missing-turn-complete') ||
    hasReviewFlag(item, 'capture-integrity-incomplete'));
  const corrected = items.map((item) => Number(item.fixture.modelRun?.correctedTurns ?? 0));
  const correctedAttempts = corrected.filter((value) => value > 0).length;
  return {
    totalAttempts: total,
    cleanCaptureCount: clean,
    cleanCaptureRate: rate(clean, total),
    captureIncompleteCount: incomplete,
    captureIncompleteRate: rate(incomplete, total),
    captureIncompleteInterval: wilsonInterval(incomplete, total),
    abandonedCount: abandoned,
    abandonedRate: rate(abandoned, total),
    gradeFailureCount: gradeFailed,
    gradeFailureRate: rate(gradeFailed, total),
    criticalCaptureFailureCount: criticalCaptureFailure,
    criticalCaptureFailureRate: rate(criticalCaptureFailure, total),
    criticalCaptureFailureInterval: wilsonInterval(criticalCaptureFailure, total),
    turnCountCappedCount: count((item) => hasWarning(item, 'turn-count-capped')),
    turnCountCappedRate: rate(count((item) => hasWarning(item, 'turn-count-capped')), total),
    turnLengthCappedCount: count((item) => hasWarning(item, 'turn-length-capped')),
    turnLengthCappedRate: rate(count((item) => hasWarning(item, 'turn-length-capped')), total),
    drainTimeoutCount: count((item) => hasWarning(item, 'drain-timeout')),
    drainTimeoutRate: rate(count((item) => hasWarning(item, 'drain-timeout')), total),
    missingTurnCompleteCount: count((item) => hasWarning(item, 'missing-turn-complete')),
    missingTurnCompleteRate: rate(count((item) => hasWarning(item, 'missing-turn-complete')), total),
    lowTurnCountCount: count((item) =>
      (Number.isInteger(item.fixture.capture.navigatorTurnCount) &&
        item.fixture.capture.navigatorTurnCount < 3) ||
      (Array.isArray(item.fixture.transcript) && item.fixture.transcript.length < 4)),
    lowTurnCountRate: rate(count((item) =>
      (Number.isInteger(item.fixture.capture.navigatorTurnCount) &&
        item.fixture.capture.navigatorTurnCount < 3) ||
      (Array.isArray(item.fixture.transcript) && item.fixture.transcript.length < 4)), total),
    glossaryCorrectedAttemptCount: correctedAttempts,
    glossaryCorrectedAttemptRate: rate(correctedAttempts, total),
    averageCorrectedTurnCount: rate(corrected.reduce((sum, value) => sum + value, 0), total),
    lowTranscriptConfidenceCount: count((item) => hasReviewFlag(item, 'low-transcript-confidence')),
    captureIntegrityReviewCount: count((item) => hasReviewFlag(item, 'capture-integrity-incomplete')),
    criticalTranscriptOmissionCount: criticalOmission,
    criticalTranscriptOmissionRate: rate(criticalOmission, total),
  };
}

function groupBreakdown(cases, getter) {
  const groups = new Map();
  for (const item of cases) {
    const key = String(getter(item) ?? 'unknown');
    const group = groups.get(key) ?? { count: 0, human: { pass: 0, fail: 0, review: 0 }, model: { pass: 0, fail: 0, review: 0 } };
    group.count += 1;
    if (item.humanOutcome) group.human[item.humanOutcome] += 1;
    if (item.modelOutcome) group.model[item.modelOutcome] += 1;
    groups.set(key, group);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function versionBreakdown(cases, getter) {
  return Object.entries(groupBreakdown(cases, getter)).map(([value, group]) => ({
    value,
    count: group.count,
  }));
}

/**
 * True when any single department contributed more than one rubric version —
 * the only shape that is genuine rubric drift now that each department carries
 * its own rubric profile and version.
 * @param {{value:string}[]} breakdown entries keyed "<department>::<version>"
 */
export function mixedRubricVersionWithinADepartment(breakdown = []) {
  const byDepartment = new Map();
  for (const entry of breakdown) {
    const [department, version] = String(entry?.value ?? '').split('::');
    if (!byDepartment.has(department)) byDepartment.set(department, new Set());
    byDepartment.get(department).add(version);
  }
  return [...byDepartment.values()].some((versions) => versions.size > 1);
}

function populationKey(item) {
  const run = item.fixture.modelRun ?? {};
  return [
    run.model,
    run.rubricVersion,
    run.promptVersion,
    run.scenarioVersion,
    item.fixture.capture.captureVersion,
    item.fixture.capture.liveModel,
  ].map((value) => value ?? 'unknown').join(' | ');
}

function buildCalibrationReportInternal(fixtures, includePopulations, options = {}) {
  const {
    scenarios = SYNTHETIC_CALIBRATION_SCENARIOS,
    scenarioEvidence = 'synthetic-only',
  } = options;
  const seen = new Set();
  const all = fixtures.map((fixture) => {
    const item = evaluateCalibrationCase(fixture);
    if (seen.has(item.caseId)) throw new Error(`Duplicate calibration caseId: ${item.caseId}`);
    seen.add(item.caseId);
    return item;
  });
  const human = all.filter((item) => item.source === 'human-pilot');
  const operational = all.filter((item) => item.source === 'operational-pilot');
  const captureEvidence = [...human, ...operational];
  const cases = human.filter((item) => item.evaluable);
  const confusionMatrix = emptyConfusionMatrix();
  cases.forEach((item) => { confusionMatrix[item.humanOutcome][item.modelOutcome] += 1; });
  const total = cases.length;
  const humanFail = cases.filter((item) => item.humanOutcome === 'fail').length;
  const humanPass = cases.filter((item) => item.humanOutcome === 'pass').length;
  const humanReview = cases.filter((item) => item.humanOutcome === 'review').length;
  const falsePasses = confusionMatrix.fail.pass;
  const falseFails = confusionMatrix.pass.fail;
  const reviewMisses = confusionMatrix.review.pass + confusionMatrix.review.fail;
  const exactAgreement = cases.filter((item) => item.humanOutcome === item.modelOutcome).length;
  const modelReview = cases.filter((item) => item.modelOutcome === 'review').length;
  const criterion = buildCriterionMetrics(cases);
  const autoFail = buildAutoFailMetrics(cases);
  const versions = {
    graderModel: versionBreakdown(cases, (item) => item.fixture.modelRun.model),
    rubricVersion: versionBreakdown(cases, (item) => item.fixture.modelRun.rubricVersion),
    promptVersion: versionBreakdown(cases, (item) => item.fixture.modelRun.promptVersion),
    scenarioVersion: versionBreakdown(cases, (item) => item.fixture.modelRun.scenarioVersion),
    captureVersion: versionBreakdown(cases, (item) => item.fixture.capture.captureVersion),
    liveVoiceModel: versionBreakdown(cases, (item) => item.fixture.capture.liveModel),
    populations: versionBreakdown(cases, populationKey),
    // Since 2026-07-21 the rubric is DEPARTMENT-scoped, so two departments
    // legitimately report two different rubric versions in one population. That
    // is department identity, not calibration drift. Real rubric drift is more
    // than one rubric version WITHIN a single department, which this breakdown
    // (and the readiness gate) measures instead.
    rubricVersionByDepartment: versionBreakdown(
      cases, (item) => `${item.fixture.department}::${item.fixture.modelRun.rubricVersion}`,
    ),
  };
  const rubricDrift = mixedRubricVersionWithinADepartment(versions.rubricVersionByDepartment);
  const mixed = versions.graderModel.length > 1 ||
    rubricDrift ||
    versions.promptVersion.length > 1;
  const report = {
    formatVersion: 1,
    policyVersion: CALL_QA_CALIBRATION_POLICY_VERSION,
    evidenceSummary: {
      fixtureCount: all.length,
      syntheticExampleCount: all.filter((item) => item.source === 'synthetic-example').length,
      humanPilotFixtureCount: human.length,
      operationalPilotFixtureCount: operational.length,
      captureEvidenceFixtureCount: captureEvidence.length,
      evaluatedHumanCaseCount: cases.length,
      excludedUngradedHumanCaseCount: human.length - cases.length,
      minimumReviewerCount: human.length
        ? Math.min(...human.map((item) => item.fixture.humanReview.reviewers.length))
        : 0,
      accuracyConclusionAvailable: cases.length > 0,
      note: cases.length
        ? 'Accuracy metrics use adjudicated human-pilot fixtures only.'
        : 'No real-world accuracy conclusion is possible without adjudicated human-pilot fixtures.',
    },
    confusionMatrix,
    finalOutcomes: {
      totalEvaluatedCases: total,
      agreementCount: exactAgreement,
      finalVerdictAgreement: rate(exactAgreement, total),
      falsePassCount: falsePasses,
      falsePassRate: rate(falsePasses, humanFail),
      falsePassInterval: wilsonInterval(falsePasses, humanFail),
      falseFailCount: falseFails,
      falseFailRate: rate(falseFails, humanPass),
      falseFailInterval: wilsonInterval(falseFails, humanPass),
      reviewMissCount: reviewMisses,
      reviewMissRate: rate(reviewMisses, humanReview),
      correctEscalationToReviewCount: confusionMatrix.review.review,
      supervisorReviewRate: rate(modelReview, total),
      confidentDecisionRate: rate(total - modelReview, total),
      humanOutcomeCounts: {
        pass: humanPass,
        fail: humanFail,
        review: humanReview,
      },
    },
    criterionMetrics: criterion,
    autoFailMetrics: autoFail,
    captureMetrics: buildCaptureMetrics(captureEvidence),
    versionBreakdowns: versions,
    populationWarning: mixed ? 'MIXED CALIBRATION POPULATION' : null,
    operationalBreakdowns: {
      department: groupBreakdown(cases, (item) => item.department),
      scenario: groupBreakdown(cases, (item) => item.scenarioId),
      workflowType: groupBreakdown(cases, (item) => item.workflowType),
      difficulty: groupBreakdown(cases, (item) => item.difficulty),
      humanFinalVerdict: groupBreakdown(cases, (item) => item.humanOutcome),
      captureStatus: groupBreakdown(captureEvidence, (item) => item.fixture.capture.captureStatus),
      gradingStatus: groupBreakdown(captureEvidence, (item) => item.fixture.capture.gradingStatus),
      gradingPopulation: groupBreakdown(cases, populationKey),
    },
    coverage: buildScenarioCoverageReport(scenarios, fixtures, { scenarioEvidence }),
    approvedPopulation: versions.populations.length === 1 ? versions.populations[0].value : null,
  };
  if (includePopulations && versions.populations.length > 1) {
    report.populationReports = Object.fromEntries(
      versions.populations.map(({ value }) => [
        value,
        buildCalibrationReportInternal(
          fixtures.filter((fixture) => fixture.source !== 'human-pilot' ||
            !fixture.modelRun ||
            populationKey(evaluateCalibrationCase(fixture)) === value),
          false,
          options,
        ),
      ]),
    );
  }
  return report;
}

export function buildCalibrationReport(fixtures, options = {}) {
  return buildCalibrationReportInternal(fixtures, true, options);
}

function sampleCoverageFailures(report, gates) {
  const reasons = [];
  if (report.evidenceSummary.evaluatedHumanCaseCount < gates.minimumCases) {
    reasons.push(`minimumCases:${report.evidenceSummary.evaluatedHumanCaseCount}/${gates.minimumCases}`);
  }
  if (report.evidenceSummary.humanPilotFixtureCount > 0 &&
      report.evidenceSummary.minimumReviewerCount < gates.minimumReviewersPerHumanCase) {
    reasons.push(`minimumReviewers:${report.evidenceSummary.minimumReviewerCount}/${gates.minimumReviewersPerHumanCase}`);
  }
  const total = report.evidenceSummary.evaluatedHumanCaseCount;
  for (const outcomeName of ['pass', 'fail', 'review']) {
    const count = report.finalOutcomes.humanOutcomeCounts[outcomeName];
    const minimum = gates.minimumHumanOutcomeCases[outcomeName];
    if (count < minimum) reasons.push(`humanOutcome:${outcomeName}:${count}/${minimum}`);
    if (total > 0 && count / total < gates.minimumHumanOutcomeClassRate) {
      reasons.push(`humanOutcomeRate:${outcomeName}:${round(count / total)}/${gates.minimumHumanOutcomeClassRate}`);
    }
  }
  if (report.finalOutcomes.falsePassInterval.denominator === 0) {
    reasons.push('falsePassWilson:unavailable');
  }
  if (report.finalOutcomes.falseFailInterval.denominator === 0) {
    reasons.push('falseFailWilson:unavailable');
  }
  if (report.criterionMetrics.safetyCriticalDisagreementInterval.denominator === 0) {
    reasons.push('safetyCriticalWilson:unavailable');
  }
  for (const department of ASSESSED_DEPTS) {
    const count = report.operationalBreakdowns.department[department]?.count ?? 0;
    if (count < gates.minimumCasesPerDepartment) {
      reasons.push(`department:${department}:${count}/${gates.minimumCasesPerDepartment}`);
    }
  }
  // Scenario/workflow sample minimums come from the report's own coverage
  // section (built from the calibration scenario source), never a public bank.
  if (report.coverage.scenarioEvidence !== 'private-manifest') {
    reasons.push(`scenarioEvidence:${report.coverage.scenarioEvidence ?? 'missing'}`);
  }
  for (const departmentCoverage of Object.values(report.coverage.departments ?? {})) {
    for (const workflow of Object.values(departmentCoverage.workflows ?? {})) {
      for (const scenarioId of workflow.scenarios ?? []) {
        const count = report.operationalBreakdowns.scenario[scenarioId]?.count ?? 0;
        if (count < gates.minimumCasesPerScenario) {
          reasons.push(`scenario:${scenarioId}:${count}/${gates.minimumCasesPerScenario}`);
        }
      }
    }
    for (const workflowType of departmentCoverage.workflowTypes ?? []) {
      const count = report.operationalBreakdowns.workflowType[workflowType]?.count ?? 0;
      if (count < gates.minimumCasesPerWorkflow) {
        reasons.push(`workflow:${workflowType}:${count}/${gates.minimumCasesPerWorkflow}`);
      }
    }
  }
  return reasons;
}

function performanceFailures(report, gates) {
  const failures = [];
  if (report.finalOutcomes.finalVerdictAgreement < gates.minimumFinalAgreement) failures.push('final-agreement');
  if (report.finalOutcomes.falsePassRate > gates.maximumFalsePassRate) failures.push('false-pass-rate');
  if (report.finalOutcomes.falseFailRate > gates.maximumFalseFailRate) failures.push('false-fail-rate');
  return failures;
}

function safetyFailures(report, gates) {
  const failures = [];
  if (report.finalOutcomes.reviewMissCount > gates.maximumReviewMisses) failures.push('review-miss');
  if (report.autoFailMetrics.totalFalseAutomaticAutoFails > gates.maximumFalseAutoFails) failures.push('false-auto-fail');
  if (report.autoFailMetrics.precision < gates.minimumAutoFailPrecision &&
      report.autoFailMetrics.totalFalseAutomaticAutoFails > 0) failures.push('auto-fail-precision');
  if (report.criterionMetrics.safetyCriticalAgreement < gates.minimumSafetyCriticalAgreement) {
    failures.push('safety-critical-agreement');
  }
  if (report.captureMetrics.criticalTranscriptOmissionRate > gates.maximumCriticalTranscriptOmissionRate) {
    failures.push('critical-transcript-omission');
  }
  if (report.captureMetrics.criticalCaptureFailureRate > gates.maximumCriticalCaptureFailureRate) {
    failures.push('critical-capture-failure');
  }
  return failures;
}

export function evaluateCalibrationReadiness(report, gates = CALL_QA_CALIBRATION_GATES) {
  const mixedRequired = (
    (gates.requireSingleGraderModelVersion && report.versionBreakdowns.graderModel.length > 1) ||
    // Rubric drift is measured WITHIN a department (see
    // `mixedRubricVersionWithinADepartment`): two departments reporting their
    // own rubric versions is expected and is not a mixed population.
    (gates.requireSingleRubricVersion
      && mixedRubricVersionWithinADepartment(report.versionBreakdowns.rubricVersionByDepartment ?? [])) ||
    (gates.requireSinglePromptVersion && report.versionBreakdowns.promptVersion.length > 1)
  );
  if (mixedRequired) {
    for (const [population, populationReport] of Object.entries(report.populationReports ?? {})) {
      const result = evaluateCalibrationReadiness(populationReport, gates);
      if (['READY_FOR_SHADOW', 'READY_FOR_CLEAN_PASS_CONSIDERATION'].includes(result.state)) {
        return { ...result, approvedPopulation: population, populationWarning: 'MIXED CALIBRATION POPULATION' };
      }
    }
    return {
      state: 'INSUFFICIENT_DATA',
      policyVersion: CALL_QA_CALIBRATION_POLICY_VERSION,
      reasons: ['MIXED CALIBRATION POPULATION: no single version population independently satisfies the gates'],
    };
  }

  const sampleFailures = sampleCoverageFailures(report, gates);
  if (sampleFailures.length) {
    return {
      state: 'INSUFFICIENT_DATA',
      policyVersion: CALL_QA_CALIBRATION_POLICY_VERSION,
      reasons: sampleFailures,
    };
  }
  const safety = safetyFailures(report, gates);
  if (safety.length) {
    return {
      state: 'FAILS_SAFETY_GATE',
      policyVersion: CALL_QA_CALIBRATION_POLICY_VERSION,
      reasons: safety,
    };
  }
  const accuracy = performanceFailures(report, gates);
  if (accuracy.length) {
    return {
      state: 'FAILS_ACCURACY_GATE',
      policyVersion: CALL_QA_CALIBRATION_POLICY_VERSION,
      reasons: accuracy,
    };
  }

  const upperBounds = [
    [report.finalOutcomes.falsePassInterval.upper95, gates.maximumFalsePassRate],
    [report.finalOutcomes.falseFailInterval.upper95, gates.maximumFalseFailRate],
    [
      report.criterionMetrics.safetyCriticalDisagreementInterval.upper95,
      1 - gates.minimumSafetyCriticalAgreement,
    ],
  ];
  const statisticallyBounded = upperBounds.every(([upper, maximum]) =>
    Number.isFinite(upper) && upper <= maximum);
  return {
    state: statisticallyBounded ? 'READY_FOR_CLEAN_PASS_CONSIDERATION' : 'READY_FOR_SHADOW',
    policyVersion: CALL_QA_CALIBRATION_POLICY_VERSION,
    reasons: statisticallyBounded
      ? []
      : ['Observed gates pass, but 95% confidence bounds are not yet tight enough for clean-pass consideration'],
    approvedPopulation: report.approvedPopulation,
  };
}

function balance(fixtures) {
  const counts = { pass: 0, fail: 0, review: 0 };
  fixtures.forEach((fixture) => { counts[outcome(fixture.humanReview.adjudicated)] += 1; });
  return counts;
}

export function buildScenarioCoverageReport(scenarios = SYNTHETIC_CALIBRATION_SCENARIOS, fixtures = [], { scenarioEvidence = 'synthetic-only' } = {}) {
  const human = fixtures.filter((fixture) => fixture.source === 'human-pilot');
  const departments = {};
  const flags = [];

  for (const department of ASSESSED_DEPTS) {
    // Coverage is measured against THIS department's own rubric profile: a
    // criterion that does not exist for the department must not be reported as
    // uncovered, and one that only exists here must not be omitted.
    const departmentProfile = profileForFixtureDepartment(department);
    const departmentCriteria = departmentProfile?.criteria ?? [];
    const safetyIds = [...(departmentProfile?.safetyCriticalCriteria ?? [])];
    const departmentScenarios = scenarios.filter((scenario) => scenario.department === department);
    // Honest runtime-bank evidence: descriptor counts only prove runtime
    // coverage when they come from a validated private-bank manifest. The
    // anonymous aggregate minimums alone are never coverage evidence.
    const minimumScenarioCount = CALL_QA_COVERAGE_BLUEPRINT[department]?.minimumScenarioCount ?? 0;
    // Runtime private-bank evidence is only required for scored-rollout
    // departments (currently OB/GYN only). Pediatrics is assessed but outside
    // this rollout: no private bank exists or is required for it.
    if (isCallQaRolloutDept(department)) {
      if (scenarioEvidence !== 'private-manifest') {
        flags.push({ id: 'runtime-bank-evidence-missing', department, requiredMinimum: minimumScenarioCount });
      } else if (departmentScenarios.length < minimumScenarioCount) {
        flags.push({ id: 'private-bank-below-minimum', department, count: departmentScenarios.length, requiredMinimum: minimumScenarioCount });
      }
    }
    const departmentFixtures = human.filter((fixture) => fixture.department === department);
    const workflows = {};
    for (const scenario of departmentScenarios) {
      const workflow = workflows[scenario.workflowType] ?? { scenarioCount: 0, humanCaseCount: 0, scenarios: [] };
      const scenarioFixtures = departmentFixtures.filter((fixture) => fixture.scenarioId === scenario.id);
      workflow.scenarioCount += 1;
      workflow.humanCaseCount += scenarioFixtures.length;
      workflow.scenarios.push(scenario.id);
      workflows[scenario.workflowType] = workflow;
      if (scenarioFixtures.length < 8) flags.push({ id: 'scenario-low-volume', department, scenarioId: scenario.id, count: scenarioFixtures.length });
    }
    for (const [workflowType, workflow] of Object.entries(workflows)) {
      if (workflow.scenarioCount === 1) flags.push({ id: 'workflow-single-scenario', department, workflowType });
      if (workflow.humanCaseCount < 10) flags.push({ id: 'workflow-low-volume', department, workflowType, count: workflow.humanCaseCount });
    }
    if (departmentFixtures.length < 80) flags.push({ id: 'department-low-volume', department, count: departmentFixtures.length });

    const difficultyDistribution = Object.fromEntries(['easy', 'medium', 'hard'].map((difficulty) => [
      difficulty,
      departmentScenarios.filter((scenario) => scenario.difficulty === difficulty).length,
    ]));
    for (const [difficulty, count] of Object.entries(difficultyDistribution)) {
      if (!count) flags.push({ id: 'missing-difficulty', department, difficulty });
    }
    const domainCoverage = Object.fromEntries(DOMAINS.map((domain) => {
      const matching = departmentScenarios.filter((scenario) => scenario.domainIds.includes(domain.id));
      const humanCases = departmentFixtures.filter((fixture) =>
        matching.some((scenario) => scenario.id === fixture.scenarioId)).length;
      if (!matching.length || !humanCases) flags.push({ id: 'domain-not-meaningfully-exercised', department, domainId: domain.id, humanCases });
      return [domain.id, { scenarioCount: matching.length, humanCaseCount: humanCases }];
    }));
    const competencyCoverage = Object.fromEntries(COMPETENCIES.map((competency) => {
      const matching = departmentScenarios.filter((scenario) => scenario.competencyIds.includes(competency.id));
      const humanCases = departmentFixtures.filter((fixture) =>
        matching.some((scenario) => scenario.id === fixture.scenarioId)).length;
      if (!matching.length || !humanCases) flags.push({ id: 'competency-not-meaningfully-exercised', department, competencyId: competency.id, humanCases });
      return [competency.id, { scenarioCount: matching.length, humanCaseCount: humanCases }];
    }));
    const rubricCriterionCoverage = Object.fromEntries(departmentCriteria.map((criterion) => {
      const count = departmentFixtures.filter((fixture) =>
        fixture.humanReview.adjudicated.criteria?.[criterion.id] &&
        fixture.humanReview.adjudicated.criteria[criterion.id] !== 'NA').length;
      if (departmentProfile.safetyCriticalCriteria.has(criterion.id) && count < 8) {
        flags.push({ id: 'safety-critical-low-volume', department, criterionId: criterion.id, count });
      }
      return [criterion.id, count];
    }));
    const safetyCriticalScenarioCoverage = Object.fromEntries(departmentScenarios.map((scenario) => {
      const scenarioFixtures = departmentFixtures.filter((fixture) => fixture.scenarioId === scenario.id);
      const applicableCriteria = safetyIds.filter((criterionId) =>
        scenarioFixtures.some((fixture) =>
          fixture.humanReview.adjudicated.criteria?.[criterionId] &&
          fixture.humanReview.adjudicated.criteria[criterionId] !== 'NA'));
      return [scenario.id, {
        humanCaseCount: scenarioFixtures.length,
        applicableSafetyCriteria: applicableCriteria,
      }];
    }));
    const refillCount = departmentFixtures.filter((fixture) => fixture.workflowType === 'prescription_refill').length;
    if (departmentFixtures.length && refillCount / departmentFixtures.length > 0.4) {
      flags.push({ id: 'refill-concentration', department, rate: refillCount / departmentFixtures.length });
    }
    const maxScenario = Math.max(0, ...departmentScenarios.map((scenario) =>
      departmentFixtures.filter((fixture) => fixture.scenarioId === scenario.id).length));
    if (departmentFixtures.length && maxScenario / departmentFixtures.length > 0.25) {
      flags.push({ id: 'scenario-concentration', department, rate: maxScenario / departmentFixtures.length });
    }
    departments[department] = {
      totalCuratedScenarios: departmentScenarios.length,
      workflowTypes: Object.keys(workflows).sort(),
      workflows,
      difficultyDistribution,
      domainCoverage,
      competencyCoverage,
      rubricCriterionCoverage,
      safetyCriticalScenarioCoverage,
      safetyCriticalCriterionIds: safetyIds,
      humanCalibrationCaseCount: departmentFixtures.length,
      humanVerdictBalance: balance(departmentFixtures),
    };
  }
  const maxDepartment = Math.max(0, ...Object.values(departments).map((department) => department.humanCalibrationCaseCount));
  if (human.length && maxDepartment / human.length > 0.6) {
    flags.push({ id: 'department-concentration', rate: maxDepartment / human.length });
  }
  return {
    scenarioEvidence,
    humanCalibrationCaseCount: human.length,
    departments,
    flags: flags.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

function percent(value) {
  return value == null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
}

export function formatCalibrationMarkdown(report) {
  const readiness = report.readiness ?? evaluateCalibrationReadiness(report);
  const lines = [
    '# Call QA Calibration Report',
    '',
    `Policy: \`${readiness.policyVersion}\``,
    `Readiness: **${readiness.state}**`,
    '',
    report.populationWarning ? `> **${report.populationWarning}**` : '',
    report.populationWarning ? '' : '',
    '## Evidence',
    '',
    `- Human pilot fixtures: ${report.evidenceSummary.humanPilotFixtureCount}`,
    `- Operational pilot fixtures: ${report.evidenceSummary.operationalPilotFixtureCount}`,
    `- Synthetic examples excluded from accuracy: ${report.evidenceSummary.syntheticExampleCount}`,
    `- Evaluated human cases: ${report.evidenceSummary.evaluatedHumanCaseCount}`,
    `- ${report.evidenceSummary.note}`,
    '',
    '## Final outcomes',
    '',
    `- Agreement: ${percent(report.finalOutcomes.finalVerdictAgreement)}`,
    `- False passes: ${report.finalOutcomes.falsePassCount} (${percent(report.finalOutcomes.falsePassRate)}, 95% upper ${percent(report.finalOutcomes.falsePassInterval.upper95)})`,
    `- False fails: ${report.finalOutcomes.falseFailCount} (${percent(report.finalOutcomes.falseFailRate)}, 95% upper ${percent(report.finalOutcomes.falseFailInterval.upper95)})`,
    `- Review misses: ${report.finalOutcomes.reviewMissCount}`,
    `- Supervisor review rate: ${percent(report.finalOutcomes.supervisorReviewRate)}`,
    '',
    '## Safety and capture',
    '',
    `- Safety-critical criterion agreement: ${percent(report.criterionMetrics.safetyCriticalAgreement)}`,
    `- False automatic auto-fails: ${report.autoFailMetrics.totalFalseAutomaticAutoFails}`,
    `- Missed human auto-fails: ${report.autoFailMetrics.totalMissedHumanAutoFails}`,
    `- Clean capture rate: ${percent(report.captureMetrics.cleanCaptureRate)}`,
    `- Capture-incomplete rate: ${percent(report.captureMetrics.captureIncompleteRate)}`,
    `- Critical capture failure rate: ${percent(report.captureMetrics.criticalCaptureFailureRate)}`,
    `- Critical transcript omission rate: ${percent(report.captureMetrics.criticalTranscriptOmissionRate)}`,
    '',
    '## Coverage gaps',
    '',
    ...(report.coverage.flags.length
      ? report.coverage.flags.map((flag) => `- ${Object.values(flag).join(' · ')}`)
      : ['- None']),
    '',
    '## Readiness reasons',
    '',
    ...(readiness.reasons.length ? readiness.reasons.map((reason) => `- ${reason}`) : ['- All configured gates passed.']),
    '',
    '> This report is calibration and shadow-readiness evidence only. It does not enable an automatic final verdict.',
    '',
  ];
  return lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n');
}
