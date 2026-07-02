// SOP Manager (F24) — supervisor tab for adding, building, refining, and
// activating department SOPs.
//
// Each SOP is a versioned Firestore doc (draft → active → archived); at most one
// version per department is active. The ACTIVE version grounds all AI features
// server-side (api/_sop-store.js); when none exists the server falls back to the
// hardcoded contexts in api/_sop-context.js.
//
// AI assistance (both advisory — output is always saved as a DRAFT for review):
//   • "Build with AI"  — structures a raw pasted document into the standard
//     6-domain SOP layout (/api/refine-sop mode 'build').
//   • "Refine current" — merges new material (updated guide, Teams announcement,
//     floor-rule change) into the active SOP, flagging every contradiction /
//     outdated rule / addition (/api/refine-sop mode 'refine').
import { useState } from 'react';
import { apiFetch, fetchErrorMessage } from '../lib/apiFetch.js';

const CHANGE_LABELS = {
  contradiction: 'Contradiction',
  outdated: 'Outdated rule',
  addition: 'Addition',
  clarification: 'Clarification',
};

const fmtDate = (ts) =>
  ts?.seconds ? new Date(ts.seconds * 1000).toLocaleDateString() : '—';

export default function SopManager({
  sops,
  selectedDept,
  deptName,
  onSaveDraft,
  onUpdateSop,
  onActivate,
  onArchive,
  onDelete,
}) {
  const [importTitle, setImportTitle] = useState('');
  const [importText, setImportText] = useState('');
  const [editing, setEditing] = useState(null); // { id|null, title, body, fromActive }
  const [proposal, setProposal] = useState(null); // refine preview { title, body, changes }
  const [busy, setBusy] = useState(null); // 'build' | 'refine' | 'save' | null
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind: 'activate'|'delete'|'archive', id }
  const [expandedId, setExpandedId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const deptSops = sops
    .filter((s) => s.department === selectedDept)
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  const active = deptSops.find((s) => s.status === 'active') ?? null;
  const drafts = deptSops.filter((s) => s.status === 'draft');
  const archived = deptSops.filter((s) => s.status === 'archived');
  const nextVersion = deptSops.reduce((m, s) => Math.max(m, s.version ?? 0), 0) + 1;

  const flash = (msg) => {
    setStatus(msg);
    setError('');
  };
  const fail = (err, fallback) => {
    setError(fetchErrorMessage(err, 'The request timed out — try again.', fallback));
    setStatus('');
  };

  const saveDraft = async ({ title, body, source }) => {
    setBusy('save');
    try {
      await onSaveDraft({ department: selectedDept, title, body, version: nextVersion, source });
      flash(`Draft v${nextVersion} saved — review and activate it below.`);
      return true;
    } catch (err) {
      fail(err, 'Could not save the draft.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const handleImportVerbatim = async () => {
    if (importText.trim().length < 100) return setError('Paste the SOP text first (at least a few paragraphs).');
    if (await saveDraft({ title: importTitle || `${deptName} SOP`, body: importText.trim(), source: 'manual' })) {
      setImportText('');
      setImportTitle('');
    }
  };

  const handleBuild = async () => {
    if (importText.trim().length < 100) return setError('Paste the raw document first (at least a few paragraphs).');
    setBusy('build');
    setError('');
    setStatus('Structuring the document…');
    try {
      const { sop } = await apiFetch('/api/refine-sop', { mode: 'build', rawText: importText, department: selectedDept }, 90_000);
      await onSaveDraft({ department: selectedDept, title: importTitle || sop.title, body: sop.body, version: nextVersion, source: 'ai-build' });
      flash(
        sop.notes?.length
          ? `Draft v${nextVersion} saved. Review notes: ${sop.notes.join(' · ')}`
          : `Draft v${nextVersion} saved — review and activate it below.`
      );
      setImportText('');
      setImportTitle('');
    } catch (err) {
      fail(err, 'Could not build the SOP.');
    } finally {
      setBusy(null);
    }
  };

  const handleRefine = async () => {
    if (!active) return;
    if (importText.trim().length < 100) return setError('Paste the new material first (at least a few paragraphs).');
    setBusy('refine');
    setError('');
    setStatus('Comparing against the current SOP…');
    try {
      const { sop } = await apiFetch(
        '/api/refine-sop',
        { mode: 'refine', rawText: importText, currentSop: active.body, department: selectedDept },
        90_000
      );
      setProposal(sop);
      setStatus('');
    } catch (err) {
      fail(err, 'Could not refine the SOP.');
    } finally {
      setBusy(null);
    }
  };

  const handleSaveProposal = async () => {
    if (!proposal) return;
    if (await saveDraft({ title: proposal.title, body: proposal.body, source: 'ai-refine' })) {
      setProposal(null);
      setImportText('');
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    if (editing.body.trim().length < 100) return setError('The SOP body is too short to save.');
    setBusy('save');
    setError('');
    try {
      if (editing.id && !editing.fromActive) {
        await onUpdateSop(editing.id, { title: editing.title.trim() || 'Untitled SOP', body: editing.body });
        flash('Draft updated.');
      } else {
        // Editing the active SOP (or a new doc) never mutates it — a new draft version is created.
        await onSaveDraft({
          department: selectedDept,
          title: editing.title.trim() || 'Untitled SOP',
          body: editing.body,
          version: nextVersion,
          source: 'manual',
        });
        flash(`Saved as draft v${nextVersion} — activate it to replace the current version.`);
      }
      setEditing(null);
    } catch (err) {
      fail(err, 'Could not save the SOP.');
    } finally {
      setBusy(null);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy('save');
    setError('');
    try {
      if (confirm.kind === 'activate') {
        await onActivate(confirm.id, selectedDept);
        flash('Activated — AI features now ground in this version (server refresh within ~1 min).');
      } else if (confirm.kind === 'archive') {
        await onArchive(confirm.id);
        flash('Archived. With no active SOP, AI features use the built-in fallback context.');
      } else if (confirm.kind === 'delete') {
        await onDelete(confirm.id);
        flash('Draft deleted.');
      }
    } catch (err) {
      fail(err, 'The action failed.');
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const sopCard = (sop, actions) => (
    <div key={sop.id} className={`sop-card card ${sop.status === 'active' ? 'sop-card--active' : ''}`}>
      <div className="sop-card__head">
        <div>
          <span className="sop-card__title">{sop.title}</span>
          <span className="sop-card__meta">
            v{sop.version} · {sop.source ?? 'manual'} · {fmtDate(sop.activatedAt ?? sop.createdAt)}
          </span>
        </div>
        <span className={`sop-card__badge sop-card__badge--${sop.status}`}>{sop.status}</span>
      </div>
      <pre className={`sop-card__body ${expandedId === sop.id ? 'is-expanded' : ''}`}>{sop.body}</pre>
      <div className="sop-card__actions">
        <button className="linkbtn" onClick={() => setExpandedId(expandedId === sop.id ? null : sop.id)}>
          {expandedId === sop.id ? 'Collapse' : 'Read full text'}
        </button>
        {actions}
      </div>
      {confirm?.id === sop.id && (
        <div className="sop-card__confirm">
          <span>
            {confirm.kind === 'activate' && 'Make this the live SOP for this department?'}
            {confirm.kind === 'archive' && 'Archive the live SOP? AI features fall back to the built-in context.'}
            {confirm.kind === 'delete' && 'Permanently delete this draft?'}
          </span>
          <button className="btn btn--primary btn--sm" onClick={runConfirm} disabled={busy === 'save'}>
            {busy === 'save' ? 'Working…' : 'Confirm'}
          </button>
          <button className="btn btn--sm" onClick={() => setConfirm(null)}>Cancel</button>
        </div>
      )}
    </div>
  );

  return (
    <section className="sops view-enter">
      <header className="sops__header">
        <h1 className="overview__title">
          SOPs<span className="title-dept"> · {deptName}</span>
        </h1>
        <p className="overview__lede">
          The <strong>active</strong> SOP version grounds scenario generation, coaching, practice
          calls, and Spot the Error for this department. Drafts never affect anything until you
          activate them.
        </p>
      </header>

      {status && <div className="sops__status">{status}</div>}
      {error && <div className="sops__error">{error}</div>}

      {/* ── Editor (modal-ish inline panel) ─────────────────────────────── */}
      {editing ? (
        <div className="card sops__editor">
          <h3>{editing.id && !editing.fromActive ? 'Edit draft' : `New draft v${nextVersion}`}</h3>
          <input
            className="sops__input"
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            placeholder="SOP title"
          />
          <textarea
            className="sops__textarea"
            value={editing.body}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            rows={18}
          />
          <div className="sops__editor-actions">
            <button className="btn btn--primary" onClick={handleSaveEdit} disabled={busy === 'save'}>
              {busy === 'save' ? 'Saving…' : editing.id && !editing.fromActive ? 'Save changes' : `Save as draft v${nextVersion}`}
            </button>
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Active version ────────────────────────────────────────────── */}
          <h3 className="sops__section-title">Active version</h3>
          {active ? (
            sopCard(
              active,
              <>
                <button
                  className="linkbtn"
                  onClick={() => setEditing({ id: active.id, title: active.title, body: active.body, fromActive: true })}
                >
                  Edit as new draft
                </button>
                <button className="linkbtn linkbtn--danger" onClick={() => setConfirm({ kind: 'archive', id: active.id })}>
                  Archive
                </button>
              </>
            )
          ) : (
            <div className="card sops__empty">
              No live SOP for {deptName} yet — AI features are using the built-in fallback context.
              Import one below to take control of the grounding (this is how a new department goes live).
            </div>
          )}

          {/* ── Drafts awaiting review ────────────────────────────────────── */}
          {drafts.length > 0 && (
            <>
              <h3 className="sops__section-title">Drafts awaiting review</h3>
              {drafts.map((d) =>
                sopCard(
                  d,
                  <>
                    <button
                      className="linkbtn"
                      onClick={() => setEditing({ id: d.id, title: d.title, body: d.body, fromActive: false })}
                    >
                      Edit
                    </button>
                    <button className="linkbtn" onClick={() => setConfirm({ kind: 'activate', id: d.id })}>
                      Activate
                    </button>
                    <button className="linkbtn linkbtn--danger" onClick={() => setConfirm({ kind: 'delete', id: d.id })}>
                      Delete
                    </button>
                  </>
                )
              )}
            </>
          )}

          {/* ── Refine proposal preview ───────────────────────────────────── */}
          {proposal && (
            <div className="card sops__proposal">
              <h3>Proposed update: {proposal.title}</h3>
              <ul className="sops__changes">
                {proposal.changes.map((c, i) => (
                  <li key={i}>
                    <span className={`sops__change-type sops__change-type--${c.type}`}>
                      {CHANGE_LABELS[c.type]}
                    </span>{' '}
                    {c.summary}
                  </li>
                ))}
                {proposal.changes.length === 0 && <li>No substantive changes detected.</li>}
              </ul>
              <pre className="sop-card__body is-expanded">{proposal.body}</pre>
              <div className="sops__editor-actions">
                <button className="btn btn--primary" onClick={handleSaveProposal} disabled={busy === 'save'}>
                  {busy === 'save' ? 'Saving…' : `Save as draft v${nextVersion}`}
                </button>
                <button className="btn" onClick={() => setProposal(null)}>Discard</button>
              </div>
            </div>
          )}

          {/* ── Import / build / refine ───────────────────────────────────── */}
          <h3 className="sops__section-title">Add or update the SOP</h3>
          <div className="card sops__import">
            <input
              className="sops__input"
              value={importTitle}
              onChange={(e) => setImportTitle(e.target.value)}
              placeholder={`Title (optional — e.g. "${deptName} SOP")`}
            />
            <textarea
              className="sops__textarea"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={10}
              placeholder="Paste the SOP text, an updated guide, or new floor rules here…"
            />
            <div className="sops__import-actions">
              <button className="btn btn--primary" onClick={handleBuild} disabled={!!busy}>
                {busy === 'build' ? 'Building…' : 'Build with AI'}
              </button>
              {active && (
                <button className="btn" onClick={handleRefine} disabled={!!busy}>
                  {busy === 'refine' ? 'Comparing…' : 'Refine current SOP with this'}
                </button>
              )}
              <button className="btn" onClick={handleImportVerbatim} disabled={!!busy}>
                Save verbatim as draft
              </button>
            </div>
            <p className="sops__hint">
              <strong>Build with AI</strong> restructures a raw document into the standard six-domain
              layout. <strong>Refine</strong> merges new material into the active SOP and flags every
              contradiction or outdated rule. Both save a draft for your review — nothing goes live
              until you activate it.
            </p>
          </div>

          {/* ── Archived ──────────────────────────────────────────────────── */}
          {archived.length > 0 && (
            <>
              <button className="linkbtn sops__archived-toggle" onClick={() => setShowArchived(!showArchived)}>
                {showArchived ? 'Hide' : 'Show'} archived versions ({archived.length})
              </button>
              {showArchived &&
                archived.map((a) =>
                  sopCard(
                    a,
                    <button className="linkbtn" onClick={() => setConfirm({ kind: 'activate', id: a.id })}>
                      Restore as active
                    </button>
                  )
                )}
            </>
          )}
        </>
      )}
    </section>
  );
}
