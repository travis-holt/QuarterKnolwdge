// Tests for the shared client fetch helpers — previously the only untested
// pure logic in src/lib (runPooled's bounded fan-out is branch-heavy and load-bearing
// for SpotTheError + the audit bank).
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./firebase.js', () => ({ getFirebaseIdToken: vi.fn().mockResolvedValue('firebase-id-token') }));

import { apiFetch, fetchErrorMessage, runPooled } from './apiFetch.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchErrorMessage', () => {
  it('returns the timeout message for AbortError', () => {
    const err = new Error('x');
    err.name = 'AbortError';
    expect(fetchErrorMessage(err, 'timed out', 'fallback')).toBe('timed out');
  });

  it('returns the error message when present', () => {
    expect(fetchErrorMessage(new Error('boom'), 'timed out', 'fallback')).toBe('boom');
  });

  it('falls back when the message is empty', () => {
    expect(fetchErrorMessage(new Error(''), 'timed out', 'fallback')).toBe('fallback');
  });

  it('tolerates a null/undefined error', () => {
    expect(fetchErrorMessage(null, 'timed out', 'fallback')).toBe('fallback');
    expect(fetchErrorMessage(undefined, 'timed out', 'fallback')).toBe('fallback');
  });
});

describe('apiFetch', () => {
  it('POSTs JSON with same-origin credentials and NO secret injected', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hello: 1 }) });
    vi.stubGlobal('fetch', fetchMock);
    const data = await apiFetch('/api/x', { a: 1 });
    expect(data).toEqual({ hello: 1 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/x');
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('same-origin');
    expect(opts.headers.Authorization).toBe('Bearer firebase-id-token');
    // Body is exactly the payload — the public passcode is no longer attached.
    const sent = JSON.parse(opts.body);
    expect(sent).toEqual({ a: 1 });
    expect(sent).not.toHaveProperty('secret');
  });

  it('throws the server error message on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, json: async () => ({ error: 'rate limited' }),
    }));
    await expect(apiFetch('/api/x', {})).rejects.toThrow('rate limited');
  });

  it('throws a generic message when the error body is unparseable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => { throw new Error('bad json'); },
    }));
    await expect(apiFetch('/api/x', {})).rejects.toThrow('Request failed (500)');
  });
});

describe('runPooled', () => {
  it('returns allSettled-shaped results in input order', async () => {
    const results = await runPooled([1, 2, 3], 2, async (n) => n * 10);
    expect(results).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 30 },
    ]);
  });

  it('captures per-item rejections without failing the batch', async () => {
    const boom = new Error('boom');
    const results = await runPooled([1, 2], 2, async (n) => {
      if (n === 2) throw boom;
      return n;
    });
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
    expect(results[1]).toEqual({ status: 'rejected', reason: boom });
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await runPooled([1, 2, 3, 4, 5], 2, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('handles an empty item list', async () => {
    expect(await runPooled([], 3, async () => 1)).toEqual([]);
  });
});
