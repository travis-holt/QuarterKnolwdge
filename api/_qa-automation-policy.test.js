import { describe, expect, it } from 'vitest';
import {
  buildShadowAutomationAssessment,
  callQaAutomationMode,
  evaluateCleanPassCandidate,
} from './_qa-automation-policy.js';
import { rubricCriteria } from '../src/data/qaRubric.js';

const POPULATION = [
  'gemini-2.5-flash',
  'qa-rubric-v2',
  'call-qa-grader-v5',
  'synthetic-rehearsal-v1',
  'call-qa-live-transcript-v1',
  'gemini-live-v1',
].join(' | ');

function readyReport(state = 'READY_FOR_CLEAN_PASS_CONSIDERATION') {
  return {
    policyVersion: 'call-qa-calibration-policy-v2',
    approvedPopulation: POPULATION,
    readiness: {
      state,
      approvedPopulation: POPULATION,
      policyVersion: 'call-qa-calibration-policy-v2',
    },
  };
}

function cleanAttempt() {
  return {
    id: 'attempt-1',
    assessmentType: 'call-qa',
    captureAuthority: 'server',
    captureStatus: 'captured',
    captureVersion: 'call-qa-live-transcript-v1',
    liveModel: 'gemini-live-v1',
    captureMetadata: { captureComplete: true, warnings: [] },
    gradingStatus: 'graded',
    qa: {
      pass: true,
      criteria: rubricCriteria().map((criterion) => ({ id: criterion.id, verdict: 'MET' })),
      autoFails: [],
      unverifiedAutoFails: [],
      deterministicFindings: [],
      repairs: [],
      metadataIntegrity: { verified: true, status: 'verified' },
      transcriptMetadata: {
        authority: 'server',
        attemptId: 'attempt-1',
        captureStatus: 'captured',
        captureComplete: true,
        captureVersion: 'call-qa-live-transcript-v1',
        liveModel: 'gemini-live-v1',
      },
      review: {
        recommendation: 'pass',
        confidence: 'high',
        safetyRisk: 'none',
        reviewFlags: [],
      },
      gradingMetadata: {
        model: 'gemini-2.5-flash',
        rubricVersion: 'qa-rubric-v2',
        promptVersion: 'call-qa-grader-v5',
        scenarioVersion: 'synthetic-rehearsal-v1',
      },
    },
  };
}

const disqualifiers = [
  ['capture-incomplete status', (attempt) => { attempt.captureStatus = 'capture_incomplete'; }, 'capture-not-complete'],
  ['incomplete capture', (attempt) => { attempt.captureMetadata.captureComplete = false; }, 'capture-metadata-incomplete'],
  ['abandoned capture', (attempt) => { attempt.captureStatus = 'abandoned'; }, 'capture-not-complete'],
  ['capture warning', (attempt) => { attempt.captureMetadata.warnings = ['drain-timeout']; }, 'capture-warning'],
  ['transcript cap', (attempt) => { attempt.captureMetadata.warnings = ['turn-count-capped']; }, 'transcript-cap'],
  ['grade failure', (attempt) => { attempt.gradingStatus = 'grade_failed'; }, 'grading-not-complete'],
  ['AI fail', (attempt) => { attempt.qa.pass = false; }, 'ai-result-not-pass'],
  ['needs review', (attempt) => { attempt.qa.review.recommendation = 'needs_review'; }, 'recommendation-not-pass'],
  ['medium confidence', (attempt) => { attempt.qa.review.confidence = 'medium'; }, 'confidence-not-high'],
  ['safety risk', (attempt) => { attempt.qa.review.safetyRisk = 'elevated'; }, 'safety-risk-present'],
  ['auto-fail', (attempt) => { attempt.qa.autoFails = [{ id: 'af-scope' }]; }, 'auto-fail-present'],
  ['unverified auto-fail', (attempt) => { attempt.qa.unverifiedAutoFails = [{ id: 'af-scope' }]; }, 'unverified-auto-fail-present'],
  ['unresolved criterion', (attempt) => { attempt.qa.criteria[0].unresolved = true; }, 'unresolved-criterion'],
  ['deterministic finding', (attempt) => { attempt.qa.deterministicFindings = [{ id: 'x' }]; }, 'deterministic-finding'],
  ['fairness repair', (attempt) => { attempt.qa.repairs = [{ rule: 'x' }]; }, 'fairness-repair'],
  ['review flag', (attempt) => { attempt.qa.review.reviewFlags = [{ id: 'x' }]; }, 'review-flag'],
  ['unverified metadata', (attempt) => { attempt.qa.metadataIntegrity.verified = false; }, 'metadata-integrity-unverified'],
  ['missing metadata integrity', (attempt) => { delete attempt.qa.metadataIntegrity; }, 'metadata-integrity-unverified'],
  ['missing transcript metadata', (attempt) => { delete attempt.qa.transcriptMetadata; }, 'transcript-not-server-authoritative'],
  ['non-server transcript', (attempt) => { attempt.qa.transcriptMetadata.authority = 'local'; }, 'transcript-not-server-authoritative'],
  ['transcript attempt mismatch', (attempt) => { attempt.qa.transcriptMetadata.attemptId = 'other'; }, 'transcript-attempt-mismatch'],
  ['transcript status mismatch', (attempt) => { attempt.qa.transcriptMetadata.captureStatus = 'capture_incomplete'; }, 'transcript-capture-status-mismatch'],
  ['transcript capture-version mismatch', (attempt) => { attempt.qa.transcriptMetadata.captureVersion = 'other'; }, 'transcript-capture-version-mismatch'],
  ['transcript live-model mismatch', (attempt) => { attempt.qa.transcriptMetadata.liveModel = 'other'; }, 'transcript-live-model-mismatch'],
  ['transcript completeness mismatch', (attempt) => { attempt.qa.transcriptMetadata.captureComplete = false; }, 'transcript-capture-complete-mismatch'],
  ['incomplete rubric result', (attempt) => { attempt.qa.criteria.pop(); }, 'incomplete-rubric-result'],
  ['duplicate rubric result', (attempt) => { attempt.qa.criteria.at(-1).id = attempt.qa.criteria[0].id; }, 'incomplete-rubric-result'],
  ['unknown rubric result', (attempt) => { attempt.qa.criteria.at(-1).id = 'unknown'; }, 'incomplete-rubric-result'],
  ['missing grading metadata', (attempt) => { delete attempt.qa.gradingMetadata; }, 'missing-grading-provenance'],
  ['wrong model', (attempt) => { attempt.qa.gradingMetadata.model = 'other'; }, 'wrong-model-version'],
  ['wrong rubric', (attempt) => { attempt.qa.gradingMetadata.rubricVersion = 'other'; }, 'wrong-rubric-version'],
  ['wrong prompt', (attempt) => { attempt.qa.gradingMetadata.promptVersion = 'other'; }, 'wrong-prompt-version'],
  ['wrong scenario', (attempt) => { attempt.qa.gradingMetadata.scenarioVersion = 'other'; }, 'wrong-scenario-version'],
  ['wrong capture version', (attempt) => { attempt.captureVersion = 'other'; }, 'wrong-capture-version'],
  ['wrong live model', (attempt) => { attempt.liveModel = 'other'; }, 'wrong-live-model-version'],
  ['existing final review', (attempt) => { attempt.qaFinalReview = { status: 'confirmed_pass', finalPass: true }; }, 'final-supervisor-review-exists'],
];

describe('evaluateCleanPassCandidate', () => {
  it('allows a fully clean shadow candidate without changing any verdict', () => {
    const attempt = cleanAttempt();
    const before = structuredClone(attempt);
    expect(evaluateCleanPassCandidate(attempt, readyReport())).toEqual({
      eligible: true,
      policyVersion: 'call-qa-clean-pass-shadow-v2',
      reasons: [],
    });
    expect(attempt).toEqual(before);
    expect(attempt.qaFinalReview).toBeUndefined();
  });

  for (const [name, mutate, reason] of disqualifiers) {
    it(`${name} blocks eligibility`, () => {
      const attempt = cleanAttempt();
      mutate(attempt);
      expect(evaluateCleanPassCandidate(attempt, readyReport()).reasons).toContain(reason);
    });
  }

  it('calibration not ready blocks eligibility', () => {
    expect(evaluateCleanPassCandidate(cleanAttempt(), readyReport('READY_FOR_SHADOW')).reasons)
      .toContain('calibration-not-ready');
  });

  it('unsupported or missing calibration policy versions block eligibility', () => {
    const report = readyReport();
    report.readiness.policyVersion = 'call-qa-calibration-policy-v1';
    expect(evaluateCleanPassCandidate(cleanAttempt(), report).reasons)
      .toContain('unsupported-calibration-policy');
    delete report.readiness.policyVersion;
    expect(evaluateCleanPassCandidate(cleanAttempt(), report).reasons)
      .toContain('unsupported-calibration-policy');
    report.readiness.policyVersion = 'call-qa-calibration-policy-v2';
    report.policyVersion = 'call-qa-calibration-policy-v1';
    expect(evaluateCleanPassCandidate(cleanAttempt(), report).reasons)
      .toContain('unsupported-calibration-policy');
  });
});

describe('CALL_QA_AUTOMATION_MODE', () => {
  it('defaults and unknown values to off', () => {
    expect(callQaAutomationMode({})).toBe('off');
    expect(callQaAutomationMode({ CALL_QA_AUTOMATION_MODE: 'auto' })).toBe('off');
  });

  it('permits shadow only and produces a non-final diagnostic', () => {
    expect(callQaAutomationMode({ CALL_QA_AUTOMATION_MODE: 'shadow' })).toBe('shadow');
    const assessment = buildShadowAutomationAssessment(
      cleanAttempt(),
      readyReport(),
      { CALL_QA_AUTOMATION_MODE: 'shadow' },
    );
    expect(assessment).toMatchObject({ mode: 'shadow', eligible: true });
    expect(assessment).not.toHaveProperty('finalPass');
  });
});
