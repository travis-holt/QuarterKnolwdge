// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATOR RESULT MERGE — stable-identity merge of the projected floor
// results (from /api/mentor-scores) with the current navigator's own local
// result, for the navigator's own mentor-suggestion matrix row.
//
// navigatorId is the PRIMARY identity. Display name is a fallback only for
// legacy rows that predate stable navigatorId keying (pre-Firebase-pilot
// data). Without this, a stale floor projection keyed by navigatorId and a
// freshly-submitted own result keyed by name could both survive a naive
// Map merge, producing a duplicate row where the stale (wrong) score wins in
// some read paths. See CLAUDE.md §12 (2026-07-13 result-merge fix).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stable Map key for a result row. Prefixed so a navigatorId string can never
 * collide with a display-name string.
 * @param {{navigatorId?:string, name?:string}} result
 * @returns {string}
 */
export function navigatorResultIdentityKey(result) {
  const navigatorId = result?.navigatorId;
  if (typeof navigatorId === 'string' && navigatorId.trim()) {
    return `id:${navigatorId.trim()}`;
  }
  return `name:${String(result?.name ?? '').trim()}`;
}

/**
 * Merge the minimized floor projection with the current navigator's own
 * result so their row appears exactly once and reflects the freshest local
 * data — never a stale copy of themselves read back from the floor
 * projection.
 *
 * Rules:
 *  - A floor row is keyed by its stable navigatorId when present, else by its
 *    (legacy) display name.
 *  - The own row is always keyed by the authenticated identity's navigatorId
 *    and REPLACES any floor row under that same key, even if the floor copy's
 *    display name differs (handles a mid-quarter rename).
 *  - A legacy floor row with NO navigatorId but a matching display name is
 *    also removed when the own row is inserted (same person, old keying).
 *  - A floor row with a DIFFERENT, non-empty navigatorId is never removed
 *    merely because it shares a display name with the current navigator.
 *
 * Pure: never mutates `floorResults`, its entries, or `ownResult`.
 *
 * @param {object[]} floorResults  minimized peer projection, e.g. [{name, navigatorId?, scores}]
 * @param {object|null} ownResult  the current navigator's own result (scores, competencyScores, ...)
 * @param {{navigatorId:string, name:string}} identity  the authenticated navigator's stable identity
 * @returns {object[]} a new merged array (not the same reference as floorResults)
 */
export function mergeNavigatorFloorAndOwnResult(floorResults, ownResult, identity) {
  const merged = new Map();
  for (const r of floorResults ?? []) {
    merged.set(navigatorResultIdentityKey(r), r);
  }

  if (ownResult && identity?.navigatorId) {
    const ownRow = { ...ownResult, navigatorId: identity.navigatorId, name: identity.name };
    const ownKey = navigatorResultIdentityKey(ownRow);
    const legacyNameKey = navigatorResultIdentityKey({ name: identity.name });
    if (legacyNameKey !== ownKey) merged.delete(legacyNameKey);
    merged.set(ownKey, ownRow);
  }

  return [...merged.values()];
}
