import { useState } from 'react';
import { DOMAINS } from '../data/questions.js';
import { LEVELS, LEVEL_ORDER } from '../data/config.js';
import { findRow } from '../lib/scoring.js';

// A compact level summary (counts per level) for a navigator card.
function levelCounts(row) {
  const counts = { learning: 0, solid: 0, canTeach: 0 };
  for (const d of DOMAINS) counts[row.levels[d.id]] += 1;
  return counts;
}

// Supervisor's Navigators tab: the full roster (everyone the supervisor has
// added) merged with results. Navigators who haven't taken the check yet show a
// "Not yet taken" state. An Add Navigator form manages the roster.
export default function Navigators({ rows, roster, deptName, onOpenNavigator, onAddNavigator }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="navigators stagger">
      <header className="overview__head navigators__head">
        <div>
          <h1 className="overview__title">
            Navigators{deptName && <span className="title-dept"> · {deptName}</span>}
          </h1>
          <p className="overview__lede">
            Everyone on the roster. Select anyone who has taken the check to open their dashboard.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Close' : '+ Add navigator'}
        </button>
      </header>

      {showForm && (
        <AddNavigatorForm
          roster={roster}
          onAdd={onAddNavigator}
          onDone={() => setShowForm(false)}
        />
      )}

      {roster.length === 0 ? (
        <div className="card empty__card">
          <h2 className="empty__title">No navigators yet</h2>
          <p className="empty__body">
            Add your team with <strong>+ Add navigator</strong>. Each person gets a 4-digit PIN you
            share with them privately — they use it to sign in and take the check.
          </p>
        </div>
      ) : (
        <div className="nav-grid">
          {roster.map((member) => {
            const row = findRow(rows, member.name);
            return row ? (
              <button
                key={member.id}
                className="card nav-card"
                onClick={() => onOpenNavigator(row.name)}
              >
                <NavigatorCardBody row={row} />
              </button>
            ) : (
              <div key={member.id} className="card nav-card nav-card--pending">
                <div className="nav-card__top">
                  <span className="nav-card__name">{member.name}</span>
                  <span className="nav-card__pending-tag">Not yet taken</span>
                </div>
                <p className="nav-card__pending-note">
                  Waiting on this navigator to complete the check.
                </p>
                <p className="nav-card__pin">PIN: {member.pin}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NavigatorCardBody({ row }) {
  const counts = levelCounts(row);
  return (
    <>
      <div className="nav-card__top">
        <span className="nav-card__name">{row.name}</span>
        <span className="nav-card__ready">{counts.canTeach} Can-Teach</span>
      </div>

      <div className="nav-card__strip" aria-hidden="true">
        {DOMAINS.map((d) => (
          <span
            key={d.id}
            className="nav-card__cell"
            title={`${d.name}: ${LEVELS[row.levels[d.id]].label}`}
            style={{ background: LEVELS[row.levels[d.id]].color }}
          />
        ))}
      </div>

      <div className="nav-card__counts">
        {LEVEL_ORDER.map((lvl) => (
          <span key={lvl} className="nav-card__count">
            <span className="legend-swatch" style={{ background: LEVELS[lvl].color }} />
            {counts[lvl]} {LEVELS[lvl].label}
          </span>
        ))}
      </div>
    </>
  );
}

function AddNavigatorForm({ roster, onAdd, onDone }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a name.');
      return;
    }
    if (!/^\d{4}$/.test(pin.trim())) {
      setError('PIN must be exactly 4 digits.');
      return;
    }
    if (roster.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('A navigator with that name already exists.');
      return;
    }
    setBusy(true);
    try {
      await onAdd(trimmed, pin.trim());
      setName('');
      setPin('');
      onDone();
    } catch {
      setError('Couldn’t save. Check the database connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card add-nav" onSubmit={submit}>
      <h2 className="overview__panel-title">Add a navigator</h2>
      <p className="readoff__sub">
        They&rsquo;ll pick their name from a list and enter this PIN to sign in. Share the PIN with
        them privately.
      </p>
      <div className="add-nav__fields">
        <label className="gate__field">
          <span className="gate__label">Name</span>
          <input
            className="gate__input"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            placeholder="e.g. Sarah Chen"
          />
        </label>
        <label className="gate__field">
          <span className="gate__label">4-digit PIN</span>
          <input
            className="gate__input"
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''));
              setError('');
            }}
            placeholder="e.g. 4821"
          />
        </label>
      </div>
      {error && <p className="gate__error">{error}</p>}
      <div className="add-nav__actions">
        <button className="btn btn--ghost" type="button" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Add navigator'}
        </button>
      </div>
    </form>
  );
}
