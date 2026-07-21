import { useState } from 'react';
import { DOMAINS, domainName } from '../data/questions.js';
import { LEVELS } from '../data/config.js';
import { findRow } from '../lib/scoring.js';
import { OverallBadge } from './OverallStatus.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Navigators — supervisor's roster management tab.
//
// Three sections:
//   1. Active navigators who have taken the check (clickable → dashboard)
//   2. Active navigators who haven't taken the check yet (pending)
//   3. Inactive navigators (collapsed section at the bottom)
//
// Each card exposes a Manage panel with:
//   - Edit (name + PIN)
//   - Reset result (allow retake) — only if they've submitted
//   - Deactivate / Reactivate
// All destructive actions are gated behind an inline confirmation prompt.
// ─────────────────────────────────────────────────────────────────────────────

export default function Navigators({
  rows,
  roster,
  deptName,
  onOpenNavigator,
  onAddNavigator,
  onUpdateNavigator,
  onDeactivateNavigator,
  onReactivateNavigator,
  onResetResult,
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  // Which card has the manage panel open
  const [managingId, setManagingId] = useState(null);
  // Which card is in edit mode
  const [editingId, setEditingId] = useState(null);
  // Pending destructive action awaiting confirmation
  const [confirm, setConfirm] = useState(null); // { id, action, label }
  const [actionBusy, setActionBusy] = useState(false);

  const activeRoster = roster.filter((m) => m.status !== 'inactive');
  const inactiveRoster = roster.filter((m) => m.status === 'inactive');

  const stopManaging = () => {
    setManagingId(null);
    setEditingId(null);
    setConfirm(null);
  };

  const startConfirm = (id, action, label) => {
    setEditingId(null);
    setConfirm({ id, action, label });
  };

  const runConfirm = async () => {
    if (!confirm || actionBusy) return;
    setActionBusy(true);
    try {
      const { id, action } = confirm;
      if (action === 'deactivate') await onDeactivateNavigator(id);
      else if (action === 'reactivate') await onReactivateNavigator(id);
      else if (action === 'reset') await onResetResult(id);
    } finally {
      setActionBusy(false);
      stopManaging();
    }
  };

  const renderCard = (member) => {
    const row = findRow(rows, member.id) ?? findRow(rows, member.name);
    const isInactive = member.status === 'inactive';
    const isManaging = managingId === member.id;
    const isEditing = editingId === member.id;
    const isConfirming = confirm?.id === member.id;

    const cardClass = [
      'card nav-card',
      isInactive && 'nav-card--inactive',
      !row && !isInactive && 'nav-card--pending',
      // A Critical overall status is visibly urgent, but stays professional and
      // readable — the badge always carries the number and the written label too.
      row && row.overallLevel === 'critical' && 'nav-card--critical',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div key={member.id} className={cardClass}>
        {/* Card header */}
        <div className="nav-card__top">
          <span className="nav-card__name">{member.name}</span>
          {isInactive ? (
            <span className="nav-card__status-tag nav-card__status-tag--inactive">Inactive</span>
          ) : !row ? (
            <span className="nav-card__pending-tag">Not yet taken</span>
          ) : (
            <OverallBadge row={row} size="sm" />
          )}
        </div>

        {/* Domain score strip — each segment is a SCORE RANGE, not a status. */}
        {row && (
          <div className="nav-card__strip">
            {DOMAINS.map((d) => {
              const score = row.scores?.[d.id];
              const band = row.domainDevelopmentBands[d.id];
              return (
                <span
                  key={d.id}
                  className={`nav-card__cell ${band == null ? 'nav-card__cell--na' : ''}`.trim()}
                  title={`${domainName(d.id)}: ${Number.isFinite(score) ? `${score}%` : 'not scored'}`}
                  // An unscored domain gets a neutral surface, never a band tint.
                  style={band == null ? undefined : { background: LEVELS[band].tint }}
                />
              );
            })}
          </div>
        )}

        {row && (
          <p className="nav-card__strip-note">
            {row.overallComplete === false
              ? `Incomplete — ${row.assessedDomains} of ${row.totalDomains ?? DOMAINS.length} domains scored`
              : 'Six domain scores behind this status'}
          </p>
        )}

        {/* Pending note */}
        {!row && !isInactive && (
          <p className="nav-card__pending-note">Waiting on this navigator to complete the check.</p>
        )}
        {!row && !isInactive && (
          <p className="nav-card__pin">
            PIN: {member.pinSet || member.pinHash || member.pin ? 'Set securely' : 'Not set yet'}
          </p>
        )}

        {/* ── Management panel ──────────────────────────────────────── */}
        {isEditing ? (
          <EditForm
            member={member}
            roster={roster}
            hasResult={!!row}
            onSave={async (patch) => {
              await onUpdateNavigator(member.id, patch);
              stopManaging();
            }}
            onCancel={stopManaging}
          />
        ) : isConfirming ? (
          <ConfirmPrompt
            label={confirm.label}
            busy={actionBusy}
            onConfirm={runConfirm}
            onCancel={stopManaging}
          />
        ) : isManaging ? (
          <div className="nav-card__manage">
            <div className="nav-card__manage-actions">
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setEditingId(member.id)}
              >
                Edit name / PIN
              </button>
              {row && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    startConfirm(
                      member.id,
                      'reset',
                      `Reset this department assessment, including Call QA attempts, for ${member.name}? Archived QA stays in history but will no longer count as current completion.`
                    )
                  }
                >
                  Reset result
                </button>
              )}
              {isInactive ? (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    startConfirm(
                      member.id,
                      'reactivate',
                      `Reactivate ${member.name}? They'll be able to sign in again.`
                    )
                  }
                >
                  Reactivate
                </button>
              ) : (
                <button
                  className="btn btn--ghost btn--sm nav-card__action--danger"
                  onClick={() =>
                    startConfirm(
                      member.id,
                      'deactivate',
                      `Deactivate ${member.name}? They won't be able to sign in. Their results stay in the matrix until cleared.`
                    )
                  }
                >
                  Deactivate
                </button>
              )}
            </div>
            <button className="linkbtn nav-card__manage-cancel" onClick={stopManaging}>
              Cancel
            </button>
          </div>
        ) : (
          /* Default footer: view dashboard (if applicable) + manage button */
          <div className="nav-card__footer">
            {row && !isInactive && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => onOpenNavigator(row.navigatorId ?? row.name)}
              >
                View dashboard →
              </button>
            )}
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setManagingId(member.id)}
            >
              Manage
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="navigators stagger">
      <header className="overview__head navigators__head">
        <div>
          <h1 className="overview__title">
            Navigators{deptName && <span className="title-dept"> · {deptName}</span>}
          </h1>
          <p className="overview__lede">
            Everyone on the roster. Select anyone who has taken the check to view their dashboard.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setShowAddForm((s) => !s)}>
          {showAddForm ? 'Close' : '+ Add navigator'}
        </button>
      </header>

      {showAddForm && (
        <AddNavigatorForm
          roster={roster}
          onAdd={onAddNavigator}
          onDone={() => setShowAddForm(false)}
        />
      )}

      {roster.length === 0 ? (
        <div className="card empty__card">
          <h2 className="empty__title">No navigators yet</h2>
          <p className="empty__body">
            Add your team with <strong>+ Add navigator</strong>. Each person creates their 4-digit
            PIN the first time they sign in.
          </p>
        </div>
      ) : (
        <>
          {/* Active navigators */}
          <div className="nav-grid">
            {activeRoster.map(renderCard)}
          </div>

          {/* Inactive navigators */}
          {inactiveRoster.length > 0 && (
            <div className="nav-inactive-section">
              <h2 className="nav-inactive-section__title">
                Inactive · {inactiveRoster.length}
              </h2>
              <p className="readoff__sub">
                These navigators can't sign in. Reactivate them if they rejoin the team.
              </p>
              <div className="nav-grid nav-grid--compact">
                {inactiveRoster.map(renderCard)}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Inline confirmation prompt ─────────────────────────────────────────────────
function ConfirmPrompt({ label, busy, onConfirm, onCancel }) {
  return (
    <div className="nav-card__confirm">
      <p className="nav-card__confirm-label">{label}</p>
      <div className="nav-card__confirm-actions">
        <button
          className="btn btn--ghost btn--sm nav-card__action--danger"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Working…' : 'Yes, confirm'}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Inline edit form ───────────────────────────────────────────────────────────
function EditForm({ member, roster, hasResult, onSave, onCancel }) {
  const [name, setName] = useState(member.name);
  const [pin, setPin] = useState('');
  const [changePin, setChangePin] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmedName = name.trim();
    const trimmedPin = pin.trim();
    if (!trimmedName) { setError('Name cannot be empty.'); return; }
    if (changePin && trimmedPin && !/^\d{4}$/.test(trimmedPin)) { setError('PIN must be blank or exactly 4 digits.'); return; }
    // Dup check: exclude the current member
    const dup = roster.some(
      (r) => r.id !== member.id && r.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (dup) { setError('Another navigator already has that name.'); return; }
    setBusy(true);
    try {
      await onSave({ name: trimmedName, ...(changePin ? { pin: trimmedPin } : {}) });
    } catch {
      setError("Couldn't save. Check the database connection and try again.");
      setBusy(false);
    }
  };

  return (
    <form className="nav-card__edit-form" onSubmit={submit}>
      <label className="gate__field">
        <span className="gate__label">Name</span>
        <input
          className="gate__input gate__input--sm"
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(''); }}
        />
      </label>
      <label className="gate__field">
        <span className="gate__label">PIN</span>
        {!changePin ? (
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setChangePin(true)}>
            {member.pinSet || member.pinHash || member.pin ? 'Set a new PIN' : 'Set a PIN'}
          </button>
        ) : (
          <>
            <input
              className="gate__input gate__input--sm"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }}
              placeholder="4 digits; blank clears it"
            />
            <span className="readoff__sub">The existing PIN is never displayed. Leave blank to let the navigator create a new one.</span>
          </>
        )}
      </label>
      {error && <p className="gate__error">{error}</p>}
      <div className="nav-card__manage-actions">
        <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Add navigator form ─────────────────────────────────────────────────────────
function AddNavigatorForm({ roster, onAdd, onDone }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = name.trim();
    if (!trimmed) { setError('Enter a name.'); return; }
    if (roster.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('A navigator with that name already exists.');
      return;
    }
    setBusy(true);
    try {
      await onAdd(trimmed, '');
      setName('');
      onDone();
    } catch {
      setError("Couldn't save. Check the database connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card add-nav" onSubmit={submit}>
      <h2 className="overview__panel-title">Add a navigator</h2>
      <p className="readoff__sub">
        They&rsquo;ll pick their name from a list and create their 4-digit PIN the first time they sign in.
      </p>
      <div className="add-nav__fields">
        <label className="gate__field">
          <span className="gate__label">Name</span>
          <input
            className="gate__input"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            placeholder="e.g. Sarah Chen"
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
