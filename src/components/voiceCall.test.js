// Unit tests for VoiceCall's pure Call QA grading helpers. We mock the Firestore
// and fetch layers so importing the component module never boots Firebase or the
// browser audio stack — only the exported pure helpers are exercised.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/db.js', () => ({
  saveInterview: vi.fn(),
  updateInterviewGrade: vi.fn(),
}));
vi.mock('../lib/apiFetch.js', () => ({ apiFetch: vi.fn() }));

const {
  callQaScenarioMetadata,
  gradeSavedAttempt,
} = await import('./VoiceCall.jsx');

const curated = {
  id: 'peds-refill-1',
  title: 'Albuterol refill, out of medication',
  workflowType: 'prescription_refill',
  difficulty: 'medium',
  version: 'call-qa-scenarios-v1',
  domainIds: ['routing'],
  competencyIds: ['sopKnowledge'],
  expectedActions: ['Confirm medication name and preferred pharmacy', 'Mark HIGH PRIORITY (out of med)'],
  criticalMisses: ['Promised the refill would be sent today'],
  scoringNotes: ['Do not require PE-status verification unless the caller makes that the governing issue.'],
};

describe('callQaScenarioMetadata', () => {
  it('keeps compact curated metadata for the saved supervisor record', () => {
    expect(callQaScenarioMetadata(curated)).toMatchObject({
      qaScenarioId: curated.id,
      workflowType: 'prescription_refill',
      expectedActions: curated.expectedActions,
      criticalMisses: curated.criticalMisses,
    });
  });

  it('retains scenario provenance (scenarioVersion) on the saved attempt', () => {
    expect(callQaScenarioMetadata(curated).scenarioVersion).toBe('call-qa-scenarios-v1');
  });
});

describe('gradeSavedAttempt sends only the trusted scenario id as grading authority', () => {
  it('does not embed browser metadata into the grader scenario', async () => {
    const gradeQaFn = vi.fn().mockResolvedValue({ grade: { score: 90 }, qa: { pass: true } });
    const saveGradeFn = vi.fn().mockResolvedValue();
    const metadata = callQaScenarioMetadata(curated);

    await gradeSavedAttempt(
      { docId: 'doc1', scenario: 'base scenario', transcript: [{ role: 'navigator', text: 'hi' }], department: 'pediatrics', metadata },
      { gradeQaFn, saveGradeFn },
    );

    expect(gradeQaFn).toHaveBeenCalledTimes(1);
    expect(gradeQaFn).toHaveBeenCalledWith(expect.objectContaining({
      scenario: 'base scenario',
      qaScenarioId: curated.id,
    }));
    expect(gradeQaFn.mock.calls[0][0]).not.toHaveProperty('metadata');
  });
});
