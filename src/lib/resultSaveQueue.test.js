import { describe, expect, it, vi } from 'vitest';
import { ResultSaveQueue, resultSaveKey } from './resultSaveQueue.js';

const argsFor = (type) => ['nav-1', 'Ada', {}, {}, 'pediatrics', {}, type];

describe('ResultSaveQueue', () => {
  it('keeps an earlier failed MCQ save after a later Spot save succeeds', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const queue = new ResultSaveQueue(save);

    expect(await queue.save(argsFor('mcq'))).toBe(false);
    expect(await queue.save(argsFor('spot'))).toBe(true);
    expect(queue.size).toBe(1);
    expect(queue.pending.has(resultSaveKey(argsFor('mcq')))).toBe(true);
  });

  it('retries every independent failed result and removes only successes', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('mcq offline'))
      .mockRejectedValueOnce(new Error('spot offline'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('spot still offline'));
    const queue = new ResultSaveQueue(save);
    await queue.save(argsFor('mcq'));
    await queue.save(argsFor('spot'));

    await queue.retryAll();
    expect(queue.size).toBe(1);
    expect(queue.pending.has(resultSaveKey(argsFor('spot')))).toBe(true);
  });

  it('does not re-queue an older concurrent failure after a newer save succeeds', async () => {
    let rejectOld;
    const old = new Promise((_, reject) => { rejectOld = reject; });
    const save = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce(undefined);
    const queue = new ResultSaveQueue(save);

    const olderAttempt = queue.save(argsFor('mcq'));
    expect(await queue.save(argsFor('mcq'))).toBe(true);
    rejectOld(new Error('stale failure'));
    expect(await olderAttempt).toBe(false);
    expect(queue.size).toBe(0);
  });

  it('does not retry a stale queued payload while a newer save is in flight', async () => {
    let finishNew;
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('old offline'))
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
    const queue = new ResultSaveQueue(save);
    await queue.save(argsFor('mcq'));

    const newerAttempt = queue.save(argsFor('mcq'));
    expect(queue.size).toBe(0);
    await queue.retryAll();
    expect(save).toHaveBeenCalledTimes(2);
    finishNew();
    await newerAttempt;
  });
});
