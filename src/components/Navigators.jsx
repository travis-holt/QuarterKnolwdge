import { DOMAINS } from '../data/questions.js';
import { LEVELS, LEVEL_ORDER } from '../data/config.js';

// A compact level summary (counts per level) for a navigator card.
function levelCounts(row) {
  const counts = { learning: 0, solid: 0, canTeach: 0 };
  for (const d of DOMAINS) counts[row.levels[d.id]] += 1;
  return counts;
}

export default function Navigators({ rows, onOpenNavigator }) {
  return (
    <section className="navigators">
      <header className="overview__head">
        <h1 className="overview__title">Navigators</h1>
        <p className="overview__lede">
          Select anyone to open their development dashboard.
        </p>
      </header>

      <div className="nav-grid">
        {rows.map((row) => {
          const counts = levelCounts(row);
          return (
            <button
              key={row.name}
              className="card nav-card"
              onClick={() => onOpenNavigator(row.name)}
            >
              <div className="nav-card__top">
                <span className="nav-card__name">
                  {row.name}
                  {row.isLive && <span className="matrix__you">you</span>}
                </span>
                <span className="nav-card__ready">{counts.canTeach} Can-Teach</span>
              </div>

              {/* mini level strip across all domains */}
              <div className="nav-card__strip" aria-hidden="true">
                {DOMAINS.map((d) => (
                  <span
                    key={d.id}
                    className="nav-card__cell"
                    title={`${d.name}: ${LEVELS[row.levels[d.id]].label}`}
                    style={{ background: LEVELS[row.levels[d.id]].color }}
                  />
                ))}
              </div>

              <div className="nav-card__counts">
                {LEVEL_ORDER.map((lvl) => (
                  <span key={lvl} className="nav-card__count">
                    <span
                      className="legend-swatch"
                      style={{ background: LEVELS[lvl].color }}
                    />
                    {counts[lvl]} {LEVELS[lvl].label}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
