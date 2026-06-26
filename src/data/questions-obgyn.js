// ─────────────────────────────────────────────────────────────────────────────
// OB/GYN SEED QUESTIONS
//
// Derived from the Aizer Health OB/GYN Department SOP. All scenarios are
// SANITIZED: faithful to the workflow but using generic role labels only
// ("the MFM nurse", "the sonography/MFM director", "the scheduling lead").
// NO real provider names, phone numbers, or external portal credentials appear
// anywhere in this file.
//
// These seed the Firestore `questions` collection on first run (alongside the
// Pediatrics seed) and serve as the offline fallback for the OB/GYN check.
// They map to the same shared DOMAIN IDs as the Pediatrics bank — the scoring
// and matrix pipeline is department-agnostic.
// ─────────────────────────────────────────────────────────────────────────────

export const SEED_QUESTIONS_OBGYN = [

  // ── Sites & Routing ────────────────────────────────────────────────────────

  {
    id: 'q-obgyn-sites-1',
    department: 'obgyn',
    domainId: 'sites',
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
    id: 'q-obgyn-sites-2',
    department: 'obgyn',
    domainId: 'sites',
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

  // ── Scheduling & Visit Rules ────────────────────────────────────────────────

  {
    id: 'q-obgyn-sched-1',
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
    id: 'q-obgyn-sched-2',
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
    id: 'q-obgyn-sched-3',
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
    id: 'q-obgyn-sched-4',
    department: 'obgyn',
    domainId: 'scheduling',
    competencies: ['sopKnowledge', 'sopApplication'],
    scenario:
      'A patient calls at exactly 40 weeks saying her provider told her she needs a non-stress test (NST). When should this be scheduled and how frequently?',
    options: [
      { id: 'a', text: 'Once at 40 weeks, then only if the provider orders more.', points: 20,
        rationale: 'Post-dates NST is typically twice weekly; a single test and waiting for orders underserves the patient.' },
      { id: 'b', text: 'Starting at 40 weeks and repeated twice weekly (approximately every 3–4 days) until delivery.', points: 100,
        rationale: 'Correct per SOP: NSTs begin at or after 40 weeks and are performed twice weekly to monitor fetal well-being in post-dates pregnancies.' },
      { id: 'c', text: 'Weekly from 40 weeks until the patient delivers.', points: 40,
        rationale: 'Weekly monitoring is less frequent than the SOP standard of twice weekly for post-dates NST.' },
      { id: 'd', text: 'NSTs are only done when a patient reports decreased fetal movement, not routinely at 40 weeks.', points: 10,
        rationale: 'Routine NST at 40 weeks is a standard prenatal protocol, not reserved only for decreased fetal movement.' },
    ],
    correctOptionId: 'b',
  },

  // ── Provider Matching ───────────────────────────────────────────────────────

  {
    id: 'q-obgyn-prov-1',
    department: 'obgyn',
    domainId: 'providers',
    competencies: ['sopKnowledge', 'sopApplication', 'riskManagement'],
    scenario:
      'A patient at 19 weeks calls to schedule her anatomy scan (Level II ultrasound). Any OB provider has openings this week. Who can you book the anatomy scan with?',
    options: [
      { id: 'a', text: 'Any available OB provider, since all are trained in ultrasound.', points: 5,
        rationale: 'The anatomy scan requires specialist credentials; it cannot be performed by all OB providers.' },
      { id: 'b', text: 'Only the sonography/MFM director — they are the sole credentialed provider for anatomy scans.', points: 100,
        rationale: 'Correct per SOP: the anatomy/Level II scan must be booked with the sonography/MFM director, who holds the required credentials for this procedure.' },
      { id: 'c', text: 'The MFM nurse, who can perform the scan and add the clinical review.', points: 10,
        rationale: 'The MFM nurse coordinates high-risk care but does not perform anatomy scans.' },
      { id: 'd', text: 'The first available provider to avoid a long wait.', points: 5,
        rationale: 'Booking an uncredentialed provider for a specialist scan creates a quality and liability issue.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-prov-2',
    department: 'obgyn',
    domainId: 'providers',
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

  // ── Call Routing & Triage ───────────────────────────────────────────────────

  {
    id: 'q-obgyn-route-1',
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

  {
    id: 'q-obgyn-route-2',
    department: 'obgyn',
    domainId: 'routing',
    competencies: ['compliance', 'escalation', 'sopKnowledge'],
    scenario:
      'A patient calls asking what her recent prenatal lab results mean. She says her provider hasn\'t called her yet and she is worried. What do you do?',
    options: [
      { id: 'a', text: 'Read her the results and briefly explain what the values mean to ease her worry.', points: 0,
        rationale: 'Conveying or interpreting lab results is a clinical act — a strict SOP violation regardless of intent.' },
      { id: 'b', text: 'Let her know you cannot share results by phone; send a Telephone Encounter to the clinical team so a nurse or provider can call her back with the results.', points: 100,
        rationale: 'Correct per SOP: lab results and clinical information are never communicated by the front line; the correct action is to create a TE for the nursing/clinical team to follow up.' },
      { id: 'c', text: 'Transfer her to the nursing lead and have the nurse read her the values.', points: 40,
        rationale: 'Better than reading the results yourself, but a TE is the correct pathway so the right clinical owner follows up with context.' },
      { id: 'd', text: 'Tell her the results are normal if they look normal in the system, otherwise say you are not sure.', points: 0,
        rationale: 'Any interpretation of results — even saying "they look normal" — is a clinical act outside navigator scope.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-route-3',
    department: 'obgyn',
    domainId: 'routing',
    competencies: ['escalation', 'riskManagement', 'sopApplication', 'criticalThinking'],
    scenario:
      'A patient at 32 weeks calls saying she is having regular contractions every 8–10 minutes. She says they have been going on for about an hour. What do you do?',
    options: [
      { id: 'a', text: 'Schedule her for a same-day provider visit to be evaluated in the office.', points: 10,
        rationale: 'Regular contractions at 32 weeks (preterm) require hospital monitoring, not an office visit.' },
      { id: 'b', text: 'Direct her to go to Labor and Delivery immediately — regular contractions before 37 weeks may indicate preterm labour and require hospital triage.', points: 100,
        rationale: 'Correct per SOP: regular uterine contractions at less than 37 weeks are a preterm labour alert; L&D triage is the only appropriate pathway.' },
      { id: 'c', text: 'Send a TE to the nursing team and advise her to rest and drink water; call back if they get stronger.', points: 10,
        rationale: 'A TE and wait-and-see approach is not appropriate for potential preterm labour — immediate L&D evaluation is required.' },
      { id: 'd', text: 'Ask her to time the contractions for another hour and call back if they continue.', points: 5,
        rationale: 'Advising a patient in possible preterm labour to wait an additional hour risks a serious outcome.' },
    ],
    correctOptionId: 'b',
  },

  // ── Insurance & Eligibility ─────────────────────────────────────────────────

  {
    id: 'q-obgyn-ins-1',
    department: 'obgyn',
    domainId: 'insurance',
    competencies: ['sopKnowledge', 'compliance', 'customerHandling'],
    scenario:
      'A pregnant patient with Medicaid coverage asks how much her copay will be for today\'s prenatal visit. What do you tell her?',
    options: [
      { id: 'a', text: 'The standard copay — Medicaid copays apply to all visit types.', points: 15,
        rationale: 'Medicaid copays for maternity/prenatal care are subject to exemptions; assuming a standard copay may overcharge the patient.' },
      { id: 'b', text: 'Prenatal visits are typically covered without a copay under Medicaid maternity benefits; verify her specific plan, but she likely owes nothing today.', points: 100,
        rationale: 'Correct per SOP: Medicaid maternity coverage generally waives copays for prenatal visits; always verify, but the patient should be informed of the likely exemption.' },
      { id: 'c', text: 'She will need to pay the copay upfront; a Medicaid reimbursement can be requested later.', points: 5,
        rationale: 'Collecting a copay that is waived under maternity Medicaid benefits creates a billing error and harms the patient.' },
      { id: 'd', text: 'Medicaid does not cover OB visits — refer her to a Medicaid-contracted OB clinic.', points: 0,
        rationale: 'Medicaid covers prenatal care; denying coverage and turning away a pregnant patient is both incorrect and harmful.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-ins-2',
    department: 'obgyn',
    domainId: 'insurance',
    competencies: ['sopKnowledge', 'compliance', 'customerHandling', 'problemResolution'],
    scenario:
      'An uninsured patient calls asking about costs for a routine GYN visit. What self-pay options should you explain?',
    options: [
      { id: 'a', text: 'A flat $100 fee for all self-pay GYN visits, no exceptions.', points: 20,
        rationale: 'A flat fee is one option but omits the income-based sliding scale available to lower-income patients.' },
      { id: 'b', text: 'A sliding fee scale (income-based, starting at $25, valid for one year) or a flat self-pay rate; she can apply for the sliding scale if her income qualifies.', points: 100,
        rationale: 'Correct per SOP: self-pay options include an income-verified sliding scale starting at $25 (1-year validity) and a flat self-pay rate for those who do not qualify or prefer not to apply.' },
      { id: 'c', text: 'Full charge applies; self-pay patients should apply for insurance before booking.', points: 5,
        rationale: 'Refusing to book until the patient has insurance and not mentioning self-pay options is against department policy.' },
      { id: 'd', text: 'Refer her to the billing department and take no further action until they reply.', points: 15,
        rationale: 'The navigator should be able to explain the self-pay options at a high level; deferring entirely to billing without answering leaves the patient without guidance.' },
    ],
    correctOptionId: 'b',
  },

  // ── Registration & Records ──────────────────────────────────────────────────

  {
    id: 'q-obgyn-reg-1',
    department: 'obgyn',
    domainId: 'registration',
    competencies: ['sopApplication', 'compliance', 'customerHandling'],
    scenario:
      'A new OB patient who was previously seen at another practice calls to transfer her care at 16 weeks. What must you collect before scheduling her first appointment?',
    options: [
      { id: 'a', text: 'Just her insurance information and preferred appointment time.', points: 15,
        rationale: 'Booking without prenatal records means the OB provider will have no baseline data for the visit.' },
      { id: 'b', text: 'Her prior prenatal records (including dating ultrasound, lab results, and the prenatal flow sheet) must be received before or at the first appointment.', points: 100,
        rationale: 'Correct per SOP: transfer patients must bring or send their prenatal records so the receiving provider has the full clinical history from the start of the pregnancy.' },
      { id: 'c', text: 'A referral from the prior practice before she can be seen.', points: 20,
        rationale: 'A referral is not a standard requirement for OB transfer patients; what is needed is the clinical records.' },
      { id: 'd', text: 'Nothing extra — start from scratch; the provider will order new labs and an ultrasound at the visit.', points: 10,
        rationale: 'Ordering a full repeat work-up when prior records exist is wasteful and potentially distressing for the patient; records should be obtained.' },
    ],
    correctOptionId: 'b',
  },

  {
    id: 'q-obgyn-reg-2',
    department: 'obgyn',
    domainId: 'registration',
    competencies: ['sopApplication', 'customerHandling', 'problemResolution', 'communication'],
    scenario:
      'A patient arrives 18 minutes late for her 30-minute prenatal appointment. The provider\'s next patient is already waiting. What is the standard approach?',
    options: [
      { id: 'a', text: 'Always see the patient regardless of how late she is — missing a prenatal visit is too risky.', points: 20,
        rationale: 'While continuity of care matters, seeing an 18-minute late patient when the slot cannot accommodate it disrupts the provider\'s schedule and affects other patients.' },
      { id: 'b', text: 'Apply the late arrival policy: if it is beyond the grace period (typically 15 minutes for a 30-minute slot), offer to reschedule; explain the policy courteously and offer the next available appointment.', points: 100,
        rationale: 'Correct per SOP: beyond the grace period for the visit length, the standard is to reschedule, explain the policy kindly, and offer prompt rescheduling.' },
      { id: 'c', text: 'Seat her immediately without telling the provider; let the provider decide.', points: 15,
        rationale: 'Routing a significantly late patient into a full room without informing the provider creates a scheduling conflict and a poor patient experience.' },
      { id: 'd', text: 'Charge a no-show fee and tell her she must call before next time.', points: 10,
        rationale: 'An 18-minute late arrival is not a no-show; the fee and wording are incorrect.' },
    ],
    correctOptionId: 'b',
  },
];
