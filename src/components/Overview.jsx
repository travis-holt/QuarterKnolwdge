import { DOMAINS, domainName } from '../data/questions.js';
import { COMPETENCIES, competencyName } from '../data/competencies.js';
import { DEPARTMENTS } from '../data/departments.js';
import { LEVELS, LEVEL_ORDER } from '../data/config.js';
import {
  floorStats,
  domainDistribution,
  competencyDistribution,
  columnGaps,
  canTeachRoster,
  readinessTally,
  teamTrend,
} from '../lib/scoring.js';
import CountUp from './CountUp.jsx';
import Sparkline from './Sparkline.jsx';

// teamHistory: flat array of resultHistory docs (all navigators, all times).
export default function Overview({ rows, deptName, deptMatrix, onOpenNavigator, onViewMatrix, teamHistory = [] }) {
  const floorTrend = teamHistory.length ? teamTrend(teamHistory) : [];
  const stats = floorStats(rows);
  const dist = domainDistribution(rows);
  const compDist = competencyDistribution(rows);
  const gaps = columnGaps(rows);
  const roster = canTeachRoster(rows);
  const readiness = readinessTally(rows);

  // Strength domains: most Can-Teach coverage, highest first.
  const strengths = [...dist]
    .sort((a, b) => b.canTeach - a.canTeach)
    .filter((d) => d.canTeach > 0)
    .slice(0, 3);

  return (
    <section className="overview stagger">
      <header className="overview__head">
        <h1 className="overview__title">Team overview</h1>
        <p className="overview__lede">
          The state of the floor this quarter — capability depth, where the gaps are, and who&rsquo;s
          ready to mentor. A development snapshot, not a ranking.
        </p>
      </header>

      {/* ── Strength by department (cross-department) ──────────────────── */}
      <div className="card overview__panel">
        <h2 className="overview__panel-title">Strength by department</h2>
        <p className="readoff__sub">
          Each navigator&rsquo;s overall level per department (average across domains).
          The metrics below this drill into <strong>{deptName}</strong> — switch departments up top.
        </p>
        <div className="matrix-scroll">
          <table className="matrix deptmatrix">
            <thead>
              <tr>
                <th className="matrix__corner">Navigator</th>
                {DEPARTMENTS.map((d) => (
                  <th key={d.id} className="matrix__colhead">{d.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deptMatrix.map((row) => (
                <tr key={row.name} className={row.isLive ? 'is-live' : ''}>
                  <th className="matrix__rowhead">
                    <button className="matrix__rowbtn" onClick={() => onOpenNavigator(row.name)}>
                      {row.name}
                      {row.isLive && <span className="matrix__you">you</span>}
                    </button>
                  </th>
                  {DEPARTMENTS.map((d) => {
                    const cell = row.depts[d.id];
                    if (!cell) {
                      return <td key={d.id} className="matrix__cell"><span className="deptcell deptcell--na">—</span></td>;
                    }
                    const level = LEVELS[cell.level];
                    return (
                      <td key={d.id} className="matrix__cell">
                        <span className="deptcell" style={{ background: level.color, color: level.text }}>
                          {cell.overall}%
                          <span className="deptcell__lvl">{level.label}</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="matrix__legend overview__legend">
          {LEVEL_ORDER.map((id) => (
            <span key={id} className="legend-item">
              <span className="legend-swatch" style={{ background: LEVELS[id].color }} />
              {LEVELS[id].label}
            </span>
          ))}
          <span className="legend-item"><span className="legend-swatch legend-swatch--na" />Not assessed</span>
        </div>
      </div>

      {/* ── Headline KPIs ─────────────────────────────────────────────── */}
      <div className="kpis">
        <div className="card kpi">
          <span className="kpi__value"><CountUp value={stats.solidPlusRate} suffix="%" /></span>
          <span className="kpi__label">of the floor is Solid or above</span>
          <span className="kpi__sub">across all domains assessed</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value">
            <CountUp value={stats.coveredDomains} /><span className="kpi__of">/{stats.totalDomains}</span>
          </span>
          <span className="kpi__label">domains have a teacher</span>
          <span className="kpi__sub">at least one Can-Teach navigator</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value"><CountUp value={stats.avgReadiness} decimals={1} /></span>
          <span className="kpi__label">avg Can-Teach domains / navigator</span>
          <span className="kpi__sub">team readiness depth</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value"><CountUp value={stats.assessed} /></span>
          <span className="kpi__label">navigators assessed</span>
          <span className="kpi__sub">this quarter</span>
        </div>
      </div>

      {/* ── Floor trend (when history is available) ───────────────────── */}
      {floorTrend.length > 1 && (
        <div className="card overview__panel">
          <h2 className="overview__panel-title">Floor trend over time</h2>
          <p className="readoff__sub">
            Solid-or-above rate and average readiness across all navigators, per check cycle.
          </p>
          <div className="trend__overall">
            <span className="trend__label">Solid+ rate</span>
            <Sparkline values={floorTrend.map((t) => t.solidPlusRate)} color="var(--accent)" height={36} />
            <span className="trend__pct">{Math.round(floorTrend[floorTrend.length - 1].solidPlusRate)}%</span>
          </div>
          <div className="trend__overall" style={{ marginTop: '0.5rem' }}>
            <span className="trend__label">Avg readiness</span>
            <Sparkline values={floorTrend.map((t) => t.avgReadiness)} color="var(--level-canteach)" height={36} />
            <span className="trend__pct">{floorTrend[floorTrend.length - 1].avgReadiness.toFixed(1)}</span>
          </div>
          <div className="trend__tick-row">
            {floorTrend.map((t) => (
              <span key={t.ts} className="trend__tick">{t.label}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── Domain capability distribution ────────────────────────────── */}
      <div className="card overview__panel">
        <div className="overview__panel-head">
          <h2 className="overview__panel-title">Capability by domain · {deptName}</h2>
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

      {/* ── Competency capability distribution (capability axis) ──────── */}
      {compDist.length > 0 && (
        <div className="card overview__panel">
          <h2 className="overview__panel-title">Capability by competency</h2>
          <p className="readoff__sub">
            The how-they-work axis — critical thinking, communication, escalation and more — across
            every navigator assessed, independent of department.
          </p>
          <div className="dist">
            {compDist.map((c) => (
              <div key={c.competencyId} className="dist__row">
                <span className="dist__name">{competencyName(c.competencyId)}</span>
                <div className="dist__bar" title={`${c.learning} Learning · ${c.solid} Solid · ${c.canTeach} Can-Teach`}>
                  {LEVEL_ORDER.map((lvl) => {
                    const count = c[lvl];
                    if (!count) return null;
                    return (
                      <span
                        key={lvl}
                        className="dist__seg"
                        style={{
                          width: `${(count / c.total) * 100}%`,
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
      )}

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
