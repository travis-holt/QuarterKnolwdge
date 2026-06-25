import { useState, useEffect } from 'react';
import { DOMAINS } from '../data/questions.js';
import { COMPETENCIES, competencyName } from '../data/competencies.js';
import { LEVELS, SUPERVISOR_PASSCODE } from '../data/config.js';
import { scoreToLevel } from '../lib/scoring.js';

// ─────────────────────────────────────────────────────────────────────────────
// Coaching — post-check feedback shown immediately after submit.
//
// Two layers:
//   1. Rule-based (always present): competency strengths/gaps chips + per-
//      question review built from the authored `rationale` on each option.
//   2. AI coaching (async, optional): Gemini writes a 2–3 sentence personalized
//      note per weak competency, grounded in the rationales above. Shown while
//      loading as a skeleton; silently omitted if the API call fails.
// ─────────────────────────────────────────────────────────────────────────────

const domainName = (id) => DOMAINS.find((d) => d.id === id)?.name ?? id;

function toneFor(points) {
  if (points >= 85) return 'is-good';
  if (points >= 40) return 'is-partial';
  return 'is-poor';
}

export default function Coaching({ questions, answers, competencyScores, name, onContinue }) {
  // null = still loading, false = failed/skip, object = { [compId]: string }
  const [aiCoaching, setAiCoaching] = useState(null);

  // Fire the coaching request once on mount. 10 s hard timeout → silent
  // fallback to rule-based coaching so the navigator is never stuck waiting.
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    fetch('/api/generate-coaching', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers, questions, competencyScores, name, secret: SUPERVISOR_PASSCODE }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setAiCoaching(data?.coaching ?? {}))
      .catch(() => setAiCoaching(false))
      .finally(() => clearTimeout(timeout));

    return () => { controller.abort(); clearTimeout(timeout); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally fire once — answers/questions are stable after submit

  const scored = COMPETENCIES.map((c) => ({ id: c.id, pct: competencyScores?.[c.id] })).filter(
    (c) => typeof c.pct === 'number'
  );
  const strengths = scored.filter((c) => scoreToLevel(c.pct) === 'canTeach');
  const growth = scored.filter((c) => scoreToLevel(c.pct) === 'learning');

  // Competencies that have an AI note to show (only when coaching loaded)
  const aiEntries = aiCoaching && typeof aiCoaching === 'object'
    ? Object.entries(aiCoaching).filter(([, note]) => note)
    : [];

  return (
    <section className="coaching view-enter">
      <header className="coaching__head">
        <h1 className="navdetail__title">Nice work, {name} — here&rsquo;s your coaching</h1>
        <p className="navdetail__lede">
          Feedback is per competency, never a single grade. Review the calls below, then continue to
          your dashboard.
        </p>
      </header>

      {/* ── Competency strengths / gaps ───────────────────────────────── */}
      <div className="navdetail__callouts">
        <div className="card callout">
          <h2 className="callout__title">Competency strengths</h2>
          {strengths.length === 0 ? (
            <p className="readoff__empty">No Can-Teach competency yet — keep building.</p>
          ) : (
            <div className="chip-wrap">
              {strengths.map((c) => (
                <span
                  key={c.id}
                  className="level-chip"
                  style={{ background: LEVELS.canTeach.color, color: LEVELS.canTeach.text }}
                >
                  {competencyName(c.id)}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="card callout">
          <h2 className="callout__title">Focus areas</h2>
          {growth.length === 0 ? (
            <p className="readoff__empty">No Learning-level competencies — strong across the board.</p>
          ) : (
            <div className="chip-wrap">
              {growth.map((c) => (
                <span
                  key={c.id}
                  className="level-chip"
                  style={{ background: LEVELS.learning.color, color: LEVELS.learning.text }}
                >
                  {competencyName(c.id)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── AI coaching notes (async, optional) ──────────────────────── */}
      {/* Show skeleton while loading; render notes when ready; hide on failure */}
      {aiCoaching === null && (
        <div className="card coaching__ai">
          <h2 className="overview__panel-title">
            Your personalised coaching&nbsp;
            <span className="coaching__ai-badge">AI</span>
          </h2>
          <div className="coaching__ai-skeleton">
            <div className="skeleton skeleton--line" style={{ width: '60%' }} />
            <div className="skeleton skeleton--line" style={{ width: '90%' }} />
            <div className="skeleton skeleton--line" style={{ width: '75%' }} />
          </div>
        </div>
      )}

      {aiCoaching !== false && aiEntries.length > 0 && (
        <div className="card coaching__ai">
          <h2 className="overview__panel-title">
            Your personalised coaching&nbsp;
            <span className="coaching__ai-badge">AI</span>
          </h2>
          <p className="readoff__sub">
            Based on your answers and the SOP rationales — grounded in what you actually saw in this
            check.
          </p>
          <ul className="coaching__ai-list">
            {aiEntries.map(([compId, note]) => (
              <li key={compId} className="coaching__ai-item">
                <span className="coaching__ai-comp">{competencyName(compId)}</span>
                <p className="coaching__ai-note">{note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Per-question review ───────────────────────────────────────── */}
      <div className="card navdetail__panel">
        <h2 className="overview__panel-title">Answer-by-answer review</h2>
        <p className="readoff__sub">
          Each call is scored on quality, not just right/wrong. Where you didn&rsquo;t pick the best
          option, the best one is shown with the reason.
        </p>
        <ol className="coaching__list">
          {questions.map((q, i) => {
            const chosenId = answers[q.id];
            const chosen = q.options.find((o) => o.id === chosenId);
            const best = q.options.find((o) => o.id === q.correctOptionId) ?? q.options[0];
            const earned = chosen ? (typeof chosen.points === 'number' ? chosen.points : chosenId === q.correctOptionId ? 100 : 0) : 0;
            const pickedBest = chosenId === best.id;
            return (
              <li key={q.id} className="coaching__q">
                <div className="coaching__q-head">
                  <span className="coaching__q-num">{i + 1}</span>
                  <span className="tag">{domainName(q.domainId)}</span>
                  <span className={`coaching__pts ${toneFor(earned)}`}>{earned} pts</span>
                </div>
                <p className="coaching__scenario">{q.scenario}</p>

                <div className={`coaching__choice ${toneFor(earned)}`}>
                  <span className="coaching__choice-label">
                    {chosen ? 'Your answer' : 'No answer recorded'}
                  </span>
                  {chosen && <p className="coaching__choice-text">{chosen.text}</p>}
                  {chosen?.rationale && <p className="coaching__rationale">{chosen.rationale}</p>}
                </div>

                {!pickedBest && (
                  <div className="coaching__choice is-best">
                    <span className="coaching__choice-label">Best answer</span>
                    <p className="coaching__choice-text">{best.text}</p>
                    {best.rationale && <p className="coaching__rationale">{best.rationale}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="coaching__actions">
        <button className="btn btn--primary" onClick={onContinue}>
          View my dashboard →
        </button>
      </div>
    </section>
  );
}
