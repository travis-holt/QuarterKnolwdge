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

// Capability band thresholds (percentages). Non-overlapping ranges:
//   0–39   → Critical
//   40–64  → Learning
//   65–89  → Solid
//   90–100 → Can-Teach
//
// These bands do double duty:
//   1. OFFICIAL STATUS — applied to a navigator's OVERALL department score (the
//      arithmetic mean of all six domain scores). This is the one official
//      capability classification per navigator per department.
//   2. DIAGNOSTIC BANDS — applied to an individual domain percentage purely to
//      pick a tint and a development priority. A domain band is NOT an official
//      navigator status and must never be rendered as "Routing · Solid".
export const THRESHOLDS = {
  critical: 40, // below this = Critical
  solid: 65, // at/above this = Solid
  canTeach: 90, // at/above this = Can-Teach
};

// The four capability levels. Order matters (lowest → highest).
// Visual progression: Burgundy → Orange → Gold → Green.
// `color` is the strong fill used for the OFFICIAL overall badge; `text` is
// readable on that fill; `tint` is the light wash used for DIAGNOSTIC domain
// score cells, bars and critical-gap callouts.
// Colour is never the only signal — every surface also shows the percentage and
// the written label.
export const LEVELS = {
  critical: {
    id: 'critical',
    label: 'Critical',
    color: '#8B1E2D',
    text: '#FFFFFF',
    tint: '#F4DADD',
  },
  learning: {
    id: 'learning',
    label: 'Learning',
    color: '#C9682C',
    text: '#FFFFFF',
    tint: '#F7E1D2',
  },
  solid: {
    id: 'solid',
    label: 'Solid',
    color: '#D8A72E',
    text: '#3F3210',
    tint: '#F6EBC8',
  },
  canTeach: {
    id: 'canTeach',
    label: 'Can-Teach',
    color: '#347A4D',
    text: '#FFFFFF',
    tint: '#DCECDF',
  },
};

export const LEVEL_ORDER = ['critical', 'learning', 'solid', 'canTeach'];

// Shown instead of an official level when a navigator's profile is missing one
// or more of the six domain scores. An incomplete profile has NO official
// capability status at all — see `overallStatus()` in lib/scoring.js.
export const INCOMPLETE_LABEL = 'Incomplete';

// Shown when a navigator has no domain score at all for this department.
export const UNASSESSED_LABEL = 'Not assessed';

// ─────────────────────────────────────────────────────────────────────────────
// COMPETENCY AXIS — deliberately SEPARATE from the capability bands above.
//
// The 2026-07-20 redesign re-banded the OFFICIAL DEPARTMENT STATUS only. The
// competency axis (how a navigator thinks/decides/communicates) keeps its own
// original 3-level thresholds, because nothing in that decision was about
// competencies and silently re-banding them would move ratings no one asked to
// move. Use `competencyScoreToLevel()` — never the capability `scoreToLevel()`.
//
// Change these only on an explicit, documented owner decision.
//   < 60      → Learning
//   60 … 84   → Solid
//   >= 85     → Can-Teach
// ─────────────────────────────────────────────────────────────────────────────
export const COMPETENCY_THRESHOLDS = {
  learning: 60, // below this = Learning
  canTeach: 85, // at/above this = Can-Teach
};

// The competency axis has no "Critical" band — it reuses the three shared LEVELS
// descriptors for colour/label only.
export const COMPETENCY_LEVEL_ORDER = ['learning', 'solid', 'canTeach'];

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
// navigators score below the Solid threshold in that domain.
export const COLUMN_GAP_THRESHOLD = 0.5; // 50%

// Auto-assign training rules, keyed by the DIAGNOSTIC BAND of an individual
// domain score — never by the navigator's official overall status. A navigator
// who is Can-Teach overall still receives targeted training for a weak domain.
//   0–39   Critical → required, highest urgency
//   40–64  Learning → required
//   65–89  Solid    → optional stretch
//   90–100 Can-Teach → no automatic assignment
export const TRAINING_RULES = {
  critical: {
    assign: true,
    priority: 'Critical',
    assignment: 'required',
    goal: 'Immediate focus — build to Learning',
    rank: 0,
  },
  learning: {
    assign: true,
    priority: 'Required',
    assignment: 'required',
    goal: 'Build to Solid',
    rank: 1,
  },
  solid: {
    assign: true,
    priority: 'Stretch',
    assignment: 'optional',
    goal: 'Toward Can-Teach',
    rank: 2,
  },
  canTeach: { assign: false },
};

// Priorities that count as a *required* training assignment (Critical + Required).
export const REQUIRED_TRAINING_PRIORITIES = ['Critical', 'Required'];

// Mentor matching: max pairings a single mentor can carry at one time.
export const MENTOR_MAX_LOAD = 3;

// Adaptive dev paths: size and pass threshold for domain mini-checks.
// MINICHECK_SIZE: how many questions to pull per domain.
// MINICHECK_PASS: minimum score to count as passed (reuses the Solid threshold).
export const MINICHECK_SIZE = 4;
// Deliberately its own number: a mini re-check is a 4-question mastery probe,
// not a capability band. Kept at 60 so the existing pass/fail behaviour of
// recorded mini-checks is unchanged by the capability-band redesign.
export const MINICHECK_PASS = 60;

// "Spot the Error" assessment: how many flawed transcripts make up one scored
// run. Each item is a single click-to-identify-the-error question; the domain
// score is the share found correctly (0–100), fed back into the capability matrix.
export const SPOT_ASSESSMENT_SIZE = 5;

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
