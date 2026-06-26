// questions-obgyn.js does not import this file — no circular dependency.
import { SEED_QUESTIONS_OBGYN } from './questions-obgyn.js';

// ─────────────────────────────────────────────────────────────────────────────
// DOMAINS + SEED QUESTIONS — the content of the check.
//
// DOMAINS are shared across all departments (same 6 IDs, neutral names). Each
// department's questions map to the same domain IDs so the scoring and matrix
// pipeline works identically regardless of which department is active.
//
// SCORING MODEL (two axes):
//   • Every question is tagged to a `domainId` (one of DOMAINS) — the topic axis.
//   • Every question is tagged with `competencies` (ids from competencies.js) —
//     the capability axis (how the navigator thinks/decides/communicates).
//   • Every OPTION carries `points` (0–100 = quality of that choice) and a
//     `rationale` (why it's right/wrong, SOP-referenced). The 100-point option is
//     the "best answer"; `correctOptionId` mirrors it for backward-compatibility
//     and best-answer highlighting. Partial-credit options reward defensible-but-
//     suboptimal judgement.
//
// SEED vs LIVE: SEED_QUESTIONS (Pediatrics) + SEED_QUESTIONS_OBGYN (from
// questions-obgyn.js) seed the Firestore `questions` collection on first run
// and are the offline fallback. Once seeded, the live bank is managed in
// Firestore. Each question carries a `department` field so the active-bank
// query can filter by department. DOMAINS stays static here.
//
// To edit: keep one option at `points: 100` per question, give every option a
// `rationale`, and tag `domainId` + at least one `competencies` id.
// ─────────────────────────────────────────────────────────────────────────────

export const DOMAINS = [
  {
    id: 'sites',
    name: 'Sites & Routing',
    blurb: 'Which location or queue handles what — site capabilities, prefixes, and owner routing.',
  },
  {
    id: 'scheduling',
    name: 'Scheduling & Visit Rules',
    blurb: 'Visit timing rules, managed-care exceptions, and procedure-specific scheduling protocols.',
  },
  {
    id: 'providers',
    name: 'Provider Matching',
    blurb: 'Booking nuances, demographic comfort, languages, credentials, and specialist constraints.',
  },
  {
    id: 'routing',
    name: 'Call Routing & Triage',
    blurb: 'Who handles what — clinical triage, escalation paths, and what must never be answered on the phone.',
  },
  {
    id: 'insurance',
    name: 'Insurance & Eligibility',
    blurb: 'Eligibility indicators, plan-specific rules, exemptions, and self-pay handling.',
  },
  {
    id: 'registration',
    name: 'Registration & Records',
    blurb: 'Account search, arrival guidance, confirmation status, records, and late/transfer policy.',
  },
];

export const domainName = (id) => DOMAINS.find((d) => d.id === id)?.name ?? id;

export const SEED_QUESTIONS = [
  // ── Sites & Routing ────────────────────────────────────────────────────────
  {
    id: 'q-sites-1',
    domainId: 'sites',
    competencies: ['sopKnowledge', 'sopApplication', 'customerHandling'],
    scenario:
      'A parent wants to bring their child to the Blooming Grove (Route 208) location for a routine blood draw. How do you handle the request?',
    options: [
      { id: 'a', text: 'Book the lab draw at Blooming Grove — it has a "208-Lab" routing code.', points: 10,
        rationale: 'Invents a code Blooming Grove does not have; sends the family to a site that cannot perform the draw.' },
      { id: 'b', text: 'Explain Blooming Grove has no on-site lab; specimens are routed externally, so direct the draw accordingly.', points: 100,
        rationale: 'Correct per SOP: Blooming Grove has no on-site lab; set the expectation and route the specimen externally.' },
      { id: 'c', text: 'Tell them no Aizer site can do blood draws.', points: 0,
        rationale: 'False — other sites perform labs; turning the family away loses care and trust.' },
      { id: 'd', text: 'Book it at Blooming Grove for any weekday.', points: 10,
        rationale: 'Same capability gap — booking it anyway results in a wasted, draw-less visit.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-sites-2',
    domainId: 'sites',
    competencies: ['sopKnowledge', 'compliance', 'sopApplication'],
    scenario:
      'You are booking a nursing service at the Baker Town location. What is the correct way to enter it in the system?',
    options: [
      { id: 'a', text: 'Use the standard "Peds Lab" / "Ped Nurse" designation, same as Forest Road.', points: 15,
        rationale: "Reusing Forest Road's designation breaks Baker Town's distinct site routing." },
      { id: 'b', text: 'Use the "BK" prefix (e.g., "BK Peds Lab") to keep site routing distinct.', points: 100,
        rationale: 'Correct per SOP: Baker Town uses the "BK" prefix so its routing stays distinct.' },
      { id: 'c', text: 'Use the "208" prefix.', points: 10,
        rationale: '208 is Blooming Grove (Route 208), not Baker Town.' },
      { id: 'd', text: 'No prefix is needed; the system sorts by address.', points: 10,
        rationale: 'The system routes by site prefix, not address — omitting it misroutes the service.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-sites-3',
    domainId: 'sites',
    competencies: ['sopKnowledge', 'communication', 'sopApplication'],
    scenario:
      'A family asks for a complex, multidisciplinary visit and also asks which site Dr. Dina Faiden works at. What do you tell them?',
    options: [
      { id: 'a', text: 'Complex/multidisciplinary care is concentrated at the Forest Road hub; Dr. Faiden staffs Blooming Grove, Monday–Thursday.', points: 100,
        rationale: 'Correct per SOP: Forest Road is the hub for complex care; Dr. Faiden is at Blooming Grove Mon–Thu.' },
      { id: 'b', text: 'Complex care happens at Blooming Grove; Dr. Faiden is at Baker Town all week.', points: 10,
        rationale: 'Both facts are wrong — wrong hub and wrong provider site.' },
      { id: 'c', text: 'All sites handle complex care equally; Dr. Faiden rotates daily.', points: 5,
        rationale: 'Complex care is concentrated at the hub, not spread evenly; the rotation claim is invented.' },
      { id: 'd', text: 'Forest Road only handles routine visits; Dr. Faiden is at Forest Road Fridays.', points: 10,
        rationale: 'Inverts the hub role and misplaces the provider.' },
    ],
    correctOptionId: 'a',
  },

  // ── Scheduling & Visit Rules ────────────────────────────────────────────────
  {
    id: 'q-sched-1',
    domainId: 'scheduling',
    competencies: ['compliance', 'sopApplication', 'riskManagement'],
    scenario:
      'A parent with commercial/private insurance wants their child\'s annual physical scheduled exactly one year after the last one. What guidance applies?',
    options: [
      { id: 'a', text: 'Any date in the same calendar year is fine.', points: 15,
        rationale: 'Too loose — booking too early risks a claim denial.' },
      { id: 'b', text: 'Follow the "one calendar year plus one day" rule to avoid claim denials.', points: 100,
        rationale: 'Correct per SOP: one calendar year plus one day protects the claim.' },
      { id: 'c', text: 'Physicals can be done every six months on commercial plans.', points: 5,
        rationale: 'That is not the commercial-plan rule and would be denied.' },
      { id: 'd', text: 'Book it one day earlier to be safe.', points: 5,
        rationale: 'One day early is exactly what triggers the denial the rule prevents.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-sched-2',
    domainId: 'scheduling',
    competencies: ['criticalThinking', 'sopApplication', 'compliance'],
    scenario:
      'A Fidelis (managed care) family wants an early physical because their child just turned 6. The last PE was 7 months ago. Is an early physical permitted?',
    options: [
      { id: 'a', text: 'No — managed care never allows early physicals.', points: 20,
        rationale: 'Overly strict — it misses the documented age-milestone exception.' },
      { id: 'b', text: 'Yes — it has been at least six months AND the child reached the next age milestone, so the exception applies.', points: 100,
        rationale: 'Correct per SOP: both conditions (≥6 months and a new age milestone) are met.' },
      { id: 'c', text: 'Yes — reaching a new age alone is enough, regardless of timing.', points: 35,
        rationale: 'Right outcome, incomplete reasoning — the six-month minimum must also be met.' },
      { id: 'd', text: 'Only if it has been a full calendar year.', points: 10,
        rationale: 'Applies the commercial-plan rule, not the managed-care exception.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-sched-3',
    domainId: 'scheduling',
    competencies: ['sopApplication', 'riskManagement', 'sopKnowledge'],
    scenario:
      'You are booking a newborn (4 weeks old) for a first visit. Which handling is correct?',
    options: [
      { id: 'a', text: 'Book any open slot, no special alerts needed.', points: 15,
        rationale: 'Skips the newborn protocol (timing, papers, alert).' },
      { id: 'b', text: 'Book at the start of the provider\'s shift, request hospital discharge papers, and add the "NPP" or "MRC" alert.', points: 100,
        rationale: 'Correct per SOP: start-of-shift slot, discharge papers, and the NPP/MRC alert.' },
      { id: 'c', text: 'Book at the end of the day to keep mornings open for sick visits.', points: 20,
        rationale: 'Wrong timing for a newborn and still omits papers and the alert.' },
      { id: 'd', text: 'Book mid-shift and skip paperwork until the visit.', points: 10,
        rationale: 'Deferring discharge papers risks an incomplete, unsafe first visit.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-sched-4',
    domainId: 'scheduling',
    competencies: ['compliance', 'sopApplication', 'riskManagement'],
    scenario:
      'A parent calls to schedule "just a quick tetanus shot" for their child after a minor injury, and says no exam is needed. What do you do?',
    options: [
      { id: 'a', text: 'Book the shot alone — tetanus is administrative.', points: 10,
        rationale: 'Violates the rule that every tetanus administration requires a provider check.' },
      { id: 'b', text: 'Schedule a provider check-up immediately prior to the shot, since every tetanus administration requires one.', points: 100,
        rationale: 'Correct per SOP: a provider check-up must precede every tetanus shot.' },
      { id: 'c', text: 'Only require an exam if the child is overdue for a physical.', points: 25,
        rationale: 'The exam requirement is tied to the shot, not to physical timing.' },
      { id: 'd', text: 'Route the call to the lab team to administer it.', points: 10,
        rationale: 'Mis-routes the request and still skips the required provider check.' },
    ],
    correctOptionId: 'b',
  },

  // ── Provider Matching ───────────────────────────────────────────────────────
  {
    id: 'q-prov-1',
    domainId: 'providers',
    competencies: ['customerHandling', 'sopApplication', 'sopKnowledge'],
    scenario:
      'A mother wants her 15-year-old daughter seen as soon as possible and asks who is available. Which provider is appropriate to offer?',
    options: [
      { id: 'a', text: 'Dr. Eliezer Frommer — he is fast-paced and has openings.', points: 25,
        rationale: 'Prioritises availability over the documented demographic-comfort match.' },
      { id: 'b', text: 'Dr. Adam Polinger — he is noted as comfortable with teenage females.', points: 100,
        rationale: 'Correct per SOP: Dr. Polinger is noted as comfortable with teenage females.' },
      { id: 'c', text: 'Dr. Lazar Khaimov — he is high volume.', points: 20,
        rationale: 'Volume is not the matching factor here.' },
      { id: 'd', text: 'Any provider; demographic comfort is not a booking factor.', points: 10,
        rationale: 'Demographic comfort IS a documented booking factor.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-prov-2',
    domainId: 'providers',
    competencies: ['sopKnowledge', 'sopApplication', 'riskManagement'],
    scenario:
      'A child needs stitches. Which provider should you book?',
    options: [
      { id: 'a', text: 'Dr. Tamar Dachoh.', points: 10,
        rationale: 'Not the designated stitches provider.' },
      { id: 'b', text: 'Dr. Chana Heintz — the only provider for stitches.', points: 100,
        rationale: 'Correct per SOP: Dr. Heintz is the only provider for stitches.' },
      { id: 'c', text: 'Whichever provider has the next open slot.', points: 10,
        rationale: 'Ignores the single-provider constraint for stitches.' },
      { id: 'd', text: 'Robin Aschkenasy, PA.', points: 10,
        rationale: 'Not the designated stitches provider.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-prov-3',
    domainId: 'providers',
    competencies: ['compliance', 'sopKnowledge', 'customerHandling', 'problemResolution'],
    scenario:
      'A family with United Healthcare wants a cardiology appointment with Dr. Cooper. How do you handle it?',
    options: [
      { id: 'a', text: 'Book it — all specialists accept United Healthcare.', points: 5,
        rationale: 'False blanket assumption; this booking would be denied.' },
      { id: 'b', text: 'Dr. Cooper does not accept United Healthcare; do not book that combination (MVP requires secondary Medicaid).', points: 100,
        rationale: 'Correct per SOP: Dr. Cooper does not accept UHC; MVP requires secondary Medicaid.' },
      { id: 'c', text: 'Book it only on the 2nd-last Tuesday of the month.', points: 5,
        rationale: 'Invented scheduling rule; does not resolve the insurance mismatch.' },
      { id: 'd', text: 'Refer them to Dr. Gottlieb instead — he takes UHC.', points: 30,
        rationale: 'Offering an alternative is good service, but asserting Gottlieb takes UHC without verifying repeats the booking-error risk.' },
    ],
    correctOptionId: 'b',
  },

  // ── Call Routing & Referrals ────────────────────────────────────────────────
  {
    id: 'q-route-1',
    domainId: 'routing',
    competencies: ['compliance', 'escalation', 'riskManagement', 'customerHandling', 'problemResolution'],
    scenario:
      'A patient asks you to read back their recent test results over the phone. What do you do?',
    options: [
      { id: 'a', text: 'Read the results if they verify their date of birth.', points: 0,
        rationale: 'A compliance violation — results/medical advice are never given by phone, even after ID verification.' },
      { id: 'b', text: 'Never give results/medical advice by phone — route the call to the "Q-Pediatrics Nursing Inquiries" queue.', points: 100,
        rationale: 'Correct per SOP: never give results by phone; route to the Q-Pediatrics Nursing Inquiries queue.' },
      { id: 'c', text: 'Summarize the results in plain language only.', points: 5,
        rationale: 'Still conveying medical results — the same violation in softer words.' },
      { id: 'd', text: 'Mail the results and end the call.', points: 25,
        rationale: 'Avoids the phone violation but fails to route the patient to the right clinical queue.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-route-2',
    domainId: 'routing',
    competencies: ['escalation', 'sopKnowledge', 'compliance'],
    scenario:
      'A parent calls needing a refill of their teen\'s Concerta (a controlled substance). Where does this go?',
    options: [
      { id: 'a', text: 'Marisa Kraft or Jeanette Alcantara.', points: 15,
        rationale: 'They handle immunizations, not controlled-substance refills.' },
      { id: 'b', text: 'Sally Carilli (Ext. 1934), who routes controlled-substance refills and mental-health follow-ups.', points: 100,
        rationale: 'Correct per SOP: Sally Carilli (Ext. 1934) handles controlled-substance refills.' },
      { id: 'c', text: 'Anisa Azeez (Ext. 1911).', points: 10,
        rationale: 'Anisa handles referrals and transportation forms, not refills.' },
      { id: 'd', text: 'Haley Newton (Ext. 1909).', points: 10,
        rationale: 'Wrong routing for a controlled-substance refill.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-route-3',
    domainId: 'routing',
    competencies: ['sopApplication', 'escalation', 'customerHandling', 'problemResolution'],
    scenario:
      'A patient calls to request an immunization, and Marisa Kraft is currently available. What is the correct action?',
    options: [
      { id: 'a', text: 'Send a Telephone Encounter (TE) to Marisa.', points: 40,
        rationale: 'A TE is the right path when she is unavailable; since she is available now, a soft transfer serves the patient faster.' },
      { id: 'b', text: 'Direct the call to Marisa (or Jeanette) and perform a "soft transfer" since she is available.', points: 100,
        rationale: 'Correct per SOP: when the owner is available, soft-transfer the live call.' },
      { id: 'c', text: 'Book the immunization yourself.', points: 10,
        rationale: 'Immunizations are owned by Marisa/Jeanette, not the front line.' },
      { id: 'd', text: 'Route it to Sally Carilli.', points: 10,
        rationale: 'Sally handles controlled substances, not immunizations.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-route-4',
    domainId: 'routing',
    competencies: ['sopKnowledge', 'escalation'],
    scenario:
      'A family needs a referral processed and asks about a 2020 Transportation form. Who handles this?',
    options: [
      { id: 'a', text: 'Haley Newton (Ext. 1909).', points: 10,
        rationale: 'Not the owner of referrals or transportation forms.' },
      { id: 'b', text: 'Anisa Azeez (Ext. 1911), who directs referrals and 2020 Transportation forms.', points: 100,
        rationale: 'Correct per SOP: Anisa Azeez (Ext. 1911) handles referrals and 2020 Transportation forms.' },
      { id: 'c', text: 'Sally Carilli (Ext. 1934).', points: 10,
        rationale: 'Sally handles controlled substances, not referrals/forms.' },
      { id: 'd', text: 'The nursing inquiries queue.', points: 10,
        rationale: 'That queue is for clinical inquiries, not referral processing.' },
    ],
    correctOptionId: 'b',
  },

  // ── Insurance & Eligibility ─────────────────────────────────────────────────
  {
    id: 'q-ins-1',
    domainId: 'insurance',
    competencies: ['sopKnowledge', 'compliance', 'criticalThinking'],
    scenario:
      'When you pull up a patient, the eligibility indicator shows a Yellow "Y". What does this mean for booking?',
    options: [
      { id: 'a', text: 'Eligible and Aizer is the primary care provider.', points: 15,
        rationale: 'Yellow specifically flags that Aizer is NOT the PCP.' },
      { id: 'b', text: 'Active, but Aizer is NOT the primary care provider (PCP).', points: 100,
        rationale: 'Correct per SOP: Yellow "Y" = active coverage but Aizer is not the PCP.' },
      { id: 'c', text: 'Verification is still pending.', points: 10,
        rationale: 'Pending is a different indicator state.' },
      { id: 'd', text: 'Coverage is inactive or there is a data error.', points: 10,
        rationale: 'Yellow "Y" is active coverage, not inactive/error.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-ins-2',
    domainId: 'insurance',
    competencies: ['compliance', 'sopApplication', 'riskManagement'],
    scenario:
      'A patient has Healthfirst and asks to book. What must you confirm before treating it as accepted?',
    options: [
      { id: 'a', text: 'Nothing — Healthfirst is always accepted.', points: 10,
        rationale: 'Healthfirst is conditional, not always accepted.' },
      { id: 'b', text: 'That the patient has active Medicaid as a secondary payer; Healthfirst is accepted only then.', points: 100,
        rationale: 'Correct per SOP: Healthfirst is accepted only with active secondary Medicaid.' },
      { id: 'c', text: 'That United Healthcare is their primary.', points: 5,
        rationale: 'Unrelated to the Healthfirst + secondary-Medicaid rule.' },
      { id: 'd', text: 'That they have prior authorization for a physical.', points: 10,
        rationale: 'Prior auth is not the gating condition for Healthfirst acceptance.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-ins-3',
    domainId: 'insurance',
    competencies: ['sopKnowledge', 'customerHandling', 'communication', 'problemResolution'],
    scenario:
      'An uninsured family asks about cost. What are the self-pay options?',
    options: [
      { id: 'a', text: 'A flat $25 fee for everyone.', points: 20,
        rationale: '$25 is the sliding-scale floor, not a flat fee for everyone.' },
      { id: 'b', text: 'A sliding fee scale starting at $25 (income-based, 1-year validity), or a flat self-pay of $100.', points: 100,
        rationale: 'Correct per SOP: income-based sliding scale from $25 (1-year validity) or a flat $100 self-pay.' },
      { id: 'c', text: 'A flat $100 only; no sliding scale exists.', points: 25,
        rationale: 'Misses the income-based sliding scale, leaving low-income families overcharged.' },
      { id: 'd', text: 'Self-pay is not offered.', points: 5,
        rationale: 'Self-pay options do exist; denying them turns the family away unnecessarily.' },
    ],
    correctOptionId: 'b',
  },

  // ── Registration & Confirmation ─────────────────────────────────────────────
  {
    id: 'q-reg-1',
    domainId: 'registration',
    competencies: ['sopApplication', 'sopKnowledge'],
    scenario:
      'You are registering a returning patient. What is the first search you should run, and why?',
    options: [
      { id: 'a', text: 'Search by last name to avoid duplicates.', points: 25,
        rationale: 'Name search is weaker — it misses linked family accounts and shared/changed names.' },
      { id: 'b', text: 'Search by phone number first, to identify linked family accounts.', points: 100,
        rationale: 'Correct per SOP: phone-first surfaces linked family accounts and prevents duplicates.' },
      { id: 'c', text: 'Search by date of birth first.', points: 20,
        rationale: 'DOB alone does not surface the family linkage phone search provides.' },
      { id: 'd', text: 'Create a new account immediately, then merge later.', points: 10,
        rationale: 'Creates avoidable duplicate records and rework.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-reg-2',
    domainId: 'registration',
    competencies: ['sopKnowledge', 'communication'],
    scenario:
      'In the confirmation color-coding system, a patient\'s appointment shows Purple with a "V". What does that signify?',
    options: [
      { id: 'a', text: 'No confirmation has been attempted.', points: 10,
        rationale: 'Purple "V" indicates a completed staff confirmation, not no attempt.' },
      { id: 'b', text: 'Staff-confirmed (a person reached and confirmed the patient).', points: 100,
        rationale: 'Correct per SOP: Purple "V" = staff-confirmed by a live person.' },
      { id: 'c', text: 'An automated or manual message was left.', points: 25,
        rationale: 'A message-left state is a different colour code — not a completed confirmation.' },
      { id: 'd', text: 'The appointment was cancelled.', points: 5,
        rationale: 'Cancellation is a separate status entirely.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-reg-3',
    domainId: 'registration',
    competencies: ['compliance', 'customerHandling', 'sopApplication', 'problemResolution'],
    scenario:
      'A parent calls after their child\'s checkout asking you to add Tylenol/Motrin to today\'s visit so insurance covers it. What do you tell them?',
    options: [
      { id: 'a', text: 'Add it now — OTC meds are always insurance-covered.', points: 10,
        rationale: 'OTC coverage is conditional on being dispensed before checkout.' },
      { id: 'b', text: 'OTC meds are insurance-covered only if dispensed before checkout; post-checkout, the patient must purchase them.', points: 100,
        rationale: 'Correct per SOP: OTC meds are covered only if dispensed before checkout.' },
      { id: 'c', text: 'Re-open the visit and bill it as a new appointment.', points: 5,
        rationale: 'Re-opening/re-billing a closed visit is a billing-integrity risk.' },
      { id: 'd', text: 'Route the request to the lab team.', points: 10,
        rationale: 'Mis-routes the request; the lab team does not own OTC coverage rules.' },
    ],
    correctOptionId: 'b',
  },
];

// Stamp department on every Pediatrics seed question (safe even if already set).
for (const q of SEED_QUESTIONS) q.department = 'pediatrics';

// Back-compat alias: existing imports of QUESTIONS keep working.
export const QUESTIONS = SEED_QUESTIONS;

// Re-export so consumers can import the OB/GYN seed directly from questions.js.
export { SEED_QUESTIONS_OBGYN };

// Combined seed for ALL assessed departments — used by seedQuestionsIfEmpty in db.js.
export const ALL_SEED_QUESTIONS = [...SEED_QUESTIONS, ...SEED_QUESTIONS_OBGYN];
