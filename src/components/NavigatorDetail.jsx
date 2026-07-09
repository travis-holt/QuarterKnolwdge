import { useState, useEffect } from 'react';
import { DOMAINS, domainName } from '../data/questions.js';
import { COMPETENCIES, competencyName } from '../data/competencies.js';
import { DEPARTMENTS, isAssessed } from '../data/departments.js';
import { LEVELS, interviewScoreColor } from '../data/config.js';
import { findRow, mentorSuggestions, trainingForRow, buildTrend, trainingImpact, buildDossier } from '../lib/scoring.js';
import { getInterviews, getResultHistory, updateInterviewGradeOverride, updateQaFinalReview } from '../lib/db.js';
import { qaFinalReviewLabel, qaFinalVerdict } from '../lib/qaFinalReview.js';
import Sparkline from './Sparkline.jsx';
import FeedbackControls from './FeedbackControls.jsx';

function formatWorkflow(type) {
  return String(type ?? '')
    .split('_')
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

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
  // Supervisor grade-override inline form state (keyed by interview id)
  const [overrideId, setOverrideId] = useState(null);
  const [overrideScore, setOverrideScore] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideError, setOverrideError] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [qaReviewEditId, setQaReviewEditId] = useState(null);
  const [qaReviewAction, setQaReviewAction] = useState('');
  const [qaReviewReason, setQaReviewReason] = useState('');
  const [qaReviewError, setQaReviewError] = useState('');
  const [qaReviewSaving, setQaReviewSaving] = useState(false);

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

  const openOverride = (session) => {
    setOverrideId(session.id);
    setOverrideScore(String(session.gradeOverride?.score ?? session.grade?.score ?? ''));
    setOverrideReason(session.gradeOverride?.reason ?? '');
    setOverrideError('');
  };
  const cancelOverride = () => {
    setOverrideId(null);
    setOverrideError('');
    setOverrideSaving(false);
  };
  const openQaReviewEdit = (session) => {
    setQaReviewEditId(session.id);
    setQaReviewAction('');
    setQaReviewReason(session.qaFinalReview?.reason ?? '');
    setQaReviewError('');
    setQaReviewSaving(false);
  };
  const cancelQaReviewEdit = () => {
    setQaReviewEditId(null);
    setQaReviewAction('');
    setQaReviewReason('');
    setQaReviewError('');
    setQaReviewSaving(false);
  };
  const applyLocalQaReview = (sessionId, status, reason) => {
    setInterviews((prev) =>
      (prev ?? []).map((s) =>
        s.id === sessionId
          ? {
              ...s,
              qaFinalReview: {
                status,
                finalPass: status.endsWith('_pass'),
                reason,
                reviewedBy: 'supervisor',
                reviewedAt: { seconds: Math.floor(Date.now() / 1000) },
              },
            }
          : s
      )
    );
  };
  const submitQaReview = async (session, status, reason = '') => {
    const trimmedReason = reason.trim();
    if (status.startsWith('overridden_') && !trimmedReason) {
      setQaReviewError('A short reason is required for overrides.');
      return;
    }
    setQaReviewSaving(true);
    setQaReviewError('');
    try {
      await updateQaFinalReview(session.id, { status, reason: trimmedReason });
      applyLocalQaReview(session.id, status, trimmedReason);
      cancelQaReviewEdit();
    } catch (err) {
      console.error('updateQaFinalReview:', err);
      setQaReviewError('Could not save the final review. Try again.');
      setQaReviewSaving(false);
    }
  };
  const saveOverride = async (session) => {
    const reason = overrideReason.trim();
    const score = Number(overrideScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setOverrideError('Enter a score between 0 and 100.');
      return;
    }
    if (!reason) {
      setOverrideError('A short reason is required.');
      return;
    }
    const rounded = Math.round(score);
    setOverrideSaving(true);
    setOverrideError('');
    try {
      await updateInterviewGradeOverride(session.id, { score: rounded, reason });
      // Reflect the override locally so it shows immediately (no re-fetch).
      setInterviews((prev) =>
        (prev ?? []).map((s) =>
          s.id === session.id
            ? { ...s, gradeOverride: { score: rounded, reason, overriddenBy: 'supervisor', overriddenAt: { seconds: Math.floor(Date.now() / 1000) } } }
            : s
        )
      );
      cancelOverride();
    } catch (err) {
      console.error('updateInterviewGradeOverride:', err);
      setOverrideError('Could not save the override. Try again.');
      setOverrideSaving(false);
    }
  };

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
                const override = session.gradeOverride ?? null;
                const qaVerdict = session.qa ? qaFinalVerdict(session) : null;
                const aiNeedsReview = session.qa?.review?.recommendation === 'needs_review';
                const aiPass = qaVerdict?.aiPass === true;
                const aiFail = qaVerdict?.aiPass === false;
                const effectiveScore = override ? override.score : g?.score;
                const scoreColor = g ? interviewScoreColor(effectiveScore) : undefined;
                const isEditing = overrideId === session.id;
                const isQaReviewEditing = qaReviewEditId === session.id;
                const qaReviewed = Boolean(session.qaFinalReview);
                return (
                  <li key={session.id} className={`interview-log__item ${isOpen ? 'is-open' : ''}`}>
                    <button
                      className="interview-log__header"
                      onClick={() => toggleExpand(session.id)}
                      aria-expanded={isOpen}
                    >
                      <span className="tag">{domainName(session.domainId)}</span>
                      {session.qa && (
                        <span className={`qa-log-badge ${session.qa.review?.recommendation === 'needs_review' ? 'qa-log-badge--review' : session.qa.pass ? 'qa-log-badge--pass' : 'qa-log-badge--fail'}`}>
                          QA TEST · {session.qa.review?.recommendation === 'needs_review' ? 'NEEDS REVIEW' : session.qa.pass ? 'PASS' : 'FAIL'}
                        </span>
                      )}
                      {session.qaArchived && (
                        <span className="tag">Archived / reset</span>
                      )}
                      {session.workflowType && <span className="tag">{formatWorkflow(session.workflowType)}</span>}
                      {session.difficulty && <span className="tag">{session.difficulty}</span>}
                      {session.qaScenarioId && <span className="tag">{session.qaScenarioId}</span>}
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
                          title={override ? `Supervisor override: ${override.score}/100 (original AI ${g.score}/100)` : `Score: ${g.score}/100`}
                        >
                          {effectiveScore}/100{override && <span className="interview-log__override-flag"> ✎</span>}
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
                              Score: <strong>{effectiveScore}/100</strong>
                            </p>
                            {override && (
                              <div className="grade-override__badge">
                                <span className="grade-override__tag">Supervisor override</span>
                                <span className="grade-override__original">Original AI score: {g.score}/100</span>
                                <span className="grade-override__reason">Reason: {override.reason}</span>
                              </div>
                            )}
                            {isEditing ? (
                              <div className="grade-override__form">
                                <label className="grade-override__field">
                                  <span>Override score (0–100)</span>
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={overrideScore}
                                    onChange={(e) => setOverrideScore(e.target.value)}
                                    aria-label="Override score"
                                  />
                                </label>
                                <label className="grade-override__field">
                                  <span>Reason (required)</span>
                                  <textarea
                                    rows="2"
                                    value={overrideReason}
                                    onChange={(e) => setOverrideReason(e.target.value)}
                                    aria-label="Override reason"
                                  />
                                </label>
                                {overrideError && <p className="grade-override__error">{overrideError}</p>}
                                <div className="grade-override__actions">
                                  <button
                                    className="btn btn--sm"
                                    onClick={() => saveOverride(session)}
                                    disabled={overrideSaving}
                                  >
                                    {overrideSaving ? 'Saving…' : 'Save'}
                                  </button>
                                  <button className="linkbtn" onClick={cancelOverride} disabled={overrideSaving}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button className="linkbtn grade-override__open" onClick={() => openOverride(session)}>
                                {override ? 'Adjust override' : 'Override score'}
                              </button>
                            )}
                            {g.summary && (
                              <p className="interview-log__grade-summary">{g.summary}</p>
                            )}
                            {session.qa?.review?.reviewFlags?.length > 0 && (
                              <div className="interview-log__grade-section interview-log__grade-section--flags">
                                <p className="interview-log__grade-heading">
                                  Supervisor review flags · confidence: {session.qa.review.confidence} · safety risk: {session.qa.review.safetyRisk}
                                </p>
                                <ul>
                                  {session.qa.review.reviewFlags.map((f) => (
                                    <li key={f.id}><strong>{f.label}:</strong> {f.detail}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {session.qa && (
                              <div className="qa-final-review">
                                <div className="qa-final-review__row">
                                  <span className="qa-final-review__label">AI verdict:</span>
                                  <strong>{session.qa.review?.recommendation === 'needs_review' ? 'NEEDS REVIEW' : qaVerdict.aiPass ? 'PASS' : 'FAIL'}</strong>
                                </div>
                                <div className="qa-final-review__row">
                                  <span className="qa-final-review__label">Final verdict:</span>
                                  <strong>{qaFinalReviewLabel(session)}</strong>
                                </div>
                                {qaReviewed && !isQaReviewEditing && (
                                  <div className="qa-final-review__meta">
                                    <span>
                                      Reviewed by {session.qaFinalReview.reviewedBy ?? 'supervisor'} on {formatDate(session.qaFinalReview.reviewedAt)}
                                    </span>
                                    {session.qaFinalReview.reason && (
                                      <span>Reason: {session.qaFinalReview.reason}</span>
                                    )}
                                  </div>
                                )}
                                {(!qaReviewed || isQaReviewEditing) ? (
                                  <div className="qa-final-review__actions">
                                    {!aiNeedsReview && aiPass && (
                                      <button
                                        className="btn btn--ghost btn--sm"
                                        onClick={() => submitQaReview(session, 'confirmed_pass')}
                                        disabled={qaReviewSaving}
                                        type="button"
                                      >
                                        Confirm Pass
                                      </button>
                                    )}
                                    {!aiNeedsReview && aiFail && (
                                      <button
                                        className="btn btn--ghost btn--sm"
                                        onClick={() => submitQaReview(session, 'confirmed_fail')}
                                        disabled={qaReviewSaving}
                                        type="button"
                                      >
                                        Confirm Fail
                                      </button>
                                    )}
                                    {(!aiPass || aiNeedsReview) && (
                                      <button
                                        className={`btn btn--ghost btn--sm${qaReviewAction === 'overridden_pass' ? ' is-active' : ''}`}
                                        onClick={() => {
                                          setQaReviewEditId(session.id);
                                          setQaReviewAction('overridden_pass');
                                          setQaReviewError('');
                                        }}
                                        disabled={qaReviewSaving}
                                        type="button"
                                      >
                                        Override to Pass
                                      </button>
                                    )}
                                    {(aiPass || aiNeedsReview) && (
                                      <button
                                        className={`btn btn--ghost btn--sm${qaReviewAction === 'overridden_fail' ? ' is-active' : ''}`}
                                        onClick={() => {
                                          setQaReviewEditId(session.id);
                                          setQaReviewAction('overridden_fail');
                                          setQaReviewError('');
                                        }}
                                        disabled={qaReviewSaving}
                                        type="button"
                                      >
                                        Override to Fail
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <button className="linkbtn qa-final-review__edit" onClick={() => openQaReviewEdit(session)} type="button">
                                    Edit final review
                                  </button>
                                )}
                                {qaReviewAction.startsWith('overridden_') && isQaReviewEditing && (
                                  <div className="qa-final-review__form">
                                    <label className="grade-override__field">
                                      <span>Override reason (required)</span>
                                      <textarea
                                        rows="2"
                                        value={qaReviewReason}
                                        onChange={(e) => setQaReviewReason(e.target.value)}
                                        aria-label="QA final review reason"
                                      />
                                    </label>
                                    {qaReviewError && <p className="grade-override__error">{qaReviewError}</p>}
                                    <div className="grade-override__actions">
                                      <button
                                        className="btn btn--sm"
                                        onClick={() => submitQaReview(session, qaReviewAction, qaReviewReason)}
                                        disabled={qaReviewSaving}
                                        type="button"
                                      >
                                        {qaReviewSaving ? 'Saving…' : 'Save final review'}
                                      </button>
                                      <button className="linkbtn" onClick={cancelQaReviewEdit} disabled={qaReviewSaving} type="button">
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {qaReviewError && !(qaReviewAction.startsWith('overridden_') && isQaReviewEditing) && (
                                  <p className="grade-override__error">{qaReviewError}</p>
                                )}
                              </div>
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
