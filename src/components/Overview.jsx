import { DOMAINS, domainName } from '../data/questions.js';
import { COMPETENCIES, competencyName } from '../data/competencies.js';
import { DEPARTMENTS } from '../data/departments.js';
import { LEVELS, LEVEL_ORDER } from '../data/config.js';
import {
  floorStats,
  domainDistribution,
  competencyDistribution,
  columnGaps,
  domainMentorRoster,
  readinessTally,
  teamTrend,
} from '../lib/scoring.js';
import { OverallBadge } from './OverallStatus.jsx';
import CountUp from './CountUp.jsx';
import Sparkline from './Sparkline.jsx';

// teamHistory: flat array of resultHistory docs (all navigators, all times).
export default function Overview({ rows, deptName, deptMatrix, onOpenNavigator, onViewMatrix, teamHistory = [] }) {
  const floorTrend = teamHistory.length ? teamTrend(teamHistory) : [];
  const stats = floorStats(rows);
  const dist = domainDistribution(rows);
  const compDist = competencyDistribution(rows);
  const gaps = columnGaps(rows);
  const roster = domainMentorRoster(rows);
  const readiness = readinessTally(rows);

  // Strength domains: highest average score first (diagnostic, not a status).
  const strengths = [...dist]
    .sort((a, b) => b.avgScore - a.avgScore)
    .filter((d) => roster[d.domainId].length > 0)
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
          Each navigator&rsquo;s one official status per department — the average across all six
          domains. The metrics below drill into <strong>{deptName}</strong> — switch departments up top.
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
                    return (
                      <td key={d.id} className="matrix__cell">
                        <OverallBadge
                          score={cell.overall}
                          level={cell.level}
                          label={cell.label}
                          complete={cell.complete}
                          size="sm"
                        />
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

      {/* ── Headline KPIs — navigator-level, based on official overall status ── */}
      <div className="kpis">
        <div className="card kpi">
          <span className="kpi__value"><CountUp value={stats.solidPlusRate} suffix="%" /></span>
          <span className="kpi__label">of navigators are Solid or above</span>
          <span className="kpi__sub">official overall status</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value"><CountUp value={stats.canTeachCount} /></span>
          <span className="kpi__label">navigators Can-Teach overall</span>
          <span className="kpi__sub">90%+ average across six domains</span>
        </div>
        <div className={`card kpi ${stats.criticalCount > 0 ? 'kpi--critical' : ''}`}>
          <span className="kpi__value"><CountUp value={stats.criticalCount} /></span>
          <span className="kpi__label">navigators Critical overall</span>
          <span className="kpi__sub">
            {stats.criticalCount > 0
              ? 'immediate supervisor attention recommended'
              : 'no navigator is below 40% overall'}
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi__value"><CountUp value={stats.avgOverallScore} suffix="%" /></span>
          <span className="kpi__label">average overall score</span>
          <span className="kpi__sub">across {stats.assessed} navigator{stats.assessed === 1 ? '' : 's'} assessed</span>
        </div>
      </div>

      {/* ── Official overall-status distribution ──────────────────────── */}
      <div className="card overview__panel">
        <h2 className="overview__panel-title">Overall status distribution · {deptName}</h2>
        <p className="readoff__sub">
          One official status per navigator, from the average across all six domains.
        </p>
        <ul className="statusdist">
          {LEVEL_ORDER.map((id) => (
            <li key={id} className="statusdist__row">
              <span className="statusdist__swatch" style={{ background: LEVELS[id].color }} />
              <span className="statusdist__label">{LEVELS[id].label}</span>
              <span className="statusdist__count">{stats.distribution[id]}</span>
            </li>
          ))}
          {stats.distribution.incomplete > 0 && (
            <li className="statusdist__row statusdist__row--note">
              <span className="statusdist__label">Incomplete profiles</span>
              <span className="statusdist__count">{stats.distribution.incomplete}</span>
            </li>
          )}
        </ul>
      </div>

      {/* ── Floor trend (when history is available) ───────────────────── */}
      {floorTrend.length > 1 && (
        <div className="card overview__panel">
          <h2 className="overview__panel-title">Floor trend over time</h2>
          <p className="readoff__sub">
            Average overall score and the Solid-or-above rate across all navigators, per check
            cycle — both measured on each navigator&rsquo;s official overall status.
          </p>
          <div className="trend__overall">
            <span className="trend__label">Avg overall</span>
            <Sparkline values={floorTrend.map((t) => t.avgOverallScore)} color="var(--accent)" height={36} />
            <span className="trend__pct">{Math.round(floorTrend[floorTrend.length - 1].avgOverallScore)}%</span>
          </div>
          <div className="trend__overall" style={{ marginTop: '0.5rem' }}>
            <span className="trend__label">Solid+ rate</span>
            <Sparkline values={floorTrend.map((t) => t.solidPlusRate)} color="var(--level-canteach)" height={36} />
            <span className="trend__pct">{Math.round(floorTrend[floorTrend.length - 1].solidPlusRate)}%</span>
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
          <h2 className="overview__panel-title">Domain score distribution · {deptName}</h2>
          <button className="linkbtn" onClick={onViewMatrix}>
            Open the full matrix →
          </button>
        </div>
        <p className="readoff__sub">
          Diagnostic score ranges per domain — how many navigators fall in each band, their average
          score, and how many need training. These are scores, not official navigator statuses.
        </p>
        <div className="dist">
          {dist.map((d) => (
            <div key={d.domainId} className="dist__row">
              <span className="dist__name">{domainName(d.domainId)}</span>
              <div
                className="dist__bar"
                title={`${d.critical} below 40% · ${d.learning} 40–64% · ${d.solid} 65–89% · ${d.canTeach} 90%+`}
              >
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
              <span className="dist__meta">
                avg {d.avgScore}%
                {d.belowCritical > 0 && (
                  <span className="readoff__critical"> · {d.belowCritical} below 40%</span>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="matrix__legend overview__legend">
          {LEVEL_ORDER.map((id) => (
            <span key={id} className="legend-item">
              <span className="legend-swatch" style={{ background: LEVELS[id].color }} />
              {LEVELS[id].label}
              <span className="legend-range">
                {id === 'critical' && '0–39%'}
                {id === 'learning' && '40–64%'}
                {id === 'solid' && '65–89%'}
                {id === 'canTeach' && '90–100%'}
              </span>
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
          <p className="readoff__sub">Domains where most navigators score below 65%.</p>
          {gaps.length === 0 ? (
            <p className="readoff__empty">No floor-wide gaps right now.</p>
          ) : (
            <ul className="readoff__list">
              {gaps.map((g) => (
                <li key={g.domainId} className="readoff__row">
                  <span className="tag tag--accent">{domainName(g.domainId)}</span>
                  <span className="readoff__count">
                    {g.belowSolidCount}/{g.total} below 65%
                    {g.criticalCount > 0 && (
                      <span className="readoff__critical"> · {g.criticalCount} critical</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card overview__col">
          <h2 className="readoff__title">Floor strengths</h2>
          <p className="readoff__sub">Highest-scoring domains, with their qualified mentors.</p>
          {strengths.length === 0 ? (
            <p className="readoff__empty">No qualified domain mentors yet.</p>
          ) : (
            <ul className="readoff__list">
              {strengths.map((d) => (
                <li key={d.domainId} className="readoff__row readoff__row--col">
                  <span className="tag">{domainName(d.domainId)} · avg {d.avgScore}%</span>
                  <span className="readoff__people">{roster[d.domainId].join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card overview__col">
          <h2 className="readoff__title">Ready for more</h2>
          <p className="readoff__sub">Navigators by official overall status.</p>
          <ul className="readoff__list">
            {readiness.slice(0, 5).map((r) => (
              <li key={r.name} className="readoff__row">
                <button className="linkbtn readiness__name" onClick={() => onOpenNavigator(r.name)}>
                  {r.name}
                  {r.isLive && <span className="matrix__you">you</span>}
                </button>
                <span className="readoff__count">
                  {r.overallScore == null ? 'Not assessed' : `${r.overallScore}% overall · ${r.overallLabel}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
