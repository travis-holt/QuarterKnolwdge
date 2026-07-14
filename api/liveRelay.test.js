// Dependency-injected tests for the server-authoritative Call QA capture relay.
// No real WebSocket, clock, Gemini, or Firestore — every collaborator is a fake,
// so we can drive the exact capture + End Call drain state machine.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleConnection, CALL_QA_DRAIN_TIMEOUT_MS } from './live-relay.js';
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
    loadRosterName: vi.fn(async () => 'Ada'),
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
  return { db, deps, client, timers, upstreamRef, fireDrainTimer() {
    const t = timers.find((r) => r.ms === CALL_QA_DRAIN_TIMEOUT_MS);
    if (t) { deps.clearTimer({ id: t.id }); t.fn(); }
  } };
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
      // Hostile client fields that MUST be ignored:
      navigatorId: 'nav-evil', scenario: 'FORGED', callerName: 'Forged', qaScenarioTitle: 'x',
    }));
    await flush();
    const attempt = storedAttempt(h);
    expect(attempt.navigatorId).toBe('nav-a');          // from the token, not the body
    expect(attempt.scenario).toBe(SCENARIO.scenario);   // trusted, not 'FORGED'
    expect(attempt.captureAuthority).toBe('server');
  });

  it('creates the attempt BEFORE sending ready and returns the attempt id + trusted scenario', async () => {
    const h = harness();
    await startTest(h);
    const ready = h.client.lastByType('ready');
    expect(ready).toBeTruthy();
    expect(ready.attemptId).toBeTruthy();
    expect(ready.scenario).toMatchObject({ id: SCENARIO.id, department: 'pediatrics', callerName: SCENARIO.callerName });
    // The attempt already exists in Firestore at ready time.
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

describe('transcript capture', () => {
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

  it('IGNORES a browser-sent transcript message', async () => {
    const h = harness();
    await startTest(h);
    upstreamNav(h, 'Real navigator line.');
    await h.client.emit('message', JSON.stringify({ type: 'transcript', role: 'navigator', text: 'INJECTED FAKE' }));
    upstreamTurnComplete(h);
    await flush();
    const attempt = storedAttempt(h);
    const text = attempt.transcript.map((t) => t.text).join(' ');
    expect(text).toContain('Real navigator line.');
    expect(text).not.toContain('INJECTED FAKE');
  });

  it('checkpoints at a turn boundary', async () => {
    const h = harness();
    await startTest(h);
    upstreamNav(h, 'A checkpointed line.');
    upstreamTurnComplete(h);
    await flush();
    expect(storedAttempt(h).transcript.length).toBe(1);
    expect(storedAttempt(h).captureStatus).toBe(CAPTURE_STATUS.ACTIVE);
  });
});

describe('End Call drain handshake', () => {
  it('a final navigator utterance received AFTER end appears in the persisted transcript', async () => {
    const h = harness();
    await startTest(h);
    upstreamNav(h, 'First line.');
    upstreamTurnComplete(h);
    await flush();
    // Navigator clicks End.
    await h.client.emit('message', JSON.stringify({ type: 'end' }));
    await flush();
    // Relay signalled end-of-audio upstream.
    expect(h.upstreamRef.sent.some((m) => m.realtimeInput?.audioStreamEnd === true)).toBe(true);
    // A final utterance drains in after end, then a boundary.
    upstreamNav(h, 'One more thing before I go.');
    upstreamTurnComplete(h);
    await flush();
    const attempt = storedAttempt(h);
    expect(attempt.captureStatus).toBe(CAPTURE_STATUS.CAPTURED);
    expect(attempt.transcript.map((t) => t.text).join(' ')).toContain('One more thing before I go.');
    const captured = h.client.lastByType('captured');
    expect(captured).toMatchObject({ captureComplete: true });
  });

  it('a drain timeout finalizes as capture_incomplete with explicit metadata', async () => {
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
    const captured = h.client.lastByType('captured');
    expect(captured.captureComplete).toBe(false);
    expect(captured.warning).toBeTruthy();
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
    expect(attempt.captureMetadata.endedBy).toBe('disconnect');
    expect(h.client.lastByType('captured')).toBeUndefined();
  });
});
