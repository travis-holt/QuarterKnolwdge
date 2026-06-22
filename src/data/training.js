// ─────────────────────────────────────────────────────────────────────────────
// TRAINING CATALOG — one module per knowledge domain, with previewable mockup
// lesson content.
//
// MOCKUP CONTENT: lessons/takeaways below are stand-in material drawn from the
// SOP so the preview feels real for the demo. Swap for the finished training
// materials later — the `domainId` is the only field the assignment logic needs.
//
// Shape:
//   { domainId, title, blurb, estMinutes,
//     lessons: [{ title, points: string[] }],
//     keyTakeaways: string[] }
// ─────────────────────────────────────────────────────────────────────────────

export const TRAINING_MODULES = [
  {
    domainId: 'sites',
    title: 'Sites & Routing Essentials',
    blurb: 'Hub vs. satellite logic, the BK prefix, and where labs can actually be drawn.',
    estMinutes: 30,
    lessons: [
      {
        title: 'The three sites at a glance',
        points: [
          'Forest Road (49 Forest Rd) is the strategic hub — complex and multidisciplinary cases concentrate here. Uses standard "Peds Lab" / "Ped Nurse" routing.',
          'Baker Town (48 Baker Town Rd) — ALL nursing and lab services use the "BK" prefix (e.g. "BK Peds Lab").',
          'Blooming Grove (1200 Route 208) — Monday–Thursday only, staffed exclusively by Dr. Dina Faiden.',
        ],
      },
      {
        title: 'Routing without cross-site errors',
        points: [
          'The BK prefix at Baker Town is a deliberate safeguard — it keeps routing distinct and prevents cross-site diagnostic errors. Always apply it.',
          'Blooming Grove has NO on-site lab. The "208-Lab" code is administrative only — specimens must be routed externally.',
          'Send complex / multidisciplinary requests to Forest Road; keep routine satellite visits local.',
        ],
      },
    ],
    keyTakeaways: [
      'Baker Town = BK prefix, every time.',
      'Never book an on-site lab draw at Blooming Grove.',
      'Forest Road is for complex care; satellites are for routine visits.',
    ],
  },
  {
    domainId: 'scheduling',
    title: 'Scheduling & Visit Rules',
    blurb: 'Well-visit timing, managed-care exceptions, newborn and tetanus protocols.',
    estMinutes: 45,
    lessons: [
      {
        title: 'Well-visit timing',
        points: [
          'Commercial / private insurance: follow the "one calendar year plus one day" rule to prevent claim denials.',
          'Managed care (Fidelis) early physicals are permitted ONLY if it has been at least six months since the last PE AND the child has reached the next age milestone (e.g. turned 6).',
        ],
      },
      {
        title: 'Newborn (6 weeks or less) protocols',
        points: [
          'Book at the START of the provider\'s shift to minimise exposure to sick-visit traffic.',
          'Request hospital discharge papers. For Good Samaritan (GS) births, record the hearing-screening lab ID in the reason for visit.',
          'Every newborn visit must carry an "NPP" (New Patient Paperwork) or "MRC" alert.',
        ],
      },
      {
        title: 'Tetanus',
        points: [
          'Regardless of physical-exam status, every tetanus administration requires a provider check-up immediately prior to assess acute injury risk.',
          'Never book a tetanus shot as a standalone administrative task.',
        ],
      },
    ],
    keyTakeaways: [
      'Commercial physicals: one calendar year + one day.',
      'Fidelis early PE needs BOTH 6 months AND next age milestone.',
      'Newborns book at shift start with NPP/MRC alert; tetanus always needs a prior check-up.',
    ],
  },
  {
    domainId: 'providers',
    title: 'Provider Matching & Booking Nuances',
    blurb: 'Demographic comfort, booking rules, and specialist insurance constraints.',
    estMinutes: 40,
    lessons: [
      {
        title: 'Match the provider to the patient',
        points: [
          'Several providers have demographic comfort restrictions (teenage males / teenage females). Check before booking an adolescent.',
          'Dr. Adam Polinger is comfortable with teenage females; several others are not.',
          'Stitches are handled by Dr. Chana Heintz only.',
          'Language proficiencies (Spanish / Yiddish / Hebrew) are matched to the community — use them to place the patient well.',
        ],
      },
      {
        title: 'Booking nuances & specialists',
        points: [
          'Booking rules differ by provider (double/triple booking, sibling double-booking, block lengths) — follow each provider\'s template.',
          'Dr. Cooper (Cardiology) and Dr. Gottlieb (Rheumatology) do NOT accept United Healthcare.',
          'Dr. Welter (Pulmonology) rotates the 2nd-last Tuesday of each month.',
          'Food challenges (Dr. Hochfelder / Siegel) take the first slot of the shift or post-lunch.',
        ],
      },
    ],
    keyTakeaways: [
      'Always check teen-male / teen-female comfort before booking adolescents.',
      'Stitches → Dr. Heintz only.',
      'Cooper & Gottlieb take no UHC; Welter is 2nd-last Tuesday.',
    ],
  },
  {
    domainId: 'routing',
    title: 'Call Routing & Referral Pathways',
    blurb: 'Who handles what — and what must never be answered on the phone.',
    estMinutes: 35,
    lessons: [
      {
        title: 'What you must never do on the phone',
        points: [
          'Administrative staff must NEVER give medical advice or test results by phone.',
          'Route any clinical inquiry to the "Q-Pediatrics Nursing Inquiries" queue.',
          'Labs / imaging follow an "Order First" policy — verify orders in the Patient Hub before directing the call.',
        ],
      },
      {
        title: 'Who handles what',
        points: [
          'Immunization & lab requests → Marisa Kraft or Jeanette Alcantara. Soft-transfer if they\'re available; otherwise send a Telephone Encounter (TE).',
          'Controlled-substance refills & mental-health follow-ups → Sally Carilli (Ext. 1934).',
          'Referrals & 2020 Transportation forms → Anisa Azeez (Ext. 1911).',
          'Pediatric specialty scheduling → Haley Newton (Ext. 1909).',
        ],
      },
    ],
    keyTakeaways: [
      'No medical advice or results by phone — route to the nursing queue.',
      'Immunization/lab → Marisa or Jeanette (soft transfer, else TE).',
      'Controlled substances → Sally; referrals → Anisa; specialty → Haley.',
    ],
  },
  {
    domainId: 'insurance',
    title: 'Insurance & Eligibility Basics',
    blurb: 'Eligibility indicators, plan-specific rules, and self-pay handling.',
    estMinutes: 45,
    lessons: [
      {
        title: 'Reading the eligibility indicator',
        points: [
          'Green (Y): eligible.',
          'Yellow (Y): active, but Aizer is NOT the primary care provider (PCP).',
          'Black (?): pending verification.',
          'Red (X/!): inactive or a data error.',
        ],
      },
      {
        title: 'Plan-specific rules',
        points: [
          'United Healthcare commercial plans require online prior authorization for specialists.',
          'Healthfirst is accepted ONLY if the patient has active Medicaid as a secondary payer.',
          'For all Medicaid / Managed Care, set "Relationship to Insured" to Self (1).',
          'Self-pay: sliding fee scale from $25 (income-based, 1-year validity) or a flat $100.',
        ],
      },
    ],
    keyTakeaways: [
      'Yellow Y = active but not our PCP.',
      'Healthfirst needs secondary Medicaid; Medicaid relationship = Self (1).',
      'Self-pay is $25 sliding or $100 flat.',
    ],
  },
  {
    domainId: 'registration',
    title: 'Registration & Confirmation Workflow',
    blurb: 'Account search, arrival guidance, confirmation status, forms and OTC rules.',
    estMinutes: 30,
    lessons: [
      {
        title: 'Register cleanly',
        points: [
          'Always search by phone number first to surface linked family accounts.',
          'Advise every patient to arrive BEFORE their appointment time, and document it in "General Notes".',
        ],
      },
      {
        title: 'Confirmation colours & forms',
        points: [
          'White: no confirmation. Blue/Green: automated or manual message left. Purple with a "V": staff-confirmed.',
          'The shift from automated attempts to a manual "V" confirmation is the key lever for reducing no-shows.',
          'OTC meds (Tylenol / Motrin) are insurance-covered only if dispensed before checkout; post-checkout, the patient must purchase them.',
          'School forms are faxed only if the PE is up to date (UTD), and external school inquiries require the institution on the patient\'s HIPAA authorization.',
        ],
      },
    ],
    keyTakeaways: [
      'Search by phone number first.',
      'Purple "V" = staff-confirmed (the no-show lever).',
      'OTC only before checkout; school forms only if PE is UTD.',
    ],
  },
];

export const moduleForDomain = (domainId) =>
  TRAINING_MODULES.find((m) => m.domainId === domainId) ?? null;
