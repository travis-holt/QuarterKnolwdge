import { useState, useRef, useEffect } from 'react';
import { DOMAINS } from '../data/questions.js';
import { SUPERVISOR_PASSCODE } from '../data/config.js';
import { saveInterview } from '../lib/db.js';

// ─────────────────────────────────────────────────────────────────────────────
// Interview — AI roleplay practice for navigators.
//
// Phase 1 (this component): Gemini acts as a patient caller; the navigator
// handles the call by typing. No grading — pure practice.
//
// Flow:
//   setup → loading-scenario → active → saving → done
//
// The full conversation history is kept in local React state; Firestore only
// gets one write at the end (on "End call"). AbortController timeouts prevent
// the UI from hanging if the API is slow.
// ─────────────────────────────────────────────────────────────────────────────

const INIT_TIMEOUT_MS  = 20_000;
const TURN_TIMEOUT_MS  = 20_000;

export default function Interview({ navigatorId, name }) {
  const [phase, setPhase] = useState('setup');
  // 'setup' | 'loading' | 'active' | 'saving' | 'done'

  const [domainId, setDomainId]       = useState('');
  const [scenario, setScenario]       = useState('');
  const [callerName, setCallerName]   = useState('');
  // [{role: 'patient'|'navigator', text: string}]
  const [transcript, setTranscript]   = useState([]);
  const [input, setInput]             = useState('');
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState('');

  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const domain     = DOMAINS.find((d) => d.id === domainId);

  // Scroll to newest message whenever the transcript or busy state changes.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, busy]);

  // Refocus the input after each patient reply so the navigator can keep typing.
  useEffect(() => {
    if (phase === 'active' && !busy) {
      inputRef.current?.focus();
    }
  }, [phase, busy]);

  // ── API helpers ─────────────────────────────────────────────────────────────

  const callApi = async (body, timeoutMs) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('/api/interview-turn', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, secret: SUPERVISOR_PASSCODE }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  };

  // ── Start / setup ───────────────────────────────────────────────────────────

  const startInterview = async () => {
    setPhase('loading');
    setError('');
    try {
      const data = await callApi({ domain: domainId }, INIT_TIMEOUT_MS);
      setScenario(data.scenario);
      setCallerName(data.callerName);
      setTranscript([{ role: 'patient', text: data.reply }]);
      setPhase('active');
    } catch (err) {
      setError(
        err.name === 'AbortError'
          ? 'The request timed out — check your connection and try again.'
          : err.message || 'Failed to generate a scenario.'
      );
      setPhase('setup');
    }
  };

  // ── Send a navigator message ────────────────────────────────────────────────

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setError('');

    // Optimistically append the navigator's message to the transcript.
    const withNav = [...transcript, { role: 'navigator', text }];
    setTranscript(withNav);

    try {
      const data = await callApi(
        { domain: domainId, scenario, callerName, history: transcript, navigatorMessage: text },
        TURN_TIMEOUT_MS
      );
      setTranscript([...withNav, { role: 'patient', text: data.reply }]);
    } catch (err) {
      setError(
        err.name === 'AbortError'
          ? "The patient didn't respond in time — check your connection."
          : err.message || 'Failed to get a response.'
      );
    } finally {
      setBusy(false);
    }
  };

  // ── End call ────────────────────────────────────────────────────────────────

  const endInterview = async () => {
    setPhase('saving');
    try {
      await saveInterview(navigatorId, name, domainId, scenario, callerName, transcript);
    } catch (err) {
      console.error('Failed to save interview:', err);
      // Non-blocking — navigate to done regardless; transcript is in local state.
    }
    setPhase('done');
  };

  // ── Reset ────────────────────────────────────────────────────────────────────

  const reset = () => {
    setPhase('setup');
    setDomainId('');
    setScenario('');
    setCallerName('');
    setTranscript([]);
    setInput('');
    setError('');
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  if (phase === 'done') {
    return (
      <section className="interview view-enter">
        <div className="card interview__done">
          <span className="interview__done-glyph" aria-hidden="true">✓</span>
          <h2 className="overview__panel-title">Practice session saved</h2>
          <p className="readoff__sub">
            Your transcript was saved. Start another call or switch to another tab.
          </p>
          <button className="btn btn--primary" onClick={reset}>
            Practice another call
          </button>
        </div>
      </section>
    );
  }

  if (phase === 'setup' || phase === 'loading') {
    return (
      <section className="interview view-enter">
        <header className="overview__head">
          <div>
            <h1 className="overview__title">Practice Call</h1>
            <p className="overview__lede">
              Gemini plays a patient caller. You handle the call as you would normally —
              no scoring, just practice.
            </p>
          </div>
        </header>

        <div className="card interview__setup">
          <h2 className="overview__panel-title">Choose a domain to practice</h2>
          <p className="readoff__sub">
            A scenario will be generated for you. Every call is different.
          </p>
          <div className="interview__domain-grid">
            {DOMAINS.map((d) => (
              <button
                key={d.id}
                className={[
                  'card card--interactive interview__domain-btn',
                  domainId === d.id ? 'interview__domain-btn--selected' : '',
                ].join(' ')}
                onClick={() => setDomainId(d.id)}
                type="button"
              >
                <span className="interview__domain-name">{d.name}</span>
                <span className="interview__domain-blurb">{d.blurb}</span>
              </button>
            ))}
          </div>

          {error && <p className="gate__error">{error}</p>}

          <button
            className="btn btn--primary"
            disabled={!domainId || phase === 'loading'}
            onClick={startInterview}
            type="button"
          >
            {phase === 'loading' ? 'Setting up scenario…' : 'Start practice call'}
          </button>
        </div>
      </section>
    );
  }

  // ── Active / saving ─────────────────────────────────────────────────────────

  return (
    <section className="interview interview--active view-enter">
      {/* Header: scenario briefing + end-call button */}
      <div className="interview__header card">
        <div className="interview__header-left">
          <span className="interview__domain-tag tag">{domain?.name}</span>
          <p className="interview__scenario">{scenario}</p>
          <span className="interview__caller-chip">
            Caller: <strong>{callerName}</strong>
          </span>
        </div>
        <button
          className="btn btn--ghost btn--sm interview__end-btn"
          onClick={endInterview}
          disabled={phase === 'saving'}
          type="button"
        >
          {phase === 'saving' ? 'Saving…' : 'End call'}
        </button>
      </div>

      {/* Chat window */}
      <div className="interview__chat" role="log" aria-live="polite">
        {transcript.map((turn, i) => (
          <div
            key={i}
            className={`interview__bubble interview__bubble--${turn.role}`}
          >
            <span className="interview__bubble-label">
              {turn.role === 'patient' ? callerName : 'You'}
            </span>
            <p className="interview__bubble-text">{turn.text}</p>
          </div>
        ))}

        {/* Typing indicator while waiting for the patient reply */}
        {busy && (
          <div className="interview__bubble interview__bubble--patient interview__bubble--typing">
            <span className="interview__bubble-label">{callerName}</span>
            <span className="interview__typing-dots" aria-label="Caller is responding">
              <span /><span /><span />
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {error && <p className="gate__error interview__error">{error}</p>}

      {/* Input row */}
      <form
        className="interview__input-row"
        onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
      >
        <input
          ref={inputRef}
          className="gate__input interview__input"
          type="text"
          placeholder="Type your response…"
          value={input}
          disabled={busy || phase === 'saving'}
          onChange={(e) => setInput(e.target.value)}
          autoComplete="off"
        />
        <button
          className="btn btn--primary"
          type="submit"
          disabled={!input.trim() || busy || phase === 'saving'}
        >
          Send
        </button>
      </form>
    </section>
  );
}
