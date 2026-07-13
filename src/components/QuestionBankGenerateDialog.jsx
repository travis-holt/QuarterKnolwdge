import { useEffect, useRef, useState } from 'react';
import { DOMAINS } from '../data/questions.js';

// Accessible modal for "Generate scenarios from the SOP". Keeps the same
// domain/count/generate contract the old inline form had — it's just no
// longer permanently taking up page space. Escape closes it; focus returns to
// the trigger button (passed in as `returnFocusRef`) on close.
export default function QuestionBankGenerateDialog({ onGenerate, onClose, onGenerated, returnFocusRef }) {
  const [genDomain, setGenDomain] = useState(DOMAINS[0].id);
  const [genCount, setGenCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState(null); // { kind: 'ok'|'err', text }
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current?.querySelector('select,button,input')?.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    onClose();
    returnFocusRef?.current?.focus();
  };

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

  return (
    <div className="qbank-dialog__overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div
        className="qbank-dialog card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qbank-dialog-title"
        ref={dialogRef}
      >
        <div className="qbank-dialog__head">
          <h2 id="qbank-dialog-title" className="overview__panel-title">Generate questions from the SOP</h2>
          <button className="qbank-dialog__close" type="button" aria-label="Close dialog" onClick={close}>×</button>
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
          <button className="btn btn--ghost btn--sm" type="button" onClick={close}>
            {message?.kind === 'ok' ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
