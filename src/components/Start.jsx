import { useState, useEffect } from 'react';
import { DOMAINS, QUESTIONS } from '../data/questions.js';
import { SUPERVISOR_PASSCODE } from '../data/config.js';
import { isFirebaseConfigured } from '../lib/firebase.js';
import { getRoster } from '../lib/db.js';

// The Start gate. Three sub-screens controlled by `mode`:
//   'role'       — pick navigator vs supervisor
//   'navigator'  — choose your name from the roster + enter your PIN
//   'supervisor' — enter the management passcode
//
// On success it calls back to App, which owns session-writing and data loading.
export default function Start({ onNavigatorEntry, onSupervisorEntry }) {
  const [mode, setMode] = useState('role');

  return (
    <section className="start">
      {mode === 'role' && <RoleSelect onPick={setMode} />}
      {mode === 'navigator' && (
        <NavigatorGate onBack={() => setMode('role')} onEnter={onNavigatorEntry} />
      )}
      {mode === 'supervisor' && (
        <SupervisorGate onBack={() => setMode('role')} onEnter={onSupervisorEntry} />
      )}
    </section>
  );
}

// ── Role selection ─────────────────────────────────────────────────────────────
function RoleSelect({ onPick }) {
  return (
    <>
      <p className="start__eyebrow">A short quarterly check</p>
      <h1 className="start__title">
        Real scenarios — <span className="accent">development and fit</span>, not pass/fail.
      </h1>
      <p className="start__lede">
        {QUESTIONS.length} situation-based questions across {DOMAINS.length} knowledge domains.
        You won&rsquo;t get a single grade — you&rsquo;ll get a clear read on where you&rsquo;re
        already strong, where you&rsquo;re solid, and where a little more practice would help.
      </p>

      <div className="gate__roles">
        <button className="card gate__role" onClick={() => onPick('navigator')}>
          <span className="gate__role-title">I&rsquo;m a navigator</span>
          <span className="gate__role-sub">Take the check and see my own development picture.</span>
        </button>
        <button className="card gate__role" onClick={() => onPick('supervisor')}>
          <span className="gate__role-title">I&rsquo;m a supervisor</span>
          <span className="gate__role-sub">Open the team capability map and dashboards.</span>
        </button>
      </div>

      <div className="start__domains">
        <p className="start__domains-label">What it covers</p>
        <ul className="start__domain-list">
          {DOMAINS.map((d) => (
            <li key={d.id} className="start__domain">
              <span className="tag">{d.name}</span>
              <span className="start__domain-blurb">{d.blurb}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ── Navigator gate: roster dropdown + PIN ──────────────────────────────────────
function NavigatorGate({ onBack, onEnter }) {
  const [roster, setRoster] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!isFirebaseConfigured) {
      setLoadError(true);
      setRoster([]);
      return;
    }
    getRoster()
      .then((list) => {
        if (!active) return;
        // Alphabetical for a predictable dropdown.
        setRoster([...list].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, []);

  const submit = (e) => {
    e.preventDefault();
    setError('');
    const entry = roster?.find((r) => r.id === selectedId);
    if (!entry) {
      setError('Please choose your name from the list.');
      return;
    }
    if (String(entry.pin) !== pin.trim()) {
      setError('That PIN doesn’t match. Check with your supervisor.');
      return;
    }
    onEnter(entry.id, entry.name);
  };

  return (
    <div className="gate">
      <button className="linkbtn gate__back" onClick={onBack}>← Back</button>
      <h1 className="gate__title">Welcome — let&rsquo;s find you</h1>

      {loadError ? (
        <p className="gate__notice">
          The check isn&rsquo;t connected to a database yet. Your supervisor needs to finish setup
          (add the Firebase config and add navigators to the roster) before you can take it.
        </p>
      ) : roster === null ? (
        <p className="gate__notice">Loading the navigator list…</p>
      ) : roster.length === 0 ? (
        <p className="gate__notice">
          No navigators have been added yet. Ask your supervisor to add you to the roster first.
        </p>
      ) : (
        <form className="gate__form" onSubmit={submit}>
          <label className="gate__field">
            <span className="gate__label">Your name</span>
            <select
              className="gate__select"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setError('');
              }}
            >
              <option value="">Choose your name…</option>
              {roster.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>

          <label className="gate__field">
            <span className="gate__label">Your PIN</span>
            <input
              className="gate__input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError('');
              }}
              placeholder="4-digit PIN from your supervisor"
            />
          </label>

          {error && <p className="gate__error">{error}</p>}

          <button className="btn btn--primary btn--lg" type="submit">
            Continue
          </button>
        </form>
      )}
    </div>
  );
}

// ── Supervisor gate: passcode ──────────────────────────────────────────────────
function SupervisorGate({ onBack, onEnter }) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (passcode.trim() !== SUPERVISOR_PASSCODE) {
      setError('Incorrect passcode.');
      return;
    }
    onEnter();
  };

  return (
    <div className="gate">
      <button className="linkbtn gate__back" onClick={onBack}>← Back</button>
      <h1 className="gate__title">Management view</h1>
      <p className="gate__notice">
        Enter the supervisor passcode to open the team capability map, dashboards, and training.
      </p>
      <form className="gate__form" onSubmit={submit}>
        <label className="gate__field">
          <span className="gate__label">Passcode</span>
          <input
            className="gate__input"
            type="password"
            autoComplete="off"
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value);
              setError('');
            }}
            placeholder="Supervisor passcode"
            autoFocus
          />
        </label>
        {error && <p className="gate__error">{error}</p>}
        <button className="btn btn--primary btn--lg" type="submit">
          Continue
        </button>
      </form>
    </div>
  );
}
