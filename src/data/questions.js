// questions-obgyn.js does not import this file — no circular dependency.
import { SEED_QUESTIONS_OBGYN } from './questions-obgyn.js';

// ─────────────────────────────────────────────────────────────────────────────
// DOMAINS + SEED QUESTIONS — the content of the check.
//
// DOMAINS (2026-07-02 redesign) mirror the real Patient Navigator job: cross-
// department inbound call handlers who classify requests, route them to the
// right owner, schedule accurately, protect scope/privacy, and document
// cleanly. They are shared across all departments (same 6 IDs, neutral names).
// Each department's questions map to the same domain IDs so the scoring and
// matrix pipeline works identically regardless of which department is active.
//
// The seventh capability from the role description — "adaptability under
// complexity" — lives on the COMPETENCY axis (criticalThinking /
// problemResolution), not here: domains are bodies of knowledge; competencies
// are how the navigator thinks.
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
    id: 'intake',
    name: 'Call Opening & Identification',
    blurb:
      'Department-adaptive patient lookup and verification — parent phone-first for Pediatrics, DOB-first for adult departments, family accounts, and confirming the right chart.',
  },
  {
    id: 'classification',
    name: 'Call Classification',
    blurb:
      'Reading the request correctly — scheduling vs. clinical question vs. refill vs. lab result vs. urgent vs. wrong department vs. needs-approval.',
  },
  {
    id: 'routing',
    name: 'Routing & Escalation',
    blurb:
      'Sending each request to the right owner — TE queues, department sub-routing, soft transfers, and urgent escalation paths.',
  },
  {
    id: 'scheduling',
    name: 'Scheduling & Appointment Rules',
    blurb:
      'Correct appointment type, timing rules, provider template, and approval requirements for each department.',
  },
  {
    id: 'boundaries',
    name: 'Scope & Privacy',
    blurb:
      'Hard limits — no clinical advice or results by phone, no promised approvals or exceptions, and strict caller-authorization privacy rules.',
  },
  {
    id: 'documentation',
    name: 'Documentation & Follow-through',
    blurb:
      'Clean, complete records — correct TE destination, reason fields, callback details, and system entry conventions.',
  },
];

export const domainName = (id) => DOMAINS.find((d) => d.id === id)?.name ?? id;

export const SEED_QUESTIONS = [
  // ── Call Opening & Identification ──────────────────────────────────────────
  {
    id: 'q-int-1',
    domainId: 'intake',
    competencies: ['sopApplication', 'sopKnowledge'],
    scenario:
      'A parent calls the Pediatrics line to book visits for their children. What do you ask for first to pull up the chart?',
    options: [
      { id: 'a', text: 'The child\'s last name, to avoid duplicates.', points: 25,
        rationale: 'Name search is weaker — it misses linked family accounts and shared/changed names.' },
      { id: 'b', text: 'The parent\'s phone number — it pulls up the whole family, and parents often call for more than one child.', points: 100,
        rationale: 'Correct: in Pediatrics the parent\'s phone number is asked first because it surfaces the linked family account; parents frequently call for two or three children.' },
      { id: 'c', text: 'The child\'s date of birth first, then the name.', points: 30,
        rationale: 'DOB-first is the adult-department flow (patients calling for themselves); in Pediatrics phone-first surfaces the family linkage.' },
      { id: 'd', text: 'Create a fresh account and merge later if a duplicate turns up.', points: 5,
        rationale: 'Creates avoidable duplicate records and rework.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-int-2',
    domainId: 'intake',
    competencies: ['sopApplication', 'problemResolution', 'customerHandling'],
    scenario:
      'A mother calls needing a sick visit for her 4-year-old and a refill for her 7-year-old. You\'ve pulled up the family by her phone number. How do you proceed?',
    options: [
      { id: 'a', text: 'Handle both in this call, working in each child\'s own chart — the sick visit under the 4-year-old, the refill workflow under the 7-year-old.', points: 100,
        rationale: 'Correct: multi-child calls are normal in Pediatrics. Each child\'s request is handled in that child\'s chart so booking and documentation land on the right patient.' },
      { id: 'b', text: 'Ask her to call back separately for the second child.', points: 10,
        rationale: 'Unnecessary friction — the family is already pulled up; both requests can be handled now.' },
      { id: 'c', text: 'Handle both requests under the older child\'s chart to save time.', points: 0,
        rationale: 'Documenting one child\'s request in another child\'s chart is a records error with clinical-safety implications.' },
      { id: 'd', text: 'Book the sick visit, then tell her refills go through a different phone line.', points: 20,
        rationale: 'Invents a separate line; refills are handled on this call via the refill workflow.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'q-int-3',
    domainId: 'intake',
    competencies: ['sopKnowledge', 'compliance', 'criticalThinking'],
    scenario:
      'You pull up a patient and the eligibility indicator shows a Yellow "Y". What does this tell you before you proceed with the request?',
    options: [
      { id: 'a', text: 'Eligible and Aizer is the primary care provider.', points: 15,
        rationale: 'Yellow specifically flags that Aizer is NOT the PCP.' },
      { id: 'b', text: 'Coverage is active, but Aizer is NOT the patient\'s primary care provider (PCP).', points: 100,
        rationale: 'Correct per SOP: Yellow "Y" = active coverage but Aizer is not the PCP — worth knowing before booking.' },
      { id: 'c', text: 'Verification is still pending.', points: 10,
        rationale: 'Pending is a different indicator state.' },
      { id: 'd', text: 'Coverage is inactive or there is a data error.', points: 10,
        rationale: 'Yellow "Y" is active coverage, not inactive/error.' },
    ],
    correctOptionId: 'b',
  },

  // ── Call Classification ────────────────────────────────────────────────────
  {
    id: 'q-cls-1',
    domainId: 'classification',
    competencies: ['criticalThinking', 'sopApplication', 'riskManagement'],
    scenario:
      'A parent calls: her son ran out of his daily asthma medication yesterday, and she also wants to know whether his cough "sounds serious." How do you classify this call?',
    options: [
      { id: 'a', text: 'Two workflows: a refill request (TE to the PEDS Encounters queue, high priority — he is completely out) AND a clinical question (also routed, never answered by you).', points: 100,
        rationale: 'Correct: this call contains two distinct requests. Each gets its own workflow — the refill with the high-priority flag, and the clinical question routed for a clinical callback.' },
      { id: 'b', text: 'A refill request — handle that and move on.', points: 25,
        rationale: 'Catches the refill but drops the clinical question, which still needs routing.' },
      { id: 'c', text: 'Reassure her the cough is probably fine, then process the refill.', points: 0,
        rationale: 'Judging whether a symptom "sounds serious" is clinical advice — outside navigator scope regardless of intent.' },
      { id: 'd', text: 'A same-day sick visit request — book the cough in and skip the refill for now.', points: 35,
        rationale: 'Offering a same-day sick visit for the cough is defensible, but substituting it for classification drops the urgent refill entirely.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'q-cls-2',
    domainId: 'classification',
    competencies: ['criticalThinking', 'compliance', 'escalation'],
    scenario:
      'A parent asks whether she can double her child\'s amoxicillin dose because the fever hasn\'t broken. What kind of request is this, and what is your first move?',
    options: [
      { id: 'a', text: 'A medication question you can answer from the label — tell her to follow the printed instructions.', points: 10,
        rationale: 'Even restating dosing guidance is clinical territory; the question needs a clinician.' },
      { id: 'b', text: 'A clinical question — send a TE to the PEDS Encounters queue so a clinician calls her back; never answer it yourself.', points: 100,
        rationale: 'Correct: dosing questions are clinical. The navigator classifies it as a clinical question and routes it — the answer always comes from clinical staff.' },
      { id: 'c', text: 'A refill request — start the refill workflow.', points: 5,
        rationale: 'Nothing is being refilled; misclassifying delays the actual clinical answer.' },
      { id: 'd', text: 'A scheduling request — book a same-day sick visit and let the provider sort it out.', points: 40,
        rationale: 'A persistent fever may justify a sick visit, but the dosing question still needs classification and routing as a clinical question — booking alone leaves it unanswered.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-cls-3',
    domainId: 'classification',
    competencies: ['criticalThinking', 'customerHandling', 'problemResolution'],
    scenario:
      'While booking her child\'s physical, a mother asks you to also schedule her own postpartum check-up. What do you do?',
    options: [
      { id: 'a', text: 'Finish the Pediatrics task, then route her to OB/GYN scheduling for the postpartum visit — it belongs to a different department.', points: 100,
        rationale: 'Correct: the second request is a wrong-department item. Complete your task and hand the OB/GYN request to the department that owns it.' },
      { id: 'b', text: 'Book the postpartum visit yourself using a Pediatrics template.', points: 0,
        rationale: 'Cross-department booking in the wrong template creates a broken appointment in the wrong schedule.' },
      { id: 'c', text: 'Tell her you can only help with the child and she\'ll have to figure out the rest.', points: 20,
        rationale: 'Correctly declines to book, but drops the patient instead of routing her to the right department.' },
      { id: 'd', text: 'Send one TE to the PEDS Encounters queue covering both requests.', points: 10,
        rationale: 'The pediatric queue has no ownership of an OB/GYN scheduling request; it would stall there.' },
    ],
    correctOptionId: 'a',
  },

  // ── Routing & Escalation ───────────────────────────────────────────────────
  {
    id: 'q-rt-1',
    domainId: 'routing',
    competencies: ['escalation', 'sopKnowledge', 'compliance'],
    scenario:
      'A parent calls needing a refill of their teen\'s Concerta (a controlled substance). Where does this go?',
    options: [
      { id: 'a', text: 'Marisa Kraft or Jeanette Alcantara.', points: 15,
        rationale: 'They handle immunizations, not controlled-substance refills.' },
      { id: 'b', text: 'Sally Carilli (Ext. 1934), who routes controlled-substance refills and mental-health follow-ups.', points: 100,
        rationale: 'Correct per SOP: Sally Carilli (Ext. 1934) handles controlled-substance refills.' },
      { id: 'c', text: 'The PEDS Encounters queue, like any other refill.', points: 30,
        rationale: 'Controlled substances have a dedicated owner — they do not follow the standard refill queue.' },
      { id: 'd', text: 'Anisa Azeez (Ext. 1911).', points: 10,
        rationale: 'Anisa handles referrals and transportation forms, not refills.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-rt-2',
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
    id: 'q-rt-3',
    domainId: 'routing',
    competencies: ['sopKnowledge', 'escalation'],
    scenario:
      'A family needs a referral processed and asks about a 2020 Transportation form. Who handles this?',
    options: [
      { id: 'a', text: 'Haley Newton (Ext. 1909).', points: 10,
        rationale: 'Not the owner of referrals or transportation forms.' },
      { id: 'b', text: 'Anisa Azeez (Ext. 1911), who directs referrals and 2020 Transportation forms.', points: 100,
        rationale: 'Correct per SOP: Pediatrics referrals are assigned to Anisa Azeez (Ext. 1911), who also handles 2020 Transportation forms.' },
      { id: 'c', text: 'Sally Carilli (Ext. 1934).', points: 10,
        rationale: 'Sally handles controlled substances, not referrals/forms.' },
      { id: 'd', text: 'The PEDS Encounters queue.', points: 20,
        rationale: 'Referrals have a named owner — assigning to the general queue delays processing.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-rt-4',
    domainId: 'routing',
    competencies: ['sopApplication', 'riskManagement', 'problemResolution'],
    scenario:
      'A parent requests a refill of their child\'s daily (non-controlled) medication. The child has been completely out since yesterday. How do you route it?',
    options: [
      { id: 'a', text: 'Check the e-prescription log, copy the medication and prescribing provider, send a TE to the PEDS Encounters queue, and mark it HIGH PRIORITY because the patient is completely out.', points: 100,
        rationale: 'Correct per SOP: refills route as a TE to the PEDS Encounters queue with the medication details from the e-prescription log — flagged high priority when the patient is fully out.' },
      { id: 'b', text: 'Send the same TE at normal priority — refills are routine.', points: 40,
        rationale: 'Right queue and content, but a patient who is completely out of a daily medication triggers the high-priority flag.' },
      { id: 'c', text: 'Route it to Sally Carilli.', points: 10,
        rationale: 'Sally\'s routing is for controlled substances; this is a standard refill.' },
      { id: 'd', text: 'Tell the parent the provider will send it to the pharmacy today.', points: 5,
        rationale: 'Promises an outcome the navigator cannot guarantee, and no TE means nothing actually happens.' },
    ],
    correctOptionId: 'a',
  },

  // ── Scheduling & Appointment Rules ─────────────────────────────────────────
  {
    id: 'q-sc-1',
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
    id: 'q-sc-2',
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
    id: 'q-sc-3',
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
    id: 'q-sc-4',
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
  {
    id: 'q-sc-5',
    domainId: 'scheduling',
    competencies: ['sopKnowledge', 'sopApplication', 'communication'],
    scenario:
      'On Tuesday, a parent wants a sick visit booked for Thursday because that\'s when she can get a ride. What do you tell her?',
    options: [
      { id: 'a', text: 'Book the Thursday sick slot now so she doesn\'t lose it.', points: 10,
        rationale: 'Same-day sick visits can ONLY be booked on the day of the visit — pre-booking one breaks the template.' },
      { id: 'b', text: 'Explain that same-day sick visits are booked only on the day itself, and advise her to call Thursday morning — or, if the chart documents a provider-ordered follow-up, book it as an office visit instead.', points: 100,
        rationale: 'Correct per SOP: same-day sick visits book same-day only. Office visits are the pre-bookable type — but only when a documented follow-up supports it.' },
      { id: 'c', text: 'Book it as an office visit to lock in the slot.', points: 25,
        rationale: 'Office visits require a documented follow-up from a previous report — using the type as a workaround corrupts the schedule.' },
      { id: 'd', text: 'Tell her to take the child to urgent care on Thursday.', points: 5,
        rationale: 'Deflects a bookable visit out of the practice entirely.' },
    ],
    correctOptionId: 'b',
  },

  // ── Scope & Privacy ────────────────────────────────────────────────────────
  {
    id: 'q-bd-1',
    domainId: 'boundaries',
    competencies: ['compliance', 'riskManagement', 'customerHandling'],
    scenario:
      'A patient asks you to read back their recent test results over the phone. What do you do?',
    options: [
      { id: 'a', text: 'Read the results if they verify their date of birth.', points: 0,
        rationale: 'A compliance violation — results are never given by the navigator, even after ID verification.' },
      { id: 'b', text: 'Explain that you cannot share results, and send a TE to the PEDS Encounters queue so the clinical team calls back with them.', points: 100,
        rationale: 'Correct: navigators never convey or interpret results. The TE to the clinical queue is what gets the patient a proper answer.' },
      { id: 'c', text: 'Summarize the results in plain language only.', points: 5,
        rationale: 'Still conveying medical results — the same violation in softer words.' },
      { id: 'd', text: 'Mail the results and end the call.', points: 25,
        rationale: 'Avoids the phone violation but fails to route the patient for the clinical follow-up they need.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-bd-2',
    domainId: 'boundaries',
    competencies: ['compliance', 'customerHandling', 'communication'],
    scenario:
      'A parent insists their child needs a physical three months early for camp, and asks you to promise the provider will approve an exception. What do you do?',
    options: [
      { id: 'a', text: 'Promise it — the provider almost always approves camp requests.', points: 0,
        rationale: 'Navigators never promise approvals. If the provider declines, the promise becomes the practice\'s problem.' },
      { id: 'b', text: 'Explain you can\'t approve exceptions or speak for the provider; offer the correct path — route the request for provider review, or book the earliest compliant date.', points: 100,
        rationale: 'Correct: approving exceptions and promising outcomes are both outside navigator scope. Offering the legitimate path keeps the patient moving without overcommitting.' },
      { id: 'c', text: 'Quietly book the early physical — camp forms are a good reason.', points: 5,
        rationale: 'An unauthorized exception that also risks a claim denial under the PE timing rules.' },
      { id: 'd', text: 'Say no and end the call — rules are rules.', points: 30,
        rationale: 'Correctly refuses to promise, but leaves the parent with no path forward.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-bd-3',
    domainId: 'boundaries',
    competencies: ['compliance', 'riskManagement', 'customerHandling'],
    scenario:
      'A caller identifies herself as a child\'s grandmother and asks what happened at yesterday\'s visit and what the doctor prescribed. What do you do?',
    options: [
      { id: 'a', text: 'Share it — she\'s immediate family.', points: 0,
        rationale: 'Family relationship alone does not authorize access to visit details or prescriptions.' },
      { id: 'b', text: 'Check whether she is an authorized contact on the account; if not, courteously decline to share details and offer to take a message or have the authorized parent call.', points: 100,
        rationale: 'Correct: information goes only to callers authorized on the account. Declining with a path forward protects privacy without abandoning the caller.' },
      { id: 'c', text: 'Confirm just the prescription — that seems harmless.', points: 5,
        rationale: 'A prescription IS protected clinical information; "just one detail" is still a disclosure.' },
      { id: 'd', text: 'Refuse and end the call immediately.', points: 20,
        rationale: 'Protects privacy but with no courtesy and no path forward for a possibly legitimate caregiver.' },
    ],
    correctOptionId: 'b',
  },

  // ── Documentation & Follow-through ─────────────────────────────────────────
  {
    id: 'q-doc-1',
    domainId: 'documentation',
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
    id: 'q-doc-2',
    domainId: 'documentation',
    competencies: ['sopApplication', 'communication', 'problemResolution'],
    scenario:
      'You are writing the TE for a refill request. Which documentation is complete?',
    options: [
      { id: 'a', text: 'Medication name and dosage, prescribing provider (from the e-prescription log), preferred pharmacy, callback number — and the priority flag if the patient is out.', points: 100,
        rationale: 'Correct: a complete refill TE lets the provider act without a callback loop — medication, prescriber, pharmacy, callback, and priority are all load-bearing.' },
      { id: 'b', text: 'The medication name — the provider can look up the rest.', points: 20,
        rationale: 'Every missing field becomes a delay: the provider has to chase pharmacy and contact details before acting.' },
      { id: 'c', text: '"Needs refill, please call patient."', points: 5,
        rationale: 'Contains no actionable information at all — guarantees a second round-trip.' },
      { id: 'd', text: 'Pharmacy and callback number, since those change most often.', points: 15,
        rationale: 'Without the medication and prescriber, the request itself is undefined.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'q-doc-3',
    domainId: 'documentation',
    competencies: ['communication', 'sopApplication'],
    scenario:
      'You are booking a same-day sick visit for a child with fever and cough. Which reason-field entry is correct?',
    options: [
      { id: 'a', text: '"FEVER + COUGH since last night, per mom" — all symptoms, in the reason section.', points: 100,
        rationale: 'Correct per SOP: write ALL reported symptoms in the reason section so the provider walks in prepared.' },
      { id: 'b', text: '"Sick."', points: 10,
        rationale: 'Tells the provider nothing — the symptoms belong in the reason field.' },
      { id: 'c', text: '"Parent called."', points: 5,
        rationale: 'Documents the call, not the clinical reason for the visit.' },
      { id: 'd', text: 'Put the symptoms in General Notes and leave the reason field blank.', points: 30,
        rationale: 'Right content, wrong field — the reason section is what the schedule and provider read.' },
    ],
    correctOptionId: 'a',
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
