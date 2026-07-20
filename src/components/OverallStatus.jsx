import { LEVELS, THRESHOLDS } from '../data/config.js';

// ─────────────────────────────────────────────────────────────────────────────
// The ONE official capability status per navigator per department.
//
// `OverallBadge` renders "72% Overall · Solid" from a matrix row (or an explicit
// score/level pair). It is the only surface that may show an official Critical /
// Learning / Solid / Can-Teach classification.
//
// `DomainScore` renders a single domain percentage as DIAGNOSTIC evidence: a
// light score-range tint plus the number, and a "Critical gap" warning below 40.
// It deliberately never shows an official level label.
//
// Colour is never the only signal — both always render the number and, where a
// status applies, the written label.
// ─────────────────────────────────────────────────────────────────────────────

/** Official overall badge. Pass a matrix row, or an explicit {score, level, label}. */
export function OverallBadge({ row, score, level, label, complete = true, size = 'md', className = '' }) {
  const pct = row ? row.overallScore : score;
  const lvl = row ? row.overallLevel : level;
  const isComplete = row ? row.overallComplete !== false : complete;

  if (pct == null || !lvl) {
    return (
      <span className={`overall-badge overall-badge--na ${className}`.trim()}>
        <span className="overall-badge__pct">—</span>
        <span className="overall-badge__label">Not assessed</span>
      </span>
    );
  }

  const descriptor = LEVELS[lvl];
  const text = label ?? (row ? row.overallLabel : null) ?? (isComplete ? descriptor.label : 'Incomplete');

  return (
    <span
      className={`overall-badge overall-badge--${size} ${isComplete ? '' : 'overall-badge--incomplete'} ${className}`.trim()}
      style={{ background: descriptor.color, color: descriptor.text }}
      title={isComplete ? `${pct}% overall · ${descriptor.label}` : `${pct}% across a partial profile — not all six domains are scored`}
    >
      <span className="overall-badge__pct">{pct}%</span>
      <span className="overall-badge__label">{text}</span>
    </span>
  );
}

/** Inline "91% Overall · Can-Teach" text form, for card headers and list rows. */
export function OverallSummary({ row, className = '' }) {
  if (row?.overallScore == null) {
    return <span className={`overall-summary ${className}`.trim()}>Not assessed</span>;
  }
  const label = row.overallLabel ?? LEVELS[row.overallLevel].label;
  return (
    <span className={`overall-summary ${className}`.trim()}>
      <strong>{row.overallScore}% Overall</strong> · {label}
    </span>
  );
}

/**
 * One domain percentage rendered as diagnostic evidence.
 * `band` is a score range (critical/learning/solid/canTeach), NOT a status.
 */
export function DomainScore({ score, band, showCriticalWarning = true, className = '' }) {
  if (!Number.isFinite(score)) {
    return <span className={`domain-score domain-score--na ${className}`.trim()}>—</span>;
  }
  const isCritical = score < THRESHOLDS.critical;
  return (
    <span
      className={`domain-score domain-score--${band} ${className}`.trim()}
      style={{ background: LEVELS[band].tint }}
    >
      <span className="domain-score__pct">{score}%</span>
      {isCritical && showCriticalWarning && (
        <span className="domain-score__warn">Critical gap</span>
      )}
    </span>
  );
}

export default OverallBadge;
