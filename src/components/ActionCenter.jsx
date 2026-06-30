import { buildActionCenter } from '../lib/scoring.js';
import { domainName } from '../data/questions.js';
import { LEVELS, interviewScoreColor } from '../data/config.js';

function Category({ title, items, renderItem, emptyMsg }) {
  return (
    <div className="card ac__card">
      <h2 className="ac__title">{title}</h2>
      {items.length === 0 ? (
        <p className="readoff__empty">{emptyMsg}</p>
      ) : (
        <ul className="ac__list">
          {items.map((item, i) => renderItem(item, i))}
        </ul>
      )}
    </div>
  );
}

export default function ActionCenter({ rows, history = [], interviews = [], completions = [], onOpenNavigator }) {
  const ac = buildActionCenter(rows, { history, interviews, completions });
  const totalFlags = ac.criticalGaps.length + ac.trainingOverdue.length +
    ac.decliningTrends.length + ac.failedPractice.length;

  return (
    <section className="ac stagger">
      <header className="overview__head">
        <h1 className="overview__title">
          Action center
          {totalFlags > 0 && <span className="ac__badge">{totalFlags}</span>}
        </h1>
        <p className="overview__lede">
          Who needs attention right now — gaps, overdue training, declining trends, failed practice,
          and who is ready for more responsibility.
        </p>
      </header>

      <div className="ac__grid">
        <Category
          title="Critical gaps"
          items={ac.criticalGaps}
          emptyMsg="No Learning-level domains on the floor."
          renderItem={(item) => (
            <li key={`${item.name}-${item.domainId}`} className="ac__row">
              <button className="linkbtn ac__name" onClick={() => onOpenNavigator(item.name)}>
                {item.name}
              </button>
              <span
                className="level-chip ac__chip"
                style={{ background: LEVELS.learning.color, color: LEVELS.learning.text }}
              >
                {domainName(item.domainId)}
              </span>
            </li>
          )}
        />

        <Category
          title="Training overdue"
          items={ac.trainingOverdue}
          emptyMsg="All training assignments have a practice completion."
          renderItem={(item) => (
            <li key={`${item.name}-${item.domainId}`} className="ac__row">
              <button className="linkbtn ac__name" onClick={() => onOpenNavigator(item.name)}>
                {item.name}
              </button>
              <span className="tag">{domainName(item.domainId)}</span>
              <span className="ac__note">No practice yet</span>
            </li>
          )}
        />

        <Category
          title="Declining trends"
          items={ac.decliningTrends}
          emptyMsg="No declining scores detected."
          renderItem={(item) => (
            <li key={item.name} className="ac__row">
              <button className="linkbtn ac__name" onClick={() => onOpenNavigator(item.name)}>
                {item.name}
              </button>
              <span className="ac__delta ac__delta--down">
                {item.delta > 0 ? '+' : ''}{Math.round(item.delta)} pts overall
              </span>
            </li>
          )}
        />

        <Category
          title="Failed practice"
          items={ac.failedPractice}
          emptyMsg="No practice scores below threshold."
          renderItem={(item) => (
            <li key={`${item.name}-${item.interviewId}`} className="ac__row">
              <button className="linkbtn ac__name" onClick={() => onOpenNavigator(item.name)}>
                {item.name}
              </button>
              <span className="tag">{domainName(item.domainId)}</span>
              <span
                className="interview-log__score-badge ac__score"
                style={{ color: interviewScoreColor(item.score) }}
              >
                {item.score}/100
              </span>
            </li>
          )}
        />

        <Category
          title="Ready for more"
          items={ac.readyForMore}
          emptyMsg="Nominate navigators to mentor once they reach Can-Teach."
          renderItem={(item) => (
            <li key={item.name} className="ac__row">
              <button className="linkbtn ac__name" onClick={() => onOpenNavigator(item.name)}>
                {item.name}
              </button>
              <span className="ac__note ac__note--positive">
                {item.canTeachCount} Can-Teach domain{item.canTeachCount !== 1 ? 's' : ''}
              </span>
            </li>
          )}
        />
      </div>
    </section>
  );
}
