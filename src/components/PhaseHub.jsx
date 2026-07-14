import { buildPhases, PHASE_META, completedCount, nextPhase } from '../lib/phases.js';
import { departmentOverall } from '../lib/scoring.js';
import { qaSummaryLabel, qaBadgeTone } from '../lib/qaFinalReview.js';

// ─────────────────────────────────────────────────────────────────────────────
// PhaseHub — the navigator's 3-phase assessment home. Shows the fixed
// sequence MCQ → Spot the Error → Call QA Test. Only the first incomplete
// phase is startable; completed phases show a result summary and a Retake
// button; later phases are locked.
//
// Props:
//   deptName  — display name of the active department
//   done      — { mcq:boolean, spot:boolean, qa:boolean } completion map
//   results   — resultsByType from NavigatorApp ({ mcq, spot, qa } result docs)
//   latestQa  — latest QA interview for this dept ({ qa:{...}, endedAt }) or null
//   onStart   — (phaseId) => void: start/retake a phase
// ─────────────────────────────────────────────────────────────────────────────

function phaseSummary(id, results, latestQa) {
  if (id === 'qa') {
    const qa = latestQa?.qa;
    if (!qa) return null;
    // Un-reviewed attempts are AI recommendations pending supervisor review,
    // never a bare PASS/FAIL; a supervisor-reviewed attempt shows its final label.
    return {
      label: qaSummaryLabel(latestQa),
      detail: `${qa.score}/100`,
      tone: qaBadgeTone(latestQa),
    };
  }
  const scores = results?.[id]?.scores;
  const overall = scores ? departmentOverall(scores) : null;
  return overall == null ? null : { label: 'Completed', detail: `avg ${overall}%`, tone: 'pass' };
}

export default function PhaseHub({ deptName, done = {}, results, latestQa, onStart }) {
  const phases = buildPhases(done);
  const doneCount = completedCount(done);
  const allDone = doneCount === 3;
  const next = nextPhase(done);

  return (
    <section className="interview view-enter">
      <header className="overview__head">
        <div>
          <h1 className="overview__title">Your assessment — 3 phases</h1>
          <p className="overview__lede">
            The {deptName} assessment runs in three phases, in order. Complete all three to
            finish; you can retake any completed phase later.
          </p>
        </div>
      </header>

      <div className="phase-hub__progress" role="status">
        <span className="phase-hub__progress-label">
          {allDone ? 'All 3 phases complete' : `${doneCount} of 3 phases complete`}
        </span>
        <span className="phase-hub__dots" aria-hidden="true">
          {phases.map((p) => (
            <span key={p.id} className={`phase-hub__dot phase-hub__dot--${p.state}`} />
          ))}
        </span>
      </div>

      <div className="practice-choice">
        {phases.map((p) => {
          const meta = PHASE_META[p.id];
          const summary = p.state === 'done' ? phaseSummary(p.id, results, latestQa) : null;
          const clickable = p.state !== 'locked';
          return (
            <button
              key={p.id}
              type="button"
              className={`card practice-choice__card phase-card phase-card--${p.state}`}
              onClick={clickable ? () => onStart(p.id) : undefined}
              disabled={!clickable}
              aria-disabled={!clickable}
            >
              <span className="phase-card__phase">Phase {meta.num}</span>
              {p.state === 'done' && summary && (
                <span className={`phase-card__summary phase-card__summary--${summary.tone}`}>
                  ✓ {summary.label} · {summary.detail}
                </span>
              )}
              <span className="practice-choice__glyph" aria-hidden="true">{meta.glyph}</span>
              <h2 className="practice-choice__title">{meta.title}</h2>
              <p className="practice-choice__desc">{meta.desc}</p>
              {p.state === 'next' && (
                <span className="phase-card__cta">{done[p.id] ? 'Retake' : doneCount > 0 ? 'Continue →' : 'Start →'}</span>
              )}
              {p.state === 'done' && <span className="phase-card__cta phase-card__cta--ghost">Retake</span>}
              {p.state === 'locked' && (
                <span className="phase-card__lock">🔒 Complete Phase {meta.num - 1} first</span>
              )}
            </button>
          );
        })}
      </div>

      {next === 'qa' && (
        <p className="readoff__sub phase-hub__note">
          Phase 3 is a live voice call — you&rsquo;ll need a microphone (Chrome/Edge work best).
        </p>
      )}
    </section>
  );
}
