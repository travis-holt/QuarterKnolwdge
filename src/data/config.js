// ─────────────────────────────────────────────────────────────────────────────
// TUNABLE KNOBS — edit these before the demo.
// Everything the prototype keys off (level thresholds, level labels/colors,
// and the warm palette) lives here so it is easy to find and change.
// ─────────────────────────────────────────────────────────────────────────────

// Supervisor passcode — unlocks the management view (matrix / overview /
// navigators / training) from the Start gate. CHANGE THIS before the pilot.
// NOTE: this file is in the public repo, so this passcode is visible to anyone
// who reads the source. That is acceptable for a small trusted pilot (no
// sensitive data); replace with real auth before any public production use.
export const SUPERVISOR_PASSCODE = '0200';

// Per-domain score → level thresholds (percentages).
//   < learning            → Learning
//   learning … canTeach-1 → Solid
//   >= canTeach           → Can-Teach
export const THRESHOLDS = {
  learning: 60, // below this = Learning
  canTeach: 85, // at/above this = Can-Teach
};

// The three capability levels. Order matters (lowest → highest).
// `color` is the cell fill in the matrix; `text` is readable on that fill.
// Traffic-light urgency: red = needs work, amber = mid, green = best.
export const LEVELS = {
  learning: { id: 'learning', label: 'Learning', color: '#c0392b', text: '#ffffff' },
  solid: { id: 'solid', label: 'Solid', color: '#e0b13c', text: '#4a3a12' },
  canTeach: { id: 'canTeach', label: 'Can-Teach', color: '#3e8e5a', text: '#ffffff' },
};

export const LEVEL_ORDER = ['learning', 'solid', 'canTeach'];

// Interview practice-call score → colour band. This is a SEPARATE scale from the
// capability THRESHOLDS above: an interview grade is a one-off call score (0–100),
// not a per-domain capability level, so it gets its own bands. Colours reuse the
// traffic-light level CSS variables (defined in styles.css :root).
export const INTERVIEW_SCORE_BANDS = {
  strong: 75, // >= strong → green
  fair: 60, //   >= fair (and < strong) → amber; below fair → red
};

/** CSS colour (a level var) for an interview practice-call score. */
export function interviewScoreColor(score) {
  if (typeof score !== 'number') return 'var(--ink-soft)';
  if (score >= INTERVIEW_SCORE_BANDS.strong) return 'var(--level-canteach)';
  if (score >= INTERVIEW_SCORE_BANDS.fair) return 'var(--level-solid)';
  return 'var(--level-learning)';
}

// A column is flagged as a floor-wide gap when this share (or more) of
// navigators sit at "Learning" in that domain.
export const COLUMN_GAP_THRESHOLD = 0.5; // 50%

// Auto-assign training rules: for each level, whether that domain's training is
// assigned and how it is prioritised. "Learning" gets required training;
// "Solid" gets an optional stretch toward Can-Teach; "Can-Teach" gets nothing.
// Set `assign: false` on a level to stop assigning training at that level.
export const TRAINING_RULES = {
  learning: { assign: true, priority: 'Required', goal: 'Build to Solid', rank: 0 },
  solid: { assign: true, priority: 'Stretch', goal: 'Toward Can-Teach', rank: 1 },
  canTeach: { assign: false },
};

// Mentor matching: max pairings a single mentor can carry at one time.
export const MENTOR_MAX_LOAD = 3;

// Adaptive dev paths: size and pass threshold for domain mini-checks.
// MINICHECK_SIZE: how many questions to pull per domain.
// MINICHECK_PASS: minimum score to count as passed (reuses the Solid threshold).
export const MINICHECK_SIZE = 4;
export const MINICHECK_PASS = 60; // same as THRESHOLDS.learning — passing means escaping Learning

// Longitudinal trends: how many synthetic illustrative leading points to prepend
// when a navigator has fewer than 2 real history snapshots (for demo purposes).
export const TREND_SYNTH_POINTS = 2;

// Warm, understated palette (also surfaced as CSS variables in styles.css).
export const PALETTE = {
  bg: '#f6f1e7', // soft ivory
  surface: '#fdfaf3', // card / panel
  ink: '#23201b', // near-black text
  inkSoft: '#6b6358', // muted text
  accent: '#c4744f', // warm clay / terracotta
  accentSoft: '#e7c9b8',
  line: '#e4dccb', // hairline borders
};
