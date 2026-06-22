import { DOMAINS } from '../data/questions.js';
import { LEVELS, LEVEL_ORDER } from '../data/config.js';
import { columnGaps, canTeachRoster, readinessTally } from '../lib/scoring.js';

const domainName = (id) => DOMAINS.find((d) => d.id === id)?.name ?? id;

export default function Matrix({ rows, deptName, onTakeCheck, onOpenNavigator }) {
  const hasLive = rows.some((r) => r.isLive);
  const gaps = columnGaps(rows);
  const roster = canTeachRoster(rows);
  const readiness = readinessTally(rows);
  const gapDomainIds = new Set(gaps.map((g) => g.domainId));

  return (
    <section className="matrix-view">
      <header className="matrix-view__head">
        <h1 className="matrix-view__title">
          Capability matrix{deptName && <span className="title-dept"> · {deptName}</span>}
        </h1>
        <p className="matrix-view__lede">
          Each navigator across every domain — colour shows the level. This is a development
          map, not a scoreboard.
        </p>
        <p className="matrix-view__hint">
          {!hasLive && (
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
                  {DOMAINS.map((d) => {
                    const level = LEVELS[row.levels[d.id]];
                    return (
                      <td key={d.id} className="matrix__cell">
                        <span
                          className="matrix__pill"
                          style={{ background: level.color, color: level.text }}
                        >
                          {level.label}
                        </span>
                      </td>
                    );
                  })}
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
            </span>
          ))}
        </div>
      </div>

      {/* ── The "so what" read-offs ───────────────────────────────────── */}
      <div className="readoffs">
        {/* Column gaps */}
        <div className="card readoff">
          <h2 className="readoff__title">Column gaps</h2>
          <p className="readoff__sub">Domains where most navigators are still Learning — floor-wide training priorities.</p>
          {gaps.length === 0 ? (
            <p className="readoff__empty">No floor-wide gaps right now.</p>
          ) : (
            <ul className="readoff__list">
              {gaps.map((g) => (
                <li key={g.domainId} className="readoff__row">
                  <span className="tag tag--accent">{domainName(g.domainId)}</span>
                  <span className="readoff__count">
                    {g.learningCount} of {g.total} Learning
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Can-Teach roster */}
        <div className="card readoff">
          <h2 className="readoff__title">Can-Teach roster</h2>
          <p className="readoff__sub">Who can mentor in each domain.</p>
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
        </div>

        {/* Readiness tally */}
        <div className="card readoff">
          <h2 className="readoff__title">Readiness signal</h2>
          <p className="readoff__sub">Can-Teach domains per navigator — a data-backed &ldquo;who&rsquo;s ready for more.&rdquo;</p>
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
                    style={{ width: `${(r.canTeachCount / DOMAINS.length) * 100}%` }}
                  />
                </span>
                <span className="readiness__count">{r.canTeachCount}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
