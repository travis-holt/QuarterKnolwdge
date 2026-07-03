// ─────────────────────────────────────────────────────────────────────────────
// FIRESTORE DATA LAYER
//
// The ONLY module that talks to Firestore. Everything else (components, App)
// calls these helpers — never the Firestore SDK directly. This keeps the data
// layer swappable and the rest of the app ignorant of Firestore.
//
// Seven collections, all UUID-keyed (never name-keyed → no typo/collision risk):
//   roster        — navigator list { name, pin, createdAt }; blank pin means
//                   the navigator creates it on first sign-in
//   results       — assessment submissions { name, navigatorId, department,
//                   assessmentType, scores, competencyScores, answers, submittedAt }.
//                   Keyed `${navigatorId}__${department}` for MCQ and
//                   `${navigatorId}__${department}__spot` for Spot the Error, so a
//                   navigator can hold BOTH an MCQ and a Spot result per department
//                   (and separate results per department). A fallback read against
//                   the plain navigatorId supports legacy pre-multi-dept MCQ docs.
//   resultHistory — append-only score snapshots (one per submission/retake) for
//                   longitudinal trends. { navigatorId, name, department, scores,
//                   competencyScores, takenAt, simulated }. Never overwritten.
//   questions     — supervisor-managed scenario bank { scenario, options, status,
//                   department, … }. `department` field added to support per-dept
//                   banks. Legacy docs without `department` are treated as 'pediatrics'.
//   audits        — pre-generated "Spot the Error" transcripts { department,
//                   domainId, transcript, errorIndex, hint, modelExplanation,
//                   status: draft|active|archived, source, createdAt }. Same
//                   review-gate model as questions; only `active` items are served.
//   interviews    — practice roleplay transcripts { navigatorId, name, domainId,
//                   scenario, callerName, transcript, endedAt }
//   completions   — exercise completions { navigatorId, name, domainId, kind,
//                   completedAt }. `kind` defaults to 'practice' for legacy docs.
//   pairings      — mentor-mentee pairings { domainId, mentorId, mentorName,
//                   menteeId, menteeName, menteeLevel, baselineScore, status,
//                   createdAt }
//   sops          — versioned department SOPs { department, title, body, version,
//                   status: draft|active|archived, source, createdAt }. At most
//                   one active doc per department; grounds the server's AI features.
//
// Levels (learning/solid/canTeach) are NEVER stored — always derived client-side
// by scoreToLevel(), so thresholds stay tunable without a data migration. Older
// result docs may predate `competencyScores`; the scoring layer tolerates its
// absence (competency views simply skip those rows).
// ─────────────────────────────────────────────────────────────────────────────

import { db, authReady } from './firebase.js';
import {
  collection,
  doc,
  addDoc as fbAddDoc,
  setDoc as fbSetDoc,
  getDoc as fbGetDoc,
  getDocs as fbGetDocs,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  writeBatch,
  updateDoc as fbUpdateDoc,
  deleteDoc as fbDeleteDoc,
} from 'firebase/firestore';

// ── Auth gating (C1) ─────────────────────────────────────────────────────────
// The hardened firestore.rules require an authenticated caller. `authReady`
// resolves once the anonymous sign-in attempt has settled (see firebase.js). All
// one-time reads/writes await it; all live subscriptions defer their onSnapshot
// listen until it resolves via liveQuery() so the first listen carries a token.

// Auth-gated wrappers around the Firestore read/write primitives. Every existing
// call site uses these names unchanged, so all one-time reads/writes now await
// the anonymous sign-in before touching Firestore. (Ref builders — collection,
// doc, query, where — are synchronous and need no gating; onSnapshot is deferred
// separately by liveQuery below.)
const getDoc     = async (...a) => { await authReady; return fbGetDoc(...a); };
const getDocs    = async (...a) => { await authReady; return fbGetDocs(...a); };
const setDoc     = async (...a) => { await authReady; return fbSetDoc(...a); };
const addDoc     = async (...a) => { await authReady; return fbAddDoc(...a); };
const updateDoc  = async (...a) => { await authReady; return fbUpdateDoc(...a); };
const deleteDoc  = async (...a) => { await authReady; return fbDeleteDoc(...a); };

const mapDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/**
 * Start a live onSnapshot only AFTER auth is ready, returning an unsubscribe
 * synchronously (so callers keep the same contract). If the caller unsubscribes
 * before auth resolves, the listen is never attached.
 * @param {*} ref            a collection or query ref
 * @param {(rows:object[]) => void} cb
 * @param {(err:Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
function liveQuery(ref, cb, onError) {
  const handleErr = onError ?? ((err) => console.error('subscription:', err));
  let unsub = () => {};
  let cancelled = false;
  authReady
    .then(() => {
      if (cancelled) return;
      unsub = onSnapshot(ref, (snap) => cb(mapDocs(snap)), handleErr);
    })
    .catch(handleErr);
  return () => {
    cancelled = true;
    unsub();
  };
}

const ROSTER = 'roster';
const RESULTS = 'results';
const RESULT_HISTORY = 'resultHistory';
const QUESTIONS_COL = 'questions';
const AUDITS_COL = 'audits';
const INTERVIEWS = 'interviews';
const COMPLETIONS = 'completions';
const PAIRINGS = 'pairings';
const SUPERVISOR_FEEDBACK = 'supervisorFeedback';
const LEARNING_PROPOSALS = 'learningProposals';
const SOPS = 'sops';

// ── Roster ───────────────────────────────────────────────────────────────────

/**
 * Supervisor: add a navigator to the roster. Firestore auto-generates the UUID.
 * @param {string} name
 * @param {string} [pin] optional 4-digit PIN; blank lets the navigator create it
 * @returns {Promise<string>} the new roster document id (UUID)
 */
export async function addToRoster(name, pin = '') {
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
 * Supervisor: delete a navigator's result(s) so they can retake. Removes BOTH
 * the MCQ and Spot the Error docs (and the legacy Pediatrics doc) for the
 * department. The roster entry is untouched; only submissions are removed.
 * @param {string} navigatorId  roster UUID
 * @param {string} [department='pediatrics']
 */
export async function clearResult(navigatorId, department = 'pediatrics') {
  const ids = [
    `${navigatorId}__${department}`,        // MCQ (composite)
    `${navigatorId}__${department}__spot`,  // Spot the Error
  ];
  if (department === 'pediatrics') ids.push(navigatorId); // legacy plain-id MCQ doc
  for (const id of ids) {
    const snap = await getDoc(doc(db, RESULTS, id));
    if (snap.exists()) await deleteDoc(doc(db, RESULTS, id));
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
  return liveQuery(collection(db, ROSTER), cb, onError ?? ((err) => console.error('subscribeRoster:', err)));
}

// ── Results ──────────────────────────────────────────────────────────────────

/**
 * Doc id for a result. MCQ keeps the plain composite key (back-compat with all
 * pre-assessment-type data); Spot the Error gets a `__spot` suffix so both an
 * MCQ and a Spot result can coexist for the same navigator + department.
 */
function resultDocId(navigatorId, department, assessmentType) {
  return assessmentType === 'spot'
    ? `${navigatorId}__${department}__spot`
    : `${navigatorId}__${department}`;
}

/**
 * Navigator: one-time read of their own result for one department + assessment
 * type. MCQ falls back to the legacy plain-navigatorId Pediatrics doc so old
 * pilot data loads without a migration; Spot has no legacy form.
 * @param {string} navigatorId
 * @param {string} [department='pediatrics']
 * @param {'mcq'|'spot'} [assessmentType='mcq']
 * @returns {Promise<{id:string,name:string,scores:Record<string,number>,department:string,assessmentType:string}|null>}
 */
export async function getResult(navigatorId, department = 'pediatrics', assessmentType = 'mcq') {
  const snap = await getDoc(doc(db, RESULTS, resultDocId(navigatorId, department, assessmentType)));
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  // Fallback: legacy Pediatrics MCQ doc keyed by plain navigatorId.
  if (assessmentType === 'mcq' && department === 'pediatrics') {
    const legacy = await getDoc(doc(db, RESULTS, navigatorId));
    if (legacy.exists()) return { id: legacy.id, ...legacy.data() };
  }
  return null;
}

/**
 * Navigator: write (or overwrite on retake) their result for one department +
 * assessment type, AND append an immutable snapshot to resultHistory for trend
 * tracking. The doc key includes the type (`__spot` suffix for Spot the Error)
 * so MCQ and Spot results coexist rather than overwriting each other.
 * @param {string} navigatorId
 * @param {string} name                  denormalised for display
 * @param {Record<string,number>} scores  domainId -> percent
 * @param {Record<string,number|null>} [competencyScores]
 * @param {string} [department='pediatrics']
 * @param {Record<string,string>} [answers]  questionId -> optionId (for question health)
 * @param {'mcq'|'spot'} [assessmentType='mcq']
 */
export async function saveResult(navigatorId, name, scores, competencyScores = {}, department = 'pediatrics', answers = {}, assessmentType = 'mcq') {
  await setDoc(doc(db, RESULTS, resultDocId(navigatorId, department, assessmentType)), {
    name,
    navigatorId,
    department,
    assessmentType,
    scores,
    competencyScores,
    answers,
    submittedAt: serverTimestamp(),
  });
  // Append an immutable history snapshot for longitudinal trends.
  await addDoc(collection(db, RESULT_HISTORY), {
    navigatorId,
    name,
    department,
    assessmentType,
    scores,
    competencyScores,
    takenAt: serverTimestamp(),
    simulated: false,
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
  return liveQuery(collection(db, RESULTS), cb, onError ?? ((err) => console.error('subscribeResults:', err)));
}

/**
 * C4 — minimized floor projection for the NAVIGATOR app's mentor suggestions.
 *
 * The navigator only needs to know which colleagues can teach a domain, so this
 * returns a one-time, projected list of `{ name, scores }` ONLY — deliberately
 * dropping `answers` (the most sensitive field: exactly which option each person
 * chose), `competencyScores`, and `navigatorId`. This replaces the old full-
 * collection live subscription that streamed every peer's complete result doc to
 * every navigator's browser.
 *
 * NOTE: peers' per-domain SCORES still reach the client (mentor matching needs
 * them). Fully hiding them would require computing mentor suggestions on the
 * server; that is the documented next step. This is a substantial reduction of
 * the leak surface, not a complete elimination.
 * @returns {Promise<{name:string, scores:Record<string,number>}[]>}
 */
export async function getFloorScores() {
  await authReady;
  const snap = await getDocs(collection(db, RESULTS));
  return snap.docs.map((d) => {
    const data = d.data();
    return { name: data.name, scores: data.scores ?? {} };
  });
}

// ── Result History (longitudinal trends) ─────────────────────────────────────

/**
 * One-time fetch of all historical snapshots for a navigator in one department,
 * sorted oldest → newest by takenAt. Used for per-navigator trend charts.
 * @param {string} navigatorId
 * @param {string} [department='pediatrics']
 * @returns {Promise<{id:string, scores:*, competencyScores:*, takenAt:*, simulated:boolean}[]>}
 */
export async function getResultHistory(navigatorId, department = 'pediatrics') {
  const snap = await getDocs(
    query(
      collection(db, RESULT_HISTORY),
      where('navigatorId', '==', navigatorId),
      where('department', '==', department)
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.takenAt?.seconds ?? 0) - (b.takenAt?.seconds ?? 0));
}

/**
 * Supervisor: live subscription to ALL result history snapshots.
 * Used by the supervisor action center and team-trend view.
 * @param {(history:object[]) => void} cb
 * @param {(err:Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeResultHistory(cb, onError) {
  return liveQuery(collection(db, RESULT_HISTORY), cb, onError ?? ((err) => console.error('subscribeResultHistory:', err)));
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
 * @param {string} [department='pediatrics']
 * @returns {Promise<string>} the new interview doc id
 */
export async function saveInterview(navigatorId, name, domainId, scenario, callerName, transcript, department = 'pediatrics') {
  const ref = doc(collection(db, INTERVIEWS));
  await setDoc(ref, {
    navigatorId,
    name,
    department,
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
 * @param {object} [qa] full QA-test scorecard (criteria verdicts, categories,
 *                      auto-fails, pass/fail) — present only for QA test calls.
 */
export async function updateInterviewGrade(id, grade, qa = null) {
  await updateDoc(doc(db, INTERVIEWS, id), qa ? { grade, qa } : { grade });
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

/**
 * Supervisor: live subscription to ALL interview sessions across all navigators.
 * Used by the action center (failed practice detection).
 * @param {(interviews:object[]) => void} cb
 * @param {(err:Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeInterviews(cb, onError) {
  return liveQuery(collection(db, INTERVIEWS), cb, onError ?? ((err) => console.error('subscribeInterviews:', err)));
}

// ── Completions (exercise completions) ───────────────────────────────────────

/**
 * Navigator: record that they completed a practice exercise for a domain.
 * A navigator may complete the same domain multiple times; each run is its own doc.
 * `kind` distinguishes between exercise types:
 *   'practice'  — "Spot the Error" QA audit (default, legacy docs)
 *   'minicheck' — domain mini-check re-validation
 * @param {string} navigatorId
 * @param {string} name          denormalised for display
 * @param {string} domainId
 * @param {string} [kind='practice']
 * @returns {Promise<string>} the new completion doc id
 */
export async function saveCompletion(navigatorId, name, domainId, kind = 'practice') {
  const ref = doc(collection(db, COMPLETIONS));
  await setDoc(ref, {
    navigatorId,
    name,
    domainId,
    kind,
    completedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * One-time fetch of all exercise completions for a navigator.
 * @param {string} navigatorId
 * @returns {Promise<{id:string, domainId:string, kind:string, completedAt:*}[]>}
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
  return liveQuery(collection(db, COMPLETIONS), cb, onError ?? ((err) => console.error('subscribeCompletions:', err)));
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
  return liveQuery(collection(db, QUESTIONS_COL), cb, onError ?? ((err) => console.error('subscribeQuestions:', err)));
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
  await authReady;
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

// ── Audits (pre-generated "Spot the Error" transcript bank) ───────────────────
//
// Same review-gate model as the question bank: Gemini output lands as `draft`,
// the supervisor reads the transcript + planted error, and only `active` items
// are served to navigators. Pre-generating kills the 40–70s live-generation
// wait in the Spot the Error assessment AND lets unrealistic transcripts be
// curated out before a navigator ever sees them.
//
// Doc shape: { department, domainId, transcript:[{speaker,message}], errorIndex,
//              hint, modelExplanation, status: draft|active|archived, source,
//              createdAt }

/**
 * Supervisor: live subscription to the whole audit bank (all statuses).
 * @param {(audits:object[]) => void} cb
 * @param {(err:Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeAudits(cb, onError) {
  return liveQuery(collection(db, AUDITS_COL), cb, onError ?? ((err) => console.error('subscribeAudits:', err)));
}

/**
 * One-time fetch of active audit items for a department (used by the Spot the
 * Error assessment). Filters client-side so no composite index is required.
 * @param {string} [department='pediatrics']
 * @returns {Promise<object[]>}
 */
export async function getActiveAudits(department = 'pediatrics') {
  const snap = await getDocs(query(collection(db, AUDITS_COL), where('status', '==', 'active')));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => (a.department ?? 'pediatrics') === department);
}

/**
 * Save a batch of generated audit items as drafts — never served until the
 * supervisor activates them.
 * @param {object[]} drafts  [{ domainId, transcript, errorIndex, hint, modelExplanation }]
 * @param {string} [source='gemini']
 * @param {string} [department='pediatrics']
 * @returns {Promise<string[]>} the new draft ids
 */
export async function saveDraftAudits(drafts, source = 'gemini', department = 'pediatrics') {
  const batch = writeBatch(db);
  const ids = [];
  for (const a of drafts) {
    const ref = doc(collection(db, AUDITS_COL));
    ids.push(ref.id);
    batch.set(ref, {
      domainId: a.domainId,
      transcript: a.transcript,
      errorIndex: a.errorIndex,
      hint: a.hint ?? '',
      modelExplanation: a.modelExplanation,
      department: a.department ?? department,
      status: 'draft',
      source,
      createdAt: serverTimestamp(),
    });
  }
  await authReady;
  await batch.commit();
  return ids;
}

/** Supervisor: make an audit item live in the Spot the Error assessment. */
export async function activateAudit(id) {
  await updateDoc(doc(db, AUDITS_COL, id), { status: 'active' });
}

/** Supervisor: retire an audit item (kept for history, no longer served). */
export async function archiveAudit(id) {
  await updateDoc(doc(db, AUDITS_COL, id), { status: 'archived' });
}

/** Supervisor: permanently delete an audit item. */
export async function deleteAudit(id) {
  await deleteDoc(doc(db, AUDITS_COL, id));
}

// ── Pairings (mentor-mentee assignments) ──────────────────────────────────────

/**
 * Supervisor: save a mentor-mentee pairing for a domain.
 * @param {{ domainId, mentorId, mentorName, menteeId, menteeName, menteeLevel, baselineScore }} pairing
 * @returns {Promise<string>} the new pairing doc id
 */
export async function savePairing(pairing) {
  const ref = doc(collection(db, PAIRINGS));
  await setDoc(ref, {
    ...pairing,
    status: 'active',
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Supervisor: update the status of a pairing (e.g. 'active' | 'completed' | 'cancelled').
 * @param {string} id
 * @param {string} status
 */
export async function updatePairingStatus(id, status) {
  await updateDoc(doc(db, PAIRINGS, id), { status });
}

/**
 * Supervisor: live subscription to ALL pairings.
 * @param {(pairings:object[]) => void} cb
 * @param {(err:Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribePairings(cb, onError) {
  return liveQuery(collection(db, PAIRINGS), cb, onError ?? ((err) => console.error('subscribePairings:', err)));
}

// ── Learning Loop (feedback + review-safe proposals) ─────────────────────────

/**
 * Supervisor: record a judgment on an AI-generated or system-generated item.
 * Status values: helpful | inaccurate | needsAdjustment | approved | rejected.
 * @param {{ targetType:string, targetId:string, status:string, note?:string, context?:object }} feedback
 * @returns {Promise<string>} the new feedback doc id
 */
export async function saveSupervisorFeedback(feedback) {
  const ref = doc(collection(db, SUPERVISOR_FEEDBACK));
  await setDoc(ref, {
    targetType: feedback.targetType,
    targetId: feedback.targetId,
    status: feedback.status,
    note: feedback.note ?? '',
    context: feedback.context ?? {},
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Supervisor: live subscription to all feedback records.
 * @param {(feedback:object[]) => void} cb
 * @param {(err:Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeSupervisorFeedback(cb, onError) {
  return liveQuery(collection(db, SUPERVISOR_FEEDBACK), cb, onError ?? ((err) => console.error('subscribeSupervisorFeedback:', err)));
}

/**
 * Supervisor/system: save a proposed improvement for human review. Proposals do
 * not affect active checks, scores, or training until a supervisor acts.
 * @param {{ type:string, title:string, target?:object, payload?:object, reasons?:string[] }} proposal
 * @returns {Promise<string>} the new proposal doc id
 */
export async function saveLearningProposal(proposal) {
  const ref = doc(collection(db, LEARNING_PROPOSALS));
  await setDoc(ref, {
    type: proposal.type,
    title: proposal.title,
    target: proposal.target ?? {},
    payload: proposal.payload ?? {},
    reasons: proposal.reasons ?? [],
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Supervisor: update a proposal status after review.
 * @param {string} id
 * @param {'pending'|'approved'|'rejected'} status
 * @param {{ reviewedBy?:string, note?:string }} [review]
 */
export async function updateLearningProposalStatus(id, status, review = {}) {
  await updateDoc(doc(db, LEARNING_PROPOSALS, id), {
    status,
    review,
    reviewedAt: serverTimestamp(),
  });
}

/**
 * Supervisor: live subscription to learning proposals.
 * @param {(proposals:object[]) => void} cb
 * @param {(err:Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeLearningProposals(cb, onError) {
  return liveQuery(collection(db, LEARNING_PROPOSALS), cb, onError ?? ((err) => console.error('subscribeLearningProposals:', err)));
}

// ── SOPs (supervisor-managed, versioned department SOPs) ─────────────────────
//
// Each SOP doc is one version of one department's SOP:
//   { department, title, body, version, status: 'draft'|'active'|'archived',
//     source: 'manual'|'ai-build'|'ai-refine', createdAt, activatedAt? }
// At most ONE doc per department is `active` — activateSop archives the rest.
// The server (api/_sop-store.js) reads the active doc to ground AI features;
// when no active doc exists it falls back to the hardcoded _sop-context.js.

/**
 * Supervisor: live subscription to ALL SOP docs (all departments + statuses).
 * The collection stays small (a handful of versions per department).
 * @param {(sops:object[]) => void} cb
 * @param {(err:Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeSops(cb, onError) {
  return liveQuery(collection(db, SOPS), cb, onError ?? ((err) => console.error('subscribeSops:', err)));
}

/**
 * Supervisor: save a new SOP version as a draft (never live until activated).
 * AI-produced drafts also carry their review metadata so it survives reload:
 * `notes` (build-mode gaps/ambiguities), `changes` (refine-mode typed diffs),
 * and `audit` ({ omissions, inventions } fidelity check, or null).
 * @param {{ department:string, title:string, body:string, version:number,
 *           source?:string, notes?:string[], changes?:object[], audit?:object|null }} sop
 * @returns {Promise<string>} the new SOP doc id
 */
export async function saveSopDraft(sop) {
  const ref = doc(collection(db, SOPS));
  await setDoc(ref, {
    department: sop.department,
    title: (sop.title ?? '').trim() || 'Untitled SOP',
    body: sop.body,
    version: sop.version,
    status: 'draft',
    source: sop.source ?? 'manual',
    notes: sop.notes ?? [],
    changes: sop.changes ?? [],
    audit: sop.audit ?? null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Supervisor: patch a draft SOP's editable fields (title/body). */
export async function updateSop(id, patch) {
  await updateDoc(doc(db, SOPS, id), patch);
}

/**
 * Supervisor: make one SOP version live for its department. Archives any other
 * active version of the same department in the same batch, so exactly one doc
 * per department is ever `active`.
 * @param {string} id          the SOP doc to activate
 * @param {string} department  the doc's department (guards the archive query)
 */
export async function activateSop(id, department) {
  const activeSnap = await getDocs(
    query(collection(db, SOPS), where('department', '==', department), where('status', '==', 'active'))
  );
  const batch = writeBatch(db);
  for (const d of activeSnap.docs) {
    if (d.id !== id) batch.update(doc(db, SOPS, d.id), { status: 'archived' });
  }
  batch.update(doc(db, SOPS, id), { status: 'active', activatedAt: serverTimestamp() });
  await batch.commit();
}

/** Supervisor: retire an SOP version (kept for history). */
export async function archiveSop(id) {
  await updateDoc(doc(db, SOPS, id), { status: 'archived' });
}

/** Supervisor: permanently delete an SOP version (drafts only — UI-enforced). */
export async function deleteSop(id) {
  await deleteDoc(doc(db, SOPS, id));
}
