// Server-side cache for the supervisor-activated department SOP.
// Uses Firebase Admin so hardened client rules never require anonymous server
// sign-in. Concurrent fresh reads share one promise and therefore cannot receive
// a stale/null value merely because another refresh is already running.

import { getFirebaseAdmin } from './_firebase-admin.js';
import { compareTimestampValues } from '../src/lib/time.js';

const TTL_MS = 60_000;

async function loadActiveSop(department) {
  const { db } = getFirebaseAdmin();
  // New activations maintain this deterministic pointer transactionally.
  const pointer = await db.collection('activeSops').doc(department).get();
  if (pointer.exists) {
    const body = pointer.data()?.body;
    return typeof body === 'string' && body.trim() ? body : null;
  }

  // Legacy fallback until each department is activated once under the new code.
  const snap = await db.collection('sops')
    .where('department', '==', department)
    .where('status', '==', 'active')
    .get();
  const selected = snap.docs
    .map((doc) => doc.data())
    .sort((a, b) => compareTimestampValues(b.activatedAt, a.activatedAt))[0];
  const body = selected?.body;
  return typeof body === 'string' && body.trim() ? body : null;
}

export function createSopStore(loader = loadActiveSop, ttlMs = TTL_MS) {
  const cache = new Map(); // department -> { body, fetchedAt }
  const inFlight = new Map(); // department -> Promise<body|null>

  const refresh = (department) => {
    if (inFlight.has(department)) return inFlight.get(department);
    const promise = (async () => {
      try {
        const body = await loader(department);
        cache.set(department, { body: body ?? null, fetchedAt: Date.now() });
        return body ?? null;
      } catch (err) {
        console.warn(`[sop-store] refresh(${department}) failed:`, err?.code ?? err?.message ?? err);
        const previous = cache.get(department)?.body ?? null;
        cache.set(department, { body: previous, fetchedAt: Date.now() });
        return previous;
      } finally {
        inFlight.delete(department);
      }
    })();
    inFlight.set(department, promise);
    return promise;
  };

  return {
    async get(department) {
      const entry = cache.get(department);
      if (!entry || Date.now() - entry.fetchedAt > ttlMs) return refresh(department);
      return entry.body;
    },
    getSync(department) {
      const entry = cache.get(department);
      if (!entry || Date.now() - entry.fetchedAt > ttlMs) void refresh(department);
      return entry?.body ?? null;
    },
    refresh,
    clear() {
      cache.clear();
      inFlight.clear();
    },
  };
}

const store = createSopStore();

export const getLiveSop = (department) => store.get(department);
export const getLiveSopSync = (department) => store.getSync(department);
