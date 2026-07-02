// ─────────────────────────────────────────────────────────────────────────────
// OB/GYN SEED QUESTIONS
//
// Derived from the Aizer Health OB/GYN Department SOP plus the current Patient
// Navigator role description (2026-07 floor rules: DOB-first lookup for adult
// departments; TE routing — pregnant/pregnancy-related → OB Portal, non-pregnant
// GYN visit issue → PSS OB, established MFM patient → the MFM coordinator).
//
// All scenarios are SANITIZED: faithful to the workflow but using generic role
// labels only ("the MFM nurse", "the MFM coordinator", "the sonography/MFM
// director"). NO real provider names, phone numbers, or external portal
// credentials appear anywhere in this file.
//
// These seed the Firestore `questions` collection on first run (alongside the
// Pediatrics seed) and serve as the offline fallback for the OB/GYN check.
// They map to the same shared DOMAIN IDs as the Pediatrics bank — the scoring
// and matrix pipeline is department-agnostic.
// ─────────────────────────────────────────────────────────────────────────────

export const SEED_QUESTIONS_OBGYN = [

  // ── Call Opening & Identification ──────────────────────────────────────────

  {
    id: 'q-obgyn-int-1',
    department: 'obgyn',
    domainId: 'intake',
    competencies: ['sopApplication', 'sopKnowledge'],
    scenario:
      'A woman calls the OB/GYN line about her own care. What do you ask for first to pull up her chart?',
    options: [
      { id: 'a', text: 'Her phone number first, to pull up linked family accounts.', points: 30,
        rationale: 'Phone-first is the Pediatrics flow (parents calling for children). Adult patients call for themselves — DOB-first is the standard.' },
      { id: 'b', text: 'Her date of birth first, then confirm her first and last name.', points: 100,
        rationale: 'Correct: in adult departments the patient is usually the caller, so DOB-first plus name confirmation is the standard verification flow.' },
      { id: 'c', text: 'Her last name only.', points: 15,
        rationale: 'Name-only search risks pulling the wrong patient — common and changed names collide.' },
      { id: 'd', text: 'Her insurance member ID.', points: 10,
        rationale: 'Insurance ID is not the chart lookup key and delays identification.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-int-2',
    department: 'obgyn',
    domainId: 'intake',
    competencies: ['riskManagement', 'compliance', 'criticalThinking'],
    scenario:
      'Your search returns two patients with the same first and last name. What do you do before discussing anything about the account?',
    options: [
      { id: 'a', text: 'Open the chart with the most recent activity — that is almost always the caller.', points: 5,
        rationale: '"Almost always" is how wrong-chart errors happen; recency proves nothing about identity.' },
      { id: 'b', text: 'Verify date of birth (and address or phone if still ambiguous) to confirm the exact patient before opening or discussing either chart.', points: 100,
        rationale: 'Correct: identity must be confirmed with a second identifier before any chart is opened or any detail discussed — a wrong-chart disclosure is a privacy breach.' },
      { id: 'c', text: 'Read both records\' details to the caller and ask which one is hers.', points: 0,
        rationale: 'Reading another patient\'s details to the caller IS the privacy breach you are trying to avoid.' },
      { id: 'd', text: 'Proceed with the first result and correct the record later if it turns out wrong.', points: 0,
        rationale: 'Working in the wrong chart contaminates two patients\' records and may disclose protected information.' },
    ],
    correctOptionId: 'b',
  },

  // ── Call Classification ────────────────────────────────────────────────────

  {
    id: 'q-obgyn-cls-1',
    department: 'obgyn',
    domainId: 'classification',
    competencies: ['criticalThinking', 'riskManagement', 'escalation'],
    scenario:
      'A patient at 28 weeks calls about new swelling in her hands and face since yesterday — and also mentions wanting to move next week\'s appointment. How do you classify and sequence this call?',
    options: [
      { id: 'a', text: 'A scheduling call — move the appointment, and suggest she mention the swelling at the visit.', points: 0,
        rationale: 'New facial swelling in the third trimester is a clinical red flag; treating it as a footnote to a reschedule delays evaluation.' },
      { id: 'b', text: 'The symptom takes priority: route it for immediate clinical assessment per the pregnancy-symptom protocol, then handle the reschedule.', points: 100,
        rationale: 'Correct: classify the clinical symptom first and route it urgently — the navigator never judges it, and never lets the routine request bury it. The scheduling piece is handled after.' },
      { id: 'c', text: 'Reassure her that swelling is normal in pregnancy and process the reschedule.', points: 0,
        rationale: 'Deciding a symptom is "normal" is clinical judgement — outside navigator scope regardless of how common the symptom is.' },
      { id: 'd', text: 'Tell her to go straight to Labor and Delivery and end the call.', points: 40,
        rationale: 'Erring urgent is safer than dismissing, but the SOP path is to route for clinical assessment — the clinical team, not the navigator, directs her to L&D if warranted. The reschedule is also dropped.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-cls-2',
    department: 'obgyn',
    domainId: 'classification',
    competencies: ['criticalThinking', 'sopApplication', 'customerHandling'],
    scenario:
      'A patient calls saying she just got a positive home pregnancy test and asks what she should do next. How do you classify this call?',
    options: [
      { id: 'a', text: 'A scheduling request — book a confirmation-of-pregnancy visit per the scheduling protocol.', points: 100,
        rationale: 'Correct: a positive home test maps to the confirmation-of-pregnancy appointment type — a standard scheduling workflow, not a clinical question or an emergency.' },
      { id: 'b', text: 'A clinical question — send a TE asking the clinical team what she should do.', points: 20,
        rationale: 'No clinical input is needed to know the next step; the SOP defines it as a bookable visit type.' },
      { id: 'c', text: 'Urgent — direct her to Labor and Delivery.', points: 5,
        rationale: 'A positive test with no symptoms is routine, not an emergency.' },
      { id: 'd', text: 'Advise her to retest in two weeks before booking anything.', points: 0,
        rationale: 'Testing advice is clinical guidance — outside navigator scope.' },
    ],
    correctOptionId: 'a',
  },

  // ── Routing & Escalation ───────────────────────────────────────────────────

  {
    id: 'q-obgyn-rt-1',
    department: 'obgyn',
    domainId: 'routing',
    competencies: ['sopKnowledge', 'sopApplication'],
    scenario:
      'A new OB patient calls to schedule her first prenatal appointment. Which internal queue or system should you use to enter her booking request?',
    options: [
      { id: 'a', text: 'Enter it directly in the provider\'s personal schedule without using a queue.', points: 10,
        rationale: 'Bypassing the designated queue creates routing gaps and removes the booking from the central tracking system.' },
      { id: 'b', text: 'Place the request in the PSS (Patient Scheduling Services) Queue, which is the correct intake path for OB appointments.', points: 100,
        rationale: 'Correct per SOP: new and return OB appointment requests route through the PSS Queue.' },
      { id: 'c', text: 'Send a Telephone Encounter to the nursing lead and wait for a callback.', points: 20,
        rationale: 'Nursing TEs handle clinical questions; scheduling goes through the PSS Queue.' },
      { id: 'd', text: 'Route it through the Prevention Coordinator since it is the patient\'s first visit.', points: 15,
        rationale: 'The Prevention Coordinator handles wellness and GYN screenings, not prenatal scheduling.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-rt-2',
    department: 'obgyn',
    domainId: 'routing',
    competencies: ['sopKnowledge', 'sopApplication', 'escalation'],
    scenario:
      'A pregnant patient has a pregnancy-related question that needs clinical follow-up. Where does the Telephone Encounter go?',
    options: [
      { id: 'a', text: 'To PSS OB.', points: 25,
        rationale: 'PSS OB is the destination for NON-pregnant GYN visit-related issues — not pregnancy questions.' },
      { id: 'b', text: 'Assign it to the OB Portal — the queue for pregnant patients and pregnancy-related issues.', points: 100,
        rationale: 'Correct per current floor routing: pregnant patient / pregnancy-related issue → OB Portal; non-pregnant GYN visit issue → PSS OB; established MFM patient → the MFM coordinator.' },
      { id: 'c', text: 'To the MFM coordinator.', points: 15,
        rationale: 'The MFM coordinator handles established MFM (high-risk) patients only.' },
      { id: 'd', text: 'Directly to the patient\'s OB provider.', points: 20,
        rationale: 'Provider-direct TE assignment is the Behavioral Health model, not the OB/GYN one — OB pregnancy questions go to the OB Portal queue.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-rt-3',
    department: 'obgyn',
    domainId: 'routing',
    competencies: ['sopKnowledge', 'escalation'],
    scenario:
      'An established MFM (high-risk) patient calls with a question about her MFM care plan. Who gets the TE?',
    options: [
      { id: 'a', text: 'The OB Portal, like any pregnancy-related question.', points: 30,
        rationale: 'Close — but established MFM patients have a dedicated owner; the general pregnancy queue adds a hop.' },
      { id: 'b', text: 'The MFM coordinator only — established MFM patients route to their dedicated owner.', points: 100,
        rationale: 'Correct per current floor routing: established MFM patient questions are assigned to the MFM coordinator, not the general queues.' },
      { id: 'c', text: 'PSS OB.', points: 10,
        rationale: 'PSS OB handles non-pregnant GYN visit issues — the wrong lane entirely for MFM care.' },
      { id: 'd', text: 'Whichever nurse answers first.', points: 15,
        rationale: 'MFM routing is owner-specific by design; ad-hoc assignment loses high-risk continuity.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-rt-4',
    department: 'obgyn',
    domainId: 'routing',
    competencies: ['sopKnowledge', 'escalation', 'riskManagement'],
    scenario:
      'A patient at 24 weeks is calling because her OB wants her to see a maternal-fetal medicine (MFM) specialist due to a high-risk complication. How do you handle the handoff?',
    options: [
      { id: 'a', text: 'Book her directly into an open MFM appointment slot without any additional steps.', points: 25,
        rationale: 'Booking without notifying the MFM nurse skips the clinical coordination step required for high-risk patients.' },
      { id: 'b', text: 'Route the call to the MFM nurse, who coordinates high-risk referrals and MFM scheduling.', points: 100,
        rationale: 'Correct per SOP: the MFM nurse is the designated owner for high-risk patient coordination and MFM referrals.' },
      { id: 'c', text: 'Tell the patient to call the MFM office directly.', points: 10,
        rationale: 'Sending the patient to self-navigate a specialist referral skips the department\'s coordination responsibility.' },
      { id: 'd', text: 'Send a TE to the OB\'s provider and wait for instructions.', points: 20,
        rationale: 'The OB already requested the referral; the MFM nurse is the next owner, not the referring OB.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-rt-5',
    department: 'obgyn',
    domainId: 'routing',
    competencies: ['escalation', 'riskManagement', 'sopApplication'],
    scenario:
      'A patient at 34 weeks calls saying she hasn\'t felt the baby move since last night — roughly 18 hours ago. She says she hasn\'t had any bleeding. What do you do?',
    options: [
      { id: 'a', text: 'Schedule her for a routine visit later this week so the provider can check.', points: 0,
        rationale: 'Decreased fetal movement is a potential emergency — scheduling a routine visit delays critical monitoring.' },
      { id: 'b', text: 'Direct her to go to Labor and Delivery immediately for monitoring; decreased fetal movement requires urgent evaluation.', points: 100,
        rationale: 'Correct per SOP: decreased fetal movement at or after viability always requires immediate L&D triage — never schedule a routine appointment.' },
      { id: 'c', text: 'Send a Telephone Encounter to the nursing team and tell her to call back if it doesn\'t improve.', points: 5,
        rationale: 'A TE for decreased fetal movement is insufficient — this symptom requires immediate, not deferred, evaluation.' },
      { id: 'd', text: 'Tell her to drink cold water or juice and do a kick count; call back if she counts fewer than 10 movements in an hour.', points: 10,
        rationale: 'Giving clinical advice on the phone about kick counts is outside navigator scope, and the symptom\'s duration warrants immediate evaluation.' },
    ],
    correctOptionId: 'b',
  },

  // ── Scheduling & Appointment Rules ─────────────────────────────────────────

  {
    id: 'q-obgyn-sc-1',
    department: 'obgyn',
    domainId: 'scheduling',
    competencies: ['sopKnowledge', 'sopApplication', 'customerHandling'],
    scenario:
      'A patient calls saying she just got a positive home pregnancy test and wants to schedule her first OB appointment. She thinks she is about 6 weeks along. When should you schedule her?',
    options: [
      { id: 'a', text: 'Schedule immediately — the sooner the first visit the better, regardless of gestational age.', points: 20,
        rationale: 'Very early visits may be too early to confirm a heartbeat and can cause unnecessary concern; first prenatal timing has an optimal window.' },
      { id: 'b', text: 'Schedule for when she will be between 8 and 12 weeks gestation — the standard first prenatal visit window.', points: 100,
        rationale: 'Correct per SOP: the first OB appointment should occur in the 8–12 week window to align with dating ultrasound and viability confirmation.' },
      { id: 'c', text: 'Wait until the second trimester (13+ weeks) when the pregnancy is more established.', points: 5,
        rationale: 'Waiting until the second trimester misses critical first-trimester screening windows.' },
      { id: 'd', text: 'Schedule for any available slot this week since she is already 6 weeks.', points: 25,
        rationale: 'Six weeks is slightly early for the standard first prenatal visit; 8–12 weeks is the target window.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-sc-2',
    department: 'obgyn',
    domainId: 'scheduling',
    competencies: ['sopKnowledge', 'compliance', 'sopApplication'],
    scenario:
      'A pregnant patient at 22 weeks calls asking when she should schedule her glucose challenge test (GCT) for gestational diabetes screening. What is the correct timing window?',
    options: [
      { id: 'a', text: 'Between 16 and 20 weeks — the earlier the better for screening.', points: 10,
        rationale: 'Too early — the GCT at 16–20 weeks is premature and may miss glucose intolerance that develops later.' },
      { id: 'b', text: 'Between 24 and 29 weeks gestation, per the standard GCT screening window.', points: 100,
        rationale: 'Correct per SOP: GCT is scheduled between 24–29 weeks, the standard gestational diabetes screening window.' },
      { id: 'c', text: 'At 30–34 weeks, when gestational diabetes is most likely to show up.', points: 15,
        rationale: 'Scheduling at 30–34 weeks misses the screening window and delays any needed management.' },
      { id: 'd', text: 'Only if the provider specifically orders it; it is not routinely offered.', points: 5,
        rationale: 'GCT is a routine part of prenatal care, not just ordered for selected patients.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-sc-3',
    department: 'obgyn',
    domainId: 'scheduling',
    competencies: ['sopKnowledge', 'sopApplication', 'riskManagement'],
    scenario:
      'A pregnant patient calls at 35 weeks asking when she should come in for her Group B Strep (GBS) test. When should you schedule it?',
    options: [
      { id: 'a', text: 'At 32–33 weeks — the earlier the better to allow time to treat if positive.', points: 10,
        rationale: 'Testing at 32–33 weeks is too early; GBS colonisation status can change, so timing to 36–37 weeks is standard.' },
      { id: 'b', text: 'Between 36 and 37 weeks gestation.', points: 100,
        rationale: 'Correct per SOP: GBS testing is scheduled at 36–37 weeks so the result reflects status at the time of delivery.' },
      { id: 'c', text: 'Only when she is admitted to the hospital for labour.', points: 5,
        rationale: 'In-office GBS testing at 36–37 weeks is standard; waiting until admission does not give time for outpatient treatment if needed.' },
      { id: 'd', text: 'At 38–40 weeks, the same time as the non-stress test.', points: 15,
        rationale: 'GBS and NST have different timing windows; GBS should be done at 36–37 weeks, not at 40 weeks.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-sc-4',
    department: 'obgyn',
    domainId: 'scheduling',
    competencies: ['sopKnowledge', 'compliance', 'customerHandling'],
    scenario:
      'A patient calls requesting an IUD insertion. She asks if she can see any provider for this procedure. What do you tell her?',
    options: [
      { id: 'a', text: 'Yes — all OB/GYN providers in the department perform IUD insertions.', points: 5,
        rationale: 'IUD insertion is a credentialed procedure; not all providers in the department are authorised to perform it.' },
      { id: 'b', text: 'No — only specific providers are credentialed for IUD insertions. Check which providers are authorised and book accordingly.', points: 100,
        rationale: 'Correct per SOP: IUD insertion is a credentialed procedure limited to specific providers; always verify before booking.' },
      { id: 'c', text: 'Yes — any nurse practitioner or PA can perform it as a minor procedure.', points: 10,
        rationale: 'Credential requirements apply to the specific procedure, not the general provider type.' },
      { id: 'd', text: 'IUD insertions are handled by the nursing lead, not the OB providers.', points: 10,
        rationale: 'Nursing staff do not perform IUD insertions; this is a provider procedure.' },
    ],
    correctOptionId: 'b',
  },

  // ── Scope & Privacy ────────────────────────────────────────────────────────

  {
    id: 'q-obgyn-bd-1',
    department: 'obgyn',
    domainId: 'boundaries',
    competencies: ['compliance', 'escalation', 'sopKnowledge'],
    scenario:
      'A patient calls asking what her recent prenatal lab results mean. She says her provider hasn\'t called her yet and she is worried. What do you do?',
    options: [
      { id: 'a', text: 'Read her the results and briefly explain what the values mean to ease her worry.', points: 0,
        rationale: 'Conveying or interpreting lab results is a clinical act — a strict SOP violation regardless of intent.' },
      { id: 'b', text: 'Let her know you cannot share results by phone; send a Telephone Encounter to the clinical team so a nurse or provider can call her back with the results.', points: 100,
        rationale: 'Correct per SOP: lab results and clinical information are never communicated by the front line; the correct action is to create a TE for the clinical team to follow up.' },
      { id: 'c', text: 'Transfer her to the nursing lead and have the nurse read her the values.', points: 40,
        rationale: 'Better than reading the results yourself, but a TE is the correct pathway so the right clinical owner follows up with context.' },
      { id: 'd', text: 'Tell her the results are normal if they look normal in the system, otherwise say you are not sure.', points: 0,
        rationale: 'Any interpretation of results — even saying "they look normal" — is a clinical act outside navigator scope.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-bd-2',
    department: 'obgyn',
    domainId: 'boundaries',
    competencies: ['compliance', 'riskManagement', 'communication'],
    scenario:
      'A man calls saying he is a patient\'s husband and asks whether her pregnancy test came back positive. What do you do?',
    options: [
      { id: 'a', text: 'Confirm the result — he\'s her husband and it\'s good news.', points: 0,
        rationale: 'Marital status does not authorize disclosure. Test results go to the patient, through the clinical pathway.' },
      { id: 'b', text: 'Explain you cannot share any patient information with a third party without documented authorization, and offer to take a message for the patient.', points: 100,
        rationale: 'Correct: no confirmation of results — or even of the patient relationship details — to an unauthorized caller. Taking a message keeps the interaction courteous without disclosing anything.' },
      { id: 'c', text: 'Check whether he is listed as her spouse in the chart, and share the result if he is.', points: 15,
        rationale: 'Being listed as a spouse is demographic data, not disclosure authorization — and results are not shared by phone by the front line regardless.' },
      { id: 'd', text: 'Say "you didn\'t hear it from me, but congratulations."', points: 0,
        rationale: 'A disclosure with a wink is still a disclosure — and this one is also a results communication.' },
    ],
    correctOptionId: 'b',
  },

  // ── Documentation & Follow-through ─────────────────────────────────────────

  {
    id: 'q-obgyn-doc-1',
    department: 'obgyn',
    domainId: 'documentation',
    competencies: ['communication', 'sopApplication', 'problemResolution'],
    scenario:
      'You are writing the TE for a pregnant patient\'s clinical question. Which documentation is complete?',
    options: [
      { id: 'a', text: 'Gestational age (or due date), the specific question or symptoms with onset, a callback number, assigned to the OB Portal.', points: 100,
        rationale: 'Correct: gestational age changes what almost every OB question means clinically; symptoms with onset, callback details, and the correct queue let the nurse act on the first read.' },
      { id: 'b', text: '"Patient has a question, please call back," assigned to the OB Portal.', points: 5,
        rationale: 'Right queue, but no gestational age, no question, no callback details — the nurse must re-do the whole intake.' },
      { id: 'c', text: 'The symptoms, assigned to the OB Portal — her chart has the rest.', points: 30,
        rationale: 'Better, but omitting gestational age and callback details forces chart-digging and delays the response; symptom onset also matters.' },
      { id: 'd', text: 'Write the details in General Notes on her chart instead of a TE.', points: 10,
        rationale: 'General Notes is not a work queue — nothing routes to a clinician, so no one will follow up.' },
    ],
    correctOptionId: 'a',
  },
];
