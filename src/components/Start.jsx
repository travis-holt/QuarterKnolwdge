import { useState, useEffect } from 'react';
import { DOMAINS, QUESTIONS } from '../data/questions.js';
import { SUPERVISOR_PASSCODE } from '../data/config.js';
import { isFirebaseConfigured } from '../lib/firebase.js';
import { getRoster } from '../lib/db.js';
import Reveal from './Reveal.jsx';

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
    <div className="view-enter">
      <p className="start__eyebrow">
        <span className="start__eyebrow-dot" /> A short quarterly check
      </p>
      <h1 className="start__title">
        Real scenarios — <span className="accent">development and fit</span>, not pass/fail.
      </h1>
      <p className="start__lede">
        {QUESTIONS.length} situation-based questions across {DOMAINS.length} knowledge domains.
        You won&rsquo;t get a single grade — you&rsquo;ll get a clear read on where you&rsquo;re
        already strong, where you&rsquo;re solid, and where a little more practice would help.
      </p>

      <div className="gate__roles">
        <button className="card card--interactive gate__role" onClick={() => onPick('navigator')}>
          <span className="gate__role-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l2.5 7H22l-6 4.5 2.3 7L12 16l-6.3 4.5L8 13.5 2 9h7.5z" />
            </svg>
          </span>
          <span className="gate__role-title">I&rsquo;m a navigator</span>
          <span className="gate__role-sub">Take the check and see my own development picture.</span>
          <span className="gate__role-go">Start the check →</span>
        </button>
        <button className="card card--interactive gate__role" onClick={() => onPick('supervisor')}>
          <span className="gate__role-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" rx="1.5" />
              <rect x="14" y="3" width="7" height="5" rx="1.5" />
              <rect x="14" y="12" width="7" height="9" rx="1.5" />
              <rect x="3" y="16" width="7" height="5" rx="1.5" />
            </svg>
          </span>
          <span className="gate__role-title">I&rsquo;m a supervisor</span>
          <span className="gate__role-sub">Open the team capability map and dashboards.</span>
          <span className="gate__role-go">Open the dashboard →</span>
        </button>
      </div>

      <div className="start__domains">
        <p className="start__domains-label">What it covers</p>
        <ul className="start__domain-list">
          {DOMAINS.map((d, i) => (
            <Reveal as="li" key={d.id} className="start__domain" delay={i * 60}>
              <span className="tag">{d.name}</span>
              <span className="start__domain-blurb">{d.blurb}</span>
            </Reveal>
          ))}
        </ul>
      </div>
    </div>
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
        // Only active navigators can sign in; sort alphabetically.
        setRoster(
          [...list]
            .filter((r) => r.status !== 'inactive')
            .sort((a, b) => a.name.localeCompare(b.name))
        );
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
        <div className="gate__form" aria-busy="true" aria-label="Loading the navigator list">
          <div className="skeleton skeleton--line" style={{ width: '35%' }} />
          <div className="skeleton skeleton--line" style={{ height: 42 }} />
          <div className="skeleton skeleton--line" style={{ width: '35%', marginTop: 8 }} />
          <div className="skeleton skeleton--line" style={{ height: 42 }} />
          <div className="skeleton skeleton--line" style={{ height: 46, width: '40%' }} />
        </div>
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
