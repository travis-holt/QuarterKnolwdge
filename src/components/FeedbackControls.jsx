import { useState } from 'react';

// Inline feedback is signal-only (Helpful / Inaccurate / Adjust). Approve and
// Reject are deliberately NOT here — those are actions that belong to a proposal
// in the Learning Loop review queue, where Approve actually creates a draft.
const STATUSES = [
  { id: 'helpful', label: 'Helpful' },
  { id: 'inaccurate', label: 'Inaccurate' },
  { id: 'needsAdjustment', label: 'Adjust' },
];

export default function FeedbackControls({ targetType, targetId, context = {}, onSaveFeedback, compact = false }) {
  const [saving, setSaving] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');

  if (!onSaveFeedback || !targetType || !targetId) return null;

  const save = async (status) => {
    setSaving(status);
    setError('');
    try {
      await onSaveFeedback({
        targetType,
        targetId,
        status,
        context,
      });
      setSaved(status);
    } catch (err) {
      console.error('saveSupervisorFeedback:', err);
      setError('Could not save');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className={`feedbackctl${compact ? ' feedbackctl--compact' : ''}`}>
      {STATUSES.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`btn btn--ghost btn--sm feedbackctl__btn${saved === s.id ? ' is-saved' : ''}`}
          disabled={saving !== null}
          onClick={() => save(s.id)}
        >
          {saving === s.id ? 'Saving...' : saved === s.id ? 'Saved' : s.label}
        </button>
      ))}
      {error && <span className="feedbackctl__msg is-error">{error}</span>}
    </div>
  );
}
