// Dependency-injected tests for the server-authoritative Call QA capture relay.
// No real WebSocket, clock, Gemini, or Firestore — every collaborator is a fake,
// so we can drive the exact capture + two-stage End Call drain state machine.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleConnection, CALL_QA_DRAIN_TIMEOUT_MS, CALL_QA_TRANSCRIPT_SETTLE_MS } from './live-relay.js';
import { createFakeFirestore } from './fixtures/fakeFirestore.js';
import { getCallQaScenarioById } from '../src/data/callQaScenarios.js';
import { CAPTURE_STATUS } from './_call-qa-attempts.js';

const SCENARIO = getCallQaScenarioById('qa-peds-refill-001');
const flush = () => new Promise((r) => setTimeout(r, 0));
// Unique IP per harness — the relay's per-IP concurrency cap is module-level
// state that would otherwise leak across tests.
let ipCounter = 0;

// ── Fakes ────────────────────────────────────────────────────────────────────
function fakeClient() {
  const handlers = {};
  const sent = [];
  return {
    readyState: 1,
    sent,
    on(event, fn) { handlers[event] = fn; },
    async emit(event, arg) { return handlers[event]?.(arg); },
    send(str) { sent.push(JSON.parse(str)); },
    close() { this.readyState = 3; },
    lastByType(type) { return [...sent].reverse().find((m) => m.type === type); },
  };
}

function harness(overrides = {}) {
  const db = createFakeFirestore();
  const timers = [];
  let tid = 0;
  const upstreamRef = {};
  const deps = {
    verifyToken: vi.fn(async () => ({ role: 'navigator', navigatorId: 'nav-a' })),
    getApiKeys: () => ['k1'],
    buildSystemInstruction: () => 'persona',
    resolveScenario: (id) => getCallQaScenarioById(id),
    loadRosterMember: vi.fn(async () => ({ id: 'nav-a', name: 'Ada', status: 'active' })),
    db: () => db,
    now: (() => { let t = 1000; return () => (t += 1000); })(),
    setTimer: (fn, ms) => { const id = ++tid; const rec = { id, fn, ms }; timers.push(rec); return { id, unref() {} }; },
    clearTimer: (t) => { if (t) { const i = timers.findIndex((r) => r.id === t.id); if (i >= 0) timers.splice(i, 1); } },
    clientIp: () => `ip-${++ipCounter}`,
    liveModel: 'live-m',
    createUpstream: (key, h) => {
      upstreamRef.sent = [];
      upstreamRef.handlers = h;
      const up = { send: (obj) => upstreamRef.sent.push(obj), close: vi.fn() };
      upstreamRef.up = up;
      return up;
    },
    ...overrides,
  };
  const client = fakeClient();
  const fireByMs = (ms) => {
    const t = timers.find((r) => r.ms === ms);
    if (t) { deps.clearTimer({ id: t.id }); t.fn(); }
  };
  return {
    db, deps, client, timers, upstreamRef,
    fireDrainTimer: () => fireByMs(CALL_QA_DRAIN_TIMEOUT_MS),
    fireSettleTimer: () => fireByMs(CALL_QA_TRANSCRIPT_SETTLE_MS),
    settleTimer: () => timers.find((r) => r.ms === CALL_QA_TRANSCRIPT_SETTLE_MS),
  };
}

async function startTest(h, startMsg = {}) {
  handleConnection(h.client, {}, h.deps);
  await h.client.emit('message', JSON.stringify({
    type: 'start', idToken: 't', mode: 'test', department: 'pediatrics', qaScenarioId: SCENARIO.id, ...startMsg,
  }));
  await flush();
  // Drive the upstream setup handshake.
  h.upstreamRef.handlers.onOpen();
  h.upstreamRef.handlers.onMessage({ setupComplete: true });
  await flush();
}

function upstreamNav(h, text) { h.upstreamRef.handlers.onMessage({ serverContent: { inputTranscription: { text } } }); }
function upstreamCaller(h, text) { h.upstreamRef.handlers.onMessage({ serverContent: { outputTranscription: { text } } }); }
function upstreamTurnComplete(h) { h.upstreamRef.handlers.onMessage({ serverContent: { turnComplete: true } }); }

function storedAttempt(h) {
  const key = [...h.db._store.keys()].find((k) => k.startsWith('interviews/'));
  return key ? h.db._store.get(key) : null;
}

beforeEach(() => vi.clearAllMocks());

describe('server-authoritative start contract', () => {
  it('derives navigatorId from the token and loads the scenario server-side (ignoring client scenario text)', async () => {
    const h = harness();
    handleConnection(h.client, {}, h.deps);
    await h.client.emit('message', JSON.stringify({
      type: 'start', idToken: 't', mode: 'test', department: 'pediatrics', qaScenarioId: SCENARIO.id,
      navigatorId: 'nav-evil', scenario: 'FORGED', callerName: 'Forged', qaScenarioTitle: 'x',
    }));
    await flush();
    const attempt = storedAttempt(h);
    expect(attempt.navigatorId).toBe('nav-a');
    expect(attempt.scenario).toBe(SCENARIO.scenario);
    expect(attempt.captureAuthority).toBe('server');
  });

  it('creates the attempt BEFORE sending ready and returns the attempt id + trusted scenario', async () => {
    const h = harness();
    await startTest(h);
    const ready = h.client.lastByType('ready');
    expect(ready).toBeTruthy();
    expect(ready.attemptId).toBeTruthy();
    expect(ready.scenario).toMatchObject({ id: SCENARIO.id, department: 'pediatrics', callerName: SCENARIO.callerName });
    expect(storedAttempt(h)).toBeTruthy();
  });

  it('rejects a non-navigator identity for a scored test', async () => {
    const h = harness({ verifyToken: vi.fn(async () => ({ role: 'supervisor' })) });
    handleConnection(h.client, {}, h.deps);
    await h.client.emit('message', JSON.stringify({ type: 'start', idToken: 't', mode: 'test', department: 'pediatrics', qaScenarioId: SCENARIO.id }));
    await flush();
    expect(h.client.lastByType('error')).toBeTruthy();
    expect(storedAttempt(h)).toBeNull();
  });

  it('rejects an unknown scenario / wrong department', async () => {
    const h = harness();
    handleConnection(h.client, {}, h.deps);
    await h.client.emit('message', JSON.stringify({ type: 'start', idToken: 't', mode: 'test', department: 'obgyn', qaScenarioId: SCENARIO.id }));
    await flush();
    expect(h.client.lastByType('error')).toBeTruthy();
    expect(storedAttempt(h)).toBeNull();
  });
});

describe('roster-member validation (item 6)', () => {
  it('an active member succeeds (attempt created)', async () => {
    const h = harness();
    await startTest(h);
    expect(storedAttempt(h)).toBeTruthy();
    expect(h.client.lastByType('ready')).toBeTruthy();
  });

  it('an inactive member is rejected and NO attempt is created', async () => {
    const h = harness({ loadRosterMember: vi.fn(async () => ({ id: 'nav-a', name: 'Ada', status: 'inactive' })) });
    handleConnection(h.client, {}, h.deps);
    await h.client.emit('message', JSON.stringify({ type: 'start', idToken: 't', mode: 'test', department: 'pediatrics', qaScenarioId: SCENARIO.id }));
    await flush();
    expect(h.client.lastByType('error')).toBeTruthy();
    expect(storedAttempt(h)).toBeNull();
  });

  it('a missing roster member is rejected and NO attempt is created', async () => {
    const h = harness({ loadRosterMember: vi.fn(async () => null) });
    handleConnection(h.client, {}, h.deps);
    await h.client.emit('message', JSON.stringify({ type: 'start', idToken: 't', mode: 'test', department: 'pediatrics', qaScenarioId: SCENARIO.id }));
    await flush();
    expect(h.client.lastByType('error')).toBeTruthy();
    expect(storedAttempt(h)).toBeNull();
  });
});

describe('transcript capture + turn-scoped ordering', () => {
  it('coalesces same-role fragments and keeps roles distinct', async () => {
    const h = harness();
    await startTest(h);
    upstreamNav(h, 'Good morning,');
    upstreamNav(h, 'this is Ada.');
    upstreamCaller(h, 'Hi there.');
    upstreamTurnComplete(h);
    await flush();
    const attempt = storedAttempt(h);
    expect(attempt.transcript).toEqual([
      { role: 'navigator', text: 'Good morning, this is Ada.' },
      { role: 'patient', text: 'Hi there.' },
    ]);
  });

  it('stores the navigator input BEFORE the caller output even when output arrives first', async () => {
    const h = harness();
    await startTest(h);
    // Output (caller) arrives BEFORE the corresponding input (navigator).
    upstreamCaller(h, 'Caller speaks first on the wire.');
    upstreamNav(h, 'But navigator spoke first in the exchange.');
    upstreamTurnComplete(h);
    await flush();
    const roles = storedAttempt(h).transcript.map((t) => t.role);
    expect(roles).toEqual(['navigator', 'patient']);
  });

  it('IGNORES a browser-sent transcript message', async () => {
    const h = harness();
    await startTest(h);
    upstreamNav(h, 'Real navigator line.');
    await h.client.emit('message', JSON.stringify({ type: 'transcript', role: 'navigator', text: 'INJECTED FAKE' }));
    upstreamTurnComplete(h);
    await flush();
    const text = storedAttempt(h).transcript.map((t) => t.text).join(' ');
    expect(text).toContain('Real navigator line.');
    expect(text).not.toContain('INJECTED FAKE');
  });

  it('checkpoints at a turn boundary without advancing capture state', async () => {
    const h = harness();
    await startTest(h);
    upstreamNav(h, 'A checkpointed line.');
    upstreamTurnComplete(h);
    await flush();
    expect(storedAttempt(h).transcript.length).toBe(1);
    expect(storedAttempt(h).captureStatus).toBe(CAPTURE_STATUS.ACTIVE);
  });
});

describe('two-stage End Call drain', () => {
  it('does NOT finalize on the post-End turnComplete alone — it waits for the settle window', async () => {
    const h = harness();
    await startTest(h);
    upstreamNav(h, 'First.');
    upstreamTurnComplete(h);
    await flush();
    await h.client.emit('message', JSON.stringify({ type: 'end' }));
    await flush();
    expect(h.upstreamRef.sent.some((m) => m.realtimeInput?.audioStreamEnd === true)).toBe(true);
    // Post-End boundary observed — but the capture must NOT be finalized yet.
    upstreamTurnComplete(h);
    await flush();
    expect(h.client.lastByType('captured')).toBeUndefined();
    expect(storedAttempt(h).captureStatus).not.toBe(CAPTURE_STATUS.CAPTURED);
    // Only after the settle window elapses quietly is it captured cleanly.
    h.fireSettleTimer();
    await flush();
    expect(storedAttempt(h).captureStatus).toBe(CAPTURE_STATUS.CAPTURED);
    expect(h.client.lastByType('captured')).toMatchObject({ captureComplete: true });
  });

  it('a navigator utterance that arrives AFTER the post-End turnComplete is still captured before the clean ack', async () => {
    const h = harness();
    await startTest(h);
    await h.client.emit('message', JSON.stringify({ type: 'end' }));
    await flush();
    upstreamTurnComplete(h); // post-End boundary, starts the settle timer
    await flush();
    // Late navigator transcription arrives AFTER the boundary.
    upstreamNav(h, 'One more thing before I go.');
    await flush();
    h.fireSettleTimer();
    await flush();
    const attempt = storedAttempt(h);
    expect(attempt.captureStatus).toBe(CAPTURE_STATUS.CAPTURED);
    expect(attempt.transcript.map((t) => t.text).join(' ')).toContain('One more thing before I go.');
    expect(h.client.lastByType('captured')).toMatchObject({ captureComplete: true });
  });

  it('a transcription during the settle window RESETS the settle timer', async () => {
    const h = harness();
    await startTest(h);
    await h.client.emit('message', JSON.stringify({ type: 'end' }));
    await flush();
    upstreamTurnComplete(h);
    await flush();
    const settleBefore = h.settleTimer().id;
    upstreamNav(h, 'Still talking…');
    await flush();
    // The prior settle timer was cleared and a new one created.
    expect(h.timers.find((t) => t.id === settleBefore)).toBeUndefined();
    expect(h.settleTimer()).toBeTruthy();
    expect(h.settleTimer().id).not.toBe(settleBefore);
  });

  it('the overall drain deadline finalizes as capture_incomplete with explicit metadata', async () => {
    const h = harness();
    await startTest(h);
    upstreamNav(h, 'Something.');
    upstreamTurnComplete(h);
    await flush();
    await h.client.emit('message', JSON.stringify({ type: 'end' }));
    await flush();
    h.fireDrainTimer();
    await flush();
    const attempt = storedAttempt(h);
    expect(attempt.captureStatus).toBe(CAPTURE_STATUS.INCOMPLETE);
    expect(attempt.captureMetadata.captureComplete).toBe(false);
    expect(attempt.captureMetadata.drainReason).toBe('drain-timeout');
    expect(attempt.captureMetadata.endedBy).toBe('navigator');
    const captured = h.client.lastByType('captured');
    expect(captured.captureComplete).toBe(false);
    expect(captured.warning).toBeTruthy();
  });
});

describe('never acknowledge before the terminal write succeeds (item 2)', () => {
  it('a finalizeCapture failure sends NO captured ack, an explicit error, and does not mark finalized', async () => {
    const h = harness();
    await startTest(h);
    upstreamNav(h, 'A line.');
    upstreamTurnComplete(h);
    await flush();
    await h.client.emit('message', JSON.stringify({ type: 'end' }));
    await flush();
    upstreamTurnComplete(h); // boundary
    await flush();
    // The terminal Firestore write will now reject.
    h.db._control.failUpdates = true;
    h.fireSettleTimer();
    await flush();
    // No captured ack; an explicit capture-finalize error instead.
    expect(h.client.lastByType('captured')).toBeUndefined();
    const err = h.client.lastByType('error');
    expect(err).toBeTruthy();
    expect(err.code).toBe('capture-finalize-failed');
    // The attempt is preserved server-side and NOT marked captured.
    expect(storedAttempt(h).captureStatus).not.toBe(CAPTURE_STATUS.CAPTURED);
  });
});

describe('unexpected disconnect', () => {
  it('persists the partial transcript as abandoned and never sends captured', async () => {
    const h = harness();
    await startTest(h);
    upstreamNav(h, 'Half a call.');
    upstreamTurnComplete(h);
    await flush();
    await h.client.emit('close');
    await flush();
    const attempt = storedAttempt(h);
    expect(attempt.captureStatus).toBe(CAPTURE_STATUS.ABANDONED);
    expect(attempt.captureMetadata.endedBy).toBe('client_disconnect');
    expect(h.client.lastByType('captured')).toBeUndefined();
  });
});
