import { describe, expect, it, vi } from 'vitest';
import { loadNavigatorInterviewProjection, navigatorInterviewProjection } from './my-interviews.js';

describe('navigatorInterviewProjection', () => {
  it('allowlists server Call QA result fields and drops every grading secret', () => {
    const projected = navigatorInterviewProjection({
      id: 'qa-1',
      data: () => ({
        navigatorId: 'nav-a', department: 'obgyn', assessmentType: 'call-qa',
        captureAuthority: 'server', captureStatus: 'captured', gradingStatus: 'graded',
        endedAt: 10, grade: { score: 91 }, qa: { pass: true },
        scenarioSnapshot: { hiddenChartState: { answer: true }, expectedActions: ['secret'] },
        expectedActions: ['secret'], criticalMisses: ['secret'], scoringNotes: ['secret'],
        transcript: [{ role: 'navigator', text: 'private' }], gradingLeaseId: 'secret',
        qaScenarioId: 'descriptive-secret-id', workflowType: 'secret-workflow',
        futureSecret: 'must never leak',
      }),
    });

    expect(projected).toMatchObject({
      id: 'qa-1', navigatorId: 'nav-a', department: 'obgyn',
      captureStatus: 'captured', grade: { score: 91 }, qa: { pass: true },
    });
    for (const field of [
      'captureAuthority', 'scenarioSnapshot', 'expectedActions', 'criticalMisses',
      'scoringNotes', 'transcript', 'gradingLeaseId', 'qaScenarioId', 'workflowType',
      'futureSecret',
    ]) expect(projected).not.toHaveProperty(field);
  });

  it('preserves the navigator\'s existing practice interview shape', () => {
    const practice = { id: 'p1', navigatorId: 'nav-a', scenario: 'practice', transcript: ['ok'], futureField: true };
    expect(navigatorInterviewProjection(practice)).toEqual(practice);
  });

  it('protects legacy curated attempts and normalizes them for Phase 3 history', () => {
    const projected = navigatorInterviewProjection({
      id: 'legacy-qa',
      navigatorId: 'nav-a',
      qaScenarioId: 'retired-public-id',
      qa: { score: 88, pass: true },
      expectedActions: ['private'],
      criticalMisses: ['private'],
      hiddenChartState: { private: true },
      transcript: [{ role: 'navigator', text: 'private' }],
    });

    expect(projected).toMatchObject({
      id: 'legacy-qa',
      assessmentType: 'call-qa',
      scenarioSource: 'curated',
      qa: { score: 88, pass: true },
    });
    expect(projected).not.toHaveProperty('qaScenarioId');
    expect(projected).not.toHaveProperty('expectedActions');
    expect(projected).not.toHaveProperty('hiddenChartState');
    expect(projected).not.toHaveProperty('transcript');
  });
});

describe('loadNavigatorInterviewProjection', () => {
  it('queries only the token-derived navigator id and projects every result', async () => {
    const get = vi.fn().mockResolvedValue({ docs: [
      { id: 'p1', data: () => ({ navigatorId: 'nav-a', scenario: 'practice' }) },
      { id: 'q1', data: () => ({ navigatorId: 'nav-a', assessmentType: 'call-qa', captureAuthority: 'server', qa: { pass: true }, scenarioSnapshot: { secret: true } }) },
    ] });
    const where = vi.fn(() => ({ get }));
    const collection = vi.fn(() => ({ where }));

    const result = await loadNavigatorInterviewProjection({ collection }, 'nav-a');

    expect(collection).toHaveBeenCalledWith('interviews');
    expect(where).toHaveBeenCalledWith('navigatorId', '==', 'nav-a');
    expect(result).toHaveLength(2);
    expect(result[1]).not.toHaveProperty('scenarioSnapshot');
  });
});
