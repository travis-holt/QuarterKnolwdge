// ─────────────────────────────────────────────────────────────────────────────
// qa:live-contract-smoke — an OPT-IN, NON-PRODUCTION live check that the pinned
// scored Call QA grader model actually OBEYS the CURRENT structured contract
// (`CALL_QA_PROMPT_VERSION`, now v10).
//
// Unit and stubbed-pipeline tests prove the deterministic pipeline, but they
// cannot prove the live Gemini model emits the caller-only `identityEvidence`
// array correctly, keeps the three identifiers on ONE patient, judges the closing
// rule, or — added for v9 — actually HONOURS the navigator-visible chart and the
// sched-recap / listen-gather applicability rules. This command runs SYNTHETIC
// transcripts through the REAL prompt/schema/validator/pipeline
// (`gradeCallQaTranscript`) with the pinned grader model, and asserts the semantic
// outcomes the contract requires.
//
// v9 COVERAGE (cases 21-22) reproduces the pilot defect this contract exists to
// prevent: a caller asks to schedule a Growth ultrasound that has NO order on
// file. The navigator-visible chart is built through the REAL
// `buildTrustedGradingScenario` so the live model receives exactly the chart block
// production sends — including explicit "None on file" negatives. Case 21 asserts
// the correct no-booking handling is credited (sched-recap NA, listen-gather not
// failed for a chart fact); case 22 asserts a WRONG booking is caught by
// sched-flow/know-rule and still leaves sched-recap NA, so it is never
// double-penalized. `hiddenChartState` is deliberately absent — the grader must
// never receive facts the navigator could not see.
//
// GUARANTEES (see docs/CALL_QA_CALIBRATION.md · "Live model-contract smoke"):
//   * synthetic transcripts only — nothing is derived from the private bank;
//   * NO Firestore read or write (SOP context is a static local string, injected);
//   * the same pinned scored grader model (`callQaGraderModel`), key rotation only;
//   * it prints criterion verdicts and case labels only — NEVER a full DOB or an
//     unnecessary identifier value;
//   * it is NOT calibration evidence and has NO readiness/automation authority;
//   * it exits NONZERO when the model response is malformed or a required
//     semantic outcome is wrong; it exits 0 only when every case is satisfied.
//     Missing dedicated credentials are NOT_RUN/nonzero; `--allow-skip` is an
//     explicit local convenience whose SKIPPED marker cannot satisfy the gate.
// ─────────────────────────────────────────────────────────────────────────────

import {
  gradeCallQaTranscript, callQaGraderModel, CALL_QA_PROMPT_VERSION,
  buildTrustedGradingScenario,
} from '../../api/grade-call-qa.js';

const STATIC_SOP = [
  'SYNTHETIC NON-PRODUCTION SOP CONTEXT (contract smoke only).',
  'OB/GYN verification requires the patient first name, last name, and date of birth.',
  'A phone number or address never substitutes for the date of birth.',
  'An imaging study is scheduled only when a matching order is on file.',
  'When no order is on file, send a message to the OB clinical team to clarify instead of booking.',
  'Close by offering further assistance before ending the call.',
].join('\n');

const nav = (text) => ({ role: 'navigator', text });
const caller = (text) => ({ role: 'patient', text });

function scenarioContext(department, gradingScenario) {
  return {
    verified: true,
    status: 'verified',
    qaScenarioId: 'synthetic-live-contract-smoke',
    department,
    scenarioVersion: 'synthetic-live-contract-v1',
    gradingScenario: gradingScenario
      ?? 'SYNTHETIC contract-smoke call. Judge only what the transcript states.',
    ruleIds: [],
  };
}

// ── v9 synthetic navigator-visible chart (no Firestore, no private bank) ──────
//
// Authored here in the script; nothing is read from or derived from the private
// scenario bank. `activeOrders` / `futureAppointments` are EXPLICITLY EMPTY — the
// author asserting "nothing on file", which the navigator sees on screen as
// "None on file" and which the correct workflow turns on. `openEncounters` is
// deliberately OMITTED to exercise the missing-vs-empty distinction: the grader
// must say nothing about a section that was never supplied.
const SYNTHETIC_NAV_CHART = Object.freeze({
  summary: 'Established OB patient, third trimester, routine prenatal care.',
  planRto: 'RTO 4 weeks (routine prenatal follow-up).',
  activeOrders: [],
  futureAppointments: [],
});

// Built through the REAL grader-context builder so the live model receives the
// production NAVIGATOR-VISIBLE CHART block. No hiddenChartState is supplied.
const GROWTH_ULTRASOUND_SCENARIO = buildTrustedGradingScenario({
  gradingContext: 'SYNTHETIC contract-smoke call. The caller asks to schedule a Growth ultrasound because her provider mentioned one. Judge chart-dependent decisions ONLY against the navigator-visible chart.',
  title: 'Caller requests a Growth ultrasound',
  workflowType: 'imaging_request_without_order',
  difficulty: 'medium',
  expectedActions: [
    'Verify the patient first name, last name, and date of birth before discussing the chart.',
    'Explain that no ultrasound order is on file.',
    'Do NOT book the Growth ultrasound without an order.',
    'Send a message to the OB clinical team to clarify the order.',
    'Offer further assistance before closing.',
  ],
  criticalMisses: [
    'Booking a Growth ultrasound when no order is on file.',
    'Telling the caller the ultrasound is scheduled.',
  ],
  scoringNotes: [],
  navigatorChartState: SYNTHETIC_NAV_CHART,
});

const GROWTH_GREET = nav('Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?');
const GROWTH_ASK = caller('Hi, my provider told me I need a Growth ultrasound and I would like to schedule it.');
const GROWTH_VERIFY = [
  nav('I can help with that. May I have the patient first name, last name, and date of birth?'),
  caller('Maria Alvarez, March 2nd 1991.'),
];

const CLOSE_OFFER = nav('Is there anything else I can help you with today?');
const CLOSE_THANKS = nav('Thank you, have a great day. Goodbye.');
const GREET = nav('Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?');
// A confirmation that DISCLOSES an existing appointment (a protected detail).
const DISCLOSE_APPT = nav('I can see your appointment is Tuesday at 2:15 with Dr. Reyes.');

// Each case asserts the COMPLETE semantic state relevant to it — criterion
// verdicts AND, where the case is about privacy, the auto-fail / review state.
// The assertions reference ids, verdicts, and flags only — never identifier
// values, so a printed failure message can never leak PHI.
const verdictOf = (qa, id) => qa.criteria?.find((c) => c.id === id)?.verdict;
const verifiedAutoFail = (qa, id) => (qa.autoFails ?? []).some((a) => a.id === id);
const unverifiedAutoFail = (qa, id) => (qa.unverifiedAutoFails ?? []).some((a) => a.id === id);
const reviewFlag = (qa, id) => (qa.review?.reviewFlags ?? []).some((f) => f.id === id);
const recommendationOf = (qa) => qa.review?.recommendation;
const safetyRiskOf = (qa) => qa.review?.safetyRisk;

// A pre-verification disclosure must produce a PRIVACY-SPECIFIC result — never a
// generic fail caused by an unrelated criterion (correction pass #6, B8): either
// a correctly verified af-hipaa (with a non-pass recommendation) OR a
// deterministic privacy-conflict that is a mandatory CRITICAL review. Never a
// clean pass.
const privacyGated = (qa) =>
  (verifiedAutoFail(qa, 'af-hipaa') && recommendationOf(qa) !== 'pass')
  || (reviewFlag(qa, 'deterministic-privacy-conflict') && recommendationOf(qa) === 'needs_review' && safetyRiskOf(qa) === 'critical');

// Return the first failing rule's message, or true when every rule holds.
function checkAll(...rules) {
  for (const [ok, message] of rules) if (!ok) return message;
  return true;
}

export const LIVE_CONTRACT_SMOKE_CASES = [
  {
    id: '1-volunteered-one-turn',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991. I would like to book my annual GYN visit.'),
      nav('Thank you, I can help you schedule that annual visit with Dr. Reyes on Tuesday at 2:15.'),
      CLOSE_OFFER,
      caller('No, that is everything, thank you.'),
    ],
    check: (qa) => checkAll(
      [verdictOf(qa, 'verify-three') === 'MET', 'verify-three should be MET when the caller volunteers name + DOB in one turn'],
      [verdictOf(qa, 'verify-before-access') === 'MET', 'verify-before-access should be MET when identity precedes any disclosure'],
      [!verifiedAutoFail(qa, 'af-hipaa'), 'no verified af-hipaa on a verified call'],
      [!unverifiedAutoFail(qa, 'af-hipaa'), 'no af-hipaa should be reported on a verified call with no protected disclosure'],
    ),
  },
  {
    id: '2-separate-one-word-answers',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('I would like to schedule an appointment.'),
      nav('Sure. May I have the patient first name?'),
      caller('Maria.'),
      nav('And the last name?'),
      caller('Alvarez.'),
      nav('And the date of birth?'),
      caller('March 2nd 1991.'),
      nav('Thank you. I can book that for you.'),
      CLOSE_OFFER,
    ],
    check: (qa) => checkAll(
      [verdictOf(qa, 'verify-three') === 'MET', 'verify-three should be MET across separate one-word answers'],
      [verdictOf(qa, 'verify-before-access') === 'MET', 'verify-before-access should be MET when identity precedes any disclosure'],
      [!verifiedAutoFail(qa, 'af-hipaa'), 'no verified af-hipaa on a verified call'],
    ),
  },
  {
    id: '3-third-party-patient',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('I am calling for my daughter, Maria Alvarez. Her date of birth is March 2nd 2021.'),
      nav('Thank you, I can help with that.'),
      CLOSE_OFFER,
    ],
    check: (qa) => checkAll(
      [verdictOf(qa, 'verify-three') === 'MET', 'verify-three should be MET for an authorized third-party caller'],
      [!verifiedAutoFail(qa, 'af-hipaa'), 'no verified af-hipaa on a verified third-party call'],
    ),
  },
  {
    id: '4-callers-own-dob-different-patient',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('My name is Sarah Jones, date of birth March 2nd 1991, but the appointment is for Maria Alvarez.'),
      nav('Okay, thank you.'),
      CLOSE_OFFER,
    ],
    check: (qa) => verdictOf(qa, 'verify-three') !== 'MET' || 'verify-three must NOT verify when the DOB belongs to a different person than the patient name',
  },
  {
    id: '5-names-from-two-patients',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('I am calling for Maria Smith and my daughter Jane Alvarez.'),
      nav('And a date of birth?'),
      caller('March 2nd 1991.'),
      CLOSE_OFFER,
    ],
    check: (qa) => verdictOf(qa, 'verify-three') !== 'MET' || 'verify-three must NOT verify when first/last names come from two different patients',
  },
  {
    id: '6-missing-dob',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('Hi, this is Maria Alvarez. I would like to book my annual.'),
      nav('Sure, I can help with that.'),
      CLOSE_OFFER,
    ],
    check: (qa) => verdictOf(qa, 'verify-three') !== 'MET' || 'verify-three must NOT verify without a date of birth',
  },
  {
    id: '7-provider-name-near-patient',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('I need to reach Dr. Reyes about my results. My date of birth is March 2nd 1991.'),
      nav('I understand, let me help.'),
      CLOSE_OFFER,
    ],
    check: (qa) => verdictOf(qa, 'verify-three') !== 'MET' || 'verify-three must NOT verify a provider name as the patient identity',
  },
  {
    id: '8-explicit-help-close',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991, I would like my annual visit.'),
      nav('I can book you with Dr. Reyes on Tuesday at 2:15 at Main Street. Please arrive fifteen minutes early.'),
      CLOSE_OFFER,
      caller('No, that is all, thank you.'),
    ],
    check: (qa) => verdictOf(qa, 'close-offer-help') === 'MET' || 'close-offer-help should be MET with an explicit offer of further assistance',
  },
  {
    id: '9-thanks-only-close',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991, I would like my annual visit.'),
      nav('I can book you with Dr. Reyes on Tuesday at 2:15 at Main Street.'),
      CLOSE_THANKS,
    ],
    check: (qa) => verdictOf(qa, 'close-offer-help') === 'NOT_MET' || 'close-offer-help must FAIL when the navigator only says thanks/goodbye',
  },
  {
    id: '10-routine-empathy-na',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991. I just need to schedule my routine annual GYN visit.'),
      nav('Of course. I can book you with Dr. Reyes on Tuesday at 2:15 at Main Street.'),
      caller('Great.'),
      CLOSE_OFFER,
    ],
    check: (qa) => (verdictOf(qa, 'comm-empathy') === 'NA' && verdictOf(qa, 'control-narrate') === 'NA')
      || 'a routine call with no emotional cue and no hold should leave comm-empathy and control-narrate NA',
  },

  // ── HIPAA / chronology cases (correction pass #6, B8) ───────────────────────
  // Each early-disclosure case asserts a PRIVACY-SPECIFIC result (a verified
  // af-hipaa or a mandatory critical privacy-conflict review) — never a generic
  // fail from an unrelated criterion — and each clean case asserts NO af-hipaa
  // and NO privacy conflict.
  {
    id: '11-identity-before-repeated-after',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991. Can you check my appointment?'),
      DISCLOSE_APPT,
      caller('Thanks. Just to confirm, this is Maria Alvarez, date of birth March 2nd 1991.'),
      CLOSE_OFFER,
    ],
    check: (qa) => checkAll(
      [verdictOf(qa, 'verify-before-access') === 'MET', 'identity was completed BEFORE the disclosure, so verify-before-access should be MET'],
      [!verifiedAutoFail(qa, 'af-hipaa'), 'a call verified before the disclosure must never be zeroed'],
    ),
  },
  {
    id: '12-safe-refusal-not-a-disclosure',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('Can you tell me my appointment time?'),
      nav('I cannot confirm whether your appointment is Tuesday until I verify you.'),
      caller('Sure, this is Maria Alvarez, date of birth March 2nd 1991.'),
      nav('Thank you. Your appointment is Tuesday at 2:15.'),
      CLOSE_OFFER,
    ],
    check: (qa) => checkAll(
      [!verifiedAutoFail(qa, 'af-hipaa'), 'a privacy-preserving refusal is not a disclosure and must not zero the call'],
      [!unverifiedAutoFail(qa, 'af-hipaa'), 'no af-hipaa should be reported for a refusal followed by verification'],
      [!reviewFlag(qa, 'deterministic-privacy-conflict'), 'no privacy conflict when the only pre-verification line is a refusal'],
    ),
  },
  {
    id: '13-safe-line-then-genuine-disclosure',
    department: 'obgyn',
    transcript: [
      GREET,
      nav('I cannot confirm anything yet, but your appointment is Tuesday at 2:15.'),
      caller('Oh — this is Maria Alvarez, date of birth March 2nd 1991.'),
      CLOSE_OFFER,
    ],
    // The second clause genuinely discloses the appointment BEFORE identity.
    check: (qa) => privacyGated(qa)
      || 'a genuine disclosure before identity must be a verified af-hipaa or a mandatory critical privacy review',
  },
  {
    id: '14-full-identity-before-disclosure-clean',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991. Can you check my appointment?'),
      DISCLOSE_APPT,
      CLOSE_OFFER,
      caller('No, that is everything, thank you.'),
    ],
    check: (qa) => checkAll(
      [verdictOf(qa, 'verify-three') === 'MET', 'verify-three should be MET before the disclosure'],
      [verdictOf(qa, 'verify-before-access') === 'MET', 'verify-before-access should be MET — identity completed before the disclosure'],
      [!verifiedAutoFail(qa, 'af-hipaa'), 'no verified af-hipaa on a clean verified-before-access call'],
      [!reviewFlag(qa, 'deterministic-privacy-conflict'), 'no deterministic privacy conflict on a clean call'],
    ),
  },
  {
    id: '15-partial-identity-before-disclosure',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('Hi, this is Maria Alvarez.'),
      DISCLOSE_APPT,
      CLOSE_OFFER,
    ],
    check: (qa) => checkAll(
      [verdictOf(qa, 'verify-three') === 'NOT_MET', 'verify-three must NOT verify with only a partial identity'],
      [privacyGated(qa), 'a partial identity followed by a protected disclosure must be a verified af-hipaa or a critical privacy review'],
    ),
  },
  {
    id: '16-no-identity-before-disclosure',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('Can you look up my appointment?'),
      DISCLOSE_APPT,
      CLOSE_OFFER,
    ],
    check: (qa) => privacyGated(qa)
      || 'a disclosure with no prior identity must be a verified af-hipaa or a mandatory critical privacy review',
  },
  {
    id: '17-model-false-positive-after-verification',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991. Can you look up my appointment?'),
      DISCLOSE_APPT,
      nav('You are all set.'),
      CLOSE_OFFER,
    ],
    // The server must never zero a verified-before-access call; a correct model
    // must also NOT trigger af-hipaa on a post-verification disclosure.
    check: (qa) => checkAll(
      [!verifiedAutoFail(qa, 'af-hipaa'), 'the server must never zero a call that verified before disclosing'],
      [!unverifiedAutoFail(qa, 'af-hipaa'), 'a correct model must NOT trigger af-hipaa on a post-verification disclosure'],
    ),
  },
  {
    id: '18-model-false-negative-before-verification',
    department: 'obgyn',
    transcript: [
      GREET,
      DISCLOSE_APPT,
      caller('Oh thanks, this is Maria Alvarez, date of birth March 2nd 1991.'),
      CLOSE_OFFER,
    ],
    // Whether or not the model flags it, the server must gate this on privacy.
    check: (qa) => privacyGated(qa)
      || 'a pre-verification disclosure must be a verified af-hipaa or a mandatory critical privacy review even if the model omits it',
  },
  {
    id: '19-provider-name-ambiguity',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('I would like to schedule an appointment.'),
      nav('Sure. What is the last name of your OB-GYN?'),
      caller('Reyes.'),
      nav('And your date of birth?'),
      caller('March 2nd 1991.'),
      CLOSE_OFFER,
    ],
    // A provider surname is not the patient's name, so identity is incomplete.
    check: (qa) => verdictOf(qa, 'verify-three') !== 'MET'
      || 'a provider surname must never complete patient identity',
  },
  {
    id: '20-third-party-dob-ownership',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('I am calling for my daughter, Maria Alvarez. Her date of birth is March 2nd 2021.'),
      nav('Thank you, I can help with that.'),
      CLOSE_OFFER,
    ],
    check: (qa) => checkAll(
      [verdictOf(qa, 'verify-three') === 'MET', 'an authorized third-party caller who supplies the patient name + DOB should verify'],
      [!verifiedAutoFail(qa, 'af-hipaa'), 'no af-hipaa on a verified third-party call'],
    ),
  },

  // ── v9 navigator-visible chart + applicability cases (2026-07-24) ───────────
  // These reproduce the FIRST real pilot defect: the correct workflow books
  // nothing, so the navigator must not be penalized under sched-recap (an
  // appointment that should not exist cannot be recapped) nor under listen-gather
  // (an internal chart fact is not caller-observable information gathering).
  // Both cases share ONE navigator-visible chart with explicit "None on file"
  // negatives; neither supplies hidden chart state.
  {
    id: '21-no-order-correct-no-booking',
    department: 'obgyn',
    gradingScenario: GROWTH_ULTRASOUND_SCENARIO,
    transcript: [
      GROWTH_GREET,
      GROWTH_ASK,
      ...GROWTH_VERIFY,
      nav('Thank you Maria. Let me take a look at your chart.'),
      nav('I do not see an ultrasound order on file for you, and there is no upcoming ultrasound appointment scheduled. I am not able to book the scan without an order from your provider.'),
      caller('Oh — but she told me I needed one.'),
      nav('I understand. I am sending a message to the OB clinical team now to confirm the order with your provider, and they will follow up with you so we can get it scheduled.'),
      caller('Okay, thank you.'),
      CLOSE_OFFER,
      caller('No, that is everything.'),
    ],
    check: (qa) => checkAll(
      // The core applicability fix: nothing should have been booked, so there is
      // no appointment to recap.
      [verdictOf(qa, 'sched-recap') === 'NA', 'sched-recap must be NA when the correct workflow books no appointment'],
      // The navigator gathered every caller-observable detail; the no-order fact
      // came from the chart, which is never a listen-gather failure.
      [verdictOf(qa, 'listen-gather') !== 'NOT_MET', 'listen-gather must not be failed because the decisive fact came from the chart rather than the caller'],
      // The correct no-booking workflow must be recognized, not punished.
      [verdictOf(qa, 'know-rule') !== 'NOT_MET', 'the correct no-order workflow (explain, do not book, route to the OB team) must not be marked NOT_MET'],
      [verdictOf(qa, 'sched-flow') !== 'NOT_MET', 'declining to book without an order is the CORRECT scheduling outcome and must not be NOT_MET'],
      // Identity was collected before any chart discussion.
      [verdictOf(qa, 'verify-three') === 'MET', 'verify-three should be MET — the navigator collected first name, last name and DOB'],
      [!verifiedAutoFail(qa, 'af-hipaa'), 'no af-hipaa on a call verified before any chart disclosure'],
    ),
  },
  {
    id: '22-no-order-wrong-booking',
    department: 'obgyn',
    gradingScenario: GROWTH_ULTRASOUND_SCENARIO,
    transcript: [
      GROWTH_GREET,
      GROWTH_ASK,
      ...GROWTH_VERIFY,
      nav('Thank you Maria. Let me open your chart and get that scheduled for you.'),
      nav('You are all set — I have booked your Growth ultrasound for Tuesday at 9:00 at Main Street. Please arrive fifteen minutes early.'),
      caller('Perfect, thank you.'),
      CLOSE_OFFER,
      caller('No, that is all.'),
    ],
    check: (qa) => checkAll(
      // The wrong outcome must be caught by the scheduling/knowledge criteria …
      [['sched-flow', 'know-rule'].some((id) => verdictOf(qa, id) === 'NOT_MET'),
        'wrongly booking with no order on file must be captured by sched-flow and/or know-rule'],
      // … and NEVER by a second sched-recap penalty for an appointment that
      // should never have existed. The navigator DID recap it, but the correct
      // workflow booked nothing, so the criterion does not apply.
      [verdictOf(qa, 'sched-recap') === 'NA', 'sched-recap must stay NA — the correct workflow books nothing, so a wrong booking is never double-penalized here'],
    ),
  },
  // ── v10 caller-volunteered facts + criterion isolation (2026-07-27) ────────
  // Both are entirely synthetic. The fact is spoken before the navigator asks
  // any intake question, so a grade may not demand it again merely because the
  // transfer scenario says to establish gestational age.
  {
    id: '23-transfer-volunteered-gestational-age',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('We just moved here, and I am 33 weeks pregnant. I need to transfer my prenatal care as soon as possible.'),
      nav('I can help with the transfer process. May I have your first name, last name, and date of birth?'),
      caller('Maria Alvarez, March 2nd 1991.'),
      nav('Thank you. I will document that you are 33 weeks pregnant and send the transfer request with your records for clinical review. Once the clinical team accepts the transfer, we will contact you to arrange the appointment.'),
      CLOSE_OFFER,
      caller('No, that is everything.'),
    ],
    check: (qa) => checkAll(
      [verdictOf(qa, 'listen-gather') !== 'NOT_MET', 'listen-gather must not fail because gestational age was clearly volunteered before any question repeated it'],
      [verdictOf(qa, 'doc-reason') !== 'NOT_MET', 'doc-reason must not fail merely because gestational age was volunteered rather than re-asked'],
      [verdictOf(qa, 'know-rule') !== 'NOT_MET', 'the transfer workflow must credit clinical review before appointment arrangement'],
    ),
  },
  {
    id: '24-transfer-repetitive-pregnancy-question',
    department: 'obgyn',
    transcript: [
      GREET,
      caller('We just moved here, and I am 33 weeks pregnant. I need to transfer my prenatal care as soon as possible.'),
      nav('I can help with the transfer process. May I have your first name, last name, and date of birth?'),
      caller('Maria Alvarez, March 2nd 1991.'),
      nav('Are you pregnant, or is this a GYN visit?'),
      caller('As I mentioned, I am 33 weeks pregnant and need prenatal care.'),
      nav('I will document the transfer request with your records for clinical review. After acceptance, we will contact you to arrange the appointment.'),
      CLOSE_OFFER,
    ],
    check: (qa) => checkAll(
      // The opening acknowledgement may still satisfy listen-ack; this case
      // observes the repetitive-question boundary without forcing a model to
      // turn one later lapse into an exact whole-criterion verdict.
      [Boolean(verdictOf(qa, 'listen-ack')), 'listen-ack must be evaluated from the call rather than left ungraded'],
      [verdictOf(qa, 'doc-reason') !== 'NOT_MET', 'the repetitive question alone must not be recycled into a documentation failure'],
      [verdictOf(qa, 'know-rule') !== 'NOT_MET', 'the otherwise correct transfer-review workflow must remain independently judged'],
    ),
  },
];

const CASES = LIVE_CONTRACT_SMOKE_CASES;

// Resolve the DEDICATED, non-production smoke credentials. Correction pass #5:
// nullish-coalescing masked the singular key when the plural variable was set
// but EMPTY (an empty string is not nullish). Parse the plural first and use it
// only when it yields at least one usable key; otherwise fall back to the
// singular. Trim, drop empties, and de-duplicate (order-preserving). Values are
// never printed. Generic GEMINI_API_KEY(S) are intentionally never consulted.
export function liveSmokeApiKeys(env = process.env) {
  const parse = (raw) => String(raw ?? '').split(',').map((key) => key.trim()).filter(Boolean);
  const plural = parse(env.CALL_QA_LIVE_SMOKE_API_KEYS);
  const chosen = plural.length > 0 ? plural : parse(env.CALL_QA_LIVE_SMOKE_API_KEY);
  return [...new Set(chosen)];
}

export async function runLiveContractSmoke({
  env = process.env, args = process.argv.slice(2), grade = gradeCallQaTranscript,
  cases = CASES, write = console.log,
} = {}) {
  const keys = liveSmokeApiKeys(env);
  const graderModel = callQaGraderModel(env);

  if (!keys.length) {
    if (args.includes('--allow-skip')) {
      write('LIVE_CONTRACT_SMOKE_SKIPPED - no dedicated smoke key configured.');
      return 0;
    }
    write('LIVE_CONTRACT_SMOKE_NOT_RUN - set CALL_QA_LIVE_SMOKE_API_KEY or CALL_QA_LIVE_SMOKE_API_KEYS.');
    return 2;
  }

  write(`Running live Call QA contract smoke against pinned grader model: ${graderModel}`);
  write(`${cases.length} synthetic cases. No Firestore access or private bank.`);

  const results = [];
  for (const testCase of cases) {
    let outcome;
    try {
      const { qa } = await grade({
        transcript: testCase.transcript,
        scenarioContext: scenarioContext(testCase.department, testCase.gradingScenario),
        captureMetadata: { captureComplete: true },
        transcriptMetadata: { captureStatus: 'captured' },
      }, {
        keys,
        graderModel,
        sopContextForFresh: async () => STATIC_SOP,
      });
      const verdict = testCase.check(qa);
      outcome = verdict === true
        ? { id: testCase.id, status: 'PASS' }
        : { id: testCase.id, status: 'FAIL', detail: String(verdict) };
    } catch (err) {
      // A thrown GradingServiceError here means the model produced a malformed /
      // unusable response even after the retry — exactly what this gate exists to
      // catch. The message never contains identifier values.
      const contract = err?.contractFailureKind ? `; contract=${err.contractFailureKind}` : '';
      outcome = { id: testCase.id, status: 'FAIL', detail: `unusable grader response: ${err?.error ?? err?.message ?? err}${contract}` };
    }
    results.push(outcome);
    write(`  [${outcome.status}] ${outcome.id}${outcome.detail ? ` - ${outcome.detail}` : ''}`);
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  if (failed.length > 0) {
    write(`LIVE_CONTRACT_SMOKE_FAILED - ${failed.length}/${results.length} case(s) did not satisfy the ${CALL_QA_PROMPT_VERSION} contract.`);
    return 1;
  }
  write(`LIVE_CONTRACT_SMOKE_VERIFIED - ${results.length}/${results.length} cases satisfied the ${CALL_QA_PROMPT_VERSION} contract.`);
  write('This is NON-PRODUCTION and carries NO calibration or automation authority.');
  return 0;
}

export async function main() {
  process.exitCode = await runLiveContractSmoke();
}

// Run only when invoked directly (never on import, so tests can inspect the
// cases without triggering a live run or process.exit).
const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (invokedDirectly || process.argv[1]?.endsWith('live-contract-smoke.mjs')) {
  main().catch((err) => {
    console.error('LIVE_CONTRACT_SMOKE_FAILED -', err?.message ?? err);
    process.exitCode = 1;
  });
}
