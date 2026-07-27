import { describe, expect, it } from 'vitest';
import { buildAttemptDoc } from './_call-qa-attempts.js';

const BASE_SCENARIO = {
  id: 'qa-provider-test',
  title: 'Provider provenance fixture',
  department: 'obgyn',
  publicBriefing: 'Synthetic fixture only.',
  gradingContext: 'Synthetic fixture only.',
  callerName: 'Test Caller',
  openingLine: 'Hello.',
  expectedActions: [],
  criticalMisses: [],
  scoringNotes: [],
  domainIds: ['routing'],
  competencyIds: [],
  ruleIds: [],
};

describe('Call QA transcription provenance', () => {
  it('stores ElevenLabs provider/model server-side on the attempt without changing scenario content provenance', () => {
    const doc = buildAttemptDoc({
      navigatorId: 'nav-1',
      name: 'Navigator',
      department: 'obgyn',
      liveModel: 'gemini-live-test-model',
      now: 1,
      scenario: {
        ...BASE_SCENARIO,
        transcriptionProvider: 'elevenlabs',
        transcriptionModel: 'scribe_v2_realtime',
      },
    });

    expect(doc.transcriptionProvider).toBe('elevenlabs');
    expect(doc.transcriptionModel).toBe('scribe_v2_realtime');
    expect(doc.liveModel).toBe('gemini-live-test-model');
    expect(doc.scenarioSnapshot).not.toHaveProperty('transcriptionProvider');
    expect(doc.scenarioSnapshot).not.toHaveProperty('transcriptionModel');
  });

  it('keeps legacy/direct callers explicitly attributable to Gemini when no adapter metadata exists', () => {
    const doc = buildAttemptDoc({
      navigatorId: 'nav-1',
      name: 'Navigator',
      department: 'obgyn',
      liveModel: 'gemini-live-test-model',
      now: 1,
      scenario: BASE_SCENARIO,
    });
    expect(doc.transcriptionProvider).toBe('gemini');
    expect(doc.transcriptionModel).toBeNull();
  });
});
