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

/**
 * Official overall badge. Pass a matrix row, or an explicit
 * {score, level, label, assessedDomains, totalDomains}.
 *
 * Three mutually exclusive renderings:
 *   • no domain scored           → "— / Not assessed"
 *   • some but not all six       → "— / Incomplete" (NO official level, and the
 *                                   partial average is deliberately NOT shown
 *                                   as a percentage so it cannot read as a score)
 *   • all six scored             → "72% / Solid"
 */
export function OverallBadge({
  row,
  score,
  level,
  label,
  complete = true,
  assessedDomains,
  totalDomains,
  size = 'md',
  className = '',
}) {
  const rawPct = row ? row.overallScore : score;
  const rawLvl = row ? row.overallLevel : level;
  const scored = row ? row.assessedDomains : assessedDomains;
  const outOf = (row ? row.totalDomains : totalDomains) ?? 6;
  const isComplete = row ? row.overallComplete !== false : complete;
  const text = label ?? (row ? row.overallLabel : null);

  // DEFENSIVE: `complete === false` always wins. If a caller supplies a stale or
  // inconsistent score/level alongside an incomplete profile (e.g. a cached row
  // from before the domains were cleared), we must NOT render an official
  // badge — an incomplete profile has no official status, full stop.
  const pct = isComplete ? rawPct : null;
  const lvl = isComplete ? rawLvl : null;

  // No official status: either nothing scored, or a partial profile. These two
  // must stay visibly distinct — "part-way through" is not "never started".
  if (pct == null || !lvl || !LEVELS[lvl]) {
    // Partial when we have a positive assessed count, OR when the caller told us
    // the profile is explicitly incomplete without supplying a count.
    const partial = Number.isFinite(scored)
      ? scored > 0
      : isComplete === false;
    const countNote = Number.isFinite(scored) ? `${scored} of ${outOf} domains scored. ` : '';
    return (
      <span
        className={`overall-badge overall-badge--na ${partial ? 'overall-badge--incomplete' : ''} ${className}`.trim()}
        title={
          partial
            ? `Incomplete profile — ${countNote}No official status until all ${outOf} are scored.`
            : 'No assessment recorded for this department yet.'
        }
      >
        <span className="overall-badge__pct">—</span>
        <span className="overall-badge__label">{text ?? (partial ? 'Incomplete' : 'Not assessed')}</span>
        {partial && Number.isFinite(scored) && (
          <span className="overall-badge__scored">{scored} of {outOf} domains</span>
        )}
      </span>
    );
  }

  const descriptor = LEVELS[lvl];

  return (
    <span
      className={`overall-badge overall-badge--${size} ${className}`.trim()}
      style={{ background: descriptor.color, color: descriptor.text }}
      title={`${pct}% overall · ${descriptor.label}`}
    >
      <span className="overall-badge__pct">{pct}%</span>
      <span className="overall-badge__label">{text ?? descriptor.label}</span>
    </span>
  );
}

/** Inline "91% Overall · Can-Teach" text form, for card headers and list rows. */
export function OverallSummary({ row, className = '' }) {
  if (row?.overallScore == null || !row?.overallLevel) {
    return (
      <span className={`overall-summary ${className}`.trim()}>
        {row?.overallLabel ?? 'Not assessed'}
      </span>
    );
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
 * `band` is a score range (critical/learning/solid/canTeach) or `null` when the
 * domain was never scored — NEVER an official status. An unscored domain
 * renders as an explicit "not scored" dash, never as 0% or a Critical gap.
 */
export function DomainScore({ score, band, showCriticalWarning = true, className = '' }) {
  if (!Number.isFinite(score) || band == null) {
    return (
      <span className={`domain-score domain-score--na ${className}`.trim()} title="Not scored">
        —
      </span>
    );
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
