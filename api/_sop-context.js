// SOP context used to ground scenario generation. The leading underscore keeps
// Express from turning this file into an HTTP route — it is a helper module.
//
// Source: Aizer Health Pediatric Department SOP (updated version,
// "Pediatrics_SOP_Updated.pdf"). Organised by the six knowledge domains so
// Gemini can generate scenarios per domain. Keep factual and free of real
// patient data.
export const SOP_CONTEXT = `
PEDIATRIC CONTACT-CENTRE SOP — AIZER HEALTH PEDIATRIC DEPARTMENT

════════════════════════════════════════════════════════
DOMAIN 1: SITES & ROUTING
════════════════════════════════════════════════════════

LOCATIONS:
- 49 Forest Road: Near Landau's Supermarket and Kiryas Joel Shopping Center. Short drive
  to Walmart Supercenter and the busy Route 17M commercial area.
- 48 Bakertown Road: Near Chasuna Mall and the business center.
- 1200 NY-208, Blooming Grove: Positioned directly on NY Route 208, main road serving
  Monroe and surrounding Orange County communities. Located within or near Blooming
  Grove Plaza. Dr. Dina Faiden is primarily stationed at this location.

KEY ROUTING RULES:
- Each site has distinct lab/nurse designations to prevent cross-site errors.
  - Bakertown: "BK" prefix → BK Peds Lab, BK Peds Nurse.
  - Forest Road (hub): Peds Lab, Ped Nurse.
  - Blooming Grove: 208-Lab, 208-Nurse. NO on-site lab — all specimens must be routed externally.
- Blooming Grove: Monday–Thursday ONLY. Provider: Dr. Dina Faiden ONLY.
- Specialists are Forest Road only — they do NOT rotate to Bakertown or Blooming Grove.
- When routing calls, confirm site capability before booking lab or specialist appointments.

════════════════════════════════════════════════════════
DOMAIN 2: SCHEDULING & VISIT RULES
════════════════════════════════════════════════════════

APPOINTMENT TYPES:

Newborn Physical Exam (NB PE)
- Must be done within the first 6 weeks of birth (infants older than 6 weeks get a regular Physical Exam).
- Performed by Dr. Polinger and Dr. Frommer ONLY.
- ALWAYS schedule at the START of the provider's shift (hygiene reasons).
- Write in ECW: "NB PE", the lab ID number from the hearing screening test, delivery hospital.
- If born at Good Samaritan (GS): write "GS" in the reason AND ask for the hearing screening lab ID number.
- NB follow-up schedule (months): 1, 2, 4, 6, 9, 12, 15, 18, 24.
- If NB PE was at 1 month, the next (first regular PE) is at 2 months. If NB PE was within days
  of birth, the regular PE is at 1 month (may be less than 1 month from last PE). After the first
  regular PE, follow the standard 2-month gap then the schedule above.
- Always check the last PE notes in Encounters for when the next follow-up should be.

Physical Exam (PE)
- Frequency: every 2 months up to 6 months of age → every 3 months up to 2 years → annually
  at 2 years and older.
- Insurance covers physicals annually. Check Encounters to confirm >1 year since last PE.
- Early Physical Exception — allowed ONLY if ALL THREE conditions are met:
  1. Patient has Fidelis Managed Care OR Medicaid.
  2. It has been at least 6 months since the last PE.
  3. The child has had a birthday and reached the NEXT age milestone (e.g., turned 6).
- Write in ECW: PE, PE+SHOTS, PE+fever, etc., depending on the reason.
- First-timer under 2 years old: force PE with ANY provider EXCEPT Polinger, Frommer, Robin,
  Lori, and Faiden (when moms insist on a specific provider, ask for approval).

Same-Day Sick Visit
- For patients with symptoms: fever, crankiness, cold, coughing, wheezing, rash, sneezing, etc.
- Can ONLY be booked on the same day of the visit — never pre-booked.
- Write all symptoms in the reason section (e.g., "FEVER + Cough").

Office Visit (OV)
- Mostly for follow-up on previous visits or the latest PE exam.
- Not templated on the schedule — we can turn any same-day sick visit slot into an OV if a
  follow-up is written by the doctor on the report of a previous appointment.
- Can be pre-booked, unlike same-day sick visits.

Pre-Operation Visit
- For patients who will undergo surgery — checks vitals and reaction under anesthesia.
- Write: type of surgery, date of surgery, name of surgeon or hospital.
- Not templated — we can turn any same-day sick visit slot into a pre-op visit.

PED HOS FU (ER / Hospital Follow-Up)
- For patients recently discharged from the hospital who need follow-up with the primary care
  provider at Aizer.
- Not templated — we can turn any same-day sick visit slot into an ER follow-up visit.

WIC Form Requests
- Can be handled by sending a TE to the Peds Telephone Encounter queue.
- We can also book an appointment as an OV and add the reason as "HEMO."

Tongue Tie Appointment
- Performed within 5 weeks from the child's delivery.
- If a parent calls to schedule and the child is MORE than 5 weeks old, our providers can only
  confirm the tongue tie and refer the patient to an outside provider.
- Booked as OV or same-day sick visit.

Weight Check
- If the PE is up to date, send a TE to Sally Carilli.

Lactation Appointments
- 30-minute OV appointment.
- ONLY performed by: Robin Aschkenasy, Tamar Dachoh, and Chana Heintz.

Early Intervention
- Refers to specialized therapies, services, and educational supports for babies, toddlers, and
  young children with developmental delays, disabilities, or medical conditions.
- Send a TE to the PEDS TELEPHONE ENCOUNTER queue.

SCHEDULING RULES & SPECIAL NOTES:
- If PE is NOT up to date, the patient is NOT entitled to: a referral · a specialty care appointment ·
  shots, immunizations, or vaccinations · medication refills (in some cases). Schools may also
  require the PE to be up to date for children to attend school.
- Schedule is divided into 10-minute slots; each provider has a different total number of patients
  they can see per slot. Check the billing alert — if it states the patient requires extra time or is a
  chronic patient (e.g., ADHD, Anxiety), adjust accordingly.
- New Spanish-speaking patients with Dr. Dina Faiden: 30 minutes (an extra 10 min) to discuss
  the child's history.
- Same-day sick visits can be booked only on the SAME DAY. OVs, pre-ops, and ER follow-ups are
  not templated — we can turn any same-day sick visit slot into those types and pre-book them.
- Controlled substance follow-ups: must go through Sally Carilli via TE; scheduled in specifically
  approved time slots — NOT regular slots.
- Lori Lambert: maximum 30 patients per day.

ARRIVAL INSTRUCTIONS:
- Always tell the parent the appointment time is 10 minutes EARLIER than the actual time.
- Note the earlier time told in "General Notes."
- If you told the actual time, do NOT write it in "General Notes."

IMMUNIZATION SCHEDULING:
- Flu and allergy shots can be booked directly by the inbound team.
- Friday is dedicated to allergy shots ONLY, every 30 minutes apart.
- For flu shot calls on a Friday: transfer to Acute Care Department.
- All other immunization calls: direct to Marisa Kraft or Jeanette Alcantara (or TE if unavailable).
  - Marisa Kraft: Sunday 9AM–5PM; Monday–Thursday 12PM–8PM.
  - Jeanette Alcantara: Monday–Thursday 9AM–4PM; Friday 9AM–2PM.

FAMILY / SIBLING APPOINTMENTS:
- Right-click confirmed appointment → "Family Appointment" → "Create copy for family" → select
  sibling → paste in next available slot (back-to-back preferred).
- Double Booking Siblings: if no adjacent slots, paste next to existing appointment. Change visit
  type to "Same Day Visit," remove old notes, add new reason, append "ADDED" so providers know
  it is a family grouping.

════════════════════════════════════════════════════════
DOMAIN 3: PROVIDER MATCHING
════════════════════════════════════════════════════════

PRIMARY CARE PROVIDERS:

Dr. Adam Polinger (MD)
- Most requested provider. Speaks English, Spanish, Hebrew, and Yiddish.
- Good Samaritan (GS) affiliated. Performs Deliveries & Newborn Physicals.
- Booking: up to 3 patients per 10-min slot; accepts double/triple booking.
- Physicals: 20 min for age ≥2 years; 10 min for age <2 years.
- Complex Rules: Can combine types (e.g., one 20-min PE + two 10-min sick visits, or two 10-min
  PEs in a 20-min block). Max 3 patients per time frame for a 20-min PE.
- Newborns: Wednesdays only (10-min slots, can be double booked).
- Comfortable with ALL patient demographics.

Dr. Eliezer Frommer (MD)
- Speaks English and Yiddish. Good Samaritan (GS) affiliated.
- Performs Deliveries & Newborn Physicals.
- Style: strict, fast-paced. NOT comfortable with teenage females.
- Physicals: 10 min for ≤12 months (non-NB); 20 min for >1 year.
- Newborns: Thursdays, first thing in the morning.

Lazar Khaimov
- Speaks English and Yiddish.
- High volume; double/triple booking OK for sick visits; double OK for physicals.
- NOT comfortable with teenage females.

Dr. Dina Faiden (formerly Donna Deck)
- Speaks English and Spanish. Fluent in Spanish.
- Location: Blooming Grove/208 Mon–Thu ONLY; Forest Road every other Sunday.
- Physicals: 20 min for ALL ages. New Spanish-speaking patients: 30 min.
- Booking: Follow the template as-is. NOT comfortable with teenage males.

Lori Lambert
- Speaks English only.
- Max 30 patients per day. Part-time (Tuesday and Friday nights).
- On Friday: no PE in the template, but a navigator CAN change the first same-day sick visit to
  a PE for the FIRST appointment only.
- NOT comfortable with teenage males.

Robin Aschkenasy
- Speaks English and Yiddish. No Fridays.
- Performs lactation appointments.
- Booking: sibling double booking OK. 20-min physicals.
- NOT comfortable with teenage males.

Tamar Dachoh
- Speaks English only. No Fridays.
- Performs lactation appointments.
- Booking: sibling double booking OK. 20-min physicals.
- NOT comfortable with teenage males.

Chana Heintz
- Speaks English, Hebrew, and Yiddish.
- ONLY provider who performs stitches (all providers can REMOVE stitches).
- Performs lactation appointments.
- Booking: double booking OK for sick visits (2 per line); NO double booking for physicals.
- NOT comfortable with teenage males.

Lily Namanworth
- Speaks English, Spanish, and Yiddish. No Fridays.
- Booking: NO double/triple booking (exception: siblings only).
- NOT comfortable with teenage males.

SPECIALISTS (Forest Road only — 1 day/month; patients need a referral valid 1 year):
- Aizer's 5 pediatric specialties: Cardiology, Pulmonology, Allergy, Rheumatology, ENT.
  (Transfer other specialties elsewhere.)
- ENT and Cardiology do NOT use the Aizer system — no labs or encounters visible. Give patient
  the specialist's main office number.
- Allergists and Rheumatologists use the Aizer system. Nurse contact for Allergy results: Alvarine Powell.
- Always check the specialists' schedule in the Teams group chat.

Dr. Rubin S. Cooper (Cardiology): 1st Thursday. 30-min appointments. NO United Healthcare.
  MVP accepted only with secondary Medicaid.
Dr. Sankaran Krishnan (Pulmonology): One Tuesday every month. 30 min F/U; 40 min New Patient.
Dr. John Welter (Pulmonology): 2nd Tuesday every month. 40 min F/U; 60 min New Patient.
Dr. Jillian Hochfelder (Allergy): Mostly one Wednesday every month. 30-min appointments. The
  first slot of shift/post-lunch is ALWAYS a Food Challenge.
Dr. Subhadra Siegel (Allergy): Mostly one Thursday every month. 30-min appointments. The first
  slot of shift/post-lunch is ALWAYS a Food Challenge.
Dr. Beth Gottlieb (Rheumatology): 1st Tuesday. 20 min F/U; 40 min New Patient. NO United
  Healthcare (outside Aizer).
Dr. Lianne DeSerres (ENT): 3rd Wednesday. 20-min appointments. Sibling double booking ALLOWED
  (the ONLY specialty where this is permitted).
Dr. Tali Lando (ENT): 1st Tuesday. 20-min appointments. Sibling double booking ALLOWED.

════════════════════════════════════════════════════════
DOMAIN 4: CALL ROUTING & REFERRALS
════════════════════════════════════════════════════════

NEVER give test results or medical advice by phone. Route to the PEDS Encounters queue.

KEY STAFF CONTACTS:
- Marisa Kraft (PEDS): Shots, immunizations, vaccinations, digital imaging — TE only if PE is up to date.
- Hayley Newton (Ext. 1909): ENT and nutritionist — TE only if PE is up to date.
- Anisa Azeez (Ext. 1911, PEDS Encounters queue): All referral-related TEs — PE must be up to date.
- Sally Carilli (Ext. 1934, Referral Specialist): Controlled substance follow-ups via TE in approved
  time slots only. Also: weight management, behavioral concerns, Vanderbilt forms, panic/depression
  / sensitive mental health topics. Lab results (if black lock exists) and medical questions — include
  best call-back number.

TELEPHONE ENCOUNTER (TE) STEP-BY-STEP GUIDE:

1. Lab Results Inquiry → PEDS Encounters queue
   - Open patient chart in ECW and check the labs.
   - If a BLACK LOCK exists on the lab, do NOT discuss the results with the parent.
   - Check existing TEs — there may already be instructions left by a provider or nurse.
   - Send a TE to PEDS Encounters queue asking a nurse to call the parent.
   - Include: best call-back number, which lab(s) the parent is asking about, any existing instructions.

2. Medical Question → PEDS Encounters queue
   - Listen to the parent's question; open the patient chart in ECW.
   - Send a TE to PEDS Encounters queue.
   - Include: best call-back number, the medical question as described by the parent.

3. Shots / Immunizations / Vaccinations → PEDS Marisa Kraft (TE only if PE is up to date)
   - We do NOT schedule shots, immunizations, or vaccination appointments directly.
   - Verify PE is up to date first.
   - If PE IS up to date: send a TE to PEDS Marisa Kraft with parent call-back number and PE confirmation.
   - If PE is NOT up to date: patient is not entitled — advise and schedule PE first.

4. ENT / Nutritionist Referral → Hayley Newton
   - Verify PE is up to date.
   - If PE IS up to date: send a TE to Hayley Newton with specialty needed and PE confirmation.
   - If PE is NOT up to date: patient cannot receive a referral.

5. Referral Request → Anisa Azeez (Referral Specialist)
   - Verify PE is up to date.
   - If PE IS up to date: send a TE to Anisa Azeez with parent call-back number and PE status.
   - If PE is NOT up to date: patient cannot receive a referral — schedule PE first.

6. Controlled Substance Follow-Up → Sally Carilli (Ext. 1934)
   - Must go through Sally Carilli via TE — not regular scheduling.
   - Schedule only in specifically approved time slots.
   - Include in TE: parent call-back number, nature of the follow-up.
   - Controlled substance list: Adderall, Amphetamine, Concerta, Methylphenidate, Guanfacine,
     Strattera, Intuniv, Ritalin, Vyvanse, Focalin, Xanax, Alprazolam.
   - Tylenol/Motrin: insurance-covered only if dispensed BEFORE checkout; after checkout = OTC.

7. Digital Imaging Request → PEDS Marisa Kraft (TE only if PE is up to date)
   - We do NOT schedule digital imaging appointments directly.
   - Verify PE is up to date.
   - If PE IS up to date: send a TE to PEDS Marisa Kraft with parent call-back number and PE confirmation.

8. Specialty Care — Vision, Speech, PT/OT, Podiatry → Transfer call to relevant queue
   - For Vision, Speech, Physical Therapy, Occupational Therapy, and Podiatry:
     transfer the call to the relevant queue directly. No TE required.

9. Medication Refill Request → PEDS Encounters queue (HIGH PRIORITY if out of medication)
   - Check the logs on the patient hub; check the ePrescription logs.
   - Copy the medication name and the name of the provider who prescribed it.
   - Send a TE to PEDS Encounters queue.
   - If patient is COMPLETELY out of the medication: tag the TE as HIGH PRIORITY.
   - Patient will NOT get a refill if PE is not up to date.
   - Include: best call-back number, medication name, prescribing provider name, PE status,
     whether patient is completely out of medication.

REFERRAL ROUTING DECISION TREE:
1. PE UTD + specialty IS within Aizer's 5 pediatric specialties → TE to Hayley Newton.
2. PE UTD + specialty is NOT within Aizer's 5 specialties → TE to Anisa Azeez.
3. PE NOT UTD + condition is emergency/urgent OR referral is on file + specialty NOT within 5 →
   TE to Anisa Azeez and/or transfer.
4. PE NOT UTD + condition is emergency/urgent OR referral is on file + specialty IS within 5 →
   TE to Hayley Newton explaining situation and/or transfer.
5. PE NOT UTD + condition is NOT emergency → book PE; do NOT send TE to Hayley. Put referral
   request in the PE reason.

WHEN TO SEND TE TO SALLY CARILLI:
- Controlled substance refills and follow-ups.
- Weight management follow-ups.
- Weight check (if PE is up to date).
- Behavioral concerns.
- Vanderbilt form discussions.
- Panic disorders, depression, or any sensitive mental health topic.
- Child below 2 years calling to book an OV (not sick, not urgent) while PE is not UTD: best case
  is to try to book as PE with any provider. If they insist on a specific provider AND there are
  red-flag indicators in Encounters (prior OV reasons, medications, departments visited), send TE
  to Sally. Also send TE to Sally if the parent says they want to discuss something with the doctor
  — get a headline first and check Encounters.

FORMS & ADMINISTRATIVE:
- School Physical Form: If PE is UTD → fax PE results to caller's number. If not → schedule PE.
- If a school (not the parent) calls requesting the PE, the school must be added to the patient's
  HIPAA authorization before anything is sent.
- If any medical or clinical entity requests anything be sent to them, MRC must be up to date.
- WIC form requests: TE to Peds Telephone Encounter queue OR book as OV with reason "HEMO."
- Prescription refills / chart files by email: send TE to PEDS Telephone Encounter queue.
- Anisa Azeez — 2020 Transportation Forms (for Medicaid patients): gather specialty, specialist
  name (NPI from Google: doctor's name + NY), address of health center, reason for visiting
  specialist out of county, date of appointment, and confirm referral is on file.

LAB ORDERS:
- Check Patient Hub → Labs.
- If lab was ordered but not yet collected: TE to Marisa Kraft or Jeanette Alcantara.
- If no order exists: put patient on hold and investigate. For same-day visits: patient must see a
  provider to order labs. For advance bookings: if PE is UTD, schedule an OV on a different day;
  if PE is not UTD, schedule PE with reason "PE+Labs for [what labs parent is requesting]"
  (e.g., "PE+b/w").
- X-Rays: same as lab orders — order must be in the chart before scheduling; never give results;
  transfer to PEDS Encounters queue.

════════════════════════════════════════════════════════
DOMAIN 5: INSURANCE & ELIGIBILITY
════════════════════════════════════════════════════════

ELIGIBILITY STATUS INDICATORS (on the schedule):
- Green (Y): Eligible.
- Yellow (Y): Active, but PCP is NOT Aizer (warn patient) — OR straight Medicaid as primary insurance.
- Black (?): Eligibility not run yet.
- Red (X): Inactive.
- Red (!): Info received but unverified / error.

PLAN-SPECIFIC RULES:
- Managed Care (e.g., Fidelis Managed Care): patient has Medicaid as a secondary payer. For all
  Medicaid/Managed Care: set "Relationship to Insured" to Self (1).
- CHP (Child Health Plus): a Managed Care plan WITHOUT Medicaid.
- Fidelis: member ID usually starts with the number 7.
- Medicaid: member ID starts AND ends with a letter.
- United Healthcare (UHC) — Commercial: requires prior authorization online for specialist visits.
- Healthfirst (JLJ): ONLY accepted if patient has active Medicaid as secondary AND the member ID
  is the same as the Medicaid ID.
- Dr. Cooper (Cardiology): does NOT accept United Healthcare; requires secondary Medicaid for MVP.
- Dr. Gottlieb (Rheumatology, outside Aizer): does NOT accept United Healthcare.
- Fidelis + Medicaid early PE exception: can repeat early if patient had a birthday AND last PE
  was at least 6 months ago.

COPAYS:
- No copay for: Annual physicals; Medicaid patients (Medicaid covers balance); Managed Care
  plans with Medicaid secondary.

UNINSURED / SELF-PAY:
- Sliding Fee Scale: income-based, offered in-person by the front desk only (not inbound/outbound
  team). First visit $25. Patient must sign form in-person. Valid 1 year.
- Flat Self-Pay: $100 per visit.

PE NOT UP TO DATE — CONSEQUENCES:
❌ Not entitled to a referral
❌ Not entitled to a specialty care appointment
❌ Not entitled to shots, immunizations, or vaccinations
❌ Not entitled to medication refills (in some cases)
📋 Schools may require PE to be up to date for children to attend school

════════════════════════════════════════════════════════
DOMAIN 6: REGISTRATION & CONFIRMATION
════════════════════════════════════════════════════════

ACCOUNT SEARCH:
- ALWAYS search by phone number first to pull up all linked family accounts.

BOOKING PROCESS:
- Provider → Time → Department → Reason → Confirm Facility & Address.

ARRIVAL INSTRUCTIONS:
- Tell the parent the appointment time is 10 minutes EARLIER than the actual time.
- Note the earlier time told in "General Notes."
- If you told the actual time, do NOT note it in "General Notes."

CONFIRMATION COLOR CODES (real-time audit trail for no-show reduction):
- White: No confirmation attempt.
- Blue/Green: Automated or manual message left.
- Purple with "V": Staff-confirmed — a person was reached and verbally confirmed. This is the target.

HIPAA & FORMS:
- School form fax: PE must be UTD. If school (not parent) calls requesting PE results, add the
  school to the patient's HIPAA authorization before sending anything.
- Medical or clinical entity requesting records: MRC must be up to date.

OTC MEDICATIONS (Tylenol / Motrin):
- Insurance covers them only if dispensed BEFORE patient checkout. Post-checkout = OTC purchase.

FAMILY SCHEDULING:
- Right-click confirmed appointment → "Family Appointment" → "Create copy for family" → select
  sibling → paste back-to-back.
- If no adjacent slots: paste next to existing, change to "Same Day Visit," remove old notes,
  add new reason, append "ADDED."

PRESCRIPTION REFILLS / FILES:
- Send TE to PEDS Telephone Encounter queue.

PE FREQUENCY CALCULATOR:
- 0–6 months: Every 2 months.
- 6 months – 2 years: Every 3 months.
- 2 years and older: Annually.
- Fidelis + Medicaid early exception: repeat allowed if patient had a birthday AND last PE ≥ 6 months ago.
`.trim();
