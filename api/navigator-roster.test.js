import { describe, expect, it } from 'vitest';
import { navigatorRosterProjection } from './navigator-roster.js';

const doc = (id, data) => ({ id, data: () => data });

describe('navigatorRosterProjection', () => {
  it('returns only active names and PIN status, never PIN material', async () => {
    const db = {
      collection: () => ({
        get: async () => ({ docs: [
          doc('b', { name: 'Bea', pinHash: 'secret-hash' }),
          doc('a', { name: 'Ada', pin: '1234' }),
          doc('c', { name: 'Cyd', status: 'inactive', pinHash: 'secret' }),
        ] }),
      }),
    };
    const result = await navigatorRosterProjection(db);
    expect(result).toEqual([
      { id: 'a', name: 'Ada', pinSet: true },
      { id: 'b', name: 'Bea', pinSet: true },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/1234|secret-hash/);
  });
});
