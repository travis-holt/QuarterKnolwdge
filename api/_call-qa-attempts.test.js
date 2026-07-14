import { describe, it, expect } from 'vitest';
import { createFakeFirestore } from './fixtures/fakeFirestore.js';
import {
  buildAttemptDoc, buildScenarioSnapshot, createAttempt, loadAttempt,
  checkpointTranscript, finalizeCapture, claimGradingLease, commitGrade, markGradeFailed,
  isGradeableCaptureStatus,
  CAPTURE_STATUS, GRADING_STATUS, CALL_QA_ASSESSMENT_TYPE, CALL_QA_CAPTURE_AUTHORITY,
} from './_call-qa-attempts.js';

const SCENARIO = {
  id: 'qa-peds-refill-001',
  department: 'pediatrics',
  title: 'Standard prescription refill request',
  workflowType: 'prescription_refill',
  difficulty: 'medium',
  version: 'call-qa-scenarios-v1',
  primaryDomainId: 'routing',
  domainIds: ['classification', 'routing'],
  competencyIds: ['sopApplication'],
  callerName: 'Samira',
  openingLine: 'My daughter is out of her allergy medicine.',
  scenario: 'A parent is calling for a standard pediatric medication refill.',
  expectedActions: ['Clarify medication name'],
  criticalMisses: ['Promises refill approval'],
  scoringNotes: ['Do not require PE-status verification.'],
};

function seededAttempt(overrides = {}) {
  const doc = buildAttemptDoc({ navigatorId: 'nav-a', name: 'Ada', department: 'pediatrics', scenario: SCENARIO, liveModel: 'm', now: 1000 });
  return { ...doc, ...overrides };
}

describe('buildScenarioSnapshot / buildAttemptDoc', () => {
  it('captures the trusted scenario snapshot', () => {
    expect(buildScenarioSnapshot(SCENARIO)).toEqual({
      scenario: SCENARIO.scenario,
      callerName: 'Samira',
      openingLine: SCENARIO.openingLine,
      expectedActions: SCENARIO.expectedActions,
      criticalMisses: SCENARIO.criticalMisses,
      scoringNotes: SCENARIO.scoringNotes,
    });
  });

  it('builds a server-authoritative attempt doc from a trusted scenario', () => {
    const doc = buildAttemptDoc({ navigatorId: 'nav-a', name: 'Ada', department: 'pediatrics', scenario: SCENARIO, liveModel: 'live-x', now: 5000 });
    expect(doc.assessmentType).toBe(CALL_QA_ASSESSMENT_TYPE);
    expect(doc.captureAuthority).toBe(CALL_QA_CAPTURE_AUTHORITY);
    expect(doc.captureStatus).toBe(CAPTURE_STATUS.ACTIVE);
    expect(doc.gradingStatus).toBe(GRADING_STATUS.NOT_STARTED);
    expect(doc.qaScenarioId).toBe(SCENARIO.id);
    expect(doc.scenarioVersion).toBe('call-qa-scenarios-v1');
    expect(doc.domainId).toBe('routing');
    expect(doc.liveModel).toBe('live-x');
    expect(doc.startedAt).toBe(5000);
    expect(doc.transcript).toEqual([]);
    expect(doc.grade).toBeNull();
    expect(doc.qa).toBeNull();
  });
});

describe('createAttempt / loadAttempt', () => {
  it('creates and reloads by id', async () => {
    const db = createFakeFirestore();
    const id = await createAttempt(db, seededAttempt());
    expect(id).toBeTruthy();
    const loaded = await loadAttempt(db, id);
    expect(loaded.id).toBe(id);
    expect(loaded.navigatorId).toBe('nav-a');
  });

  it('returns null for a missing attempt', async () => {
    const db = createFakeFirestore();
    expect(await loadAttempt(db, 'nope')).toBeNull();
  });
});

describe('checkpointTranscript', () => {
  it('writes the transcript + progress without advancing capture state', async () => {
    const db = createFakeFirestore({ interviews: { a1: seededAttempt() } });
    await checkpointTranscript(db, 'a1', {
      transcript: [{ role: 'navigator', text: 'hi' }],
      navigatorTurnCount: 1, callerTurnCount: 0, turnCompleteObserved: true, warnings: [], now: 2000,
    });
    const doc = await loadAttempt(db, 'a1');
    expect(doc.transcript).toEqual([{ role: 'navigator', text: 'hi' }]);
    expect(doc.captureStatus).toBe(CAPTURE_STATUS.ACTIVE);
    expect(doc.captureMetadata.navigatorTurnCount).toBe(1);
    expect(doc.captureMetadata.transcriptTurnCount).toBe(1);
    expect(doc.lastTranscriptAt).toBe(2000);
  });
});

describe('finalizeCapture', () => {
  it('marks a clean drain captured', async () => {
    const db = createFakeFirestore({ interviews: { a1: seededAttempt() } });
    await finalizeCapture(db, 'a1', {
      transcript: [{ role: 'navigator', text: 'bye' }],
      captureStatus: CAPTURE_STATUS.CAPTURED,
      captureMetadata: { captureComplete: true, drainReason: 'turn-complete' },
      now: 3000,
    });
    const doc = await loadAttempt(db, 'a1');
    expect(doc.captureStatus).toBe(CAPTURE_STATUS.CAPTURED);
    expect(doc.endedAt).toBe(3000);
  });

  it('marks an unexpected disconnect abandoned', async () => {
    const db = createFakeFirestore({ interviews: { a1: seededAttempt() } });
    await finalizeCapture(db, 'a1', {
      transcript: [], captureStatus: CAPTURE_STATUS.ABANDONED,
      captureMetadata: { captureComplete: false, drainReason: 'client-disconnect' }, now: 3000,
    });
    expect((await loadAttempt(db, 'a1')).captureStatus).toBe(CAPTURE_STATUS.ABANDONED);
  });
});

describe('isGradeableCaptureStatus', () => {
  it('captured and capture_incomplete are gradeable; active/abandoned are not', () => {
    expect(isGradeableCaptureStatus(CAPTURE_STATUS.CAPTURED)).toBe(true);
    expect(isGradeableCaptureStatus(CAPTURE_STATUS.INCOMPLETE)).toBe(true);
    expect(isGradeableCaptureStatus(CAPTURE_STATUS.ACTIVE)).toBe(false);
    expect(isGradeableCaptureStatus(CAPTURE_STATUS.ABANDONED)).toBe(false);
  });
});

describe('grading lease + idempotency', () => {
  const captured = () => seededAttempt({
    captureStatus: CAPTURE_STATUS.CAPTURED,
    transcript: [{ role: 'navigator', text: 'hello' }],
    captureMetadata: { captureComplete: true },
  });

  it('claims a lease on a captured attempt', async () => {
    const db = createFakeFirestore({ interviews: { a1: captured() } });
    const claim = await claimGradingLease(db, 'a1', { leaseId: 'lease-1', now: 100 });
    expect(claim.status).toBe('claimed');
    const doc = await loadAttempt(db, 'a1');
    expect(doc.gradingStatus).toBe(GRADING_STATUS.GRADING);
    expect(doc.gradingLeaseId).toBe('lease-1');
  });

  it('rejects a still-active capture, an abandoned capture', async () => {
    const active = createFakeFirestore({ interviews: { a1: seededAttempt() } });
    expect((await claimGradingLease(active, 'a1', { leaseId: 'l', now: 1 })).status).toBe('capture_active');
    const abandoned = createFakeFirestore({ interviews: { a1: seededAttempt({ captureStatus: CAPTURE_STATUS.ABANDONED }) } });
    expect((await claimGradingLease(abandoned, 'a1', { leaseId: 'l', now: 1 })).status).toBe('abandoned');
  });

  it('a second concurrent claim is refused while the first lease is live', async () => {
    const db = createFakeFirestore({ interviews: { a1: captured() } });
    const [first, second] = await Promise.all([
      claimGradingLease(db, 'a1', { leaseId: 'lease-1', now: 100, ttlMs: 10_000 }),
      claimGradingLease(db, 'a1', { leaseId: 'lease-2', now: 100, ttlMs: 10_000 }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(['busy', 'claimed']);
  });

  it('an already-graded attempt is returned without re-claiming', async () => {
    const graded = seededAttempt({
      captureStatus: CAPTURE_STATUS.CAPTURED,
      gradingStatus: GRADING_STATUS.GRADED,
      qa: { score: 90, pass: true }, grade: { score: 90 },
      transcript: [{ role: 'navigator', text: 'x' }],
    });
    const db = createFakeFirestore({ interviews: { a1: graded } });
    const claim = await claimGradingLease(db, 'a1', { leaseId: 'l', now: 1 });
    expect(claim.status).toBe('already_graded');
    expect(claim.attempt.qa.score).toBe(90);
  });

  it('commitGrade persists only when the lease still belongs to the request', async () => {
    const db = createFakeFirestore({ interviews: { a1: captured() } });
    await claimGradingLease(db, 'a1', { leaseId: 'lease-1', now: 1 });
    const stale = await commitGrade(db, 'a1', { leaseId: 'stale', grade: { score: 1 }, qa: { score: 1 }, now: 2 });
    expect(stale.status).toBe('lease_lost');
    const ok = await commitGrade(db, 'a1', { leaseId: 'lease-1', grade: { score: 88 }, qa: { score: 88 }, now: 3 });
    expect(ok.status).toBe('committed');
    const doc = await loadAttempt(db, 'a1');
    expect(doc.gradingStatus).toBe(GRADING_STATUS.GRADED);
    expect(doc.qa.score).toBe(88);
    expect(doc.gradingLeaseId).toBeNull();
  });

  it('markGradeFailed keeps the transcript and allows a later retry', async () => {
    const db = createFakeFirestore({ interviews: { a1: captured() } });
    await claimGradingLease(db, 'a1', { leaseId: 'lease-1', now: 1 });
    const failed = await markGradeFailed(db, 'a1', { leaseId: 'lease-1', now: 2 });
    expect(failed.status).toBe('failed');
    const doc = await loadAttempt(db, 'a1');
    expect(doc.gradingStatus).toBe(GRADING_STATUS.FAILED);
    expect(doc.transcript).toEqual([{ role: 'navigator', text: 'hello' }]);
    // A retry can re-claim.
    expect((await claimGradingLease(db, 'a1', { leaseId: 'lease-2', now: 3 })).status).toBe('claimed');
  });
});
