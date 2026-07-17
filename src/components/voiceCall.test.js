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
  });

  it('returns the server-persisted grade/qa', async () => {
    const apiFetchFn = vi.fn().mockResolvedValue({ grade: { score: 77 }, qa: { pass: false }, attemptId: 'a2' });
    const data = await gradeCallQaByAttemptId('a2', apiFetchFn);
    expect(data.grade.score).toBe(77);
    expect(data.qa.pass).toBe(false);
  });
});
