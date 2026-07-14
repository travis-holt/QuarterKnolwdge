// Handler + service tests for the SERVER-AUTHORITATIVE Call QA grading (PR 2).
//
// The scored endpoint now takes ONLY { attemptId }: it loads the server-captured
// transcript + trusted scenario snapshot, grades that, and persists the result.
// The Gemini client, auth gate, SOP context, and Firebase Admin are mocked so no
// network call is made — the pipeline runs offline and deterministically against
// an in-memory Firestore double.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { MODEL } from './_gemini-client.js';
import { QA_RUBRIC_VERSION } from './_qa-rubric.js';
import { getCallQaScenarioById } from '../src/data/callQaScenarios.js';
import { createFakeFirestore } from './fixtures/fakeFirestore.js';
import { buildAttemptDoc, CAPTURE_STATUS, GRADING_STATUS } from './_call-qa-attempts.js';

const geminiWithRotation = vi.fn();

vi.mock('./_gemini-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getApiKeys: () => ['k1', 'k2'],
    geminiWithRotation: (...args) => geminiWithRotation(...args),
  };
});
vi.mock('./_sop-context.js', () => ({
  sopContextFor: () => 'SOP CONTEXT (mock)',
  sopContextForFresh: async () => 'SOP CONTEXT (mock)',
}));

// Auth + Firebase Admin doubles. A shared `state` holds the current fake db +
// identity so each test can reconfigure them.
const state = { db: null, identity: { role: 'navigator', navigatorId: 'nav-a' } };
vi.mock('./_auth.js', () => ({
  validateSecret: vi.fn(async () => false),
  readFirebaseIdentity: vi.fn(async () => state.identity),
}));
vi.mock('./_firebase-admin.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getFirebaseAdmin: () => ({ db: state.db }) };
});

const { default: handler, CALL_QA_PROMPT_VERSION, callQaGraderModel, gradeCallQaTranscript, buildScenarioContextFromAttempt } = await import('./grade-call-qa.js');

const fixture = JSON.parse(readFileSync(new URL('./fixtures/qa-model-capture.example.json', import.meta.url), 'utf8'));
const validText = JSON.stringify(fixture.rawModelResponse);
const CURATED = getCallQaScenarioById(fixture.scenarioId);

const OK = (text, model = MODEL) => ({ ok: true, text, model });

function seedAttempt(db, overrides = {}) {
  const doc = buildAttemptDoc({ navigatorId: 'nav-a', name: 'Ada', department: 'pediatrics', scenario: CURATED, liveModel: 'live-m', now: 1000 });
  const attempt = {
    ...doc,
    captureStatus: CAPTURE_STATUS.CAPTURED,
    transcript: fixture.transcript,
    captureMetadata: { ...doc.captureMetadata, captureComplete: true, navigatorTurnCount: 3, callerTurnCount: 2 },
    ...overrides,
  };
  db._store.set('interviews/att-1', structuredClone(attempt));
  return attempt;
}

function makeReq(body = {}) {
  return { method: 'POST', body: { attemptId: 'att-1', ...body } };
}
function makeRes() {
  return {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

beforeEach(() => {
  geminiWithRotation.mockReset();
  state.db = createFakeFirestore();
  state.identity = { role: 'navigator', navigatorId: 'nav-a' };
  delete process.env.CALL_QA_GRADER_MODEL;
});
afterEach(() => { delete process.env.CALL_QA_GRADER_MODEL; });

// ── Grading service (pure orchestration) ─────────────────────────────────────
describe('gradeCallQaTranscript — pinned model + metadata', () => {
  const scenarioContext = () => buildScenarioContextFromAttempt(seedAttempt(createFakeFirestore()));

  it('invokes exactly ONE model (the pinned default) and never a fallback chain', async () => {
    geminiWithRotation.mockResolvedValue(OK(validText));
    await gradeCallQaTranscript({ transcript: fixture.transcript, scenarioContext: scenarioContext() }, { keys: ['k'] });
    expect(geminiWithRotation).toHaveBeenCalledTimes(1);
    expect(geminiWithRotation.mock.calls[0][2].models).toEqual([MODEL]);
  });

  it('uses the configured CALL_QA_GRADER_MODEL exactly', async () => {
    geminiWithRotation.mockResolvedValue(OK(validText, 'gemini-pinned-test'));
    await gradeCallQaTranscript(
      { transcript: fixture.transcript, scenarioContext: scenarioContext() },
      { keys: ['k'], graderModel: 'gemini-pinned-test' },
    );
    expect(geminiWithRotation.mock.calls[0][2].models).toEqual(['gemini-pinned-test']);
  });

  it('a malformed-output retry reuses the SAME pinned model', async () => {
    geminiWithRotation.mockResolvedValueOnce(OK('not json')).mockResolvedValueOnce(OK(validText));
    await gradeCallQaTranscript({ transcript: fixture.transcript, scenarioContext: scenarioContext() }, { keys: ['k'] });
    expect(geminiWithRotation).toHaveBeenCalledTimes(2);
    expect(geminiWithRotation.mock.calls[1][2].models).toEqual([MODEL]);
  });

  it('records server-owned grading metadata + transcript provenance', async () => {
    geminiWithRotation.mockResolvedValue(OK(validText, 'gemini-2.5-flash-lite'));
    const { qa } = await gradeCallQaTranscript(
      { transcript: fixture.transcript, scenarioContext: scenarioContext(), transcriptMetadata: { authority: 'server', attemptId: 'att-1', captureComplete: true, navigatorTurnCount: 3, callerTurnCount: 2, captureVersion: 'call-qa-live-transcript-v1', liveModel: 'live-m', drainReason: 'turn-complete' } },
      { keys: ['k'] },
    );
    expect(qa.gradingMetadata).toEqual({
      model: 'gemini-2.5-flash-lite',
      rubricVersion: QA_RUBRIC_VERSION,
      promptVersion: CALL_QA_PROMPT_VERSION,
      scenarioVersion: CURATED.version,
      gradedAt: expect.any(String),
    });
    expect(qa.transcriptMetadata.authority).toBe('server');
    expect(qa.transcriptMetadata.attemptId).toBe('att-1');
  });

  it('an incomplete capture forces needs_review with a capture-integrity flag', async () => {
    geminiWithRotation.mockResolvedValue(OK(validText));
    const { qa } = await gradeCallQaTranscript(
      { transcript: fixture.transcript, scenarioContext: scenarioContext(), captureMetadata: { captureComplete: false, drainReason: 'drain-timeout' } },
      { keys: ['k'] },
    );
    expect(qa.review.recommendation).toBe('needs_review');
    expect(qa.review.reviewFlags.some((f) => f.id === 'capture-integrity-incomplete')).toBe(true);
  });
});

describe('callQaGraderModel', () => {
  it('defaults to MODEL and honors a configured value', () => {
    expect(callQaGraderModel({})).toBe(MODEL);
    expect(callQaGraderModel({ CALL_QA_GRADER_MODEL: 'x' })).toBe('x');
  });
});

// ── Attempt-ID endpoint ──────────────────────────────────────────────────────
describe('POST /api/grade-call-qa (attempt-id)', () => {
  it('rejects a request with no attempt id', async () => {
    const res = makeRes();
    await handler(makeReq({ attemptId: '' }), res);
    expect(res.statusCode).toBe(400);
    expect(geminiWithRotation).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown attempt', async () => {
    const res = makeRes();
    await handler(makeReq({ attemptId: 'missing' }), res);
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for a cross-navigator attempt', async () => {
    seedAttempt(state.db);
    state.identity = { role: 'navigator', navigatorId: 'nav-b' };
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(403);
    expect(geminiWithRotation).not.toHaveBeenCalled();
  });

  it('refuses to grade a still-active capture', async () => {
    seedAttempt(state.db, { captureStatus: CAPTURE_STATUS.ACTIVE });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(geminiWithRotation).not.toHaveBeenCalled();
  });

  it('refuses to grade an abandoned capture', async () => {
    seedAttempt(state.db, { captureStatus: CAPTURE_STATUS.ABANDONED });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(geminiWithRotation).not.toHaveBeenCalled();
  });

  it('grades a captured attempt from the STORED transcript, ignoring any client transcript', async () => {
    seedAttempt(state.db);
    geminiWithRotation.mockResolvedValue(OK(validText));
    const res = makeRes();
    // A tampered client transcript is included and must be ignored.
    await handler(makeReq({ transcript: [{ role: 'navigator', text: 'FORGED' }], scenario: 'FORGED', qaScenarioId: 'forged' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.qa).toBeTruthy();
    expect(res.body.grade).toBeTruthy();
    // The grader saw the STORED transcript, not the forged one.
    const userMessage = geminiWithRotation.mock.calls[0][1].contents[0].parts[0].text;
    expect(userMessage).not.toContain('FORGED');
    // Persisted server-side.
    const stored = state.db._store.get('interviews/att-1');
    expect(stored.gradingStatus).toBe(GRADING_STATUS.GRADED);
    expect(stored.qa).toBeTruthy();
    expect(stored.qa.transcriptMetadata.authority).toBe('server');
  });

  it('an already-graded attempt returns the stored result WITHOUT another Gemini call', async () => {
    seedAttempt(state.db, {
      gradingStatus: GRADING_STATUS.GRADED,
      qa: { score: 91, pass: true }, grade: { score: 91 },
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.qa.score).toBe(91);
    expect(geminiWithRotation).not.toHaveBeenCalled();
  });

  it('a failed grade keeps the transcript and can be retried', async () => {
    seedAttempt(state.db);
    geminiWithRotation.mockResolvedValueOnce({ ok: false, reason: 'exhausted' });
    const res1 = makeRes();
    await handler(makeReq(), res1);
    expect(res1.statusCode).toBe(429);
    const stored = state.db._store.get('interviews/att-1');
    expect(stored.gradingStatus).toBe(GRADING_STATUS.FAILED);
    expect(stored.transcript.length).toBeGreaterThan(0);
    // Retry succeeds against the same durable transcript.
    geminiWithRotation.mockResolvedValueOnce(OK(validText));
    const res2 = makeRes();
    await handler(makeReq(), res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.qa).toBeTruthy();
  });

  it('concurrent finalize calls invoke the grader only once', async () => {
    seedAttempt(state.db);
    let calls = 0;
    geminiWithRotation.mockImplementation(async () => { calls += 1; return OK(validText); });
    const [r1, r2] = await Promise.all([handler(makeReq(), makeRes()), handler(makeReq(), makeRes())]);
    // One grades; the other returns busy (409) or the already-graded result.
    expect(calls).toBe(1);
  });

  it('supervisors may grade another navigator\'s attempt', async () => {
    seedAttempt(state.db);
    state.identity = { role: 'supervisor' };
    geminiWithRotation.mockResolvedValue(OK(validText));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
  });
});
