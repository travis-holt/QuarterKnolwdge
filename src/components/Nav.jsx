// Top nav. Two variants by role:
//   supervisor — Overview · Matrix · Navigators · Training   + Sign out
//   navigator  — My results · My training                    + Switch user
// The navigator variant has no route to team-wide views by construction.
export default function Nav({ role, view, setView, onSignOut }) {
  const tabs =
    role === 'navigator'
      ? [
          { id: 'dashboard', label: 'My results' },
          { id: 'training', label: 'My training' },
        ]
      : [
          { id: 'overview', label: 'Overview' },
          { id: 'matrix', label: 'Matrix' },
          {
            id: 'navigators',
            label: 'Navigators',
            active: view === 'navigators' || view === 'navigator',
          },
          { id: 'training', label: 'Training' },
          { id: 'questions', label: 'Questions' },
        ];

  const home = role === 'navigator' ? 'dashboard' : 'overview';
  const signOutLabel = role === 'navigator' ? 'Switch user' : 'Sign out';

  return (
    <header className="nav">
      <button className="nav__brand" onClick={() => setView(home)}>
        Quarterly Knowledge Check
      </button>
      <nav className="nav__links">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`nav__link ${(t.active ?? view === t.id) ? 'is-active' : ''}`}
            onClick={() => setView(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button className="nav__link nav__signout" onClick={onSignOut}>
          {signOutLabel}
        </button>
      </nav>
    </header>
  );
}
