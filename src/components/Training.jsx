import { domainName } from '../data/questions.js';
import { trainingByDomain, trainingPlan, trainingStats } from '../lib/scoring.js';

// completionMap: { [navigatorId]: Set<domainId> } — who has practiced which domain.
// roster: [{ id, name }] — used to look up navigatorId by name for the checkmark.
export default function Training({ rows, deptName, onOpenNavigator, onPreviewModule, completionMap = {}, roster = [] }) {
  const stats = trainingStats(rows);
  const byDomain = trainingByDomain(rows);
  const plan = trainingPlan(rows);

  // Look up a navigator's roster UUID by name so we can check their completions.
  const idByName = (name) => roster.find((m) => m.name === name)?.id;
  const hasPracticed = (name, domainId) => {
    const id = idByName(name);
    return id ? (completionMap[id]?.has(domainId) ?? false) : false;
  };

  return (
    <section className="training stagger">
      <header className="overview__head">
        <h1 className="overview__title">
          Training assignments{deptName && <span className="title-dept"> · {deptName}</span>}
        </h1>
        <p className="overview__lede">
          Auto-assigned from each navigator&rsquo;s individual <strong>domain scores</strong>, never
          from their overall status — Critical below 40%, Required 40–64%, Stretch 65–89%. A
          navigator who is Can-Teach overall still receives targeted training for a weaker domain.
        </p>
      </header>

      {/* ── KPIs ──────────────────────────────────────────────────────── */}
      <div className="kpis">
        <div className={`card kpi ${stats.totalCritical > 0 ? 'kpi--critical' : ''}`}>
          <span className="kpi__value">{stats.totalCritical}</span>
          <span className="kpi__label">critical assignments</span>
          <span className="kpi__sub">domain scores below 40%</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value">{stats.totalRequired}</span>
          <span className="kpi__label">required assignments</span>
          <span className="kpi__sub">domain scores below 65% (includes critical)</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value">{stats.navigatorsWithRequired}</span>
          <span className="kpi__label">navigators with required training</span>
          <span className="kpi__sub">of {rows.length} assessed</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value">{stats.totalStretch}</span>
          <span className="kpi__label">stretch assignments</span>
          <span className="kpi__sub">domain scores 65–89%</span>
        </div>
      </div>

      {/* ── By domain (cohort view) ───────────────────────────────────── */}
      <div className="card overview__panel">
        <h2 className="overview__panel-title">By domain — run one session per cohort</h2>
        <div className="train-domains">
          {byDomain.map((d) => (
            <div key={d.domainId} className="train-domain">
              <div className="train-domain__head">
                <span className="tag tag--accent">{domainName(d.domainId)}</span>
                {d.module && (
                  <span className="train-domain__meta">
                    {d.module.title} · ~{d.module.estMinutes} min
                  </span>
                )}
                <button className="btn btn--ghost btn--sm train-domain__preview" onClick={() => onPreviewModule(d.domainId)}>
                  Preview module
                </button>
              </div>
              {d.module?.blurb && <p className="train-domain__blurb">{d.module.blurb}</p>}
              <div className="train-domain__cohorts">
                {d.critical.length > 0 && (
                  <div className="cohort">
                    <span className="cohort__tag cohort__tag--critical">Critical ({d.critical.length})</span>
                    <span className="cohort__names">
                      {d.critical.map((n, i) => (
                        <span key={n}>
                          {i > 0 && ', '}
                          <button className="linkbtn" onClick={() => onOpenNavigator(n)}>{n}</button>
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {d.required.length > 0 && (
                  <div className="cohort">
                    <span className="cohort__tag cohort__tag--req">Required ({d.required.length})</span>
                    <span className="cohort__names">
                      {d.required.map((n, i) => (
                        <span key={n}>
                          {i > 0 && ', '}
                          <button className="linkbtn" onClick={() => onOpenNavigator(n)}>{n}</button>
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {d.stretch.length > 0 && (
                  <div className="cohort">
                    <span className="cohort__tag cohort__tag--stretch">Stretch ({d.stretch.length})</span>
                    <span className="cohort__names">
                      {d.stretch.map((n, i) => (
                        <span key={n}>
                          {i > 0 && ', '}
                          <button className="linkbtn" onClick={() => onOpenNavigator(n)}>{n}</button>
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── By navigator ──────────────────────────────────────────────── */}
      <div className="card overview__panel">
        <h2 className="overview__panel-title">By navigator</h2>
        <div className="train-people">
          {plan.map((p) => (
            <div key={p.name} className="train-person">
              <div className="train-person__head">
                <button className="linkbtn train-person__name" onClick={() => onOpenNavigator(p.name)}>
                  {p.name}
                  {p.isLive && <span className="matrix__you">you</span>}
                </button>
                <span className="train-person__count">
                  {p.assignments.length === 0
                    ? 'No training assigned'
                    : [
                        p.criticalCount > 0 && `${p.criticalCount} critical`,
                        `${p.requiredCount} required`,
                        `${p.stretchCount} stretch`,
                      ].filter(Boolean).join(' · ')}
                </span>
              </div>
              {p.assignments.length > 0 && (
                <ul className="train-person__list">
                  {p.assignments.map((a) => {
                    const practiced = hasPracticed(p.name, a.domainId);
                    return (
                      <li key={a.domainId} className="train-assign">
                        <span className={`cohort__tag ${
                          a.priority === 'Critical'
                            ? 'cohort__tag--critical'
                            : a.priority === 'Required'
                              ? 'cohort__tag--req'
                              : 'cohort__tag--stretch'
                        }`}>
                          {a.priority}
                        </span>
                        <button className="linkbtn train-assign__title" onClick={() => onPreviewModule(a.domainId)}>
                          {a.module?.title ?? domainName(a.domainId)}
                        </button>
                        <span className="train-assign__goal">{a.goal}</span>
                        {practiced && (
                          <span className="training__practiced-badge" title="Navigator has completed a practice scenario">
                            ✓ Practiced
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
