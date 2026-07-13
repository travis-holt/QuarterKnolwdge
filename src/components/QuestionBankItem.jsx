import { domainName } from '../data/questions.js';
import { competencyName } from '../data/competencies.js';
import { optionPoints } from '../lib/scoring.js';
import { hasBlockingFlags, validateQuestionContent } from '../lib/contentGuards.js';
import QuestionEditor from './QuestionEditor.jsx';
import FeedbackControls from './FeedbackControls.jsx';

const MAX_VISIBLE_COMPETENCY_TAGS = 3;

const ACTION_LABELS = {
  activate: { draft: 'Activate', archived: 'Restore' },
  pending: { activate: { draft: 'Activating…', archived: 'Restoring…' }, archive: 'Archiving…', delete: { draft: 'Discarding…', archived: 'Deleting…' } },
  delete: { draft: 'Discard', archived: 'Delete' },
};

function HealthSummary({ health }) {
  if (!health) return null;
  const pct = Math.round(health.correctRate * 100);
  return (
    <span className="qhealth">
      <span className={`qhealth__dot qhealth__dot--${health.status}`} />
      {health.status === 'insufficient' ? (
        <span className="qhealth__label">
          {health.responseCount === 0 ? 'No responses yet' : `${health.responseCount} response${health.responseCount !== 1 ? 's' : ''} · needs 10+`}
        </span>
      ) : (
        <span className="qhealth__label">{pct}% correct · {health.responseCount} responses</span>
      )}
      {health.status === 'review' && <span className="qhealth__badge">Review Required</span>}
    </span>
  );
}

/**
 * One question row: collapsed by default (status, tags, scenario preview,
 * health summary, warning indicator). Expands in place to the full detail
 * view (options, rationale, health detail, content warnings, actions) when
 * `isExpanded`. Editing swaps the expanded body for <QuestionEditor>.
 *
 * Persistence actions (activate/archive/delete/restore) are failure-safe:
 * `pendingAction` disables the in-flight button and prevents re-entrancy
 * (guarded again at the QuestionBank level via a ref); `actionError` renders
 * an accessible (`role="alert"`) inline error beside the actions if the
 * write rejects, and the row is left exactly as it was — no auto-advance,
 * no collapse.
 */
export default function QuestionBankItem({
  question: q,
  status, // 'draft' | 'active' | 'archived'
  health,
  isExpanded,
  isEditing,
  editError,
  pendingAction, // 'activate' | 'archive' | 'delete' | null
  actionError,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onActivate,
  onArchive,
  onDelete,
  onSaveFeedback,
  onQueueRevision,
  queueing,
}) {
  const flags = validateQuestionContent(q);
  const blocked = hasBlockingFlags(flags);
  const best = q.options?.find((o) => o.id === q.correctOptionId);
  const compTags = q.competencies ?? [];
  const visibleComps = compTags.slice(0, MAX_VISIBLE_COMPETENCY_TAGS);
  const extraCompCount = compTags.length - visibleComps.length;
  const panelId = `qbank-panel-${q.id}`;
  const headId = `qbank-head-${q.id}`;
  const anyPending = Boolean(pendingAction);

  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn?.();
  };

  if (isEditing) {
    return (
      <li className="qbank__item is-editing">
        <QuestionEditor question={q} onSave={onSaveEdit} onCancel={onCancelEdit} />
        {editError && (
          <p role="alert" className="qedit__error qbank__edit-error">{editError}</p>
        )}
      </li>
    );
  }

  const activateLabel = pendingAction === 'activate'
    ? ACTION_LABELS.pending.activate[status]
    : ACTION_LABELS.activate[status];
  const deleteLabel = pendingAction === 'delete'
    ? ACTION_LABELS.pending.delete[status]
    : ACTION_LABELS.delete[status];
  const archiveLabel = pendingAction === 'archive' ? ACTION_LABELS.pending.archive : 'Archive';

  return (
    <li className={`qbank__item${health?.status === 'review' ? ' is-flagged' : ''}${isExpanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        id={headId}
        className="qbank__row"
        aria-expanded={isExpanded}
        aria-controls={panelId}
        onClick={onToggleExpand}
      >
        <span className="qbank__row-main">
          <span className="qbank__row-tags">
            <span className="tag tag--accent">{domainName(q.domainId)}</span>
            {visibleComps.map((c) => (
              <span key={c} className="tag qbank__comp">{competencyName(c)}</span>
            ))}
            {extraCompCount > 0 && <span className="tag qbank__comp">+{extraCompCount}</span>}
            {blocked && <span className="qbank__warn" title="Blocked from activation">⚠ Blocked</span>}
          </span>
          <span className="qbank__preview">{q.scenario}</span>
          <span className="qbank__row-sub">
            <span className="qbank__id">{q.id}</span>
            {status === 'active' && <HealthSummary health={health} />}
          </span>
        </span>
        <span className="qbank__chevron" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
      </button>

      {isExpanded && (
        <div className="qbank__panel" id={panelId} role="region" aria-labelledby={headId}>
          <p className="qbank__scenario">{q.scenario}</p>

          <ul className="qbank__options">
            {(q.options ?? []).map((o) => (
              <li key={o.id} className={`qbank__opt ${o.id === q.correctOptionId ? 'is-best' : ''}`}>
                <span className="qbank__opt-pts">{optionPoints(q, o.id)}</span>
                <span className="qbank__opt-text">{o.text}</span>
                {o.id === q.correctOptionId && <span className="qbank__opt-flag">Best</span>}
              </li>
            ))}
          </ul>
          {best?.rationale && <p className="qbank__why">Best answer: {best.rationale}</p>}

          {status === 'active' && health && (
            <div className="qbank__health-detail">
              <HealthSummary health={health} />
              {health.status === 'review' && (
                <div className="qhealth__alert">
                  <strong>SOP drift signal</strong> — only {Math.round(health.correctRate * 100)}% of {health.responseCount} responses were correct.
                  {health.canTeachFailCount > 0 && (
                    <> {health.canTeachFailCount} of {health.canTeachCount} Can-Teach navigator{health.canTeachCount !== 1 ? 's' : ''} also missed this — the SOP may not match floor practice.</>
                  )}
                </div>
              )}
              {health.status === 'review' && (
                <div className="qhealth__actions">
                  <button className="btn btn--ghost btn--sm" type="button" disabled={queueing} onClick={stop(onQueueRevision)}>
                    {queueing ? 'Queuing…' : 'Queue revision'}
                  </button>
                  <FeedbackControls
                    compact
                    targetType="question"
                    targetId={q.id}
                    context={{ correctRate: health.correctRate, responseCount: health.responseCount, canTeachFailCount: health.canTeachFailCount }}
                    onSaveFeedback={onSaveFeedback}
                  />
                </div>
              )}
            </div>
          )}

          {flags.length > 0 && (
            <div className="qbank__flags">
              {flags.map((flag) => (
                <div key={flag.code} className="qhealth__alert">
                  <strong>Blocked:</strong> {flag.message}
                </div>
              ))}
            </div>
          )}

          {actionError && (
            <p role="alert" className="qbank__action-error">{actionError}</p>
          )}

          <div className="qbank__actions">
            <button className="btn btn--ghost btn--sm" type="button" onClick={stop(onEdit)}>Edit</button>
            {status === 'draft' && (
              <>
                <button className="btn btn--primary btn--sm" type="button" disabled={blocked || anyPending} onClick={stop(() => onActivate(q.id))}>{activateLabel}</button>
                <button className="btn btn--ghost btn--sm qbank__destructive" type="button" disabled={anyPending} onClick={stop(() => onDelete(q.id))}>{deleteLabel}</button>
              </>
            )}
            {status === 'active' && (
              <button className="btn btn--ghost btn--sm qbank__destructive" type="button" disabled={anyPending} onClick={stop(() => onArchive(q.id))}>{archiveLabel}</button>
            )}
            {status === 'archived' && (
              <>
                <button className="btn btn--primary btn--sm" type="button" disabled={blocked || anyPending} onClick={stop(() => onActivate(q.id))}>{activateLabel}</button>
                <button className="btn btn--ghost btn--sm qbank__destructive" type="button" disabled={anyPending} onClick={stop(() => onDelete(q.id))}>{deleteLabel}</button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
