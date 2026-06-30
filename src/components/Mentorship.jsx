import { useState } from 'react';
import { buildMentorMatches, pairingOutcomes, readinessTally } from '../lib/scoring.js';
import { domainName } from '../data/questions.js';
import { LEVELS } from '../data/config.js';

function DeltaBadge({ delta }) {
  if (delta === null || delta === undefined) return <span className="ac__note">No data yet</span>;
  const sign = delta >= 0 ? '+' : '';
  return (
    <span className={`ac__delta ${delta >= 0 ? 'ac__delta--up' : 'ac__delta--down'}`}>
      {sign}{Math.round(delta)} pts
    </span>
  );
}

export default function Mentorship({ rows, savedPairings = [], onSavePairing, onUpdatePairing, onOpenNavigator }) {
  const { pairings: suggested, unmatched, load } = buildMentorMatches(rows);
  const outcomes = pairingOutcomes(savedPairings, rows);
  const readiness = readinessTally(rows);
  const [saving, setSaving] = useState(null);

  const handleAssign = async (pairing) => {
    setSaving(`${pairing.menteeName}-${pairing.domainId}`);
    try {
      await onSavePairing(pairing);
    } finally {
      setSaving(null);
    }
  };

  // Active pairings (status='active')
  const active = savedPairings.filter((p) => p.status === 'active');

  return (
    <section className="mentorship stagger">
      <header className="overview__head">
        <h1 className="overview__title">Mentorship</h1>
        <p className="overview__lede">
          Load-balanced mentor pairings from the current capability map. Assign a pairing to persist
          it — outcome deltas update automatically as mentees retake the check.
        </p>
      </header>

      {/* ── Suggested pairings ─────────────────────────────────────────── */}
      <div className="card overview__panel">
        <h2 className="overview__panel-title">Suggested pairings</h2>
        {suggested.length === 0 ? (
          <p className="readoff__empty">
            No pairings to suggest — every domain either has no mentor or no mentees, or all mentors
            are at capacity.
          </p>
        ) : (
          <>
            <div className="mentorship__grid">
              {suggested.map((p) => {
                const key = `${p.menteeName}-${p.domainId}`;
                const alreadySaved = savedPairings.some(
                  (sp) => sp.menteeName === p.menteeName && sp.domainId === p.domainId && sp.status === 'active'
                );
                return (
                  <div key={key} className="card mentorship__pair">
                    <div className="mentorship__pair-domain">
                      <span className="tag">{domainName(p.domainId)}</span>
                    </div>
                    <div className="mentorship__pair-people">
                      <div className="mentorship__person">
                        <span className="ac__note">Mentor</span>
                        <button className="linkbtn" onClick={() => onOpenNavigator(p.mentorName)}>
                          {p.mentorName}
                        </button>
                        <span className="ac__note">({load[p.mentorName] ?? 1} paired)</span>
                      </div>
                      <div className="mentorship__arrow">→</div>
                      <div className="mentorship__person">
                        <span className="ac__note">Mentee</span>
                        <button className="linkbtn" onClick={() => onOpenNavigator(p.menteeName)}>
                          {p.menteeName}
                        </button>
                        <span
                          className="level-chip"
                          style={{ background: LEVELS[p.menteeLevel]?.color, color: LEVELS[p.menteeLevel]?.text, fontSize: '0.7rem', padding: '1px 8px' }}
                        >
                          {LEVELS[p.menteeLevel]?.label}
                        </span>
                      </div>
                    </div>
                    {alreadySaved ? (
                      <span className="ac__note ac__note--positive">✓ Active</span>
                    ) : (
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => handleAssign(p)}
                        disabled={saving === key}
                      >
                        {saving === key ? 'Saving…' : 'Assign'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {unmatched.length > 0 && (
              <p className="readoff__sub" style={{ marginTop: '1rem' }}>
                {unmatched.length} mentee {unmatched.length === 1 ? 'slot' : 'slots'} unmatched (mentors
                at capacity or no teacher available for that domain).
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Active pairings + outcomes ─────────────────────────────────── */}
      <div className="card overview__panel">
        <h2 className="overview__panel-title">Active pairings</h2>
        {active.length === 0 ? (
          <p className="readoff__empty">No pairings assigned yet. Use the suggestions above.</p>
        ) : (
          <ul className="readoff__list">
            {outcomes.filter((o) => o.status === 'active').map((o, i) => (
              <li key={i} className="ac__row">
                <span className="tag">{domainName(o.domainId)}</span>
                <button className="linkbtn" onClick={() => onOpenNavigator(o.mentorName)}>
                  {o.mentorName}
                </button>
                <span className="ac__note">→</span>
                <button className="linkbtn" onClick={() => onOpenNavigator(o.menteeName)}>
                  {o.menteeName}
                </button>
                <DeltaBadge delta={o.delta} />
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => onUpdatePairing(o.id, 'completed')}
                >
                  Mark done
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Mentor capacity ────────────────────────────────────────────── */}
      {readiness.length > 0 && (
        <div className="card overview__panel">
          <h2 className="overview__panel-title">Mentor capacity</h2>
          <p className="readoff__sub">Navigators by Can-Teach depth — deepest pool is highest load capacity.</p>
          <ul className="readoff__list">
            {readiness.slice(0, 8).map((r) => {
              const currentLoad = savedPairings.filter(
                (p) => p.mentorName === r.name && p.status === 'active'
              ).length;
              return (
                <li key={r.name} className="ac__row">
                  <button className="linkbtn ac__name" onClick={() => onOpenNavigator(r.name)}>
                    {r.name}
                  </button>
                  <span className="ac__note">{r.canTeachCount} Can-Teach domains</span>
                  {currentLoad > 0 && (
                    <span className="ac__note">{currentLoad} active pairing{currentLoad !== 1 ? 's' : ''}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
