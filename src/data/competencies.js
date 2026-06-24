// ─────────────────────────────────────────────────────────────────────────────
// COMPETENCIES — the second scoring axis.
//
// The 6 SOP DOMAINS (questions.js) answer "strong in WHICH topic" (scheduling,
// insurance, …). These 9 COMPETENCIES answer "strong in WHICH capability" —
// how a navigator thinks, decides, and communicates — cutting across all domains.
//
// Each question is tagged with one or more competency ids (see questions.js).
// A navigator's competency score is the average of the points they earn across
// every question tagged with that competency, then mapped to the same 3 levels
// (Learning / Solid / Can-Teach) via scoreToLevel() — kept identical to the
// domain axis for UI consistency.
//
// To edit: add/remove/adjust entries below. Each needs a stable `id` that the
// question `competencies` arrays reference.
// ─────────────────────────────────────────────────────────────────────────────

export const COMPETENCIES = [
  {
    id: 'sopKnowledge',
    name: 'SOP Knowledge',
    blurb: 'Recall of the SOP itself — facts, codes, rules, and where to find them.',
  },
  {
    id: 'sopApplication',
    name: 'SOP Application',
    blurb: 'Applying the right SOP procedure correctly to a concrete situation.',
  },
  {
    id: 'criticalThinking',
    name: 'Critical Thinking',
    blurb: 'Reasoning through ambiguous, novel, or edge-case situations to the right action.',
  },
  {
    id: 'customerHandling',
    name: 'Customer Handling',
    blurb: 'Managing the patient / caller experience with care and professionalism.',
  },
  {
    id: 'communication',
    name: 'Communication',
    blurb: 'Clear, accurate, appropriate communication of information and next steps.',
  },
  {
    id: 'riskManagement',
    name: 'Risk Management',
    blurb: 'Spotting and mitigating compliance, safety, and operational risk.',
  },
  {
    id: 'escalation',
    name: 'Escalation Decisions',
    blurb: 'Knowing when, and to whom, to escalate vs. handle the call directly.',
  },
  {
    id: 'compliance',
    name: 'Compliance Awareness',
    blurb: 'Adhering to regulatory, insurance, and policy requirements.',
  },
  {
    id: 'problemResolution',
    name: 'Problem Resolution',
    blurb: 'Driving an issue to a correct, complete resolution.',
  },
];

export const competencyName = (id) => COMPETENCIES.find((c) => c.id === id)?.name ?? id;

// Set of valid competency ids — used to validate question tags (and generated
// scenarios) so a typo or a bad AI tag can't silently create a phantom competency.
export const COMPETENCY_IDS = new Set(COMPETENCIES.map((c) => c.id));
