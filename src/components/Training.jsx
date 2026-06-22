import { DOMAINS } from '../data/questions.js';
import { trainingByDomain, trainingPlan, trainingStats } from '../lib/scoring.js';

const domainName = (id) => DOMAINS.find((d) => d.id === id)?.name ?? id;

export default function Training({ rows, onOpenNavigator }) {
  const stats = trainingStats(rows);
  const byDomain = trainingByDomain(rows);
  const plan = trainingPlan(rows);

  return (
    <section className="training">
      <header className="overview__head">
        <h1 className="overview__title">Training assignments</h1>
        <p className="overview__lede">
          Auto-assigned from each navigator&rsquo;s check results — Required where they&rsquo;re at
          Learning, Stretch where they&rsquo;re Solid and climbing toward Can-Teach. Course content
          is placeholder for now and plugs in later.
        </p>
      </header>

      {/* ── KPIs ──────────────────────────────────────────────────────── */}
      <div className="kpis">
        <div className="card kpi">
          <span className="kpi__value">{stats.totalRequired}</span>
          <span className="kpi__label">required assignments</span>
          <span className="kpi__sub">navigators at Learning level</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value">{stats.navigatorsWithRequired}</span>
          <span className="kpi__label">navigators with required training</span>
          <span className="kpi__sub">of {rows.length} assessed</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value">{stats.domainsNeedingTraining}</span>
          <span className="kpi__label">domains needing a session</span>
          <span className="kpi__sub">at least one Required learner</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value">{stats.totalStretch}</span>
          <span className="kpi__label">stretch assignments</span>
          <span className="kpi__sub">Solid → Can-Teach growth</span>
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
              </div>
              {d.module?.blurb && <p className="train-domain__blurb">{d.module.blurb}</p>}
              <div className="train-domain__cohorts">
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
                    : `${p.requiredCount} required · ${p.assignments.length - p.requiredCount} stretch`}
                </span>
              </div>
              {p.assignments.length > 0 && (
                <ul className="train-person__list">
                  {p.assignments.map((a) => (
                    <li key={a.domainId} className="train-assign">
                      <span className={`cohort__tag ${a.priority === 'Required' ? 'cohort__tag--req' : 'cohort__tag--stretch'}`}>
                        {a.priority}
                      </span>
                      <span className="train-assign__title">{a.module?.title ?? domainName(a.domainId)}</span>
                      <span className="train-assign__goal">{a.goal}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
