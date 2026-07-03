import { useState, useEffect } from 'react';
import { domainName } from '../data/questions.js';
import { LEVELS } from '../data/config.js';
import { scoreToLevel } from '../lib/scoring.js';
import { getResultHistory } from '../lib/db.js';
import { isFirebaseConfigured } from '../lib/firebase.js';

// ─────────────────────────────────────────────────────────────────────────────
// MyHistory — the navigator's own attempt history + answer review (pilot
// feedback: "Navigators need a way to check their answers and test history").
//
// Two panels:
//   1. Attempt history — every resultHistory snapshot for this navigator +
//      department (newest first), with per-domain level chips. The data was
//      already being written on every save; this is the first navigator-facing
//      read of it.
//   2. Answer review — the per-question breakdown of their most recent MCQ
//      submission (their pick vs the best answer + SOP rationale), reusing the
//      same rendering the post-check Coaching screen shows once. `answers` are
//      stored on the result doc, so this survives sign-out/sign-in.
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_LABEL = { mcq: 'Multiple choice', spot: 'Spot the Error', qa: 'Call QA Test' };

function toneFor(points) {
  if (points >= 85) return 'is-good';
  if (points >= 40) return 'is-partial';
  return 'is-poor';
}

function formatDate(takenAt) {
  if (!takenAt?.seconds) return '—';
  return new Date(takenAt.seconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function MyHistory({ navigatorId, department = 'pediatrics', deptName, resultsByType = {}, questions = [] }) {
  const [history, setHistory] = useState(null); // null = loading, [] = none

  useEffect(() => {
    if (!isFirebaseConfigured) { setHistory([]); return undefined; }
    let active = true;
    getResultHistory(navigatorId, department)
      .then((list) => { if (active) setHistory(list.filter((h) => !h.simulated)); })
      .catch((err) => {
        console.error('getResultHistory (navigator):', err);
        if (active) setHistory([]);
      });
    return () => { active = false; };
  }, [navigatorId, department]);

  const attempts = [...(history ?? [])].reverse(); // newest first

  // Answer review comes from the stored MCQ result doc (Spot picks aren't stored
  // per-item). Only questions still in the live bank can be re-rendered; answers
  // to since-archived questions are skipped.
  const mcqResult = resultsByType.mcq;
  const answers = mcqResult?.answers ?? {};
  const reviewQuestions = questions.filter((q) => answers[q.id] !== undefined);
  const skippedCount = Object.keys(answers).length - reviewQuestions.length;

  return (
    <section className="coaching view-enter">
      <header className="overview__head">
        <div>
          <h1 className="overview__title">My history — {deptName}</h1>
          <p className="overview__lede">
            Every assessment you&rsquo;ve taken for this department, plus the answer-by-answer
            review of your latest check.
          </p>
        </div>
      </header>

      {/* ── Attempt history ───────────────────────────────────────────── */}
      <div className="card navdetail__panel">
        <h2 className="overview__panel-title">Attempt history</h2>
        {history === null ? (
          <div className="coaching__ai-skeleton">
            <div className="skeleton skeleton--line" style={{ width: '70%' }} />
            <div className="skeleton skeleton--line" style={{ width: '55%' }} />
          </div>
        ) : attempts.length === 0 ? (
          <p className="readoff__empty">No attempts recorded yet — take an assessment and it will appear here.</p>
        ) : (
          <ol className="history__list">
            {attempts.map((h, i) => (
              <li key={h.id ?? i} className="history__item">
                <div className="history__item-head">
                  <span className="history__date">{formatDate(h.takenAt)}</span>
                  <span className="tag">{TYPE_LABEL[h.assessmentType] ?? 'Assessment'}</span>
                  {i === 0 && <span className="tag tag--accent">Latest</span>}
                </div>
                <div className="chip-wrap history__chips">
                  {Object.entries(h.scores ?? {}).map(([domainId, pct]) => {
                    const lvl = LEVELS[scoreToLevel(pct)];
                    return (
                      <span
                        key={domainId}
                        className="level-chip"
                        style={{ background: lvl.color, color: lvl.text }}
                        title={`${domainName(domainId)}: ${Math.round(pct)}%`}
                      >
                        {domainName(domainId)} · {Math.round(pct)}%
                      </span>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ── Answer review (latest MCQ) ────────────────────────────────── */}
      <div className="card navdetail__panel">
        <h2 className="overview__panel-title">Answer review — latest multiple-choice check</h2>
        {reviewQuestions.length === 0 ? (
          <p className="readoff__empty">
            {mcqResult
              ? 'The questions from your last check are no longer in the active bank, so the review can’t be shown.'
              : 'Take the multiple-choice check and your answer review will appear here.'}
          </p>
        ) : (
          <>
            <p className="readoff__sub">
              Your pick on each scenario, with the best answer and the SOP reason where you
              didn&rsquo;t choose it.
              {skippedCount > 0 && ` (${skippedCount} answer${skippedCount === 1 ? '' : 's'} to since-retired questions not shown.)`}
            </p>
            <ol className="coaching__list">
              {reviewQuestions.map((q, i) => {
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
          </>
        )}
      </div>
    </section>
  );
}
