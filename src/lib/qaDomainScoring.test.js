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

describe('qaDomainScoring — verified auto-fails', () => {
  function qaWithFails(criteria, autoFails) {
    return { criteria, autoFails };
  }

  it('leaves criterion-only scoring unchanged when autoFails is empty/absent', () => {
    const withEmpty = scoreQaByDomain(qaWithFails([{ id: 'open-greet', verdict: 'MET' }], []));
    const withNone = scoreQaByDomain(qa([{ id: 'open-greet', verdict: 'MET' }]));
    expect(withEmpty.intake).toEqual({ earned: 4, possible: 4, score: 100, criteria: ['open-greet'] });
    expect(withNone.intake).toEqual(withEmpty.intake);
    expect(withEmpty.intake.autoFailed).toBeUndefined();
  });

  it('af-scope marks boundaries as autoFailed with score 0', () => {
    const scores = scoreQaByDomain(qaWithFails(
      [{ id: 'open-greet', verdict: 'MET' }],
      [{ id: 'af-scope', text: 'Read lab/imaging results...' }],
    ));
    // boundaries had no normal criteria here → non-null zeroed record with the auto-fail
    expect(scores.boundaries).toEqual(expect.objectContaining({
      earned: 0, possible: 0, score: 0, criteria: [], autoFailed: true,
    }));
    expect(scores.boundaries.autoFails).toHaveLength(1);
    expect(scores.boundaries.autoFails[0].id).toBe('af-scope');
    expect(typeof scores.boundaries.autoFails[0].text).toBe('string');
    // an unaffected domain still scores normally
    expect(scores.intake).toEqual(expect.objectContaining({ score: 100 }));
  });

  it('af-hipaa marks both intake and boundaries as autoFailed', () => {
    const scores = scoreQaByDomain(qaWithFails(
      [{ id: 'open-greet', verdict: 'MET' }],
      [{ id: 'af-hipaa', text: 'Disclosed PHI before verification.' }],
    ));
    expect(scores.intake).toEqual(expect.objectContaining({ score: 0, autoFailed: true }));
    expect(scores.boundaries).toEqual(expect.objectContaining({ score: 0, autoFailed: true }));
    expect(scores.intake.autoFails[0].id).toBe('af-hipaa');
  });

  it('an affected domain with high MET criteria cannot read as a clean high score', () => {
    const scores = scoreQaByDomain(qaWithFails(
      // verify-three MET would give boundaries a 100…
      [{ id: 'verify-three', verdict: 'MET' }],
      // …but a verified scope auto-fail must zero it.
      [{ id: 'af-scope', text: 'Read lab/imaging results...' }],
    ));
    expect(scores.boundaries.score).toBe(0);
    expect(scores.boundaries.autoFailed).toBe(true);
    // earned zeroed, but the criteria detail is preserved for supervisor context
    expect(scores.boundaries.earned).toBe(0);
    expect(scores.boundaries.criteria).toContain('verify-three');
  });

  it('competency scoring also reflects auto-fails', () => {
    const scores = scoreQaByCompetency(qaWithFails(
      [{ id: 'comm-plain', verdict: 'MET' }],
      [{ id: 'af-scope', text: 'Read lab/imaging results...' }],
    ));
    // af-scope tags compliance, escalation, riskManagement
    expect(scores.compliance).toEqual(expect.objectContaining({ score: 0, autoFailed: true }));
    expect(scores.escalation).toEqual(expect.objectContaining({ score: 0, autoFailed: true }));
    expect(scores.riskManagement).toEqual(expect.objectContaining({ score: 0, autoFailed: true }));
  });

  it('ignores unknown auto-fail ids', () => {
    const scores = scoreQaByDomain(qaWithFails(
      [{ id: 'open-greet', verdict: 'MET' }],
      [{ id: 'af-nonexistent', text: 'nope' }],
    ));
    expect(scores.intake).toEqual(expect.objectContaining({ score: 100 }));
    expect(scores.boundaries).toBeNull();
  });
});
