import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DOMAINS } from '../data/questions.js';

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Accessible, truly modal dialog for "Generate scenarios from the SOP". Keeps
// the same domain/count/generate contract the old inline form had — it's
// just no longer permanently taking up page space.
//
// Modality (portal + inert background + manual focus trap, rather than a
// native <dialog> — jsdom's showModal()/close() support is inconsistent, and
// this approach behaves identically in unit tests and real browsers):
//  - Rendered via a portal directly under document.body (NOT a descendant of
//    #root), so marking #root inert doesn't also disable the dialog itself.
//  - #root gets `inert` + `aria-hidden="true"` while open, restored on close.
//  - Tab/Shift+Tab are intercepted to loop focus within the dialog's own
//    focusable elements — a manual trap, independent of inert support.
//  - Escape / backdrop click / the × button / Cancel are all suppressed
//    while a generation is in flight (`generating`), so the dialog cannot be
//    dismissed mid-request — this is half of the fix for the stale
//    generation-completion race (see QuestionBank.jsx for the other half:
//    department/request tagging).
//  - Focus returns to the trigger button (`returnFocusRef`) on close.
export default function QuestionBankGenerateDialog({ onGenerate, onClose, onGenerated, returnFocusRef }) {
  const [genDomain, setGenDomain] = useState(DOMAINS[0].id);
  const [genCount, setGenCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState(null); // { kind: 'ok'|'err', text }
  const dialogRef = useRef(null);
  const generatingRef = useRef(false);

  useEffect(() => {
    generatingRef.current = generating;
  }, [generating]);

  const close = () => {
    if (generatingRef.current) return; // suppressed while a generation is in flight
    onClose();
    returnFocusRef?.current?.focus();
  };

  // Mark the app root inert while this (portaled) dialog is open, and focus
  // the first control inside it.
  useEffect(() => {
    const rootEl = document.getElementById('root');
    if (rootEl) {
      rootEl.inert = true;
      rootEl.setAttribute('aria-hidden', 'true');
    }
    dialogRef.current?.querySelector(FOCUSABLE_SELECTOR)?.focus();
    return () => {
      if (rootEl) {
        rootEl.inert = false;
        rootEl.removeAttribute('aria-hidden');
      }
    };
  }, []);

  // Escape-to-close (suppressed while generating) + manual Tab containment.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runGenerate = async () => {
    setGenerating(true);
    setMessage(null);
    try {
      const n = await onGenerate({ domainId: genDomain, count: Number(genCount) || 1 });
      const text = `${n} draft scenario${n === 1 ? '' : 's'} added to the Review Queue.`;
      setMessage({ kind: 'ok', text });
      onGenerated?.(text);
    } catch (err) {
      setMessage({ kind: 'err', text: err?.message || 'Generation failed. Check the server logs.' });
    } finally {
      setGenerating(false);
    }
  };

  return createPortal(
    <div
      className="qbank-dialog__overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        className="qbank-dialog card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qbank-dialog-title"
        ref={dialogRef}
      >
        <div className="qbank-dialog__head">
          <h2 id="qbank-dialog-title" className="overview__panel-title">Generate questions from the SOP</h2>
          <button className="qbank-dialog__close" type="button" aria-label="Close dialog" onClick={close} disabled={generating}>×</button>
        </div>
        <p className="readoff__sub">
          Drafts are created for your review — nothing goes live until you activate it in the Review Queue.
        </p>
        <div className="qbank__gen-row">
          <label className="qedit__field">
            <span className="qedit__label" id="qbank-gen-domain-label">Domain</span>
            <select
              className="qedit__select"
              aria-labelledby="qbank-gen-domain-label"
              value={genDomain}
              onChange={(e) => setGenDomain(e.target.value)}
              disabled={generating}
            >
              {DOMAINS.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label className="qedit__field">
            <span className="qedit__label" id="qbank-gen-count-label">How many</span>
            <input
              className="qedit__select"
              type="number"
              min={1}
              max={8}
              aria-labelledby="qbank-gen-count-label"
              value={genCount}
              onChange={(e) => setGenCount(e.target.value)}
              disabled={generating}
            />
          </label>
          <button className="btn btn--primary" type="button" onClick={runGenerate} disabled={generating}>
            {generating ? 'Generating…' : 'Generate scenarios'}
          </button>
        </div>
        {message && (
          <p className={`qbank__msg ${message.kind === 'err' ? 'is-err' : 'is-ok'}`} role="status">{message.text}</p>
        )}
        <div className="qbank-dialog__foot">
          <button className="btn btn--ghost btn--sm" type="button" onClick={close} disabled={generating}>
            {message?.kind === 'ok' ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
