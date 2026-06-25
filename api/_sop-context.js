// SOP context used to ground scenario generation. The leading underscore keeps
// Express from turning this file into an HTTP route — it is a helper module.
//
// Source: Aizer Health Pediatric Department SOP (final version, "Pediatrics Department.pdf").
// Organised by the six knowledge domains so Gemini can generate scenarios per domain.
// Keep factual and free of real patient data.
export const SOP_CONTEXT = `
PEDIATRIC CONTACT-CENTRE SOP — AIZER HEALTH PEDIATRIC DEPARTMENT

════════════════════════════════════════════════════════
DOMAIN 1: SITES & ROUTING
════════════════════════════════════════════════════════

LOCATIONS:
- Baker Town: 48 Baker Town Rd. Labs/Nurses use "BK" prefix → BK Peds Lab, BK Peds Nurse.
- Forest Road (hub): 49 Forest Rd. Labs/Nurses → Peds Lab, Ped Nurse. Specialists and most equipment are here. Complex cases and multidisciplinary care concentrated here.
- Blooming Grove: 1200 Route 208. Monday–Thursday ONLY. Provider: Dr. Dina Faiden ONLY. Labs/Nurses → 208-Lab, 208-Nurse. NO on-site lab — all specimens must be routed externally.

KEY ROUTING RULES:
- Each site has distinct lab/nurse designations to prevent cross-site errors.
- Blooming Grove cannot perform on-site lab work — specimens go external.
- Specialists are Forest Road only (they do not rotate to Baker Town or Blooming Grove).
- When routing calls, confirm the site capability before booking lab or specialist appointments.

════════════════════════════════════════════════════════
DOMAIN 2: SCHEDULING & VISIT RULES
════════════════════════════════════════════════════════

GENERAL BOOKING PROCESS:
- Search by PHONE NUMBER first to pull up all family members (linked accounts).
- Booking order: Select Provider → Time → Department → Reason → Confirm Facility & Address.

FAMILY / SIBLING APPOINTMENTS:
- Right-click confirmed appointment → "Family Appointment" → "Create copy for family" → Select sibling → Paste in next available slot (back-to-back preferred).
- Double Booking Siblings: If no adjacent slots, paste next to existing appointment. Change visit type to "Same Day Visit," remove old notes, add new reason, and append "ADDED" to reason so providers know it is a family grouping.

ARRIVAL INSTRUCTIONS:
- Always tell the parent the appointment time is 10 minutes EARLIER than the actual appointment time.
- Note the earlier time you told them in "General Notes."
- If you told the parent the actual time, do NOT write it in "General Notes."

PHYSICAL EXAM (PE) RULES:
- Insurance covers physicals annually. Check "Encounters" to confirm >1 year since last physical.
- Early Physical Exception — allowed ONLY if ALL THREE conditions are met:
  1. Patient has Fidelis Managed Care.
  2. It has been at least 6 months since the last PE.
  3. The child has reached the NEXT age milestone (e.g., turned 6).
- First-timer under 2 years old: force PE with ANY provider EXCEPT Polinger, Frommer, Robin, Lori, and Faiden (when moms insist on a specific provider, you can ask for approval).

NEWBORNS (NB) — Infants 6 weeks or less (older than 6 weeks = regular physical):
- ALWAYS schedule at the START of a provider's shift (hygiene reasons).
- Ask parent which hospital the child was born at. If Good Samaritan (GS), write "GS" in the reason AND ask for the hearing screening test lab ID number — note it in the reason.
- NB follow-up schedule (months): 1, 2, 4, 6, 9, 12, 15, 18, 24.
- If NB PE was at 1 month, the next (first regular PE) is at 2 months (1 month after). If NB PE was within days of birth, the regular PE is at 1 month (may be less than 1 month from last PE). After the first regular PE, follow the standard 2-month gap then the schedule above.
- Always check the last PE notes in Encounters to see when the next follow-up should be.

IMMUNIZATION SCHEDULING (see also Domain 4 — Routing):
- Flu and allergy shots can be booked directly by the inbound team (no clinical validation required).
- Friday is dedicated to allergy shots ONLY, every 30 minutes apart.
- For flu shot calls on a Friday: transfer to Acute Care Department.
- All other immunization calls: direct to Marisa Kraft or Jeanette Alcantara.

════════════════════════════════════════════════════════
DOMAIN 3: PROVIDER MATCHING
════════════════════════════════════════════════════════

DOCTORS (MD/DO):

Dr. Adam Polinger (MD):
- Most requested. Speaks Spanish, Hebrew, Yiddish. Good Samaritan (GS) affiliated.
- Booking: accepts double/triple booking. Comfortable with teenage females.
- Physicals: 20 min for age ≥2 years; 10 min for age <2 years.
- Complex Rules: Can combine types (e.g., one 20-min PE + two 10-min sick visits, or two 10-min PEs in a 20-min block). Max 3 patients per time frame for a 20-min PE; can book four 10-min PEs in a 20-min block. Generally follow his template.
- Newborns: Wednesdays only (10-min slots, can be double booked).

Dr. Eliezer Frommer (MD):
- Speaks Yiddish. GS affiliated.
- Style: strict, fast-paced. NOT comfortable with teenage females.
- Physicals: 10 min for ≤12 months (non-NB); 20 min for >1 year.
- Newborns: Thursdays, first thing in the morning.

Dr. Lazar Khaimov (DO):
- High volume.
- Booking: double/triple OK for sick visits; double OK for physicals.
- NOT comfortable with teenage females.

Dr. Chana Heintz (MD):
- The ONLY provider who performs stitches. (All providers can REMOVE stitches.)
- Booking: double booking OK for sick visits (2 per line); NO double booking for physicals.
- NOT comfortable with teenage males.

Dr. Tamar A. Dachoh (MD):
- Works most of the week; NO Fridays.
- Booking: sibling double booking OK. 20-min physicals.
- NOT comfortable with teenage males.

Dr. Dina Faiden (MD):
- (Formerly Donna Dick.) Fluent in Spanish.
- Location: Blooming Grove/208 Mon–Thu; Forest Road every other Sunday.
- Physicals: 20 min for ALL ages.
- Booking: Follow the template as-is. NOT comfortable with teenage males.

NURSE PRACTITIONERS (NP) & PHYSICIAN ASSISTANTS (PA):

Robin Aschkenasy (PA):
- Speaks Yiddish. NO Fridays.
- Booking: sibling double booking OK. 20-min physicals.
- NOT comfortable with teenage males.

Lily Namanworth (NP):
- Fluent in Spanish and Yiddish. NO Fridays.
- Booking: NO double/triple booking (exception: siblings only).
- NOT comfortable with teenage males.

Lori Lambert-Derario (NP):
- Part-time: Tuesday and Friday nights. Non-Jewish.
- Booking: Regularly starts shift with a PE; follow the template. On Friday there is no PE in the template, but a navigator CAN change the first same-day sick visit to a PE for the FIRST appointment only. Willing to double book up to 30 patients/day max.
- NOT comfortable with teenage males.

SPECIALISTS (Forest Road only — 1 day/month; patients need a referral valid 1 year):
- Pediatrics specialties at Aizer: Cardiology, Pulmonology, Allergy, Rheumatology, ENT. (Transfer other specialties elsewhere.)
- ENT and Cardiology do NOT use the Aizer system — no labs or encounters visible. Give patient the specialist's main office number.
- Allergists and Rheumatologists use the Aizer system. Nurse contact for Allergy results: Alvarine Powell.
- Always check the specialists' schedule in the Teams group chat.

Dr. Rubin S. Cooper (Cardiology): 1st Thursday. 30-min appointments. NO United Healthcare. MVP accepted only with secondary Medicaid.
Dr. Sankaran Krishnan (Pulmonology): One Tuesday every month. 30 min follow-up (F/U); 40 min new patient (NP).
Dr. John Welter (Pulmonology): 2nd Tuesday every month. 40 min F/U; 60 min NP.
Dr. Jillian Hochfelder (Allergy): Mostly one Wednesday every month. 30-min appointments. First slot of shift/post-lunch is ALWAYS a Food Challenge.
Dr. Subhadra Siegel (Allergy): Mostly one Thursday every month. 30-min appointments. First slot of shift/post-lunch is ALWAYS a Food Challenge.
Dr. Beth Gottlieb (Rheumatology): 1st Tuesday. 20 min F/U; 40 min NP. NO United Healthcare (outside Aizer).
Dr. Lianne DeSerres (ENT): 3rd Wednesday. 20-min appointments. Sibling double booking ALLOWED (only specialty where this is permitted).
Dr. Tali Lando (ENT): 1st Tuesday. 20-min appointments. Sibling double booking ALLOWED.

════════════════════════════════════════════════════════
DOMAIN 4: CALL ROUTING & REFERRALS
════════════════════════════════════════════════════════

NEVER give test results or medical advice by phone. Route to "Q-Pediatrics Nursing Inquiries" (Ext. 6013). If no nurse is available, send a TE to "PEDS,Telephone Encounters."

KEY CONTACTS:
- Sally Carilli (Ext. 1934): Mental health, behavioral, controlled substance refills.
- Hayley Newton (Ext. 1909): Pediatric specialist scheduling (for Aizer's 5 pediatrics specialties only).
- Anisa Azeez (Ext. 1911): External referrals and 2020 Transportation forms.

WHEN TO SEND TE TO SALLY CARILLI:
- Controlled substance refills: Adderall/Amphetamine, Concerta/Methylphenidate, Guanfacine, Strattera, Intuniv/Amphetamine, Ritalin, Vyvanse, Focalin, Xanax/Alprazolam.
- Controlled substance follow-up discussions.
- Weight management follow-ups.
- Behavioral concerns.
- Vanderbilt form discussions.
- Panic disorders, depression, or any sensitive mental health topic.
- Child below 2 years calling to book an OV (not sick, not urgent) while PE is not UTD: best case is to try to book as PE with any provider. If they insist on a specific provider AND there are red-flag indicators in Encounters (prior OV reasons, medications, departments visited), send TE to Sally. Also send TE to Sally if the parent says they want to discuss something with the doctor — get a headline first and check Encounters.

REFERRAL ROUTING DECISION TREE:
1. PE UTD + specialty IS within Aizer's 5 pediatrics specialties → TE to Hayley Newton (or cold transfer; tell patient to leave voicemail if no answer).
2. PE UTD + specialty is NOT within Aizer's 5 pediatrics specialties → TE to Anisa Azeez (or cold transfer).
3. PE NOT UTD + condition IS emergency/urgent (but not hospital-level) or referral IS on file + specialty is NOT within 5 specialties → TE to Anisa Azeez and/or transfer.
4. PE NOT UTD + condition IS emergency/urgent (but not hospital-level) or referral IS on file + specialty IS within 5 specialties → TE to Hayley Newton explaining situation and/or transfer.
5. PE NOT UTD + condition is NOT an emergency → book PE; do NOT send TE to Hayley. Referral request goes in the PE reason.

ANISA AZEEZ — 2020 TRANSPORTATION FORMS (for Medicaid patients):
Gather: Specialty, specialist's name (get NPI from Google: doctor's name + NY), address of health center (Google for address), reason for visiting specialist out of county (and whether patient has seen specialist in county), date of appointment, confirm referral is on file.

HAYLEY NEWTON: Handles scheduling for the 5 pediatrics specialties. If a patient's specialty is not one of the 5, do NOT transfer — verify first.

IMMUNIZATION & LAB ROUTING:
- All calls requesting immunizations: direct to Marisa Kraft or Jeanette Alcantara for scheduling.
  - Marisa Kraft: Sunday 9AM–5PM; Monday–Thursday 12PM–8PM.
  - Jeanette Alcantara: Monday–Thursday 9AM–4PM; Friday 9AM–2AM.
  - If either is available, perform a soft transfer (warm transfer). If unavailable, send a TE.
- Lab orders — check Patient Hub > Labs:
  - If lab was ordered but not collected: TE to Marisa or Jeanette.
  - If no order exists: put patient on hold/investigate. For same-day: patient must see a provider to order labs. For advance bookings: if PE is UTD, schedule an OV on a different day; if PE is not UTD, advise parent and schedule PE with reason "PE+Labs for [what labs the parent is requesting]" (e.g., PE+b/w).
- X-Rays: same as lab orders — must be in the chart before scheduling; never give results; transfer to Q-Pediatrics Nursing Inquiries.

FORMS & ADMINISTRATIVE:
- School Physical Form: Check if PE is UTD. If yes → fax PE results to caller's number. If not → schedule PE.
- If a school (not parent) calls requesting the PE, the school must be added to the patient's HIPAA authorization.
- If any medical or clinical entity requests anything be sent to them, MRC must be up to date.
- Prescriptions refills or chart files emailed to patient: send TE to queue "PEDS,Telephone Encounter."
- Tylenol/Motrin: insurance-covered ONLY if dispensed before checkout. After checkout, patient must purchase OTC.

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
- Managed Care (e.g., Fidelis Managed Care): means patient has Medicaid as a secondary payer. For all Medicaid/Managed Care: set "Relationship to Insured" to Self (1).
- CHP (Child Health Plus): a Managed Care plan but WITHOUT Medicaid.
- Fidelis: member ID usually starts with the number 7.
- Medicaid: member ID starts AND ends with a letter.
- United Healthcare (UHC) — Commercial: requires prior authorization online for specialist visits.
- Healthfirst (JLJ): ONLY accepted if patient has active Medicaid as secondary, AND the member ID is the same as the Medicaid ID.
- Dr. Cooper (Cardiology) and Dr. Gottlieb (Rheumatology, outside Aizer): do NOT accept United Healthcare. Dr. Cooper also requires secondary Medicaid for MVP.

COPAYS:
- No copay for: Annual physicals; Medicaid patients (Medicaid covers balance); Managed Care plans + Medicaid secondary (commercial plan).

UNINSURED / SELF-PAY:
- Sliding Fee Scale: income-based, offered in-person by the front desk only (not by inbound or outbound team). First visit $25. Patient must sign form in-person. Valid 1 year.
- Flat Self-Pay: $100 per visit.

════════════════════════════════════════════════════════
DOMAIN 6: REGISTRATION & CONFIRMATION
════════════════════════════════════════════════════════

ACCOUNT SEARCH:
- ALWAYS search by phone number first to pull up all linked family accounts.

ARRIVAL INSTRUCTIONS:
- Tell parent the appointment time is 10 minutes EARLIER than actual. Note the time told in "General Notes."
- If you told the actual time, do NOT note it in "General Notes."

BOOKING PROCESS:
- Provider → Time → Department → Reason → Confirm Facility & Address.

CONFIRMATION COLOR CODES (real-time audit trail for no-show reduction):
- White: No confirmation attempt.
- Blue/Green: Automated or manual message left.
- Purple with "V": Staff-confirmed — a person was reached and verbally confirmed. This is the target state.

HIPAA & FORMS:
- School form fax: PE must be UTD. If school (not parent) calls requesting PE results, add the school to the patient's HIPAA authorization before sending anything.
- Medical or clinical entity requesting records: MRC must be up to date.

OTC MEDICATIONS (Tylenol / Motrin):
- Insurance covers them only if dispensed BEFORE patient checkout. Post-checkout = OTC purchase by patient.

FAMILY SCHEDULING:
- Right-click confirmed appointment → "Family Appointment" → "Create copy for family" → Select sibling → Paste back-to-back.
- If no adjacent slots: paste next to existing, change to "Same Day Visit," remove old notes, add new reason, append "ADDED."

PRESCRIPTION REFILLS / FILES:
- Send TE to "PEDS,Telephone Encounter" queue.
`.trim();
