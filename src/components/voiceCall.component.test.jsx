// @vitest-environment jsdom
// Component tests for VoiceCall test-mode (server-authoritative Call QA) — the
// End Call handshake and the capture-finalize vs grade-retry distinctions.
// Browser APIs (WebSocket / AudioContext / getUserMedia) are faked so the flow
// can be driven deterministically in jsdom.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';

const dbMocks = vi.hoisted(() => ({ saveInterview: vi.fn(), updateInterviewGrade: vi.fn() }));
vi.mock('../lib/db.js', () => dbMocks);

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/apiFetch.js', () => ({ apiFetch: (...a) => apiFetchMock(...a) }));

vi.mock('../lib/firebase.js', () => ({
  isFirebaseConfigured: true,
  getFirebaseIdToken: vi.fn().mockResolvedValue('token-123'),
}));

const { default: VoiceCall } = await import('./VoiceCall.jsx');

// ── Fake browser APIs ────────────────────────────────────────────────────────
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 1; this.sent = []; FakeWS.instances.push(this); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; this.onclose?.(); }
  parsed(type) { return this.sent.find((m) => m.type === type); }
}
FakeWS.instances = [];

class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.sampleRate = 48000; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createMediaStreamSource() { return { connect() {} }; }
  createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
  createGain() { return { gain: { value: 0 }, connect() {} }; }
  createBuffer() { return { copyToChannel() {}, duration: 0 }; }
  createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {}, onended: null }; }
}

const QA = {
  score: 90, pass: true, passThreshold: 85,
  categories: [], criteria: [], autoFails: [], repairs: [],
  review: { recommendation: 'pass', reviewFlags: [], confidence: 'high', safetyRisk: 'low' },
};
const GRADE = { score: 90, summary: 'Solid.', strengths: [], improvements: [] };

async function startAndActivate(readyExtra = {}) {
  fireEvent.click(screen.getByRole('button', { name: /start the test call/i }));
  await waitFor(() => expect(FakeWS.instances.length).toBe(1));
  const ws = FakeWS.instances[0];
  await act(async () => { ws.onopen?.(); });
  await act(async () => {
    ws.onmessage?.({ data: JSON.stringify({
      type: 'ready', attemptId: 'att-1',
      scenario: { prompt: 'A server-selected scenario.', callerName: 'Sam', department: 'pediatrics', primaryDomainId: 'routing' },
      ...readyExtra,
    }) });
  });
  return ws;
}

beforeEach(() => {
  FakeWS.instances = [];
  apiFetchMock.mockReset();
  dbMocks.saveInterview.mockReset();
  dbMocks.updateInterviewGrade.mockReset();
  global.WebSocket = FakeWS;
  global.AudioContext = FakeAudioContext;
  Object.defineProperty(window, 'location', { value: { protocol: 'http:', host: 'localhost' }, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop() {} }] }) },
    configurable: true,
  });
});
afterEach(() => cleanup());

describe('VoiceCall test mode — server-authoritative handshake', () => {
  it('start payload contains only identity, mode, and department — no scenario selector or answer material', async () => {
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="pediatrics" mode="test" onQaResult={vi.fn()} />);
    const ws = await startAndActivate();
    const start = ws.parsed('start');
    expect(start.mode).toBe('test');
    expect(start.department).toBe('pediatrics');
    expect(start.idToken).toBe('token-123');
    expect(start).not.toHaveProperty('qaScenarioId');
    expect(start).not.toHaveProperty('priorQaAttempts');
    expect(start).not.toHaveProperty('scenario');
    expect(start).not.toHaveProperty('transcript');
    expect(start).not.toHaveProperty('callerName');
    expect(start).not.toHaveProperty('navigatorId');
    expect(screen.getByText('A server-selected scenario.')).toBeTruthy();
  });

  it('End Call sends { type:"end" } and waits for the captured ack; then grades by attemptId and NEVER writes via db', async () => {
    apiFetchMock.mockResolvedValue({ qa: QA, grade: GRADE, attemptId: 'att-1' });
    const onQaResult = vi.fn();
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="pediatrics" mode="test" onQaResult={onQaResult} />);
    const ws = await startAndActivate();

    fireEvent.click(screen.getByRole('button', { name: /end & get graded/i }));
    expect(ws.parsed('end')).toEqual({ type: 'end' });
    // Finalizing state shown; grading has NOT begun (no api call yet).
    expect(screen.getByText(/finalizing transcript/i)).toBeTruthy();
    expect(apiFetchMock).not.toHaveBeenCalled();

    // Server acknowledges a clean capture → grade by attemptId only.
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'captured', attemptId: 'att-1', captureComplete: true }) });
    });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith('/api/grade-call-qa', { attemptId: 'att-1' }, expect.any(Number));
    // The browser is NOT authoritative: it never writes the interview or grade.
    expect(dbMocks.saveInterview).not.toHaveBeenCalled();
    expect(dbMocks.updateInterviewGrade).not.toHaveBeenCalled();
    await waitFor(() => expect(onQaResult).toHaveBeenCalled());
  });

  it('a capture-finalize error during the drain shows RETAKE (no grade retry) and never grades', async () => {
    apiFetchMock.mockResolvedValue({ qa: QA, grade: GRADE });
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="pediatrics" mode="test" onQaResult={vi.fn()} />);
    const ws = await startAndActivate();

    fireEvent.click(screen.getByRole('button', { name: /end & get graded/i }));
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'error', code: 'capture-finalize-failed', message: 'We could not save your call recording. Please retake the test.' }) });
    });

    await waitFor(() => expect(screen.getByText(/recording not finalized/i)).toBeTruthy());
    // Retake is offered; grading retry is NOT.
    expect(screen.getByRole('button', { name: /take the test again/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /grading/i })).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('a socket close before a captured ack routes to RETAKE (no grade retry)', async () => {
    apiFetchMock.mockResolvedValue({ qa: QA, grade: GRADE });
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="pediatrics" mode="test" onQaResult={vi.fn()} />);
    const ws = await startAndActivate();

    fireEvent.click(screen.getByRole('button', { name: /end & get graded/i }));
    await act(async () => { ws.onclose?.(); });

    await waitFor(() => expect(screen.getByText(/recording not finalized/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /take the test again/i })).toBeTruthy();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('an incomplete-but-acknowledged capture still proceeds to grading', async () => {
    apiFetchMock.mockResolvedValue({ qa: { ...QA, review: { ...QA.review, recommendation: 'needs_review' } }, grade: GRADE });
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="pediatrics" mode="test" onQaResult={vi.fn()} />);
    const ws = await startAndActivate();

    fireEvent.click(screen.getByRole('button', { name: /end & get graded/i }));
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'captured', attemptId: 'att-1', captureComplete: false, warning: 'partial' }) });
    });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/grade-call-qa', { attemptId: 'att-1' }, expect.any(Number)));
  });

  // ── Finalization guard timing (Fix 3) ──────────────────────────────────────
  it('sizes the finalize guard from the SERVER-provided clientGuardMs (not a hardcoded 15s)', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="pediatrics" mode="test" onQaResult={vi.fn()} />);
    const ws = await startAndActivate({ finalization: { drainTimeoutMs: 30000, settleTimeoutMs: 10000, clientGuardMs: 47000 } });
    setTimeoutSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /end & get graded/i }));
    // The finalize guard uses the server value, and NEVER the old 15s.
    const delays = setTimeoutSpy.mock.calls.map((c) => c[1]);
    expect(delays).toContain(47000);
    expect(delays).not.toContain(15000);
    // A captured ack that arrives "late" (after 15s would have elapsed) is accepted.
    apiFetchMock.mockResolvedValue({ qa: QA, grade: GRADE });
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'captured', attemptId: 'att-1', captureComplete: true }) });
    });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/grade-call-qa', { attemptId: 'att-1' }, expect.any(Number)));
    setTimeoutSpy.mockRestore();
  });

  it('falls back to a guard >= the server maximum when finalization metadata is missing', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="pediatrics" mode="test" onQaResult={vi.fn()} />);
    await startAndActivate(); // ready without finalization
    setTimeoutSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /end & get graded/i }));
    const delays = setTimeoutSpy.mock.calls.map((c) => c[1]);
    // Fallback must exceed the server max drain(30s)+settle(10s)+margin(20s) = 60s.
    expect(delays.some((d) => d >= 60000)).toBe(true);
    setTimeoutSpy.mockRestore();
  });
});
