import { useState, useEffect } from 'react';
import { domainName } from '../data/questions.js';
import { LEVELS } from '../data/config.js';
import { domainBand, overallStatus, optionPoints } from '../lib/scoring.js';
import { OverallBadge } from './OverallStatus.jsx';

/**
 * Overall status for one stored attempt, tolerating legacy/malformed score maps
 * (missing `scores`, nulls, strings, NaN). `overallStatus` only counts finite
 * numbers, so a corrupt entry reads as unscored rather than throwing.
 */
function attemptStatus(attempt) {
  return overallStatus(attempt?.scores ?? {});
}
import { getResultHistory } from '../lib/db.js';
import { isFirebaseConfigured } from '../lib/firebase.js';
import { timestampMillis } from '../lib/time.js';

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
  const millis = timestampMillis(takenAt);
  if (!millis) return '—';
  return new Date(millis).toLocaleDateString(undefined, {
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
                {/* Always show the overall state, including Incomplete — hiding
                    it entirely would make a partial attempt look like no attempt. */}
                <p className="history__overall">
                  <OverallBadge
                    score={attemptStatus(h).score}
                    level={attemptStatus(h).level}
                    label={attemptStatus(h).label}
                    complete={attemptStatus(h).complete}
                    assessedDomains={attemptStatus(h).assessedDomains}
                    totalDomains={attemptStatus(h).totalDomains}
                    size="sm"
                  />
                </p>
                {/* Domain scores are diagnostic evidence — score tints, no level labels.
                    Legacy/malformed entries (null, strings, NaN) render as "not scored"
                    rather than indexing LEVELS with a null band. */}
                <div className="chip-wrap history__chips">
                  {Object.entries(h.scores ?? {}).map(([domainId, raw]) => {
                    const pct = Number.isFinite(raw) ? raw : null;
                    const band = pct === null ? null : domainBand(pct);
                    if (band === null) {
                      return (
                        <span key={domainId} className="score-chip score-chip--na" title={`${domainName(domainId)}: not scored`}>
                          {domainName(domainId)} · not scored
                        </span>
                      );
                    }
                    return (
                      <span
                        key={domainId}
                        className="score-chip"
                        style={{ background: LEVELS[band].tint }}
                        title={`${domainName(domainId)}: ${Math.round(pct)}%`}
                      >
                        {domainName(domainId)} · {Math.round(pct)}%
                        {pct < 40 && <strong> · Critical gap</strong>}
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
                const earned = optionPoints(q, chosenId);
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
