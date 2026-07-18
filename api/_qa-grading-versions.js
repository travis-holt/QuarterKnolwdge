// Shared scored Call QA grading versions. Keep lightweight so offline
// calibration can validate provenance without importing the Gemini endpoint.

// Bump whenever the grading INSTRUCTIONS materially change. Recorded on
// qa.gradingMetadata.promptVersion. v3 = the judgment-basis (EVIDENCE/ABSENCE)
// grader contract + caller-observable OB/GYN grading from the operating-model-v2 PR.
export const CALL_QA_PROMPT_VERSION = 'call-qa-grader-v3';
