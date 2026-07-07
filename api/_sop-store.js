// Server-side reader for the Firestore `sops` collection. The leading
// underscore keeps Express from turning this file into an HTTP route — it is a
// helper module.
//
// PURPOSE: lets the /api handlers ground AI features in the LIVE, supervisor-
// managed SOP for a department (F24 SOP manager) instead of only the hardcoded
// contexts in _sop-context.js. Design constraints:
//
//   • `sopContextFor()` is called synchronously inside template literals by all
//     seven AI handlers, so this module exposes a SYNC read (`getLiveSopSync`)
//     backed by an in-memory cache with lazy, non-blocking refresh. The first
//     call after server start (or after the TTL lapses) returns the previous
//     value — or null, falling back to the hardcoded context — while a refresh
//     runs in the background. SOPs change rarely; brief staleness is fine.
//
//   • DEFENSIVE INIT, same philosophy as src/lib/firebase.js: if the Firebase
//     env config is absent (unit tests, misconfigured deploy) the module is a
//     permanent no-op that always returns null. It must never crash an import.
//
//   • Uses the firebase web SDK (already a dependency; works in Node). Reads the
//     same VITE_FIREBASE_* variables the client build uses — on Railway they are
//     set as service variables, so they exist in the server process too. Tries
//     anonymous sign-in once (required by the hardened rules); tolerates failure
//     so the open-rules pilot keeps working.

const TTL_MS = 60_000;

// department -> { body: string|null, fetchedAt: number }
const cache = new Map();
const inFlight = new Set();

let initPromise = null; // null = not attempted; resolves to db instance or null

async function initFirestore() {
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) return null;
  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getAuth, signInAnonymously } = await import('firebase/auth');
    const { getFirestore } = await import('firebase/firestore');
    const app = getApps().find((a) => a.name === 'sop-store')
      ?? initializeApp({
        apiKey,
        authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId,
        storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.VITE_FIREBASE_APP_ID,
      }, 'sop-store');
    try {
      await signInAnonymously(getAuth(app));
    } catch (err) {
      // Anonymous auth not enabled yet — fine under the open pilot rules.
      console.warn('[sop-store] anonymous sign-in unavailable:', err.code ?? err.message);
    }
    return getFirestore(app);
  } catch (err) {
    console.warn('[sop-store] Firestore init failed — live SOPs disabled:', err.message);
    return null;
  }
}

async function refresh(department) {
  if (inFlight.has(department)) return;
  inFlight.add(department);
  try {
    initPromise ??= initFirestore();
    const db = await initPromise;
    if (!db) {
      cache.set(department, { body: null, fetchedAt: Date.now() });
      return;
    }
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    const snap = await getDocs(
      query(collection(db, 'sops'), where('department', '==', department), where('status', '==', 'active'))
    );
    const body = snap.empty ? null : (snap.docs[0].data().body ?? null);
    cache.set(department, { body: typeof body === 'string' && body.trim() ? body : null, fetchedAt: Date.now() });
  } catch (err) {
    // Rules deny / offline — cache the miss so we don't hammer Firestore.
    console.warn(`[sop-store] refresh(${department}) failed:`, err.code ?? err.message);
    cache.set(department, { body: cache.get(department)?.body ?? null, fetchedAt: Date.now() });
  } finally {
    inFlight.delete(department);
  }
}

export async function getLiveSop(department) {
  await refresh(department);
  return cache.get(department)?.body ?? null;
}

/**
 * Synchronous cached read of a department's ACTIVE live SOP body.
 * Returns null when none exists / not yet fetched / Firestore unavailable —
 * callers fall back to the hardcoded SOP context. Kicks off a non-blocking
 * refresh whenever the cached value is missing or older than the TTL.
 * @param {string} department
 * @returns {string|null}
 */
export function getLiveSopSync(department) {
  const entry = cache.get(department);
  if (!entry || Date.now() - entry.fetchedAt > TTL_MS) {
    refresh(department); // fire-and-forget
  }
  return entry?.body ?? null;
}
