import { useState, useEffect, useRef } from 'react';
import { DOMAINS } from '../data/questions.js';
import { SUPERVISOR_PASSCODE } from '../data/config.js';
import { saveCompletion } from '../lib/db.js';

// ─────────────────────────────────────────────────────────────────────────────
// SpotTheError — "Flight Simulator" QA audit training exercise.
//
// Gemini generates a realistic ~10-line chat transcript between a patient and
// a (bad) agent who makes exactly one SOP violation. The navigator's job is to
// click the exact message where the agent went wrong, then write a reflection.
// Gemini coaches their answer; they can't fail — the AI is advisory only.
//
// Flow:  loading → active → reflect → coached → (saving) → done
//
// Completion is gated on: clicking the right line + submitting any reflection.
// The AI coaching step is non-blocking — a network failure just skips the AI
// note and shows the model answer. Done = always reachable.
// ─────────────────────────────────────────────────────────────────────────────

const GENERATE_TIMEOUT_MS = 25_000;
const COACH_TIMEOUT_MS    = 15_000;

export default function SpotTheError({ navigatorId, name, domainId, onBack, onComplete }) {
  const [phase, setPhase] = useState('loading');
  // 'loading' | 'active' | 'reflect' | 'coaching' | 'coached' | 'saving' | 'done'

  const [transcript,       setTranscript]       = useState([]);
  const [errorIndex,       setErrorIndex]        = useState(-1);
  const [hint,             setHint]              = useState('');
  const [modelExplanation, setModelExplanation]  = useState('');

  const [shakeIndex,   setShakeIndex]   = useState(null);   // bubble index being shaken
  const [hintVisible,  setHintVisible]  = useState(false);  // show hint after first wrong click
  const [reflection,   setReflection]   = useState('');
  const [coachReply,   setCoachReply]   = useState('');
  const [genError,     setGenError]     = useState('');

  const reflectRef = useRef(null);
  const domain     = DOMAINS.find((d) => d.id === domainId);

  // Generate the flawed transcript on mount.
  useEffect(() => {
    generate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll the reflection textarea into view when that phase starts.
  useEffect(() => {
    if (phase === 'reflect') {
      setTimeout(() => reflectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }, [phase]);

  // ── API helpers ─────────────────────────────────────────────────────────────

  const callApi = async (endpoint, body, timeoutMs) => {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        signal:  controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...body, secret: SUPERVISOR_PASSCODE }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      return await res.json();
    } finally {
      clearTimeout(tid);
    }
  };

  // ── Generate ─────────────────────────────────────────────────────────────────

  const generate = async () => {
    setPhase('loading');
    setGenError('');
    setHintVisible(false);
    setReflection('');
    setCoachReply('');
    try {
      const data = await callApi('/api/generate-audit', { domain: domainId }, GENERATE_TIMEOUT_MS);
      setTranscript(data.transcript);
      setErrorIndex(data.errorIndex);
      setHint(data.hint);
      setModelExplanation(data.modelExplanation);
      setPhase('active');
    } catch (err) {
      setGenError(
        err.name === 'AbortError'
          ? 'The request timed out — check your connection and try again.'
          : err.message || 'Failed to generate a scenario.'
      );
      // Stay on 'loading' with error message + retry button.
    }
  };

  // ── Bubble click ─────────────────────────────────────────────────────────────

  const handleBubbleClick = (index) => {
    if (phase !== 'active') return;
    // Only Agent messages can contain errors.
    if (transcript[index]?.speaker !== 'Agent') return;

    if (index === errorIndex) {
      setPhase('reflect');
    } else {
      // Wrong — shake the bubble and reveal the hint.
      setShakeIndex(index);
      setHintVisible(true);
      setTimeout(() => setShakeIndex(null), 550);
    }
  };

  // ── Submit reflection → get coaching ─────────────────────────────────────────

  const submitReflection = async () => {
    if (!reflection.trim()) return;
    setPhase('coaching');
    try {
      const data = await callApi(
        '/api/coach-audit',
        { domain: domainId, modelExplanation, navigatorAnswer: reflection, name },
        COACH_TIMEOUT_MS
      );
      setCoachReply(data.reply || '');
    } catch {
      // Non-blocking — coaching failure just means no AI note; model answer still shows.
      setCoachReply('');
    }
    setPhase('coached');
  };

  // ── Complete ─────────────────────────────────────────────────────────────────

  const complete = async () => {
    setPhase('saving');
    try {
      await saveCompletion(navigatorId, name, domainId);
    } catch (err) {
      console.error('Failed to save completion:', err);
      // Non-blocking — we still show done; the supervisor dashboard will just lack this entry.
    }
    onComplete?.(domainId);
    setPhase('done');
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Loading / error ──────────────────────────────────────────────────────────

  if (phase === 'loading' || (phase === 'loading' && genError)) {
    return (
      <section className="spot-error view-enter">
        <button className="linkbtn spot-error__back" onClick={onBack}>← Back to my training</button>
        <div className="card spot-error__loading-card">
          {genError ? (
            <>
              <p className="gate__error">{genError}</p>
              <button className="btn btn--primary" onClick={generate}>Try again</button>
            </>
          ) : (
            <>
              <div className="skeleton skeleton--line" style={{ width: '70%', marginBottom: '0.75rem' }} />
              <div className="skeleton skeleton--line" style={{ width: '55%', marginBottom: '0.75rem' }} />
              <div className="skeleton skeleton--line" style={{ width: '80%', marginBottom: '0.75rem' }} />
              <div className="skeleton skeleton--line" style={{ width: '50%', marginBottom: '0.75rem' }} />
              <div className="skeleton skeleton--line" style={{ width: '65%' }} />
              <p className="spot-error__loading-label">Generating your scenario…</p>
            </>
          )}
        </div>
      </section>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────────

  if (phase === 'done') {
    return (
      <section className="spot-error view-enter">
        <div className="card spot-error__done">
          <span className="spot-error__done-glyph" aria-hidden="true">✓</span>
          <h2 className="overview__panel-title">Scenario complete</h2>
          <p className="readoff__sub">
            Practice session saved. You can practice this domain again any time from your
            training plan.
          </p>
          <div className="spot-error__done-actions">
            <button className="btn btn--primary" onClick={onBack}>Back to my training</button>
            <button className="btn btn--ghost" onClick={generate}>Try another scenario</button>
          </div>
        </div>
      </section>
    );
  }

  // ── Active / reflect / coaching / coached ─────────────────────────────────────

  return (
    <section className="spot-error view-enter">
      <button className="linkbtn spot-error__back" onClick={onBack}>← Back to my training</button>

      {/* Header card */}
      <div className="card spot-error__header">
        <div className="spot-error__header-left">
          <span className="tag tag--accent">{domain?.name}</span>
          <h1 className="spot-error__title">Spot the Error</h1>
          {phase === 'active' && (
            <p className="spot-error__instructions">
              The agent in this conversation made a critical policy mistake.{' '}
              <strong>Click the exact message where they went wrong.</strong>
            </p>
          )}
          {(phase === 'reflect' || phase === 'coaching' || phase === 'coached') && (
            <p className="spot-error__instructions spot-error__instructions--found">
              You found it — the highlighted message is where the agent broke policy.
            </p>
          )}
        </div>
        {(phase === 'active') && hintVisible && (
          <div className="spot-error__hint" role="status">
            <span className="spot-error__hint-label">Hint</span>
            <span className="spot-error__hint-text">{hint}</span>
          </div>
        )}
      </div>

      {/* Transcript */}
      <div className="spot-error__transcript" role="list">
        {transcript.map((turn, i) => {
          const isAgent   = turn.speaker === 'Agent';
          const isError   = i === errorIndex;
          const isFound   = isError && phase !== 'active';
          const isShaking = i === shakeIndex;
          const clickable = phase === 'active' && isAgent;

          const classes = [
            'spot-error__bubble',
            `spot-error__bubble--${isAgent ? 'agent' : 'patient'}`,
            clickable              ? 'spot-error__bubble--clickable' : '',
            isFound                ? 'spot-error__bubble--found'     : '',
            isShaking              ? 'spot-error__bubble--shake'     : '',
          ].filter(Boolean).join(' ');

          return (
            <div key={i} className={classes} role="listitem">
              <span className="spot-error__speaker">{turn.speaker}</span>
              <button
                className="spot-error__message"
                onClick={() => handleBubbleClick(i)}
                disabled={!clickable}
                type="button"
                aria-label={clickable ? `Select this message as the error` : undefined}
              >
                {turn.message}
              </button>
            </div>
          );
        })}
      </div>

      {/* Reflect panel — shows after the correct bubble is clicked */}
      {(phase === 'reflect' || phase === 'coaching' || phase === 'coached') && (
        <div className="card spot-error__reflect" ref={reflectRef}>
          <h2 className="overview__panel-title">Why is this wrong?</h2>
          <p className="readoff__sub">
            Explain what the agent should have done instead. Write in your own words — there are no
            wrong answers here.
          </p>
          <textarea
            className="spot-error__textarea"
            placeholder="The agent should have…"
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            disabled={phase !== 'reflect'}
            rows={4}
          />
          {phase === 'reflect' && (
            <button
              className="btn btn--primary"
              onClick={submitReflection}
              disabled={!reflection.trim()}
              type="button"
            >
              Submit reflection
            </button>
          )}
          {phase === 'coaching' && (
            <div className="spot-error__coaching-loading">
              <div className="skeleton skeleton--line" style={{ width: '80%', marginBottom: '0.5rem' }} />
              <div className="skeleton skeleton--line" style={{ width: '60%' }} />
            </div>
          )}
        </div>
      )}

      {/* Coached panel — AI reply + model answer */}
      {phase === 'coached' && (
        <div className="card spot-error__coached">
          {coachReply && (
            <div className="spot-error__ai-reply">
              <span className="spot-error__ai-badge">AI Coach</span>
              <p className="spot-error__ai-text">{coachReply}</p>
            </div>
          )}
          <div className="spot-error__model-answer">
            <h3 className="spot-error__model-title">What the SOP says</h3>
            <p className="spot-error__model-text">{modelExplanation}</p>
          </div>
          <button
            className="btn btn--primary"
            onClick={complete}
            type="button"
          >
            Mark complete
          </button>
        </div>
      )}

      {phase === 'saving' && (
        <div className="card spot-error__coached">
          <p className="readoff__sub">Saving…</p>
        </div>
      )}
    </section>
  );
}
