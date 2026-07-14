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
//  - #root gets `inert` + `aria-hidden="true"` while open, restored on close
//    — and restored BEFORE focus is returned to the trigger button (both
//    happen in the SAME unmount cleanup, un-inert first, then focus; doing
//    the focus() call synchronously inside the click handler instead would
//    risk running while #root is still inert, since React may not have
//    committed the unmount yet — silently failing to focus anything).
//  - Tab/Shift+Tab are intercepted to loop focus within the dialog's own
//    focusable elements — a manual trap, independent of inert support. While
//    generating, every real control is disabled (zero focusable elements),
//    so the dialog container itself (tabIndex={-1}) becomes the anchor: Tab/
//    Shift+Tab re-focus it rather than letting focus fall through to
//    document.body.
//  - Escape / backdrop click / the × button / Cancel are all suppressed
//    while a generation is in flight (`generating`), so the dialog cannot be
//    dismissed mid-request — this is half of the fix for the stale
//    generation-completion race (see QuestionBank.jsx for the other half:
//    an immutable per-request department/sequence tag threaded through the
//    whole round-trip, not read back out of a mutable ref).
export default function QuestionBankGenerateDialog({ onGenerate, onClose, onGenerated, returnFocusRef }) {
  const [genDomain, setGenDomain] = useState(DOMAINS[0].id);
  const [genCount, setGenCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState(null); // { kind: 'ok'|'err', text }
  const dialogRef = useRef(null);
  const generatingRef = useRef(false);
  const wasGeneratingRef = useRef(false);

  useEffect(() => {
    generatingRef.current = generating;
  }, [generating]);

  // Move focus to a sensible place whenever `generating` transitions: into
  // the dialog container itself when a request starts (nothing else is
  // focusable), and to a real control (Done/Cancel) once it finishes.
  useEffect(() => {
    if (generating && !wasGeneratingRef.current) {
      dialogRef.current?.focus();
    } else if (!generating && wasGeneratingRef.current) {
      const footBtn = dialogRef.current?.querySelector('.qbank-dialog__foot button');
      (footBtn ?? dialogRef.current?.querySelector(FOCUSABLE_SELECTOR))?.focus();
    }
    wasGeneratingRef.current = generating;
  }, [generating]);

  const close = () => {
    if (generatingRef.current) return; // suppressed while a generation is in flight
    onClose(); // unmounts this component; the effect cleanup below restores
    // #root (un-inert) BEFORE returning focus to the trigger button.
  };

  // Mark the app root inert while this (portaled) dialog is open, and focus
  // the first control inside it. On unmount: un-inert #root FIRST, then
  // restore focus to the trigger — same synchronous cleanup, correct order.
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
      returnFocusRef?.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        if (focusable.length === 0) {
          // Nothing enabled (mid-generation) — keep focus anchored inside
          // the dialog rather than letting Tab fall through to the page.
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (!dialogRef.current.contains(document.activeElement)) {
          // Focus drifted outside the dialog somehow — pull it back in.
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
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
      // wrappedOnGenerate (QuestionBank.jsx) resolves to { n, tag } — `tag`
      // is an immutable object created fresh for THIS request, carrying the
      // department + sequence number it was started with. Passing it back
      // through onGenerated (rather than QuestionBank re-reading whatever a
      // mutable ref currently holds) is what lets a stale, out-of-order
      // completion be told apart from the latest one.
      const { n, tag } = await onGenerate({ domainId: genDomain, count: Number(genCount) || 1 });
      const text = `${n} draft scenario${n === 1 ? '' : 's'} added to the Review Queue.`;
      setMessage({ kind: 'ok', text });
      onGenerated?.(text, tag);
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
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="qbank-dialog__head">
          <h2 id="qbank-dialog-title" className="overview__panel-title">Generate questions from the SOP</h2>
          <button className="qbank-dialog__close" type="button" aria-label="Close dialog" onClick={close} disabled={generating}>×</button>
        </div>
        <p className="readoff__sub">
          Drafts are created for your review — nothing goes live until you activate it in the Review Queue.
        </p>
        {generating && (
          <p role="status" aria-live="polite" className="sr-only">Generating scenarios, please wait…</p>
        )}
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
