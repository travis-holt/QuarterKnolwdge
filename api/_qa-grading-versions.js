// Shared scored Call QA grading versions. Keep lightweight so offline
// calibration can validate provenance without importing the Gemini endpoint.

// Bump whenever the grading INSTRUCTIONS materially change. Recorded on
// qa.gradingMetadata.promptVersion.
//
// v3 = the judgment-basis (EVIDENCE/ABSENCE) grader contract + caller-observable
//      OB/GYN grading from the operating-model-v2 PR.
// v4 = department rubric profiles (2026-07-21). The prompt contract changed
//      materially: evidence ROLE rules are now rendered from the resolved
//      profile instead of a global navigator-only sentence; transcript turns
//      carry explicit [n] indices; the response schema gained the structured
//      `identityEvidence` array; conditional criteria are described as
//      legitimately NA; and the generic survey/closing examples were removed so
//      a department without a survey is not given contradictory guidance.
export const CALL_QA_PROMPT_VERSION = 'call-qa-grader-v4';

// Prompt versions this repository can still interpret for stored records.
// Historical attempts keep rendering under the version they recorded; this list
// exists so calibration can accept a prior population explicitly rather than
// silently treating an unknown version as current.
export const SUPPORTED_CALL_QA_PROMPT_VERSIONS = Object.freeze([
  'call-qa-grader-v3',
  'call-qa-grader-v4',
]);
