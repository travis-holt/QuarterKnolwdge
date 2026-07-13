// SOP Manager (F24) — supervisor tab for adding, building, refining, and
// activating department SOPs.
//
// Each SOP is a versioned Firestore doc (draft → active → archived); at most one
// version per department is active. The ACTIVE version grounds all AI features
// server-side (api/_sop-store.js); when none exists the server falls back to the
// hardcoded contexts in api/_sop-context.js.
//
// SOURCE INPUT: drag-and-drop / browse upload (PDF sent to Gemini natively;
// TXT/MD read into the paste area) or pasted text.
//
// AI assistance (both advisory — output is always saved as a DRAFT for review):
//   • "Build with AI"  — structures a raw document into the standard 6-domain
//     SOP layout (/api/refine-sop mode 'build').
//   • "Refine current" — merges new material into the active SOP, flagging
//     every contradiction / outdated rule / addition (mode 'refine').
// Every AI draft also carries a FIDELITY AUDIT — a second AI pass that lists
// source rules missing from the draft (omissions) and draft statements not
// traceable to the source (inventions) — shown on the draft until activated.
import { useRef, useState } from 'react';
import { apiFetch, fetchErrorMessage } from '../lib/apiFetch.js';
import { timestampMillis } from '../lib/time.js';

const CHANGE_LABELS = {
  contradiction: 'Contradiction',
  outdated: 'Outdated rule',
  addition: 'Addition',
  clarification: 'Clarification',
};

const SOURCE_LABELS = { manual: 'manual', 'ai-build': 'AI build', 'ai-refine': 'AI refine', probe: 'probe' };

const MAX_PDF_BYTES = 10 * 1024 * 1024;

const fmtDate = (ts) =>
  timestampMillis(ts)
    ? new Date(timestampMillis(ts)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

const wordCount = (body) => (body ?? '').trim().split(/\s+/).filter(Boolean).length;

// ── Document parsing: ALL-CAPS lines become section headings ─────────────────
function isHeadingLine(line) {
  const t = line.trim();
  if (t.length < 3 || t.length > 80) return false;
  if (!/[A-Z]/.test(t) || /[a-z]/.test(t)) return false;
  return /^[0-9. ]*[A-Z][A-Z0-9 &/()':,+.\-—–]*$/.test(t);
}

function parseSopSections(body) {
  const lines = (body ?? '').split('\n');
  const sections = [];
  const preamble = [];
  let current = null;
  for (const line of lines) {
    if (isHeadingLine(line)) {
      current = { heading: line.trim().replace(/^[0-9. ]+/, ''), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (sections.length < 2) return null;
  return {
    preamble: preamble.join('\n').trim(),
    sections: sections.map((s) => ({ heading: s.heading, text: s.lines.join('\n').trim() })),
  };
}

// Rendered document view — parsed sections when the body has headings,
// otherwise a plain preformatted fallback.
function SopDoc({ body, expanded }) {
  const parsed = parseSopSections(body);
  return (
    <div className={`sopdoc ${expanded ? 'is-expanded' : ''}`}>
      {parsed ? (
        <>
          {parsed.preamble && <p className="sopdoc__preamble">{parsed.preamble}</p>}
          {parsed.sections.map((s, i) => (
            <section className="sopdoc__section" key={i}>
              <h4 className="sopdoc__heading">
                <span className="sopdoc__num">{String(i + 1).padStart(2, '0')}</span>
                {s.heading}
              </h4>
              {s.text.split('\n').filter((l) => l.trim()).map((line, j) => {
                const bullet = /^\s*[-•]\s*/.test(line);
                return (
                  <p key={j} className={`sopdoc__line ${bullet ? 'sopdoc__line--rule' : ''}`}>
                    {line.replace(/^\s*[-•]\s*/, '')}
                  </p>
                );
              })}
            </section>
          ))}
        </>
      ) : (
        <pre className="sopdoc__raw">{body}</pre>
      )}
      {!expanded && <div className="sopdoc__fade" aria-hidden="true" />}
    </div>
  );
}

// ── Fidelity audit display ────────────────────────────────────────────────────
function AuditBadge({ sop }) {
  if (sop.source !== 'ai-build' && sop.source !== 'ai-refine') return null;
  const audit = sop.audit;
  if (!audit) return <span className="sops__audit-chip sops__audit-chip--na">Fidelity check unavailable</span>;
  const issues = (audit.omissions?.length ?? 0) + (audit.inventions?.length ?? 0);
  if (issues === 0) return <span className="sops__audit-chip sops__audit-chip--pass">✓ Fidelity check passed</span>;
  return (
    <span className="sops__audit-chip sops__audit-chip--warn">
      ⚠ {issues} fidelity finding{issues > 1 ? 's' : ''}
    </span>
  );
}

function AuditDetail({ audit }) {
  if (!audit) return null;
  const { omissions = [], inventions = [] } = audit;
  if (!omissions.length && !inventions.length) return null;
  return (
    <div className="sops__audit-detail">
      {omissions.length > 0 && (
        <div className="sops__audit-group sops__audit-group--omission">
          <strong>Possibly missing from the draft (check the source):</strong>
          <ul>{omissions.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </div>
      )}
      {inventions.length > 0 && (
        <div className="sops__audit-group sops__audit-group--invention">
          <strong>In the draft but not found in the source (verify or remove):</strong>
          <ul>{inventions.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

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
  const [srcFile, setSrcFile] = useState(null); // { name, sizeKb, mimeType, data(base64) }
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(null); // { id|null, title, body, fromActive }
  const [proposal, setProposal] = useState(null); // refine preview { title, body, changes, audit }
  const [busy, setBusy] = useState(null); // 'build' | 'refine' | 'save' | null
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind: 'activate'|'delete'|'archive', id }
  const [expandedId, setExpandedId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const fileInputRef = useRef(null);

  const deptSops = sops
    .filter((s) => s.department === selectedDept)
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  const active = deptSops.find((s) => s.status === 'active') ?? null;
  const drafts = deptSops.filter((s) => s.status === 'draft');
  const archived = deptSops.filter((s) => s.status === 'archived');
  const nextVersion = deptSops.reduce((m, s) => Math.max(m, s.version ?? 0), 0) + 1;

  const hasSource = !!srcFile || importText.trim().length >= 100;

  const flash = (msg) => { setStatus(msg); setError(''); };
  const fail = (err, fallback) => {
    setError(fetchErrorMessage(err, 'The request timed out — try again.', fallback));
    setStatus('');
  };

  // ── File intake (drop zone + browse) ────────────────────────────────────────
  const handleFiles = (fileList) => {
    const f = fileList?.[0];
    if (!f) return;
    const name = f.name.toLowerCase();
    if (f.type === 'application/pdf' || name.endsWith('.pdf')) {
      if (f.size > MAX_PDF_BYTES) return setError('PDF too large — 10 MB max.');
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result).split(',')[1] ?? '';
        setSrcFile({ name: f.name, sizeKb: Math.max(1, Math.round(f.size / 1024)), mimeType: 'application/pdf', data: base64 });
        setError('');
        setStatus('');
      };
      reader.onerror = () => setError('Could not read the file.');
      reader.readAsDataURL(f);
    } else if (name.endsWith('.txt') || name.endsWith('.md') || f.type.startsWith('text/')) {
      const reader = new FileReader();
      reader.onload = () => {
        setImportText(String(reader.result));
        setSrcFile(null);
        setError('');
      };
      reader.onerror = () => setError('Could not read the file.');
      reader.readAsText(f);
    } else {
      setError('Unsupported file type — use PDF, TXT, or MD (export Word documents as PDF).');
    }
  };

  const sourcePayload = () =>
    srcFile ? { file: { mimeType: srcFile.mimeType, data: srcFile.data } } : { rawText: importText };

  const clearImport = () => {
    setImportText('');
    setImportTitle('');
    setSrcFile(null);
  };

  // ── Draft persistence ───────────────────────────────────────────────────────
  const saveDraft = async (sop) => {
    setBusy('save');
    try {
      await onSaveDraft({ department: selectedDept, version: nextVersion, ...sop });
      flash(`Draft v${nextVersion} saved — review it below, then activate.`);
      return true;
    } catch (err) {
      fail(err, 'Could not save the draft.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const handleImportVerbatim = async () => {
    if (importText.trim().length < 100) {
      return setError('Verbatim save needs pasted text (PDFs go through "Build with AI").');
    }
    if (await saveDraft({ title: importTitle || `${deptName} SOP`, body: importText.trim(), source: 'manual' })) {
      clearImport();
    }
  };

  const handleBuild = async () => {
    if (!hasSource) return setError('Upload a document or paste the SOP text first.');
    setBusy('build');
    setError('');
    setStatus('Structuring the document, then running the fidelity check — this can take a minute…');
    try {
      const { sop } = await apiFetch(
        '/api/refine-sop',
        { mode: 'build', department: selectedDept, ...sourcePayload() },
        180_000
      );
      await onSaveDraft({
        department: selectedDept,
        version: nextVersion,
        title: importTitle || sop.title,
        body: sop.body,
        source: 'ai-build',
        notes: sop.notes ?? [],
        audit: sop.audit ?? null,
      });
      flash(`Draft v${nextVersion} saved with its fidelity report — review it below, then activate.`);
      clearImport();
    } catch (err) {
      fail(err, 'Could not build the SOP.');
    } finally {
      setBusy(null);
    }
  };

  const handleRefine = async () => {
    if (!active) return;
    if (!hasSource) return setError('Upload or paste the new material first.');
    setBusy('refine');
    setError('');
    setStatus('Comparing against the current SOP, then running the fidelity check — this can take a minute…');
    try {
      const { sop } = await apiFetch(
        '/api/refine-sop',
        { mode: 'refine', department: selectedDept, currentSop: active.body, ...sourcePayload() },
        180_000
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
    const ok = await saveDraft({
      title: proposal.title,
      body: proposal.body,
      source: 'ai-refine',
      changes: proposal.changes ?? [],
      audit: proposal.audit ?? null,
    });
    if (ok) {
      setProposal(null);
      clearImport();
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
        // Editing the active SOP never mutates it — a new draft version is created.
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

  const confirmBar = (sop) =>
    confirm?.id === sop.id && (
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
    );

  const metaChips = (sop) => (
    <div className="sop-chips">
      <span className="sop-chip">v{sop.version}</span>
      <span className="sop-chip">{SOURCE_LABELS[sop.source] ?? sop.source ?? 'manual'}</span>
      <span className="sop-chip">{fmtDate(sop.activatedAt ?? sop.createdAt)}</span>
      <span className="sop-chip">{parseSopSections(sop.body)?.sections.length ?? '—'} sections</span>
      <span className="sop-chip">{wordCount(sop.body).toLocaleString()} words</span>
      <AuditBadge sop={sop} />
    </div>
  );

  // A draft/archived entry in the version timeline.
  const timelineCard = (sop, actions) => {
    const expanded = expandedId === sop.id;
    return (
      <div key={sop.id} className={`sop-entry sop-entry--${sop.status}`}>
        <div className="sop-entry__rail" aria-hidden="true"><span className="sop-entry__dot" /></div>
        <div className="sop-entry__card card">
          <div className="sop-card__head">
            <span className="sop-card__title">{sop.title}</span>
            <span className={`sop-card__badge sop-card__badge--${sop.status}`}>{sop.status}</span>
          </div>
          {metaChips(sop)}
          {sop.notes?.length > 0 && (
            <div className="sops__notes">
              {sop.notes.map((n, i) => <span key={i} className="sops__note-chip">✎ {n}</span>)}
            </div>
          )}
          {sop.changes?.length > 0 && (
            <ul className="sops__changes">
              {sop.changes.map((c, i) => (
                <li key={i}>
                  <span className={`sops__change-type sops__change-type--${c.type}`}>{CHANGE_LABELS[c.type]}</span>{' '}
                  {c.summary}
                </li>
              ))}
            </ul>
          )}
          <AuditDetail audit={sop.audit} />
          <SopDoc body={sop.body} expanded={expanded} />
          <div className="sop-card__actions">
            <button className="linkbtn" onClick={() => setExpandedId(expanded ? null : sop.id)}>
              {expanded ? 'Collapse' : 'Read full document'}
            </button>
            {actions}
          </div>
          {confirmBar(sop)}
        </div>
      </div>
    );
  };

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

      {status && <div className="sops__status">{busy && <span className="sops__spinner" aria-hidden="true" />}{status}</div>}
      {error && <div className="sops__error">{error}</div>}

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
            rows={20}
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
          {/* ── Active version hero ───────────────────────────────────────── */}
          {active ? (
            <div className="sop-hero card">
              <div className="sop-hero__top">
                <span className="sop-hero__live"><span className="sop-hero__pulse" aria-hidden="true" />Live — grounding AI features</span>
                <div className="sop-hero__actions">
                  <button
                    className="linkbtn"
                    onClick={() => setEditing({ id: active.id, title: active.title, body: active.body, fromActive: true })}
                  >
                    Edit as new draft
                  </button>
                  <button className="linkbtn linkbtn--danger" onClick={() => setConfirm({ kind: 'archive', id: active.id })}>
                    Archive
                  </button>
                </div>
              </div>
              <h2 className="sop-hero__title">{active.title}</h2>
              {metaChips(active)}
              <SopDoc body={active.body} expanded={expandedId === active.id} />
              <button className="linkbtn" onClick={() => setExpandedId(expandedId === active.id ? null : active.id)}>
                {expandedId === active.id ? 'Collapse' : 'Read full document'}
              </button>
              {confirmBar(active)}
            </div>
          ) : (
            <div className="sop-hero sop-hero--empty card">
              <span className="sop-hero__nolive">No live SOP yet</span>
              <p>
                AI features for {deptName} currently run on the built-in fallback context. Import the
                department's SOP below and activate it to take control of the grounding — this is
                also how a new department goes live.
              </p>
            </div>
          )}

          {/* ── Drafts awaiting review ────────────────────────────────────── */}
          {drafts.length > 0 && (
            <>
              <h3 className="sops__section-title">Drafts awaiting review</h3>
              <div className="sop-timeline">
                {drafts.map((d) =>
                  timelineCard(
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
              </div>
            </>
          )}

          {/* ── Refine proposal preview ───────────────────────────────────── */}
          {proposal && (
            <div className="card sops__proposal">
              <h3>Proposed update: {proposal.title}</h3>
              <ul className="sops__changes">
                {(proposal.changes ?? []).map((c, i) => (
                  <li key={i}>
                    <span className={`sops__change-type sops__change-type--${c.type}`}>{CHANGE_LABELS[c.type]}</span>{' '}
                    {c.summary}
                  </li>
                ))}
                {(proposal.changes ?? []).length === 0 && <li>No substantive changes detected.</li>}
              </ul>
              <AuditDetail audit={proposal.audit} />
              <SopDoc body={proposal.body} expanded />
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
            <div
              className={`sops__dropzone ${dragging ? 'is-dragging' : ''} ${srcFile ? 'has-file' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                hidden
                onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
              />
              {srcFile ? (
                <div className="sops__filechip">
                  <span className="sops__filechip-icon" aria-hidden="true">⎘</span>
                  <span className="sops__filechip-name">{srcFile.name}</span>
                  <span className="sops__filechip-size">{srcFile.sizeKb.toLocaleString()} KB</span>
                  <button
                    className="sops__filechip-remove"
                    onClick={(e) => { e.stopPropagation(); setSrcFile(null); }}
                    aria-label="Remove file"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <span className="sops__dropzone-icon" aria-hidden="true">⇪</span>
                  <span className="sops__dropzone-text">
                    <strong>Drop the SOP document here</strong> or click to browse
                  </span>
                  <span className="sops__dropzone-hint">PDF · TXT · MD — Word docs: export as PDF</span>
                </>
              )}
            </div>

            <div className="sops__or" aria-hidden="true"><span>or paste text</span></div>

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
              rows={8}
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
              <button className="btn" onClick={handleImportVerbatim} disabled={!!busy || !!srcFile}>
                Save verbatim as draft
              </button>
            </div>
            <p className="sops__hint">
              <strong>Build with AI</strong> restructures a document into the standard six-domain
              layout. <strong>Refine</strong> merges new material into the active SOP and flags every
              contradiction or outdated rule. Every AI draft ships with a <strong>fidelity report</strong> —
              a second pass that lists anything missing from, or invented beyond, your source. Nothing
              goes live until you activate it.
            </p>
          </div>

          {/* ── Archived versions ─────────────────────────────────────────── */}
          {archived.length > 0 && (
            <>
              <button className="linkbtn sops__archived-toggle" onClick={() => setShowArchived(!showArchived)}>
                {showArchived ? 'Hide' : 'Show'} archived versions ({archived.length})
              </button>
              {showArchived && (
                <div className="sop-timeline">
                  {archived.map((a) =>
                    timelineCard(
                      a,
                      <button className="linkbtn" onClick={() => setConfirm({ kind: 'activate', id: a.id })}>
                        Restore as active
                      </button>
                    )
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
