// ─────────────────────────────────────────────────────────────────────────────
// MCQ v2 — OPERATING-MODEL QUESTION BANK  (mcq-v2-operating-model-2026-07)
//
// WHY THIS FILE EXISTS: the first generation of active MCQs (the original seed
// bank + early Gemini-generated scenarios) tested too much SOP-literal recall —
// "what is the rule" rather than "what is the right decision on a messy call."
// This v2 bank is written against the Patient Navigator Operating Model
// (api/_navigator-operating-model.js): every item is a realistic floor situation
// that tests navigator DECISION QUALITY across the eight-step decision loop
// (identify → authorize → classify → act/route/schedule → protect scope →
// document → close), with realistic near-miss distractors drawn from the real
// navigator mistake taxonomy.
//
// These questions REPLACE the weak active MCQs. The replacement is a marker-gated,
// once-only Firestore migration (runMcqV2OperatingModelMigration in db.js): the
// old active generated/seed questions are ARCHIVED (never deleted), and these v2
// items are inserted as `active`. Manual/supervisor-authored questions are
// preserved. The capability-matrix scoring model is unchanged — v2 items use the
// exact same shape (points-per-option, one 100-point best answer, per-option
// rationale, domain + competency tags) so scoring/analytics work identically.
//
// COVERAGE: 24 Pediatrics + 24 OB/GYN = 48 items, 4 per domain per department
// (intake · classification · routing · scheduling · boundaries · documentation).
//
// QUALITY BAR (enforced by src/data/questions-v2.test.js):
//   • exactly one 100-point option per question; correctOptionId points to it
//   • every option carries a rationale; every question has dept/domain/competencies
//   • stable, unique ids (qv2-<dept>-<domain>-<n>)
//   • passes the shared content guards (no lookup-order-only grading, no
//     "PE status blocks the refill" logic, no clinical advice/result reading as a
//     correct answer)
//   • balanced by department and domain
//
// The SOP facts referenced here are the SAME facts already established in the
// existing seed banks (questions.js / questions-obgyn.js) and _sop-context.js —
// no new SOP facts are invented. Everything else is generic navigator decision
// logic that needs no department-specific fact.
// ─────────────────────────────────────────────────────────────────────────────

// ══ PEDIATRICS ═══════════════════════════════════════════════════════════════

const PEDS = [
  // ── intake ─────────────────────────────────────────────────────────────────
  {
    id: 'qv2-peds-intake-1',
    domainId: 'intake',
    competencies: ['sopApplication', 'riskManagement', 'problemResolution'],
    scenario:
      'A parent calls Pediatrics asking for an albuterol refill for one child, then mentions another child has a fever and needs a sick visit. You found the family by phone number. What is the safest way to handle the call?',
    options: [
      { id: 'a', text: 'Handle both under the first child’s chart, since it is the same parent account.', points: 0,
        rationale: 'Documenting one child’s request in a sibling’s chart is a wrong-chart records and patient-safety error.' },
      { id: 'b', text: 'Handle both requests, but open the correct child’s chart for each: schedule and document the sick visit under the febrile child, and route the refill with medication, pharmacy, callback, and out-of-medication status under the refill child.', points: 100,
        rationale: 'Correct: multi-child calls are normal. Each request is handled in the matching child’s chart, so booking and documentation land on the right patient.' },
      { id: 'c', text: 'Book the sick visit first and tell the parent to call back separately for the refill.', points: 40,
        rationale: 'Adds needless friction — the family is already reached and both requests can be handled now, each in its own chart.' },
      { id: 'd', text: 'Send one Telephone Encounter summarizing both children’s issues to save time.', points: 20,
        rationale: 'A merged TE mixes two patients’ records and gives the clinician nothing chart-specific to act on.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-peds-intake-2',
    domainId: 'intake',
    competencies: ['compliance', 'customerHandling', 'criticalThinking'],
    scenario:
      'A caller says she is the family’s babysitter for the day. She wants to book a sick visit for the child and also asks you to read her the child’s current medication list so she knows what to give. How do you handle her?',
    options: [
      { id: 'a', text: 'Refuse to help at all because she is not the parent, and end the call.', points: 30,
        rationale: 'Right to withhold clinical detail, but it needlessly drops a visit that can be booked, and offers no path forward.' },
      { id: 'b', text: 'Read her the medication list and book the visit, since she is caring for the child today.', points: 0,
        rationale: 'The medication list is protected clinical information; disclosing it to an unauthorized caller is a privacy violation.' },
      { id: 'c', text: 'Book the sick visit, but do not disclose the medication list or other chart details to an unauthorized caller; offer to have an authorized parent call for the clinical information.', points: 100,
        rationale: 'Correct: creating an appointment is fine, but chart/clinical details go only to an authorized caller — protect the boundary while still moving the visit forward.' },
      { id: 'd', text: 'Tell her the parent has to call back for everything, including the appointment.', points: 40,
        rationale: 'Over-restricts — the visit can be booked now; only the clinical disclosure needs an authorized caller.' },
    ],
    correctOptionId: 'c',
  },
  {
    id: 'qv2-peds-intake-3',
    domainId: 'intake',
    competencies: ['riskManagement', 'criticalThinking', 'sopApplication'],
    scenario:
      'A parent needs a sick visit for one of her twins. Your search shows two patients with the same name and the same date of birth. What do you do before opening a chart?',
    options: [
      { id: 'a', text: 'Recognize that date of birth alone cannot tell twins apart, and confirm an additional distinguishing identifier so you open the correct chart, not the sibling’s.', points: 100,
        rationale: 'Correct: shared DOB does not disambiguate twins — one more identifier prevents a wrong-chart entry.' },
      { id: 'b', text: 'Use the child’s date of birth to select the chart, since that uniquely identifies a patient.', points: 30,
        rationale: 'A believable near-miss: DOB usually works, but twins share it, so it cannot pick the right chart here.' },
      { id: 'c', text: 'Open whichever of the two records was updated most recently.', points: 0,
        rationale: 'Recency proves nothing about identity and is exactly how wrong-chart errors happen.' },
      { id: 'd', text: 'Create a fresh chart so you do not risk picking the wrong twin.', points: 10,
        rationale: 'A duplicate chart is not a safe workaround; verify the correct existing patient instead.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-peds-intake-4',
    domainId: 'intake',
    competencies: ['sopKnowledge', 'compliance', 'criticalThinking'],
    scenario:
      'While booking a physical, the eligibility indicator shows a Yellow "Y" on the patient. How should this change what you do next?',
    options: [
      { id: 'a', text: 'Treat it as inactive coverage and tell the parent to fix their insurance before you book anything.', points: 0,
        rationale: 'Yellow "Y" is active coverage — turning the family away misreads the indicator.' },
      { id: 'b', text: 'Note that coverage is active but Aizer is NOT the primary care provider, and proceed while flagging the not-PCP status per workflow.', points: 100,
        rationale: 'Correct per SOP: Yellow "Y" = active coverage, Aizer not the PCP — worth flagging, not a stop.' },
      { id: 'c', text: 'Proceed exactly as if Aizer is the PCP and add no note.', points: 30,
        rationale: 'Books the visit but drops the not-PCP flag that downstream billing and referrals depend on.' },
      { id: 'd', text: 'Cancel the booking and route the whole call to insurance verification.', points: 20,
        rationale: 'Coverage is already active; a full stop-and-reroute is unnecessary and delays care.' },
    ],
    correctOptionId: 'b',
  },

  // ── classification ───────────────────────────────────────────────────────────
  {
    id: 'qv2-peds-cls-1',
    domainId: 'classification',
    competencies: ['criticalThinking', 'sopApplication', 'riskManagement'],
    scenario:
      'A parent says her son ran out of his daily asthma controller yesterday, and also asks whether his cough "sounds serious." How do you classify this call?',
    options: [
      { id: 'a', text: 'As two workflows: a refill (route to the PEDS Encounters queue, high priority — he is completely out) and a clinical question (routed for a clinician callback, never answered by you).', points: 100,
        rationale: 'Correct: the call holds two distinct requests, each with its own handling — the urgent refill and the routed clinical question.' },
      { id: 'b', text: 'As a refill request — handle the refill and move on.', points: 25,
        rationale: 'Catches the refill but silently drops the clinical question, which still needs routing.' },
      { id: 'c', text: 'Reassure her the cough is probably nothing, then process the refill.', points: 0,
        rationale: 'Judging whether a symptom "sounds serious" is clinical advice, outside navigator scope.' },
      { id: 'd', text: 'As a same-day sick visit — book the cough in and skip the refill for now.', points: 35,
        rationale: 'A sick visit is defensible, but substituting it for classification drops the urgent, out-of-medication refill.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-peds-cls-2',
    domainId: 'classification',
    competencies: ['compliance', 'escalation', 'criticalThinking'],
    scenario:
      'A parent asks whether she can double her child’s amoxicillin dose because the fever has not broken. How do you classify this, and what is your first move?',
    options: [
      { id: 'a', text: 'As a medication question you can answer from the label — tell her to follow the printed instructions.', points: 10,
        rationale: 'Even restating dosing guidance is clinical territory; the question needs a clinician.' },
      { id: 'b', text: 'As a clinical question — create a TE to the PEDS Encounters queue for a clinician callback, and never answer the dosing question yourself.', points: 100,
        rationale: 'Correct: dosing questions are clinical. Classify and route it; the answer comes from clinical staff.' },
      { id: 'c', text: 'As a refill request — start the refill workflow.', points: 5,
        rationale: 'Nothing is being refilled; misclassifying delays the actual clinical answer.' },
      { id: 'd', text: 'As a scheduling request — book a same-day sick visit and let the provider sort out the dose.', points: 40,
        rationale: 'A persistent fever may justify a sick visit, but the dosing question still needs routing — booking alone leaves it unanswered.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-peds-cls-3',
    domainId: 'classification',
    competencies: ['criticalThinking', 'customerHandling', 'problemResolution'],
    scenario:
      'Midway through booking a child’s physical, the mother asks you to also schedule her own postpartum check-up. How do you handle the second request?',
    options: [
      { id: 'a', text: 'Finish the Pediatrics booking, then route her to OB/GYN scheduling for the postpartum visit — it belongs to a different department.', points: 100,
        rationale: 'Correct: the second request is a wrong-department item; complete your task and hand it to the owning department.' },
      { id: 'b', text: 'Book the postpartum visit yourself using a Pediatrics appointment template.', points: 0,
        rationale: 'Cross-department booking in the wrong template creates a broken appointment in the wrong schedule.' },
      { id: 'c', text: 'Tell her you only handle the child and she will have to figure out the rest herself.', points: 20,
        rationale: 'Correctly declines to book, but abandons her instead of routing to the right department.' },
      { id: 'd', text: 'Send one TE to the PEDS Encounters queue covering both the child and the mother.', points: 10,
        rationale: 'The pediatric queue has no ownership of an OB/GYN scheduling request; it would stall there.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-peds-cls-4',
    domainId: 'classification',
    competencies: ['criticalThinking', 'compliance', 'problemResolution'],
    scenario:
      'A parent calls: "I think my daughter needs a dermatology referral, and I also want to know the results of the skin swab from last week." How do you classify this call?',
    options: [
      { id: 'a', text: 'As two workflows: route the referral to the referral owner, and create a TE to the clinical queue so the team calls back with the result — you do not read the result yourself.', points: 100,
        rationale: 'Correct: a referral request and a lab-result request are distinct; results are never conveyed by the navigator.' },
      { id: 'b', text: 'Read her the swab result from the chart and start the referral.', points: 0,
        rationale: 'Conveying a lab result is a scope/compliance violation regardless of intent.' },
      { id: 'c', text: 'Start the referral and tell her the results will come to her by mail.', points: 40,
        rationale: 'Handles the referral and avoids reading the result, but invents a delivery method and drops the clinical follow-up.' },
      { id: 'd', text: 'Send one TE to the clinical queue covering both the referral and the result.', points: 30,
        rationale: 'The result belongs in a clinical TE, but the referral has its own owner and stalls if merged in.' },
    ],
    correctOptionId: 'a',
  },

  // ── routing ────────────────────────────────────────────────────────────────
  {
    id: 'qv2-peds-rt-1',
    domainId: 'routing',
    competencies: ['escalation', 'sopKnowledge', 'compliance'],
    scenario:
      'A parent calls to refill their teen’s Concerta, a controlled substance. Where does this request go?',
    options: [
      { id: 'a', text: 'To Marisa Kraft or Jeanette Alcantara.', points: 15,
        rationale: 'They own immunizations, not controlled-substance refills.' },
      { id: 'b', text: 'To the PEDS Encounters queue, like any other refill.', points: 30,
        rationale: 'A believable near-miss, but controlled substances have a dedicated owner and do not follow the standard refill queue.' },
      { id: 'c', text: 'To Sally Carilli (Ext. 1934), who routes controlled-substance refills and mental-health follow-ups.', points: 100,
        rationale: 'Correct per SOP: controlled-substance refills are routed to Sally Carilli (Ext. 1934).' },
      { id: 'd', text: 'To Anisa Azeez (Ext. 1911).', points: 10,
        rationale: 'Anisa owns referrals and 2020 Transportation forms, not refills.' },
    ],
    correctOptionId: 'c',
  },
  {
    id: 'qv2-peds-rt-2',
    domainId: 'routing',
    competencies: ['sopApplication', 'escalation', 'problemResolution'],
    scenario:
      'A patient calls to request an immunization, and Marisa Kraft — who owns immunizations — is available right now. What is the correct action?',
    options: [
      { id: 'a', text: 'Direct the call to Marisa (or Jeanette) with a soft transfer, since the owner is available now.', points: 100,
        rationale: 'Correct per SOP: when the owner is available, soft-transfer the live call rather than queue a TE.' },
      { id: 'b', text: 'Send a Telephone Encounter to Marisa for a callback.', points: 40,
        rationale: 'A TE is the right path only when she is unavailable; a soft transfer serves the patient faster right now.' },
      { id: 'c', text: 'Book the immunization yourself into an open slot.', points: 10,
        rationale: 'Immunizations are owned by Marisa/Jeanette, not booked from the front line.' },
      { id: 'd', text: 'Route it to Sally Carilli.', points: 10,
        rationale: 'Sally handles controlled substances, not immunizations.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-peds-rt-3',
    domainId: 'routing',
    competencies: ['sopApplication', 'riskManagement', 'problemResolution'],
    scenario:
      'A parent requests a refill of their child’s daily, non-controlled medication. The child has been completely out since yesterday. How do you route it?',
    options: [
      { id: 'a', text: 'Copy the medication and prescribing provider from the e-prescription log, send a TE to the PEDS Encounters queue, and mark it HIGH PRIORITY because the child is completely out.', points: 100,
        rationale: 'Correct per SOP: standard refills route as a TE to PEDS Encounters with the medication details, flagged high priority when the patient is fully out.' },
      { id: 'b', text: 'Send the same TE at normal priority — refills are routine.', points: 40,
        rationale: 'Right queue and content, but a child completely out of a daily medication triggers the high-priority flag.' },
      { id: 'c', text: 'Route it to Sally Carilli, who handles refills.', points: 10,
        rationale: 'Sally’s routing is for controlled substances; this is a standard refill.' },
      { id: 'd', text: 'Tell the parent the provider will send it to the pharmacy today.', points: 5,
        rationale: 'Promises an outcome you cannot guarantee, and without a TE nothing actually happens.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-peds-rt-4',
    domainId: 'routing',
    competencies: ['escalation', 'riskManagement', 'criticalThinking'],
    scenario:
      'A parent calls in a panic: their 6-month-old is breathing hard and their lips are turning blue right now. What do you do?',
    options: [
      { id: 'a', text: 'Book the first available same-day sick visit for today.', points: 0,
        rationale: 'An active breathing emergency cannot wait for an office slot — this under-escalates a life-threatening symptom.' },
      { id: 'b', text: 'Treat it as an emergency: instruct the parent to call 911 or go to the ER immediately, and do not book a visit or queue a routine TE.', points: 100,
        rationale: 'Correct: acute respiratory distress with cyanosis is an emergency; the navigator directs to emergency care immediately.' },
      { id: 'c', text: 'Send a high-priority TE to the clinical queue for a callback.', points: 10,
        rationale: 'A callback is far too slow for an active emergency.' },
      { id: 'd', text: 'Transfer to the triage nurse and stay on the line.', points: 40,
        rationale: 'Better than booking, but an active emergency needs 911/ER first, not an internal transfer.' },
    ],
    correctOptionId: 'b',
  },

  // ── scheduling ───────────────────────────────────────────────────────────────
  {
    id: 'qv2-peds-sc-1',
    domainId: 'scheduling',
    competencies: ['compliance', 'sopApplication', 'riskManagement'],
    scenario:
      'A parent with commercial/private insurance wants their child’s annual physical booked as close as possible to the last one. What guidance applies?',
    options: [
      { id: 'a', text: 'Any date in the same calendar year is fine.', points: 15,
        rationale: 'Too loose — booking too early risks a claim denial.' },
      { id: 'b', text: 'Book at "one calendar year plus one day" from the last physical to avoid a claim denial.', points: 100,
        rationale: 'Correct per SOP: one calendar year plus one day protects the commercial claim.' },
      { id: 'c', text: 'Book it one day early so it is convenient for the family.', points: 5,
        rationale: 'One day early is exactly what triggers the denial the rule prevents.' },
      { id: 'd', text: 'Commercial plans allow a physical every six months, so book whenever they like.', points: 5,
        rationale: 'That is not the commercial-plan rule and would be denied.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-peds-sc-2',
    domainId: 'scheduling',
    competencies: ['criticalThinking', 'sopApplication', 'compliance'],
    scenario:
      'A Fidelis (managed care) family wants an early physical because their child just turned 6. The last physical was 7 months ago. Is an early physical permitted?',
    options: [
      { id: 'a', text: 'No — managed care never allows an early physical.', points: 20,
        rationale: 'Overly strict; it misses the documented age-milestone exception.' },
      { id: 'b', text: 'Yes — it has been at least six months AND the child reached a new age milestone, so the exception applies.', points: 100,
        rationale: 'Correct per SOP: both conditions (≥6 months and a new age milestone) are met.' },
      { id: 'c', text: 'Yes — reaching a new age is enough on its own, regardless of timing.', points: 35,
        rationale: 'Right outcome, incomplete reasoning: the six-month minimum must also be satisfied.' },
      { id: 'd', text: 'Only if a full calendar year has passed.', points: 10,
        rationale: 'That applies the commercial-plan rule, not the managed-care exception.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-peds-sc-3',
    domainId: 'scheduling',
    competencies: ['sopApplication', 'riskManagement', 'sopKnowledge'],
    scenario:
      'You are booking a 4-week-old newborn for a first visit. Which handling is correct?',
    options: [
      { id: 'a', text: 'Book any open slot; newborns need no special handling.', points: 15,
        rationale: 'Skips the newborn protocol — timing, discharge papers, and the alert.' },
      { id: 'b', text: 'Book at the start of the provider’s shift, request the hospital discharge papers, and add the "NPP" or "MRC" alert.', points: 100,
        rationale: 'Correct per SOP: start-of-shift slot, discharge papers, and the NPP/MRC alert.' },
      { id: 'c', text: 'Book at the end of the day to keep mornings open for sick visits.', points: 20,
        rationale: 'Wrong timing for a newborn and still omits the papers and the alert.' },
      { id: 'd', text: 'Book mid-shift and collect any paperwork at the visit.', points: 10,
        rationale: 'Deferring the discharge papers risks an incomplete, unsafe first visit.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-peds-sc-4',
    domainId: 'scheduling',
    competencies: ['sopApplication', 'communication', 'compliance'],
    scenario:
      'On Tuesday, a parent wants a sick visit booked for Thursday because that is when she can get a ride. What do you tell her?',
    options: [
      { id: 'a', text: 'Book the Thursday sick slot now so she does not lose it.', points: 10,
        rationale: 'Same-day sick visits can only be booked on the day of the visit — pre-booking one breaks the template.' },
      { id: 'b', text: 'Explain that same-day sick visits are booked only on the day itself and to call Thursday morning — unless the chart documents a provider-ordered follow-up, in which case book it as an office visit.', points: 100,
        rationale: 'Correct per SOP: same-day sick visits are same-day only; the pre-bookable office visit needs a documented follow-up.' },
      { id: 'c', text: 'Book it as an office visit to lock in the slot regardless.', points: 25,
        rationale: 'Office visits require a documented follow-up; using the type as a workaround corrupts the schedule.' },
      { id: 'd', text: 'Tell her to take the child to urgent care on Thursday instead.', points: 5,
        rationale: 'Deflects a bookable visit out of the practice entirely.' },
    ],
    correctOptionId: 'b',
  },

  // ── boundaries ───────────────────────────────────────────────────────────────
  {
    id: 'qv2-peds-bd-1',
    domainId: 'boundaries',
    competencies: ['compliance', 'riskManagement', 'customerHandling'],
    scenario:
      'A parent asks you to read back their child’s recent test results over the phone. What do you do?',
    options: [
      { id: 'a', text: 'Read the results once they verify the child’s date of birth.', points: 0,
        rationale: 'Results are never conveyed by the navigator, even after identity is verified — a scope violation.' },
      { id: 'b', text: 'Explain you cannot share results, and create a TE to the PEDS Encounters queue so the clinical team calls back with them.', points: 100,
        rationale: 'Correct: navigators never convey or interpret results; the TE gets the parent a proper clinical answer.' },
      { id: 'c', text: 'Summarize the results in plain language so it is easier to understand.', points: 5,
        rationale: 'Still conveying medical results — the same violation in softer words.' },
      { id: 'd', text: 'Tell her the results will be mailed and end the call.', points: 25,
        rationale: 'Avoids the phone violation but drops the clinical follow-up the parent needs.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-peds-bd-2',
    domainId: 'boundaries',
    competencies: ['compliance', 'customerHandling', 'communication'],
    scenario:
      'A parent insists their child needs a physical three months early for camp and asks you to promise the provider will approve the exception. What do you do?',
    options: [
      { id: 'a', text: 'Promise it — the provider almost always approves camp requests.', points: 0,
        rationale: 'Navigators never promise approvals; if the provider declines, the promise becomes the practice’s problem.' },
      { id: 'b', text: 'Explain you cannot approve exceptions or speak for the provider, and offer the legitimate path — route the request for provider review or book the earliest compliant date.', points: 100,
        rationale: 'Correct: approving exceptions and promising outcomes are both outside scope; offer the real path without overcommitting.' },
      { id: 'c', text: 'Quietly book the early physical — a camp form is a good reason.', points: 5,
        rationale: 'An unauthorized exception that also risks a claim denial under the physical-timing rules.' },
      { id: 'd', text: 'Say no and end the call — rules are rules.', points: 30,
        rationale: 'Correctly refuses to promise, but leaves the parent with no path forward.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-peds-bd-3',
    domainId: 'boundaries',
    competencies: ['compliance', 'riskManagement', 'customerHandling'],
    scenario:
      'A caller identifies herself as the child’s grandmother and asks what happened at yesterday’s visit and what the doctor prescribed. What do you do?',
    options: [
      { id: 'a', text: 'Share it — she is immediate family.', points: 0,
        rationale: 'Family relationship alone does not authorize access to visit details or prescriptions.' },
      { id: 'b', text: 'Check whether she is an authorized contact; if not, courteously decline to share details and offer to take a message or have the authorized parent call.', points: 100,
        rationale: 'Correct: information goes only to authorized callers; declining with a path forward protects privacy without abandoning her.' },
      { id: 'c', text: 'Confirm just the prescription — that one detail seems harmless.', points: 5,
        rationale: 'A prescription is protected clinical information; "just one detail" is still a disclosure.' },
      { id: 'd', text: 'Refuse and end the call immediately.', points: 20,
        rationale: 'Protects privacy but with no courtesy and no path for a possibly legitimate caregiver.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-peds-bd-4',
    domainId: 'boundaries',
    competencies: ['compliance', 'escalation', 'riskManagement'],
    scenario:
      'A parent asks you directly whether she should give her feverish toddler over-the-counter ibuprofen, and how much. What do you do?',
    options: [
      { id: 'a', text: 'Give her the standard weight-based ibuprofen dosing so she can treat the fever now.', points: 0,
        rationale: 'Dosing guidance is clinical advice — outside navigator scope even for common OTC medication.' },
      { id: 'b', text: 'Explain you cannot give medication advice, and route the dosing question as a clinical question for a clinician callback.', points: 100,
        rationale: 'Correct: classify it as a clinical question and route it; the answer comes from clinical staff.' },
      { id: 'c', text: 'Tell her to just read the label and follow it.', points: 15,
        rationale: 'Restating dosing guidance, even by deferring to the label, is still stepping into clinical territory.' },
      { id: 'd', text: 'Book a same-day sick visit and answer nothing about the medication.', points: 40,
        rationale: 'Declining to advise is right, but a sick visit alone leaves the dosing question unrouted and unanswered.' },
    ],
    correctOptionId: 'b',
  },

  // ── documentation ────────────────────────────────────────────────────────────
  {
    id: 'qv2-peds-doc-1',
    domainId: 'documentation',
    competencies: ['sopKnowledge', 'compliance', 'sopApplication'],
    scenario:
      'You are entering a nursing service at the Baker Town location. What is the correct way to enter it so it routes to the right site?',
    options: [
      { id: 'a', text: 'Use the standard "Peds Lab" / "Ped Nurse" designation, the same as Forest Road.', points: 15,
        rationale: 'Reusing Forest Road’s designation breaks Baker Town’s distinct site routing.' },
      { id: 'b', text: 'Use the "BK" prefix (e.g., "BK Peds Lab") so the site routing stays distinct.', points: 100,
        rationale: 'Correct per SOP: Baker Town uses the "BK" prefix to keep its routing distinct.' },
      { id: 'c', text: 'Use the "208" prefix.', points: 10,
        rationale: '"208" is Blooming Grove (Route 208), not Baker Town.' },
      { id: 'd', text: 'No prefix is needed; the system sorts by address.', points: 10,
        rationale: 'Routing is by site prefix, not address — omitting it misroutes the service.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-peds-doc-2',
    domainId: 'documentation',
    competencies: ['sopApplication', 'communication', 'problemResolution'],
    scenario:
      'You are writing the TE for a refill request. Which documentation is complete enough for the provider to act on the first read?',
    options: [
      { id: 'a', text: 'Medication name and dosage, prescribing provider (from the e-prescription log), preferred pharmacy, callback number — plus the priority flag if the child is out.', points: 100,
        rationale: 'Correct: every one of these fields is load-bearing, so the provider can act without a callback loop.' },
      { id: 'b', text: 'Just the medication name — the provider can look up the rest.', points: 20,
        rationale: 'Every missing field becomes a delay while the provider chases pharmacy and contact details.' },
      { id: 'c', text: '"Needs refill, please call patient."', points: 5,
        rationale: 'Contains no actionable information and guarantees a second round-trip.' },
      { id: 'd', text: 'Pharmacy and callback number, since those change most often.', points: 15,
        rationale: 'Without the medication and prescriber, the request itself is undefined.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-peds-doc-3',
    domainId: 'documentation',
    competencies: ['communication', 'sopApplication'],
    scenario:
      'You are booking a same-day sick visit for a child with fever and cough. Which reason-field entry is correct?',
    options: [
      { id: 'a', text: '"FEVER + COUGH since last night, per mom" — all reported symptoms, in the reason section.', points: 100,
        rationale: 'Correct per SOP: write all reported symptoms in the reason section so the provider walks in prepared.' },
      { id: 'b', text: '"Sick."', points: 10,
        rationale: 'Tells the provider nothing; the symptoms belong in the reason field.' },
      { id: 'c', text: '"Parent called."', points: 5,
        rationale: 'Documents the call, not the clinical reason for the visit.' },
      { id: 'd', text: 'Put the symptoms in General Notes and leave the reason field blank.', points: 30,
        rationale: 'Right content, wrong field — the reason section is what the schedule and provider read.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-peds-doc-4',
    domainId: 'documentation',
    competencies: ['riskManagement', 'sopApplication', 'communication'],
    scenario:
      'You have just handled a call where a parent booked a sick visit for one child and requested a refill for a sibling. How do you finish the documentation?',
    options: [
      { id: 'a', text: 'Record each request in its own child’s chart — the sick visit under the child who is ill and the refill under the sibling — so nothing crosses charts.', points: 100,
        rationale: 'Correct: per-child documentation keeps each record accurate and prevents a wrong-chart entry.' },
      { id: 'b', text: 'Document both requests in the chart of whichever child you opened first.', points: 0,
        rationale: 'Merging siblings’ requests into one chart is a wrong-chart records error.' },
      { id: 'c', text: 'Write the whole call in the parent’s account notes instead of the children’s charts.', points: 10,
        rationale: 'Clinical requests must live in the patient’s chart, not a parent-level note that no clinician works from.' },
      { id: 'd', text: 'Document the sick visit in the ill child’s chart and add the refill as a note there too, to keep the call together.', points: 40,
        rationale: 'Keeps the sick visit right, but the refill still belongs in the sibling’s chart, not the ill child’s.' },
    ],
    correctOptionId: 'a',
  },
];

// ══ OB/GYN ═══════════════════════════════════════════════════════════════════
//
// SANITIZED: generic role labels only (OB Portal, PSS OB, MFM coordinator/MFM
// nurse, PSS Queue). No real provider names, phone numbers, or portal
// credentials. Routing follows the current floor rules already encoded in the
// OB/GYN seed bank: pregnant/pregnancy-related → OB Portal; non-pregnant GYN
// visit issue → PSS OB; established MFM patient → the MFM coordinator.

const OBGYN = [
  // ── intake ─────────────────────────────────────────────────────────────────
  {
    id: 'qv2-obgyn-intake-1',
    domainId: 'intake',
    competencies: ['sopApplication', 'riskManagement'],
    scenario:
      'A woman calls the OB/GYN line about her own care, and the first search result does not clearly match her. What is the safest next step before you discuss or change anything?',
    options: [
      { id: 'a', text: 'Confirm enough identifiers to match the correct patient before opening or discussing the chart, using another identifier if the first search was ambiguous.', points: 100,
        rationale: 'Correct: the key issue is preventing wrong-chart access; keep verifying until the exact patient is confirmed.' },
      { id: 'b', text: 'Open the closest-looking chart so the call keeps moving, and correct it later if needed.', points: 0,
        rationale: 'Moving ahead in a maybe-right chart is a privacy and records error.' },
      { id: 'c', text: 'Read details from the possible charts so the caller can tell you which one is hers.', points: 5,
        rationale: 'Reading chart details before identity is confirmed creates the privacy breach you are trying to avoid.' },
      { id: 'd', text: 'Create a new chart since the first search was not obvious.', points: 10,
        rationale: 'A duplicate chart is not safer than correctly verifying the existing patient.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-obgyn-intake-2',
    domainId: 'intake',
    competencies: ['riskManagement', 'compliance', 'criticalThinking'],
    scenario:
      'Your search returns two patients with the same first and last name. What do you do before discussing anything about the account?',
    options: [
      { id: 'a', text: 'Open the chart with the most recent activity — that is almost always the caller.', points: 5,
        rationale: '"Almost always" is how wrong-chart errors happen; recency proves nothing about identity.' },
      { id: 'b', text: 'Verify date of birth (and address or phone if still ambiguous) to confirm the exact patient before opening or discussing either chart.', points: 100,
        rationale: 'Correct: confirm a distinguishing identifier before opening either chart — a wrong-chart disclosure is a privacy breach.' },
      { id: 'c', text: 'Read both records’ details aloud and ask the caller which one is hers.', points: 0,
        rationale: 'Reading another patient’s details to the caller is itself the privacy breach.' },
      { id: 'd', text: 'Proceed with the first result and correct the record later if it turns out wrong.', points: 0,
        rationale: 'Working in the wrong chart contaminates two patients’ records and may disclose protected information.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-obgyn-intake-3',
    domainId: 'intake',
    competencies: ['compliance', 'riskManagement', 'customerHandling'],
    scenario:
      'A caller says she is the patient’s sister and asks you to reschedule an upcoming appointment — and also asks what the appointment is for. What do you do?',
    options: [
      { id: 'a', text: 'Reschedule it and explain the visit was a pregnancy-confirmation appointment so she understands the timing.', points: 0,
        rationale: 'The appointment reason is protected information; disclosing it to an unauthorized third party is a privacy breach.' },
      { id: 'b', text: 'Confirm whether she is authorized on the account; if not, do not disclose the appointment reason or make account changes, and offer to have the patient call.', points: 100,
        rationale: 'Correct: account changes and the visit reason go only to an authorized caller — protect the boundary and offer a path forward.' },
      { id: 'c', text: 'Reschedule the appointment but decline to say what it is for.', points: 40,
        rationale: 'Withholding the reason is right, but taking an account action for an unauthorized caller still crosses the authorization boundary.' },
      { id: 'd', text: 'Refuse everything and hang up.', points: 20,
        rationale: 'Protects privacy but abandons a possibly legitimate caller with no path forward.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-obgyn-intake-4',
    domainId: 'intake',
    competencies: ['riskManagement', 'criticalThinking', 'sopApplication'],
    scenario:
      'A patient calls to update her last name after marrying. Her chart still shows her maiden name, and there is a different patient already in the system under her new married name. How do you proceed?',
    options: [
      { id: 'a', text: 'Confirm her identity on the existing chart (for example by date of birth) and update the name there — do not use the different same-named patient’s chart or create a duplicate.', points: 100,
        rationale: 'Correct: update the verified existing chart; the same-named record belongs to a different patient and a new chart would duplicate her.' },
      { id: 'b', text: 'Open the chart that already matches her new married name and work from there.', points: 20,
        rationale: 'That chart is a different patient — editing it is a wrong-chart error.' },
      { id: 'c', text: 'Create a fresh chart under the married name so the record is current.', points: 0,
        rationale: 'A duplicate chart splits her history across two records.' },
      { id: 'd', text: 'Change nothing and ask her to bring ID to her next visit.', points: 40,
        rationale: 'Safe against a wrong edit, but she can be verified now, so it needlessly defers a routine update.' },
    ],
    correctOptionId: 'a',
  },

  // ── classification ───────────────────────────────────────────────────────────
  {
    id: 'qv2-obgyn-cls-1',
    domainId: 'classification',
    competencies: ['criticalThinking', 'riskManagement', 'escalation'],
    scenario:
      'A patient at 28 weeks calls about new swelling in her hands and face since yesterday, and also mentions she wants to move next week’s appointment. How do you classify and sequence this call?',
    options: [
      { id: 'a', text: 'As a scheduling call — move the appointment and suggest she mention the swelling at the visit.', points: 0,
        rationale: 'New facial swelling in the third trimester is a clinical red flag; treating it as a footnote to a reschedule delays evaluation.' },
      { id: 'b', text: 'The symptom takes priority: route it for immediate clinical assessment per the pregnancy-symptom protocol, then handle the reschedule.', points: 100,
        rationale: 'Correct: classify and route the clinical symptom first — never judged by the navigator, never buried under the routine request.' },
      { id: 'c', text: 'Reassure her that swelling is normal in pregnancy and process the reschedule.', points: 0,
        rationale: 'Deciding a symptom is "normal" is clinical judgement, outside navigator scope.' },
      { id: 'd', text: 'Tell her to go straight to Labor and Delivery and end the call.', points: 40,
        rationale: 'Erring urgent beats dismissing, but the SOP path is to route for clinical assessment — and the reschedule is dropped.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-obgyn-cls-2',
    domainId: 'classification',
    competencies: ['criticalThinking', 'sopApplication', 'customerHandling'],
    scenario:
      'A patient calls saying she just got a positive home pregnancy test and asks what she should do next. How do you classify this call?',
    options: [
      { id: 'a', text: 'As a scheduling request — book a confirmation-of-pregnancy visit per the scheduling protocol.', points: 100,
        rationale: 'Correct: a positive home test maps to the confirmation-of-pregnancy appointment type — a standard scheduling workflow.' },
      { id: 'b', text: 'As a clinical question — send a TE asking the clinical team what she should do.', points: 20,
        rationale: 'No clinical input is needed; the SOP already defines the next step as a bookable visit.' },
      { id: 'c', text: 'As urgent — direct her to Labor and Delivery.', points: 5,
        rationale: 'A positive test with no symptoms is routine, not an emergency.' },
      { id: 'd', text: 'Advise her to retest in two weeks before booking anything.', points: 0,
        rationale: 'Testing advice is clinical guidance, outside navigator scope.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-obgyn-cls-3',
    domainId: 'classification',
    competencies: ['criticalThinking', 'sopApplication', 'riskManagement'],
    scenario:
      'A non-pregnant patient calls about heavy, painful periods and asks for "the pregnancy nurse." How do you classify her request?',
    options: [
      { id: 'a', text: 'As a non-pregnant GYN visit issue — route it down the GYN path (PSS OB), not the pregnancy queue, despite what she called it.', points: 100,
        rationale: 'Correct: classify by the actual request, not the caller’s label — this is a GYN issue, not pregnancy-related.' },
      { id: 'b', text: 'As a pregnancy-related issue and route it to the OB Portal because she asked for the pregnancy nurse.', points: 20,
        rationale: 'Taking the caller’s label at face value misclassifies a non-pregnant GYN concern.' },
      { id: 'c', text: 'As a clinical question about her symptoms — advise her on what heavy periods might mean, then route.', points: 0,
        rationale: 'Interpreting symptoms is clinical advice, outside navigator scope.' },
      { id: 'd', text: 'As an established MFM matter and send it to the MFM coordinator.', points: 10,
        rationale: 'MFM is for established high-risk patients; this is a routine GYN issue.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-obgyn-cls-4',
    domainId: 'classification',
    competencies: ['criticalThinking', 'compliance', 'problemResolution'],
    scenario:
      'A pregnant patient calls asking what her recent prenatal lab result means, and in the same call asks to schedule her anatomy scan. How do you classify the call?',
    options: [
      { id: 'a', text: 'As two workflows: route the result question as a clinical TE for a callback (you do not interpret it), and book the anatomy scan per the scheduling protocol.', points: 100,
        rationale: 'Correct: a result question and a scheduling request are distinct; results are never interpreted by the navigator.' },
      { id: 'b', text: 'Read her the result, reassure her, then book the scan.', points: 0,
        rationale: 'Interpreting a lab result is a scope violation regardless of intent.' },
      { id: 'c', text: 'Book the anatomy scan and tell her the result will be covered at that visit.', points: 40,
        rationale: 'Books correctly and avoids reading the result, but assumes the visit will address it and drops the clinical follow-up.' },
      { id: 'd', text: 'Send one TE to the clinical team covering both the result and the scan booking.', points: 30,
        rationale: 'The result belongs in a clinical TE, but the scan is a scheduling task, not a clinical callback.' },
    ],
    correctOptionId: 'a',
  },

  // ── routing ────────────────────────────────────────────────────────────────
  {
    id: 'qv2-obgyn-rt-1',
    domainId: 'routing',
    competencies: ['sopKnowledge', 'sopApplication'],
    scenario:
      'A new OB patient calls to schedule her first prenatal appointment. Which path should you use to enter the booking request?',
    options: [
      { id: 'a', text: 'Enter it directly on the provider’s personal schedule without using a queue.', points: 10,
        rationale: 'Bypassing the designated queue removes the booking from central tracking and creates routing gaps.' },
      { id: 'b', text: 'Place the request in the PSS (Patient Scheduling Services) Queue, the intake path for OB appointments.', points: 100,
        rationale: 'Correct per SOP: new and return OB appointment requests route through the PSS Queue.' },
      { id: 'c', text: 'Send a Telephone Encounter to the nursing lead and wait for a callback.', points: 20,
        rationale: 'Nursing TEs handle clinical questions; scheduling goes through the PSS Queue.' },
      { id: 'd', text: 'Route it through the Prevention Coordinator since it is a first visit.', points: 15,
        rationale: 'The Prevention Coordinator handles wellness/GYN screenings, not prenatal scheduling.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-obgyn-rt-2',
    domainId: 'routing',
    competencies: ['sopKnowledge', 'sopApplication', 'escalation'],
    scenario:
      'A pregnant patient has a pregnancy-related question that needs clinical follow-up. Where does the Telephone Encounter go?',
    options: [
      { id: 'a', text: 'To PSS OB.', points: 25,
        rationale: 'PSS OB is the destination for non-pregnant GYN visit issues, not pregnancy questions.' },
      { id: 'b', text: 'To the OB Portal — the queue for pregnant patients and pregnancy-related issues.', points: 100,
        rationale: 'Correct per current floor routing: a pregnancy-related issue goes to the OB Portal.' },
      { id: 'c', text: 'To the MFM coordinator.', points: 15,
        rationale: 'The MFM coordinator owns established MFM (high-risk) patients only.' },
      { id: 'd', text: 'Directly to the patient’s OB provider.', points: 20,
        rationale: 'Provider-direct TE assignment is another department’s model; OB pregnancy questions go to the OB Portal queue.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-obgyn-rt-3',
    domainId: 'routing',
    competencies: ['sopKnowledge', 'escalation'],
    scenario:
      'An established MFM (high-risk) patient calls with a question about her MFM care plan. Who gets the TE?',
    options: [
      { id: 'a', text: 'The OB Portal, like any pregnancy-related question.', points: 30,
        rationale: 'A believable near-miss, but established MFM patients have a dedicated owner; the general queue adds a hop.' },
      { id: 'b', text: 'The MFM coordinator only — established MFM patients route to their dedicated owner.', points: 100,
        rationale: 'Correct per current floor routing: established MFM patient questions go to the MFM coordinator.' },
      { id: 'c', text: 'PSS OB.', points: 10,
        rationale: 'PSS OB handles non-pregnant GYN visit issues — the wrong lane for MFM care.' },
      { id: 'd', text: 'Whichever nurse answers first.', points: 15,
        rationale: 'MFM routing is owner-specific by design; ad-hoc assignment loses high-risk continuity.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-obgyn-rt-4',
    domainId: 'routing',
    competencies: ['escalation', 'riskManagement', 'sopApplication'],
    scenario:
      'A patient at 34 weeks calls saying she has not felt the baby move since last night — roughly 18 hours ago — and has had no bleeding. What do you do?',
    options: [
      { id: 'a', text: 'Schedule her for a routine visit later this week so the provider can check.', points: 0,
        rationale: 'Decreased fetal movement is a potential emergency; a routine visit delays critical monitoring.' },
      { id: 'b', text: 'Direct her to go to Labor and Delivery immediately for monitoring — decreased fetal movement requires urgent evaluation.', points: 100,
        rationale: 'Correct per SOP: decreased fetal movement at this gestation requires immediate L&D triage, never a routine appointment.' },
      { id: 'c', text: 'Send a TE to the nursing team and tell her to call back if it does not improve.', points: 5,
        rationale: 'A deferred TE is insufficient for a symptom that requires immediate evaluation.' },
      { id: 'd', text: 'Tell her to drink something cold and do a kick count, then call back.', points: 10,
        rationale: 'Kick-count coaching is clinical advice, and the duration already warrants immediate evaluation.' },
    ],
    correctOptionId: 'b',
  },

  // ── scheduling ───────────────────────────────────────────────────────────────
  {
    id: 'qv2-obgyn-sc-1',
    domainId: 'scheduling',
    competencies: ['sopKnowledge', 'sopApplication', 'customerHandling'],
    scenario:
      'A patient with a positive home pregnancy test thinks she is about 6 weeks along and wants her first OB appointment. When should you schedule her?',
    options: [
      { id: 'a', text: 'Immediately — the sooner the first visit, the better, regardless of gestational age.', points: 20,
        rationale: 'A too-early visit may be unable to confirm a heartbeat and cause needless worry; there is an optimal window.' },
      { id: 'b', text: 'For when she will be between 8 and 12 weeks — the standard first prenatal visit window.', points: 100,
        rationale: 'Correct per SOP: the first OB appointment falls in the 8–12 week window for dating and viability confirmation.' },
      { id: 'c', text: 'In the second trimester (13+ weeks), when the pregnancy is more established.', points: 5,
        rationale: 'Waiting that long misses critical first-trimester screening windows.' },
      { id: 'd', text: 'Any available slot this week, since she is already 6 weeks.', points: 25,
        rationale: 'Six weeks is slightly early for the standard first prenatal visit; 8–12 weeks is the target.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-obgyn-sc-2',
    domainId: 'scheduling',
    competencies: ['sopKnowledge', 'compliance', 'sopApplication'],
    scenario:
      'A pregnant patient at 22 weeks asks when to schedule her glucose challenge test (GCT) for gestational diabetes screening. What is the correct window?',
    options: [
      { id: 'a', text: 'Between 16 and 20 weeks — the earlier the better.', points: 10,
        rationale: 'Too early; a 16–20 week GCT is premature and may miss glucose intolerance that develops later.' },
      { id: 'b', text: 'Between 24 and 29 weeks, the standard GCT screening window.', points: 100,
        rationale: 'Correct per SOP: the GCT is scheduled at 24–29 weeks.' },
      { id: 'c', text: 'At 30–34 weeks, when gestational diabetes is most likely to appear.', points: 15,
        rationale: 'Scheduling that late misses the screening window and delays any needed management.' },
      { id: 'd', text: 'Only if the provider specifically orders it; it is not routine.', points: 5,
        rationale: 'The GCT is a routine part of prenatal care, not ordered only for selected patients.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-obgyn-sc-3',
    domainId: 'scheduling',
    competencies: ['sopKnowledge', 'sopApplication', 'riskManagement'],
    scenario:
      'A pregnant patient at 35 weeks asks when to come in for her Group B Strep (GBS) test. When should you schedule it?',
    options: [
      { id: 'a', text: 'At 32–33 weeks, to allow time to treat if positive.', points: 10,
        rationale: 'Too early; GBS status can change, so testing is timed to 36–37 weeks.' },
      { id: 'b', text: 'Between 36 and 37 weeks.', points: 100,
        rationale: 'Correct per SOP: GBS testing is scheduled at 36–37 weeks so the result reflects status near delivery.' },
      { id: 'c', text: 'Only when she is admitted for labour.', points: 5,
        rationale: 'In-office testing at 36–37 weeks is standard; waiting for admission leaves no time for outpatient treatment.' },
      { id: 'd', text: 'At 38–40 weeks, at the same time as the non-stress test.', points: 15,
        rationale: 'GBS and the NST have different windows; GBS is done at 36–37 weeks.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-obgyn-sc-4',
    domainId: 'scheduling',
    competencies: ['sopKnowledge', 'compliance', 'customerHandling'],
    scenario:
      'A patient requesting an IUD insertion asks whether she can see any provider for the procedure. What do you tell her?',
    options: [
      { id: 'a', text: 'Yes — every OB/GYN provider in the department performs IUD insertions.', points: 5,
        rationale: 'IUD insertion is a credentialed procedure; not all providers are authorized.' },
      { id: 'b', text: 'Only specific providers are credentialed for IUD insertions — check which ones are authorized and book accordingly.', points: 100,
        rationale: 'Correct per SOP: IUD insertion is limited to credentialed providers; verify before booking.' },
      { id: 'c', text: 'Yes — any nurse practitioner or PA can do it as a minor procedure.', points: 10,
        rationale: 'Credentialing attaches to the specific procedure, not the general provider type.' },
      { id: 'd', text: 'IUD insertions are handled by the nursing lead, not the providers.', points: 10,
        rationale: 'Nursing staff do not perform IUD insertions; it is a provider procedure.' },
    ],
    correctOptionId: 'b',
  },

  // ── boundaries ───────────────────────────────────────────────────────────────
  {
    id: 'qv2-obgyn-bd-1',
    domainId: 'boundaries',
    competencies: ['compliance', 'escalation', 'sopKnowledge'],
    scenario:
      'A patient asks what her recent prenatal lab results mean. Her provider has not called yet and she is worried. What do you do?',
    options: [
      { id: 'a', text: 'Read her the results and briefly explain the values to ease her worry.', points: 0,
        rationale: 'Conveying or interpreting lab results is a clinical act — a strict scope violation.' },
      { id: 'b', text: 'Let her know you cannot share results by phone, and create a TE to the clinical team so a nurse or provider calls her back with them.', points: 100,
        rationale: 'Correct per SOP: results are never communicated by the front line; the TE routes her to the right clinical owner.' },
      { id: 'c', text: 'Transfer her to the nursing lead to read her the values.', points: 40,
        rationale: 'Better than reading them yourself, but a TE is the correct pathway so the right owner follows up with context.' },
      { id: 'd', text: 'Tell her the results look normal if they look normal in the system.', points: 0,
        rationale: 'Any interpretation — even "they look normal" — is a clinical act outside scope.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-obgyn-bd-2',
    domainId: 'boundaries',
    competencies: ['compliance', 'riskManagement', 'communication'],
    scenario:
      'A man calls saying he is a patient’s husband and asks whether her pregnancy test came back positive. What do you do?',
    options: [
      { id: 'a', text: 'Confirm the result — he is her husband and it is good news.', points: 0,
        rationale: 'Marital status does not authorize disclosure; results go to the patient through the clinical pathway.' },
      { id: 'b', text: 'Explain you cannot share any patient information with a third party without documented authorization, and offer to take a message.', points: 100,
        rationale: 'Correct: no confirmation of results to an unauthorized caller; a message keeps it courteous without disclosing anything.' },
      { id: 'c', text: 'Check whether he is listed as her spouse and share the result if he is.', points: 15,
        rationale: 'A listed relationship is demographic data, not disclosure authorization — and results are not shared by phone regardless.' },
      { id: 'd', text: 'Say "you didn’t hear it from me, but congratulations."', points: 0,
        rationale: 'A disclosure with a wink is still a disclosure — and also a results communication.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-obgyn-bd-3',
    domainId: 'boundaries',
    competencies: ['compliance', 'escalation', 'riskManagement'],
    scenario:
      'A pregnant patient asks you directly whether it is safe to take a specific over-the-counter cold medicine. What do you do?',
    options: [
      { id: 'a', text: 'Tell her whether that medication is generally considered safe in pregnancy so she can decide.', points: 0,
        rationale: 'Advising on medication safety in pregnancy is clinical advice, outside navigator scope.' },
      { id: 'b', text: 'Explain you cannot give medication advice, and route the question as a clinical question for a clinician to answer.', points: 100,
        rationale: 'Correct: classify it as a clinical question and route it; the answer comes from clinical staff.' },
      { id: 'c', text: 'Suggest she just avoid all medications to be safe.', points: 10,
        rationale: '"Avoid everything" is still clinical advice, and it may be wrong for her situation.' },
      { id: 'd', text: 'Tell her to look it up on a reputable pregnancy website.', points: 15,
        rationale: 'Deflecting to a website still substitutes for the clinical answer she should get through a routed question.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'qv2-obgyn-bd-4',
    domainId: 'boundaries',
    competencies: ['compliance', 'customerHandling', 'communication'],
    scenario:
      'A patient pressures you to "just squeeze me in this week and promise the doctor will approve" an early procedure. What do you do?',
    options: [
      { id: 'a', text: 'Promise it and book the early slot — the provider usually says yes.', points: 0,
        rationale: 'Navigators never promise approvals; if the provider declines, the promise becomes the practice’s problem.' },
      { id: 'b', text: 'Explain you cannot promise an approval or speak for the provider, and offer the real path — route the request for provider review or book the earliest appropriate date.', points: 100,
        rationale: 'Correct: don’t overcommit; offer the legitimate path that keeps her moving without a false promise.' },
      { id: 'c', text: 'Book the early slot quietly and let the provider sort it out at the visit.', points: 5,
        rationale: 'Booking outside the rules on an unpromised approval is an unauthorized exception.' },
      { id: 'd', text: 'Tell her it is not possible and end the call.', points: 30,
        rationale: 'Correctly refuses to promise, but leaves her with no path forward.' },
    ],
    correctOptionId: 'b',
  },

  // ── documentation ────────────────────────────────────────────────────────────
  {
    id: 'qv2-obgyn-doc-1',
    domainId: 'documentation',
    competencies: ['communication', 'sopApplication', 'problemResolution'],
    scenario:
      'You are writing the TE for a pregnant patient’s clinical question. Which documentation is complete?',
    options: [
      { id: 'a', text: 'Gestational age (or due date), the specific question or symptoms with onset, a callback number, assigned to the OB Portal.', points: 100,
        rationale: 'Correct: gestational age changes what almost every OB question means; symptoms with onset, callback, and the right queue let the nurse act on the first read.' },
      { id: 'b', text: '"Patient has a question, please call back," assigned to the OB Portal.', points: 5,
        rationale: 'Right queue, but no gestational age, question, or callback — the nurse has to redo the whole intake.' },
      { id: 'c', text: 'The symptoms only, assigned to the OB Portal — her chart has the rest.', points: 30,
        rationale: 'Better, but omitting gestational age and callback forces chart-digging and delays the response.' },
      { id: 'd', text: 'Write the details in General Notes on her chart instead of a TE.', points: 10,
        rationale: 'General Notes is not a work queue — nothing routes to a clinician, so no one follows up.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-obgyn-doc-2',
    domainId: 'documentation',
    competencies: ['sopApplication', 'communication', 'compliance'],
    scenario:
      'A patient asks to refill a routine prescription. How do you document and route it?',
    options: [
      { id: 'a', text: 'Capture the medication name, preferred pharmacy, callback number, and whether she is out, route it to the correct clinical queue, and make no promise about whether or when it will be approved.', points: 100,
        rationale: 'Correct: a complete, routed refill request with no promised approval and no medication advice.' },
      { id: 'b', text: 'Tell her the provider will approve and send it to the pharmacy today, then note "refill sent."', points: 0,
        rationale: 'Promises an approval and an outcome the navigator cannot guarantee.' },
      { id: 'c', text: 'Note "patient wants a refill" and route it to the clinical queue.', points: 30,
        rationale: 'Right queue, but missing medication, pharmacy, callback, and out-of-medication status forces a callback loop.' },
      { id: 'd', text: 'Give her the standard dosing while you are at it, then route the refill.', points: 10,
        rationale: 'Routing is fine, but volunteering dosing is medication advice outside scope.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-obgyn-doc-3',
    domainId: 'documentation',
    competencies: ['communication', 'riskManagement', 'sopApplication'],
    scenario:
      'A pregnant patient asks to reschedule because she has had a new symptom and is not sure it can wait. You are routing the symptom clinically and moving the appointment. How do you document it?',
    options: [
      { id: 'a', text: 'Record the specific symptom and its onset with a callback number in the clinical TE, and note the reschedule separately — so the clinical follow-up is not lost.', points: 100,
        rationale: 'Correct: the symptom, onset, and callback drive the clinical follow-up; the reschedule is a separate scheduling action.' },
      { id: 'b', text: 'Note "patient called to reschedule" and move the appointment.', points: 0,
        rationale: 'A vague reschedule note buries a clinical symptom and no one follows up on it.' },
      { id: 'c', text: 'Add "had a symptom, rescheduled" to the appointment and leave it there.', points: 30,
        rationale: 'Captures more, but without onset, a callback, or a clinical TE the symptom still has no owner.' },
      { id: 'd', text: 'Route the symptom clinically but skip documenting it since you already moved the appointment.', points: 20,
        rationale: 'Routing without documenting onset and callback leaves the clinical team without what it needs to act.' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'qv2-obgyn-doc-4',
    domainId: 'documentation',
    competencies: ['riskManagement', 'compliance', 'sopApplication'],
    scenario:
      'You have just verified which of two same-named patients you are speaking with and now need to document her clinical question. How do you make sure it lands correctly?',
    options: [
      { id: 'a', text: 'Enter the TE in the verified patient’s chart and include identifying details, so the note cannot be confused with the same-named patient’s record.', points: 100,
        rationale: 'Correct: documenting in the verified chart with identifiers prevents a wrong-chart entry between two same-named patients.' },
      { id: 'b', text: 'Enter the note in whichever of the two charts is already open on your screen.', points: 0,
        rationale: 'Without confirming it is the verified patient’s chart, this risks documenting on the wrong same-named record.' },
      { id: 'c', text: 'Write the note in both same-named charts so it is not missed.', points: 10,
        rationale: 'Documenting a patient’s question in another patient’s chart is a privacy and records error.' },
      { id: 'd', text: 'Enter the TE in the verified chart but skip the identifying details to save time.', points: 40,
        rationale: 'Right chart, but omitting identifiers weakens the safeguard against a later same-name mix-up.' },
    ],
    correctOptionId: 'a',
  },
];

// Stamp department on every question (explicit + defensive).
for (const q of PEDS) q.department = 'pediatrics';
for (const q of OBGYN) q.department = 'obgyn';

export const V2_QUESTIONS_PEDS = PEDS;
export const V2_QUESTIONS_OBGYN = OBGYN;

// Combined v2 bank — consumed by the marker-gated Firestore migration in db.js.
export const ALL_V2_QUESTIONS = [...PEDS, ...OBGYN];

// The departments this bank replaces active generated/seed content for.
export const V2_DEPARTMENTS = ['pediatrics', 'obgyn'];

// Version tag shared by the migration marker + archive metadata.
export const V2_VERSION = 'mcq-v2-operating-model-2026-07';
