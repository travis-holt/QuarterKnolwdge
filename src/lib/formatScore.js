// ─────────────────────────────────────────────────────────────────────────────
// ONE shared formatter for every score/percentage label in the UI.
//
// Governing invariant: missing evidence must never be represented as failure,
// mastery, or a real 0%. Only a genuinely measured numeric zero is a Critical
// result. `Math.round(null)` is 0, so any label that rounds a possibly-null
// value silently fabricates a measured zero — this module exists so no surface
// has to remember that.
// ─────────────────────────────────────────────────────────────────────────────

/** Placeholder shown wherever there is no measurable evidence. */
export const NO_EVIDENCE_LABEL = 'N/A';

/** True only for a real, finite number (rejects null, undefined, NaN, strings). */
export function isMeasured(value) {
  return Number.isFinite(value);
}

/**
 * Format a percentage label.
 *   • genuine numeric zero → "0%"
 *   • any finite number    → rounded "N%"
 *   • null/undefined/NaN/non-numeric → the empty label ("N/A" by default)
 *
 * @param {unknown} value
 * @param {{ empty?: string }} [opts]
 * @returns {string}
 */
export function formatPercent(value, { empty = NO_EVIDENCE_LABEL } = {}) {
  return isMeasured(value) ? `${Math.round(value)}%` : empty;
}

/**
 * The last MEASURED value in a series, ignoring trailing gaps.
 * Returns null when the series holds no measured value at all.
 *
 * @param {(number|null|undefined)[]} series
 * @returns {number|null}
 */
export function latestMeasured(series) {
  if (!Array.isArray(series)) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (isMeasured(series[i])) return series[i];
  }
  return null;
}

/**
 * Label for the CURRENT point of a trend series.
 *
 * Deliberately reports the LATEST SNAPSHOT, not the latest measured value: if
 * the most recent check recorded nothing, showing an older number would imply
 * that stale result is current. The older value is still available via
 * `latestMeasured()` for callers that want to caption it explicitly.
 *
 * @param {(number|null|undefined)[]} series
 * @returns {string}
 */
export function formatSeriesCurrent(series) {
  if (!Array.isArray(series) || series.length === 0) return NO_EVIDENCE_LABEL;
  return formatPercent(series[series.length - 1]);
}
