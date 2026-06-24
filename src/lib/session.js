// ─────────────────────────────────────────────────────────────────────────────
// SESSION (localStorage)
//
// Single owner of all session state for the pilot. Stores who the current user
// is so a returning visitor skips the Start gate. This is a UX convenience only
// — it has nothing to do with Firestore data.
//
// MIGRATION NOTE: when this moves to a hosted product with real auth (Firebase
// Auth, etc.), only the internals of this file change. The { role, name,
// navigatorId } contract stays identical and nothing downstream needs to change.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'qkc_session';

/**
 * @returns {{ role: 'navigator'|'supervisor', name: string, navigatorId: string|null } | null}
 */
export function getSession() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Persist the current session.
 * @param {'navigator'|'supervisor'} role
 * @param {string} name           Display name (navigator name, or 'Supervisor')
 * @param {string|null} navigatorId  Firestore roster UUID — navigator role only
 */
export function setSession(role, name, navigatorId = null) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ role, name, navigatorId }));
  } catch {
    // localStorage unavailable (private mode / disabled) — session just won't
    // persist across reloads. The app still works for the current visit.
  }
}

/** Clear the session — "Switch user" / "Sign out". */
export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
