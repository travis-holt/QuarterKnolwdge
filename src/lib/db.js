// ─────────────────────────────────────────────────────────────────────────────
// FIRESTORE DATA LAYER
//
// The ONLY module that talks to Firestore. Everything else (components, App)
// calls these helpers — never the Firestore SDK directly. This keeps the data
// layer swappable and the rest of the app ignorant of Firestore.
//
// Five collections, all UUID-keyed (never name-keyed → no typo/collision risk):
//   roster      — supervisor-managed navigator list { name, pin, createdAt }
//   results     — check submissions { name, navigatorId, department, scores,
//                 competencyScores, submittedAt }. Keyed by composite
//                 `${navigatorId}__${department}` so one navigator can hold
//                 separate scores for each assessed department. A fallback
//                 read against the plain navigatorId id supports legacy
//                 Pediatrics docs created before this multi-dept migration.
//   questions   — supervisor-managed scenario bank { scenario, options, status,
//                 department, … }. `department` field added to support per-dept
//                 banks. Legacy docs without `department` are treated as 'pediatrics'.
//   interviews  — practice roleplay transcripts { navigatorId, name, domainId,
//                 scenario, callerName, transcript, endedAt }
//   completions — "Spot the Error" exercise completions { navigatorId, name,
//                 domainId, completedAt }
//
// Levels (learning/solid/canTeach) are NEVER stored — always derived client-side
// by scoreToLevel(), so thresholds stay tunable without a data migration. Older
// result docs may predate `competencyScores`; the scoring layer tolerates its
// absence (competency views simply skip those rows).
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
  query,
  where,
  writeBatch,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';

const ROSTER = 'roster';
const RESULTS = 'results';
const QUESTIONS_COL = 'questions';
const INTERVIEWS = 'interviews';
const COMPLETIONS = 'completions';

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
 * Supervisor: edit a roster entry's name and/or PIN.
 * @param {string} id   roster UUID
 * @param {{ name?: string, pin?: string }} patch
 */
export async function updateRosterEntry(id, patch) {
  const update = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.pin !== undefined) update.pin = String(patch.pin).trim();
  await updateDoc(doc(db, ROSTER, id), update);
}

/**
 * Supervisor: activate or deactivate a navigator.
 * Inactive navigators are hidden from the sign-in dropdown and floor stats
 * but their data is preserved.
 * @param {string} id
 * @param {'active'|'inactive'} status
 */
export async function setRosterStatus(id, status) {
  await updateDoc(doc(db, ROSTER, id), { status });
}

/**
 * Supervisor: delete a navigator's result so they can retake the check.
 * The roster entry is untouched; only the submission is removed.
 * @param {string} navigatorId  roster UUID
 * @param {string} [department='pediatrics']
 */
export async function clearResult(navigatorId, department = 'pediatrics') {
  const compositeId = `${navigatorId}__${department}`;
  const compositeSnap = await getDoc(doc(db, RESULTS, compositeId));
  if (compositeSnap.exists()) {
    await deleteDoc(doc(db, RESULTS, compositeId));
  } else {
    // Legacy Pediatrics doc keyed by plain navigatorId.
    await deleteDoc(doc(db, RESULTS, navigatorId));
  }
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
 * @param {(err:Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeRoster(cb, onError) {
  return onSnapshot(
    collection(db, ROSTER),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError ?? ((err) => console.error('subscribeRoster:', err))
  );
}

// ── Results ──────────────────────────────────────────────────────────────────

/**
 * Navigator: one-time read of their own result for one department.
 * Tries the composite id first; falls back to the legacy plain-navigatorId doc
 * for Pediatrics so existing pilot data loads without a migration.
 * @param {string} navigatorId
 * @param {string} [department='pediatrics']
 * @returns {Promise<{id:string,name:string,scores:Record<string,number>,department:string}|null>}
 */
export async function getResult(navigatorId, department = 'pediatrics') {
  const compositeId = `${navigatorId}__${department}`;
  const snap = await getDoc(doc(db, RESULTS, compositeId));
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  // Fallback: legacy Pediatrics doc keyed by plain navigatorId.
  if (department === 'pediatrics') {
    const legacy = await getDoc(doc(db, RESULTS, navigatorId));
    if (legacy.exists()) return { id: legacy.id, ...legacy.data() };
  }
  return null;
}

/**
 * Navigator: write (or overwrite on retake) their result for one department.
 * Uses composite key `${navigatorId}__${department}` so a navigator can hold
 * separate scores for each assessed department.
 * @param {string} navigatorId
 * @param {string} name                  denormalised for display
 * @param {Record<string,number>} scores  domainId -> percent
 * @param {Record<string,number|null>} [competencyScores]
 * @param {string} [department='pediatrics']
 */
export async function saveResult(navigatorId, name, scores, competencyScores = {}, department = 'pediatrics', answers = {}) {
  const compositeId = `${navigatorId}__${department}`;
  await setDoc(doc(db, RESULTS, compositeId), {
    name,
    navigatorId,
    department,
    scores,
    competencyScores,
    answers,
    submittedAt: serverTimestamp(),
  });
}

/**
 * Live subscription to all results. Drives the supervisor dashboards (and the
 * navigator's mentor suggestions, which need the rest of the floor's data).
 * @param {(results:{id:string,name:string,navigatorId:string,scores:Record<string,number>}[]) => void} cb
 * @param {(err:Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeResults(cb, onError) {
  return onSnapshot(
    collection(db, RESULTS),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError ?? ((err) => console.error('subscribeResults:', err))
  );
}

// ── Interviews (practice roleplay transcripts) ────────────────────────────────

/**
 * Save a completed interview session. Transcript is stored as-is; criteria
 * grades are null until grading is added in a later phase.
 * @param {string} navigatorId
 * @param {string} name                  denormalized for display
 * @param {string} domainId
 * @param {string} scenario              the navigator-facing briefing text
 * @param {string} callerName
 * @param {{role:'patient'|'navigator', text:string}[]} transcript
 * @returns {Promise<string>} the new interview doc id
 */
export async function saveInterview(navigatorId, name, domainId, scenario, callerName, transcript) {
  const ref = doc(collection(db, INTERVIEWS));
  await setDoc(ref, {
    navigatorId,
    name,
    domainId,
    scenario,
    callerName,
    transcript,
    endedAt: serverTimestamp(),
    criteriaGrades: null,
    supervisorOverrides: null,
  });
  return ref.id;
}

/**
 * Store the AI grade on an interview doc after grading completes.
 * @param {string} id   interview doc id returned by saveInterview
 * @param {{ score:number, summary:string, strengths:string[], improvements:string[] }} grade
 */
export async function updateInterviewGrade(id, grade) {
  await updateDoc(doc(db, INTERVIEWS, id), { grade });
}

/**
 * One-time fetch of all interviews for a navigator (for their history view).
 * @param {string} navigatorId
 * @returns {Promise<object[]>}
 */
export async function getInterviews(navigatorId) {
  const snap = await getDocs(
    query(collection(db, INTERVIEWS), where('navigatorId', '==', navigatorId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── Completions ("Spot the Error" exercise completions) ───────────────────────

/**
 * Navigator: record that they completed a "Spot the Error" scenario for a domain.
 * A navigator may complete the same domain multiple times; each run is its own doc.
 * @param {string} navigatorId
 * @param {string} name          denormalised for display
 * @param {string} domainId
 * @returns {Promise<string>} the new completion doc id
 */
export async function saveCompletion(navigatorId, name, domainId) {
  const ref = doc(collection(db, COMPLETIONS));
  await setDoc(ref, {
    navigatorId,
    name,
    domainId,
    completedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * One-time fetch of all "Spot the Error" completions for a navigator.
 * @param {string} navigatorId
 * @returns {Promise<{id:string, domainId:string, completedAt:*}[]>}
 */
export async function getCompletions(navigatorId) {
  const snap = await getDocs(
    query(collection(db, COMPLETIONS), where('navigatorId', '==', navigatorId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Supervisor: live subscription to ALL completions (for the training dashboard).
 * @param {(completions:object[]) => void} cb
 * @param {(err:Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeCompletions(cb, onError) {
  return onSnapshot(
    collection(db, COMPLETIONS),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError ?? ((err) => console.error('subscribeCompletions:', err))
  );
}

// ── Questions (live, supervisor-managed bank) ──────────────────────────────────
//
// Each question doc carries the scoring shape plus a `status`:
//   draft    — generated/added, awaiting supervisor review (NOT in the check)
//   active   — live in the navigator's check
//   archived — retired, kept for history
// Levels are never stored; the check reads only `status === 'active'` questions.

const QUESTION_FIELDS = (q) => ({
  domainId: q.domainId,
  competencies: q.competencies ?? [],
  scenario: q.scenario,
  options: q.options,
  correctOptionId: q.correctOptionId,
});

/**
 * Supervisor: live subscription to the WHOLE question bank (all statuses) for
 * the Question Bank management view.
 * @param {(questions:object[]) => void} cb
 * @param {(err:Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeQuestions(cb, onError) {
  return onSnapshot(
    collection(db, QUESTIONS_COL),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError ?? ((err) => console.error('subscribeQuestions:', err))
  );
}

/**
 * One-time fetch of active questions for a specific department.
 * Filters client-side so no composite Firestore index is required.
 * Legacy docs without a `department` field are treated as 'pediatrics'.
 * @param {string} [department='pediatrics']
 * @returns {Promise<object[]>}
 */
export async function getActiveQuestions(department = 'pediatrics') {
  const snap = await getDocs(query(collection(db, QUESTIONS_COL), where('status', '==', 'active')));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((q) => (q.department ?? 'pediatrics') === department);
}

/**
 * Seed the bank from the combined seed the first time only. No-op if any
 * question already exists. Seed questions are written `active` using their
 * stable seed id and carry a `department` field.
 * @param {object[]} seed  combined ALL_SEED_QUESTIONS (both departments)
 * @returns {Promise<boolean>} true if it seeded, false if the bank was non-empty
 */
export async function seedQuestionsIfEmpty(seed) {
  const snap = await getDocs(collection(db, QUESTIONS_COL));
  if (!snap.empty) return false;
  const batch = writeBatch(db);
  for (const q of seed) {
    batch.set(doc(db, QUESTIONS_COL, q.id), {
      ...QUESTION_FIELDS(q),
      department: q.department ?? 'pediatrics',
      status: 'active',
      source: 'seed',
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return true;
}

/**
 * Save a batch of draft questions (e.g. Gemini output or manual adds). Each gets
 * a fresh UUID and status `draft` — never live until the supervisor activates it.
 * @param {object[]} drafts
 * @param {string} [source]  provenance tag (e.g. 'gemini', 'manual')
 * @param {string} [department='pediatrics']
 * @returns {Promise<string[]>} the new draft ids
 */
export async function saveDraftQuestions(drafts, source = 'gemini', department = 'pediatrics') {
  const batch = writeBatch(db);
  const ids = [];
  for (const q of drafts) {
    const ref = doc(collection(db, QUESTIONS_COL));
    ids.push(ref.id);
    batch.set(ref, {
      ...QUESTION_FIELDS(q),
      department: q.department ?? department,
      status: 'draft',
      source,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return ids;
}

/** Supervisor: patch a question's editable fields. */
export async function updateQuestion(id, patch) {
  await updateDoc(doc(db, QUESTIONS_COL, id), patch);
}

/** Supervisor: make a question live in the check. */
export async function activateQuestion(id) {
  await updateDoc(doc(db, QUESTIONS_COL, id), { status: 'active' });
}

/** Supervisor: retire a question (kept for history, not in the check). */
export async function archiveQuestion(id) {
  await updateDoc(doc(db, QUESTIONS_COL, id), { status: 'archived' });
}

/** Supervisor: permanently delete a question. */
export async function deleteQuestion(id) {
  await deleteDoc(doc(db, QUESTIONS_COL, id));
}
