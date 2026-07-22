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
// v5 = verification-integrity correction pass (2026-07-21). The MODEL-VISIBLE
//      contract changed again, so the version had to move even though the OB/GYN
//      criteria, points and applicability are untouched (the rubric stays
//      `qa-rubric-obgyn-v1`):
//        * identity claims must now name the PATIENT's identifiers, and the
//          prompt says so — the server rejects a navigator self-introduction, a
//          provider/staff name, or an unrelated mention, so a grader following
//          v4 guidance in good faith would silently lose verification credit;
//        * spoken-word dates of birth are explicitly acceptable, and the
//          documented unsupported forms are named;
//        * every auto-fail id must be returned exactly once, triggered or not;
//        * a triggered auto-fail must carry its verbatim quote.
// v6 = identity-contract alignment correction pass (2026-07-21). The MODEL-VISIBLE
//      contract changed again (the OB/GYN criteria, points and applicability are
//      still untouched, so the rubric stays `qa-rubric-obgyn-v1`):
//        * structured identity claims are now caller-ONLY. The response schema no
//          longer advertises `role: "navigator"` for identityEvidence, and the
//          evidence-role rules no longer say the grader "MAY cite navigator
//          turns" for identity — the server always rejected a navigator-sourced
//          identifier, so v5's schema/prompt contradicted the server;
//        * the three identifiers must belong to ONE patient identity, and the
//          prompt says so — a caller's own DOB cannot pair with a different
//          patient's name, and first/last cannot come from two different people.
export const CALL_QA_PROMPT_VERSION = 'call-qa-grader-v6';

// Prompt versions this repository can still INTERPRET for stored records.
// Historical attempts keep rendering under the version they recorded; this list
// exists so a prior population can be accepted explicitly rather than an unknown
// version being silently treated as current.
//
// Being interpretable is NOT the same as being producible. A stored v3/v4 record
// is readable evidence; a NEW run must use `CALL_QA_PROMPT_VERSION`. Calibration
// enforces exactly that split (see `docs/CALL_QA_CALIBRATION.md`), and readiness
// never blends two prompt populations.
export const SUPPORTED_CALL_QA_PROMPT_VERSIONS = Object.freeze([
  'call-qa-grader-v3',
  'call-qa-grader-v4',
  'call-qa-grader-v5',
  'call-qa-grader-v6',
]);

const SUPPORTED = new Set(SUPPORTED_CALL_QA_PROMPT_VERSIONS);

/** True for a version this build can still interpret in a STORED record. */
export function isSupportedStoredPromptVersion(version) {
  return SUPPORTED.has(String(version ?? '').trim());
}

/** True only for the version a NEW model run must be produced under. */
export function isCurrentPromptVersion(version) {
  return String(version ?? '').trim() === CALL_QA_PROMPT_VERSION;
}
