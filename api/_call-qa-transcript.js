// ─────────────────────────────────────────────────────────────────────────────
// Server-authoritative Call QA transcript capture (pure, shared, testable).
//
// PR 2 moves the SCORED Call QA transcript out of the browser: the /api/live
// relay is now the single source of truth for the transcript. This module holds
// the pure coalescing logic the relay uses so it can be unit-tested without a
// WebSocket, a clock, or Gemini. The browser still shows live captions, but
// those captions are a NON-AUTHORITATIVE visual mirror — the transcript scored
// by /api/grade-call-qa is the one captured here from Gemini Live's
// serverContent.inputTranscription (navigator) / outputTranscription (caller).
//
// Roles are normalized to exactly two values: 'patient' (caller) and
// 'navigator'. Consecutive fragments from the same role coalesce into one turn;
// empty fragments are ignored; turn length and total turn count are bounded so a
// runaway session can never write an unbounded document.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_QA_TURNS = 60;
export const MAX_QA_TURN_CHARS = 2000;

/** Normalize any relay role token to the two authoritative transcript roles. */
export function normalizeTranscriptRole(role) {
  return role === 'navigator' ? 'navigator' : 'patient';
}

/**
 * Append a streamed transcript fragment to an existing turn string, collapsing
 * whitespace and inserting a single space only when the join needs one. Mirrors
 * the client caption behavior so captions and the stored transcript read the
 * same, but the STORED copy is what grading trusts.
 */
export function appendTranscriptFragment(existing, fragment) {
  const text = String(fragment ?? '').replace(/\s+/g, ' ');
  if (!text.trim()) return existing;
  const next = text.trimStart();
  if (!existing) return next;
  const needsSpace = !/\s$/.test(existing) && !/^[.,!?;:)]/.test(next);
  return `${existing}${needsSpace ? ' ' : ''}${next}`;
}

/**
 * Append a fragment and enforce the per-turn character cap. Returns
 * `{ text, capped }` so BOTH the coalescer and the relay's staged strings share
 * one truncation implementation (never two that could drift). `capped` lets the
 * caller record a `turn-length-capped` warning — truncation is never silent.
 */
export function boundedAppend(existing, fragment, maxChars = MAX_QA_TURN_CHARS) {
  const merged = appendTranscriptFragment(existing, fragment);
  if (merged.length > maxChars) return { text: merged.slice(0, maxChars), capped: true };
  return { text: merged, capped: false };
}

/**
 * Stateful accumulator for a single call. The relay feeds it fragments as they
 * arrive; it coalesces consecutive same-role fragments, preserves speaking
 * order, bounds each turn's length, and caps the number of turns.
 */
export class TranscriptCapture {
  constructor({ maxTurns = MAX_QA_TURNS, maxTurnChars = MAX_QA_TURN_CHARS } = {}) {
    this.maxTurns = maxTurns;
    this.maxTurnChars = maxTurnChars;
    this._turns = []; // [{ role, text }]
    this._navigatorTurns = 0;
    this._callerTurns = 0;
    this.warnings = [];
  }

  /**
   * Add a streamed fragment for a role. Returns true when the fragment produced
   * an observable change (used by the relay to decide whether to re-mirror the
   * caption to the browser), false when it was empty/ignored.
   */
  add(role, text) {
    const normalized = normalizeTranscriptRole(role);
    const fragment = String(text ?? '').replace(/\s+/g, ' ');
    if (!fragment.trim()) return false;

    const last = this._turns[this._turns.length - 1];
    if (last && last.role === normalized) {
      if (last.text.length >= this.maxTurnChars) {
        this.warn('turn-length-capped');
        return false;
      }
      // Shared bounded-append: records the cap BEFORE slicing (never silent).
      const { text: next, capped } = boundedAppend(last.text, fragment, this.maxTurnChars);
      if (capped) this.warn('turn-length-capped');
      last.text = next;
      return true;
    }

    if (this._turns.length >= this.maxTurns) {
      this.warn('turn-count-capped');
      return false;
    }
    const { text: built, capped } = boundedAppend('', fragment, this.maxTurnChars);
    if (capped) this.warn('turn-length-capped');
    this._turns.push({ role: normalized, text: built });
    if (normalized === 'navigator') this._navigatorTurns += 1;
    else this._callerTurns += 1;
    return true;
  }

  /** Record a capture warning once (deduplicated). Public: the relay records
   *  staged-content caps against the same warning list. */
  warn(warning) {
    if (!this.warnings.includes(warning)) this.warnings.push(warning);
  }

  /** The coalesced transcript as a plain array (trimmed, empties dropped). */
  toArray() {
    return this._turns
      .map((turn) => ({ role: turn.role, text: turn.text.trim() }))
      .filter((turn) => turn.text.length > 0);
  }

  get turnCount() {
    return this.toArray().length;
  }

  get navigatorTurnCount() {
    return this.toArray().filter((turn) => turn.role === 'navigator').length;
  }

  get callerTurnCount() {
    return this.toArray().filter((turn) => turn.role === 'patient').length;
  }

  /** True when at least one navigator turn was captured. */
  get hasNavigatorTurn() {
    return this.navigatorTurnCount > 0;
  }
}
