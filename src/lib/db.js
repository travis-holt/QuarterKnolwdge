// ─────────────────────────────────────────────────────────────────────────────
// FIRESTORE DATA LAYER
//
// The ONLY module that talks to Firestore. Everything else (components, App)
// calls these helpers — never the Firestore SDK directly. This keeps the data
// layer swappable and the rest of the app ignorant of Firestore.
//
// Two collections, both keyed by UUID (never by name → no typo/collision risk):
//   roster   — supervisor-managed navigator list { name, pin, createdAt }
//   results  — check submissions { name, navigatorId, scores, submittedAt }
//
// Levels (learning/solid/canTeach) are NEVER stored — always derived client-side
// by scoreToLevel(), so thresholds stay tunable without a data migration.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './firebase.js';
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

const ROSTER = 'roster';
const RESULTS = 'results';

// ── Roster ───────────────────────────────────────────────────────────────────

/**
 * Supervisor: add a navigator to the roster. Firestore auto-generates the UUID.
 * @param {string} name
 * @param {string} pin   4-digit PIN, shared privately with the navigator
 * @returns {Promise<string>} the new roster document id (UUID)
 */
export async function addToRoster(name, pin) {
  const ref = await addDoc(collection(db, ROSTER), {
    name: name.trim(),
    pin: String(pin).trim(),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * One-time fetch of the full roster (for the navigator dropdown on the gate).
 * @returns {Promise<{id:string,name:string,pin:string}[]>}
 */
export async function getRoster() {
  const snap = await getDocs(collection(db, ROSTER));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Supervisor: live subscription to the roster (for the Navigators tab).
 * @param {(roster:{id:string,name:string,pin:string}[]) => void} cb
 * @returns {() => void} unsubscribe
 */
export function subscribeRoster(cb) {
  return onSnapshot(collection(db, ROSTER), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// ── Results ──────────────────────────────────────────────────────────────────

/**
 * Navigator: one-time read of their own result (decides dashboard vs. check).
 * @param {string} navigatorId  roster UUID
 * @returns {Promise<{id:string,name:string,scores:Record<string,number>}|null>}
 */
export async function getResult(navigatorId) {
  const snap = await getDoc(doc(db, RESULTS, navigatorId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Navigator: write (or overwrite, on retake) their result. The result document
 * shares the navigator's roster UUID as its id.
 * @param {string} navigatorId
 * @param {string} name                  denormalised for display
 * @param {Record<string,number>} scores  domainId -> percent
 */
export async function saveResult(navigatorId, name, scores) {
  await setDoc(doc(db, RESULTS, navigatorId), {
    name,
    navigatorId,
    scores,
    submittedAt: serverTimestamp(),
  });
}

/**
 * Live subscription to all results. Drives the supervisor dashboards (and the
 * navigator's mentor suggestions, which need the rest of the floor's data).
 * @param {(results:{id:string,name:string,navigatorId:string,scores:Record<string,number>}[]) => void} cb
 * @returns {() => void} unsubscribe
 */
export function subscribeResults(cb) {
  return onSnapshot(collection(db, RESULTS), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
