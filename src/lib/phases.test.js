import { describe, it, expect } from 'vitest';
import { PHASE_ORDER, buildPhases, phasesComplete, nextPhase, completedCount, latestQaForDept, isActiveQaInterview } from './phases.js';

const states = (done) => buildPhases(done).map((p) => p.state);

describe('PHASE_ORDER', () => {
  it('is the fixed mcq → spot → qa sequence', () => {
    expect(PHASE_ORDER).toEqual(['mcq', 'spot', 'qa']);
  });
});

describe('buildPhases', () => {
  it('nothing done: phase 1 is next, the rest locked', () => {
    expect(states({})).toEqual(['next', 'locked', 'locked']);
  });
  it('mcq done: spot is next, qa locked', () => {
    expect(states({ mcq: true })).toEqual(['done', 'next', 'locked']);
  });
  it('mcq+spot done: qa is next', () => {
    expect(states({ mcq: true, spot: true })).toEqual(['done', 'done', 'next']);
  });
  it('all done: everything done, nothing next or locked', () => {
    expect(states({ mcq: true, spot: true, qa: true })).toEqual(['done', 'done', 'done']);
  });
  it('legacy out-of-order completion (spot only): first incomplete is still next', () => {
    // A navigator who took Spot standalone under the old chooser.
    expect(states({ spot: true })).toEqual(['next', 'done', 'locked']);
  });
  it('qa only: mcq next, spot locked, qa done', () => {
    expect(states({ qa: true })).toEqual(['next', 'locked', 'done']);
  });
  it('preserves phase ids in order', () => {
    expect(buildPhases({}).map((p) => p.id)).toEqual(['mcq', 'spot', 'qa']);
  });
  it('tolerates undefined input', () => {
    expect(states(undefined)).toEqual(['next', 'locked', 'locked']);
  });
});

describe('phasesComplete', () => {
  it('false when any phase is missing', () => {
    expect(phasesComplete({ mcq: true, spot: true })).toBe(false);
    expect(phasesComplete({})).toBe(false);
  });
  it('true only when all three are done', () => {
    expect(phasesComplete({ mcq: true, spot: true, qa: true })).toBe(true);
  });
});

describe('nextPhase', () => {
  it('walks the sequence', () => {
    expect(nextPhase({})).toBe('mcq');
    expect(nextPhase({ mcq: true })).toBe('spot');
    expect(nextPhase({ mcq: true, spot: true })).toBe('qa');
  });
  it('null when complete', () => {
    expect(nextPhase({ mcq: true, spot: true, qa: true })).toBe(null);
  });
});

describe('completedCount', () => {
  it('counts done phases', () => {
    expect(completedCount({})).toBe(0);
    expect(completedCount({ mcq: true, qa: true })).toBe(2);
    expect(completedCount({ mcq: true, spot: true, qa: true })).toBe(3);
  });
});

describe('active QA helpers', () => {
  it('does not count archived QA interviews as active', () => {
    expect(isActiveQaInterview({
      department: 'pediatrics',
      assessmentType: 'call-qa',
      qa: { score: 92, pass: true },
      qaArchived: true,
    }, 'pediatrics')).toBe(false);
  });

  it('latestQaForDept ignores archived attempts', () => {
    const interviews = [
      {
        department: 'pediatrics',
        assessmentType: 'call-qa',
        qa: { score: 95, pass: true },
        qaArchived: true,
        endedAt: { seconds: 200 },
      },
      {
        department: 'pediatrics',
        assessmentType: 'call-qa',
        qa: { score: 82, pass: true },
        endedAt: { seconds: 100 },
      },
    ];

    expect(latestQaForDept(interviews, 'pediatrics')?.qa?.score).toBe(82);
  });

  it('does not let an arbitrary practice qa payload complete Phase 3', () => {
    expect(isActiveQaInterview({
      department: 'pediatrics',
      assessmentType: 'practice',
      qa: { score: 100, pass: true },
    }, 'pediatrics')).toBe(false);
  });
});
