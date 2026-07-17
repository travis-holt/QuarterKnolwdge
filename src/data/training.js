// ─────────────────────────────────────────────────────────────────────────────
// TRAINING CATALOG — one module per knowledge domain, with previewable mockup
// lesson content.
//
// MOCKUP CONTENT: lessons/takeaways below are stand-in material drawn from the
// SOPs and the Patient Navigator role description so the preview feels real for
// the demo. Swap for the finished training materials later — the `domainId` is
// the only field the assignment logic needs.
//
// Shape:
//   { domainId, title, blurb, estMinutes,
//     lessons: [{ title, points: string[] }],
//     keyTakeaways: string[] }
// ─────────────────────────────────────────────────────────────────────────────

export const TRAINING_MODULES = [
  {
    domainId: 'intake',
    title: 'Call Opening & Identification',
    blurb: 'Department-adaptive lookup, family accounts, and confirming you have the right chart.',
    estMinutes: 25,
    lessons: [
      {
        title: 'Lookup depends on the department',
        points: [
          'Pediatrics: ask for the PARENT\'S phone number first — it pulls up the whole family, and parents often call for two or three children.',
          'Adult departments (OB/GYN, Behavioral Health, Internal Medicine): the patient usually calls for themselves — ask date of birth first, then confirm first and last name.',
          'Start of shift: check the department Teams group chats for workflow changes, approvals, provider updates, and schedule updates before going available on Intermedia.',
        ],
      },
      {
        title: 'Right chart, every time',
        points: [
          'Two patients with the same name? Verify DOB (and address/phone if needed) BEFORE opening or discussing either chart.',
          'Multi-child calls: work each child\'s request in that child\'s own chart — never batch under one sibling.',
          'Read the eligibility indicator on pull-up: Yellow "Y" means active coverage but Aizer is NOT the PCP.',
        ],
      },
    ],
    keyTakeaways: [
      'Peds = parent phone first; adult departments = DOB first, then name.',
      'Never open or discuss a chart until identity is confirmed.',
      'Each child\'s request lives in that child\'s chart.',
    ],
  },
  {
    domainId: 'classification',
    title: 'Classifying the Call',
    blurb: 'The core thinking skill — deciding which workflow a request actually belongs to.',
    estMinutes: 35,
    lessons: [
      {
        title: 'The first question: what IS this call?',
        points: [
          'Every request maps to a workflow: scheduling, clinical question, refill, lab result, form/record request, referral, complaint, urgent symptom, wrong department, or needs-approval.',
          'One call can contain multiple requests — a refill AND a clinical question are two workflows, each handled on its own path.',
          'Clinical questions are classified and ROUTED, never answered — even "is this normal?" is a clinical question.',
        ],
      },
      {
        title: 'Urgent vs. routine vs. wrong department',
        points: [
          'Symptom red flags (e.g., decreased fetal movement, preterm contractions, third-trimester swelling) take priority over whatever else the caller wants — classify urgent first, handle the routine part after.',
          'A positive home pregnancy test is a SCHEDULING call (confirmation-of-pregnancy visit), not a clinical question.',
          'Wrong-department requests get routed to the owning department — never booked in your department\'s templates, never simply dropped.',
        ],
      },
    ],
    keyTakeaways: [
      'Classify before you act — the workflow decides everything downstream.',
      'Multiple requests = multiple workflows in the same call.',
      'Urgent symptoms outrank routine requests, every time.',
    ],
  },
  {
    domainId: 'routing',
    title: 'Routing & Escalation Pathways',
    blurb: 'TE destinations, department sub-routing, soft transfers, and urgent escalation.',
    estMinutes: 40,
    lessons: [
      {
        title: 'The TE routing table',
        points: [
          'Pediatrics: medical questions, lab results, and refills → PEDS Encounters queue. Referrals → Anisa Azeez.',
          'OB/GYN: pregnant patient / pregnancy-related issue → OB Portal. Non-pregnant GYN visit issue → PSS OB. Established MFM patient → the MFM coordinator.',
          'Behavioral Health: questions, refills, medication issues, and clinical concerns → assign the TE directly to the provider.',
          'Controlled-substance refills (Peds) → Sally Carilli (Ext. 1934).',
        ],
      },
      {
        title: 'Live transfers and urgent paths',
        points: [
          'When the owner is available, soft-transfer the live call instead of sending a TE (e.g., immunizations → Marisa Kraft or Jeanette Alcantara).',
          'Refills where the patient is completely out are marked HIGH PRIORITY.',
          'Obstetric red flags (decreased fetal movement, heavy bleeding, severe pain, contractions, possible water breaking) → immediate urgent OB clinical escalation; the navigator does not independently direct care or book from slot availability.',
        ],
      },
    ],
    keyTakeaways: [
      'Pregnant → OB Portal; non-pregnant GYN issue → PSS OB; MFM → the MFM coordinator.',
      'Owner available? Soft-transfer. Otherwise the TE goes to the owning queue or person.',
      'Completely out of medication = high-priority flag.',
    ],
  },
  {
    domainId: 'scheduling',
    title: 'Scheduling & Appointment Rules',
    blurb: 'Appointment types, timing rules, provider templates, and approval requirements.',
    estMinutes: 45,
    lessons: [
      {
        title: 'Timing rules that protect the claim',
        points: [
          'Commercial/private physicals: "one calendar year plus one day" — never earlier.',
          'Managed care (Fidelis) early physicals need BOTH: at least six months since the last PE AND a new age milestone.',
          'OB windows: first prenatal at 8–12 weeks, GCT at 24–29 weeks, GBS at 36–37 weeks.',
        ],
      },
      {
        title: 'Types, templates, and approvals',
        points: [
          'Same-day sick visits book ONLY on the day itself. Office visits can be pre-booked — but only with a documented provider follow-up.',
          'Newborns: start-of-shift slot, hospital discharge papers, and the NPP/MRC alert. Tetanus always needs a provider check-up immediately prior.',
          'Credentialed procedures (IUD insertion, anatomy scans) book only with authorized providers — verify before offering a slot.',
          'Many OB/GYN and Behavioral Health visit types are "only if approved" — check the approval requirement before booking, and never book what you can\'t approve.',
        ],
      },
    ],
    keyTakeaways: [
      'Know the timing window before offering a date.',
      'Same-day sick = same day only; office visits need a documented follow-up.',
      'Credentialed or approval-gated visit types are never booked on availability alone.',
    ],
  },
  {
    domainId: 'boundaries',
    title: 'Scope & Privacy Discipline',
    blurb: 'What navigators never do — clinical advice, results, promises, and unauthorized disclosure.',
    estMinutes: 30,
    lessons: [
      {
        title: 'The scope line',
        points: [
          'Never interpret lab results, give medical advice, judge clinical urgency beyond the routing rules, or decide a symptom is "normal."',
          'Never approve exceptions or promise a provider will approve something — offer the legitimate path instead (provider review, earliest compliant date).',
          'Results requests become TEs to the clinical queue; the answer always comes from clinical staff.',
        ],
      },
      {
        title: 'Privacy under pressure',
        points: [
          'Information goes only to callers AUTHORIZED on the account — family relationship alone (spouse, grandparent) authorizes nothing.',
          'Behavioral Health is strictest: you may take information from many callers, but never confirm someone is a BH patient or share care details with an unauthorized caller.',
          'Never give a provider\'s cell number to patients or family — take the message and contact the provider internally.',
          'Decline courteously and leave a path forward: take a message, or have the authorized contact call.',
        ],
      },
    ],
    keyTakeaways: [
      'No advice, no results, no promises — route instead.',
      'Authorization on the account, not family relationship, decides disclosure.',
      'Protect privacy with courtesy: always offer a legitimate next step.',
    ],
  },
  {
    domainId: 'documentation',
    title: 'Documentation & Follow-through',
    blurb: 'TEs that clinicians can act on, clean reason fields, and correct system entry.',
    estMinutes: 30,
    lessons: [
      {
        title: 'A TE someone can act on',
        points: [
          'Refill TE: medication name + dosage, prescribing provider (from the e-prescription log), preferred pharmacy, callback number — and the high-priority flag if the patient is out.',
          'OB clinical-question TE: gestational age or due date, the question/symptoms with onset, callback number, correct queue.',
          'The correct DESTINATION is part of the documentation — a perfect TE in the wrong queue helps no one.',
        ],
      },
      {
        title: 'Reason fields and entry conventions',
        points: [
          'Same-day sick visits: write ALL reported symptoms in the reason section (e.g., "FEVER + COUGH since last night").',
          'Site conventions matter: Baker Town services use the "BK" prefix so routing stays distinct.',
          'General Notes is not a work queue — anything needing clinical follow-up goes in a TE, not a note.',
        ],
      },
    ],
    keyTakeaways: [
      'Complete TE = no second round-trip: what, who, where, callback, priority.',
      'All symptoms in the reason field, not in notes.',
      'The right queue is part of good documentation.',
    ],
  },
];

export const moduleForDomain = (domainId) =>
  TRAINING_MODULES.find((m) => m.domainId === domainId) ?? null;
