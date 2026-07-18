// ─────────────────────────────────────────────────────────────────────────────
// UNIT TESTS for api/_gemini-client.js — getApiKeys and geminiWithRotation.
//
// geminiWithRotation is tested by injecting a mock fetch via Vitest's
// vi.stubGlobal so we never make a real network call.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  callGemini,
  geminiTimeoutMs,
  getApiKeys,
  geminiWithRotation,
  resetCooldowns,
  rotationFailure,
  redactKeys,
  MODEL,
  STABLE_MODEL,
  LITE_MODEL,
} from './_gemini-client.js';

// ── getApiKeys ────────────────────────────────────────────────────────────────

describe('getApiKeys', () => {
  const orig = { ...process.env };
  afterEach(() => {
    // restore original env
    delete process.env.GEMINI_API_KEYS;
    delete process.env.GEMINI_API_KEY;
    Object.assign(process.env, orig);
  });

  it('returns [] when no env var is set', () => {
    delete process.env.GEMINI_API_KEYS;
    delete process.env.GEMINI_API_KEY;
    expect(getApiKeys()).toEqual([]);
  });

  it('reads a single key from GEMINI_API_KEY', () => {
    delete process.env.GEMINI_API_KEYS;
    process.env.GEMINI_API_KEY = 'key-single';
    expect(getApiKeys()).toEqual(['key-single']);
  });

  it('reads multiple keys from GEMINI_API_KEYS (comma-separated)', () => {
    process.env.GEMINI_API_KEYS = 'key-a,key-b,key-c';
    delete process.env.GEMINI_API_KEY;
    expect(getApiKeys()).toEqual(['key-a', 'key-b', 'key-c']);
  });

  it('trims whitespace from keys', () => {
    process.env.GEMINI_API_KEYS = ' key-a , key-b ';
    expect(getApiKeys()).toEqual(['key-a', 'key-b']);
  });

  it('de-duplicates keys', () => {
    process.env.GEMINI_API_KEYS = 'key-a,key-a,key-b';
    expect(getApiKeys()).toEqual(['key-a', 'key-b']);
  });

  it('prefers GEMINI_API_KEYS over GEMINI_API_KEY when both are set', () => {
    process.env.GEMINI_API_KEYS = 'key-multi';
    process.env.GEMINI_API_KEY  = 'key-single';
    expect(getApiKeys()).toEqual(['key-multi']);
  });

  it('ignores empty segments in the comma list', () => {
    process.env.GEMINI_API_KEYS = 'key-a,,key-b,';
    expect(getApiKeys()).toEqual(['key-a', 'key-b']);
  });
});

describe('server-side request timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses a bounded configurable timeout', () => {
    expect(geminiTimeoutMs({})).toBe(25_000);
    expect(geminiTimeoutMs({ GEMINI_REQUEST_TIMEOUT_MS: '500' })).toBe(1_000);
    expect(geminiTimeoutMs({ GEMINI_REQUEST_TIMEOUT_MS: '999999' })).toBe(120_000);
  });

  it('aborts a stalled upstream fetch', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    })));
    const assertion = expect(callGemini('secret-key', {}, MODEL, 1_000))
      .rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

// ── geminiWithRotation ────────────────────────────────────────────────────────

// Build a mock fetch factory.
const okResponse = (text) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  text: async () => text,
});

const errResponse = (status) => ({
  ok: false, status,
  json: async () => ({}),
  text: async () => `error ${status}`,
});

describe('geminiWithRotation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    resetCooldowns(); // cooldown state is module-level — isolate tests
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns { ok: true, text, model } on a successful first call', async () => {
    fetch.mockResolvedValue(okResponse('hello'));
    const result = await geminiWithRotation(['key1'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: true, text: 'hello', model: MODEL, attemptCount: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rotates to the next key on a 429 and succeeds', async () => {
    fetch
      .mockResolvedValueOnce(errResponse(429))
      .mockResolvedValueOnce(okResponse('retry-ok'));
    const result = await geminiWithRotation(['key1', 'key2'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: true, text: 'retry-ok', model: MODEL, attemptCount: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns { ok: false, reason: exhausted } when all keys are rate-limited', async () => {
    fetch.mockResolvedValue(errResponse(429));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: false, reason: 'exhausted', attemptCount: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns { ok: false, reason: auth } when every key returns 403', async () => {
    fetch.mockResolvedValue(errResponse(403));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: false, reason: 'auth', attemptCount: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rotates from a 403 key to a healthy second key', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetch.mockResolvedValueOnce(errResponse(403)).mockResolvedValueOnce(okResponse('healthy'));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: true, text: 'healthy', attemptCount: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toContain('key=k2');
  });

  it('returns auth when two allowed attempts both return 403', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetch.mockResolvedValue(errResponse(403));
    const result = await geminiWithRotation(['k1', 'k2', 'k3', 'k4'], {}, {
      label: 'grade-call-qa', maxAttempts: 2,
    });
    expect(result).toMatchObject({ ok: false, reason: 'auth', attemptCount: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns exhausted when a 403 is mixed with a 503', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetch.mockResolvedValueOnce(errResponse(403)).mockResolvedValueOnce(errResponse(503));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: false, reason: 'exhausted', attemptCount: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns { ok: false, reason: fatal } immediately on a non-rotatable error (400)', async () => {
    fetch.mockResolvedValue(errResponse(400));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('fatal');
    // 400 is not rotatable — should not try the second key
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stops immediately on a 401 request/auth failure', async () => {
    fetch.mockResolvedValue(errResponse(401));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: false, reason: 'fatal', status: 401, attemptCount: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats a fetch network error as transient and rotates', async () => {
    fetch
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(okResponse('recovered'));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: true, text: 'recovered', model: MODEL, attemptCount: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns exhausted (not auth) when transient fetch and HTTP failures mix', async () => {
    fetch
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(errResponse(429));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: false, reason: 'exhausted', attemptCount: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // ── model fallback (per-model quota buckets) ───────────────────────────────

  it('falls back to the next model when all keys are rate-limited on the primary', async () => {
    fetch
      .mockResolvedValueOnce(errResponse(429)) // k1 on MODEL
      .mockResolvedValueOnce(errResponse(429)) // k2 on MODEL
      .mockResolvedValueOnce(okResponse('lite-ok')); // first key tried on LITE_MODEL
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test', models: [MODEL, LITE_MODEL] });
    // The returned model is the one that actually answered — the fallback, not
    // the requested default.
    expect(result).toMatchObject({ ok: true, text: 'lite-ok', model: LITE_MODEL, attemptCount: 3 });
    expect(fetch).toHaveBeenCalledTimes(3);
    // first two calls hit the primary model, the third the fallback
    expect(fetch.mock.calls[0][0]).toContain(`/models/${MODEL}:`);
    expect(fetch.mock.calls[1][0]).toContain(`/models/${MODEL}:`);
    expect(fetch.mock.calls[2][0]).toContain(`/models/${LITE_MODEL}:`);
  });

  it('does not touch the fallback model when the primary succeeds', async () => {
    fetch.mockResolvedValue(okResponse('primary-ok'));
    const result = await geminiWithRotation(['k1'], {}, { label: 'test', models: [MODEL, LITE_MODEL] });
    expect(result).toMatchObject({ ok: true, text: 'primary-ok', model: MODEL, attemptCount: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain(`/models/${MODEL}:`);
  });

  it('returns exhausted when every key fails on every model', async () => {
    fetch.mockResolvedValue(errResponse(429));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test', models: [MODEL, LITE_MODEL] });
    expect(result).toMatchObject({ ok: false, reason: 'exhausted', attemptCount: 4 });
    expect(fetch).toHaveBeenCalledTimes(4); // 2 keys × 2 models
  });

  it('a non-rotatable 400 aborts immediately without trying the fallback model', async () => {
    fetch.mockResolvedValue(errResponse(400));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test', models: [MODEL, LITE_MODEL] });
    expect(result.reason).toBe('fatal');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('defaults to the primary model only when models is not passed', async () => {
    fetch.mockResolvedValue(errResponse(429));
    const result = await geminiWithRotation(['k1'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: false, reason: 'exhausted', attemptCount: 1 });
    expect(fetch).toHaveBeenCalledTimes(1); // no second-model retry
  });

  it('returns the actual successful model (a single pinned model returns that model)', async () => {
    fetch.mockResolvedValue(okResponse('pinned'));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'grade-call-qa', models: [STABLE_MODEL] });
    expect(result.model).toBe(STABLE_MODEL);
    // Backward compatible: callers that only read text still work.
    expect(result.text).toBe('pinned');
  });

  // ── per-key cooldown ───────────────────────────────────────────────────────

  const stalledFetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });

  it('limits four timing-out keys to two actual fetch calls when maxAttempts is 2', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetch.mockImplementation(stalledFetch);
    const pending = geminiWithRotation(['k1', 'k2', 'k3', 'k4'], {}, {
      label: 'test', timeoutMs: 1_000, maxAttempts: 2, totalDeadlineMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'exhausted', attemptCount: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('limits four 403 keys to two Call QA fetches while classifying attempted failures as auth', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetch.mockResolvedValue(errResponse(403));
    const result = await geminiWithRotation(['k1', 'k2', 'k3', 'k4'], {}, {
      label: 'grade-call-qa', maxAttempts: 2, timeoutMs: 40_000, totalDeadlineMs: 85_000,
    });
    expect(result).toMatchObject({ ok: false, reason: 'auth', attemptCount: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('can rotate to a healthy second key within the attempt budget', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetch.mockResolvedValueOnce(errResponse(503)).mockResolvedValueOnce(okResponse('healthy'));
    const result = await geminiWithRotation(['k1', 'k2', 'k3', 'k4'], {}, { label: 'test', maxAttempts: 2 });
    expect(result).toMatchObject({ ok: true, text: 'healthy', attemptCount: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toContain('key=k2');
  });

  it('does not start another request after totalDeadlineMs expires', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetch.mockImplementation(stalledFetch);
    const pending = geminiWithRotation(['k1', 'k2'], {}, {
      label: 'test', timeoutMs: 10_000, maxAttempts: 2, totalDeadlineMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'exhausted', attemptCount: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries one timeout and succeeds on the second call', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetch.mockImplementationOnce(stalledFetch).mockResolvedValueOnce(okResponse('recovered'));
    const pending = geminiWithRotation(['k1', 'k2'], {}, {
      label: 'test', timeoutMs: 1_000, maxAttempts: 2, totalDeadlineMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ ok: true, text: 'recovered', attemptCount: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains full key rotation when callers omit bounded-attempt options', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetch.mockResolvedValue(errResponse(408));
    const result = await geminiWithRotation(['k1', 'k2', 'k3', 'k4'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: false, reason: 'exhausted', attemptCount: 4 });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  const err429WithDelay = (seconds) => ({
    ok: false, status: 429,
    json: async () => ({}),
    text: async () => `{"error":{"details":[{"retryDelay":"${seconds}s"}]}}`,
  });

  it('skips a key that is cooling down after a 429 (no wasted round-trip)', async () => {
    fetch.mockResolvedValue(errResponse(429));
    await geminiWithRotation(['k1'], {}, { label: 'test' }); // trips the cooldown
    expect(fetch).toHaveBeenCalledTimes(1);

    const result = await geminiWithRotation(['k1'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: false, reason: 'exhausted', attemptCount: 0 });
    expect(fetch).toHaveBeenCalledTimes(1); // second request made ZERO network calls
  });

  it('routes straight to the healthy key while another key is cooling', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // start rotation at key index 0
    fetch
      .mockResolvedValueOnce(errResponse(429)) // ka trips cooldown
      .mockResolvedValue(okResponse('ok'));
    await geminiWithRotation(['ka', 'kb'], {}, { label: 'test' });
    expect(fetch).toHaveBeenCalledTimes(2);

    const result = await geminiWithRotation(['ka', 'kb'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: true, text: 'ok', model: MODEL, attemptCount: 1 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][0]).toContain('key=kb'); // ka was skipped
  });

  it('honors the retryDelay from the 429 body and lets the key back in after it', async () => {
    const t0 = Date.now();
    fetch.mockResolvedValueOnce(err429WithDelay(5)).mockResolvedValue(okResponse('back'));
    await geminiWithRotation(['k1'], {}, { label: 'test' }); // cooling until t0+5s
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, 'now').mockReturnValue(t0 + 1000); // 1s in — still cooling
    expect(await geminiWithRotation(['k1'], {}, { label: 'test' }))
      .toMatchObject({ ok: false, reason: 'exhausted', attemptCount: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);

    Date.now.mockReturnValue(t0 + 6000); // past the 5s retryDelay
    expect(await geminiWithRotation(['k1'], {}, { label: 'test' }))
      .toMatchObject({ ok: true, text: 'back', model: MODEL, attemptCount: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('puts a key on cooldown after a 503 (capacity-dead model is not re-probed)', async () => {
    fetch.mockResolvedValue(errResponse(503));
    await geminiWithRotation(['k1'], {}, { label: 'test' }); // trips the cooldown
    expect(fetch).toHaveBeenCalledTimes(1);

    const result = await geminiWithRotation(['k1'], {}, { label: 'test' });
    expect(result).toMatchObject({ ok: false, reason: 'exhausted', attemptCount: 0 });
    expect(fetch).toHaveBeenCalledTimes(1); // second request made ZERO network calls
  });

  it('a 503-cooling primary falls straight through to the stable fallback model', async () => {
    fetch
      .mockResolvedValueOnce(errResponse(503)) // k1 on MODEL → cooldown
      .mockResolvedValue(okResponse('stable-ok'));
    await geminiWithRotation(['k1'], {}, { label: 'test', models: [MODEL, STABLE_MODEL] });
    expect(fetch).toHaveBeenCalledTimes(2);

    const result = await geminiWithRotation(['k1'], {}, { label: 'test', models: [MODEL, STABLE_MODEL] });
    expect(result).toMatchObject({ ok: true, text: 'stable-ok', model: STABLE_MODEL, attemptCount: 1 });
    expect(fetch).toHaveBeenCalledTimes(3); // MODEL skipped — only STABLE_MODEL was called
    expect(fetch.mock.calls[2][0]).toContain(`/models/${STABLE_MODEL}:`);
  });

  it('cooldown is per model — a key cooling on the primary is still tried on the fallback', async () => {
    fetch
      .mockResolvedValueOnce(errResponse(429)) // k1 on MODEL → cooldown for MODEL only
      .mockResolvedValue(okResponse('lite-ok'));
    await geminiWithRotation(['k1'], {}, { label: 'test' }); // MODEL-only request trips it
    const result = await geminiWithRotation(['k1'], {}, { label: 'test', models: [MODEL, LITE_MODEL] });
    expect(result).toMatchObject({ ok: true, text: 'lite-ok', model: LITE_MODEL, attemptCount: 1 });
    // second request skipped MODEL (cooling) and went straight to LITE_MODEL
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toContain(`/models/${LITE_MODEL}:`);
  });
});

// ── rotationFailure ───────────────────────────────────────────────────────────

describe('rotationFailure', () => {
  it('maps fatal to 502 with the status in the default message', () => {
    expect(rotationFailure({ reason: 'fatal', status: 400 })).toEqual({
      status: 502, error: 'Gemini request failed (400).',
    });
  });

  it('maps auth to 500', () => {
    const failure = rotationFailure({ reason: 'auth' });
    expect(failure.status).toBe(500);
    expect(failure.error).toMatch(/Every attempted Gemini request/);
    expect(failure.error).not.toMatch(/All Gemini keys/);
  });

  it('maps exhausted (and any other reason) to 429', () => {
    expect(rotationFailure({ reason: 'exhausted' }).status).toBe(429);
    expect(rotationFailure({ reason: 'exhausted' }).error).toMatch(/rate-limited/);
  });

  it('honours per-handler message overrides without changing the status', () => {
    expect(rotationFailure({ reason: 'fatal', status: 400 }, { fatal: 'custom fatal' }))
      .toEqual({ status: 502, error: 'custom fatal' });
    expect(rotationFailure({ reason: 'exhausted' }, { exhausted: 'busy' }))
      .toEqual({ status: 429, error: 'busy' });
  });
});

// ── redactKeys ────────────────────────────────────────────────────────────────

describe('redactKeys', () => {
  it('redacts key query params in URLs', () => {
    expect(redactKeys('fetch failed: https://x.googleapis.com/v1?key=AIzaSecret123&x=1'))
      .toBe('fetch failed: https://x.googleapis.com/v1?key=***&x=1');
  });

  it('redacts &key= as well as ?key=', () => {
    expect(redactKeys('wss://host/path?alt=json&key=abc')).toBe('wss://host/path?alt=json&key=***');
  });

  it('leaves ordinary text untouched and tolerates non-strings', () => {
    expect(redactKeys('plain message')).toBe('plain message');
    expect(redactKeys(null)).toBe('');
    expect(redactKeys(undefined)).toBe('');
  });
});
