// ─────────────────────────────────────────────────────────────────────────────
// DOMAINS + QUESTIONS — the content of the check.
//
// Derived from the team SOP (Aizer Health Pediatric Department operational
// report). These are SCENARIO questions: they test application ("a patient
// calls wanting X, what do you do?"), not recall. Every question is tagged to
// a domain so scoring is per-domain.
//
// To edit: add/remove/adjust entries below. Each question needs a `domainId`
// that matches a domain `id`, an `options` array, and a `correctOptionId`.
// ─────────────────────────────────────────────────────────────────────────────

export const DOMAINS = [
  {
    id: 'sites',
    name: 'Sites & Routing',
    blurb: 'Which location does what — hub vs. satellites, site prefixes, on-site capabilities.',
  },
  {
    id: 'scheduling',
    name: 'Scheduling & Visit Rules',
    blurb: 'Well-visit timing, managed-care exceptions, newborn and tetanus protocols.',
  },
  {
    id: 'providers',
    name: 'Provider Matching',
    blurb: 'Booking nuances, demographic comfort, languages, and specialist constraints.',
  },
  {
    id: 'routing',
    name: 'Call Routing & Referrals',
    blurb: 'Who handles what — and what must never be answered on the phone.',
  },
  {
    id: 'insurance',
    name: 'Insurance & Eligibility',
    blurb: 'Eligibility indicators, plan-specific rules, and self-pay handling.',
  },
  {
    id: 'registration',
    name: 'Registration & Confirmation',
    blurb: 'Account search, arrival guidance, confirmation status, and forms/OTC handling.',
  },
];

export const QUESTIONS = [
  // ── Sites & Routing ────────────────────────────────────────────────────────
  {
    id: 'q-sites-1',
    domainId: 'sites',
    scenario:
      'A parent wants to bring their child to the Blooming Grove (Route 208) location for a routine blood draw. How do you handle the request?',
    options: [
      { id: 'a', text: 'Book the lab draw at Blooming Grove — it has a "208-Lab" routing code.' },
      { id: 'b', text: 'Explain Blooming Grove has no on-site lab; specimens are routed externally, so direct the draw accordingly.' },
      { id: 'c', text: 'Tell them no Aizer site can do blood draws.' },
      { id: 'd', text: 'Book it at Blooming Grove for any weekday.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-sites-2',
    domainId: 'sites',
    scenario:
      'You are booking a nursing service at the Baker Town location. What is the correct way to enter it in the system?',
    options: [
      { id: 'a', text: 'Use the standard "Peds Lab" / "Ped Nurse" designation, same as Forest Road.' },
      { id: 'b', text: 'Use the "BK" prefix (e.g., "BK Peds Lab") to keep site routing distinct.' },
      { id: 'c', text: 'Use the "208" prefix.' },
      { id: 'd', text: 'No prefix is needed; the system sorts by address.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-sites-3',
    domainId: 'sites',
    scenario:
      'A family asks for a complex, multidisciplinary visit and also asks which site Dr. Dina Faiden works at. What do you tell them?',
    options: [
      { id: 'a', text: 'Complex/multidisciplinary care is concentrated at the Forest Road hub; Dr. Faiden staffs Blooming Grove, Monday–Thursday.' },
      { id: 'b', text: 'Complex care happens at Blooming Grove; Dr. Faiden is at Baker Town all week.' },
      { id: 'c', text: 'All sites handle complex care equally; Dr. Faiden rotates daily.' },
      { id: 'd', text: 'Forest Road only handles routine visits; Dr. Faiden is at Forest Road Fridays.' },
    ],
    correctOptionId: 'a',
  },

  // ── Scheduling & Visit Rules ────────────────────────────────────────────────
  {
    id: 'q-sched-1',
    domainId: 'scheduling',
    scenario:
      'A parent with commercial/private insurance wants their child\'s annual physical scheduled exactly one year after the last one. What guidance applies?',
    options: [
      { id: 'a', text: 'Any date in the same calendar year is fine.' },
      { id: 'b', text: 'Follow the "one calendar year plus one day" rule to avoid claim denials.' },
      { id: 'c', text: 'Physicals can be done every six months on commercial plans.' },
      { id: 'd', text: 'Book it one day earlier to be safe.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-sched-2',
    domainId: 'scheduling',
    scenario:
      'A Fidelis (managed care) family wants an early physical because their child just turned 6. The last PE was 7 months ago. Is an early physical permitted?',
    options: [
      { id: 'a', text: 'No — managed care never allows early physicals.' },
      { id: 'b', text: 'Yes — it has been at least six months AND the child reached the next age milestone, so the exception applies.' },
      { id: 'c', text: 'Yes — reaching a new age alone is enough, regardless of timing.' },
      { id: 'd', text: 'Only if it has been a full calendar year.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-sched-3',
    domainId: 'scheduling',
    scenario:
      'You are booking a newborn (4 weeks old) for a first visit. Which handling is correct?',
    options: [
      { id: 'a', text: 'Book any open slot, no special alerts needed.' },
      { id: 'b', text: 'Book at the start of the provider\'s shift, request hospital discharge papers, and add the "NPP" or "MRC" alert.' },
      { id: 'c', text: 'Book at the end of the day to keep mornings open for sick visits.' },
      { id: 'd', text: 'Book mid-shift and skip paperwork until the visit.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-sched-4',
    domainId: 'scheduling',
    scenario:
      'A parent calls to schedule "just a quick tetanus shot" for their child after a minor injury, and says no exam is needed. What do you do?',
    options: [
      { id: 'a', text: 'Book the shot alone — tetanus is administrative.' },
      { id: 'b', text: 'Schedule a provider check-up immediately prior to the shot, since every tetanus administration requires one.' },
      { id: 'c', text: 'Only require an exam if the child is overdue for a physical.' },
      { id: 'd', text: 'Route the call to the lab team to administer it.' },
    ],
    correctOptionId: 'b',
  },

  // ── Provider Matching ───────────────────────────────────────────────────────
  {
    id: 'q-prov-1',
    domainId: 'providers',
    scenario:
      'A mother wants her 15-year-old daughter seen as soon as possible and asks who is available. Which provider is appropriate to offer?',
    options: [
      { id: 'a', text: 'Dr. Eliezer Frommer — he is fast-paced and has openings.' },
      { id: 'b', text: 'Dr. Adam Polinger — he is noted as comfortable with teenage females.' },
      { id: 'c', text: 'Dr. Lazar Khaimov — he is high volume.' },
      { id: 'd', text: 'Any provider; demographic comfort is not a booking factor.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-prov-2',
    domainId: 'providers',
    scenario:
      'A child needs stitches. Which provider should you book?',
    options: [
      { id: 'a', text: 'Dr. Tamar Dachoh.' },
      { id: 'b', text: 'Dr. Chana Heintz — the only provider for stitches.' },
      { id: 'c', text: 'Whichever provider has the next open slot.' },
      { id: 'd', text: 'Robin Aschkenasy, PA.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-prov-3',
    domainId: 'providers',
    scenario:
      'A family with United Healthcare wants a cardiology appointment with Dr. Cooper. How do you handle it?',
    options: [
      { id: 'a', text: 'Book it — all specialists accept United Healthcare.' },
      { id: 'b', text: 'Dr. Cooper does not accept United Healthcare; do not book that combination (MVP requires secondary Medicaid).' },
      { id: 'c', text: 'Book it only on the 2nd-last Tuesday of the month.' },
      { id: 'd', text: 'Refer them to Dr. Gottlieb instead — he takes UHC.' },
    ],
    correctOptionId: 'b',
  },

  // ── Call Routing & Referrals ────────────────────────────────────────────────
  {
    id: 'q-route-1',
    domainId: 'routing',
    scenario:
      'A patient asks you to read back their recent test results over the phone. What do you do?',
    options: [
      { id: 'a', text: 'Read the results if they verify their date of birth.' },
      { id: 'b', text: 'Never give results/medical advice by phone — route the call to the "Q-Pediatrics Nursing Inquiries" queue.' },
      { id: 'c', text: 'Summarize the results in plain language only.' },
      { id: 'd', text: 'Mail the results and end the call.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-route-2',
    domainId: 'routing',
    scenario:
      'A parent calls needing a refill of their teen\'s Concerta (a controlled substance). Where does this go?',
    options: [
      { id: 'a', text: 'Marisa Kraft or Jeanette Alcantara.' },
      { id: 'b', text: 'Sally Carilli (Ext. 1934), who routes controlled-substance refills and mental-health follow-ups.' },
      { id: 'c', text: 'Anisa Azeez (Ext. 1911).' },
      { id: 'd', text: 'Haley Newton (Ext. 1909).' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-route-3',
    domainId: 'routing',
    scenario:
      'A patient calls to request an immunization, and Marisa Kraft is currently available. What is the correct action?',
    options: [
      { id: 'a', text: 'Send a Telephone Encounter (TE) to Marisa.' },
      { id: 'b', text: 'Direct the call to Marisa (or Jeanette) and perform a "soft transfer" since she is available.' },
      { id: 'c', text: 'Book the immunization yourself.' },
      { id: 'd', text: 'Route it to Sally Carilli.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-route-4',
    domainId: 'routing',
    scenario:
      'A family needs a referral processed and asks about a 2020 Transportation form. Who handles this?',
    options: [
      { id: 'a', text: 'Haley Newton (Ext. 1909).' },
      { id: 'b', text: 'Anisa Azeez (Ext. 1911), who directs referrals and 2020 Transportation forms.' },
      { id: 'c', text: 'Sally Carilli (Ext. 1934).' },
      { id: 'd', text: 'The nursing inquiries queue.' },
    ],
    correctOptionId: 'b',
  },

  // ── Insurance & Eligibility ─────────────────────────────────────────────────
  {
    id: 'q-ins-1',
    domainId: 'insurance',
    scenario:
      'When you pull up a patient, the eligibility indicator shows a Yellow "Y". What does this mean for booking?',
    options: [
      { id: 'a', text: 'Eligible and Aizer is the primary care provider.' },
      { id: 'b', text: 'Active, but Aizer is NOT the primary care provider (PCP).' },
      { id: 'c', text: 'Verification is still pending.' },
      { id: 'd', text: 'Coverage is inactive or there is a data error.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-ins-2',
    domainId: 'insurance',
    scenario:
      'A patient has Healthfirst and asks to book. What must you confirm before treating it as accepted?',
    options: [
      { id: 'a', text: 'Nothing — Healthfirst is always accepted.' },
      { id: 'b', text: 'That the patient has active Medicaid as a secondary payer; Healthfirst is accepted only then.' },
      { id: 'c', text: 'That United Healthcare is their primary.' },
      { id: 'd', text: 'That they have prior authorization for a physical.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-ins-3',
    domainId: 'insurance',
    scenario:
      'An uninsured family asks about cost. What are the self-pay options?',
    options: [
      { id: 'a', text: 'A flat $25 fee for everyone.' },
      { id: 'b', text: 'A sliding fee scale starting at $25 (income-based, 1-year validity), or a flat self-pay of $100.' },
      { id: 'c', text: 'A flat $100 only; no sliding scale exists.' },
      { id: 'd', text: 'Self-pay is not offered.' },
    ],
    correctOptionId: 'b',
  },

  // ── Registration & Confirmation ─────────────────────────────────────────────
  {
    id: 'q-reg-1',
    domainId: 'registration',
    scenario:
      'You are registering a returning patient. What is the first search you should run, and why?',
    options: [
      { id: 'a', text: 'Search by last name to avoid duplicates.' },
      { id: 'b', text: 'Search by phone number first, to identify linked family accounts.' },
      { id: 'c', text: 'Search by date of birth first.' },
      { id: 'd', text: 'Create a new account immediately, then merge later.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-reg-2',
    domainId: 'registration',
    scenario:
      'In the confirmation color-coding system, a patient\'s appointment shows Purple with a "V". What does that signify?',
    options: [
      { id: 'a', text: 'No confirmation has been attempted.' },
      { id: 'b', text: 'Staff-confirmed (a person reached and confirmed the patient).' },
      { id: 'c', text: 'An automated or manual message was left.' },
      { id: 'd', text: 'The appointment was cancelled.' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q-reg-3',
    domainId: 'registration',
    scenario:
      'A parent calls after their child\'s checkout asking you to add Tylenol/Motrin to today\'s visit so insurance covers it. What do you tell them?',
    options: [
      { id: 'a', text: 'Add it now — OTC meds are always insurance-covered.' },
      { id: 'b', text: 'OTC meds are insurance-covered only if dispensed before checkout; post-checkout, the patient must purchase them.' },
      { id: 'c', text: 'Re-open the visit and bill it as a new appointment.' },
      { id: 'd', text: 'Route the request to the lab team.' },
    ],
    correctOptionId: 'b',
  },
];
