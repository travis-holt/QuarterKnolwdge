import { useState } from 'react';
import {
  adaptiveTrainingRecommendations,
  buildLearningSignals,
  buildQuestionImprovementSuggestions,
  feedbackInsights,
} from '../lib/scoring.js';
import { domainName } from '../data/questions.js';
import FeedbackControls from './FeedbackControls.jsx';

export default function LearningLoop({
  rows,
  results = [],
  questionAttempts = results,
  questions = [],
  completions = [],
  interviews = [],
  history = [],
  feedback = [],
  proposals = [],
  deptName,
  onSaveFeedback,
  onSaveProposal,
  onUpdateProposal,
  onCreateQuestionDraft,
}) {
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);
  const activeQuestions = questions.filter((q) => (q.status ?? 'active') === 'active');
  const signals = buildLearningSignals({ rows, results, questions: activeQuestions, completions, interviews, history, feedback });
  const questionSuggestions = buildQuestionImprovementSuggestions(activeQuestions, questionAttempts, feedback);
  const feedbackSummary = feedbackInsights(feedback);
  const resultById = new Map(results.filter((r) => r.navigatorId).map((r) => [r.navigatorId, r]));
  const resultByName = new Map(results.map((r) => [r.name, r]));
  const matchesRow = (item, row) => (
    item.navigatorId && row.navigatorId
      ? item.navigatorId === row.navigatorId
      : item.name === row.name
  );

  const recommendations = rows.flatMap((row) =>
    adaptiveTrainingRecommendations(row, {
      questions: activeQuestions,
      result: resultById.get(row.navigatorId) ?? resultByName.get(row.name),
      history: history.filter((h) => matchesRow(h, row)),
      completions: completions.filter((c) => matchesRow(c, row)),
      interviews: interviews.filter((iv) => matchesRow(iv, row)),
      feedback,
    })
  );

  const runAction = async (id, okText, action) => {
    setBusyId(id);
    setMessage(null);
    try {
      await action();
      setMessage({ kind: 'ok', text: okText });
    } catch (err) {
      console.error('LearningLoop action failed:', err);
      setMessage({ kind: 'err', text: err?.message || 'Could not save. Check Firebase config/network.' });
    } finally {
      setBusyId(null);
    }
  };

  const saveTrainingProposal = (rec) => runAction(
    `training-${rec.name}-${rec.domainId}`,
    'Proposal queued for review.',
    () => onSaveProposal?.({
      type: 'trainingRecommendation',
      title: `${rec.name}: ${rec.label}`,
      target: { name: rec.name, domainId: rec.domainId },
      payload: rec,
      reasons: rec.reasons,
    })
  );

  const saveQuestionProposal = (suggestion) => runAction(
    `question-${suggestion.questionId}`,
    'Question revision queued for review.',
    () => onSaveProposal?.({
      type: 'questionRevision',
      title: `Review question ${suggestion.questionId}`,
      target: { questionId: suggestion.questionId, domainId: suggestion.domainId, department: suggestion.suggestedDraft?.department },
      payload: { suggestedDraft: suggestion.suggestedDraft },
      reasons: suggestion.reasons,
    })
  );

  const approveProposal = async (proposal) => {
    await runAction(`approve-${proposal.id}`, 'Proposal approved.', async () => {
      if (proposal.type === 'questionRevision' && proposal.payload?.suggestedDraft && onCreateQuestionDraft) {
        await onCreateQuestionDraft(proposal.payload.suggestedDraft);
      }
      await onUpdateProposal?.(proposal.id, 'approved', { note: 'Reviewed in Learning Loop' });
    });
  };

  return (
    <section className="learning view-enter">
      <header className="overview__head">
        <h1 className="overview__title">Learning loop{deptName && <span className="title-dept"> · {deptName}</span>}</h1>
        <p className="overview__lede">
          Evidence-based recommendations from stored results, practice, question health, and supervisor feedback.
          Suggestions are advisory until reviewed.
        </p>
        {message && (
          <p className={`learning__msg ${message.kind === 'err' ? 'is-error' : 'is-ok'}`}>
            {message.text}
          </p>
        )}
      </header>

      <div className="overview__grid learning__summary">
        <div className="card kpi">
          <span className="kpi__label">Weak domains</span>
          <span className="kpi__value">{signals.weakDomains.length}</span>
        </div>
        <div className="card kpi">
          <span className="kpi__label">Missed-answer evidence</span>
          <span className="kpi__value">{signals.repeatedMisses.length}</span>
        </div>
        <div className="card kpi">
          <span className="kpi__label">Question review signals</span>
          <span className="kpi__value">{questionSuggestions.length}</span>
        </div>
        <div className="card kpi">
          <span className="kpi__label">Feedback risks</span>
          <span className="kpi__value">{feedbackSummary.risks.length}</span>
        </div>
      </div>

      <div className="card overview__panel">
        <h2 className="overview__panel-title">Adaptive next steps</h2>
        {recommendations.length === 0 ? (
          <p className="readoff__empty">No adaptive training recommendations right now.</p>
        ) : (
          <ul className="learning__list">
            {recommendations.slice(0, 12).map((rec) => (
              <li key={`${rec.name}-${rec.domainId}`} className="learning__item">
                <div>
                  <p className="learning__title">{rec.name} · {domainName(rec.domainId)}</p>
                  <p className="learning__body">{rec.label}</p>
                  <ul className="learning__reasons">
                    {rec.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
                <div className="learning__actions">
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => saveTrainingProposal(rec)}
                  >
                    {busyId === `training-${rec.name}-${rec.domainId}` ? 'Queuing...' : 'Queue proposal'}
                  </button>
                  <FeedbackControls
                    compact
                    targetType="training"
                    targetId={`${rec.name}:${rec.domainId}`}
                    context={{ kind: rec.kind, reasons: rec.reasons }}
                    onSaveFeedback={onSaveFeedback}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card overview__panel">
        <h2 className="overview__panel-title">Question improvement signals</h2>
        {questionSuggestions.length === 0 ? (
          <p className="readoff__empty">No questions need review from the current evidence.</p>
        ) : (
          <ul className="learning__list">
            {questionSuggestions.map((s) => (
              <li key={s.questionId} className="learning__item">
                <div>
                  <p className="learning__title">{domainName(s.domainId)} · {s.labels.join(', ')}</p>
                  <p className="learning__body">{s.questionId} · {Math.round(s.correctRate * 100)}% correct</p>
                  <ul className="learning__reasons">
                    {s.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
                <div className="learning__actions">
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => saveQuestionProposal(s)}
                  >
                    {busyId === `question-${s.questionId}` ? 'Queuing...' : 'Queue revision'}
                  </button>
                  <FeedbackControls
                    compact
                    targetType="question"
                    targetId={s.questionId}
                    context={{ labels: s.labels, reasons: s.reasons }}
                    onSaveFeedback={onSaveFeedback}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card overview__panel">
        <h2 className="overview__panel-title">Supervisor feedback risks</h2>
        {feedbackSummary.risks.length === 0 ? (
          <p className="readoff__empty">No recurring feedback concerns yet.</p>
        ) : (
          <ul className="learning__list">
            {feedbackSummary.risks.map((risk) => (
              <li key={`${risk.targetType}-${risk.targetId}`} className="learning__item">
                <div>
                  <p className="learning__title">{risk.targetType} · {risk.targetId}</p>
                  <p className="learning__body">{risk.reason}</p>
                  {risk.notes.length > 0 && <p className="learning__note">{risk.notes.join(' · ')}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card overview__panel">
        <h2 className="overview__panel-title">Human review queue · {proposals.filter((p) => (p.status ?? 'pending') === 'pending').length}</h2>
        {proposals.length === 0 ? (
          <p className="readoff__empty">No learning proposals yet.</p>
        ) : (
          <ul className="learning__list">
            {proposals.map((p) => (
              <li key={p.id} className="learning__item">
                <div>
                  <p className="learning__title">{p.title}</p>
                  <p className="learning__body">{p.type} · {p.status ?? 'pending'}</p>
                  {p.reasons?.length > 0 && (
                    <ul className="learning__reasons">
                      {p.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  )}
                </div>
                {(p.status ?? 'pending') === 'pending' && (
                  <div className="learning__actions">
                    <button className="btn btn--primary btn--sm" type="button" disabled={busyId !== null} onClick={() => approveProposal(p)}>
                      {busyId === `approve-${p.id}` ? 'Approving...' : 'Approve'}
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => runAction(`reject-${p.id}`, 'Proposal rejected.', () => onUpdateProposal?.(p.id, 'rejected', { note: 'Rejected in Learning Loop' }))}
                    >
                      {busyId === `reject-${p.id}` ? 'Rejecting...' : 'Reject'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
