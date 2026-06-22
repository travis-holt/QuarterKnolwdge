import { DOMAINS } from '../data/questions.js';
import { LEVELS } from '../data/config.js';
import { scoreToLevel } from '../lib/scoring.js';

export default function Results({ result, onViewMatrix, onViewDashboard, onRetake }) {
  const { name, scores } = result;
  const canTeachCount = DOMAINS.filter(
    (d) => scoreToLevel(scores[d.id]) === 'canTeach'
  ).length;

  return (
    <section className="results">
      <header className="results__head">
        <h1 className="results__title">{name}&rsquo;s results</h1>
        <p className="results__lede">
          Here&rsquo;s where you landed in each domain. There&rsquo;s no overall grade — each
          domain stands on its own. {canTeachCount > 0
            ? `You can already teach ${canTeachCount} of ${DOMAINS.length} domains.`
            : 'Every domain is a place to grow into.'}
        </p>
      </header>

      <div className="results__grid">
        {DOMAINS.map((d) => {
          const pct = scores[d.id];
          const level = LEVELS[scoreToLevel(pct)];
          return (
            <div key={d.id} className="card result-card">
              <div className="result-card__top">
                <span className="result-card__domain">{d.name}</span>
                <span
                  className="level-chip"
                  style={{ background: level.color, color: level.text }}
                >
                  {level.label}
                </span>
              </div>
              <div className="result-card__bar">
                <div
                  className="result-card__bar-fill"
                  style={{ width: `${pct}%`, background: level.color }}
                />
              </div>
              <div className="result-card__pct">{pct}% in this domain</div>
            </div>
          );
        })}
      </div>

      <div className="results__actions">
        <button className="btn btn--primary btn--lg" onClick={onViewMatrix}>
          See it on the capability matrix
        </button>
        <button className="btn btn--ghost btn--lg" onClick={onViewDashboard}>
          Open my dashboard
        </button>
        <button className="btn btn--ghost" onClick={onRetake}>
          Retake the check
        </button>
      </div>
    </section>
  );
}
