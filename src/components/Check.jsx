import { useState, useMemo, useEffect, useRef } from 'react';
import { SEED_QUESTIONS, domainName } from '../data/questions.js';

// M1: read any saved in-progress state for this check (survives a refresh /
// accidental tab close). Returns { answers, step } or null. Guarded so a corrupt
// value or unavailable sessionStorage never throws.
function readProgress(persistKey, version) {
  if (!persistKey) return null;
  try {
    const raw = sessionStorage.getItem(persistKey);
    const parsed = raw ? JSON.parse(raw) : null;
    // Never carry answers or a step into a changed assessment bank. A question
    // edit can keep the same document id while changing its choices/scoring, so
    // the signature covers the scored content rather than ids alone.
    return parsed?.version === version ? parsed : null;
  } catch {
    return null;
  }
}

export function questionSetVersion(questions = []) {
  return JSON.stringify(questions.map((q) => ({
    id: q.id,
    domainId: q.domainId,
    correctOptionId: q.correctOptionId,
    options: (q.options ?? []).map((o) => ({ id: o.id, points: o.points, text: o.text })),
  })));
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
  // In mini-check mode, filter to the target domain and cap at `limit` questions.
  const activeQuestions = useMemo(() => {
    if (!miniDomain) return questions;
    const filtered = questions.filter((q) => q.domainId === miniDomain);
    return limit ? filtered.slice(0, limit) : filtered;
  }, [questions, miniDomain, limit]);
  const version = useMemo(() => questionSetVersion(activeQuestions), [activeQuestions]);
  const [name, setName] = useState('');
  // M1: restore in-progress answers/step for a persisted check on first render.
  const [saved] = useState(() => readProgress(persistKey, version));
  const [step, setStep] = useState(() =>
    Math.max(0, Math.min(saved?.step ?? 0, (activeQuestions.length || 1) - 1))
  );
  const [answers, setAnswers] = useState(() => saved?.answers ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const renderedVersionRef = useRef(version);

  const isMini = Boolean(miniDomain);
  const total = activeQuestions.length;
  // Clamp against the live bank in case a saved step points past a changed bank.
  const safeStep = Math.min(step, Math.max(0, total - 1));
  const q = activeQuestions[safeStep];
  const isLast = safeStep === total - 1;
  const answeredCurrent = q ? answers[q.id] != null : false;
  const activeIds = new Set(activeQuestions.map((item) => item.id));
  const answeredCount = Object.keys(answers).filter((id) => activeIds.has(id)).length;

  // M1: persist progress on every change (no-op when persistKey is absent, e.g.
  // the mini-check). Cleared on submit/cancel below.
  useEffect(() => {
    if (!persistKey) return;
    try {
      sessionStorage.setItem(persistKey, JSON.stringify({ version, answers, step: safeStep }));
    } catch {
      /* sessionStorage unavailable — progress just won't persist */
    }
  }, [persistKey, version, answers, safeStep]);

  // A live question-bank edit while this component is mounted must not retain
  // answers against changed options/scoring. Initial restored progress is kept;
  // only a subsequent version transition resets the attempt.
  useEffect(() => {
    if (renderedVersionRef.current === version) return;
    renderedVersionRef.current = version;
    setAnswers({});
    setStep(0);
    setSubmitError('The question bank changed. This attempt has been restarted with the current questions.');
  }, [version]);

  const clearProgress = () => {
    if (!persistKey) return;
    try {
      sessionStorage.removeItem(persistKey);
    } catch {
      /* ignore */
    }
  };

  const choose = (optionId) => {
    if (!q || submitting) return;
    setSubmitError('');
    setAnswers((prev) => ({ ...prev, [q.id]: optionId }));
  };

  const next = async () => {
    if (!q || submitting) return;
    if (isLast) {
      setSubmitting(true);
      setSubmitError('');
      try {
        await onSubmit(name, answers, activeQuestions);
        clearProgress();
      } catch (err) {
        setSubmitError(err?.message || 'Could not submit the assessment. Try again.');
      } finally {
        setSubmitting(false);
      }
    } else {
      setStep(() => Math.min(safeStep + 1, total - 1));
    }
  };

  const cancel = () => {
    clearProgress();
    onCancel?.();
  };

  if (total === 0) {
    return (
      <section className="check view-enter">
        <div className="card empty__card" role="status">
          <h2 className="empty__title">No questions available</h2>
          <p className="empty__body">
            {isMini
              ? `There are no active ${domainName(miniDomain)} questions for this re-check yet.`
              : 'There are no active questions for this department yet.'}
          </p>
          {onCancel && <button className="btn btn--ghost" onClick={cancel}>Go back</button>}
        </div>
      </section>
    );
  }

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
            disabled={!answeredCurrent || submitting}
          >
            {submitting ? 'Submitting…' : isLast ? `Submit (${answeredCount}/${total})` : 'Next'}
          </button>
        </div>
      </div>
      {submitError && <p className="gate__error" role="alert">{submitError}</p>}
    </section>
  );
}
