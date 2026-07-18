// Unit tests for VoiceCall's pure Call QA helpers. We mock the Firestore and
// fetch layers so importing the component module never boots Firebase or the
// browser audio stack — only the exported pure helpers are exercised.
//
// PR 2: the SCORED Call QA path is server-authoritative. The browser grades by
// server ATTEMPT ID only — it never submits a transcript, scenario, or metadata.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/db.js', () => ({
  saveInterview: vi.fn(),
  updateInterviewGrade: vi.fn(),
}));
vi.mock('../lib/apiFetch.js', () => ({ apiFetch: vi.fn() }));

const {
  gradeCallQaByAttemptId,
  gradeSavedCallQaAttempt,
  PRACTICE_GRADE_TIMEOUT_MS,
  QA_GRADE_TIMEOUT_MS,
  QA_GRADE_TOTAL_WAIT_MS,
} = await import('./VoiceCall.jsx');

describe('gradeCallQaByAttemptId — attempt-id-only grading authority', () => {
  it('sends ONLY { attemptId } to the scored endpoint', async () => {
    const apiFetchFn = vi.fn().mockResolvedValue({ grade: { score: 90 }, qa: { pass: true } });

    await gradeCallQaByAttemptId('attempt-xyz', apiFetchFn);

    expect(apiFetchFn).toHaveBeenCalledTimes(1);
    const [endpoint, body] = apiFetchFn.mock.calls[0];
    expect(endpoint).toBe('/api/grade-call-qa');
    expect(body).toEqual({ attemptId: 'attempt-xyz' });
    // The browser never becomes the grading source of truth again.
    expect(body).not.toHaveProperty('transcript');
    expect(body).not.toHaveProperty('scenario');
    expect(body).not.toHaveProperty('department');
    expect(body).not.toHaveProperty('metadata');
    expect(body).not.toHaveProperty('qaScenarioId');
    expect(apiFetchFn.mock.calls[0][2]).toBe(100_000);
  });

  it('returns the server-persisted grade/qa', async () => {
    const apiFetchFn = vi.fn().mockResolvedValue({ grade: { score: 77 }, qa: { pass: false }, attemptId: 'a2' });
    const data = await gradeCallQaByAttemptId('a2', apiFetchFn);
    expect(data.grade.score).toBe(77);
    expect(data.qa.pass).toBe(false);
  });
});

describe('gradeSavedCallQaAttempt — bounded saved-attempt polling', () => {
  const temporaryError = (kind) => {
    if (kind === 'AbortError') return Object.assign(new Error('timeout'), { name: 'AbortError' });
    return Object.assign(new Error(`HTTP ${kind}`), { status: kind });
  };

  it('keeps the scored timeout at 100000 ms and practice grading at 30000 ms', () => {
    expect(QA_GRADE_TIMEOUT_MS).toBe(100_000);
    expect(PRACTICE_GRADE_TIMEOUT_MS).toBe(30_000);
  });

  it.each(['AbortError', 409, 429, 503])('retries temporary %s errors and returns a later durable grade', async (kind) => {
    let now = 0;
    const delays = [];
    const apiFetchFn = vi.fn()
      .mockRejectedValueOnce(temporaryError(kind))
      .mockResolvedValueOnce({ qa: { pass: true }, grade: { score: 91 }, attemptId: 'saved-1' });
    const result = await gradeSavedCallQaAttempt('saved-1', {
      apiFetchFn,
      nowFn: () => now,
      sleepFn: async (delayMs) => { delays.push(delayMs); now += delayMs; },
    });

    expect(result.grade.score).toBe(91);
    expect(delays).toEqual([2_000]);
    expect(apiFetchFn).toHaveBeenCalledTimes(2);
    for (const [endpoint, body] of apiFetchFn.mock.calls) {
      expect(endpoint).toBe('/api/grade-call-qa');
      expect(body).toEqual({ attemptId: 'saved-1' });
    }
  });

  it('uses 2s, 5s, 10s, then bounded 15s delays and stops at 150000 ms total', async () => {
    let now = 0;
    const delays = [];
    const timeouts = [];
    const apiFetchFn = vi.fn(async (_endpoint, _body, timeoutMs) => {
      timeouts.push(timeoutMs);
      throw temporaryError(503);
    });

    await expect(gradeSavedCallQaAttempt('saved-2', {
      apiFetchFn,
      nowFn: () => now,
      sleepFn: async (delayMs) => { delays.push(delayMs); now += delayMs; },
    })).rejects.toMatchObject({ code: 'qa-grade-wait-exceeded' });

    expect(delays.slice(0, 4)).toEqual([2_000, 5_000, 10_000, 15_000]);
    expect(delays.every((delay) => delay <= 15_000)).toBe(true);
    expect(delays.reduce((sum, delay) => sum + delay, 0)).toBe(QA_GRADE_TOTAL_WAIT_MS);
    expect(timeouts[0]).toBe(100_000);
    expect(timeouts.every((timeout) => timeout <= 100_000)).toBe(true);
    expect(now).toBe(150_000);
  });

  it.each([400, 401, 403, 500, 422])('does not auto-retry permanent HTTP %s errors', async (status) => {
    const apiFetchFn = vi.fn().mockRejectedValue(temporaryError(status));
    await expect(gradeSavedCallQaAttempt('saved-3', { apiFetchFn }))
      .rejects.toMatchObject({ status });
    expect(apiFetchFn).toHaveBeenCalledTimes(1);
  });
});
