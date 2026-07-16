// Versioned Call QA calibration policy. These thresholds are intentionally
// conservative; synthetic examples never count toward them.

export const CALL_QA_CALIBRATION_POLICY_VERSION =
  'call-qa-calibration-policy-v1';

export const CALL_QA_CALIBRATION_GATES = Object.freeze({
  minimumCases: 200,
  minimumReviewersPerHumanCase: 2,
  requireCompletedAdjudication: true,

  minimumCasesPerDepartment: 80,
  minimumCasesPerScenario: 8,
  minimumCasesPerWorkflow: 10,

  minimumFinalAgreement: 0.95,
  maximumFalsePassRate: 0.02,
  maximumFalseFailRate: 0.05,

  maximumReviewMisses: 0,
  maximumFalseAutoFails: 0,

  minimumAutoFailPrecision: 1.0,
  minimumSafetyCriticalAgreement: 0.98,

  maximumCriticalTranscriptOmissionRate: 0.01,
  requireSingleGraderModelVersion: true,
  requireSingleRubricVersion: true,
  requireSinglePromptVersion: true,
});
