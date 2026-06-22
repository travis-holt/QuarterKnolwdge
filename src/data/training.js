// ─────────────────────────────────────────────────────────────────────────────
// TRAINING CATALOG — one module per knowledge domain.
//
// PLACEHOLDER CONTENT: titles/blurbs/durations are stand-ins so the auto-assign
// engine has something to attach. Swap these for the real training materials
// later (the `domainId` is the only field the logic depends on).
//
// To wire real materials: keep `domainId` matching a domain in questions.js and
// fill in title/blurb/estMinutes (and add a `link` field if you host the course
// somewhere).
// ─────────────────────────────────────────────────────────────────────────────

export const TRAINING_MODULES = [
  {
    domainId: 'sites',
    title: 'Sites & Routing Essentials',
    blurb: 'Hub vs. satellite logic, the BK prefix, and where labs can actually be drawn.',
    estMinutes: 30,
  },
  {
    domainId: 'scheduling',
    title: 'Scheduling & Visit Rules',
    blurb: 'Well-visit timing, managed-care exceptions, newborn and tetanus protocols.',
    estMinutes: 45,
  },
  {
    domainId: 'providers',
    title: 'Provider Matching & Booking Nuances',
    blurb: 'Demographic comfort, booking rules, and specialist insurance constraints.',
    estMinutes: 40,
  },
  {
    domainId: 'routing',
    title: 'Call Routing & Referral Pathways',
    blurb: 'Who handles what — and what must never be answered on the phone.',
    estMinutes: 35,
  },
  {
    domainId: 'insurance',
    title: 'Insurance & Eligibility Basics',
    blurb: 'Eligibility indicators, plan-specific rules, and self-pay handling.',
    estMinutes: 45,
  },
  {
    domainId: 'registration',
    title: 'Registration & Confirmation Workflow',
    blurb: 'Account search, arrival guidance, confirmation status, forms and OTC rules.',
    estMinutes: 30,
  },
];

export const moduleForDomain = (domainId) =>
  TRAINING_MODULES.find((m) => m.domainId === domainId) ?? null;
