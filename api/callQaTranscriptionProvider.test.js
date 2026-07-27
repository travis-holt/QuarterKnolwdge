import { describe, expect, it, vi } from 'vitest';
import {
  CALL_QA_TRANSCRIPTION_PROVIDERS,
  ELEVENLABS_SCRIBE_MODEL,
  buildScribeRealtimeUrl,
  buildTranscriptionProviderDeps,
  callQaTranscriptionProvider,
  scribeKeytermsFor,
} from './_call-qa-transcription-provider.js';

describe('Call QA transcription provider config', () => {
  it('defaults to Gemini and allows an explicit ElevenLabs switch', () => {
    expect(callQaTranscriptionProvider({})).toBe('gemini');
    expect(callQaTranscriptionProvider({ CALL_QA_TRANSCRIPTION_PROVIDER: ' GEMINI ' })).toBe('gemini');
    expect(callQaTranscriptionProvider({ CALL_QA_TRANSCRIPTION_PROVIDER: 'ElevenLabs' })).toBe('elevenlabs');
  });

  it('fails closed on an unknown provider value instead of silently changing transcript authority', () => {
    expect(() => callQaTranscriptionProvider({ CALL_QA_TRANSCRIPTION_PROVIDER: 'scribe' }))
      .toThrow(/gemini.*elevenlabs/i);
  });

  it('builds the documented Scribe v2 Realtime PCM/VAD URL with bounded keyterms', () => {
    const url = new URL(buildScribeRealtimeUrl('obgyn', {}));
    expect(url.protocol).toBe('wss:');
    expect(url.searchParams.get('model_id')).toBe(ELEVENLABS_SCRIBE_MODEL);
    expect(url.searchParams.get('audio_format')).toBe('pcm_16000');
    expect(url.searchParams.get('commit_strategy')).toBe('vad');
    expect(url.searchParams.get('no_verbatim')).toBe('false');
    const keyterms = url.searchParams.getAll('keyterms');
    expect(keyterms.length).toBeGreaterThan(0);
    expect(keyterms.length).toBeLessThanOrEqual(50);
    expect(keyterms.every((term) => term.length <= 20)).toBe(true);
    expect(keyterms).toContain('OB Portal');
    expect(keyterms).toContain('MFM');
  });

  it('keeps every generated realtime keyterm within ElevenLabs limits', () => {
    for (const department of ['obgyn', 'pediatrics']) {
      const keyterms = scribeKeytermsFor(department);
      expect(keyterms.length).toBeLessThanOrEqual(50);
      expect(new Set(keyterms).size).toBe(keyterms.length);
      expect(keyterms.every((term) => term.length > 0 && term.length <= 20)).toBe(true);
    }
  });
});

describe('ElevenLabs provider adapter', () => {
  function makeHarness() {
    let geminiCallbacks;
    let turnTimer;
    let committedHandler = () => {};
    let fatalHandler = () => {};

    const fakeGemini = { send: vi.fn(), close: vi.fn() };
    const fakeScribe = {
      sendAudio: vi.fn(() => true),
      flushFinalSilence: vi.fn(() => true),
      close: vi.fn(),
      setCommittedHandler: vi.fn((fn) => { committedHandler = fn; }),
      setFatalHandler: vi.fn((fn) => { fatalHandler = fn; }),
    };
    const baseDeps = {
      selectScenario: vi.fn(async () => ({ id: 'qa-1', department: 'obgyn' })),
      createUpstream: vi.fn((_key, callbacks) => {
        geminiCallbacks = callbacks;
        return fakeGemini;
      }),
    };
    const client = { readyState: 1, send: vi.fn(), close: vi.fn() };
    const openScribe = vi.fn(async () => fakeScribe);
    const setTimer = vi.fn((fn) => {
      turnTimer = fn;
      return { unref: vi.fn() };
    });
    const clearTimer = vi.fn();

    const deps = buildTranscriptionProviderDeps({
      client,
      baseDeps,
      env: {
        CALL_QA_TRANSCRIPTION_PROVIDER: 'elevenlabs',
        ELEVENLABS_API_KEY: 'server-secret',
        CALL_QA_ELEVENLABS_TURN_DELAY_MS: '600',
      },
      openScribe,
      setTimer,
      clearTimer,
    });

    return {
      deps, baseDeps, client, fakeGemini, fakeScribe, openScribe,
      callbacks: () => geminiCallbacks,
      committed: (text) => committedHandler(text),
      fatal: (err) => fatalHandler(err),
      fireTurnTimer: () => turnTimer?.(),
    };
  }

  it('opens Scribe only for a scored scenario and tags the effective provider/model', async () => {
    const h = makeHarness();
    const scenario = await h.deps.selectScenario({ department: 'obgyn' });
    expect(h.openScribe).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'server-secret',
      department: 'obgyn',
    }));
    expect(scenario.transcriptionProvider).toBe(CALL_QA_TRANSCRIPTION_PROVIDERS.ELEVENLABS);
    expect(scenario.transcriptionModel).toBe(ELEVENLABS_SCRIBE_MODEL);
  });

  it('does not spend ElevenLabs usage on practice calls', () => {
    const h = makeHarness();
    const callbacks = { onMessage: vi.fn(), onOpen: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    h.deps.createUpstream('gemini-key', callbacks);
    expect(h.openScribe).not.toHaveBeenCalled();
    expect(h.baseDeps.createUpstream).toHaveBeenCalledWith('gemini-key', callbacks);
  });

  it('duplicates mic audio to Scribe, suppresses Gemini navigator STT, and injects Scribe commits', async () => {
    const h = makeHarness();
    await h.deps.selectScenario({ department: 'obgyn' });
    const outer = { onMessage: vi.fn(), onOpen: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    const upstream = h.deps.createUpstream('gemini-key', outer);

    upstream.send({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: 'PCMBASE64' } } });
    expect(h.fakeScribe.sendAudio).toHaveBeenCalledWith('PCMBASE64');
    expect(h.fakeGemini.send).toHaveBeenCalled();

    h.callbacks().onMessage({ serverContent: { inputTranscription: { text: 'Gemini version' } } });
    expect(outer.onMessage).not.toHaveBeenCalled();

    h.committed('ElevenLabs version');
    expect(outer.onMessage).toHaveBeenCalledWith({
      serverContent: { inputTranscription: { text: 'ElevenLabs version' } },
    });
  });

  it('delays Gemini turnComplete so late Scribe commits stay in the same navigator-first exchange', async () => {
    const h = makeHarness();
    await h.deps.selectScenario({ department: 'obgyn' });
    const outer = { onMessage: vi.fn(), onOpen: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    h.deps.createUpstream('gemini-key', outer);

    h.callbacks().onMessage({
      serverContent: {
        outputTranscription: { text: 'Caller line' },
        turnComplete: true,
      },
    });

    expect(outer.onMessage).toHaveBeenCalledWith({
      serverContent: { outputTranscription: { text: 'Caller line' } },
    });
    expect(outer.onMessage).not.toHaveBeenCalledWith({ serverContent: { turnComplete: true } });

    h.committed('Navigator line');
    h.fireTurnTimer();
    expect(outer.onMessage).toHaveBeenLastCalledWith({ serverContent: { turnComplete: true } });
  });

  it('pushes final silence through Scribe on Gemini End-Call drain and abandons on Scribe failure', async () => {
    const h = makeHarness();
    await h.deps.selectScenario({ department: 'obgyn' });
    const outer = { onMessage: vi.fn(), onOpen: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    const upstream = h.deps.createUpstream('gemini-key', outer);

    upstream.send({ realtimeInput: { audioStreamEnd: true } });
    expect(h.fakeScribe.flushFinalSilence).toHaveBeenCalledTimes(1);

    h.fatal(new Error('rate limited'));
    expect(h.client.send).toHaveBeenCalledWith(expect.stringContaining('call-qa-transcription-unavailable'));
    expect(h.client.close).toHaveBeenCalled();
  });

  it('requires an ElevenLabs key before a scored ElevenLabs scenario can start', async () => {
    const baseDeps = {
      selectScenario: vi.fn(async () => ({ id: 'qa-1', department: 'obgyn' })),
      createUpstream: vi.fn(),
    };
    const deps = buildTranscriptionProviderDeps({
      client: { readyState: 1, send: vi.fn(), close: vi.fn() },
      baseDeps,
      env: { CALL_QA_TRANSCRIPTION_PROVIDER: 'elevenlabs' },
      openScribe: vi.fn(),
    });
    await expect(deps.selectScenario({ department: 'obgyn' })).rejects.toThrow(/ELEVENLABS_API_KEY/);
  });
});
