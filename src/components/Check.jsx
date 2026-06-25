import { useState } from 'react';
import { SEED_QUESTIONS, DOMAINS } from '../data/questions.js';

const domainName = (id) => DOMAINS.find((d) => d.id === id)?.name ?? id;

// Stepped flow: one scenario per step, with a progress bar. The taker can move
// back and forth and must answer before advancing past each step.
//
// `questions` is the active bank (passed in by the role app from Firestore);
// defaults to the static seed so the component still works standalone.
// `hideName` hides the optional name field (used when the taker is already
// identified — e.g. a signed-in navigator). `greetingName` shows a friendly
// header in that case.
export default function Check({ onSubmit, onCancel, questions = SEED_QUESTIONS, hideName = false, greetingName }) {
  const [name, setName] = useState('');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});

  const q = questions[step];
  const total = questions.length;
  const isLast = step === total - 1;
  const answeredCurrent = answers[q.id] != null;
  const answeredCount = Object.keys(answers).length;

  const choose = (optionId) =>
    setAnswers((prev) => ({ ...prev, [q.id]: optionId }));

  const next = () => {
    if (isLast) {
      onSubmit(name, answers);
    } else {
      setStep((s) => Math.min(s + 1, total - 1));
    }
  };

  return (
    <section className="check view-enter">
      <div className="check__head">
        <div className="progress" aria-label={`Question ${step + 1} of ${total}`}>
          <div
            className="progress__fill"
            style={{ width: `${((step + 1) / total) * 100}%` }}
          />
        </div>
        <div className="check__meta">
          <span>
            Question {step + 1} of {total}
          </span>
          {hideName ? (
            greetingName && <span className="check__greeting">Hi {greetingName} 👋</span>
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
        <button className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <div className="check__actions-right">
          <button
            className="btn btn--ghost"
            onClick={() => setStep((s) => Math.max(s - 1, 0))}
            disabled={step === 0}
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
