import { DOMAINS } from '../data/questions.js';
import { moduleForDomain } from '../data/training.js';
import { trainingByDomain } from '../lib/scoring.js';

const domainName = (id) => DOMAINS.find((d) => d.id === id)?.name ?? id;

// Preview of a single training module: the mockup lesson content plus the
// auto-assigned cohort (who needs it, and why).
export default function TrainingModule({ rows, domainId, onBack, onOpenNavigator }) {
  const mod = moduleForDomain(domainId);
  const cohort = trainingByDomain(rows).find((d) => d.domainId === domainId);

  if (!mod) {
    return (
      <section className="module">
        <button className="linkbtn" onClick={onBack}>← Back to training</button>
        <p className="readoff__empty">No training module for this domain yet.</p>
      </section>
    );
  }

  return (
    <section className="module">
      <button className="linkbtn navdetail__back" onClick={onBack}>← Back to training</button>

      <header className="module__head">
        <span className="tag tag--accent">{domainName(domainId)}</span>
        <h1 className="module__title">{mod.title}</h1>
        <p className="module__lede">{mod.blurb}</p>
        <div className="module__meta">
          <span>~{mod.estMinutes} min</span>
          <span>·</span>
          <span>{mod.lessons.length} lessons</span>
          <span className="module__preview-flag">Preview · mockup content</span>
        </div>
      </header>

      {/* ── Lessons ───────────────────────────────────────────────────── */}
      <ol className="lessons">
        {mod.lessons.map((lesson, i) => (
          <li key={i} className="card lesson">
            <div className="lesson__head">
              <span className="lesson__num">{i + 1}</span>
              <h2 className="lesson__title">{lesson.title}</h2>
            </div>
            <ul className="lesson__points">
              {lesson.points.map((p, j) => (
                <li key={j}>{p}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {/* ── Key takeaways ─────────────────────────────────────────────── */}
      <div className="card module__takeaways">
        <h2 className="overview__panel-title">Key takeaways</h2>
        <ul className="takeaways">
          {mod.keyTakeaways.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>

      {/* ── Auto-assigned cohort ──────────────────────────────────────── */}
      <div className="card module__assigned">
        <h2 className="overview__panel-title">Auto-assigned to</h2>
        <p className="readoff__sub">
          Based on this quarter&rsquo;s check — navigators weak in {domainName(domainId)}.
        </p>
        {!cohort || (cohort.required.length === 0 && cohort.stretch.length === 0) ? (
          <p className="readoff__empty">No one needs this module right now — the floor has it covered.</p>
        ) : (
          <div className="train-domain__cohorts">
            {cohort.required.length > 0 && (
              <div className="cohort">
                <span className="cohort__tag cohort__tag--req">Required ({cohort.required.length})</span>
                <span className="cohort__names">
                  {cohort.required.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ', '}
                      <button className="linkbtn" onClick={() => onOpenNavigator(n)}>{n}</button>
                    </span>
                  ))}
                </span>
              </div>
            )}
            {cohort.stretch.length > 0 && (
              <div className="cohort">
                <span className="cohort__tag cohort__tag--stretch">Stretch ({cohort.stretch.length})</span>
                <span className="cohort__names">
                  {cohort.stretch.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ', '}
                      <button className="linkbtn" onClick={() => onOpenNavigator(n)}>{n}</button>
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
