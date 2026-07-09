// ─────────────────────────────────────────────────────────────────────────────
// PATIENT NAVIGATOR OPERATING MODEL — shared AI prompt context.
//
// The leading underscore keeps Express from turning this file into an HTTP route.
//
// WHY THIS EXISTS: our AI features (scenario generation, roleplay, practice
// grading, QA grading, audit generation, coaching, learning paths) were too
// SOP-literal — they rewarded exact wording and isolated rule-recall instead of
// real navigator decision quality. This module distils the Patient Navigator job
// into a reusable, dependency-light prompt block so every endpoint judges the
// same question:
//
//   "Can this navigator safely guide a patient through a messy real-world call
//    and choose the correct workflow?"  — NOT  "Did they repeat the SOP verbatim?"
//
// It describes the JOB (a decision loop + realistic call behaviour + scoring
// principles + the mistake taxonomy). It does NOT contain department SOP facts —
// those still come from _sop-context.js and remain the source of truth for
// specific rules. Keep this file free of I/O and of any real provider PII.
// ─────────────────────────────────────────────────────────────────────────────

import { departmentName } from '../src/data/departments.js';

// The eight-step decision loop that defines the job. Every AI feature should
// reason about a call in these terms rather than as isolated SOP lines.
export const NAVIGATOR_DECISION_LOOP = `PATIENT NAVIGATOR DECISION LOOP (how the job actually works):
1. Identify the caller and reach the correct patient/chart safely.
2. Confirm the caller is authorized before discussing chart or account details.
3. Classify the request: scheduling, clinical question, prescription refill, lab
   result, referral, records/forms, urgent symptoms, wrong department, complaint,
   approval-needed, or several of these in one call.
4. Decide the correct action: handle directly, schedule, create a Telephone
   Encounter (TE), transfer, escalate, or ask a clarifying question.
5. Apply the department-specific routing and scheduling rules from the active SOP.
6. Protect hard boundaries: no clinical advice, no lab/result interpretation, no
   promised approvals, no disclosure to unauthorized callers.
7. Document with the correct destination, a clear reason, callback details, and
   the relevant context (symptoms/onset, medication + pharmacy, gestational age,
   urgency / completely-out-of-medication status) when it applies.
8. Close with a clear next step, realistic expectations, and a professional wrap-up.`;

// How real navigators behave on the phone — used to make roleplay realistic and
// to stop graders penalising natural, non-scripted (but correct) handling.
export const REALISTIC_CALL_BEHAVIOR = `REALISTIC FLOOR BEHAVIOR:
- Lookup sequence adapts to the department and is NOT the scored behavior. Pediatrics
  often starts from the parent/family phone number because one caller handles several
  children; adult departments (OB/GYN, Behavioral Health, Internal Medicine) often
  start from DOB then name because the patient usually calls for themselves. Either
  order is fine — do not treat phone-before-DOB or DOB-before-phone as inherently
  correct or incorrect. What matters is reaching the correct chart with the caller's
  authorization and avoiding a wrong-chart mistake.
- Good navigators ask clarifying questions BEFORE routing, and explain the next step
  in plain, patient-friendly language rather than reciting policy.
- Real calls are messy: callers under-explain, add a second request mid-call, are
  vague about dates, or are anxious. Strong navigators adapt without sounding robotic.
- One call can contain several workflows; each gets its own correct handling and its
  own documentation.`;

// The judging philosophy: strict where safety lives, flexible on wording.
export const SCORING_PRINCIPLES = `SCORING PRINCIPLES:
- Be STRICT on safety, privacy, scope, routing, scheduling rules, and documentation.
- Be FLEXIBLE on natural wording — do not require scripted phrasing when the navigator
  reaches the correct, safe outcome and the intended concept is clear.
- Do not fail a navigator for missing an exact SOP phrase when the correct concept is
  present. Judge the decision, not the vocabulary.
- Do not reward OVER-escalation when the SOP lets the navigator handle the issue
  directly; do not reward UNDER-escalation when an urgent/safety rule requires escalation.
- Lookup order itself is never the scored target — grade whether the correct patient/
  chart and caller authorization were established before acting.
- For a STANDARD refill, focus on: medication/prescription name, preferred pharmacy,
  callback, completely-out-of-medication priority, correct routing, no promised
  approval, and no medication advice. Do NOT require PE (physical exam) verification
  and do NOT deny/block the refill based only on PE status unless the active SOP or the
  scenario explicitly makes PE status the governing issue.`;

// The taxonomy of real navigator mistakes — used to seed realistic wrong answers,
// planted audit errors, and coaching categories.
export const WORKFLOW_MISTAKE_TYPES = `NAVIGATOR MISTAKE TYPES (realistic near-misses, not strawmen):
- wrong patient/chart
- missing caller authorization
- wrong request classification
- wrong TE queue / owner
- wrong appointment type
- wrong timing rule (e.g. same-day vs pre-booked; gestational-age window)
- clinical advice / scope violation
- lab or result interpretation
- promised approval or same-day completion without basis
- missing callback number
- missing medication or pharmacy detail
- missing completely-out-of-medication priority
- mixed documentation across multiple children/patients on one call
- blind transfer without clarifying the request
- failure to escalate urgent symptoms
- unnecessary escalation where the SOP says to handle directly`;

// Per-mode framing appended after the shared blocks. Keep these short and stable —
// tests assert on key phrases, not exact wording.
const MODE_GUIDANCE = {
  'scenario-generation':
`FOR SCENARIO GENERATION: write realistic caller situations that test navigator DECISION
QUALITY, not SOP trivia. Name the exact workflow being tested where possible. Mix normal,
edge-case, and failure-state situations. Wrong answers must be realistic near-misses drawn
from the mistake types above (wrong queue, premature scheduling, clinical overreach, missing
callback/details, over- or under-escalation, wrong chart, promised approval, documentation
gap). The best answer should follow the decision loop.`,
  'roleplay-init':
`FOR ROLEPLAY SETUP: build a coherent hidden case so the caller behaves consistently. Give
the navigator a scenario that requires them to identify, classify, and choose the correct
workflow — not a generic "I have a question" call. Do not reveal the correct SOP answer in
the scenario.`,
  'roleplay-caller':
`FOR ROLEPLAY AS THE CALLER: stay consistent with your case facts, reveal details only when
asked, and react naturally when the navigator skips clarification, gives wrong information,
overpromises, or routes incorrectly. Never volunteer the correct SOP answer or coach the
navigator.`,
  'practice-grading':
`FOR PRACTICE GRADING: grade the navigator across identity/authorization, classification,
routing/escalation, scheduling (when relevant), scope/privacy boundaries, documentation/
follow-through, communication/call control, and adaptability when the caller adds complexity.
Reference specific transcript lines. Apply the scoring principles above.`,
  'audit-generation':
`FOR AUDIT (SPOT-THE-ERROR) GENERATION: the transcript must follow the real call shape —
identify the correct patient/chart safely for the department context, classify the request,
act/route/schedule/escalate, then document and close. Plant exactly one plausible mistake
from the mistake types above in a single Agent turn; all other Agent turns must be correct.`,
  'qa-grading':
`FOR QA GRADING: judge each rubric criterion against the CALL'S CONTEXT and the active SOP,
applying the scoring principles above. Strict on safety, privacy, routing, scheduling, and
documentation; flexible on natural wording and mis-transcribed or synonymous terms.`,
  'coaching':
`FOR COACHING: explain each weakness in navigator job terms — which step of the decision loop
broke down (identity/authorization, classification, routing, scheduling, boundaries,
documentation, communication) and what to do next time. Be specific and encouraging; do not
tell the navigator to "just review the SOP" and do not invent SOP facts.`,
  'learning-path':
`FOR LEARNING PATHS: weak domains map to real navigator skills — intake = chart/authorization
safety; classification = recognizing the request type; routing = right owner/escalation;
scheduling = visit type / timing / provider constraints; boundaries = no clinical advice /
privacy / no promises; documentation = TE / reason / callback / follow-through. Sequence steps
to strengthen the specific skill that is weak.`,
};

/**
 * Return a plain-text operating-model prompt block, tailored to a mode.
 *
 * @param {object} [opts]
 * @param {string} [opts.department] department id (e.g. 'pediatrics', 'obgyn')
 * @param {string} [opts.mode] one of the MODE_GUIDANCE keys; unknown/omitted →
 *   the shared blocks only.
 * @returns {string}
 */
export function navigatorContextBlock({ department, mode } = {}) {
  const deptLabel = department ? departmentName(department) : null;
  const header = deptLabel
    ? `PATIENT NAVIGATOR OPERATING MODEL — department context: ${deptLabel}`
    : `PATIENT NAVIGATOR OPERATING MODEL`;

  const sections = [
    header,
    `Patient Navigators are cross-department inbound call handlers (Pediatrics, OB/GYN,
Behavioral Health, and later Internal Medicine / Adult Medicine). Their job is to guide each
patient to the correct next step while protecting safety, privacy, documentation quality, and
scope boundaries — not to recite SOP wording. Core systems: Intermedia (inbound calls),
eCW/ECW (charts, scheduling, e-prescription logs, Telephone Encounters), Microsoft Teams
(department group chats checked at shift start for updates that affect scheduling, routing,
provider availability, approvals, and workflow rules). Judge each call by this question:
"Can this navigator safely guide a patient through a messy real-world call and choose the
correct workflow?" — not "Did they repeat the SOP wording exactly?"`,
    NAVIGATOR_DECISION_LOOP,
    REALISTIC_CALL_BEHAVIOR,
    SCORING_PRINCIPLES,
    WORKFLOW_MISTAKE_TYPES,
  ];

  const guidance = MODE_GUIDANCE[mode];
  if (guidance) sections.push(guidance);

  return sections.join('\n\n');
}
