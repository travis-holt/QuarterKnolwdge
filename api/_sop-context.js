// SOP context used to ground scenario generation. The leading underscore keeps
// Vercel from turning this file into an HTTP route — it is a helper module.
//
// This is a distilled, de-identified summary of the Aizer Health Pediatric
// Department SOP, organised by the six knowledge domains. The owner can replace
// or extend this string with the full SOP text for richer generation; keep it
// factual and free of real patient data.
export const SOP_CONTEXT = `
PEDIATRIC CONTACT-CENTRE SOP — DOMAIN REFERENCE

SITES & ROUTING
- Forest Road is the hub; complex / multidisciplinary care is concentrated there.
- Blooming Grove (Route 208) has NO on-site lab; specimens route externally.
- Baker Town uses the "BK" prefix (e.g. "BK Peds Lab") to keep site routing distinct.
- Dr. Dina Faiden staffs Blooming Grove, Monday–Thursday.

SCHEDULING & VISIT RULES
- Commercial/private plans: annual physical follows the "one calendar year plus one day"
  rule to avoid claim denials.
- Managed care (e.g. Fidelis) allows an early physical only when BOTH: at least six months
  since the last PE AND the child has reached the next age milestone.
- Newborn first visit: book at the start of the provider's shift, request hospital discharge
  papers, add the "NPP" or "MRC" alert.
- Every tetanus administration requires a provider check-up immediately prior.

PROVIDER MATCHING
- Demographic comfort is a booking factor: Dr. Adam Polinger is noted as comfortable with
  teenage females.
- Stitches: Dr. Chana Heintz is the only provider.
- Dr. Cooper (cardiology) does NOT accept United Healthcare; MVP requires secondary Medicaid.

CALL ROUTING & REFERRALS
- Never give test results or medical advice by phone — route to the "Q-Pediatrics Nursing
  Inquiries" queue.
- Controlled-substance refills and mental-health follow-ups: Sally Carilli (Ext. 1934).
- Immunizations: Marisa Kraft or Jeanette Alcantara; if the owner is available, do a soft
  transfer rather than a Telephone Encounter (TE).
- Referrals and 2020 Transportation forms: Anisa Azeez (Ext. 1911).

INSURANCE & ELIGIBILITY
- Eligibility indicator Yellow "Y" = active coverage but Aizer is NOT the primary care provider.
- Healthfirst is accepted only when the patient has active Medicaid as a secondary payer.
- Self-pay: income-based sliding scale starting at $25 (1-year validity), or a flat $100.

REGISTRATION & CONFIRMATION
- Search returning patients by phone number first, to surface linked family accounts.
- Confirmation colour code Purple "V" = staff-confirmed (a person reached and confirmed).
- OTC meds (Tylenol/Motrin) are insurance-covered only if dispensed before checkout; after
  checkout the patient must purchase them.
`.trim();
