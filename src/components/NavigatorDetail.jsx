import { useState, useEffect } from 'react';
import { DOMAINS, domainName } from '../data/questions.js';
import { COMPETENCIES, competencyName } from '../data/competencies.js';
import { DEPARTMENTS, isAssessed } from '../data/departments.js';
import { LEVELS, interviewScoreColor } from '../data/config.js';
import { findRow, mentorSuggestions, trainingForRow, buildTrend, trainingImpact, buildDossier } from '../lib/scoring.js';
import { getInterviews, getResultHistory } from '../lib/db.js';
import Sparkline from './Sparkline.jsx';
import FeedbackControls from './FeedbackControls.jsx';

function formatDate(ts) {
  if (!ts) return '—';
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date((ts.seconds ?? 0) * 1000);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// completedDomains: Set<domainId> — domains where the navigator has practiced a
// "Spot the Error" scenario (supervisor view passes this from completionMap).
// completions: full completion records for training impact and evidence dossier.
// onChangeDept(deptId): optional — when provided (navigator context only), assessed dept cards
// become clickable buttons that jump straight to that dept's dashboard or check.
// dept: the active department string (needed for getResultHistory).
// answers: the navigator's raw answers map {questionId: optionId} (for dossier).
// questions: the active question bank (for dossier).
export default function NavigatorDetail({ rows, name, deptName, dept, deptMatrix, onBack, onOpenNavigator, onPreviewModule, navigatorId, completedDomains = new Set(), completions = [], onChangeDept, answers, questions, onSaveFeedback }) {
  const row = findRow(rows, name);
  const deptRow = deptMatrix?.find((r) => r.name === name);

  // Practice interview sessions — only fetched when navigatorId is provided.
  const [interviews, setInterviews] = useState(null); // null = loading
  const [expandedId, setExpandedId] = useState(null);
  // Score history for trend sparklines
  const [history, setHistory] = useState(null); // null = not loaded yet
  // Per-competency dossier expanded state
  const [expandedComp, setExpandedComp] = useState(null);

  useEffect(() => {
    if (!navigatorId) return;
    setInterviews(null);
    setExpandedId(null);
    getInterviews(navigatorId)
      .then((list) =>
        setInterviews(
          [...list].sort((a, b) => {
            const aT = a.endedAt?.seconds ?? 0;
            const bT = b.endedAt?.seconds ?? 0;
            return bT - aT; // newest first
          })
        )
      )
      .catch((err) => {
        console.error('getInterviews:', err);
        setInterviews([]);
      });
  }, [navigatorId]);

  useEffect(() => {
    if (!navigatorId) return;
    setHistory(null);
    getResultHistory(navigatorId, dept ?? 'pediatrics')
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [navigatorId, dept]);

  const toggleExpand = (id) => setExpandedId((prev) => (prev === id ? null : id));
  const toggleComp = (id) => setExpandedComp((prev) => (prev === id ? null : id));

  if (!row) {
    return (
      <section className="navdetail">
        {onBack && <button className="linkbtn" onClick={onBack}>← Back to navigators</button>}
        <p className="readoff__empty">No data for this navigator.</p>
      </section>
    );
  }

  const domainsByLevel = (lvl) => DOMAINS.filter((d) => row.levels[d.id] === lvl);
  const strengths = domainsByLevel('canTeach');
  const growth = domainsByLevel('learning');
  const canTeachCount = strengths.length;
  const mentors = mentorSuggestions(rows, name);
  const training = trainingForRow(row);

  // Ordered worst → best so the bars read as a development priority list.
  const ordered = [...DOMAINS].sort((a, b) => row.scores[a.id] - row.scores[b.id]);

  // Competency axis — only those the bank actually exercised, worst → best.
  const competencyScores = row.competencyScores ?? {};
  const competencyLevels = row.competencyLevels ?? {};
  const orderedComps = COMPETENCIES.filter((c) => typeof competencyScores[c.id] === 'number').sort(
    (a, b) => competencyScores[a.id] - competencyScores[b.id]
  );

  // Trend data (computed when history is loaded)
  const trend = history?.length ? buildTrend(history) : null;

  // Dossier (computed when answers + questions are provided)
  const dossier = answers && questions?.length ? buildDossier(row, answers, questions, interviews ?? [], completions) : null;

  return (
    <section className="navdetail stagger">
      {onBack && (
        <button className="linkbtn navdetail__back" onClick={onBack}>← Back to navigators</button>
      )}

      <header className="navdetail__head">
        <div>
          <h1 className="navdetail__title">
            {row.name}
            {row.isLive && <span className="matrix__you">you</span>}
          </h1>
          <p className="navdetail__lede">
            {deptName} · {canTeachCount > 0
              ? `can teach ${canTeachCount} of ${DOMAINS.length} domains`
              : 'building toward first Can-Teach domain'}
            {growth.length > 0 && ` · ${growth.length} growth ${growth.length === 1 ? 'area' : 'areas'}`}
          </p>
        </div>
        <div className="navdetail__ready">
          <span className="navdetail__ready-num">{canTeachCount}</span>
          <span className="navdetail__ready-label">Can-Teach domains</span>
        </div>
      </header>

      {/* ── Strength across departments ───────────────────────────────── */}
      {deptRow && (
        <div className="card navdetail__panel">
          <h2 className="overview__panel-title">Strength across departments</h2>
          <p className="readoff__sub">
            Overall level per department. The breakdown below is for <strong>{deptName}</strong> —
            switch departments up top.
          </p>
          <div className="deptstrip">
            {DEPARTMENTS.map((d) => {
              const cell = deptRow.depts[d.id];
              const isCurrent = d.name === deptName;
              const canSwitch = !isCurrent && isAssessed(d.id) && onChangeDept;
              const Tag = canSwitch ? 'button' : 'div';
              const switchProps = canSwitch
                ? { onClick: () => onChangeDept(d.id), title: `Switch to ${d.name}` }
                : {};

              if (!cell) {
                return (
                  <Tag
                    key={d.id}
                    className={`deptstrip__item${isCurrent ? ' is-current' : ''}${canSwitch ? ' is-switchable' : ''}`}
                    {...switchProps}
                  >
                    <span className="deptstrip__name">{d.name}</span>
                    <span className="deptcell deptcell--na">
                      {canSwitch ? 'Take the check →' : '— not assessed'}
                    </span>
                  </Tag>
                );
              }
              const level = LEVELS[cell.level];
              return (
                <Tag
                  key={d.id}
                  className={`deptstrip__item${isCurrent ? ' is-current' : ''}${canSwitch ? ' is-switchable' : ''}`}
                  {...switchProps}
                >
                  <span className="deptstrip__name">{d.name}</span>
                  <span className="deptcell" style={{ background: level.color, color: level.text }}>
                    {cell.overall}% <span className="deptcell__lvl">{level.label}</span>
                  </span>
                </Tag>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Strengths / growth callouts ───────────────────────────────── */}
      <div className="navdetail__callouts">
        <div className="card callout">
          <h2 className="callout__title">Strengths</h2>
          {strengths.length === 0 ? (
            <p className="readoff__empty">No Can-Teach domains yet — keep going.</p>
          ) : (
            <div className="chip-wrap">
              {strengths.map((d) => (
                <span key={d.id} className="level-chip" style={{ background: LEVELS.canTeach.color, color: LEVELS.canTeach.text }}>
                  {domainName(d.id)}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="card callout">
          <h2 className="callout__title">Growth areas</h2>
          {growth.length === 0 ? (
            <p className="readoff__empty">No Learning-level domains — solid across the board.</p>
          ) : (
            <div className="chip-wrap">
              {growth.map((d) => (
                <span key={d.id} className="level-chip" style={{ background: LEVELS.learning.color, color: LEVELS.learning.text }}>
                  {domainName(d.id)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Longitudinal trend (when history is available) ───────────── */}
      {trend && (
        <div className="card navdetail__panel">
          <h2 className="overview__panel-title">Progress over time</h2>
          <p className="readoff__sub">
            Score trajectory across checks.
            {trend.points.some((p) => p.simulated) && (
              <span className="trend__synth-note"> Illustrative leading points shown (dashed) — will be replaced by future checks.</span>
            )}
          </p>

          {/* Overall sparkline */}
          <div className="trend__overall">
            <span className="trend__label">Overall</span>
            <Sparkline values={trend.overallSeries} color="var(--accent)" height={36} />
            <span className="trend__pct">{Math.round(trend.overallSeries[trend.overallSeries.length - 1])}%</span>
          </div>

          {/* Per-domain sparklines */}
          <div className="trend__domains">
            {DOMAINS.map((d) => {
              const series = trend.domainSeries[d.id];
              if (!series) return null;
              const impact = training.find((t) => t.domainId === d.id)
                ? trainingImpact(history, completions, d.id)
                : null;
              return (
                <div key={d.id} className="trend__domain-row">
                  <span className="trend__domain-name">{domainName(d.id)}</span>
                  <Sparkline values={series} color={LEVELS[row.levels[d.id]]?.color ?? 'var(--accent)'} />
                  <span className="trend__domain-pct">{Math.round(series[series.length - 1])}%</span>
                  {impact?.delta != null && (
                    <span className={`trend__delta ${impact.delta >= 0 ? 'trend__delta--up' : 'trend__delta--down'}`}>
                      {impact.delta >= 0 ? '+' : ''}{Math.round(impact.delta)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Per-domain breakdown ──────────────────────────────────────── */}
      <div className="card navdetail__panel">
        <h2 className="overview__panel-title">Per-domain detail</h2>
        <div className="results__grid navdetail__grid">
          {ordered.map((d) => {
            const pct = row.scores[d.id];
            const level = LEVELS[row.levels[d.id]];
            return (
              <div key={d.id} className="result-card navdetail__card">
                <div className="result-card__top">
                  <span className="result-card__domain">{domainName(d.id)}</span>
                  <span className="level-chip" style={{ background: level.color, color: level.text }}>
                    {level.label}
                  </span>
                </div>
                <div className="result-card__bar">
                  <div className="result-card__bar-fill" style={{ width: `${pct}%`, background: level.color }} />
                </div>
                <div className="result-card__pct">{pct}% in this domain</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Per-competency breakdown (with dossier evidence) ─────────── */}
      {orderedComps.length > 0 && (
        <div className="card navdetail__panel">
          <h2 className="overview__panel-title">Competency breakdown</h2>
          <p className="readoff__sub">
            How {row.name} thinks, decides, and communicates — measured across every scenario, not
            tied to one topic. {dossier && 'Expand any competency to see the evidence behind the rating.'}
          </p>
          <div className="results__grid navdetail__grid">
            {orderedComps.map((c) => {
              const pct = competencyScores[c.id];
              const level = LEVELS[competencyLevels[c.id]];
              const isOpen = expandedComp === c.id;
              const evidence = dossier?.byCompetency?.find((b) => b.competencyId === c.id)?.evidence ?? [];
              return (
                <div key={c.id} className={`result-card navdetail__card ${isOpen ? 'is-open' : ''}`}>
                  <div
                    className="result-card__top"
                    style={{ cursor: dossier ? 'pointer' : 'default' }}
                    onClick={dossier ? () => toggleComp(c.id) : undefined}
                  >
                    <span className="result-card__domain">{competencyName(c.id)}</span>
                    <span className="level-chip" style={{ background: level.color, color: level.text }}>
                      {level.label}
                    </span>
                    {dossier && <span className="interview-log__toggle" aria-hidden="true">{isOpen ? '↑' : '↓'}</span>}
                  </div>
                  <div className="result-card__bar">
                    <div className="result-card__bar-fill" style={{ width: `${pct}%`, background: level.color }} />
                  </div>
                  <div className="result-card__pct">{pct}% capability</div>

                  {/* Dossier evidence panel */}
                  {isOpen && evidence.length > 0 && (
                    <div className="dossier">
                      {evidence.map((e) => (
                        <div key={e.questionId} className={`dossier__item ${e.isCorrect ? 'dossier__item--correct' : 'dossier__item--wrong'}`}>
                          <p className="dossier__scenario">{e.scenario}</p>
                          <div className="dossier__row">
                            <span className="dossier__label">Chosen:</span>
                            <span className="dossier__text">{e.chosenText}</span>
                            <span className="dossier__pts">{e.points}/100</span>
                          </div>
                          {!e.isCorrect && (
                            <div className="dossier__row dossier__row--best">
                              <span className="dossier__label">Best answer:</span>
                              <span className="dossier__text">{e.bestText}</span>
                            </div>
                          )}
                          {e.chosenRationale && (
                            <p className="dossier__rationale">{e.chosenRationale}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {isOpen && evidence.length === 0 && (
                    <p className="dossier__empty">No question-level evidence available yet.</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Auto-assigned training ────────────────────────────────────── */}
      <div className="card navdetail__panel">
        <h2 className="overview__panel-title">Assigned training</h2>
        <p className="readoff__sub">Auto-assigned from this quarter&rsquo;s results.</p>
        {training.length === 0 ? (
          <p className="readoff__empty">Nothing assigned — Can-Teach across the board.</p>
        ) : (
          <ul className="readoff__list">
            {training.map((a) => {
              const practiced = completedDomains.has(a.domainId);
              return (
                <li key={a.domainId} className="train-assign train-assign--detail">
                  <span className={`cohort__tag ${a.priority === 'Required' ? 'cohort__tag--req' : 'cohort__tag--stretch'}`}>
                    {a.priority}
                  </span>
                  <span className="train-assign__body">
                    <button className="linkbtn train-assign__title" onClick={() => onPreviewModule(a.domainId)}>
                      {a.module?.title ?? domainName(a.domainId)}
                    </button>
                    <span className="train-assign__why">
                      Assigned because {domainName(a.domainId)} is at{' '}
                      {LEVELS[a.level].label} · {a.goal}
                      {a.module && ` · ~${a.module.estMinutes} min`}
                    </span>
                  </span>
                  <div className="train-assign__right">
                    {practiced && (
                      <span className="training__practiced-badge" title="Navigator has completed a practice scenario">
                        ✓ Practiced
                      </span>
                    )}
                    <button className="btn btn--ghost btn--sm" onClick={() => onPreviewModule(a.domainId)}>
                      Preview
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Suggested mentors ─────────────────────────────────────────── */}
      {mentors.length > 0 && (
        <div className="card navdetail__panel">
          <h2 className="overview__panel-title">Suggested mentors</h2>
          <p className="readoff__sub">Colleagues who can teach {row.name}&rsquo;s growth domains.</p>
          <ul className="readoff__list">
            {mentors.map((m) => (
              <li key={m.domainId} className="readoff__row">
                <span className="tag">{domainName(m.domainId)}</span>
                <span className="readoff__people">
                  {m.mentors.map((mentorName, i) => (
                    <span key={mentorName}>
                      {i > 0 && ', '}
                      {onOpenNavigator ? (
                        <button className="linkbtn" onClick={() => onOpenNavigator(mentorName)}>
                          {mentorName}
                        </button>
                      ) : (
                        mentorName
                      )}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Practice sessions (supervisor only — requires navigatorId) ── */}
      {navigatorId && (
        <div className="card navdetail__panel">
          <h2 className="overview__panel-title">Practice sessions</h2>
          <p className="readoff__sub">
            Transcripts from {row.name}&rsquo;s roleplay practice calls.
          </p>
          {interviews === null ? (
            <div className="interview-log__loading">
              <div className="skeleton skeleton--line" style={{ width: '55%' }} />
              <div className="skeleton skeleton--line" style={{ width: '40%' }} />
            </div>
          ) : interviews.length === 0 ? (
            <p className="readoff__empty">No practice sessions recorded yet.</p>
          ) : (
            <ul className="interview-log">
              {interviews.map((session) => {
                const isOpen = expandedId === session.id;
                const navTurns = session.transcript.filter((t) => t.role === 'navigator').length;
                const g = session.grade ?? null;
                const scoreColor = g ? interviewScoreColor(g.score) : undefined;
                return (
                  <li key={session.id} className={`interview-log__item ${isOpen ? 'is-open' : ''}`}>
                    <button
                      className="interview-log__header"
                      onClick={() => toggleExpand(session.id)}
                      aria-expanded={isOpen}
                    >
                      <span className="tag">{domainName(session.domainId)}</span>
                      <span className="interview-log__caller">
                        Caller: <strong>{session.callerName}</strong>
                      </span>
                      <span className="interview-log__meta">
                        {navTurns} {navTurns === 1 ? 'response' : 'responses'} · {formatDate(session.endedAt)}
                      </span>
                      {g && (
                        <span
                          className="interview-log__score-badge"
                          style={{ color: scoreColor }}
                          title={`Score: ${g.score}/100`}
                        >
                          {g.score}/100
                        </span>
                      )}
                      <span className="interview-log__toggle" aria-hidden="true">
                        {isOpen ? '↑' : '↓'}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="interview-log__body">
                        <p className="interview-log__scenario">{session.scenario}</p>

                        {/* Grade breakdown (if available) */}
                        {g && (
                          <div className="interview-log__grade">
                            <p className="interview-log__grade-score" style={{ color: scoreColor }}>
                              Score: <strong>{g.score}/100</strong>
                            </p>
                            {g.summary && (
                              <p className="interview-log__grade-summary">{g.summary}</p>
                            )}
                            {g.strengths?.length > 0 && (
                              <div className="interview-log__grade-section">
                                <p className="interview-log__grade-heading">What went well</p>
                                <ul>
                                  {g.strengths.map((s, i) => <li key={i}>{s}</li>)}
                                </ul>
                              </div>
                            )}
                            {g.improvements?.length > 0 && (
                              <div className="interview-log__grade-section">
                                <p className="interview-log__grade-heading">Areas to develop</p>
                                <ul>
                                  {g.improvements.map((s, i) => <li key={i}>{s}</li>)}
                                </ul>
                              </div>
                            )}
                            <FeedbackControls
                              compact
                              targetType="interviewGrade"
                              targetId={session.id}
                              context={{ navigator: row.name, domainId: session.domainId, score: g.score }}
                              onSaveFeedback={onSaveFeedback}
                            />
                          </div>
                        )}

                        <div className="interview-log__chat">
                          {session.transcript.map((turn, i) => (
                            <div
                              key={i}
                              className={`interview-log__turn interview-log__turn--${turn.role}`}
                            >
                              <span className="interview-log__turn-label">
                                {turn.role === 'patient' ? session.callerName : row.name}
                              </span>
                              <p className="interview-log__turn-text">{turn.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
