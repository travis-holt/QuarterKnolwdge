// ─────────────────────────────────────────────────────────────────────────────
// UNIT TESTS for api/_gemini-client.js — getApiKeys and geminiWithRotation.
//
// geminiWithRotation is tested by injecting a mock fetch via Vitest's
// vi.stubGlobal so we never make a real network call.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getApiKeys, geminiWithRotation, resetCooldowns, MODEL, LITE_MODEL } from './_gemini-client.js';

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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns { ok: true, text } on a successful first call', async () => {
    fetch.mockResolvedValue(okResponse('hello'));
    const result = await geminiWithRotation(['key1'], {}, { label: 'test' });
    expect(result).toEqual({ ok: true, text: 'hello' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rotates to the next key on a 429 and succeeds', async () => {
    fetch
      .mockResolvedValueOnce(errResponse(429))
      .mockResolvedValueOnce(okResponse('retry-ok'));
    const result = await geminiWithRotation(['key1', 'key2'], {}, { label: 'test' });
    expect(result).toEqual({ ok: true, text: 'retry-ok' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns { ok: false, reason: exhausted } when all keys are rate-limited', async () => {
    fetch.mockResolvedValue(errResponse(429));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result).toEqual({ ok: false, reason: 'exhausted' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns { ok: false, reason: auth } when every key returns 403', async () => {
    fetch.mockResolvedValue(errResponse(403));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result).toEqual({ ok: false, reason: 'auth' });
  });

  it('returns { ok: false, reason: fatal } immediately on a non-rotatable error (400)', async () => {
    fetch.mockResolvedValue(errResponse(400));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('fatal');
    // 400 is not rotatable — should not try the second key
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats a fetch() network throw as a transient failure and rotates', async () => {
    fetch
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(okResponse('recovered'));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result).toEqual({ ok: true, text: 'recovered' });
  });

  it('returns exhausted (not auth) when mix of 429 and network errors', async () => {
    fetch
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(errResponse(429));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test' });
    expect(result).toEqual({ ok: false, reason: 'exhausted' });
  });

  // ── model fallback (per-model quota buckets) ───────────────────────────────

  it('falls back to the next model when all keys are rate-limited on the primary', async () => {
    fetch
      .mockResolvedValueOnce(errResponse(429)) // k1 on MODEL
      .mockResolvedValueOnce(errResponse(429)) // k2 on MODEL
      .mockResolvedValueOnce(okResponse('lite-ok')); // first key tried on LITE_MODEL
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test', models: [MODEL, LITE_MODEL] });
    expect(result).toEqual({ ok: true, text: 'lite-ok' });
    expect(fetch).toHaveBeenCalledTimes(3);
    // first two calls hit the primary model, the third the fallback
    expect(fetch.mock.calls[0][0]).toContain(`/models/${MODEL}:`);
    expect(fetch.mock.calls[1][0]).toContain(`/models/${MODEL}:`);
    expect(fetch.mock.calls[2][0]).toContain(`/models/${LITE_MODEL}:`);
  });

  it('does not touch the fallback model when the primary succeeds', async () => {
    fetch.mockResolvedValue(okResponse('primary-ok'));
    const result = await geminiWithRotation(['k1'], {}, { label: 'test', models: [MODEL, LITE_MODEL] });
    expect(result).toEqual({ ok: true, text: 'primary-ok' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain(`/models/${MODEL}:`);
  });

  it('returns exhausted when every key fails on every model', async () => {
    fetch.mockResolvedValue(errResponse(429));
    const result = await geminiWithRotation(['k1', 'k2'], {}, { label: 'test', models: [MODEL, LITE_MODEL] });
    expect(result).toEqual({ ok: false, reason: 'exhausted' });
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
    expect(result).toEqual({ ok: false, reason: 'exhausted' });
    expect(fetch).toHaveBeenCalledTimes(1); // no second-model retry
  });

  // ── per-key cooldown ───────────────────────────────────────────────────────

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
    expect(result).toEqual({ ok: false, reason: 'exhausted' });
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
    expect(result).toEqual({ ok: true, text: 'ok' });
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
      .toEqual({ ok: false, reason: 'exhausted' });
    expect(fetch).toHaveBeenCalledTimes(1);

    Date.now.mockReturnValue(t0 + 6000); // past the 5s retryDelay
    expect(await geminiWithRotation(['k1'], {}, { label: 'test' }))
      .toEqual({ ok: true, text: 'back' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('cooldown is per model — a key cooling on the primary is still tried on the fallback', async () => {
    fetch
      .mockResolvedValueOnce(errResponse(429)) // k1 on MODEL → cooldown for MODEL only
      .mockResolvedValue(okResponse('lite-ok'));
    await geminiWithRotation(['k1'], {}, { label: 'test' }); // MODEL-only request trips it
    const result = await geminiWithRotation(['k1'], {}, { label: 'test', models: [MODEL, LITE_MODEL] });
    expect(result).toEqual({ ok: true, text: 'lite-ok' });
    // second request skipped MODEL (cooling) and went straight to LITE_MODEL
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toContain(`/models/${LITE_MODEL}:`);
  });
});
