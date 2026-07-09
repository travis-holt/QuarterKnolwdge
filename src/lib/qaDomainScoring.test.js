import { describe, expect, it } from 'vitest';

import { scoreQaByCompetency, scoreQaByDomain, qaDomainScoreSummary } from './qaDomainScoring.js';
import { DOMAINS } from '../data/questions.js';

function qa(criteria) {
  return { criteria };
}

describe('qaDomainScoring', () => {
  it('MET earns full points', () => {
    const scores = scoreQaByDomain(qa([
      { id: 'open-greet', verdict: 'MET' },
    ]));
    expect(scores.intake).toEqual({
      earned: 4,
      possible: 4,
      score: 100,
      criteria: ['open-greet'],
    });
  });

  it('NOT_MET earns zero against the denominator', () => {
    const scores = scoreQaByDomain(qa([
      { id: 'sched-flow', verdict: 'NOT_MET' },
    ]));
    expect(scores.scheduling).toEqual({
      earned: 0,
      possible: 8,
      score: 0,
      criteria: ['sched-flow'],
    });
  });

  it('NA is excluded from the denominator', () => {
    const scores = scoreQaByDomain(qa([
      { id: 'sched-flow', verdict: 'NA' },
    ]));
    expect(scores.scheduling).toBeNull();
  });

  it('splits multi-domain criteria evenly', () => {
    const scores = scoreQaByDomain(qa([
      { id: 'verify-three', verdict: 'MET' },
    ]));
    expect(scores.intake).toEqual({
      earned: 3,
      possible: 3,
      score: 100,
      criteria: ['verify-three'],
    });
    expect(scores.boundaries).toEqual({
      earned: 3,
      possible: 3,
      score: 100,
      criteria: ['verify-three'],
    });
  });

  it('returns null for domains with no applicable criteria', () => {
    const scores = scoreQaByDomain(qa([
      { id: 'open-greet', verdict: 'MET' },
    ]));
    expect(scores.routing).toBeNull();
  });

  it('rounds scores consistently', () => {
    const scores = scoreQaByDomain(qa([
      { id: 'verify-three', verdict: 'MET' },
      { id: 'verify-before-access', verdict: 'NOT_MET' },
    ]));
    expect(scores.intake?.score).toBe(60);
    expect(scores.boundaries?.score).toBe(60);
  });

  it('builds the combined summary shape', () => {
    const summary = qaDomainScoreSummary(qa([
      { id: 'open-greet', verdict: 'MET' },
      { id: 'verify-three', verdict: 'NOT_MET' },
    ]));
    expect(Object.keys(summary.domainScores)).toEqual(DOMAINS.map((d) => d.id));
    expect(summary.competencyScores.communication).toEqual(expect.objectContaining({ score: 100 }));
    expect(summary.competencyScores.compliance).toEqual(expect.objectContaining({ score: 0 }));
  });

  it('scores competencies the same split-aware way', () => {
    const scores = scoreQaByCompetency(qa([
      { id: 'control-guide', verdict: 'MET' },
      { id: 'control-narrate', verdict: 'NOT_MET' },
    ]));
    expect(scores.communication).toEqual(expect.objectContaining({
      earned: 2.5,
      possible: 5,
      score: 50,
    }));
  });
});
