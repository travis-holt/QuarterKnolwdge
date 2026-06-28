import { domainName } from '../data/questions.js';
import { LEVELS } from '../data/config.js';
import { trainingForRow } from '../lib/scoring.js';

// The navigator's own training plan — their auto-assigned modules, each opening
// the full lesson content. Each assigned domain also shows a "Practice Scenario"
// button that launches the "Spot the Error" QA audit exercise.
// completedDomains is a Set<domainId> of domains the navigator has already
// completed at least one scenario for this quarter.
export default function MyTraining({ row, onPreviewModule, onStartAudit, completedDomains = new Set() }) {
  const training = trainingForRow(row);

  return (
    <section className="training stagger">
      <header className="overview__head">
        <h1 className="overview__title">My training</h1>
        <p className="overview__lede">
          Auto-assigned from your check — <strong>Required</strong> where you&rsquo;re at Learning,
          <strong> Stretch</strong> where you&rsquo;re Solid and climbing toward Can-Teach. Open any
          module to read the lessons, or practice a scenario to test yourself.
        </p>
      </header>

      {training.length === 0 ? (
        <div className="card empty__card">
          <h2 className="empty__title">Nothing assigned 🎉</h2>
          <p className="empty__body">
            You&rsquo;re at Can-Teach across the board — no training needed this quarter. Consider
            mentoring a colleague.
          </p>
        </div>
      ) : (
        <ul className="readoff__list mytraining__list">
          {training.map((a) => {
            const practiced = completedDomains.has(a.domainId);
            return (
              <li key={a.domainId} className="card train-assign train-assign--detail">
                <div className="train-assign__top">
                  <span
                    className={`cohort__tag ${
                      a.priority === 'Required' ? 'cohort__tag--req' : 'cohort__tag--stretch'
                    }`}
                  >
                    {a.priority}
                  </span>
                  {practiced && (
                    <span className="mytraining__practiced" title="You've completed a practice scenario">
                      ✓ Practiced
                    </span>
                  )}
                </div>
                <span className="train-assign__body">
                  <button
                    className="linkbtn train-assign__title"
                    onClick={() => onPreviewModule(a.domainId)}
                  >
                    {a.module?.title ?? domainName(a.domainId)}
                  </button>
                  <span className="train-assign__why">
                    Assigned because {domainName(a.domainId)} is at {LEVELS[a.level].label} · {a.goal}
                    {a.module && ` · ~${a.module.estMinutes} min`}
                  </span>
                </span>
                <div className="train-assign__actions">
                  <button className="btn btn--ghost btn--sm" onClick={() => onPreviewModule(a.domainId)}>
                    Open module
                  </button>
                  <button
                    className="btn btn--ghost btn--sm mytraining__practice-btn"
                    onClick={() => onStartAudit(a.domainId)}
                    title={`Practice a QA scenario for ${domainName(a.domainId)}`}
                  >
                    {practiced ? 'Practice again' : 'Practice scenario'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
