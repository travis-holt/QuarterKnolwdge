// SOP contexts used to ground scenario generation. The leading underscore keeps
// Express from turning this file into an HTTP route — it is a helper module.
import { getLiveSopRecord, getLiveSopSyncRecord } from './_sop-store.js';
import { navigatorContextBlock } from './_navigator-operating-model.js';
import { OBGYN_SOP_VERSION, OBGYN_SOURCE_AUTHORITY } from '../src/data/obgynWorkflowRules.js';
//
// SOP_CONTEXTS is a map keyed by department id. Use sopContextFor(deptId) in
// API handlers — it defaults to the Pediatrics context for unknown departments.
//
// SANITIZATION NOTE: the OB/GYN context below is faithful to the workflow but
// uses generic role labels only (no real provider names, phone numbers, or
// external portal credentials — the repo is public).
//
// Sources:
//   Pediatrics — Aizer Health Organization Operational Procedures SOP v1.0
//                ("Pediatrics_SOP_Updated.pdf")
//   OB/GYN     — Aizer Health OB/GYN Department SOP (sanitized distillation)
export const SOP_CONTEXT = `
PEDIATRIC CONTACT-CENTRE SOP — AIZER HEALTH ORGANIZATION
(Aizer Health Organization Operational Procedures, v1.0)

════════════════════════════════════════════════════════
DOMAIN 1: SITES & ROUTING
════════════════════════════════════════════════════════

LOCATIONS:
- 49 Forest Road: Near Landau's Supermarket and Kiryas Joel Shopping Center. Short drive
  to Walmart Supercenter and the busy Route 17M commercial area.
- 48 Bakertown Road: Near Chasuna Mall and the business center.
- 1200 NY-208, Blooming Grove: Positioned directly on NY Route 208, one of the main roads
  serving Monroe and surrounding Orange County communities. Located within or near Blooming
  Grove Plaza. Dr. Dina Faiden is primarily stationed at this location.

════════════════════════════════════════════════════════
DOMAIN 2: SCHEDULING & VISIT RULES
════════════════════════════════════════════════════════

APPOINTMENT TYPES:

Newborn Physical Exam
- Must be done within the first 6 weeks of birth.
- Write in ECW: NB PE, #Lab ID number, delivery hospital.
- Performed by Dr. Polinger and Dr. Frommer ONLY.

Physical Exam
- Every 2 months up to 6 months of age → every 3 months up to 2 years → annually at
  2 years and older.
- Fidelis + Medicaid exception: can repeat early if patient had a birthday and last PE
  was at least 6 months ago.
- Write: PE, PE+SHOTS, PE+fever, etc.

Same-Day Sick Visit
- For patients complaining of symptoms like fever, crankiness, cold, coughing, wheezing,
  rash, sneezing.
- Can ONLY be booked on the same day of the visit.
- Write all symptoms in the reason section (e.g., FEVER + Cough).

Office Visit
- Mostly for follow-up on previous visits or the latest PE exam.
- Not templated on the schedule — we can turn any same-day sick visit slot into an office
  visit if a follow-up is written by the doctor on the report of a previous appointment.
- Can be pre-booked, unlike same-day sick visits.

Pre-Operation Visit
- For patients who will undergo surgery — usually done to check vitals and reaction under
  anesthesia.
- Write: type of surgery, date of surgery, name of surgeon or hospital.
- Not templated — we can turn any same-day sick visit slot into a pre-op visit.

PED HOS FU
- For patients who are out of the hospital but need follow-up from the primary care provider
  at Aizer.
- Not templated — we can turn any same-day sick visit slot into an ER follow-up visit.

WIC Form Requests
- Can be handled by sending a TE to the Peds Telephone Encounter queue.
- We can book an appointment for WIC form requests as an office visit (OV) and add the
  reason as "HEMO."

Tongue Tie Appointment
- Performed within 5 weeks from the child's delivery.
- If a parent calls to schedule and the child is more than 5 weeks old, our providers can
  only confirm the tongue tie and refer the patient to an outside provider.
- Booked as OV or same-day sick visit.

Weight Check
- If the PE is up to date, send a telephone encounter (TE) to Sally Carilli.

Lactation Appointments
- 30-minute appointment, office visit (OV).
- Only done by Robin Aschkenasy, Tamar Dachoh, and Chana Heintz.

Early Intervention
- Early intervention refers to the provision of specialized therapies, services, and
  educational supports to babies, toddlers, and young children with developmental delays,
  disabilities, or medical conditions.
- Send a TE to the PEDS TELEPHONE ENCOUNTER queue.

SCHEDULING RULES AND SPECIAL NOTES:
- If PE is not up to date, the patient will not be entitled to: a referral · a specialty
  care appointment · shots, immunizations, or vaccinations · medication refills (in some
  cases). Schools may also require the PE to be up to date for children to attend school.
- Each day's schedule is divided into 10-minute slots. Each provider has a different total
  number of patients they can see per slot. The template on each slot shows how many patients
  the provider would like to see and the arrangement of visit types during that time.
- New Spanish-speaking patients with Dr. Dina Faiden: Get 30 minutes (an extra 10 min) to
  allow time to discuss the child's history.
- Same-day sick visits can be booked only on the same day of the visit. Office visits,
  pre-ops, and ER follow-ups are not templated on the schedule — we can turn any same-day
  sick visit slot into those visit types. They can be pre-booked, unlike same-day sick visits.
- Controlled substance follow-ups: Must go through Sally Carilli via a TE. Scheduled in
  specifically approved time slots — not regular slots.
- Lori Lambert: Can see a maximum of 30 patients per day.
- ADHD / Anxiety / Chronic patients: May require extra time. If the billing alert that
  appears when opening the patient chart in ECW states that the patient requires extra time
  or is a chronic patient, adjust accordingly.

════════════════════════════════════════════════════════
DOMAIN 3: PROVIDER MATCHING
════════════════════════════════════════════════════════

PRIMARY CARE PROVIDERS:

Dr. Adam Polinger
- MD · Up to 3 patients / 10 min · Good Samaritan Hospital
- Deliveries & NB Physicals · Most requested
- Speaks English, Spanish, Hebrew, and Yiddish

Dr. Eliezer Frommer
- MD · Good Samaritan Hospital member
- Deliveries & NB Physicals
- Speaks English and Yiddish

Lazar Khaimov
- Speaks English and Yiddish

Dina Faiden
- Provider · Primarily at 208 Blooming Grove · (formerly Donna Deck)
- New Spanish-speaking patients: 30 min booking
- Speaks English and Spanish

Lori Lambert
- Provider · Max 30 patients per day
- Speaks English only

Robin Aschkenasy
- Speaks English and Yiddish

Tamar Dachoh
- Speaks English only

Chana Heintz
- Speaks English, Hebrew, and Yiddish

Lily Namanworth
- Speaks English, Spanish, and Yiddish

SPECIALTY PROVIDERS:

Dr. Rubin S. Cooper (Cardiology): 1st Thursday. 30-min appointments. NO United Healthcare.
  MVP accepted only with secondary Medicaid.
Dr. Sankaran Krishnan (Pulmonology): One Tuesday every month. 30 min Follow-up (F/U),
  40 min New Patient (NP).
Dr. John Welter (Pulmonology): 2nd Tuesday every month. 40 min Follow-up (F/U),
  60 min New Patient (NP).
Dr. Jillian Hochfelder (Allergy): Mostly one Wednesday every month. 30 min appointments.
  The first slot of shift/post-lunch is always a Food Challenge.
Dr. Subhadra Siegel (Allergy): Mostly one Thursday every month. 30 min appointments.
  The first slot of shift/post-lunch is always a Food Challenge.
Dr. Beth Gottlieb (Rheumatology): 1st Tuesday. 20 min F/U, 40 min NP. NO United
  Healthcare (outside Aizer).
Dr. Lianne DeSerres (ENT): 3rd Wednesday. 20 min appointments. Siblings: The only
  specialty where double booking siblings is allowed.
Dr. Tali Lando (ENT): 1st Tuesday. 20 min appointments. Siblings: The only specialty
  where double booking siblings is allowed.

════════════════════════════════════════════════════════
DOMAIN 4: CALL ROUTING & REFERRALS
════════════════════════════════════════════════════════

KEY STAFF CONTACTS:

Name             | Role                | TE Routing / Notes
Marisa Kraft     | PEDS                | Shots, immunizations, vaccinations, and digital
                 |                     | imaging — TE only if PE is up to date
Hayley Newton    | —                   | ENT and nutritionist — TE only if PE is up to date
Anisa Azeez      | PEDS Encounters     | All referral-related TEs — PE must be up to date
                 | queue               |
Sally Carilli    | Referral Specialist | Controlled substance follow-ups via TE —
                 |                     | approved time slots only. Lab results (if black
                 |                     | lock exists) and medical questions — include
                 |                     | best call-back number.

TELEPHONE ENCOUNTER (TE) GUIDE — STEP-BY-STEP SCENARIOS:

1. Lab Results Inquiry → PEDS Encounters queue
   Steps:
   1. Open patient chart in ECW.
   2. Check the labs on the patient chart.
   3. If a black lock exists on the lab, do NOT discuss the results with the parent.
   4. Check existing TEs — there may be instructions left by a provider or nurse to relay
      to the parent.
   5. Send a TE to the PEDS Encounters queue asking a nurse to call the parent to discuss
      the results.
   6. Include the parent's best call-back number.
   Include in TE: best call-back number · which lab(s) the parent is asking about ·
   any existing instructions found in TEs.
   Note: Always check existing TEs before sending a new one.

2. Medical Question → PEDS Encounters queue
   Steps:
   1. Listen to the parent's medical question.
   2. Open the patient chart in ECW.
   3. Send a TE to the PEDS Encounters queue.
   4. Include the best call-back number for the parent.
   Include in TE: best call-back number · the medical question as described by the parent.

3. Shots / Immunizations / Vaccinations → PEDS Marisa Kraft (TE only if PE is up to date)
   Steps:
   1. We do NOT schedule shots, immunizations, or vaccination appointments.
   2. Verify PE is up to date.
   3. If PE is up to date, send a TE to PEDS Marisa Kraft.
   Include in TE: parent call-back number · confirmation that PE is up to date.

4. ENT / Nutritionist Referral → Hayley Newton
   Steps:
   1. Verify the patient's PE is up to date.
   2. If PE is NOT up to date, the patient is not entitled to a referral.
   3. If PE IS up to date, send a TE to Hayley Newton.
   Include in TE: specialty needed (ENT or Nutritionist) · confirmation PE is up to date ·
   parent call-back number.

5. Referral Request → Anisa Azeez (Referral Specialist)
   Steps:
   1. Verify PE is up to date — patient is not entitled to a referral if PE is not current.
   2. If PE is NOT up to date, the patient cannot receive a referral.
   3. If PE IS up to date, send a TE to Anisa Azeez.
   Include in TE: parent call-back number · PE status (confirmed up to date).

6. Controlled Substance Follow-Up → Sally Carilli
   Steps:
   1. Controlled substance follow-ups must go through Sally Carilli via a TE.
   2. Schedule only in specifically approved time slots — not regular slots.
   Include in TE: parent call-back number · nature of the follow-up.
   Controlled substance list: Adderall · Amphetamine · Concerta · Methylphenidate ·
   Guanfacine · Strattera · Intuniv · Ritalin · Vyvanse · Focalin · Xanax · Alprazolam.
   Note: Tylenol/Motrin are only dispensed before checkout (covered by insurance). After
   checkout, the patient must buy OTC (Over The Counter).

7. Digital Imaging Request → PEDS Marisa Kraft (TE only if PE is up to date)
   Steps:
   1. We do NOT schedule digital imaging appointments.
   2. Verify PE is up to date.
   3. If PE is up to date, send a TE to PEDS Marisa Kraft.
   Include in TE: parent call-back number · confirmation that PE is up to date.

8. Specialty Care — Vision, Speech, PT/OT, Podiatry → Transfer call to relevant queue
   For Vision, Speech, Physical Therapy, Occupational Therapy, and Podiatry: transfer
   the call to the relevant queue once received. No TE required.

9. Medication Refill Request → PEDS Encounters queue (HIGH PRIORITY if out of medication)
   Steps:
   1. Ask for or confirm the medication / prescription name.
   2. Confirm the preferred pharmacy and best call-back number.
   3. Check the logs on the patient hub / ePrescription history when needed.
   4. Copy the medication name and prescribing provider details from the chart when available.
   5. Send a TE to the PEDS Encounters queue.
   6. If the patient is completely out of the medication, tag the TE as HIGH PRIORITY.
   7. Do NOT promise approval or tell the caller the refill will be sent today.
   8. Do NOT deny the refill yourself based only on PE status; if the chart raises an eligibility
      concern, document the context and route it for the appropriate team or provider decision.
   Include in TE: best call-back number · medication name · preferred pharmacy · name of the
   prescribing provider (if available from the chart/logs) · whether patient is completely out of
   medication (high priority if yes) · any relevant chart details needed for follow-up.

════════════════════════════════════════════════════════
DOMAIN 5: INSURANCE & ELIGIBILITY
════════════════════════════════════════════════════════

- Dr. Rubin S. Cooper (Cardiology): NO United Healthcare. MVP accepted only with secondary Medicaid.
- Dr. Beth Gottlieb (Rheumatology, outside Aizer): NO United Healthcare.
- Fidelis + Medicaid PE exception: patient can repeat a physical early if they had a birthday
  and the last PE was at least 6 months ago.

PE NOT UP TO DATE — PATIENT IS NOT ENTITLED TO:
❌ A referral
❌ A specialty care appointment
❌ Shots, immunizations, or vaccinations
❌ Medication refills (in some cases)
📋 Schools may also require PE to be up to date for children to attend school.

════════════════════════════════════════════════════════
DOMAIN 6: REGISTRATION & CONFIRMATION
════════════════════════════════════════════════════════

PHYSICAL EXAM FREQUENCY CALCULATOR:

- 0–6 months: Every 2 months
- 6 months – 2 years: Every 3 months
- 2 years and older: Annually
- Fidelis + Medicaid: Can repeat early if patient had a birthday and last PE was ≥ 6 months ago

APPOINTMENT BOOKING PROCESS:
- Each day's schedule for all providers is divided into 10-minute slots.
- Each provider has a different total number of patients they can see within each slot.
- The daily schedule shows available providers, available appointments, and a template on each
  10-minute slot showing how many patients the provider would like to see and the arrangement
  of visit types.
- Appointment duration may vary — if the billing alert in ECW states the patient requires extra
  time or is a chronic patient, adjust accordingly.
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// OB/GYN SOP GROUNDING (sanitized — generic role labels, no PII)
// ─────────────────────────────────────────────────────────────────────────────
const SOP_CONTEXT_OBGYN = `
OB/GYN CONTACT-CENTRE SOP — AIZER HEALTH ORGANIZATION
(Sanitized operational distillation — workflow-faithful, no real names or credentials)

════════════════════════════════════════════════════════
DOMAIN 1: SITES & ROUTING
════════════════════════════════════════════════════════

CALL INTAKE QUEUES:
- PSS (Patient Scheduling Services) Queue: primary intake for all OB/GYN appointment bookings.
  All new and return scheduling requests route through this queue.
- OB Portal: patient-facing message channel; do not book appointments via the portal directly —
  portal messages are triaged and routed to the appropriate owner.
- Prevention Coordinator: handles annual GYN wellness visits, preventive screenings, and
  patient education. Route calls about annual exams or wellness screenings here.
- MFM Nurse (Maternal-Fetal Medicine): designated coordinator for high-risk patients,
  MFM referrals, and complex prenatal cases. Route any call where the OB has requested
  MFM involvement or the patient is flagged as high-risk to the MFM nurse.
- Nursing Lead: handles clinical escalations and urgent nursing questions when the MFM nurse
  is unavailable.

ROUTING MATRIX:
- New OB appointment → PSS Queue
- Return prenatal visit → PSS Queue
- Annual GYN / wellness → Prevention Coordinator
- MFM referral / high-risk coordination → MFM Nurse
- Lab results or clinical questions → Telephone Encounter (TE) to nursing team
- Urgent triage (heavy bleeding, decreased fetal movement, contractions < 37 weeks) → L&D
  (Labor and Delivery) immediately — do not route through a queue

════════════════════════════════════════════════════════
DOMAIN 2: SCHEDULING & VISIT RULES
════════════════════════════════════════════════════════

FIRST PRENATAL (NEW OB) VISIT:
- Optimal timing: 8–12 weeks gestation (first trimester). This window aligns with the dating
  ultrasound and viability confirmation. Before 8 weeks is too early to reliably confirm a
  heartbeat. After 12 weeks misses first-trimester screening windows.

RETURN PRENATAL VISIT (RTO) CADENCE:
- Up to 28 weeks: every 4 weeks
- 28–36 weeks: every 2 weeks
- 36+ weeks until delivery: weekly

GESTATIONAL-AGE-SPECIFIC TESTS (SCHEDULE IN THESE WINDOWS):
- First-Trimester Screening / NT Scan: 11–14 weeks
- Anatomy Scan (Level II Ultrasound): 18–22 weeks (must be with the sonography/MFM director only)
- Glucose Challenge Test (GCT) for gestational diabetes: 24–29 weeks (routine for all patients)
- Group B Strep (GBS) Test: 36–37 weeks (timing ensures result reflects delivery status)
- Non-Stress Test (NST): begins at 40 weeks; performed twice weekly (every 3–4 days) until delivery

ANNUAL GYN EXAM:
- Preventive GYN exam (e.g. Pap smear, wellness) → route to Prevention Coordinator
- GYN visit for a specific problem/complaint → standard OB/GYN appointment slot

SCHEDULING NOTES:
- Always confirm gestational age before booking gestation-specific tests.
- If a patient is unsure of gestational age, schedule for a dating ultrasound before other tests.
- Same-day appointments are available for urgent OB concerns but must be triaged first.

════════════════════════════════════════════════════════
DOMAIN 3: PROVIDER MATCHING
════════════════════════════════════════════════════════

PROVIDER-PROCEDURE CONSTRAINTS:
- Anatomy Scan (Level II Ultrasound): ONLY the sonography/MFM director can perform this.
  Do not book with any other provider regardless of availability.
- IUD Insertion / Removal: only specific credentialed OB/GYN providers are authorised.
  Always verify which providers in the department are credentialed before booking.
- Nexplanon Insertion / Removal: same credentialing restriction as IUD — verify before booking.
- Colposcopy / LEEP: only credentialed providers; verify the list before booking.
- Kallah / Fertility Consultations: a specific subset of providers handles these; check
  credentials and patient preference before scheduling.
- Complex high-risk OB management: route to the MFM nurse for coordination with the MFM director.
- All other prenatal and GYN visits: any available OB/GYN provider may be booked.

MATCHING CONSIDERATIONS:
- Patient language preference: confirm interpreter availability if needed.
- Patient gender preference: accommodate when possible and document.
- Continuity of care: where possible, book the patient with the provider she has been seeing.

════════════════════════════════════════════════════════
DOMAIN 4: CALL ROUTING & TRIAGE
════════════════════════════════════════════════════════

NEVER COMMUNICATE ON THE PHONE (navigator scope boundary):
- Lab or test results — NEVER read or interpret. Create a TE to the nursing/clinical team.
- Medication dosage, refills, or advice — NEVER provide. Create a TE.
- Clinical assessment or advice — NEVER provide. Create a TE or direct to L&D if urgent.

TELEPHONE ENCOUNTER (TE) — standard async message to clinical owner:
- Use for: non-urgent clinical questions, refill requests, lab-result callbacks, routine concerns.
- Never use as a substitute for an emergency referral to L&D.

TRIMESTER TRIAGE LOGIC:

First trimester (0–13 weeks):
- Light spotting without pain → TE to nursing team
- Heavy bleeding or severe cramping → direct to Emergency Room or Labor and Delivery
- Nausea/vomiting (routine) → TE to nursing for guidance
- Signs of ectopic pregnancy (one-sided pain + bleeding) → Emergency Room immediately

Second trimester (14–27 weeks):
- Any vaginal bleeding → TE to nursing; if significant or accompanied by pain → L&D
- Decreased fetal movement (after 20 weeks when patient is aware of movement) → L&D immediately
- Regular contractions before 24 weeks → TE to nursing
- Regular contractions at 24 weeks or later → L&D immediately (possible preterm labour)
- Leaking fluid (possible PPROM) → L&D immediately

Third trimester (28+ weeks):
- Any vaginal bleeding → L&D immediately
- Decreased fetal movement → L&D immediately
- Regular contractions before 37 weeks → L&D immediately (preterm labour)
- Regular contractions at 37+ weeks → L&D (term labour evaluation)
- Leaking fluid → L&D immediately
- Severe headache, visual changes, swelling, or right-upper-quadrant pain (possible preeclampsia)
  → L&D immediately

GENERAL RULE: When in doubt about urgency, direct the patient to L&D rather than scheduling
an office visit. A false alarm at L&D is always safer than a missed emergency.

════════════════════════════════════════════════════════
DOMAIN 5: INSURANCE & ELIGIBILITY
════════════════════════════════════════════════════════

ELIGIBILITY VERIFICATION:
- Verify insurance eligibility before booking any appointment.
- Check that the practice is in-network for the patient's plan.
- If eligibility cannot be confirmed, inform the patient and offer a self-pay rate or advise
  them to call their insurer.

MEDICAID (MATERNITY):
- Prenatal visits are typically covered without a copay under Medicaid maternity benefits.
- Always verify the patient's specific Medicaid plan, but inform her that copays are likely waived.
- Postpartum visits may have different coverage — verify separately.

ANNUAL GYN EXAM BILLING:
- Preventive annual GYN exam: usually billed as preventive care (no copay for most plans).
- If the visit becomes a problem visit (patient raises a concern), it may be billed differently
  and a copay may apply. Inform the patient of this possibility at booking.

COMMERCIAL / PRIVATE INSURANCE:
- Verify in-network status and any prior authorisation requirements for specialist referrals
  (e.g. MFM, anatomy scan).
- Ultrasounds may require prior auth — check before booking.

SELF-PAY OPTIONS (same as other departments):
- Sliding fee scale: income-based, starting at $25 per visit, valid for one year (patient must
  apply and provide income documentation).
- Flat self-pay rate: available for patients who do not qualify for or prefer not to apply for
  the sliding scale.
- Inform self-pay patients of both options; refer to the billing team for exact figures.

════════════════════════════════════════════════════════
DOMAIN 6: REGISTRATION & RECORDS
════════════════════════════════════════════════════════

ACCOUNT SEARCH:
- Use enough identifiers to reach the correct patient record before creating or modifying anything.
- If the first search path is ambiguous, confirm with another identifier before opening or changing the chart.

LATE ARRIVAL POLICY:
- Grace period: 10–15 minutes for a standard 30-minute OB/GYN visit.
- Patients arriving beyond the grace period may need to be rescheduled to protect the
  provider's remaining schedule and other patients' wait times.
- Apply the policy courteously; acknowledge the inconvenience and offer the next available
  appointment promptly.

TRANSFER PATIENTS (from another practice):
- Prior prenatal records are required: dating ultrasound, full prenatal lab panel, prenatal
  flow sheet, and any specialist notes.
- Records must be received before or at the first appointment.
- Out-of-network or out-of-county transfers: follow the same record requirement; note any
  insurance changes that may have occurred with the practice change.

RECORDS / SCANNING:
- All incoming paper records should be scanned into the patient's chart on the day of receipt.
- Patient requests for records or referral letters: route to the medical records team.

HOSPITAL SCHEDULE LIFECYCLE:
- When a patient is admitted to Labor and Delivery, update her chart status accordingly.
- After delivery, the postpartum follow-up visit is typically scheduled 4–6 weeks post-delivery.
- Notify the scheduling team when a patient delivers so her open prenatal appointments can be
  cancelled and the postpartum visit scheduled.
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// PATIENT NAVIGATOR ROLE CONTEXT — shared across departments.
//
// The role/operating-model context now lives in the reusable
// api/_navigator-operating-model.js so every AI endpoint (generation, roleplay,
// grading, QA, audit, coaching, learning paths) reasons about the SAME job model
// — the navigator decision loop, realistic call behaviour, and the "judge the
// decision, not the wording" scoring principles.
//
// NAVIGATOR_ROLE_CONTEXT is kept as a backward-compatible export (the department-
// neutral shared block) and is still prepended to every department SOP by
// sopContextFor / sopContextForFresh below. Department-specific routing/queue
// facts (PEDS Encounters, OB Portal, PSS OB, provider names, etc.) remain in the
// department SOP contexts above — the operating model deliberately stays free of
// SOP facts and PII (the repo is public).
// ─────────────────────────────────────────────────────────────────────────────
// Current-floor public fallback. The structured rule layer carries the
// machine-readable detail used by assessment generation and validation.
export const SOP_CONTEXT_OBGYN_CURRENT = `
OB/GYN PATIENT NAVIGATOR SOP — CURRENT FLOOR
Version: ${OBGYN_SOP_VERSION} · Effective 2026-07-17

SOURCE AND SCOPE
- Check Encounters, Medical Summary, the last relevant note, open TEs, future appointments, and
  e-prescription logs when relevant before choosing an appointment type.
- Patient wording alone is not an order. Missing or conflicting RTO/sonography documentation goes
  to OB Portal for clarification.
- Navigators do not diagnose, interpret results, decide urgency independently, promise clinical
  approval, or change pregnancy status/follow-up without clinical direction.

GYN AND PROVIDER PREFERENCE
- Annual GYN is current only after an actual in-department Annual GYN within one year. Pap-only,
  an outside annual, and postpartum do not count.
- Annual current plus a non-emergency concern uses GYN Office Visit; otherwise use Annual GYN.
- Serious symptoms or no reasonable routine opening: OB Portal; use High Priority when serious.
- Dr. Bank Annual GYN/fertility requests use the Waiting List Portal. Do not schedule Dr. Bank
  directly or promise availability; offer another provider for clinical concerns.

PREGNANCY CONFIRMATION AND NEW OB
- Reliable LMP: target the 8–12-week New OB window. Unknown/unreliable LMP: 15-minute provider
  Confirmation of Pregnancy first; do not independently add a lab or sonogram.
- New OB is one operational appointment: 30-minute NEW OB sonogram followed immediately by a
  30-minute provider visit, same day and back-to-back. Mark the second appointment OB Verified.
  If no valid pair or timing is clearly outside the usual window, use OB Portal.

RTO, SONOGRAPHY, AND PAIRS
- Follow the documented RTO/order in Medical Summary, last note, or TE. Pregnancy sonography is
  order-driven. Anatomy, Growth, BPP, NST, and other studies are not interchangeable.
- Unless explicitly redo/repeat-only, ordered pregnancy sonography is paired with a provider visit.
- Anatomy remains ordinary OB scheduling even though Dr. Rosenberg is entered on the scan record.
- New OB, BPP+MD, Growth+MD, Anatomy+MD, and required procedure/sono pairs move or cancel together.
  Preserve order and OB Verified on the second appointment where applicable.

POSTPARTUM AND IUD
- Postpartum is a 15-minute Postpartum-template visit and may still be booked around ten weeks.
- Known IUD insertion at postpartum: provider visit then immediate GYN Sono, except Dr. Scott
  Stanislawski. Discussion-only needs no sonogram.
- Outside postpartum, Annual status determines GYN OV versus Annual GYN. Provider visit comes first,
  GYN Sono second, back-to-back; the second appointment is OB Verified. Dr. Frieda Klein requires
  30 minutes and does not use the OB schedule for this workflow.

MFM, TRANSFER, AND URGENT WORK
- All MFM scheduling, cancellation, reschedule, questions, referrals, and high-risk inquiries route
  directly to Rebecca Wood. Navigators never schedule MFM. External/self-referrals are not accepted.
- Transfer OB requires gestational age, outside pregnancy records, OB Portal review, and documented
  acceptance/instructions before scheduling.
- Serious symptoms: create/update an OB Portal TE, mark High Priority, and message the Women's Health
  OB Urgent Calls Intermedia channel. Do not independently direct the patient to L&D or book an
  urgent appointment from slot availability.
- Written nurse/provider approval permits the instructed urgent booking/overbook. OB URGENT SONO
  and provider stay back-to-back in the clinically instructed order.

TE, REFILL, LAB, LATE ARRIVAL, AND PREGNANCY LOSS
- Check for an open TE. Same issue: Take Action. Different issue: separate TE.
- Refills: confirm medication, pharmacy, and prescribing provider; create or update the refill TE.
  Do not give medication advice or promise approval/timing.
- Navigators do not schedule OB/GYN labs or interpret results. Lab requests/questions go to OB Portal.
- Late arrival: message Intermedia with account number, appointment time, and expected lateness.
- Reported pregnancy loss: High Priority OB Portal TE plus urgent channel. Do not independently
  cancel appointments, alter pregnancy status, or decide follow-up.
- Current procedure questions route to OB Portal; old staff-specific procedure routing is inactive.
`.trim();

export const NAVIGATOR_ROLE_CONTEXT = navigatorContextBlock();

// Owner-confirmed floor operations outrank conflicting sanitized SOP language.
// Keep named owners to the approved public minimum; the deterministic layer uses stable IDs.
const OWNER_CONFIRMED_ROUTING_OVERRIDES = `
SOURCE AUTHORITY (highest first): owner-confirmed current-floor rules; active supervisor-managed department SOP; current hardcoded department fallback; generic navigator operating model. A lower source never overrides a higher one.
- Pediatrics standard refill: PEDS Encounters / Pediatrics Telephone Encounter queue; collect medication, pharmacy, callback, out status and high-priority if out. No PE question unless PE governs this case.
- Pediatrics referral: Anisa Azeez. Records/forms, urgent symptoms, and unclear requests have no universal route unless the trusted scenario gives an exact subtype rule; escalate uncertain routing for supervisor review.
- OB/GYN decisions begin with chart review. Routine GYN uses the Annual-GYN-status rule; it does not universally route to PSS OB or a Prevention Coordinator.
- Known reliable LMP uses the New OB window and complete paired visit. Unknown/unreliable LMP uses provider Confirmation first. Missing RTO/sonography documentation goes to OB Portal.
- MFM scheduling, reschedule, cancellation, questions, referral, and high-risk inquiries route directly to Rebecca Wood. Routine Anatomy is ordinary OB scheduling, not MFM.
- Serious OB/GYN symptoms use High Priority OB Portal TE plus the Women's Health OB Urgent Calls Intermedia channel. Navigators do not independently direct to L&D or book an urgent slot without written clinical approval.
- OB/GYN labs are never scheduled or interpreted by navigators; route them to OB Portal. Transfer OB is not scheduled before records review and documented clinical acceptance.
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Map + accessor — used by all SOP-grounded API handlers
// ─────────────────────────────────────────────────────────────────────────────
export const SOP_CONTEXTS = {
  pediatrics: SOP_CONTEXT,
  obgyn: SOP_CONTEXT_OBGYN_CURRENT,
};

/** Return the SOP grounding text for a department (role context + department SOP).
 *
 *  Department SOP resolution order:
 *    1. the ACTIVE supervisor-managed SOP from the Firestore `sops` collection
 *       (F24 SOP manager — cached sync read via _sop-store.js), else
 *    2. the hardcoded department context above, else
 *    3. the Pediatrics context.
 *  Live SOPs make Behavioral Health / Internal Medicine AI-groundable without a
 *  code change. */
function versionId(deptId, liveRecord) {
  if (liveRecord) return `active-sop:${deptId}:v${liveRecord.version ?? 'unversioned'}`;
  return deptId === 'obgyn' ? OBGYN_SOP_VERSION : `${deptId || 'pediatrics'}-hardcoded-fallback-v1`;
}

export function composeSopGrounding(deptId, liveRecord = null) {
  const department = SOP_CONTEXTS[deptId] ? deptId : 'pediatrics';
  const departmentSop = liveRecord?.body ?? SOP_CONTEXTS[department];
  const departmentAuthority = liveRecord ? 'active-supervisor-managed-sop' : 'hardcoded-department-fallback';
  return {
    department,
    sourceSopVersion: versionId(department, liveRecord),
    sourceAuthority: department === 'obgyn' ? OBGYN_SOURCE_AUTHORITY : departmentAuthority,
    departmentAuthority,
    context: [
      OWNER_CONFIRMED_ROUTING_OVERRIDES,
      `DEPARTMENT SOP SOURCE (${departmentAuthority}):\n${departmentSop}`,
      `GENERIC NAVIGATOR OPERATING MODEL (lowest authority):\n${NAVIGATOR_ROLE_CONTEXT}`,
    ].join('\n\n'),
  };
}

export function sopGroundingFor(deptId) {
  return composeSopGrounding(deptId, getLiveSopSyncRecord(deptId));
}

export async function sopGroundingForFresh(deptId) {
  return composeSopGrounding(deptId, await getLiveSopRecord(deptId));
}

export function sopContextFor(deptId) {
  return sopGroundingFor(deptId).context;
}

export async function sopContextForFresh(deptId) {
  return (await sopGroundingForFresh(deptId)).context;
}
