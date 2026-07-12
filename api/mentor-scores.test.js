import { describe, expect, it } from 'vitest';
import { latestMentorProjection } from './mentor-scores.js';

describe('latestMentorProjection', () => {
  it('returns a minimal latest-per-navigator projection with nanosecond precision', () => {
    const docs = [
      {
        navigatorId: 'nav-1', name: 'Ada', department: 'pediatrics',
        scores: { routing: 40 }, answers: { secret: 'choice' },
        submittedAt: { seconds: 10, nanoseconds: 100 },
      },
      {
        navigatorId: 'nav-1', name: 'Ada', department: 'pediatrics',
        scores: { routing: 90 }, competencyScores: { hidden: 1 },
        submittedAt: { seconds: 10, nanoseconds: 900_000_000 },
      },
      {
        navigatorId: 'nav-2', name: 'Bea', department: 'obgyn',
        scores: { routing: 100 }, submittedAt: { seconds: 11 },
      },
    ];
    const result = latestMentorProjection(docs, 'pediatrics');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ navigatorId: 'nav-1', name: 'Ada', scores: { routing: 90 } });
    expect(result[0]).not.toHaveProperty('answers');
    expect(result[0]).not.toHaveProperty('competencyScores');
  });
});
