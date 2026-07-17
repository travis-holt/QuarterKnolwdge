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
    const data = pointer.data();
    const body = data?.body;
    return typeof body === 'string' && body.trim() ? {
      body,
      version: data?.version ?? null,
      title: data?.title ?? null,
      sopId: data?.sopId ?? null,
      source: 'active-supervisor-sop',
    } : null;
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
  return typeof body === 'string' && body.trim() ? {
    body,
    version: selected?.version ?? null,
    title: selected?.title ?? null,
    sopId: selected?.id ?? null,
    source: 'active-supervisor-sop',
  } : null;
}

function normalizeRecord(value) {
  if (typeof value === 'string') return value.trim() ? { body: value, version: null, source: 'active-supervisor-sop' } : null;
  if (!value || typeof value.body !== 'string' || !value.body.trim()) return null;
  return { ...value, body: value.body };
}

export function createSopStore(loader = loadActiveSop, ttlMs = TTL_MS) {
  const cache = new Map(); // department -> { record, fetchedAt }
  const inFlight = new Map(); // department -> Promise<record|null>

  const refreshRecord = (department) => {
    if (inFlight.has(department)) return inFlight.get(department);
    const promise = (async () => {
      try {
        const record = normalizeRecord(await loader(department));
        cache.set(department, { record, fetchedAt: Date.now() });
        return record;
      } catch (err) {
        console.warn(`[sop-store] refresh(${department}) failed:`, err?.code ?? err?.message ?? err);
        const previous = cache.get(department)?.record ?? null;
        cache.set(department, { record: previous, fetchedAt: Date.now() });
        return previous;
      } finally {
        inFlight.delete(department);
      }
    })();
    inFlight.set(department, promise);
    return promise;
  };

  const refresh = async (department) => (await refreshRecord(department))?.body ?? null;

  return {
    async get(department) {
      const entry = cache.get(department);
      if (!entry || Date.now() - entry.fetchedAt > ttlMs) return refresh(department);
      return entry.record?.body ?? null;
    },
    async getRecord(department) {
      const entry = cache.get(department);
      if (!entry || Date.now() - entry.fetchedAt > ttlMs) return refreshRecord(department);
      return entry.record;
    },
    getSync(department) {
      const entry = cache.get(department);
      if (!entry || Date.now() - entry.fetchedAt > ttlMs) void refreshRecord(department);
      return entry?.record?.body ?? null;
    },
    getSyncRecord(department) {
      const entry = cache.get(department);
      if (!entry || Date.now() - entry.fetchedAt > ttlMs) void refreshRecord(department);
      return entry?.record ?? null;
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
export const getLiveSopRecord = (department) => store.getRecord(department);
export const getLiveSopSyncRecord = (department) => store.getSyncRecord(department);
