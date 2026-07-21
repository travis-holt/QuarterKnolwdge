// ─────────────────────────────────────────────────────────────────────────────
// Department Call QA rubric PROFILES.
//
// A "profile" is everything needed to grade ONE department consistently:
// its rubric categories/criteria, auto-fail definitions, criterion
// applicability (core / conditional), safety-critical + repairable criterion
// sets, per-criterion evidence policies, and the department-specific grading
// instructions injected into the grader prompt.
//
// `getQaRubricProfile(department)` is THE single authoritative resolution point.
// Nothing downstream of that call may re-import the global `QA_RUBRIC` /
// `QA_AUTO_FAILS` as a silent fallback: the resolved profile is threaded through
// prompt construction, response validation, scoring, category totals, core/NA
// handling, auto-fail evaluation, QA domain/competency projections, calibration,
// and coverage so the prompt rules, the deterministic scoring, and the auto-fail
// logic can never drift apart.
//
// Rules:
//  - `pediatrics` reuses the historical shared rubric VERBATIM (`qa-rubric-v2`),
//    so non-OB/GYN behavior is unchanged by the introduction of profiles.
//  - `obgyn` is the first dedicated department profile (`qa-rubric-obgyn-v1`).
//  - A department with no profile resolves to `null`. Scored grading FAILS
//    CLOSED there — an unsupported department must never silently inherit
//    another department's rubric.
//  - Historical attempts are read back through their STORED
//    `qa.gradingMetadata` and are never reinterpreted under a newer profile.
// ─────────────────────────────────────────────────────────────────────────────

import {
  QA_RUBRIC,
  QA_AUTO_FAILS,
  QA_PASS_THRESHOLD,
  QA_RUBRIC_VERSION,
  rubricCriteria,
} from './qaRubric.js';

// ── Evidence policies ────────────────────────────────────────────────────────
//
// The DEFAULT policy for every criterion is `navigator-only`: evidence must be a
// contiguous quote from ONE navigator turn (grading invariant §0.1–0.3). A
// criterion may opt into a narrower, explicitly named exception.
//
// `identity-verification` is the ONLY exception, and it exists for one reason:
// a caller frequently volunteers her own full name and date of birth in a single
// sentence, or identity is established across several chronological turns. In
// those calls the proof of *which identifiers were collected* legitimately lives
// in a caller turn, and a navigator-only gate would fail a navigator who did
// nothing wrong. The exception may establish ONLY (a) which identifiers were
// collected and (b) whether they were collected before protected disclosure.
//
// It deliberately does NOT relax navigator-only evidence for unsafe navigator
// actions, routing, scheduling, clinical advice, promises, scope/conduct
// violations, ordinary communication criteria, or ANY auto-fail — an auto-fail
// accuses the navigator of an explicit unsafe statement and always needs a
// navigator quote.
export const QA_EVIDENCE_POLICIES = {
  NAVIGATOR_ONLY: 'navigator-only',
  IDENTITY_VERIFICATION: 'identity-verification',
};

// ── OB/GYN verification identifiers (ONE definition, used everywhere) ────────
//
// This is the single source of truth for what "verified" means in OB/GYN. It is
// rendered into the `verify-three` criterion text, the `verify-before-access`
// criterion text, AND the `af-hipaa` auto-fail text, so the regular criterion
// and the privacy auto-fail can never accept different definitions.
export const OBGYN_VERIFICATION_IDENTIFIERS = Object.freeze([
  'patient first name',
  'patient last name',
  'patient date of birth (DOB)',
]);

export const OBGYN_VERIFICATION_NON_SUBSTITUTES = Object.freeze([
  'phone number',
  'home address',
]);

const OBGYN_IDENTIFIER_SENTENCE =
  `all three (3) required identifiers - ${OBGYN_VERIFICATION_IDENTIFIERS.join(', ')}`;
const OBGYN_NON_SUBSTITUTE_SENTENCE =
  `A ${OBGYN_VERIFICATION_NON_SUBSTITUTES.join(' or ')} does NOT substitute for any of these three identifiers.`;
const OBGYN_VOLUNTEERED_SENTENCE =
  'Identifiers the caller volunteers count - separate questions are not required. They may be collected across several turns, but they must all be collected BEFORE any protected detail is shared.';

// ── The OB/GYN rubric ────────────────────────────────────────────────────────
//
// Point layout (unchanged category weights, 100 total):
//   Opening 10 · Verification 10 · Call Control 10 · Documentation Reason 10 ·
//   Communication 15 · Active Listening 10 · Knowledge 15 · Scheduling 15 ·
//   Closing 5
//
// What differs from the shared rubric, and why:
//   * verify-three   — exactly first name + last name + DOB; phone/address never
//                      substitute. Same definition as af-hipaa.
//   * comm-empathy   — CONDITIONAL (core: false): applies only when the caller
//                      expresses an emotional/sensitive cue. No cue → NA, never
//                      a deduction for avoiding forced, robotic empathy.
//   * listen-ack     — natural recognition of the request counts; scripted
//                      "I understand"/"I hear you" is not required.
//   * control-narrate— CONDITIONAL (core: false): applies only to a hold or a
//                      meaningful wait. Quick silent chart/schedule lookups are
//                      NA, not a deduction.
//   * doc-reason     — department-neutral wording; the Pediatrics-only "Shots PE
//                      UTD" / "GS newborn" examples are gone.
//   * closing        — ONE 5-point criterion requiring an explicit offer of
//                      further assistance. OB/GYN does not run the survey, so the
//                      survey criterion is removed entirely and survey wording is
//                      score-neutral.
const OBGYN_RUBRIC = [
  {
    id: 'opening', name: 'Opening', criteria: [
      { id: 'open-greet', points: 4, core: true, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Opened with a pleasant, professional greeting that offered assistance (e.g. "how can I help you today?"). Natural approved variations count; no single exact script is required.' },
      { id: 'open-name', points: 3, core: true, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Stated their OWN first name during the greeting.' },
      { id: 'open-org', points: 3, core: true, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Identified the organization during the greeting - "Aizer Health" or "Aizer Women\'s Health" both count.' },
    ],
  },
  {
    id: 'verification', name: 'Verification', criteria: [
      { id: 'verify-three', points: 6, core: true,
        evidencePolicy: QA_EVIDENCE_POLICIES.IDENTITY_VERIFICATION,
        domainIds: ['intake', 'boundaries'], competencyIds: ['compliance', 'riskManagement'],
        text: `Collected ${OBGYN_IDENTIFIER_SENTENCE}. ${OBGYN_NON_SUBSTITUTE_SENTENCE} ${OBGYN_VOLUNTEERED_SENTENCE}` },
      { id: 'verify-before-access', points: 4, core: true,
        evidencePolicy: QA_EVIDENCE_POLICIES.IDENTITY_VERIFICATION,
        // Transcript ORDER is part of this criterion: identity evidence that
        // appears only after a protected detail was already shared can never
        // retroactively satisfy "verified before access".
        evidenceOrder: 'before-protected-disclosure',
        domainIds: ['intake', 'boundaries'], competencyIds: ['compliance', 'riskManagement'],
        text: `Completed all three identifiers BEFORE sharing or confirming any protected account, chart, appointment, or result detail. Identifiers collected AFTER a protected detail was shared do not satisfy this criterion.` },
    ],
  },
  {
    id: 'callControl', name: 'Call Control', criteria: [
      { id: 'control-narrate', points: 5, core: false, domainIds: ['routing', 'documentation'], competencyIds: ['communication', 'problemResolution'],
        text: 'CONDITIONAL - applies ONLY when the navigator placed the caller on hold or created a meaningful wait. In that case they explained it first ("may I place you on a brief hold while I check that?", "let me check the schedule, one moment please"). If no hold or meaningful wait occurred, this is NA. A quick, silent chart or schedule lookup needs no narration and is never a deduction.' },
      { id: 'control-guide', points: 5, core: true, domainIds: ['classification'], competencyIds: ['communication', 'problemResolution'],
        text: 'Kept the call moving toward a resolution with purposeful questions - did not drift, stall, or leave the caller directing the call.' },
    ],
  },
  {
    id: 'docReason', name: 'Documentation Reason', criteria: [
      { id: 'doc-reason', points: 6, core: false, domainIds: ['documentation', 'classification'], competencyIds: ['sopApplication', 'communication'],
        text: 'Stated or confirmed a concise, accurate reason for the contact that matches the department\'s documentation conventions for this workflow (e.g. an annual GYN visit, a New OB pairing, or a pregnancy-related clinical question). No invented diagnosis, and nothing beyond what the caller actually reported.' },
      { id: 'doc-te', points: 4, core: false, domainIds: ['routing', 'documentation'], competencyIds: ['escalation', 'sopApplication'],
        text: 'Communicated and/or completed the correct message/routing next step when the scenario called for one. Natural patient-facing language such as "send the request," "send a message," or "route this" counts when the intended destination/workflow is correct; exact internal wording is not required.' },
    ],
  },
  {
    id: 'communication', name: 'Communication', criteria: [
      { id: 'comm-plain', points: 5, core: true, domainIds: ['intake'], competencyIds: ['communication'],
        text: 'Used simple, jargon-free language the caller could follow.' },
      { id: 'comm-professional', points: 5, core: true, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Was courteous and professional in every turn.' },
      { id: 'comm-empathy', points: 5, core: false, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'CONDITIONAL - applies ONLY when the CALLER EXPRESSED emotion or distress (worry, fear, pain or significant discomfort, frustration, confusion, urgency, disappointment or anger), OR described a clearly adverse or emotionally sensitive event in a way that reasonably calls for acknowledgment. In that case the navigator acknowledged it in their own natural words ("I\'m sorry you\'re dealing with that", "I understand why that would be concerning"). Exact phrases are NOT required. The SUBJECT MATTER of a Women\'s Health call is never by itself an emotional cue: pregnancy, a New OB appointment, contraception, an annual GYN visit, or routine test scheduling are routine requests. If the caller expressed no emotion or distress, this is NA; never deduct for the absence of forced or robotic empathy.' },
    ],
  },
  {
    id: 'activeListening', name: 'Active Listening', criteria: [
      { id: 'listen-ack', points: 5, core: true, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Showed the caller\'s request was understood, in natural words. A plain recognition counts ("sure, I can help you schedule that", "okay, let me check your chart", "got it, you\'re calling about your follow-up"), as does a concise recap or a clarifying question. Scripted empathy ("I understand", "I hear you") is NOT required when the caller has expressed no emotional concern.' },
      { id: 'listen-gather', points: 5, core: true, domainIds: ['intake', 'classification'], competencyIds: ['criticalThinking', 'communication'],
        text: 'Gathered the needed information before answering - no assumptions or premature answers.' },
    ],
  },
  {
    id: 'knowledge', name: 'Knowledge', criteria: [
      { id: 'know-rule', points: 9, core: true, domainIds: ['classification', 'routing', 'boundaries'], competencyIds: ['sopKnowledge', 'sopApplication', 'riskManagement'],
        text: 'Applied the correct SOP rule for this scenario based on the caller\'s actual request and department context. Do not require unrelated SOP checks, exact policy wording, or caller-facing confirmation of system-visible facts unless the scenario makes them the governing issue.' },
      { id: 'know-details', points: 6, core: false, domainIds: ['classification', 'routing', 'scheduling'], competencyIds: ['sopKnowledge', 'sopApplication', 'compliance'],
        text: 'Every concrete detail given (facility, address, provider, process step) was accurate per the SOP - nothing invented.' },
    ],
  },
  {
    id: 'scheduling', name: 'Appointment Scheduling', criteria: [
      { id: 'sched-flow', points: 8, core: false, domainIds: ['scheduling'], competencyIds: ['sopApplication', 'problemResolution'],
        text: 'Reached the correct scheduling outcome - right provider, visit type, and location for the request.' },
      { id: 'sched-recap', points: 7, core: false, domainIds: ['scheduling', 'documentation'], competencyIds: ['communication', 'sopApplication'],
        text: 'Recapped the appointment date, time, and place, and gave arrival instructions.' },
    ],
  },
  {
    id: 'closing', name: 'Closing', criteria: [
      // Replaces the shared rubric's close-survey (3) + close-anything-thanks (2).
      // A NEW id, because reusing `close-survey` for a non-survey rule would be
      // actively misleading in stored results and supervisor views. The domain /
      // competency tags are the UNION of the two removed criteria, so closing
      // evidence is not silently dropped from QA domain/competency summaries.
      { id: 'close-offer-help', points: 5, core: true,
        domainIds: ['documentation', 'intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Explicitly OFFERED further assistance before the call ended - "is there anything else I can help you with?", "anything else I can assist you with?", "can I help you with anything else?", or any other natural wording that clearly offers more help. Exact scripted wording is NOT required, but the offer must actually be made: thanks, a goodbye, a mutual exchange of thanks, or any other polite sign-off WITHOUT an offer of further help does not satisfy this criterion. OB/GYN does not use a patient survey - survey wording neither satisfies this criterion nor costs any points.' },
    ],
  },
];

const OBGYN_AUTO_FAILS = [
  { id: 'af-hipaa', domainIds: ['boundaries', 'intake'], competencyIds: ['compliance', 'riskManagement'],
    // SAME identifier definition as verify-three / verify-before-access.
    text: `Disclosed Protected Health Information or discussed account/chart/appointment details WITHOUT first collecting ${OBGYN_IDENTIFIER_SENTENCE}. ${OBGYN_NON_SUBSTITUTE_SENTENCE}` },
  { id: 'af-scope', domainIds: ['boundaries'], competencyIds: ['compliance', 'escalation', 'riskManagement'],
    text: 'Read lab/imaging results to the caller or gave clinical/medication advice, instead of routing to the clinical team.' },
  { id: 'af-conduct', domainIds: ['boundaries'], competencyIds: ['communication', 'customerHandling'],
    text: 'Used profanity or sarcasm toward the caller.' },
];

// Department-specific grading/fairness instructions appended to the grader
// prompt. These are the rules that would otherwise be hard-coded in
// grade-call-qa.js behind `department === 'obgyn'` checks.
const OBGYN_GRADER_INSTRUCTIONS = [
  'DEPARTMENT GRADING RULES (OB/GYN) - these override any general guidance above where they conflict:',
  `- VERIFICATION: the three required identifiers are exactly ${OBGYN_VERIFICATION_IDENTIFIERS.join(', ')}. ${OBGYN_NON_SUBSTITUTE_SENTENCE} ${OBGYN_VOLUNTEERED_SENTENCE} If the caller volunteered her full name and DOB in one sentence, verification is complete and the navigator loses nothing for not re-asking. The [af-hipaa] auto-fail uses this SAME definition - never apply one standard to [verify-three] and another to [af-hipaa].`,
  '- CLOSING: [close-offer-help] requires an EXPLICIT offer of further assistance before the call ends ("is there anything else I can help you with?" and natural equivalents). Judge the MEANING, not a fixed phrase list - any wording that clearly offers more help counts. "Thank you", "have a good day", "goodbye", a mutual exchange of thanks, or any other polite sign-off WITHOUT an offer of further help is NOT_MET. A polite sign-off alone is never sufficient.',
  '- SURVEY: OB/GYN runs NO patient survey. Never require survey wording and never deduct for it. If the navigator mentions a survey it is score-neutral: it does not satisfy [close-offer-help] on its own, and combined with a valid offer of help it still earns only the normal closing points.',
  '- EMPATHY: [comm-empathy] is CONDITIONAL and is triggered by what the CALLER EXPRESSED, never by the call\'s subject matter. Mark it MET when the caller expressed worry, fear, pain or significant discomfort, frustration, confusion, urgency, disappointment or anger — or described a clearly adverse or emotionally sensitive event in a way that reasonably calls for acknowledgment — AND the navigator acknowledged it in any natural, contextually appropriate words. Mark it NOT_MET only when such a cue was expressed and the navigator gave no meaningful acknowledgment. Mark it NA when no such cue was expressed. A Women\'s Health TOPIC is NOT a cue: "I need to schedule my New OB appointment", a contraception question, an annual GYN visit, or routine test scheduling are routine requests and leave this NA. The caller need not use the exact words "scared" or "worried" — but the cue must be grounded in something the caller actually said in this transcript, not assumed from the clinical subject. Never require the exact phrases "I understand" or "I hear you".',
  '- ACTIVE LISTENING: [listen-ack] is satisfied by natural recognition of the request ("sure, I can help you schedule that", "okay, let me check your chart", a concise recap, or a clarifying question). Do not require emotional scripting on a routine call. [listen-gather] stays strict: insufficient information gathering is still NOT_MET.',
  '- HOLDS AND NARRATION: [control-narrate] is CONDITIONAL. Mark it NA when no hold or meaningful wait occurred. Mark it MET when the navigator explained a hold or a longer pause before it. Mark it NOT_MET only when the transcript shows an EXPLICIT hold or meaningful wait that was not explained. Never require narration for a quick chart lookup, a quick schedule check, or an ordinary short pause. You CANNOT observe dead air, hold duration, or delay in a text transcript - never infer them; judge only what the transcript explicitly states.',
  '- DOCUMENTATION: judge [doc-reason] against OB/GYN documentation conventions. Pediatric examples (physical-exam/PE status, newborn abbreviations) are NOT OB/GYN standards and must never be required here.',
].join('\n');

const PEDIATRICS_GRADER_INSTRUCTIONS = [
  '- Natural closings count: for the closing pleasantry criteria, a courteous natural wrap-up is enough. If the caller has already said thanks or goodbye and the navigator responds in kind, or the navigator gives any polite sign-off, treat the closing pleasantry as MET even without the exact scripted phrase. Do not require rote wording.',
  '- WORKFLOW FAIRNESS RULES: For a standard medication refill, do not require PE / Physical Exam / physical status verification unless the scenario makes it the governing issue. Require medication name, preferred pharmacy, callback details when needed, out-of-medication urgency, a correct message/routing step, no promised approval, and no medication advice. Do not fail Knowledge solely because PE was not asked.',
  '- Natural routing wording: exact TE or Telephone Encounter wording is not required. "send the request," "send a message," "send this over," "route this," "put in a note," or sending it to the nurse, provider, refill team, or clinical team counts when the workflow and destination are correct.',
].join('\n');

// Criteria whose failure represents a patient-safety / compliance risk rather
// than lost quality points. Per-profile so a department can add or remove one
// without touching another department. Grading invariant R10 requires every
// repairable criterion to also be safety-critical.
const SHARED_SAFETY_CRITICAL = ['verify-three', 'verify-before-access', 'know-rule', 'doc-te'];

// The ONLY criteria the deterministic repair layer may ever touch, and only in
// the direction NOT_MET -> MET.
const SHARED_REPAIRABLE = ['know-rule', 'doc-te'];

// ── Profile signature ────────────────────────────────────────────────────────
//
// A deterministic fingerprint over EVERYTHING that affects grading, so a
// validated response can be bound to the exact profile that produced it. Two
// profiles with identical criterion IDs but different points, `core`
// applicability, categories, evidence policies, or auto-fail definitions produce
// DIFFERENT signatures — criterion IDs alone are not profile identity.
//
// Pure JS (FNV-1a over a canonical string) rather than node:crypto, because this
// module is also imported by the browser bundle.
function canonicalProfileString({
  department, rubricVersion, rubric, autoFails, passThreshold,
  safetyCriticalCriteria, repairableCriteria,
}) {
  const criteria = rubricCriteria(rubric).map((c) => [
    c.categoryId, c.categoryName, c.id, c.points, c.core === true ? 1 : 0,
    (c.domainIds ?? []).join('+'),
    (c.competencyIds ?? []).join('+'),
    c.evidencePolicy ?? '-',
    c.evidenceOrder ?? '-',
  ].join(':'));
  const fails = autoFails.map((a) => [
    a.id, (a.domainIds ?? []).join('+'), (a.competencyIds ?? []).join('+'), a.evidencePolicy ?? '-',
  ].join(':'));
  return [
    `dept=${department}`,
    `ver=${rubricVersion}`,
    `pass=${passThreshold}`,
    `cats=${rubric.map((cat) => `${cat.id}/${cat.criteria.length}`).join(',')}`,
    `crit=${criteria.join('|')}`,
    `af=${fails.join('|')}`,
    `safety=${[...safetyCriticalCriteria].slice().sort().join(',')}`,
    `repair=${[...repairableCriteria].slice().sort().join(',')}`,
  ].join(';');
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function profileSignature(spec) {
  const canonical = canonicalProfileString(spec);
  // Two independent hashes over the canonical string plus its length make an
  // accidental collision between two real profiles vanishingly unlikely, while
  // staying dependency-free and deterministic across environments.
  return `${fnv1a(canonical)}-${fnv1a(`${canonical.length}#${canonical.split('').reverse().join('')}`)}`;
}

function buildProfile({
  department, rubricVersion, rubric, autoFails, graderInstructions,
  safetyCriticalCriteria = SHARED_SAFETY_CRITICAL,
  repairableCriteria = SHARED_REPAIRABLE,
  passThreshold = QA_PASS_THRESHOLD,
}) {
  const criteria = rubricCriteria(rubric);
  const signature = profileSignature({
    department, rubricVersion, rubric, autoFails, passThreshold,
    safetyCriticalCriteria, repairableCriteria,
  });
  return Object.freeze({
    signature,
    department,
    rubricVersion,
    rubric,
    autoFails,
    passThreshold,
    graderInstructions,
    criteria,
    criteriaById: new Map(criteria.map((criterion) => [criterion.id, criterion])),
    criterionIds: new Set(criteria.map((criterion) => criterion.id)),
    autoFailIds: new Set(autoFails.map((autoFail) => autoFail.id)),
    safetyCriticalCriteria: new Set(safetyCriticalCriteria),
    repairableCriteria: new Set(repairableCriteria),
    totalPoints: criteria.reduce((sum, criterion) => sum + criterion.points, 0),
    evidencePolicyFor: (criterionId) =>
      criteria.find((criterion) => criterion.id === criterionId)?.evidencePolicy
        ?? QA_EVIDENCE_POLICIES.NAVIGATOR_ONLY,
    // The criteria (if any) that may cite caller evidence, so the PROMPT can
    // render its evidence rules from the profile instead of hard-coding a
    // global "never a caller line" sentence that contradicts this policy.
    identityVerificationCriteria: criteria
      .filter((criterion) => criterion.evidencePolicy === QA_EVIDENCE_POLICIES.IDENTITY_VERIFICATION)
      .map((criterion) => criterion.id),
  });
}

// Bump when the OB/GYN criteria set, points, category weights, applicability,
// or auto-fail definitions change.
export const QA_RUBRIC_VERSION_OBGYN = 'qa-rubric-obgyn-v1';

export const QA_RUBRIC_PROFILES = Object.freeze({
  // Pediatrics keeps the historical shared rubric verbatim: introducing profiles
  // must not change a single non-OB/GYN verdict, point, or version string.
  pediatrics: buildProfile({
    department: 'pediatrics',
    rubricVersion: QA_RUBRIC_VERSION,
    rubric: QA_RUBRIC,
    autoFails: QA_AUTO_FAILS,
    graderInstructions: PEDIATRICS_GRADER_INSTRUCTIONS,
  }),
  obgyn: buildProfile({
    department: 'obgyn',
    rubricVersion: QA_RUBRIC_VERSION_OBGYN,
    rubric: OBGYN_RUBRIC,
    autoFails: OBGYN_AUTO_FAILS,
    graderInstructions: OBGYN_GRADER_INSTRUCTIONS,
  }),
});

export const QA_PROFILE_DEPARTMENTS = Object.freeze(Object.keys(QA_RUBRIC_PROFILES));

/**
 * THE single authoritative department -> rubric profile resolution point.
 *
 * Returns `null` for an unsupported/unknown/missing department. Callers in the
 * SCORED runtime must fail closed on `null` (see `requireQaRubricProfile`) - a
 * future department must never silently inherit another department's rubric.
 *
 * @param {string} department server-authoritative department from the attempt
 */
export function getQaRubricProfile(department) {
  const id = String(department ?? '').trim();
  return Object.prototype.hasOwnProperty.call(QA_RUBRIC_PROFILES, id)
    ? QA_RUBRIC_PROFILES[id]
    : null;
}

export class UnsupportedQaDepartmentError extends Error {
  constructor(department) {
    super(`No Call QA rubric profile is configured for department "${department ?? ''}".`);
    this.name = 'UnsupportedQaDepartmentError';
    this.department = department ?? null;
    this.code = 'qa-rubric-profile-unsupported';
  }
}

/**
 * Fail-closed resolver for the scored runtime. Throws rather than falling back.
 */
export function requireQaRubricProfile(department) {
  const profile = getQaRubricProfile(department);
  if (!profile) throw new UnsupportedQaDepartmentError(department);
  return profile;
}

/**
 * Resolve the profile that ACTUALLY graded a stored attempt, for rendering and
 * calibration of historical results. Prefers the recorded rubric version so an
 * attempt graded under an older profile is never reinterpreted under a newer
 * one. Returns `null` when the stored version matches no known profile.
 *
 * @param {{rubricDepartment?:string, rubricVersion?:string}} gradingMetadata
 * @param {string} [fallbackDepartment] the attempt's stored department
 */
export function profileForGradedAttempt(gradingMetadata, fallbackDepartment) {
  const version = String(gradingMetadata?.rubricVersion ?? '').trim();

  // A RECORDED version is authoritative. If we do not recognise it, the correct
  // answer is "unavailable" — never a guess, and never a silent fall-through to
  // Pediatrics. Reinterpreting an old result under a current rubric would show a
  // supervisor scores the attempt never actually received.
  if (version) {
    const match = Object.values(QA_RUBRIC_PROFILES)
      .find((profile) => profile.rubricVersion === version);
    if (!match) return null;
    // Cross-check the recorded department when one is present: a version/
    // department pair that disagrees is corrupt metadata, not a usable profile.
    const recordedDepartment = String(gradingMetadata?.rubricDepartment ?? '').trim();
    if (recordedDepartment && recordedDepartment !== match.department) return null;
    return match;
  }

  // No version recorded at all: a genuinely pre-versioning legacy result. Only
  // here may the stored department decide, because that is the behavior those
  // records were written under.
  return getQaRubricProfile(gradingMetadata?.rubricDepartment ?? fallbackDepartment);
}

/**
 * True when grading metadata EXISTS and records a rubric version. Used to tell
 * "genuinely pre-versioning legacy record" apart from "records a version we no
 * longer recognise" — the two must not be handled the same way.
 */
export function recordsRubricVersion(gradingMetadata) {
  return String(gradingMetadata?.rubricVersion ?? '').trim().length > 0;
}
