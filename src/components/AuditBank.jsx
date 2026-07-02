import { useState } from 'react';
import { DOMAINS, domainName } from '../data/questions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Audit Bank — the supervisor review gate for pre-generated "Spot the Error"
// transcripts. Mirrors the Question Bank model: Gemini output lands as `draft`,
// the supervisor reads the full transcript (planted error highlighted) and only
// activates the ones that feel like real calls. Navigators' assessments draw
// from `active` items instantly instead of waiting 40–70s on live generation.
//
// Rendered inside the supervisor "Questions" tab, below the Question Bank.
// ─────────────────────────────────────────────────────────────────────────────

export default function AuditBank({ audits, selectedDept = 'pediatrics', onGenerate, onActivate, onArchive, onDelete }) {
  const [genDomain, setGenDomain] = useState(DOMAINS[0].id);
  const [genCount, setGenCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [message, setMessage] = useState(null); // { kind: 'ok'|'err', text }

  const deptAudits = audits.filter((a) => (a.department ?? 'pediatrics') === selectedDept);
  const byStatus = (s) => deptAudits.filter((a) => (a.status ?? 'active') === s);
  const drafts = byStatus('draft');
  const active = byStatus('active');
  const archived = byStatus('archived');

  // How many active items each domain has — the coverage read-off tells the
  // supervisor which domains still fall back to slow live generation.
  const coverage = DOMAINS.map((d) => ({
    ...d,
    count: active.filter((a) => a.domainId === d.id).length,
  }));

  const runGenerate = async () => {
    setGenerating(true);
    setMessage(null);
    try {
      const n = await onGenerate({ domainId: genDomain, count: Number(genCount) || 1 });
      setMessage({ kind: 'ok', text: `${n} draft transcript${n === 1 ? '' : 's'} added below for review.` });
    } catch (err) {
      setMessage({ kind: 'err', text: err?.message || 'Generation failed. Check the server logs.' });
    } finally {
      setGenerating(false);
    }
  };

  const renderAudit = (a, actions) => {
    const expanded = expandedId === a.id;
    const patientOpener = a.transcript?.find((t) => t.speaker === 'Patient')?.message ?? '';
    return (
      <li key={a.id} className="qbank__item">
        <div className="qbank__item-head">
          <span className="tag tag--accent">{domainName(a.domainId)}</span>
          <span className="tag">{(a.transcript ?? []).length} turns</span>
        </div>
        <p className="qbank__scenario">“{patientOpener}”</p>
        {expanded && (
          <>
            <div className="auditbank__transcript">
              {(a.transcript ?? []).map((turn, i) => (
                <p
                  key={i}
                  className={`auditbank__turn auditbank__turn--${turn.speaker === 'Agent' ? 'agent' : 'patient'}${i === a.errorIndex ? ' is-error' : ''}`}
                >
                  <strong>{turn.speaker}:</strong> {turn.message}
                  {i === a.errorIndex && <span className="auditbank__error-flag">planted error</span>}
                </p>
              ))}
            </div>
            <p className="qbank__why">{a.modelExplanation}</p>
          </>
        )}
        <div className="qbank__actions">
          <button className="btn btn--ghost btn--sm" onClick={() => setExpandedId(expanded ? null : a.id)}>
            {expanded ? 'Hide transcript' : 'Read transcript'}
          </button>
          {actions}
        </div>
      </li>
    );
  };

  return (
    <>
      <header className="overview__head" style={{ marginTop: '2.5rem' }}>
        <h1 className="overview__title">Spot the Error bank</h1>
        <p className="overview__lede">
          Pre-generate audit transcripts here so navigators&rsquo; assessments start instantly
          instead of waiting on live generation — and so you can weed out unrealistic calls
          before anyone sees them. Only <strong>active</strong> transcripts are served.
        </p>
      </header>

      {/* ── Coverage read-off ─────────────────────────────────────────── */}
      <div className="card overview__panel">
        <h2 className="overview__panel-title">Active coverage by domain</h2>
        <p className="readoff__sub">
          A full assessment uses one item per domain; a training assessment uses several for one
          domain. Domains with no active items fall back to slow live generation.
        </p>
        <ul className="auditbank__coverage">
          {coverage.map((d) => (
            <li key={d.id} className={`auditbank__coverage-item${d.count === 0 ? ' is-empty' : ''}`}>
              <span className="auditbank__coverage-name">{d.name}</span>
              <span className="auditbank__coverage-count">{d.count}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Generate ──────────────────────────────────────────────────── */}
      <div className="card qbank__gen">
        <h2 className="overview__panel-title">Generate audit transcripts</h2>
        <p className="readoff__sub">
          Drafts are created for your review — nothing is served until you activate it.
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
            {generating ? 'Generating…' : 'Generate transcripts'}
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
          <p className="readoff__empty">No draft transcripts awaiting review.</p>
        ) : (
          <ul className="qbank__list">
            {drafts.map((a) =>
              renderAudit(
                a,
                <>
                  <button className="btn btn--primary btn--sm" onClick={() => onActivate(a.id)}>Activate</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => onDelete(a.id)}>Discard</button>
                </>
              )
            )}
          </ul>
        )}
      </div>

      {/* ── Active ────────────────────────────────────────────────────── */}
      <div className="card overview__panel">
        <h2 className="overview__panel-title">Active in the assessment · {active.length}</h2>
        {active.length === 0 ? (
          <p className="readoff__empty">No active transcripts yet — activate a draft to build the bank.</p>
        ) : (
          <ul className="qbank__list">
            {active.map((a) =>
              renderAudit(
                a,
                <button className="btn btn--ghost btn--sm" onClick={() => onArchive(a.id)}>Archive</button>
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
            {archived.map((a) =>
              renderAudit(
                a,
                <>
                  <button className="btn btn--ghost btn--sm" onClick={() => onActivate(a.id)}>Restore</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => onDelete(a.id)}>Delete</button>
                </>
              )
            )}
          </ul>
        </div>
      )}
    </>
  );
}
