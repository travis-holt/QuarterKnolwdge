import { useState, useRef, useEffect } from 'react';
import { DOMAINS } from '../data/questions.js';
import { interviewScoreColor } from '../data/config.js';
import { saveInterview, updateInterviewGrade } from '../lib/db.js';
import { apiFetch, fetchErrorMessage } from '../lib/apiFetch.js';

// ─────────────────────────────────────────────────────────────────────────────
// Interview — AI roleplay practice for navigators.
//
// Flow:
//   setup → loading-scenario → active → saving → grading → reviewed
//                                     ↘ (discard) → discarded
//
// After saving, the transcript is graded by Gemini (/api/grade-interview) and
// the navigator sees a score + strengths/improvements review. Grade is also
// written back to the Firestore interview doc so supervisors can read it.
// Discard skips Firestore entirely — nothing is stored.
// ─────────────────────────────────────────────────────────────────────────────

const INIT_TIMEOUT_MS  = 20_000;
const TURN_TIMEOUT_MS  = 20_000;
const GRADE_TIMEOUT_MS = 30_000;

export default function Interview({ navigatorId, name, department = 'pediatrics' }) {
  // phases: setup | loading | active | saving | grading | reviewed | discarded
  const [phase, setPhase]           = useState('setup');
  const [domainId, setDomainId]     = useState('');
  const [scenario, setScenario]     = useState('');
  const [callerName, setCallerName] = useState('');
  // [{role: 'patient'|'navigator', text: string}]
  const [transcript, setTranscript] = useState([]);
  const [input, setInput]           = useState('');
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState('');
  const [grade, setGrade]           = useState(null); // { score, summary, strengths[], improvements[] }
  const [gradeBusy, setGradeBusy]   = useState(false); // retrying a failed grade from the reviewed screen

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const docIdRef  = useRef(null);   // saved interview doc, kept so a grade retry can write back
  const caseFileRef = useRef(null); // hidden scenario case file from init, echoed back on turns so the caller stays consistent
  const domain    = DOMAINS.find((d) => d.id === domainId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, busy]);

  useEffect(() => {
    if (phase === 'active' && !busy) inputRef.current?.focus();
  }, [phase, busy]);

  // ── API helpers ─────────────────────────────────────────────────────────────

  const callTurnApi = (body, timeoutMs) => apiFetch('/api/interview-turn', body, timeoutMs);

  // ── Start ────────────────────────────────────────────────────────────────────

  const startInterview = async () => {
    // ponytail: random domain just anchors the AI scenario; navigator no longer picks one.
    const pick = DOMAINS[Math.floor(Math.random() * DOMAINS.length)].id;
    setDomainId(pick);
    setPhase('loading');
    setError('');
    try {
      const data = await callTurnApi({ domain: pick, department }, INIT_TIMEOUT_MS);
      setScenario(data.scenario);
      setCallerName(data.callerName);
      caseFileRef.current = data.caseFile ?? null;
      setTranscript([{ role: 'patient', text: data.reply }]);
      setPhase('active');
    } catch (err) {
      setError(fetchErrorMessage(err, 'The request timed out — check your connection and try again.', 'Failed to generate a scenario.'));
      setPhase('setup');
    }
  };

  // ── Send a navigator message ─────────────────────────────────────────────────

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setError('');
    const withNav = [...transcript, { role: 'navigator', text }];
    setTranscript(withNav);
    try {
      const data = await callTurnApi(
        { domain: domainId, department, scenario, callerName, caseFile: caseFileRef.current, history: transcript, navigatorMessage: text },
        TURN_TIMEOUT_MS
      );
      setTranscript([...withNav, { role: 'patient', text: data.reply }]);
    } catch (err) {
      setError(fetchErrorMessage(err, "The patient didn't respond in time — check your connection.", 'Failed to get a response.'));
    } finally {
      setBusy(false);
    }
  };

  // ── Save + grade ─────────────────────────────────────────────────────────────

  // Grades the transcript; used both on save and when retrying from the reviewed
  // screen (grading can fail transiently when the Gemini keys are rate-limited).
  const runGrading = async () => {
    try {
      const data = await apiFetch(
        '/api/grade-interview',
        { domain: domainId, department, scenario, transcript, name },
        GRADE_TIMEOUT_MS,
      );
      if (data.grade) {
        setGrade(data.grade);
        // Write grade back to the Firestore doc so supervisors can see it too.
        if (docIdRef.current) {
          updateInterviewGrade(docIdRef.current, data.grade).catch((err) =>
            console.error('Failed to save grade to Firestore:', err)
          );
        }
      }
    } catch (err) {
      console.error('Failed to grade interview:', err);
    }
  };

  const saveAndGrade = async () => {
    setPhase('saving');
    docIdRef.current = null;
    try {
      docIdRef.current = await saveInterview(navigatorId, name, domainId, scenario, callerName, transcript, department);
    } catch (err) {
      console.error('Failed to save interview:', err);
      // Continue to grading even if save failed — navigator still sees feedback.
    }

    setPhase('grading');
    await runGrading();
    setPhase('reviewed');
  };

  const retryGrading = async () => {
    setGradeBusy(true);
    await runGrading();
    setGradeBusy(false);
  };

  // ── Discard ──────────────────────────────────────────────────────────────────

  const discardInterview = () => {
    setPhase('discarded');
  };

  // ── Reset ─────────────────────────────────────────────────────────────────────

  const reset = () => {
    setPhase('setup');
    setDomainId('');
    setScenario('');
    setCallerName('');
    setTranscript([]);
    setInput('');
    setError('');
    setGrade(null);
    setGradeBusy(false);
    docIdRef.current = null;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Discarded ────────────────────────────────────────────────────────────────

  if (phase === 'discarded') {
    return (
      <section className="interview view-enter">
        <div className="card interview__done interview__done--discarded">
          <span className="interview__done-glyph" aria-hidden="true">✕</span>
          <h2 className="overview__panel-title">Session discarded</h2>
          <p className="readoff__sub">Nothing was saved. Start a fresh practice call whenever you&rsquo;re ready.</p>
          <button className="btn btn--primary" onClick={reset}>Start another call</button>
        </div>
      </section>
    );
  }

  // ── Reviewed (grading complete) ───────────────────────────────────────────────

  if (phase === 'reviewed') {
    const scoreColor = grade ? interviewScoreColor(grade.score) : 'var(--ink-soft)';

    return (
      <section className="interview view-enter">
        <div className="interview__review">

          {/* Score card */}
          <div className="card interview__score-card">
            <p className="interview__score-label">Practice call score</p>
            {grade ? (
              <p className="interview__score-value" style={{ color: scoreColor }}>
                {grade.score}<span className="interview__score-denom">/100</span>
              </p>
            ) : (
              <p className="interview__score-value interview__score-value--na">—</p>
            )}
            <p className="interview__score-domain tag">{domain?.name}</p>
            {grade?.summary && (
              <p className="interview__score-summary">{grade.summary}</p>
            )}
            {!grade && (
              <>
                <p className="readoff__sub" style={{ marginTop: '0.75rem' }}>
                  Your session was saved, but the review couldn&rsquo;t be generated — the reviewer
                  may be busy right now.
                </p>
                <button
                  className="btn btn--ghost btn--sm"
                  style={{ marginTop: '0.75rem' }}
                  disabled={gradeBusy}
                  onClick={retryGrading}
                  type="button"
                >
                  {gradeBusy ? 'Reviewing…' : 'Try the review again'}
                </button>
              </>
            )}
          </div>

          {/* Strengths */}
          {grade?.strengths?.length > 0 && (
            <div className="card interview__feedback-card interview__feedback-card--strengths">
              <h3 className="interview__feedback-title">
                <span className="interview__feedback-icon" aria-hidden="true">✓</span>
                What you did well
              </h3>
              <ul className="interview__feedback-list">
                {grade.strengths.map((s, i) => (
                  <li key={i} className="interview__feedback-item">{s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Improvements */}
          {grade?.improvements?.length > 0 && (
            <div className="card interview__feedback-card interview__feedback-card--improvements">
              <h3 className="interview__feedback-title">
                <span className="interview__feedback-icon" aria-hidden="true">→</span>
                What to work on
              </h3>
              <ul className="interview__feedback-list">
                {grade.improvements.map((s, i) => (
                  <li key={i} className="interview__feedback-item">{s}</li>
                ))}
              </ul>
            </div>
          )}

          <button className="btn btn--primary" onClick={reset} style={{ alignSelf: 'flex-start' }}>
            Practice another call
          </button>
        </div>
      </section>
    );
  }

  // ── Setup / loading scenario ──────────────────────────────────────────────────

  if (phase === 'setup' || phase === 'loading') {
    return (
      <section className="interview view-enter">
        <header className="overview__head">
          <div>
            <h1 className="overview__title">Practice Call</h1>
            <p className="overview__lede">
              A simulated patient caller will join. You handle the call as you would normally.
              When you&rsquo;re done, save the session to get a score and feedback.
            </p>
          </div>
        </header>

        <div className="card interview__setup">
          <h2 className="overview__panel-title">Ready when you are</h2>
          <p className="readoff__sub">A scenario will be generated for you. Every call is different.</p>

          {error && <p className="gate__error">{error}</p>}

          <button
            className="btn btn--primary"
            disabled={phase === 'loading'}
            onClick={startInterview}
            type="button"
          >
            {phase === 'loading' ? 'Setting up scenario…' : 'Start practice call'}
          </button>
        </div>
      </section>
    );
  }

  // ── Saving / grading spinners ─────────────────────────────────────────────────

  if (phase === 'saving' || phase === 'grading') {
    return (
      <section className="interview view-enter">
        <div className="card interview__done">
          <div className="interview__grading-spinner" aria-hidden="true" />
          <h2 className="overview__panel-title">
            {phase === 'saving' ? 'Saving your session…' : 'Reviewing your call…'}
          </h2>
          <p className="readoff__sub">
            {phase === 'grading'
              ? 'Reviewing your performance against the SOP. This takes a few seconds.'
              : 'Almost done…'}
          </p>
        </div>
      </section>
    );
  }

  // ── Active call ───────────────────────────────────────────────────────────────

  return (
    <section className="interview interview--active view-enter">
      {/* Header: scenario briefing + end-call buttons */}
      <div className="interview__header card">
        <div className="interview__header-left">
          <span className="interview__domain-tag tag">{domain?.name}</span>
          <p className="interview__scenario">{scenario}</p>
          <span className="interview__caller-chip">
            Caller: <strong>{callerName}</strong>
          </span>
        </div>
        <div className="interview__end-actions">
          <button
            className="btn btn--ghost btn--sm"
            onClick={discardInterview}
            type="button"
          >
            Discard
          </button>
          <button
            className="btn btn--primary btn--sm interview__end-btn"
            onClick={saveAndGrade}
            type="button"
          >
            Save &amp; get feedback
          </button>
        </div>
      </div>

      {/* Chat window */}
      <div className="interview__chat" role="log" aria-live="polite">
        {transcript.map((turn, i) => (
          <div key={i} className={`interview__bubble interview__bubble--${turn.role}`}>
            <span className="interview__bubble-label">
              {turn.role === 'patient' ? callerName : 'You'}
            </span>
            <p className="interview__bubble-text">{turn.text}</p>
          </div>
        ))}

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
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          autoComplete="off"
        />
        <button
          className="btn btn--primary"
          type="submit"
          disabled={!input.trim() || busy}
        >
          Send
        </button>
      </form>
    </section>
  );
}
