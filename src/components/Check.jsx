import { useState, useMemo, useEffect } from 'react';
import { SEED_QUESTIONS, domainName } from '../data/questions.js';

// M1: read any saved in-progress state for this check (survives a refresh /
// accidental tab close). Returns { answers, step } or null. Guarded so a corrupt
// value or unavailable sessionStorage never throws.
function readProgress(persistKey) {
  if (!persistKey) return null;
  try {
    const raw = sessionStorage.getItem(persistKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Stepped flow: one scenario per step, with a progress bar. The taker can move
// back and forth and must answer before advancing past each step.
//
// `questions` is the active bank (passed in by the role app from Firestore);
// defaults to the static seed so the component still works standalone.
// `hideName` hides the optional name field (used when the taker is already
// identified — e.g. a signed-in navigator). `greetingName` shows a friendly
// header in that case.
//
// Mini-check mode: pass `miniDomain` (a domainId string) + `limit` (default 4)
// to run a short re-validation for a single domain only.
export default function Check({ onSubmit, onCancel, questions = SEED_QUESTIONS, hideName = false, greetingName, deptName, miniDomain, limit, persistKey }) {
  const [name, setName] = useState('');
  // M1: restore in-progress answers/step for a persisted check on first render.
  const [saved] = useState(() => readProgress(persistKey));
  const [step, setStep] = useState(() =>
    Math.max(0, Math.min(saved?.step ?? 0, (questions?.length ?? 1) - 1))
  );
  const [answers, setAnswers] = useState(() => saved?.answers ?? {});

  // In mini-check mode, filter to the target domain and cap at `limit` questions.
  const activeQuestions = useMemo(() => {
    if (!miniDomain) return questions;
    const filtered = questions.filter((q) => q.domainId === miniDomain);
    return limit ? filtered.slice(0, limit) : filtered;
  }, [questions, miniDomain, limit]);

  const isMini = Boolean(miniDomain);
  const total = activeQuestions.length;
  // Clamp against the live bank in case a saved step points past a changed bank.
  const safeStep = Math.min(step, Math.max(0, total - 1));
  const q = activeQuestions[safeStep];
  const isLast = safeStep === total - 1;
  const answeredCurrent = answers[q.id] != null;
  const answeredCount = Object.keys(answers).length;

  // M1: persist progress on every change (no-op when persistKey is absent, e.g.
  // the mini-check). Cleared on submit/cancel below.
  useEffect(() => {
    if (!persistKey) return;
    try {
      sessionStorage.setItem(persistKey, JSON.stringify({ answers, step: safeStep }));
    } catch {
      /* sessionStorage unavailable — progress just won't persist */
    }
  }, [persistKey, answers, safeStep]);

  const clearProgress = () => {
    if (!persistKey) return;
    try {
      sessionStorage.removeItem(persistKey);
    } catch {
      /* ignore */
    }
  };

  const choose = (optionId) =>
    setAnswers((prev) => ({ ...prev, [q.id]: optionId }));

  const next = () => {
    if (isLast) {
      clearProgress();
      onSubmit(name, answers);
    } else {
      setStep(() => Math.min(safeStep + 1, total - 1));
    }
  };

  const cancel = () => {
    clearProgress();
    onCancel();
  };

  return (
    <section className="check view-enter">
      <div className="check__head">
        <div className="progress" aria-label={`Question ${safeStep + 1} of ${total}`}>
          <div
            className="progress__fill"
            style={{ width: `${((safeStep + 1) / total) * 100}%` }}
          />
        </div>
        <div className="check__meta">
          <span>
            Question {safeStep + 1} of {total}
          </span>
          {hideName ? (
            greetingName && (
              <span className="check__greeting">
                {isMini
                  ? `Re-check: ${domainName(miniDomain)}`
                  : `Hi ${greetingName}${deptName ? ` — ${deptName} check` : ''} 👋`}
              </span>
            )
          ) : (
            <input
              className="check__name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              aria-label="Your name"
            />
          )}
        </div>
      </div>

      <div className="card question">
        <span className="tag tag--accent">{domainName(q.domainId)}</span>
        <p className="question__scenario">{q.scenario}</p>

        <div className="question__options" role="radiogroup">
          {q.options.map((opt) => {
            const selected = answers[q.id] === opt.id;
            return (
              <button
                key={opt.id}
                className={`option ${selected ? 'is-selected' : ''}`}
                role="radio"
                aria-checked={selected}
                onClick={() => choose(opt.id)}
              >
                <span className="option__marker" aria-hidden="true" />
                <span className="option__text">{opt.text}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="check__actions">
        <button className="btn btn--ghost" onClick={cancel}>
          Cancel
        </button>
        <div className="check__actions-right">
          <button
            className="btn btn--ghost"
            onClick={() => setStep(() => Math.max(safeStep - 1, 0))}
            disabled={safeStep === 0}
          >
            Back
          </button>
          <button
            className="btn btn--primary"
            onClick={next}
            disabled={!answeredCurrent}
          >
            {isLast ? `Submit (${answeredCount}/${total})` : 'Next'}
          </button>
        </div>
      </div>
    </section>
  );
}
