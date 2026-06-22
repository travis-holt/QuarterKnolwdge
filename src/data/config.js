// ─────────────────────────────────────────────────────────────────────────────
// TUNABLE KNOBS — edit these before the demo.
// Everything the prototype keys off (level thresholds, level labels/colors,
// and the warm palette) lives here so it is easy to find and change.
// ─────────────────────────────────────────────────────────────────────────────

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
export const LEVELS = {
  learning: { id: 'learning', label: 'Learning', color: '#e9dcc9', text: '#5a4a36' },
  solid: { id: 'solid', label: 'Solid', color: '#cdd6cb', text: '#3a4a3a' },
  canTeach: { id: 'canTeach', label: 'Can-Teach', color: '#c4744f', text: '#ffffff' },
};

export const LEVEL_ORDER = ['learning', 'solid', 'canTeach'];

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
