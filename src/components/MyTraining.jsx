import { useState } from 'react';
import { domainName } from '../data/questions.js';
import { LEVELS, MINICHECK_SIZE } from '../data/config.js';
import { trainingForRow, buildDevPath, sequenceDevSteps } from '../lib/scoring.js';
import { apiFetch } from '../lib/apiFetch.js';

const STEP_LABELS = {
  coaching: 'Review coaching',
  practice: 'Spot the Error',
  interview: 'Practice call',
  module: 'Read module',
  minicheck: `Mini re-check (${MINICHECK_SIZE}Q)`,
};
const STEP_ICONS = { coaching: '💬', practice: '🔍', interview: '☎️', module: '📖', minicheck: '✏️' };

function PathStep({ step, onAction }) {
  return (
    <div className={`devpath__step devpath__step--${step.status}`}>
      <span className="devpath__step-icon" aria-hidden="true">{STEP_ICONS[step.kind] ?? '•'}</span>
      <span className="devpath__step-label">{STEP_LABELS[step.kind] ?? step.label ?? step.kind}</span>
      {step.status === 'next' && (
        <button className="btn btn--ghost btn--sm devpath__step-btn" onClick={() => onAction(step.kind)}>
          Start
        </button>
      )}
      {step.status === 'done' && <span className="devpath__step-done" aria-label="done">✓</span>}
    </div>
  );
}

// completedDomains is a Set<domainId> of domains the navigator has practiced.
// completions carries all exercise completions so mini-check progress can be tracked too.
// interviews is an array of graded interview sessions (for dev path progress).
export default function MyTraining({
  row,
  onPreviewModule,
  onStartAudit,
  onStartInterview,
  onStartMiniCheck,
  completedDomains = new Set(),
  completions = [],
  interviews = [],
  department = 'pediatrics',
}) {
  const training = trainingForRow(row);
  // Preserve compatibility with older callers that only pass completedDomains.
  const practiceCompletions = [...completedDomains].map((d) => ({ domainId: d, kind: 'practice' }));
  const completionEvidence = completions.length > 0 ? completions : practiceCompletions;
  const paths = buildDevPath(row, completionEvidence, interviews);

  const [aiPaths, setAiPaths] = useState(null);
  const [personalizing, setPersonalizing] = useState(false);
  const [personalized, setPersonalized] = useState(false);

  const handlePersonalize = async () => {
    setPersonalizing(true);
    try {
      const weakDomains = training.map((a) => ({
        domainId: a.domainId,
        level: a.level,
        currentScore: row.scores[a.domainId] ?? 0,
      }));
      const data = await apiFetch('/api/sequence-path', {
        weakDomains,
        department,
        name: row.name,
        completions,
        interviews,
      }, 25_000);
      if (data?.paths?.length) {
        setAiPaths(Object.fromEntries(data.paths.map((p) => [p.domainId, p.steps])));
        setPersonalized(true);
      }
    } catch {
      // Advisory — fail silently; default order is already shown
    } finally {
      setPersonalizing(false);
    }
  };

  // If AI reordered steps, map status from computed path by kind, keep AI rationale
  const mergedSteps = (path) => {
    const aiOrder = aiPaths?.[path.domainId];
    if (!aiOrder) return path.steps;
    const statusByKind = Object.fromEntries(path.steps.map((s) => [s.kind, s]));
    return sequenceDevSteps(aiOrder.map((aiStep) => ({
      ...(statusByKind[aiStep.kind] ?? { kind: aiStep.kind, status: 'todo' }),
      rationale: aiStep.rationale,
    })));
  };

  const handleStepAction = (path, kind) => {
    if (kind === 'practice') onStartAudit(path.domainId);
    else if (kind === 'interview') onStartInterview?.(path.domainId);
    else if (kind === 'minicheck') onStartMiniCheck?.(path.domainId);
    else onPreviewModule(path.domainId, kind); // coaching + module share the learning content, tracked separately
  };

  return (
    <section className="training stagger">
      <header className="overview__head">
        <h1 className="overview__title">My training</h1>
        <p className="overview__lede">
          Auto-assigned from your check — <strong>Required</strong> where you&rsquo;re at Learning,
          <strong> Stretch</strong> where you&rsquo;re Solid and climbing toward Can-Teach. Follow the
          steps in each domain or personalise the order with AI.
        </p>
        {training.length > 0 && (
          <button
            className="btn btn--ghost"
            onClick={handlePersonalize}
            disabled={personalizing || personalized}
            style={{ marginTop: '0.5rem' }}
          >
            {personalizing ? 'Personalizing…' : personalized ? '✓ Path personalized' : 'Personalize my path'}
          </button>
        )}
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
            const path = paths.find((p) => p.domainId === a.domainId);
            const steps = path ? mergedSteps(path) : [];
            const nextStep = steps.find((s) => s.status === 'next');
            return (
              <li key={a.domainId} className="card train-assign train-assign--detail">
                <div className="train-assign__top">
                  <span className={`cohort__tag ${a.priority === 'Required' ? 'cohort__tag--req' : 'cohort__tag--stretch'}`}>
                    {a.priority}
                  </span>
                  {practiced && (
                    <span className="mytraining__practiced" title="You've completed a practice scenario">
                      ✓ Practiced
                    </span>
                  )}
                  {path && (
                    <span className="devpath__progress">
                      {path.steps.filter((s) => s.status === 'done').length}/{path.steps.length} steps
                    </span>
                  )}
                </div>

                <span className="train-assign__body">
                  <button className="linkbtn train-assign__title" onClick={() => onPreviewModule(a.domainId)}>
                    {a.module?.title ?? domainName(a.domainId)}
                  </button>
                  <span className="train-assign__why">
                    Assigned because {domainName(a.domainId)} is at {LEVELS[a.level].label} · {a.goal}
                    {a.module && ` · ~${a.module.estMinutes} min`}
                  </span>
                  {nextStep?.rationale && (
                    <span className="devpath__rationale">💡 {nextStep.rationale}</span>
                  )}
                </span>

                {steps.length > 0 && (
                  <div className="devpath">
                    {steps.map((step) => (
                      <PathStep
                        key={step.kind}
                        step={step}
                        onAction={(kind) => handleStepAction(path, kind)}
                      />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
