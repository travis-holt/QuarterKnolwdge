import { DOMAINS } from '../data/questions.js';
import { LEVELS, LEVEL_ORDER } from '../data/config.js';
import {
  floorStats,
  domainDistribution,
  columnGaps,
  canTeachRoster,
  readinessTally,
} from '../lib/scoring.js';

const domainName = (id) => DOMAINS.find((d) => d.id === id)?.name ?? id;

export default function Overview({ rows, onOpenNavigator, onViewMatrix }) {
  const stats = floorStats(rows);
  const dist = domainDistribution(rows);
  const gaps = columnGaps(rows);
  const roster = canTeachRoster(rows);
  const readiness = readinessTally(rows);

  // Strength domains: most Can-Teach coverage, highest first.
  const strengths = [...dist]
    .sort((a, b) => b.canTeach - a.canTeach)
    .filter((d) => d.canTeach > 0)
    .slice(0, 3);

  return (
    <section className="overview">
      <header className="overview__head">
        <h1 className="overview__title">Team overview</h1>
        <p className="overview__lede">
          The state of the floor this quarter — capability depth, where the gaps are, and who&rsquo;s
          ready to mentor. A development snapshot, not a ranking.
        </p>
      </header>

      {/* ── Headline KPIs ─────────────────────────────────────────────── */}
      <div className="kpis">
        <div className="card kpi">
          <span className="kpi__value">{stats.solidPlusRate}%</span>
          <span className="kpi__label">of the floor is Solid or above</span>
          <span className="kpi__sub">across all domains assessed</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value">
            {stats.coveredDomains}<span className="kpi__of">/{stats.totalDomains}</span>
          </span>
          <span className="kpi__label">domains have a teacher</span>
          <span className="kpi__sub">at least one Can-Teach navigator</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value">{stats.avgReadiness.toFixed(1)}</span>
          <span className="kpi__label">avg Can-Teach domains / navigator</span>
          <span className="kpi__sub">team readiness depth</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value">{stats.assessed}</span>
          <span className="kpi__label">navigators assessed</span>
          <span className="kpi__sub">this quarter</span>
        </div>
      </div>

      {/* ── Domain capability distribution ────────────────────────────── */}
      <div className="card overview__panel">
        <div className="overview__panel-head">
          <h2 className="overview__panel-title">Capability by domain</h2>
          <button className="linkbtn" onClick={onViewMatrix}>
            Open the full matrix →
          </button>
        </div>
        <div className="dist">
          {dist.map((d) => (
            <div key={d.domainId} className="dist__row">
              <span className="dist__name">{domainName(d.domainId)}</span>
              <div className="dist__bar" title={`${d.learning} Learning · ${d.solid} Solid · ${d.canTeach} Can-Teach`}>
                {LEVEL_ORDER.map((lvl) => {
                  const count = d[lvl];
                  if (!count) return null;
                  return (
                    <span
                      key={lvl}
                      className="dist__seg"
                      style={{
                        width: `${(count / d.total) * 100}%`,
                        background: LEVELS[lvl].color,
                        color: LEVELS[lvl].text,
                      }}
                    >
                      {count}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="matrix__legend overview__legend">
          {LEVEL_ORDER.map((id) => (
            <span key={id} className="legend-item">
              <span className="legend-swatch" style={{ background: LEVELS[id].color }} />
              {LEVELS[id].label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Priorities / strengths / readiness ────────────────────────── */}
      <div className="overview__cols">
        <div className="card overview__col">
          <h2 className="readoff__title">Training priorities</h2>
          <p className="readoff__sub">Domains where most navigators are still Learning.</p>
          {gaps.length === 0 ? (
            <p className="readoff__empty">No floor-wide gaps right now.</p>
          ) : (
            <ul className="readoff__list">
              {gaps.map((g) => (
                <li key={g.domainId} className="readoff__row">
                  <span className="tag tag--accent">{domainName(g.domainId)}</span>
                  <span className="readoff__count">{g.learningCount}/{g.total} Learning</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card overview__col">
          <h2 className="readoff__title">Floor strengths</h2>
          <p className="readoff__sub">Best-covered domains, with their teachers.</p>
          {strengths.length === 0 ? (
            <p className="readoff__empty">No Can-Teach coverage yet.</p>
          ) : (
            <ul className="readoff__list">
              {strengths.map((d) => (
                <li key={d.domainId} className="readoff__row readoff__row--col">
                  <span className="tag">{domainName(d.domainId)}</span>
                  <span className="readoff__people">{roster[d.domainId].join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card overview__col">
          <h2 className="readoff__title">Ready for more</h2>
          <p className="readoff__sub">Navigators by Can-Teach depth.</p>
          <ul className="readoff__list">
            {readiness.slice(0, 5).map((r) => (
              <li key={r.name} className="readoff__row">
                <button className="linkbtn readiness__name" onClick={() => onOpenNavigator(r.name)}>
                  {r.name}
                  {r.isLive && <span className="matrix__you">you</span>}
                </button>
                <span className="readoff__count">{r.canTeachCount} Can-Teach</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
