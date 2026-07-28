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

const {
  default: VoiceCall,
  QA_GRADE_PENDING_MESSAGE,
  QA_GRADE_WAIT_EXCEEDED_MESSAGE,
  MIC_CHECK_PEAK_THRESHOLD,
} = await import('./VoiceCall.jsx');

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

function enableMicCheck(peak) {
  FakeAudioContext.prototype.createAnalyser = () => ({ fftSize: 256, disconnect: vi.fn(), getFloatTimeDomainData: (data) => data.fill(peak) });
  global.requestAnimationFrame = vi.fn(() => 1);
  global.cancelAnimationFrame = vi.fn();
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
afterEach(() => {
  delete FakeAudioContext.prototype.createAnalyser;
  delete global.requestAnimationFrame;
  delete global.cancelAnimationFrame;
  vi.useRealTimers();
  cleanup();
});

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

  it('renders the Simulated ECW chart from the ready projection, with no correct-answer/action text', async () => {
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="obgyn" mode="test" onQaResult={vi.fn()} />);
    await startAndActivate({
      scenario: {
        prompt: 'A pregnant caller wants a growth ultrasound.', callerName: 'Maria',
        department: 'obgyn', primaryDomainId: 'classification',
        navigatorChartState: {
          summary: 'Established OB patient — routine prenatal care.',
          planRto: 'RTO 4 weeks (routine prenatal follow-up).',
          activeOrders: [], openEncounters: [], futureAppointments: [],
          otherFacts: ['No sonography or ultrasound order on file.'],
        },
      },
    });
    // The panel and its visible chart facts render, including a NEGATIVE fact.
    expect(screen.getByText(/Simulated ECW chart/i)).toBeTruthy();
    expect(screen.getByText(/RTO 4 weeks/)).toBeTruthy();
    expect(screen.getByText(/No sonography or ultrasound order on file\./)).toBeTruthy();
    expect(screen.getAllByText(/None on file/i).length).toBeGreaterThan(0);
    // No correct answer / next-action text is shown to the navigator.
    expect(screen.queryByText(/route|clarif|expected|correct|should/i)).toBeNull();
    // Captions/end-call flow remain intact.
    expect(screen.getByRole('button', { name: /end & get graded/i })).toBeTruthy();
  });

  // A section the server never supplied must NOT be rendered as "None on file" —
  // that would put a chart fact on the navigator's screen the scenario never
  // asserted. Only an EXPLICITLY empty section is a visible negative.
  it('renders "None on file" only for explicitly empty sections, never for missing ones', async () => {
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="obgyn" mode="test" onQaResult={vi.fn()} />);
    await startAndActivate({
      scenario: {
        prompt: 'A pregnant caller wants a growth ultrasound.', callerName: 'Maria',
        department: 'obgyn', primaryDomainId: 'classification',
        // activeOrders is EXPLICITLY empty; openEncounters/futureAppointments are
        // simply not part of this scenario and must stay off screen.
        navigatorChartState: { planRto: 'RTO 4 weeks', activeOrders: [] },
      },
    });
    expect(screen.getByText(/Simulated ECW chart/i)).toBeTruthy();
    expect(screen.getByText(/RTO 4 weeks/)).toBeTruthy();
    // The explicit negative is shown, exactly once.
    expect(screen.getByText(/^Active orders$/i)).toBeTruthy();
    expect(screen.getAllByText(/None on file/i).length).toBe(1);
    // The unsupplied sections are absent entirely — not shown as "None on file".
    expect(screen.queryByText(/Open Telephone Encounters/i)).toBeNull();
    expect(screen.queryByText(/Future appointments/i)).toBeNull();
  });

  it('does not render the chart panel at all when the server supplied no chart', async () => {
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="obgyn" mode="test" onQaResult={vi.fn()} />);
    await startAndActivate({
      scenario: {
        prompt: 'A routine scheduling call.', callerName: 'Maria',
        department: 'obgyn', primaryDomainId: 'scheduling', navigatorChartState: null,
      },
    });
    expect(screen.queryByText(/Simulated ECW chart/i)).toBeNull();
    expect(screen.queryByText(/None on file/i)).toBeNull();
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

  it('shows the saved-grading state for a temporary 409, retries the same attempt, and renders the durable grade', async () => {
    const temporary = Object.assign(new Error('still grading'), { status: 409 });
    apiFetchMock
      .mockRejectedValueOnce(temporary)
      .mockResolvedValueOnce({ qa: QA, grade: GRADE, attemptId: 'att-1' });
    const onQaResult = vi.fn();
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="pediatrics" mode="test" onQaResult={onQaResult} />);
    const ws = await startAndActivate();
    fireEvent.click(screen.getByRole('button', { name: /end & get graded/i }));

    vi.useFakeTimers();
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'captured', attemptId: 'att-1', captureComplete: true }) });
      await Promise.resolve();
    });
    expect(screen.getByText(QA_GRADE_PENDING_MESSAGE)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
    });
    expect(screen.getByText(/AI recommendation pending supervisor review/i)).toBeTruthy();
    expect(onQaResult).toHaveBeenCalledWith(QA);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    for (const [endpoint, body] of apiFetchMock.mock.calls) {
      expect(endpoint).toBe('/api/grade-call-qa');
      expect(body).toEqual({ attemptId: 'att-1' });
    }
    expect(apiFetchMock.mock.calls[0][2]).toBe(100_000);
    expect(FakeWS.instances).toHaveLength(1);
    expect(dbMocks.saveInterview).not.toHaveBeenCalled();
    expect(dbMocks.updateInterviewGrade).not.toHaveBeenCalled();
  });

  it('stops temporary grading retries at 150000 ms and keeps manual retry without offering a retake', async () => {
    apiFetchMock.mockRejectedValue(Object.assign(new Error('busy'), { status: 503 }));
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="pediatrics" mode="test" onQaResult={vi.fn()} />);
    const ws = await startAndActivate();
    fireEvent.click(screen.getByRole('button', { name: /end & get graded/i }));

    vi.useFakeTimers();
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'captured', attemptId: 'att-1', captureComplete: true }) });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(150_000);
      await Promise.resolve();
    });

    expect(screen.getByText(QA_GRADE_WAIT_EXCEEDED_MESSAGE)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry grading the saved server transcript/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /take the test again/i })).toBeNull();
    expect(dbMocks.saveInterview).not.toHaveBeenCalled();
    expect(dbMocks.updateInterviewGrade).not.toHaveBeenCalled();
  });

  it('keeps HTTP 422 on the capture-error path', async () => {
    apiFetchMock.mockRejectedValue(Object.assign(new Error('empty transcript'), { status: 422 }));
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="pediatrics" mode="test" onQaResult={vi.fn()} />);
    const ws = await startAndActivate();
    fireEvent.click(screen.getByRole('button', { name: /end & get graded/i }));
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'captured', attemptId: 'att-1', captureComplete: true }) });
    });
    await waitFor(() => expect(screen.getByText(/did not capture any of your speech/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /take the test again/i })).toBeTruthy();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps permanent grading errors on the manual saved-attempt retry path', async () => {
    apiFetchMock.mockRejectedValue(Object.assign(new Error('server configuration'), { status: 500 }));
    render(<VoiceCall navigatorId="nav-a" name="Ada" department="pediatrics" mode="test" onQaResult={vi.fn()} />);
    const ws = await startAndActivate();
    fireEvent.click(screen.getByRole('button', { name: /end & get graded/i }));
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'captured', attemptId: 'att-1', captureComplete: true }) });
    });
    await waitFor(() => expect(screen.getByText(/retry grading this saved attempt/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /retry grading the saved server transcript/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /take the test again/i })).toBeNull();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
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

describe('P0-5B microphone verification', () => {
  it('keeps a silent microphone out of the relay and returns to setup', async () => {
    vi.useFakeTimers();
    enableMicCheck(0);
    render(<VoiceCall navigatorId="nav-a" name="Ada" mode="test" />);
    fireEvent.click(screen.getByRole('button', { name: /start the test call/i }));
    await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(3_000); });
    expect(FakeWS.instances).toHaveLength(0);
    expect(screen.getByText(/couldn't hear your microphone/i)).toBeTruthy();
  });

  it('opens exactly one relay socket after a live microphone peak', async () => {
    enableMicCheck(MIC_CHECK_PEAK_THRESHOLD + 0.01);
    render(<VoiceCall navigatorId="nav-a" name="Ada" mode="test" />);
    fireEvent.click(screen.getByRole('button', { name: /start the test call/i }));
    await waitFor(() => expect(FakeWS.instances).toHaveLength(1));
  });

  it('allows an explicit mic-check skip without exposing sensitive data', async () => {
    enableMicCheck(0);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<VoiceCall navigatorId="nav-a" name="Ada" mode="test" />);
    fireEvent.click(screen.getByRole('button', { name: /start the test call/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /skip check/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /skip check/i }));
    await waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    expect(warn).toHaveBeenCalledWith('[voice-call] microphone check skipped');
    warn.mockRestore();
  });
});
