// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE NAVIGATORS — illustrative data only (no real people).
//
// Scores are stored as per-domain percentages keyed by the domain `id` from
// questions.js. They are intentionally stored the same way a live check is
// scored, so sample rows and the live taker flow through the identical
// scoreToLevel() mapping and the matrix stays internally consistent.
//
// Edit names and numbers freely before the demo.
// ─────────────────────────────────────────────────────────────────────────────

export const SAMPLE_NAVIGATORS = [
  {
    name: 'Maya',
    scores: { sites: 90, scheduling: 55, providers: 80, routing: 95, insurance: 70, registration: 88 },
  },
  {
    name: 'Devon',
    scores: { sites: 60, scheduling: 45, providers: 65, routing: 70, insurance: 50, registration: 62 },
  },
  {
    name: 'Priya',
    scores: { sites: 88, scheduling: 50, providers: 90, routing: 85, insurance: 92, registration: 75 },
  },
  {
    name: 'Liam',
    scores: { sites: 55, scheduling: 40, providers: 58, routing: 60, insurance: 55, registration: 50 },
  },
  {
    name: 'Noor',
    scores: { sites: 92, scheduling: 70, providers: 85, routing: 90, insurance: 88, registration: 90 },
  },
  {
    name: 'Carlos',
    scores: { sites: 65, scheduling: 55, providers: 72, routing: 50, insurance: 60, registration: 58 },
  },
];
