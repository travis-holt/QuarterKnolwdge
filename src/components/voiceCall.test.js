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
  buildCallQaGradingScenario,
  callQaScenarioMetadata,
  gradeSavedAttempt,
} = await import('./VoiceCall.jsx');

const curated = {
  id: 'peds-refill-1',
  title: 'Albuterol refill, out of medication',
  workflowType: 'prescription_refill',
  difficulty: 'medium',
  domainIds: ['routing'],
  competencyIds: ['sopKnowledge'],
  expectedActions: ['Confirm medication name and preferred pharmacy', 'Mark HIGH PRIORITY (out of med)'],
  criticalMisses: ['Promised the refill would be sent today'],
};

describe('buildCallQaGradingScenario', () => {
  it('returns the base scenario unchanged when there is no curated metadata', () => {
    expect(buildCallQaGradingScenario('plain scenario', {})).toBe('plain scenario');
  });

  it('embeds expected actions and critical misses from curated metadata', () => {
    const meta = callQaScenarioMetadata(curated);
    const out = buildCallQaGradingScenario('base scenario', meta);
    expect(out).toContain('Expected navigator behaviors:');
    expect(out).toContain('Confirm medication name and preferred pharmacy');
    expect(out).toContain('Critical misses');
    expect(out).toContain('Promised the refill would be sent today');
    expect(out).toContain('Workflow type: prescription_refill');
  });
});

describe('gradeSavedAttempt forwards curated metadata into the grading scenario', () => {
  it('passes expectedActions/criticalMisses through to the grader (the retry-path contract)', async () => {
    const gradeQaFn = vi.fn().mockResolvedValue({ grade: { score: 90 }, qa: { pass: true } });
    const saveGradeFn = vi.fn().mockResolvedValue();
    const metadata = callQaScenarioMetadata(curated);

    await gradeSavedAttempt(
      { docId: 'doc1', scenario: 'base scenario', transcript: [{ role: 'navigator', text: 'hi' }], department: 'pediatrics', metadata },
      { gradeQaFn, saveGradeFn },
    );

    expect(gradeQaFn).toHaveBeenCalledTimes(1);
    const sentScenario = gradeQaFn.mock.calls[0][0].scenario;
    expect(sentScenario).toContain('Confirm medication name and preferred pharmacy');
    expect(sentScenario).toContain('Promised the refill would be sent today');
  });
});
