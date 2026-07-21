import { DOMAINS, domainName } from '../data/questions.js';
import { LEVELS, LEVEL_ORDER } from '../data/config.js';
import { columnGaps, domainMentorRoster, readinessTally } from '../lib/scoring.js';
import { OverallBadge, DomainScore } from './OverallStatus.jsx';
import Reveal from './Reveal.jsx';

export default function Matrix({ rows, deptName, onTakeCheck, onOpenNavigator }) {
  const hasLive = rows.some((r) => r.isLive);
  const gaps = columnGaps(rows);
  const roster = domainMentorRoster(rows);
  const readiness = readinessTally(rows);
  const gapDomainIds = new Set(gaps.map((g) => g.domainId));

  return (
    <section className="matrix-view view-enter">
      <header className="matrix-view__head">
        <h1 className="matrix-view__title">
          Capability matrix{deptName && <span className="title-dept"> · {deptName}</span>}
        </h1>
        <p className="matrix-view__lede">
          Overall status is calculated from the average across all six domains. Domain columns show
          the diagnostic scores behind that status. This is a development map, not a scoreboard.
        </p>
        <p className="matrix-view__hint">
          {onTakeCheck && !hasLive && (
            <>
              Tip:{' '}
              <button className="linkbtn" onClick={onTakeCheck}>
                take the check
              </button>{' '}
              and your result appears here as a new row.{' '}
            </>
          )}
          Select any navigator to open their dashboard.
        </p>
      </header>

      {/* ── The hero grid ─────────────────────────────────────────────── */}
      <div className="card matrix-card">
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th className="matrix__corner">Navigator</th>
                <th className="matrix__colhead matrix__colhead--overall" title="Official status — the average across all six domains">
                  Overall
                </th>
                {DOMAINS.map((d) => (
                  <th
                    key={d.id}
                    className={`matrix__colhead ${gapDomainIds.has(d.id) ? 'is-gap' : ''}`}
                    title={d.blurb}
                  >
                    {d.name}
                    {gapDomainIds.has(d.id) && <span className="matrix__gap-dot" title="Floor-wide gap">●</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className={row.isLive ? 'is-live' : ''}>
                  <th className="matrix__rowhead">
                    <button className="matrix__rowbtn" onClick={() => onOpenNavigator(row.name)}>
                      {row.name}
                      {row.isLive && <span className="matrix__you">you</span>}
                    </button>
                  </th>
                  <td className="matrix__cell matrix__cell--overall">
                    <OverallBadge row={row} />
                  </td>
                  {DOMAINS.map((d) => (
                    <td key={d.id} className="matrix__cell">
                      <DomainScore
                        score={row.scores?.[d.id]}
                        band={row.domainDevelopmentBands[d.id]}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="matrix__legend">
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
        <p className="matrix__legend-note">
          These four levels are the official <strong>Overall</strong> status. Domain columns use the
          same score ranges as a lighter diagnostic tint — a domain score is evidence behind the
          status, not a status of its own.
        </p>
      </div>

      {/* ── The "so what" read-offs ───────────────────────────────────── */}
      <div className="readoffs">
        {/* Column gaps */}
        <Reveal className="card readoff">
          <h2 className="readoff__title">Column gaps</h2>
          <p className="readoff__sub">Domains where most navigators score below 65% — floor-wide training priorities.</p>
          {gaps.length === 0 ? (
            <p className="readoff__empty">No floor-wide gaps right now.</p>
          ) : (
            <ul className="readoff__list">
              {gaps.map((g) => (
                <li key={g.domainId} className="readoff__row">
                  <span className="tag tag--accent">{domainName(g.domainId)}</span>
                  <span className="readoff__count">
                    {g.belowSolidCount} of {g.total} below 65%
                    {g.criticalCount > 0 && (
                      <span className="readoff__critical"> · {g.criticalCount} critical</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Reveal>

        {/* Domain mentor roster */}
        <Reveal className="card readoff" delay={80}>
          <h2 className="readoff__title">Domain mentors</h2>
          <p className="readoff__sub">
            Who is qualified to mentor each domain — Can-Teach overall <em>and</em> at least 90% in
            that domain.
          </p>
          <ul className="readoff__list">
            {DOMAINS.map((d) => (
              <li key={d.id} className="readoff__row readoff__row--col">
                <span className="tag">{d.name}</span>
                <span className="readoff__people">
                  {roster[d.id].length > 0 ? roster[d.id].join(', ') : <em>— no one yet</em>}
                </span>
              </li>
            ))}
          </ul>
        </Reveal>

        {/* Readiness tally */}
        <Reveal className="card readoff" delay={160}>
          <h2 className="readoff__title">Readiness signal</h2>
          <p className="readoff__sub">
            Navigators ranked by official overall status — a data-backed &ldquo;who&rsquo;s ready for
            more.&rdquo;
          </p>
          <ul className="readoff__list">
            {readiness.map((r) => (
              <li key={r.name} className={`readoff__row readiness ${r.isLive ? 'is-live' : ''}`}>
                <span className="readiness__name">
                  {r.name}
                  {r.isLive && <span className="matrix__you">you</span>}
                </span>
                <span className="readiness__bar">
                  <span
                    className="readiness__bar-fill"
                    style={{
                      width: `${r.overallScore ?? 0}%`,
                      background: r.overallLevel ? LEVELS[r.overallLevel].color : undefined,
                    }}
                  />
                </span>
                <span className="readiness__count">
                  {/* A dash alone would merge Incomplete into Not assessed. */}
                  {r.overallScore == null
                    ? (r.assessedDomains > 0
                        ? `${r.overallLabel} · ${r.assessedDomains}/${r.totalDomains}`
                        : r.overallLabel)
                    : `${r.overallScore}% · ${r.overallLabel}`}
                </span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
