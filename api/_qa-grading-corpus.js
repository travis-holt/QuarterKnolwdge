// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Call QA grading-pipeline regression corpus.
//
// Each case is a full call transcript with an authored expected outcome (`truth`) plus
// one or more simulated grader profiles:
//   accurate   — verdicts a careful grader would return for this call
//   literalist — the false-negative-prone grader this repair layer guards
//                against (fails natural wording, demands literal PE/TE phrases)
//   lenient    — the false-POSITIVE-prone (routing-blind) grader: marks
//                criteria MET with real verifiable quotes even when the call
//                mis-routes, hedges, over-promises, or never routes at all.
//                The deterministic conflict layer must catch what it misses.
//
// The harness (_qa-grading-corpus.test.js) runs every case × profile through
// the REAL deterministic pipeline (glossary correction → validation → repairs →
// trust-gated scoring → review assessment) and measures FALSE PASSES and FALSE
// FAILS against those expectations. The corpus is the regression net for the entire
// evidence model: any change to the rubric, repair gates, or review layer must
// keep this corpus at zero false passes and zero false fails.
//
// truth values:
//   'pass'   — a competent call; the pipeline must not confidently fail it.
//   'fail'   — a deficient/unsafe call; the pipeline must not confidently pass it.
//   'review' — genuinely a supervisor's judgment call; the pipeline must land
//              on needs_review, not a confident verdict.
//
// The leading `_` keeps Express from ever treating this module as a route.
// ─────────────────────────────────────────────────────────────────────────────

import { rubricCriteria } from '../src/data/qaRubric.js';
import { QA_RUBRIC_PROFILES, requireQaRubricProfile } from '../src/data/qaRubricProfiles.js';

export const nav = (text) => ({ role: 'navigator', text });
export const pat = (text) => ({ role: 'patient', text });

// ── Reusable call blocks ─────────────────────────────────────────────────────

const OPENING = [
  nav('Good morning, thank you for calling Aizer Health, this is Dana. How can I help you today?'),
];

const VERIFY = [
  nav("I can help with that. Before I open anything, can I get the patient's first name, last name, and date of birth?"),
  pat('Mia Torres, June 4th 2019.'),
  nav('Thank you. Let me pull up the chart — one moment while I open it.'),
];

const CLOSE_FULL = [
  nav('Is there anything else I can help you with today? Please stay on the line for a short survey after the call. Thank you for calling Aizer Health!'),
  pat('No, that is everything. Thanks so much.'),
  nav('You are very welcome. Take care!'),
];

const CLOSE_NO_SURVEY = [
  nav('Is there anything else I can help you with today?'),
  pat('No, thank you so much!'),
  nav('You are very welcome — take care!'),
];

const REFILL_GATHER = [
  pat('Hi, my daughter is out of her allergy medicine and we need a refill sent to the pharmacy.'),
  ...VERIFY,
  nav('I understand — being completely out is stressful, so let us get this moving. What medication does she need refilled?'),
  pat('Zyrtec, the liquid one. She is completely out as of today.'),
  nav('Got it. Which pharmacy do you prefer?'),
  pat('The CVS on Main Street.'),
  nav('And what is the best phone number to reach you if the team has questions?'),
  pat('Same number I am calling from.'),
];

const REFILL_SCENARIO = 'A parent is calling for a standard pediatric medication refill. The navigator must gather medication name, preferred pharmacy, callback details, and whether the patient is out, route the request correctly, and avoid promising approval or giving dosing advice.';
const REFILL_METADATA = { qaScenarioId: 'qa-peds-refill-001', workflowType: 'prescription_refill', difficulty: 'medium' };

// ── Simulated grader output ──────────────────────────────────────────────────

/**
 * Build a full raw "model response" for validateQaResponse: every rubric
 * criterion gets MET with a real (verifiable) quote unless overridden.
 * @param {{role,text}[]} transcript
 * @param {{ notMet?: Record<string, string|{note:string, evidence?:string}>,
 *           na?: string[],
 *           metEvidence?: Record<string,string>,
 *           autoFails?: {id:string, evidence:string, note?:string}[] }} profile
 */
export function simulateGrader(transcript, profile = {}, rubricProfile = QA_RUBRIC_PROFILES.pediatrics) {
  const { notMet = {}, na = [], metEvidence = {}, autoFails = [] } = profile;
  const navLines = transcript.filter((t) => t.role === 'navigator').map((t) => t.text);
  const defaultQuote = navLines.reduce((a, b) => (b.length > a.length ? b : a), navLines[0] ?? '');
  // Simulate against the DEPARTMENT rubric the case belongs to, so a corpus run
  // exercises exactly the criterion set the real pipeline would validate.
  const criteria = rubricProfile.criteria.map((c) => {
    if (na.includes(c.id)) return { id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: 'Not applicable to this scenario.' };
    if (c.id in notMet) {
      const entry = notMet[c.id];
      const note = typeof entry === 'string' ? entry : entry.note;
      const evidence = typeof entry === 'string' ? '' : (entry.evidence ?? '');
      // A quoted offending line is an OBSERVED (EVIDENCE) miss; a note-only miss
      // is an ABSENCE. This mirrors how a real grader must report each shape.
      const basis = evidence ? 'EVIDENCE' : 'ABSENCE';
      return { id: c.id, verdict: 'NOT_MET', basis, evidence, note };
    }
    return { id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: metEvidence[c.id] ?? defaultQuote, note: '' };
  });
  return { criteria, autoFails: autoFails.map((a) => ({ triggered: true, note: '', ...a })) };
}

// Literalist grader notes — the exact style of false negative seen in pilots.
const LITERAL_PE_NOTE = 'The navigator failed to verify that the patient PE status is up to date before submitting the refill.';
const LITERAL_TE_NOTE = 'The transcript does not contain evidence that the navigator routed or logged a Telephone Encounter to the PEDS Encounters queue.';
const NO_SURVEY_NOTE = 'The navigator did not prompt the caller to stay on the line for the survey.';

// ── The corpus ───────────────────────────────────────────────────────────────

export const QA_GRADING_CORPUS = [
  // ═══ GOOD CALLS ═══════════════════════════════════════════════════════════
  {
    id: 'good-refill-natural',
    category: 'good',
    truth: 'pass',
    description: 'Complete standard refill handled with natural wording, no PE check (correct), safe non-promise. The literalist grader fails PE + literal TE wording; repairs must restore the pass but flag the flipped outcome for review.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("I'll send this request over to the PEDS Encounters queue right now and mark it high priority since she is completely out. The PEDS Encounters team will call you back once it is reviewed. I can't promise exact timing though."),
      pat('That works, thank you.'),
      ...CLOSE_NO_SURVEY,
    ],
    graders: {
      accurate: { notMet: { 'close-survey': NO_SURVEY_NOTE }, na: ['sched-flow', 'sched-recap'] },
      literalist: {
        notMet: { 'know-rule': LITERAL_PE_NOTE, 'doc-te': LITERAL_TE_NOTE, 'close-survey': NO_SURVEY_NOTE },
        na: ['sched-flow', 'sched-recap'],
      },
    },
    expect: {
      accurate: { pass: true, recommendation: 'pass', repairRules: [] },
      literalist: {
        pass: true,
        recommendation: 'needs_review', // the repair flipped fail→pass; a supervisor confirms
        repairRules: ['standard-refill-no-pe-requirement', 'natural-message-routing-wording'],
        flags: ['repair-changed-outcome'],
      },
    },
    // Paraphrase variants: the same competent call with different natural
    // routing wording must grade identically (incl. the committed-follow-up
    // phrasing "The PEDS Encounters team will follow up ...").
    variants: [
      { id: 'route-queue', replaceLineContaining: "I'll send this request over", with: "I'm going to route this over to the PEDS Encounters queue right now and mark it high priority since she is completely out. I can't promise exact timing though." },
      { id: 'put-in-message', replaceLineContaining: "I'll send this request over", with: "Let me put in a message for the PEDS Encounters queue about this refill and mark it high priority since she is completely out. I can't promise exact timing though." },
      { id: 'team-follow-up', replaceLineContaining: "I'll send this request over", with: 'The PEDS Encounters team will follow up with you once it is reviewed — I have everything marked high priority since she is completely out.' },
    ],
  },
  {
    id: 'good-scheduling-full',
    category: 'good',
    truth: 'pass',
    description: 'Textbook new-appointment call. Literalist grader demands a TE that was never needed; no repair applies (non-message workflow) but the call still passes on points.',
    department: 'pediatrics',
    scenario: 'A parent is scheduling a new pediatric appointment for a child who has not been seen before.',
    metadata: { qaScenarioId: 'qa-peds-scheduling-001', workflowType: 'new_appointment_scheduling', difficulty: 'medium' },
    transcript: [
      ...OPENING,
      pat('Hi, I need to make an appointment for my son. He has not been seen there before.'),
      ...VERIFY,
      nav('I understand you want him seen soon. Is this for a checkup or is he sick today?'),
      pat('Just a checkup to get him established.'),
      nav("I'm pulling up the schedule now — this will take just a moment."),
      nav('I have Tuesday at 9 AM with Dr. Frommer at 48 Bakertown Rd for a new patient visit. Does that work?'),
      pat('Yes, perfect.'),
      nav('You are all set for Tuesday at 9 AM at 48 Bakertown Rd. Please arrive fifteen minutes early with his insurance card. The visit reason is down as a new patient checkup.'),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: { na: ['doc-te'] },
      literalist: { notMet: { 'doc-te': 'No Telephone Encounter was logged for this call.' } },
    },
    expect: {
      accurate: { pass: true, recommendation: 'pass', repairRules: [] },
      // doc-te is safety-tagged, so a pass over that miss is review-flagged —
      // never a confident false fail, never a silent overruled grader.
      literalist: { pass: true, recommendation: 'needs_review', repairRules: [] },
    },
  },
  {
    id: 'good-urgent-escalation',
    category: 'good',
    truth: 'review',
    description: 'Urgent symptoms: navigator defers clinical judgment (scope discipline), escalates to the clinical team, gives permitted emergency guidance. Deferral language must not read as clinical advice.',
    department: 'pediatrics',
    scenario: 'A parent describes potentially urgent symptoms and asks the navigator to judge what to do medically. The navigator must stay inside scope, escalate per the urgent symptom policy, and document what was reported.',
    metadata: { qaScenarioId: 'qa-peds-urgent-boundary-001', workflowType: 'urgent_symptom_boundary', difficulty: 'hard' },
    transcript: [
      ...OPENING,
      pat('My child has a fever and is breathing funny. Do you think I should wait for an appointment?'),
      ...VERIFY,
      nav("I hear you — that sounds scary, and I want to get you help right away. I can't tell you whether it's safe to wait; that's a question for the nurse."),
      nav("I'm going to send this to the clinical team as urgent right now with everything you've described, and the nurse will call you back shortly."),
      nav('If her breathing gets worse before then, please call 911 or go to the emergency room immediately.'),
      pat('Okay, I will. Thank you.'),
      ...CLOSE_NO_SURVEY,
    ],
    graders: {
      accurate: { notMet: { 'close-survey': NO_SURVEY_NOTE }, na: ['doc-reason', 'sched-flow', 'sched-recap'] },
      literalist: {
        notMet: { 'close-survey': NO_SURVEY_NOTE, 'doc-te': 'The navigator did not say a Telephone Encounter was created for the escalation.' },
        na: ['doc-reason', 'sched-flow', 'sched-recap'],
      },
    },
    expect: {
      accurate: { pass: true, recommendation: 'needs_review', repairRules: [] },
      literalist: { pass: true, recommendation: 'needs_review', repairRules: [] },
    },
  },
  {
    id: 'good-sibling-call',
    category: 'good',
    truth: 'pass',
    description: 'Parent calling about two siblings; navigator keeps each child separate, books the sick visit, routes the refill.',
    department: 'pediatrics',
    scenario: 'A parent is calling about two children in the same family. One child needs a sick visit and the other needs a standard medication refill. The navigator must keep each request in the correct child chart.',
    metadata: { qaScenarioId: 'qa-peds-siblings-001', workflowType: 'multiple_siblings_family_lookup', difficulty: 'hard' },
    transcript: [
      ...OPENING,
      pat('I need help with both of my kids. One needs a sick visit and the other needs a refill.'),
      nav("Absolutely, we'll handle both — one at a time so nothing gets mixed up. Can I get the first child's first name, last name, and date of birth?"),
      pat('Leo Alvarez, March 2nd 2020. He is the sick one.'),
      nav("Thank you. I'm pulling up Leo's chart now. What symptoms is he having?"),
      pat('Fever and a cough since yesterday.'),
      nav('I understand — I have a sick visit today at 3 PM with Dr. Khaimov at 48 Bakertown Rd. The visit reason is down as fever and cough. Does that work?'),
      pat('Yes. And my daughter Ana Alvarez, July 9th 2017, needs her asthma medication refilled.'),
      nav("Thank you — I'm switching to Ana's chart now so her request stays separate. What medication is the refill for, and which pharmacy do you use?"),
      pat('The inhaler, and the CVS on Main Street. She still has a little left.'),
      nav("Got it. For Ana I'll send the refill request to the PEDS Encounters queue now, and that team will get back to you. Leo is booked today at 3 PM at 48 Bakertown Rd — please arrive fifteen minutes early."),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: {},
    },
    expect: {
      accurate: { pass: true, recommendation: 'pass', repairRules: [] },
    },
  },

  // ═══ BORDERLINE ═══════════════════════════════════════════════════════════
  {
    id: 'borderline-small-misses',
    category: 'borderline',
    truth: 'review',
    description: 'Several small quality misses land the score inside the review band; supervisor judgment, not a confident verdict.',
    department: 'pediatrics',
    scenario: 'A parent is scheduling a new pediatric appointment for a child who has not been seen before.',
    metadata: { qaScenarioId: 'qa-peds-scheduling-001', workflowType: 'new_appointment_scheduling', difficulty: 'medium' },
    transcript: [
      ...OPENING,
      pat('I need an appointment for my son.'),
      ...VERIFY,
      nav('Is this for a checkup or is he sick?'),
      pat('A checkup.'),
      nav('I have Tuesday at 9 AM with Dr. Frommer at 48 Bakertown Rd for a new patient visit. You are all set — please arrive fifteen minutes early. The reason is down as a new patient checkup.'),
      ...CLOSE_NO_SURVEY,
    ],
    graders: {
      accurate: {
        notMet: {
          'control-narrate': 'Never narrated system actions or explained waits.',
          'comm-empathy': 'Flat, transactional tone throughout; no warmth when the caller sounded unsure.',
          'close-survey': NO_SURVEY_NOTE,
        },
        na: ['doc-te'],
      },
    },
    expect: {
      accurate: { pass: true, recommendation: 'needs_review', repairRules: [], flags: ['borderline-score'] },
    },
  },
  {
    id: 'borderline-safety-miss-high-score',
    category: 'borderline',
    truth: 'review',
    description: 'High score but verification order was violated (appointment detail confirmed before full verification, no PHI disclosed). A pass over a safety-tagged miss is never unreviewed.',
    department: 'pediatrics',
    scenario: 'A parent is calling to confirm an existing pediatric appointment.',
    metadata: { qaScenarioId: 'qa-peds-scheduling-001', workflowType: 'new_appointment_scheduling', difficulty: 'medium' },
    transcript: [
      ...OPENING,
      pat('Hi, I just want to confirm my daughter has an appointment Thursday.'),
      nav('Let me check — yes, I do see an appointment on Thursday. Actually, before I go further, can I get her first name, last name, and date of birth?'),
      pat('Mia Torres, June 4th 2019.'),
      nav('Thank you. Confirmed: Thursday at 10 AM with Dr. Polinger at 48 Bakertown Rd. Please arrive fifteen minutes early. The visit reason is her follow-up.'),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: {
        notMet: { 'verify-before-access': { note: 'Confirmed an appointment existed before completing full verification.', evidence: 'yes, I do see an appointment on Thursday' } },
        na: ['doc-te'],
      },
    },
    expect: {
      accurate: { pass: true, recommendation: 'needs_review', repairRules: [], flags: ['safety-criterion-missed'] },
    },
  },

  // ═══ UNSAFE CALLS ═════════════════════════════════════════════════════════
  {
    id: 'unsafe-clinical-advice',
    category: 'unsafe',
    truth: 'fail',
    description: 'Dosing advice on a refill call. Auto-fail must stand, score zeroes, and the clinical-advice signal must block every repair even though a committed routing line exists.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("Honestly, you can give her a double dose of what's left tonight — it's perfectly safe for kids her age."),
      nav("I'll also send the refill request to the PEDS Encounters queue now."),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: {
        notMet: {
          'know-rule': 'Gave medication dosing advice instead of leaving clinical questions to nursing.',
          'doc-te': LITERAL_TE_NOTE,
        },
        na: ['sched-flow', 'sched-recap'],
        autoFails: [{ id: 'af-scope', evidence: "you can give her a double dose of what's left tonight" }],
      },
    },
    expect: {
      accurate: { pass: false, recommendation: 'fail', repairRules: [], autoFailed: true, score: 0 },
    },
  },
  {
    id: 'unsafe-hipaa-no-verification',
    category: 'unsafe',
    truth: 'fail',
    description: 'Chart details disclosed with zero verification — verified auto-fail zeroes the test.',
    department: 'pediatrics',
    scenario: 'A caller asks about their child\'s upcoming appointment and recent visit.',
    metadata: { qaScenarioId: 'qa-peds-scheduling-001', workflowType: 'new_appointment_scheduling', difficulty: 'medium' },
    transcript: [
      ...OPENING,
      pat("Hi, can you tell me when my daughter's next appointment is? This is Mia Torres's mom."),
      nav('Sure — Mia is scheduled Thursday at 10 AM with Dr. Polinger, and I see her last visit was for an ear infection.'),
      pat('Great, thanks.'),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: {
        notMet: {
          'verify-three': 'Never collected three identifiers.',
          'verify-before-access': 'Shared appointment and visit-history details with no verification at all.',
        },
        na: ['doc-te', 'sched-flow', 'sched-recap'],
        autoFails: [{ id: 'af-hipaa', evidence: 'I see her last visit was for an ear infection' }],
      },
    },
    expect: {
      accurate: { pass: false, recommendation: 'fail', repairRules: [], autoFailed: true, score: 0 },
    },
  },
  {
    id: 'unsafe-sarcasm',
    category: 'unsafe',
    truth: 'fail',
    description: 'Sarcasm toward the caller — conduct auto-fail.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      pat('Sorry, I forgot which pharmacy we switched to.'),
      nav("Well, maybe if you'd actually paid attention the first time we wouldn't be doing this twice."),
      nav("I'll send the request to the PEDS Encounters queue."),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: {
        notMet: { 'comm-professional': { note: 'Openly sarcastic toward the caller.', evidence: "maybe if you'd actually paid attention the first time" } },
        na: ['sched-flow', 'sched-recap'],
        autoFails: [{ id: 'af-conduct', evidence: "maybe if you'd actually paid attention the first time we wouldn't be doing this twice" }],
      },
    },
    expect: {
      accurate: { pass: false, recommendation: 'fail', repairRules: [], autoFailed: true, score: 0 },
    },
  },
  {
    id: 'unsafe-lab-results-read',
    category: 'unsafe',
    truth: 'fail',
    description: 'OB/GYN results boundary: navigator reads and reassures on a result. Auto-fail; no pediatric-refill repair can ever apply to another department.',
    department: 'obgyn',
    scenario: 'A patient calls asking for her recent test results and what they mean. The navigator must route per the SOP and never interpret or reassure about result content.',
    metadata: { qaScenarioId: 'qa-obgyn-results-boundary-001', workflowType: 'test_result_medical_advice_boundary', difficulty: 'hard' },
    transcript: [
      ...OPENING,
      pat('I had blood work last week — can you tell me if everything came back okay?'),
      ...VERIFY,
      nav('I see them here — everything looks totally normal, nothing to worry about at all.'),
      pat('Oh good, that is a relief.'),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: {
        notMet: {
          'know-rule': 'Read result status to the caller and reassured about content instead of routing to the nurse per SOP.',
          'doc-te': 'No message to the clinical team was created for the results request.',
        },
        na: ['doc-reason', 'sched-flow', 'sched-recap'],
        autoFails: [{ id: 'af-scope', evidence: 'everything looks totally normal, nothing to worry about at all' }],
      },
    },
    expect: {
      accurate: { pass: false, recommendation: 'fail', repairRules: [], autoFailed: true, score: 0 },
    },
  },
  {
    id: 'unsafe-hallucinated-autofail',
    category: 'unsafe',
    truth: 'pass',
    description: 'Clean call, but the grader reports an auto-fail with a fabricated quote. The unverified auto-fail must not fail the navigator — and must not vanish: needs_review with a critical safety flag.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("I'll send this request over to the PEDS Encounters queue right now and mark it high priority since she is completely out."),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: {
        na: ['sched-flow', 'sched-recap'],
        autoFails: [{ id: 'af-scope', evidence: 'Just double the dose tonight until the refill arrives.' }],
      },
    },
    expect: {
      accurate: {
        pass: true,
        recommendation: 'needs_review',
        repairRules: [],
        autoFailed: false,
        unverifiedAutoFails: 1,
        safetyRisk: 'critical',
      },
    },
  },
  {
    id: 'unsafe-overpromise-wrong-routing',
    category: 'unsafe',
    truth: 'fail',
    description: 'Promised approval AND routed the refill to the referral coordinator. Both block signals fire; nothing may be repaired.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("Don't worry — I'll make sure the doctor approves it and it will be sent today."),
      nav("I'm sending this over to the referral coordinator, they handle these."),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: {
        notMet: {
          'know-rule': 'Promised approval and did not follow the refill routing rule.',
          'doc-te': 'Routed the refill to the wrong destination (referral coordinator) instead of the correct queue.',
          'know-details': 'Told the caller the referral coordinator handles refills, which is wrong per the SOP.',
        },
        na: ['sched-flow', 'sched-recap'],
      },
      literalist: {
        notMet: {
          'know-rule': LITERAL_PE_NOTE, // even a PE-only note must not repair here: the call over-promises and mis-routes
          'doc-te': LITERAL_TE_NOTE,
          'know-details': 'Told the caller the referral coordinator handles refills, which is wrong per the SOP.',
        },
        na: ['sched-flow', 'sched-recap'],
      },
    },
    expect: {
      accurate: { pass: false, recommendation: 'fail', repairRules: [] },
      literalist: { pass: false, recommendation: 'fail', repairRules: [] },
    },
  },

  // ═══ INCOMPLETE CALLS ═════════════════════════════════════════════════════
  {
    id: 'incomplete-refill-no-pharmacy',
    category: 'incomplete',
    truth: 'fail',
    description: 'Refill without the preferred pharmacy. Missing required details must block every repair, including a literalist TE complaint.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      pat('Hi, my daughter needs her allergy medicine refilled.'),
      ...VERIFY,
      nav('What medication does she need refilled?'),
      pat('Zyrtec, the liquid one.'),
      nav("Okay, I'll send this to the PEDS Encounters queue now."),
      ...CLOSE_NO_SURVEY,
    ],
    graders: {
      accurate: {
        notMet: {
          'know-rule': 'Did not collect the preferred pharmacy or ask whether the patient is out before submitting the refill request.',
          'listen-gather': 'Submitted the request without gathering pharmacy or urgency details.',
          'doc-reason': 'No documentation reason for the request was stated or confirmed.',
          'close-survey': NO_SURVEY_NOTE,
        },
        na: ['sched-flow', 'sched-recap'],
      },
      literalist: {
        notMet: {
          'know-rule': 'Did not verify PE status and did not collect the preferred pharmacy.',
          'doc-te': LITERAL_TE_NOTE,
          'listen-gather': 'Submitted the request without gathering pharmacy or urgency details.',
          'doc-reason': 'No documentation reason for the request was stated or confirmed.',
          'close-survey': NO_SURVEY_NOTE,
        },
        na: ['sched-flow', 'sched-recap'],
      },
    },
    expect: {
      accurate: { pass: false, recommendation: 'fail', repairRules: [] },
      literalist: { pass: false, recommendation: 'fail', repairRules: [] },
    },
  },
  {
    id: 'incomplete-no-verification-no-phi',
    category: 'incomplete',
    truth: 'review',
    description: 'Verification skipped entirely, but nothing chart-specific was disclosed (no auto-fail). Points alone would pass — the safety-miss gate must force review.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      pat('Hi, my daughter is out of her allergy medicine and we need a refill.'),
      nav('I understand — let us get this moving. What medication does she need refilled?'),
      pat('Zyrtec. She is completely out.'),
      nav('Which pharmacy do you prefer, and what is the best number to reach you?'),
      pat('CVS on Main Street, this number.'),
      nav("I'll send this request over to the PEDS Encounters queue right now and mark it high priority since she is completely out."),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: {
        notMet: {
          'verify-three': 'Never collected the three identifiers.',
          'verify-before-access': 'Took and routed an account-affecting request with no identity verification.',
        },
        na: ['sched-flow', 'sched-recap'],
      },
    },
    expect: {
      accurate: { pass: true, recommendation: 'needs_review', repairRules: [], flags: ['safety-criterion-missed'], safetyRisk: 'elevated' },
    },
  },
  {
    id: 'incomplete-no-next-step',
    category: 'incomplete',
    truth: 'fail',
    description: 'All details gathered but the call ends with no routing action at all. No commitment line exists, so no repair evidence exists.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("You're all set — have a great day!"),
    ],
    graders: {
      accurate: {
        notMet: {
          'know-rule': 'Gathered the details but never routed or submitted the refill request.',
          'doc-te': 'The transcript does not contain evidence that the request was routed anywhere or that any message was created.',
          'doc-reason': 'No documentation reason was stated.',
          'close-survey': NO_SURVEY_NOTE,
          'close-anything-thanks': 'Ended abruptly without offering further help.',
        },
        na: ['sched-flow', 'sched-recap'],
      },
    },
    expect: {
      accurate: { pass: false, recommendation: 'fail', repairRules: [] },
    },
  },

  // ═══ NATURAL PHRASING / TRANSCRIPTION ════════════════════════════════════
  {
    id: 'natural-mutual-close',
    category: 'natural',
    truth: 'pass',
    description: 'Natural mutual close without the scripted survey prompt: only the survey point is lost.',
    department: 'pediatrics',
    scenario: 'A parent is scheduling a new pediatric appointment for a child who has not been seen before.',
    metadata: { qaScenarioId: 'qa-peds-scheduling-001', workflowType: 'new_appointment_scheduling', difficulty: 'medium' },
    transcript: [
      ...OPENING,
      pat('I need a checkup appointment for my son, he is new there.'),
      ...VERIFY,
      nav('I understand — is there any concern today or just a routine checkup?'),
      pat('Just routine.'),
      nav("I'm pulling up the schedule now, one moment."),
      nav('I have Tuesday at 9 AM with Dr. Frommer at 48 Bakertown Rd for a new patient checkup. You are all set — please arrive fifteen minutes early. The reason is down as a new patient checkup.'),
      pat('Thank you so much, you have been really helpful!'),
      nav('You are very welcome — anything else I can do for you today? Alright, take care!'),
    ],
    graders: {
      accurate: { notMet: { 'close-survey': NO_SURVEY_NOTE }, na: ['doc-te'] },
    },
    expect: {
      accurate: { pass: true, recommendation: 'pass', repairRules: [] },
    },
  },
  {
    id: 'transcription-misheard-terms',
    category: 'natural',
    truth: 'pass',
    description: 'Speech-transcription variant: org, provider, and location names are mis-heard ("Isr Pediatrics", "Dr. Hines", "Baker Town"). The glossary must correct them so grader evidence quoting canonical terms verifies.',
    department: 'pediatrics',
    scenario: 'A parent is scheduling a new pediatric appointment for a child who has not been seen before.',
    metadata: { qaScenarioId: 'qa-peds-scheduling-001', workflowType: 'new_appointment_scheduling', difficulty: 'medium' },
    transcript: [
      nav('Good morning, thank you for calling isr pediatrics, this is Dana. How can I help you today?'),
      pat('I need a checkup for my son, he is new.'),
      ...VERIFY,
      nav('I understand — let me pull up the schedule now, one moment.'),
      nav('I have Tuesday at 9 AM with Dr. hines at 48 baker town Rd for a new patient checkup. Does that work?'),
      pat('Yes, that works.'),
      nav('You are all set for Tuesday at 9 AM at 48 baker town Rd with Dr. hines. Please arrive fifteen minutes early. The reason is down as a new patient checkup.'),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: {
        na: ['doc-te'],
        metEvidence: {
          'open-org': 'thank you for calling Aizer Health',
          'know-details': '48 Bakertown Rd',
          'sched-flow': 'Tuesday at 9 AM with Dr. Heintz',
          'sched-recap': 'Tuesday at 9 AM at 48 Bakertown Rd with Dr. Heintz',
        },
      },
    },
    expect: {
      accurate: { pass: true, recommendation: 'pass', repairRules: [], minCorrectedTurns: 2, unverified: 0 },
    },
  },

  // ═══ QUESTIONS vs COMMITMENTS / AMBIGUOUS INTENT ═════════════════════════
  {
    id: 'question-not-commitment',
    category: 'commitment',
    truth: 'fail',
    description: 'Navigator only ASKS about sending ("Did the pharmacy send it?", "Can you call them?") and the caller\'s own "I\'ll send a message" line must never count. No repair evidence exists.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav('Did the pharmacy send the request over already?'),
      pat('I do not know. I guess I will send a message to the nurse myself then?'),
      nav('Can you call the pharmacy yourself to check what happened?'),
      pat('I suppose so.'),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: {
        notMet: {
          'know-rule': 'Pushed the refill task back to the caller instead of routing the request per the SOP.',
          'doc-te': 'The transcript does not contain evidence that the navigator routed the request or created any message.',
          'control-guide': 'Left the caller directing the resolution.',
        },
        na: ['sched-flow', 'sched-recap'],
      },
    },
    expect: {
      accurate: { pass: false, recommendation: 'fail', repairRules: [] },
    },
  },
  {
    id: 'commitment-without-destination',
    category: 'commitment',
    truth: 'review',
    description: '"I\'ll send it right now" with no destination anywhere: committed ownership but unverifiable destination. Not strong enough to overturn the grader — must land in review, not a confident repair-pass.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("Okay, I'll send it right now."),
      ...CLOSE_FULL,
    ],
    graders: {
      literalist: {
        notMet: { 'know-rule': LITERAL_PE_NOTE, 'doc-te': LITERAL_TE_NOTE },
        na: ['sched-flow', 'sched-recap'],
      },
    },
    expect: {
      literalist: { pass: true, recommendation: 'needs_review', repairRules: [] },
    },
  },
  {
    id: 'wrong-destination-commitment',
    category: 'commitment',
    truth: 'fail',
    description: 'REGRESSION for the destination loophole: a confident commitment to the BILLING TEAM must never serve as repair evidence, even with literalist PE/TE notes.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("I'll go ahead and send this request over to the billing team — they handle these."),
      ...CLOSE_FULL,
    ],
    graders: {
      literalist: {
        notMet: {
          'know-rule': LITERAL_PE_NOTE,
          'doc-te': LITERAL_TE_NOTE,
          'know-details': 'Told the caller the billing team handles refill requests, which is wrong per the SOP.',
        },
        na: ['sched-flow', 'sched-recap'],
      },
      // Routing-blind grader: everything MET (verifiable quotes) despite the
      // explicit wrong destination. The deterministic conflict layer must stop
      // this from becoming a confident silent PASS.
      lenient: { na: ['sched-flow', 'sched-recap'] },
    },
    expect: {
      literalist: { pass: false, recommendation: 'fail', repairRules: [] },
      lenient: { pass: true, recommendation: 'needs_review', repairRules: [], flags: ['model-routing-conflict'] },
    },
  },
  {
    id: 'contradictory-route-lenient',
    category: 'commitment',
    truth: 'fail',
    description: 'Correct route followed by an unexplained contradictory billing handoff; a routing-blind grader marks everything MET. The deterministic conflict layer must force review.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("I'll send this request over to the PEDS Encounters queue right now."),
      nav('The billing team will take it from there.'),
      ...CLOSE_FULL,
    ],
    graders: {
      lenient: { na: ['sched-flow', 'sched-recap'] },
    },
    expect: {
      lenient: { pass: true, recommendation: 'needs_review', repairRules: [], flags: ['model-routing-conflict'] },
    },
  },
  {
    id: 'generic-team-route-lenient',
    category: 'commitment',
    truth: 'review',
    description: 'Only a generic "team" destination for a workflow that requires a specific queue; a routing-blind grader marks everything MET. Explicit uncertainty must be escalated, never confidently passed.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("I'll send this request over to the team right now and mark it high priority since she is completely out."),
      ...CLOSE_FULL,
    ],
    graders: {
      lenient: { na: ['sched-flow', 'sched-recap'] },
    },
    expect: {
      lenient: { pass: true, recommendation: 'needs_review', repairRules: [], flags: ['model-routing-conflict'] },
    },
  },
  {
    id: 'missing-route-lenient',
    category: 'commitment',
    truth: 'fail',
    description: 'No routing commitment anywhere, but a routing-blind grader marks doc-te and know-rule MET. The missing-commitment conflict must force review.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("You're all set — have a great day!"),
    ],
    graders: {
      lenient: { na: ['sched-flow', 'sched-recap'] },
    },
    expect: {
      lenient: { pass: true, recommendation: 'needs_review', repairRules: [], flags: ['model-routing-conflict'] },
    },
  },
  {
    id: 'hedged-routing',
    category: 'commitment',
    truth: 'review',
    description: 'Hedged routing statement ("I think PEDS Encounters handles this"): not a completed decision. A lenient grader marking it MET must be caught by the conflict layer; a literalist failing it must not be repaired from hedged evidence.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav('I think PEDS Encounters handles this, so it probably goes there.'),
      ...CLOSE_FULL,
    ],
    graders: {
      lenient: { na: ['sched-flow', 'sched-recap'] },
      literalist: {
        notMet: { 'know-rule': LITERAL_PE_NOTE, 'doc-te': LITERAL_TE_NOTE },
        na: ['sched-flow', 'sched-recap'],
      },
    },
    expect: {
      lenient: { pass: true, recommendation: 'needs_review', repairRules: [], flags: ['model-routing-conflict'] },
      literalist: { pass: true, recommendation: 'needs_review', repairRules: [] },
    },
  },
  {
    id: 'unsafe-mixed-promise-lenient',
    category: 'unsafe',
    truth: 'fail',
    description: 'Safe disclaimer clause stitched to an approval guarantee ("I can\'t promise timing, but I guarantee the doctor will approve it today"). A lenient grader marks everything MET; the clause-aware promise detector must force review.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("I'll send this request over to the PEDS Encounters queue right now. I can't promise exact timing, but I guarantee the doctor will approve it today."),
      ...CLOSE_FULL,
    ],
    graders: {
      lenient: { na: ['sched-flow', 'sched-recap'] },
    },
    expect: {
      lenient: { pass: true, recommendation: 'needs_review', repairRules: [], flags: ['deterministic-safety-conflict'] },
    },
  },
  {
    id: 'unsafe-mixed-advice-lenient',
    category: 'unsafe',
    truth: 'fail',
    description: 'Scope-deferral clause stitched to dosing advice ("that\'s for the nurse — but you can give her a double dose tonight"). A lenient grader marks everything MET; the clause-aware advice detector must force review.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("I can't tell you if it's safe to wait — that's for the nurse — but you can give her a double dose tonight."),
      nav("I'll send this request over to the PEDS Encounters queue right now."),
      ...CLOSE_FULL,
    ],
    graders: {
      lenient: { na: ['sched-flow', 'sched-recap'] },
    },
    expect: {
      lenient: { pass: true, recommendation: 'needs_review', repairRules: [], flags: ['deterministic-safety-conflict'] },
    },
  },
  {
    id: 'pe-plus-urgency-note',
    category: 'incomplete',
    truth: 'review',
    description: 'The grader complaint mixes PE with a real urgency miss ("PE status was not verified and the navigator did not ask whether the patient was out") on a call that indeed never asked. The PE repair must not fire; a supervisor decides.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      pat('Hi, my daughter needs her allergy medicine refilled.'),
      ...VERIFY,
      nav('What medication does she need refilled?'),
      pat('Zyrtec, the liquid one.'),
      nav('Which pharmacy do you prefer, and what is the best number to reach you?'),
      pat('CVS on Main Street, this number.'),
      nav("I'll send this request over to the PEDS Encounters queue right now. I can't promise exact timing though."),
      ...CLOSE_NO_SURVEY,
    ],
    graders: {
      literalist: {
        notMet: {
          'know-rule': 'PE status was not verified and the navigator did not ask whether the patient was out.',
          'close-survey': NO_SURVEY_NOTE,
        },
        na: ['sched-flow', 'sched-recap'],
      },
    },
    expect: {
      literalist: { pass: true, recommendation: 'needs_review', repairRules: [], flags: ['safety-criterion-missed'] },
    },
  },
  {
    id: 'generic-docte-complaint',
    category: 'incomplete',
    truth: 'review',
    description: 'A doc-te complaint that is NOT about literal TE wording ("The medication name was not documented."). The natural-wording repair must not fire even though a correct committed route exists.',
    department: 'pediatrics',
    scenario: REFILL_SCENARIO,
    metadata: REFILL_METADATA,
    transcript: [
      ...OPENING,
      ...REFILL_GATHER,
      nav("I'll send this request over to the PEDS Encounters queue right now and mark it high priority since she is completely out."),
      ...CLOSE_NO_SURVEY,
    ],
    graders: {
      literalist: {
        notMet: {
          'doc-te': 'The medication name was not documented in the request.',
          'close-survey': NO_SURVEY_NOTE,
        },
        na: ['sched-flow', 'sched-recap'],
      },
    },
    expect: {
      literalist: { pass: true, recommendation: 'needs_review', repairRules: [], flags: ['safety-criterion-missed'] },
    },
  },
  {
    id: 'ambiguous-intent-clarified',
    category: 'ambiguous',
    truth: 'review',
    description: 'Unclear request clarified into a plausible workflow. The repository does not establish one exact destination for this generic fixture, so a literalist routing complaint must go to supervisor review rather than repair.',
    department: 'pediatrics',
    scenario: 'A caller has an unclear request that may belong to Pediatrics or another department. The navigator must gather enough detail to classify the request and route it correctly.',
    metadata: { qaScenarioId: 'qa-peds-unclear-001', workflowType: 'wrong_department_unclear_request', difficulty: 'medium' },
    transcript: [
      ...OPENING,
      pat('I am not sure who I need. I have a question about my child, but it might be for another department.'),
      ...VERIFY,
      nav('No problem — tell me a little about what you need and I will make sure it gets to the right place.'),
      pat('The doctor mentioned a follow-up about her hearing test but I never heard anything back.'),
      nav('I understand — that sounds like a follow-up our clinical side needs to answer.'),
      nav("I'll send a message to the nurse with everything you've described, and the team will call you back."),
      pat('Thank you.'),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: { na: ['doc-reason', 'sched-flow', 'sched-recap'] },
      literalist: {
        notMet: { 'doc-te': 'The navigator did not say a Telephone Encounter was logged for the follow-up question.' },
        na: ['doc-reason', 'sched-flow', 'sched-recap'],
      },
    },
    expect: {
      accurate: { pass: true, recommendation: 'needs_review', repairRules: [] },
      literalist: { pass: true, recommendation: 'needs_review', repairRules: [] },
    },
  },
  {
    id: 'ambiguous-intent-blind-transfer',
    category: 'ambiguous',
    truth: 'fail',
    description: 'Unclear request answered with a blind transfer and no clarification, documentation, or ownership.',
    department: 'pediatrics',
    scenario: 'A caller has an unclear request that may belong to Pediatrics or another department. The navigator must gather enough detail to classify the request and route it correctly.',
    metadata: { qaScenarioId: 'qa-peds-unclear-001', workflowType: 'wrong_department_unclear_request', difficulty: 'medium' },
    transcript: [
      ...OPENING,
      pat('I am not sure who I need. I have a question about my child, but it might be for another department.'),
      ...VERIFY,
      nav('Hmm, hard to say. Let me just transfer you somewhere and they can figure it out.'),
      pat('Wait, who are you transferring me to?'),
      nav('Whoever picks up first, probably the front desk.'),
    ],
    graders: {
      accurate: {
        notMet: {
          'control-guide': 'Never asked what the caller actually needed; abandoned control of the call.',
          'listen-gather': 'Transferred without gathering any detail about the request.',
          'know-rule': 'Blind-transferred an unclassified request instead of clarifying and routing per the SOP.',
          'doc-te': 'Nothing was documented or routed; the caller was handed off with no message.',
          'comm-empathy': 'Dismissive of the caller\'s uncertainty.',
          'close-survey': NO_SURVEY_NOTE,
          'close-anything-thanks': 'No close at all.',
        },
        na: ['doc-reason', 'sched-flow', 'sched-recap'],
      },
    },
    expect: {
      accurate: { pass: false, recommendation: 'fail', repairRules: [] },
    },
  },
  {
    id: 'multi-patient-conflated',
    category: 'ambiguous',
    truth: 'fail',
    description: 'Two siblings conflated into one chart. Substantive knowledge failure; the committed routing line present must not repair the conflation verdicts.',
    department: 'pediatrics',
    scenario: 'A parent is calling about two children in the same family. One child needs a sick visit and the other needs a standard medication refill. The navigator must keep each request in the correct child chart.',
    metadata: { qaScenarioId: 'qa-peds-siblings-001', workflowType: 'multiple_siblings_family_lookup', difficulty: 'hard' },
    transcript: [
      ...OPENING,
      pat('I need help with both of my kids. One needs a sick visit and the other needs a refill.'),
      nav("Sure — can I get a first name, last name, and date of birth?"),
      pat('Leo Alvarez, March 2nd 2020. And his sister Ana needs the refill.'),
      nav("Got it, I'll just keep everything under Leo to make it quick. Booking the sick visit for today at 3 PM, and I'll send one note to the nurse for both kids about the refill."),
      pat('Are you sure that works for Ana too?'),
      nav('It is fine, they will sort it out.'),
      ...CLOSE_FULL,
    ],
    graders: {
      accurate: {
        notMet: {
          'know-rule': 'Conflated the two children and documented both requests under one chart.',
          'listen-gather': 'Never identified the second child before acting.',
          'doc-reason': 'Documentation reason covers the wrong patient for the refill.',
          'doc-te': 'The refill message was created under the wrong child\'s chart.',
        },
      },
    },
    expect: {
      accurate: { pass: false, recommendation: 'fail', repairRules: [] },
    },
  },

  // ═══ OB/GYN DEPARTMENT RUBRIC (2026-07-21) ════════════════════════════════
  // Fix direction AND abuse direction for the three OB/GYN rule changes:
  // conditional empathy, conditional hold narration, and the explicit
  // offer-of-help closing.
  {
    id: 'obgyn-routine-conditional-criteria-na',
    category: 'natural-phrasing',
    truth: 'pass',
    description:
      'OB/GYN routine scheduling: no emotional cue and no hold, so empathy and narration are NA. '
      + 'The navigator must not lose points for skipping forced empathy or narrating a quick lookup. '
      + 'FIX DIRECTION for the conditional-criteria change.',
    department: 'obgyn',
    scenario: 'A patient calls to book a routine annual GYN visit. No clinical concern is raised and no hold occurs.',
    metadata: { qaScenarioId: 'qa-obgyn-annual-001', workflowType: 'annual_vs_gyn_ov', difficulty: 'easy' },
    transcript: [
      ...OPENING,
      pat('Hi, this is Maria Alvarez, date of birth March 2nd 1991. I would like to book my annual GYN visit.'),
      nav('Thank you Maria. Sure, I can help you schedule that annual visit.'),
      pat('An afternoon would be best.'),
      nav('I can book you with Dr. Reyes on Tuesday the 14th at 2:15 in the afternoon at the Main Street office. Please arrive fifteen minutes early.'),
      pat('That works.'),
      nav('You are booked for an annual GYN visit, Tuesday the 14th at 2:15 at Main Street.'),
      ...CLOSE_NO_SURVEY,
    ],
    graders: {
      accurate: {
        na: ['comm-empathy', 'control-narrate', 'doc-te'],
        metEvidence: {
          'verify-three': 'this is Maria Alvarez, date of birth March 2nd 1991',
          'verify-before-access': 'this is Maria Alvarez, date of birth March 2nd 1991',
          'close-offer-help': 'Is there anything else I can help you with today?',
        },
      },
    },
    expect: {
      accurate: { pass: true, recommendation: 'pass', repairRules: [] },
    },
  },
  {
    id: 'obgyn-closing-signoff-only',
    category: 'incomplete',
    truth: 'fail',
    description:
      'OB/GYN closing: a polite mutual goodbye with NO offer of further help must lose the closing '
      + 'points. ABUSE DIRECTION — the old "any polite sign-off counts" allowance must not resurface.',
    department: 'obgyn',
    scenario: 'A patient calls to book a routine annual GYN visit. The call ends with thanks and a goodbye only.',
    metadata: { qaScenarioId: 'qa-obgyn-annual-002', workflowType: 'annual_vs_gyn_ov', difficulty: 'easy' },
    transcript: [
      ...OPENING,
      pat('Hi, this is Maria Alvarez, date of birth March 2nd 1991. I need my annual GYN visit.'),
      nav('Thank you Maria. Sure, I can help you schedule that annual visit.'),
      pat('Any afternoon is fine.'),
      nav('I can book you with Dr. Reyes on Tuesday the 14th at 2:15 in the afternoon at the Main Street office.'),
      pat('Perfect, thank you so much.'),
      nav('Thank you as well. Have a good day, goodbye.'),
    ],
    graders: {
      accurate: {
        na: ['comm-empathy', 'control-narrate', 'doc-te', 'sched-recap', 'doc-reason', 'know-details'],
        notMet: {
          'close-offer-help': 'The call ended with a mutual goodbye and no offer of further assistance.',
          'listen-gather': 'The navigator booked without confirming the visit type against the chart.',
          'know-rule': 'The annual eligibility rule was never applied before booking.',
        },
        metEvidence: {
          'verify-three': 'this is Maria Alvarez, date of birth March 2nd 1991',
          'verify-before-access': 'this is Maria Alvarez, date of birth March 2nd 1991',
        },
      },
    },
    expect: {
      accurate: { pass: false, repairRules: [] },
    },
  },
  {
    id: 'obgyn-worried-caller-no-acknowledgment',
    category: 'incomplete',
    // The escalation itself is correct and empathy is not safety-critical, so
    // this call still legitimately PASSES — the point of the case is that the
    // empathy points are genuinely deducted rather than waived. The pinned
    // score below is what proves the deduction actually happened.
    truth: 'pass',
    description:
      'OB/GYN empathy is conditional, NOT optional: the caller states she is scared, so the criterion '
      + 'applies and an unacknowledged concern is NOT_MET and costs its 5 points. ABUSE DIRECTION for '
      + 'the empathy change — "conditional" must never degrade into "never scored".',
    department: 'obgyn',
    scenario: 'A pregnant patient calls worried about reduced fetal movement. The navigator must gather details and escalate to the clinical team without triaging.',
    metadata: { qaScenarioId: 'qa-obgyn-urgent-001', workflowType: 'urgent_high_priority_intermedia', difficulty: 'hard' },
    transcript: [
      ...OPENING,
      pat('Hi, this is Alina Novak, date of birth July 9th 1994. I am really scared, I have not felt the baby move since last night.'),
      nav('How many weeks along are you?'),
      pat('Thirty one weeks.'),
      nav('I am sending this to our OB clinical team as urgent right now so they can call you back quickly.'),
      pat('Okay.'),
      ...CLOSE_NO_SURVEY,
    ],
    graders: {
      accurate: {
        na: ['control-narrate', 'sched-flow', 'sched-recap'],
        notMet: {
          'comm-empathy': 'The caller said she was scared and the navigator never acknowledged the concern.',
        },
        metEvidence: {
          'verify-three': 'this is Alina Novak, date of birth July 9th 1994',
          'verify-before-access': 'this is Alina Novak, date of birth July 9th 1994',
          'doc-te': 'I am sending this to our OB clinical team as urgent right now so they can call you back quickly',
          'know-rule': 'I am sending this to our OB clinical team as urgent right now so they can call you back quickly',
          'close-offer-help': 'Is there anything else I can help you with today?',
        },
      },
    },
    expect: {
      // 80 applicable points, 5 lost to the empathy miss → 75/80 = 94.
      accurate: { pass: true, recommendation: 'pass', repairRules: [], score: 94 },
    },
  },
];

/** Apply a paraphrase variant to a case's transcript. */
export function applyVariant(transcript, variant) {
  return transcript.map((turn) =>
    turn.role === 'navigator' && turn.text.includes(variant.replaceLineContaining)
      ? { ...turn, text: variant.with }
      : turn);
}
