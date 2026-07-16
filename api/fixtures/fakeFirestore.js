// Minimal in-memory Firestore Admin double for unit tests. Supports the subset
// the Call QA attempt repository uses: collection().doc([id]).get/set/update/
// delete, dotted-path updates, and a SERIALIZED runTransaction (so concurrency
// tests behave like real Firestore commits). Not a general Firestore emulator —
// just enough to exercise the state machine without a network.

function setDotted(target, key, value) {
  if (!key.includes('.')) { target[key] = value; return; }
  const parts = key.split('.');
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

function applyUpdate(current, patch) {
  const next = structuredClone(current ?? {});
  for (const [key, value] of Object.entries(patch)) setDotted(next, key, value);
  return next;
}

export function createFakeFirestore(seed = {}) {
  const store = new Map(); // "collection/id" -> plain object
  for (const [coll, docs] of Object.entries(seed)) {
    for (const [id, data] of Object.entries(docs)) store.set(`${coll}/${id}`, structuredClone(data));
  }
  let autoId = 0;
  const stats = { geminiCalls: 0, txCount: 0 };
  // Test control:
  //   failUpdates — boolean OR predicate(patch): when truthy, doc().update()
  //     rejects (to exercise write-failure paths).
  //   deferUpdates — boolean OR predicate(patch): when truthy, doc().update()
  //     is HELD (returns a pending promise) so the test can control write
  //     completion order. Settle/fail via the returned db.settleDeferred()/
  //     failDeferred() helpers.
  const control = { failUpdates: false, deferUpdates: false, failUpdatesError: new Error('simulated Firestore update failure') };
  const deferred = [];        // pending, test-controlled update() promises
  const applied = [];         // ordered log of APPLIED updates: { type, patch }

  const truthyFor = (opt, patch) => (typeof opt === 'function' ? opt(patch) : Boolean(opt));
  const patchType = (patch) => ('captureStatus' in patch ? 'finalize' : 'checkpoint');
  const applyPatch = (key, patch) => {
    store.set(key, applyUpdate(store.get(key), patch));
    applied.push({ type: patchType(patch), patch });
  };

  function docRef(coll, id) {
    const key = `${coll}/${id}`;
    return {
      id,
      _key: key,
      async get() {
        const exists = store.has(key);
        const data = store.get(key);
        return { exists, id, data: () => (data ? structuredClone(data) : undefined) };
      },
      async set(data) { store.set(key, applyUpdate({}, data)); },
      async update(patch) {
        if (truthyFor(control.failUpdates, patch)) throw control.failUpdatesError;
        if (!store.has(key)) throw new Error(`No document to update: ${key}`);
        if (truthyFor(control.deferUpdates, patch)) {
          return new Promise((resolve, reject) => {
            deferred.push({ key, patch, type: patchType(patch), resolve, reject });
          });
        }
        applyPatch(key, patch);
      },
      async delete() { store.delete(key); },
    };
  }

  // Serialize transactions so two "concurrent" claims can't both read a stale
  // snapshot — models Firestore's serialized commit for the tests that need it.
  let txChain = Promise.resolve();

  return {
    _store: store,
    _stats: stats,
    _control: control,
    _deferred: deferred,       // pending update() promises, in arrival order
    _applied: applied,         // ordered log of applied updates
    // Apply + resolve the deferred update at index i (default: oldest).
    settleDeferred(i = 0) {
      const d = deferred[i];
      if (!d) return false;
      deferred.splice(i, 1);
      applyPatch(d.key, d.patch);
      d.resolve();
      return true;
    },
    // Reject the deferred update at index i WITHOUT applying it.
    failDeferred(i = 0) {
      const d = deferred[i];
      if (!d) return false;
      deferred.splice(i, 1);
      d.reject(control.failUpdatesError);
      return true;
    },
    collection(coll) {
      return { doc: (id) => docRef(coll, id ?? `auto-${++autoId}`) };
    },
    runTransaction(fn) {
      const run = async () => {
        stats.txCount += 1;
        const writes = [];
        const tx = {
          async get(ref) { return ref.get(); },
          update(ref, patch) { writes.push(['update', ref, patch]); },
          set(ref, data) { writes.push(['set', ref, data]); },
        };
        const result = await fn(tx);
        for (const [op, ref, data] of writes) {
          if (op === 'update') await ref.update(data);
          else await ref.set(data);
        }
        return result;
      };
      const scheduled = txChain.then(run, run);
      // keep the chain alive regardless of individual outcome
      txChain = scheduled.then(() => {}, () => {});
      return scheduled;
    },
  };
}
