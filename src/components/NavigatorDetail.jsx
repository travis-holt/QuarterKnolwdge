import { useState, useEffect } from 'react';
import { DOMAINS, domainName } from '../data/questions.js';
import { COMPETENCIES, competencyName } from '../data/competencies.js';
import { DEPARTMENTS, departmentName, isAssessed } from '../data/departments.js';
import { LEVELS, THRESHOLDS, interviewScoreColor } from '../data/config.js';
import { findRow, mentorSuggestions, trainingForRow, trainingEmptyStateReason, buildTrend, trainingImpact, buildDossier } from '../lib/scoring.js';
import { OverallBadge, DomainScore } from './OverallStatus.jsx';
import { formatPercent, formatSeriesCurrent, isMeasured } from '../lib/formatScore.js';
import { getInterviews, getResultHistory, updateInterviewGradeOverride, updateQaFinalReview } from '../lib/db.js';
import { qaFinalReviewLabel, qaFinalVerdict, qaHistoryBadgeLabel, qaBadgeTone } from '../lib/qaFinalReview.js';
import { resolveQaScoringState } from '../lib/qaDomainScoring.js';
import { compareTimestampValues, timestampMillis } from '../lib/time.js';
import Sparkline from './Sparkline.jsx';
import FeedbackControls from './FeedbackControls.jsx';
import { contentVersionStatus } from '../lib/contentVersion.js';

function formatWorkflow(type) {
  return String(type ?? '')
    .split('_')
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

function formatDate(ts) {
  if (!ts) return '—';
  const date = new Date(timestampMillis(ts));
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function qaSignalLabel(detail) {
  if (!detail || typeof detail.score !== 'number') return '—';
  // A verified auto-fail zeroes the domain/competency — surface it explicitly so a
  // supervisor can never read an affected tag as a clean score. QA-only signal.
  if (detail.autoFailed) return `${detail.score} · Auto-fail`;
  return `${detail.score}`;
}

// completedDomains: Set<domainId> — domains where the navigator has practiced a
// "Spot the Error" scenario (supervisor view passes this from completionMap).
// completions: full completion records for training impact and evidence dossier.
// onChangeDept(deptId): optional — when provided (navigator context only), assessed dept cards
// become clickable buttons that jump straight to that dept's dashboard or check.
// dept: the active department string (needed for getResultHistory).
// answers: the navigator's raw answers map {questionId: optionId} (for dossier).
// questions: the active question bank (for dossier).
export default function NavigatorDetail({ rows, name, deptName, dept, deptMatrix, onBack, onOpenNavigator, onPreviewModule, navigatorId, completedDomains = new Set(), completions = [], onChangeDept, answers, questions, onSaveFeedback, contentVersionContext }) {
  const row = (navigatorId ? findRow(rows, navigatorId) : null) ?? findRow(rows, name);
  const deptRow = deptMatrix?.find((r) => navigatorId && r.navigatorId === navigatorId)
    ?? deptMatrix?.find((r) => r.name === name);

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
            return compareTimestampValues(b.endedAt, a.endedAt); // newest first
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

  // Sections derive from RAW DOMAIN SCORES, not from official level labels.
  // A domain with no recorded score is excluded from every section — missing
  // evidence is never a strength, a focus area, or a critical gap.
  const hasScore = (d) => Number.isFinite(row.scores?.[d.id]);
  const scoreOfDomain = (d) => row.scores[d.id];
  const scoredDomains = DOMAINS.filter(hasScore);
  const strongest = scoredDomains
    .filter((d) => scoreOfDomain(d) >= THRESHOLDS.canTeach)
    .sort((a, b) => scoreOfDomain(b) - scoreOfDomain(a));
  const criticalGaps = scoredDomains
    .filter((d) => scoreOfDomain(d) < THRESHOLDS.critical)
    .sort((a, b) => scoreOfDomain(a) - scoreOfDomain(b));
  const priorityFocus = scoredDomains
    .filter((d) => scoreOfDomain(d) >= THRESHOLDS.critical && scoreOfDomain(d) < THRESHOLDS.solid)
    .sort((a, b) => scoreOfDomain(a) - scoreOfDomain(b));
  const mentors = mentorSuggestions(rows, name);
  const training = trainingForRow(row);
  const trainingReason = trainingEmptyStateReason(row, training);

  // Ordered worst → best so the bars read as a development priority list.
  // Unscored domains sort last rather than producing a NaN comparison.
  const ordered = [...DOMAINS].sort((a, b) => {
    const sa = hasScore(a) ? row.scores[a.id] : Infinity;
    const sb = hasScore(b) ? row.scores[b.id] : Infinity;
    return sa - sb;
  });

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
            {deptName} · official status from the average across all six domains
            {criticalGaps.length > 0 && (
              <span className="navdetail__critical-note">
                {' '}· {criticalGaps.length} critical domain {criticalGaps.length === 1 ? 'gap' : 'gaps'}
              </span>
            )}
          </p>
        </div>
        <div className="navdetail__ready">
          <OverallBadge row={row} size="lg" />
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
              // An INCOMPLETE department cell has overall/level null, so it goes
              // through OverallBadge (which renders "Incomplete" + a tooltip)
              // rather than indexing LEVELS with a null id.
              return (
                <Tag
                  key={d.id}
                  className={`deptstrip__item${isCurrent ? ' is-current' : ''}${canSwitch ? ' is-switchable' : ''}`}
                  {...switchProps}
                >
                  <span className="deptstrip__name">{d.name}</span>
                  <OverallBadge
                    score={cell.overall}
                    level={cell.level}
                    label={cell.label}
                    complete={cell.complete}
                    assessedDomains={cell.assessedDomains}
                    totalDomains={cell.totalDomains}
                    size="sm"
                  />
                </Tag>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Strengths / growth callouts ───────────────────────────────── */}
      <div className="navdetail__callouts">
        <div className="card callout">
          <h2 className="callout__title">Strongest domains</h2>
          {strongest.length === 0 ? (
            <p className="readoff__empty">No domain is at 90% or above yet — keep going.</p>
          ) : (
            <div className="chip-wrap">
              {strongest.map((d) => (
                <span key={d.id} className="score-chip" style={{ background: LEVELS.canTeach.tint }}>
                  {domainName(d.id)} <strong>{scoreOfDomain(d)}%</strong>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="card callout">
          <h2 className="callout__title">Priority focus areas</h2>
          {priorityFocus.length === 0 ? (
            <p className="readoff__empty">No domain is between 40% and 64%.</p>
          ) : (
            <div className="chip-wrap">
              {priorityFocus.map((d) => (
                <span key={d.id} className="score-chip" style={{ background: LEVELS.learning.tint }}>
                  {domainName(d.id)} <strong>{scoreOfDomain(d)}%</strong>
                </span>
              ))}
            </div>
          )}
        </div>
        {criticalGaps.length > 0 && (
          <div className="card callout callout--critical">
            <h2 className="callout__title">Critical domain gaps</h2>
            <p className="readoff__sub">
              Below 40% — required training, highest urgency, regardless of the overall status above.
            </p>
            <div className="chip-wrap">
              {criticalGaps.map((d) => (
                <span key={d.id} className="score-chip score-chip--critical" style={{ background: LEVELS.critical.tint }}>
                  {domainName(d.id)} <strong>{scoreOfDomain(d)}%</strong> · Critical gap
                </span>
              ))}
            </div>
          </div>
        )}
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

          {/* Overall sparkline. The label reports the LATEST SNAPSHOT: if the
              most recent check measured nothing it reads N/A, because showing an
              older number would imply that stale result is current.
              The "last measured" caption reads `latestRealOverall` — derived from
              REAL, non-simulated snapshots only. Reading it off the flattened
              series would let an illustrative synthetic point be captioned as a
              measurement the navigator never earned. */}
          <div className="trend__overall">
            <span className="trend__label">Overall</span>
            <Sparkline values={trend.overallSeries} color="var(--accent)" height={36} />
            <span className="trend__pct">{formatSeriesCurrent(trend.overallSeries)}</span>
            {!isMeasured(trend.overallSeries[trend.overallSeries.length - 1])
              && isMeasured(trend.latestRealOverall) && (
              <span className="trend__stale-note">
                last measured {formatPercent(trend.latestRealOverall)}
              </span>
            )}
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
                  <Sparkline values={series} color={LEVELS[row.domainDevelopmentBands[d.id]]?.color ?? 'var(--accent)'} />
                  {/* N/A when the latest snapshot did not measure this domain —
                      never Math.round(null), which silently becomes 0%. */}
                  <span className="trend__domain-pct">{formatSeriesCurrent(series)}</span>
                  {/* Same provenance rule as the overall caption: real,
                      non-simulated history only. */}
                  {!isMeasured(series[series.length - 1])
                    && isMeasured(trend.latestRealDomainValues?.[d.id]) && (
                    <span className="trend__stale-note">
                      last measured {formatPercent(trend.latestRealDomainValues[d.id])}
                    </span>
                  )}
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
        <p className="readoff__sub">
          Diagnostic evidence behind the overall status. These are scores, not separate official
          classifications — only the Overall badge above carries an official level.
        </p>
        <div className="results__grid navdetail__grid">
          {ordered.map((d) => {
            const pct = row.scores?.[d.id];
            const band = row.domainDevelopmentBands[d.id];
            // A domain that was never scored renders as an explicit "Not scored"
            // — never 0%, never a band tint, never a Critical gap.
            if (band == null) {
              return (
                <div key={d.id} className="result-card navdetail__card result-card--unassessed">
                  <div className="result-card__top">
                    <span className="result-card__domain">{domainName(d.id)}</span>
                    <span className="score-chip score-chip--na">Not scored</span>
                  </div>
                  <div className="result-card__bar" />
                  <div className="result-card__pct">No result recorded for this domain</div>
                </div>
              );
            }
            const descriptor = LEVELS[band];
            // Neutral diagnostic wording — never an official level name.
            const note = band === 'critical'
              ? 'Critical gap'
              : band === 'learning'
                ? 'Focus area'
                : band === 'solid'
                  ? 'Developing'
                  : 'Strong score';
            return (
              <div key={d.id} className={`result-card navdetail__card ${band === 'critical' ? 'result-card--critical' : ''}`}>
                <div className="result-card__top">
                  <span className="result-card__domain">{domainName(d.id)}</span>
                  <span className="score-chip" style={{ background: descriptor.tint }}>
                    {pct}% · {note}
                  </span>
                </div>
                <div className="result-card__bar">
                  <div className="result-card__bar-fill" style={{ width: `${pct}%`, background: descriptor.color }} />
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
          // Empty != mastered: unscored domains produce no assignment either.
          <p className="readoff__empty">
            {trainingReason === 'unassessed'
              ? 'No assessment results are available yet for this department.'
              : trainingReason === 'incomplete'
                ? `Training cannot be finalized until the remaining domains are assessed (${row.assessedDomains} of ${DOMAINS.length} scored).`
                : 'Nothing assigned — every domain is at 90% or above.'}
          </p>
        ) : (
          <ul className="readoff__list">
            {training.map((a) => {
              const practiced = completedDomains.has(a.domainId);
              const tagClass = a.priority === 'Critical'
                ? 'cohort__tag--critical'
                : a.priority === 'Required'
                  ? 'cohort__tag--req'
                  : 'cohort__tag--stretch';
              return (
                <li key={a.domainId} className="train-assign train-assign--detail">
                  <span className={`cohort__tag ${tagClass}`}>{a.priority}</span>
                  <span className="train-assign__body">
                    <button className="linkbtn train-assign__title" onClick={() => onPreviewModule(a.domainId)}>
                      {a.module?.title ?? domainName(a.domainId)}
                    </button>
                    <span className="train-assign__why">
                      {a.isCritical
                        ? `Immediate focus because ${domainName(a.domainId)} scored ${a.score}%`
                        : `Assigned because ${domainName(a.domainId)} scored ${a.score}%`}
                      {' · '}{a.goal}
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
          <p className="readoff__sub">
            Colleagues qualified to mentor {row.name}&rsquo;s weaker domains — Can-Teach overall and
            at least 90% in that domain.
          </p>
          <ul className="readoff__list">
            {mentors.map((m) => (
              <li key={m.domainId} className="readoff__row">
                <span className="tag">
                  {domainName(m.domainId)} · {m.score}%
                  {m.isCriticalGap && <span className="readoff__critical"> Critical gap</span>}
                </span>
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
              {interviews.map((session, sessionIndex) => {
                const isOpen = expandedId === session.id;
                const navTurns = session.transcript.filter((t) => t.role === 'navigator').length;
                const g = session.grade ?? null;
                const override = session.gradeOverride ?? null;
                const qaVerdict = session.qa ? qaFinalVerdict(session) : null;
                // AI-verdict gates for the supervisor final-review actions: a supervisor may
                // confirm the AI verdict OR override to the opposite, never both confirms and
                // never a confirm on a NEEDS REVIEW session (override-only, reason required).
                const aiNeedsReview = session.qa?.review?.recommendation === 'needs_review';
                const aiPass = qaVerdict?.aiPass === true;
                const aiFail = qaVerdict?.aiPass === false;
                const effectiveScore = override ? override.score : g?.score;
                const scoreColor = g ? interviewScoreColor(effectiveScore) : undefined;
                const isEditing = overrideId === session.id;
                const isQaReviewEditing = qaReviewEditId === session.id;
                const qaReviewed = Boolean(session.qaFinalReview);
                // Resolve rubric interpretability at RENDER time from the attempt's
                // own grading metadata. Never trust a stored `scoringUnavailable`
                // boolean: it reflects whatever build graded the attempt, so a
                // record written by a future/unknown rubric would carry stale
                // domain scores and no flag, and the projection would render.
                const qaScoringState = resolveQaScoringState(session.qa);
                const versionStatus = session.assessmentType === 'call-qa' && contentVersionContext
                  ? contentVersionStatus(session, contentVersionContext)
                  : null;
                return (
                  <li key={session.id ?? `${session.domainId ?? 'session'}-${timestampMillis(session.endedAt)}-${sessionIndex}`} className={`interview-log__item ${isOpen ? 'is-open' : ''}`}>
                    <button
                      className="interview-log__header"
                      onClick={() => toggleExpand(session.id)}
                      aria-expanded={isOpen}
                    >
                      <span className="tag">{domainName(session.domainId)}</span>
                      {session.qa && (
                        <span className={`qa-log-badge qa-log-badge--${qaBadgeTone(session)}`}>
                          {qaHistoryBadgeLabel(session)}
                        </span>
                      )}
                      {session.qaArchived && (
                        <span className="tag">Archived / reset</span>
                      )}
                      {session.workflowType && <span className="tag">{formatWorkflow(session.workflowType)}</span>}
                      {session.difficulty && <span className="tag">{session.difficulty}</span>}
                      {session.qaScenarioId && <span className="tag">{session.qaScenarioId}</span>}
                      {versionStatus && (
                        <span className="tag" title={versionStatus.stale ? 'This Call QA attempt remains historical evidence and requires review against the current rules.' : 'Content source/version status'}>
                          {versionStatus.label}
                        </span>
                      )}
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

                        {/* Transcript provenance (PR 2): server authority vs legacy browser capture */}
                        {(session.assessmentType === 'call-qa' || session.captureAuthority || session.qa?.transcriptMetadata) && (
                          <div className="interview-log__provenance">
                            {(session.captureAuthority === 'server' || session.qa?.transcriptMetadata?.authority === 'server') ? (
                              <>
                                <p>Transcript source: <strong>Server-captured live transcript</strong></p>
                                <p>
                                  Capture status:{' '}
                                  <strong>
                                    {(session.qa?.transcriptMetadata?.captureComplete === false || session.captureStatus === 'capture_incomplete')
                                      ? 'Incomplete'
                                      : 'Complete'}
                                  </strong>
                                  {session.qa?.transcriptMetadata?.captureVersion && <> · Capture version: {session.qa.transcriptMetadata.captureVersion}</>}
                                </p>
                                {session.qa?.transcriptMetadata?.captureComplete === false && (
                                  <p className="interview-log__provenance-warn">
                                    ⚠ The call server could not confirm a clean end of the transcript — this result requires supervisor review.
                                  </p>
                                )}
                              </>
                            ) : (
                              <p>Transcript source: <strong>Legacy browser-captured transcript</strong></p>
                            )}
                            {/* Which department rubric actually graded this
                                attempt. Read straight from the stored grading
                                metadata so a historical result is never
                                relabelled under a newer rubric. */}
                            {session.qa?.gradingMetadata?.rubricVersion && (
                              <p>
                                Graded with:{' '}
                                <strong>
                                  {session.qa.gradingMetadata.rubricDepartment
                                    ? `${departmentName(session.qa.gradingMetadata.rubricDepartment)} rubric`
                                    : 'shared rubric'}
                                </strong>
                                {' '}({session.qa.gradingMetadata.rubricVersion})
                              </p>
                            )}
                          </div>
                        )}

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
                                  {session.qa.review.reviewFlags.map((f, flagIndex) => (
                                    <li key={f.id ?? `${f.label ?? 'flag'}-${flagIndex}`}><strong>{f.label}:</strong> {f.detail}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {session.qa?.repairs?.length > 0 && (
                              <div className="interview-log__grade-section">
                                <p className="interview-log__grade-heading">Fairness guardrails applied</p>
                                <p>These deterministic checks corrected likely false-negative rubric verdicts before scoring. The grader&rsquo;s original output is preserved below each repair.</p>
                                <ul>{session.qa.repairs.map((repair, index) => (
                                  <li key={`${repair.criterionId}-${index}`} className="qa-repair">
                                    <strong>Criterion:</strong> {repair.criterionId} · <strong>Rule:</strong> {repair.rule}
                                    <div className="qa-repair__replacement">
                                      <strong>Replacement reason:</strong> {repair.reason} · <strong>Replacement evidence:</strong> &ldquo;{repair.evidence}&rdquo;
                                    </div>
                                    <details className="qa-repair__original">
                                      <summary>Original AI grader output</summary>
                                      <div><strong>Original AI verdict:</strong> {repair.originalVerdict ?? repair.from ?? 'NOT_MET'}</div>
                                      <div><strong>Original AI reason:</strong> {repair.originalNote?.trim() ? repair.originalNote : 'No reason supplied'}</div>
                                      <div><strong>Original AI evidence:</strong> {repair.originalEvidence?.trim() ? <>&ldquo;{repair.originalEvidence}&rdquo;</> : 'No evidence supplied'}</div>
                                    </details>
                                  </li>
                                ))}</ul>
                              </div>
                            )}
                            {session.qa?.deterministicFindings?.length > 0 && (
                              <div className="interview-log__grade-section interview-log__grade-section--flags">
                                <p className="interview-log__grade-heading">Deterministic grading conflicts</p>
                                <p>Deterministic checks disagreed with the AI grader&rsquo;s positive verdicts. These findings never change the score; they require supervisor review.</p>
                                <ul>{session.qa.deterministicFindings.map((finding, index) => (
                                  <li key={`${finding.id}-${index}`}>
                                    <strong>Type:</strong> {finding.type} · <strong>Reason:</strong> {finding.reason}
                                    {finding.destinationId && <> · <strong>Routing destination:</strong> {finding.destinationId}</>}
                                    {finding.affectedCriteria?.length > 0 && <> · <strong>Affected criteria:</strong> {finding.affectedCriteria.join(', ')}</>}
                                    {finding.evidence && <div><strong>Evidence:</strong> &ldquo;{finding.evidence}&rdquo;</div>}
                                  </li>
                                ))}</ul>
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
                            {/* An attempt graded under a rubric version this build no
                                longer recognises cannot be projected. Say so plainly
                                rather than reinterpreting it under a current rubric —
                                that would show scores the navigator never received.

                                Interpretability is RESOLVED HERE, from the attempt's own
                                grading metadata. The stored `scoringUnavailable` flag is
                                deliberately not consulted: it was written by whichever
                                build graded the attempt, so a record produced by a future
                                rubric carries stale `domainScores` and no flag at all. */}
                            {qaScoringState.scoringUnavailable ? (
                              <div className="interview-log__grade-section">
                                <p className="interview-log__grade-heading">QA-only domain signal</p>
                                <p className="interview-log__provenance-warn">
                                  Unavailable — this attempt was graded with rubric version{' '}
                                  <strong>{qaScoringState.recordedRubricVersion ?? 'unknown'}</strong>, which this
                                  version of the app cannot interpret. The recorded score and criteria above are
                                  unchanged; only the per-domain projection is withheld.
                                </p>
                              </div>
                            ) : session.qa?.domainScores && (
                              <div className="interview-log__grade-section">
                                <p className="interview-log__grade-heading">QA-only domain signal</p>
                                <ul>
                                  {DOMAINS.map((domain) => (
                                    <li key={domain.id}>
                                      <strong>{domainName(domain.id)}:</strong> {qaSignalLabel(session.qa.domainScores[domain.id])}
                                    </li>
                                  ))}
                                </ul>
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
