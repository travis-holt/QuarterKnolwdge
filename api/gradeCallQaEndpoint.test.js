// Handler-level tests for POST /api/grade-call-qa focused on the PR-1 model
// pinning and versioned grading metadata. The Gemini client, auth gate, and SOP
// context are mocked so no network call is made — the pipeline runs offline and
// deterministically.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { MODEL } from './_gemini-client.js';
import { QA_RUBRIC_VERSION } from './_qa-rubric.js';
import { getCallQaScenarioById } from '../src/data/callQaScenarios.js';

const geminiWithRotation = vi.fn();

vi.mock('./_gemini-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getApiKeys: () => ['k1', 'k2'],
    geminiWithRotation: (...args) => geminiWithRotation(...args),
  };
});
vi.mock('./_auth.js', () => ({ validateSecret: vi.fn(async () => false) }));
vi.mock('./_sop-context.js', () => ({
  sopContextFor: () => 'SOP CONTEXT (mock)',
  sopContextForFresh: async () => 'SOP CONTEXT (mock)',
}));

const { default: handler, CALL_QA_PROMPT_VERSION, callQaGraderModel } = await import('./grade-call-qa.js');

const fixture = JSON.parse(readFileSync(new URL('./fixtures/qa-model-capture.example.json', import.meta.url), 'utf8'));
const validText = JSON.stringify(fixture.rawModelResponse);

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    body: {
      scenario: fixture.request.scenario,
      transcript: fixture.transcript,
      department: 'pediatrics',
      qaScenarioId: fixture.scenarioId,
      ...overrides,
    },
  };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

const OK = (text, model = MODEL) => ({ ok: true, text, model });

beforeEach(() => {
  geminiWithRotation.mockReset();
  delete process.env.CALL_QA_GRADER_MODEL;
});
afterEach(() => {
  delete process.env.CALL_QA_GRADER_MODEL;
});

describe('callQaGraderModel', () => {
  it('defaults to MODEL when unset', () => {
    expect(callQaGraderModel({})).toBe(MODEL);
  });
  it('uses a configured value exactly', () => {
    expect(callQaGraderModel({ CALL_QA_GRADER_MODEL: 'gemini-x-custom' })).toBe('gemini-x-custom');
  });
  it('trims whitespace and falls back to MODEL on an empty configured value', () => {
    expect(callQaGraderModel({ CALL_QA_GRADER_MODEL: '  gemini-trim  ' })).toBe('gemini-trim');
    expect(callQaGraderModel({ CALL_QA_GRADER_MODEL: '   ' })).toBe(MODEL);
  });
});

describe('grade-call-qa endpoint — pinned model', () => {
  it('invokes exactly ONE model (the pinned default) and never a fallback chain', async () => {
    geminiWithRotation.mockResolvedValue(OK(validText));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(geminiWithRotation).toHaveBeenCalledTimes(1);
    const opts = geminiWithRotation.mock.calls[0][2];
    expect(opts.models).toEqual([MODEL]); // single pinned model — no STABLE/LITE fallback
  });

  it('uses the configured CALL_QA_GRADER_MODEL exactly', async () => {
    process.env.CALL_QA_GRADER_MODEL = 'gemini-pinned-test';
    geminiWithRotation.mockResolvedValue(OK(validText, 'gemini-pinned-test'));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(geminiWithRotation.mock.calls[0][2].models).toEqual(['gemini-pinned-test']);
  });

  it('a pinned-model 429/exhaustion returns a grading failure without a Lite/Stable fallback', async () => {
    geminiWithRotation.mockResolvedValue({ ok: false, reason: 'exhausted' });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(429);
    // Only the pinned model was ever requested — no second model attempt.
    expect(geminiWithRotation).toHaveBeenCalledTimes(1);
    expect(geminiWithRotation.mock.calls[0][2].models).toEqual([MODEL]);
  });

  it('a malformed-output retry uses the SAME pinned model (no fallback)', async () => {
    geminiWithRotation
      .mockResolvedValueOnce(OK('not json at all'))
      .mockResolvedValueOnce(OK(validText));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(geminiWithRotation).toHaveBeenCalledTimes(2);
    expect(geminiWithRotation.mock.calls[0][2].models).toEqual([MODEL]);
    expect(geminiWithRotation.mock.calls[1][2].models).toEqual([MODEL]);
  });

  it('malformed ABSENCE evidence trips the malformed-response retry', () => {
    // A well-formed JSON that violates the basis contract (NOT_MET/ABSENCE with a
    // non-whitespace quote) must fail validation and be retried, not accepted.
    const invalid = JSON.parse(validText);
    invalid.criteria = invalid.criteria.map((c) =>
      c.id === 'open-greet' ? { ...c, verdict: 'NOT_MET', basis: 'ABSENCE', evidence: 'incorrect', note: 'x' } : c);
    return (async () => {
      geminiWithRotation
        .mockResolvedValueOnce(OK(JSON.stringify(invalid)))
        .mockResolvedValueOnce(OK(validText));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res.statusCode).toBe(200);
      expect(geminiWithRotation).toHaveBeenCalledTimes(2); // first (invalid) → retry → valid
    })();
  });
});

describe('grade-call-qa endpoint — versioned grading metadata', () => {
  it('records model, rubric/prompt/scenario versions, and a server ISO gradedAt', async () => {
    // Simulate the fallback answering to prove the ACTUAL model is recorded.
    geminiWithRotation.mockResolvedValue(OK(validText, 'gemini-2.5-flash-lite'));
    const res = makeRes();
    await handler(makeReq(), res);
    const meta = res.body.qa.gradingMetadata;
    expect(meta).toEqual({
      model: 'gemini-2.5-flash-lite',
      rubricVersion: QA_RUBRIC_VERSION,
      promptVersion: CALL_QA_PROMPT_VERSION,
      scenarioVersion: getCallQaScenarioById(fixture.scenarioId).version,
      gradedAt: expect.any(String),
    });
    // gradedAt is a valid, server-generated ISO timestamp.
    expect(new Date(meta.gradedAt).toISOString()).toBe(meta.gradedAt);
  });

  it('ignores client-supplied model/version/gradedAt metadata', async () => {
    geminiWithRotation.mockResolvedValue(OK(validText, MODEL));
    const res = makeRes();
    await handler(makeReq({
      metadata: { model: 'forged-model', scenarioVersion: 'forged', gradedAt: '1999-01-01T00:00:00.000Z' },
    }), res);
    const meta = res.body.qa.gradingMetadata;
    expect(meta.model).toBe(MODEL); // actual model, not the forged one
    expect(meta.scenarioVersion).toBe(getCallQaScenarioById(fixture.scenarioId).version);
    expect(meta.gradedAt).not.toBe('1999-01-01T00:00:00.000Z');
  });
});
