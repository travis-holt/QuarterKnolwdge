import { useState } from 'react';
import { DOMAINS, domainName } from '../data/questions.js';
import { COMPETENCIES, competencyName } from '../data/competencies.js';
import { computeQuestionHealth, optionPoints } from '../lib/scoring.js';
import { hasBlockingFlags, validateQuestionContent } from '../lib/contentGuards.js';
import QuestionEditor from './QuestionEditor.jsx';
import FeedbackControls from './FeedbackControls.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Question Bank — the supervisor's review gate. Generated scenarios land as
// `draft` and are NEVER live until activated here. Supervisors can also edit,
// archive, or delete. This is the human quality control between AI output and a
// live assessment.
// ─────────────────────────────────────────────────────────────────────────────

export default function QuestionBank({ questions, results = [], selectedDept = 'pediatrics', onActivate, onArchive, onDelete, onSaveEdit, onGenerate, onSaveFeedback, onSaveProposal }) {
  const [editingId, setEditingId] = useState(null);
  const [genDomain, setGenDomain] = useState(DOMAINS[0].id);
  const [genCount, setGenCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [queueingId, setQueueingId] = useState(null);
  const [message, setMessage] = useState(null); // { kind: 'ok'|'err', text }

  // Filter the bank to the supervisor's selected department.
  const deptQuestions = questions.filter((q) => (q.department ?? 'pediatrics') === selectedDept);

  const byStatus = (s) => deptQuestions.filter((q) => (q.status ?? 'active') === s);
  const drafts = byStatus('draft');
  const active = byStatus('active');
  const archived = byStatus('archived');

  // Health metrics — keyed by question id; only computed for active questions.
  const health = computeQuestionHealth(active, results);

  const runGenerate = async () => {
    setGenerating(true);
    setMessage(null);
    try {
      const n = await onGenerate({ domainId: genDomain, count: Number(genCount) || 1 });
      setMessage({ kind: 'ok', text: `${n} draft scenario${n === 1 ? '' : 's'} added below for review.` });
    } catch (err) {
      setMessage({ kind: 'err', text: err?.message || 'Generation failed. Check the server logs.' });
    } finally {
      setGenerating(false);
    }
  };

  const saveEdit = async (edited) => {
    await onSaveEdit(edited.id, {
      scenario: edited.scenario,
      domainId: edited.domainId,
      competencies: edited.competencies,
      options: edited.options,
      correctOptionId: edited.correctOptionId,
    });
    setEditingId(null);
  };

  const queueRevision = async (q, h) => {
    if (!onSaveProposal) return;
    setQueueingId(q.id);
    setMessage(null);
    try {
      await onSaveProposal({
        type: 'questionRevision',
        title: `Review question ${q.id}`,
        target: { questionId: q.id, domainId: q.domainId, department: selectedDept },
        payload: {
          suggestedDraft: {
            ...q,
            status: 'draft',
            source: 'learning-loop',
            reviewNotes: `Question health flagged this item at ${Math.round((h?.correctRate ?? 0) * 100)}% correct across ${h?.responseCount ?? 0} responses. Review wording, options, rationales, and SOP alignment before activation.`,
          },
        },
        reasons: [
          `${Math.round((h?.correctRate ?? 0) * 100)}% correct across ${h?.responseCount ?? 0} responses`,
          h?.canTeachFailCount > 0 ? `${h.canTeachFailCount} Can-Teach misses` : 'No Can-Teach miss signal',
        ],
      });
      setMessage({ kind: 'ok', text: 'Question revision queued in Learning Loop.' });
    } catch (err) {
      setMessage({ kind: 'err', text: err?.message || 'Could not queue revision. Check Firebase config/network.' });
    } finally {
      setQueueingId(null);
    }
  };

  const renderQuestion = (q, actions, showHealth = false) => {
    if (editingId === q.id) {
      return (
        <li key={q.id} className="qbank__item is-editing">
          <QuestionEditor question={q} onSave={saveEdit} onCancel={() => setEditingId(null)} />
        </li>
      );
    }
    const best = q.options?.find((o) => o.id === q.correctOptionId);
    const h = showHealth ? health[q.id] : null;
    const pct = h ? Math.round(h.correctRate * 100) : null;
    const flags = validateQuestionContent(q);
    const blocked = hasBlockingFlags(flags);

    return (
      <li key={q.id} className={`qbank__item${h?.status === 'review' ? ' is-flagged' : ''}`}>
        <div className="qbank__item-head">
          <span className="tag tag--accent">{domainName(q.domainId)}</span>
          {(q.competencies ?? []).map((c) => (
            <span key={c} className="tag qbank__comp">{competencyName(c)}</span>
          ))}
          {h && (
            <span className="qhealth" style={{ marginLeft: 'auto' }}>
              <span className={`qhealth__dot qhealth__dot--${h.status}`} />
              {h.status === 'insufficient' ? (
                <span className="qhealth__label">
                  {h.responseCount === 0 ? 'No responses yet' : `${h.responseCount} response${h.responseCount !== 1 ? 's' : ''} · needs 10+`}
                </span>
              ) : (
                <span className="qhealth__label">{pct}% correct · {h.responseCount} responses</span>
              )}
              {h.status === 'review' && <span className="qhealth__badge">Review Required</span>}
            </span>
          )}
        </div>

        {h?.status === 'review' && (
          <div className="qhealth__alert">
            <strong>SOP drift signal</strong> — only {pct}% of {h.responseCount} responses were correct.
            {h.canTeachFailCount > 0 && (
              <> {h.canTeachFailCount} of {h.canTeachCount} Can-Teach navigator{h.canTeachCount !== 1 ? 's' : ''} also missed this — the SOP may not match floor practice.</>
            )}
          </div>
        )}

        {h?.status === 'review' && (
          <div className="qhealth__actions">
              <button className="btn btn--ghost btn--sm" type="button" disabled={queueingId !== null} onClick={() => queueRevision(q, h)}>
                {queueingId === q.id ? 'Queuing...' : 'Queue revision'}
              </button>
            <FeedbackControls
              compact
              targetType="question"
              targetId={q.id}
              context={{ correctRate: h.correctRate, responseCount: h.responseCount, canTeachFailCount: h.canTeachFailCount }}
              onSaveFeedback={onSaveFeedback}
            />
          </div>
        )}
        {flags.map((flag) => (
          <div key={flag.code} className="qhealth__alert">
            <strong>Blocked:</strong> {flag.message}
          </div>
        ))}

        <p className="qbank__scenario">{q.scenario}</p>
        <ul className="qbank__options">
          {(q.options ?? []).map((o) => (
            <li key={o.id} className={`qbank__opt ${o.id === q.correctOptionId ? 'is-best' : ''}`}>
              <span className="qbank__opt-pts">{optionPoints(q, o.id)}</span>
              <span className="qbank__opt-text">{o.text}</span>
            </li>
          ))}
        </ul>
        {best?.rationale && <p className="qbank__why">Best answer: {best.rationale}</p>}
        <div className="qbank__actions">
          <button className="btn btn--ghost btn--sm" onClick={() => setEditingId(q.id)}>Edit</button>
          {actions(blocked)}
        </div>
      </li>
    );
  };

  return (
    <section className="qbank view-enter">
      <header className="overview__head">
        <h1 className="overview__title">Question bank</h1>
        <p className="overview__lede">
          Generate scenarios from the SOP, review them, and activate the ones you trust. Only{' '}
          <strong>active</strong> questions appear in the navigator&rsquo;s check.
        </p>
      </header>

      {/* ── Generate ──────────────────────────────────────────────────── */}
      <div className="card qbank__gen">
        <h2 className="overview__panel-title">Generate from the SOP</h2>
        <p className="readoff__sub">
          Drafts are created for your review — nothing goes live until you activate it.
        </p>
        <div className="qbank__gen-row">
          <label className="qedit__field">
            <span className="qedit__label">Domain</span>
            <select className="qedit__select" value={genDomain} onChange={(e) => setGenDomain(e.target.value)}>
              {DOMAINS.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label className="qedit__field">
            <span className="qedit__label">How many</span>
            <input className="qedit__select" type="number" min={1} max={8} value={genCount} onChange={(e) => setGenCount(e.target.value)} />
          </label>
          <button className="btn btn--primary" onClick={runGenerate} disabled={generating}>
            {generating ? 'Generating…' : 'Generate scenarios'}
          </button>
        </div>
        {message && (
          <p className={`qbank__msg ${message.kind === 'err' ? 'is-err' : 'is-ok'}`}>{message.text}</p>
        )}
      </div>

      {/* ── Review queue (drafts) ─────────────────────────────────────── */}
      <div className="card overview__panel">
        <h2 className="overview__panel-title">Review queue · {drafts.length}</h2>
        {drafts.length === 0 ? (
          <p className="readoff__empty">No drafts awaiting review.</p>
        ) : (
          <ul className="qbank__list">
            {drafts.map((q) =>
              renderQuestion(
                q,
                (blocked) => (
                  <>
                    <button className="btn btn--primary btn--sm" onClick={() => onActivate(q.id)} disabled={blocked}>Activate</button>
                    <button className="btn btn--ghost btn--sm" onClick={() => onDelete(q.id)}>Discard</button>
                  </>
                )
              )
            )}
          </ul>
        )}
      </div>

      {/* ── Active ────────────────────────────────────────────────────── */}
      <div className="card overview__panel">
        <h2 className="overview__panel-title">Active in the check · {active.length}</h2>
        {active.length === 0 ? (
          <p className="readoff__empty">No active questions yet — activate a draft to build the check.</p>
        ) : (
          <ul className="qbank__list">
            {active.map((q) =>
              renderQuestion(
                q,
                () => <button className="btn btn--ghost btn--sm" onClick={() => onArchive(q.id)}>Archive</button>,
                true
              )
            )}
          </ul>
        )}
      </div>

      {/* ── Archived ──────────────────────────────────────────────────── */}
      {archived.length > 0 && (
        <div className="card overview__panel">
          <h2 className="overview__panel-title">Archived · {archived.length}</h2>
          <ul className="qbank__list">
            {archived.map((q) =>
              renderQuestion(
                q,
                (blocked) => (
                  <>
                    <button className="btn btn--ghost btn--sm" onClick={() => onActivate(q.id)} disabled={blocked}>Restore</button>
                    <button className="btn btn--ghost btn--sm" onClick={() => onDelete(q.id)}>Delete</button>
                  </>
                )
              )
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
