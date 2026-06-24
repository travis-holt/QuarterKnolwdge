import { DOMAINS } from '../data/questions.js';
import { COMPETENCIES, competencyName } from '../data/competencies.js';
import { LEVELS } from '../data/config.js';
import { scoreToLevel } from '../lib/scoring.js';

// ─────────────────────────────────────────────────────────────────────────────
// Coaching — the rule-based feedback shown immediately after a check. No LLM:
// every explanation comes from the authored `rationale` on each option plus the
// computed competency scores. Shows (1) a competency strengths/gaps summary and
// (2) a per-question review (your choice + the best choice + why), so the
// navigator leaves knowing exactly what to reinforce.
// ─────────────────────────────────────────────────────────────────────────────

const domainName = (id) => DOMAINS.find((d) => d.id === id)?.name ?? id;

// Tone for a chosen option, by points earned — keeps the priority encoding
// separate from the capability (level) colours.
function toneFor(points) {
  if (points >= 85) return 'is-good';
  if (points >= 40) return 'is-partial';
  return 'is-poor';
}

export default function Coaching({ questions, answers, competencyScores, name, onContinue }) {
  const scored = COMPETENCIES.map((c) => ({ id: c.id, pct: competencyScores?.[c.id] })).filter(
    (c) => typeof c.pct === 'number'
  );
  const strengths = scored.filter((c) => scoreToLevel(c.pct) === 'canTeach');
  const growth = scored.filter((c) => scoreToLevel(c.pct) === 'learning');

  return (
    <section className="coaching">
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
