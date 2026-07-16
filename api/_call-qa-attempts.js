// ─────────────────────────────────────────────────────────────────────────────
// Server-owned Call QA attempt state machine (Firebase Admin repository).
//
// PR 2: a SCORED Call QA attempt is created, captured, finalized, loaded, graded,
// and persisted entirely by the server. It lives in the existing `interviews`
// collection but carries an explicit server-owned shape that a navigator client
// can neither create nor mutate (see firestore.rules). Every write in this
// module goes through Firebase Admin, which bypasses client rules — that is the
// trust boundary that makes the transcript tamper-resistant.
//
// The functions take the Admin `db` as their first argument (and an injectable
// `now`) so the whole state machine is unit-testable against a fake Firestore
// with no real network / emulator. Nothing here is bundled into the browser.
//
// State axes are kept explicit and separate:
//   captureStatus  : active | captured | capture_incomplete | abandoned
//   gradingStatus  : not_started | grading | graded | grade_failed
// A document with an active / abandoned / incomplete capture and no `qa` must
// never count as a completed Phase 3 attempt.
// ─────────────────────────────────────────────────────────────────────────────

export const INTERVIEWS_COLLECTION = 'interviews';
export const CALL_QA_ASSESSMENT_TYPE = 'call-qa';
export const CALL_QA_CAPTURE_AUTHORITY = 'server';
// Capture-format version — bump when the capture pipeline (roles, coalescing,
// drain protocol) changes in a way that affects how a stored transcript reads.
export const CALL_QA_CAPTURE_VERSION = 'call-qa-live-transcript-v1';

export const CAPTURE_STATUS = Object.freeze({
  ACTIVE: 'active',
  CAPTURED: 'captured',
  INCOMPLETE: 'capture_incomplete',
  ABANDONED: 'abandoned',
});

export const GRADING_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  GRADING: 'grading',
  GRADED: 'graded',
  FAILED: 'grade_failed',
});

// A grading lease may run this long before another request may reclaim it. The
// Gemini call happens OUTSIDE any Firestore transaction, so this only needs to
// exceed a realistic grading round-trip.
export const GRADING_LEASE_TTL_MS = 90_000;

/**
 * Build the immutable, server-trusted scenario snapshot stored on the attempt.
 * Grading later reads THIS snapshot, so a scenario-bank revision or code deploy
 * can never silently change the context an already-captured attempt was graded
 * against.
 */
export function buildScenarioSnapshot(scenario) {
  return {
    scenario: scenario.scenario,
    callerName: scenario.callerName,
    openingLine: scenario.openingLine,
    expectedActions: scenario.expectedActions ?? [],
    criticalMisses: scenario.criticalMisses ?? [],
    scoringNotes: scenario.scoringNotes ?? [],
  };
}

/**
 * Pure builder for a fresh server-authoritative Call QA attempt document from a
 * TRUSTED curated scenario (never browser input). `endedAt` is stored as epoch
 * millis so compareTimestampValues() sorts it correctly alongside Firestore
 * Timestamp docs.
 */
export function buildAttemptDoc({ navigatorId, name, department, scenario, liveModel, now = Date.now() }) {
  const primaryDomainId = scenario.primaryDomainId ?? scenario.domainIds?.[0] ?? null;
  return {
    navigatorId,
    name: name ?? '',
    department,
    domainId: primaryDomainId,

    assessmentType: CALL_QA_ASSESSMENT_TYPE,
    scenarioSource: 'curated',

    qaScenarioId: scenario.id,
    qaScenarioTitle: scenario.title,
    scenarioVersion: scenario.version ?? null,
    workflowType: scenario.workflowType ?? null,
    difficulty: scenario.difficulty ?? null,
    domainIds: scenario.domainIds ?? (primaryDomainId ? [primaryDomainId] : []),
    competencyIds: scenario.competencyIds ?? [],

    scenarioSnapshot: buildScenarioSnapshot(scenario),

    captureAuthority: CALL_QA_CAPTURE_AUTHORITY,
    captureVersion: CALL_QA_CAPTURE_VERSION,
    liveModel: liveModel ?? null,

    captureStatus: CAPTURE_STATUS.ACTIVE,
    gradingStatus: GRADING_STATUS.NOT_STARTED,

    transcript: [],
    startedAt: now,
    lastTranscriptAt: null,
    endedAt: null,

    captureMetadata: {
      endedBy: null,
      drainReason: null,
      turnCompleteObserved: false,
      navigatorTurnCount: 0,
      callerTurnCount: 0,
      transcriptTurnCount: 0,
      captureComplete: false,
      warnings: [],
    },

    // Legacy interview fields kept null so supervisor/history rendering that
    // reads these on practice docs does not choke on a QA attempt.
    scenario: scenario.scenario,
    callerName: scenario.callerName,
    criteriaGrades: null,
    supervisorOverrides: null,
    expectedActions: scenario.expectedActions ?? [],
    criticalMisses: scenario.criticalMisses ?? [],

    grade: null,
    qa: null,
  };
}

/** Create the attempt document. Returns the generated attempt (doc) id. */
export async function createAttempt(db, attemptDoc) {
  const ref = db.collection(INTERVIEWS_COLLECTION).doc();
  await ref.set(attemptDoc);
  return ref.id;
}

/** Load an attempt by id, or null when it does not exist. */
export async function loadAttempt(db, attemptId) {
  const snap = await db.collection(INTERVIEWS_COLLECTION).doc(attemptId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Checkpoint the growing server transcript. Called at turn boundaries (bounded /
 * debounced by the relay) — NOT on every fragment. Only mutates transcript +
 * progress metadata; never advances capture state.
 */
export async function checkpointTranscript(db, attemptId, { transcript, navigatorTurnCount, callerTurnCount, turnCompleteObserved, warnings, now = Date.now() }) {
  await db.collection(INTERVIEWS_COLLECTION).doc(attemptId).update({
    transcript,
    lastTranscriptAt: now,
    'captureMetadata.navigatorTurnCount': navigatorTurnCount,
    'captureMetadata.callerTurnCount': callerTurnCount,
    'captureMetadata.transcriptTurnCount': transcript.length,
    'captureMetadata.turnCompleteObserved': turnCompleteObserved,
    'captureMetadata.warnings': warnings ?? [],
  });
}

/**
 * Finalize the capture: write the last transcript + terminal capture state. A
 * `captured` finalization is a clean drain; `capture_incomplete` / `abandoned`
 * record uncertain or interrupted captures that must never silently pass.
 */
export async function finalizeCapture(db, attemptId, { transcript, captureStatus, captureMetadata, now = Date.now() }) {
  await db.collection(INTERVIEWS_COLLECTION).doc(attemptId).update({
    transcript,
    captureStatus,
    endedAt: now,
    lastTranscriptAt: now,
    captureMetadata,
  });
}

/** True when a capture state is eligible for automatic grading. */
export function isGradeableCaptureStatus(status) {
  return status === CAPTURE_STATUS.CAPTURED || status === CAPTURE_STATUS.INCOMPLETE;
}

/**
 * Transactionally claim a grading lease for one request. Returns a status:
 *   'claimed'        — this request owns the lease; grade now.
 *   'already_graded' — a grade already exists; return it, do NOT call Gemini.
 *   'capture_active' — still capturing; caller returns a conflict.
 *   'abandoned'      — interrupted capture; never auto-grade.
 *   'not_gradeable'  — capture state cannot be graded.
 *   'busy'           — another live lease is grading right now.
 */
export async function claimGradingLease(db, attemptId, { leaseId, now = Date.now(), ttlMs = GRADING_LEASE_TTL_MS }) {
  const ref = db.collection(INTERVIEWS_COLLECTION).doc(attemptId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: 'not_found' };
    const data = snap.data();

    if (data.gradingStatus === GRADING_STATUS.GRADED && data.qa) {
      return { status: 'already_graded', attempt: { id: attemptId, ...data } };
    }
    if (data.captureStatus === CAPTURE_STATUS.ACTIVE) return { status: 'capture_active' };
    if (data.captureStatus === CAPTURE_STATUS.ABANDONED) return { status: 'abandoned' };
    if (!isGradeableCaptureStatus(data.captureStatus)) return { status: 'not_gradeable' };

    const leaseLive = data.gradingStatus === GRADING_STATUS.GRADING &&
      typeof data.gradingLeaseExpiresAt === 'number' &&
      data.gradingLeaseExpiresAt > now;
    if (leaseLive) return { status: 'busy' };

    tx.update(ref, {
      gradingStatus: GRADING_STATUS.GRADING,
      gradingLeaseId: leaseId,
      gradingLeaseStartedAt: now,
      gradingLeaseExpiresAt: now + ttlMs,
    });
    return { status: 'claimed', attempt: { id: attemptId, ...data } };
  });
}

/**
 * Transactionally persist the grade — but only if THIS request still owns the
 * lease. A stale request (whose lease was reclaimed) never overwrites a fresher
 * grade.
 */
export async function commitGrade(db, attemptId, { leaseId, grade, qa, now = Date.now() }) {
  const ref = db.collection(INTERVIEWS_COLLECTION).doc(attemptId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: 'not_found' };
    const data = snap.data();
    if (data.gradingStatus === GRADING_STATUS.GRADED && data.qa) {
      return { status: 'already_graded', attempt: { id: attemptId, ...data } };
    }
    // Strict ownership: a request may write the grade ONLY when it still holds the
    // exact lease. A null/missing lease id (cleared or reclaimed) is NOT ownership,
    // so a stale request whose lease expired can never overwrite anything.
    if (data.gradingLeaseId !== leaseId) {
      return { status: 'lease_lost' };
    }
    tx.update(ref, {
      grade,
      qa,
      gradingStatus: GRADING_STATUS.GRADED,
      gradedAt: now,
      gradingLeaseId: null,
      gradingLeaseExpiresAt: null,
    });
    return { status: 'committed', attempt: { id: attemptId, ...data, grade, qa } };
  });
}

/** Record a grading failure, keeping the transcript for a later retry. */
export async function markGradeFailed(db, attemptId, { leaseId, now = Date.now() }) {
  const ref = db.collection(INTERVIEWS_COLLECTION).doc(attemptId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: 'not_found' };
    const data = snap.data();
    if (data.gradingStatus === GRADING_STATUS.GRADED) return { status: 'already_graded' };
    // Strict ownership (same rule as commitGrade): only the exact lease holder may
    // move the attempt to grade_failed and clear the lease. A stale request whose
    // lease was cleared/replaced (gradingLeaseId is null or someone else's) must
    // not clobber the current lease holder's grading.
    if (data.gradingLeaseId !== leaseId) return { status: 'lease_lost' };
    tx.update(ref, {
      gradingStatus: GRADING_STATUS.FAILED,
      gradingLeaseId: null,
      gradingLeaseExpiresAt: null,
    });
    return { status: 'failed' };
  });
}
