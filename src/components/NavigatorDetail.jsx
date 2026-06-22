import { DOMAINS } from '../data/questions.js';
import { LEVELS } from '../data/config.js';
import { findRow, mentorSuggestions, trainingForRow } from '../lib/scoring.js';

const domainName = (id) => DOMAINS.find((d) => d.id === id)?.name ?? id;

export default function NavigatorDetail({ rows, name, onBack, onOpenNavigator, onPreviewModule }) {
  const row = findRow(rows, name);

  if (!row) {
    return (
      <section className="navdetail">
        <button className="linkbtn" onClick={onBack}>← Back to navigators</button>
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

  return (
    <section className="navdetail">
      <button className="linkbtn navdetail__back" onClick={onBack}>← Back to navigators</button>

      <header className="navdetail__head">
        <div>
          <h1 className="navdetail__title">
            {row.name}
            {row.isLive && <span className="matrix__you">you</span>}
          </h1>
          <p className="navdetail__lede">
            Development dashboard · {canTeachCount > 0
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

      {/* ── Auto-assigned training ────────────────────────────────────── */}
      <div className="card navdetail__panel">
        <h2 className="overview__panel-title">Assigned training</h2>
        <p className="readoff__sub">Auto-assigned from this quarter&rsquo;s results.</p>
        {training.length === 0 ? (
          <p className="readoff__empty">Nothing assigned — Can-Teach across the board.</p>
        ) : (
          <ul className="readoff__list">
            {training.map((a) => (
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
                <button className="btn btn--ghost btn--sm" onClick={() => onPreviewModule(a.domainId)}>
                  Preview
                </button>
              </li>
            ))}
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
                  {m.mentors.map((name, i) => (
                    <span key={name}>
                      {i > 0 && ', '}
                      <button className="linkbtn" onClick={() => onOpenNavigator(name)}>{name}</button>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
