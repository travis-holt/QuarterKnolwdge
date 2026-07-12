import { describe, expect, it, vi } from 'vitest';
import { createSopStore } from './_sop-store.js';

describe('SOP store concurrency', () => {
  it('makes concurrent fresh callers await the same refresh', async () => {
    let release;
    const loader = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const store = createSopStore(loader);
    const first = store.get('pediatrics');
    const second = store.get('pediatrics');
    expect(loader).toHaveBeenCalledOnce();
    release('live SOP');
    await expect(first).resolves.toBe('live SOP');
    await expect(second).resolves.toBe('live SOP');
  });

  it('serves the cached value synchronously while a stale refresh runs', async () => {
    const loader = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    const store = createSopStore(loader, 0);
    await store.get('obgyn');
    expect(store.getSync('obgyn')).toBe('v1');
    await store.refresh('obgyn');
    expect(store.getSync('obgyn')).toBe('v2');
  });
});
