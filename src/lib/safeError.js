// ─────────────────────────────────────────────────────────────────────────────
// Safe, bounded diagnostics for rejection values.
//
// A rejected promise is not guaranteed to reject with an Error. The common
// shorthand `err?.message ?? err` falls through to the RAW VALUE whenever
// `message` is absent, so a plain object — which in this app could carry
// question text, answer options, answer keys, a Firestore snapshot or a request
// payload — gets handed straight to `console.error` and serialized into the log.
//
// This module reduces any rejection to a short string that cannot contain
// assessment content.
// ─────────────────────────────────────────────────────────────────────────────

/** Fallback label for a rejection we cannot safely describe. */
export const UNKNOWN_ERROR_LABEL = 'Unknown error';

/** Hard cap so a hostile or very large string cannot flood the log. */
export const MAX_ERROR_CHARS = 200;

/**
 * Reduce an arbitrary rejection value to a SAFE, BOUNDED diagnostic string.
 *
 *   • Error with a string message → that message, truncated
 *   • string rejection            → the string, truncated
 *   • anything else               → the generic fallback, never the value itself
 *
 * Arbitrary objects are never serialized, and stack traces are never included.
 *
 * @param {unknown} err
 * @param {string} [fallback]
 * @returns {string}
 */
export function safeErrorMessage(err, fallback = UNKNOWN_ERROR_LABEL) {
  const truncate = (text) => {
    const s = String(text).trim();
    if (!s) return fallback;
    return s.length > MAX_ERROR_CHARS ? `${s.slice(0, MAX_ERROR_CHARS)}…` : s;
  };
  if (typeof err === 'string') return truncate(err);
  // Deliberately an `instanceof Error` check rather than duck-typing on
  // `.message`: a non-Error object's `message` property is untrusted and could
  // itself be assembled from payload data.
  if (err instanceof Error && typeof err.message === 'string') return truncate(err.message);
  return fallback;
}
