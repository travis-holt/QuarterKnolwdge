// SOP context used to ground scenario generation. The leading underscore keeps
// Express from turning this file into an HTTP route — it is a helper module.
//
// Source: Aizer Health Organization Operational Procedures SOP v1.0
// ("Pediatrics_SOP_Updated.pdf"). Faithful to the source — no content from
// prior SOP versions is carried forward. Organised by the six knowledge
// domains so Gemini can generate scenarios per domain.
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
   1. Check the logs on the patient hub.
   2. Check the ePrescription logs.
   3. Copy the medication name.
   4. Copy the name of the provider who prescribed the medication.
   5. Send a TE to the PEDS Encounters queue.
   6. If the patient is completely out of the medication, tag the TE as HIGH PRIORITY.
   7. Patient will not get a refill if the PE is not up to date.
   Include in TE: best call-back number · medication name (copied from logs) · name of the
   prescribing provider (copied from logs) · whether patient is completely out of medication
   (high priority if yes) · PE status (must be up to date).

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
