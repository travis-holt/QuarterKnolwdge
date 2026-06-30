// Top nav. Two variants by role:
//   supervisor — Overview · Matrix · Navigators · Training   + Sign out
//   navigator  — My results · My training · Practice         + dept pill + Switch user
// The navigator variant has no route to team-wide views by construction.
// activeDeptName / onChangeDept: when set, renders a clickable dept pill so navigators
// can switch departments without signing out (hidden during check + coaching views).
export default function Nav({ role, view, setView, onSignOut, activeDeptName, onChangeDept }) {
  const tabs =
    role === 'navigator'
      ? [
          { id: 'dashboard', label: 'My results' },
          { id: 'training', label: 'My training' },
          { id: 'interview', label: 'Practice' },
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
          { id: 'action', label: 'Action Center' },
          { id: 'mentorship', label: 'Mentorship' },
          { id: 'questions', label: 'Questions' },
        ];

  const home = role === 'navigator' ? 'dashboard' : 'overview';
  const signOutLabel = role === 'navigator' ? 'Switch user' : 'Sign out';

  return (
    <header className="nav">
      <button className="nav__brand" onClick={() => setView(home)}>
        Knowledge Check
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
        {role === 'navigator' && activeDeptName && onChangeDept && (
          <button className="nav__dept-switch" onClick={onChangeDept} title="Switch department">
            {activeDeptName} <span aria-hidden="true">⇄</span>
          </button>
        )}
        <button className="nav__link nav__signout" onClick={onSignOut}>
          {signOutLabel}
        </button>
      </nav>
    </header>
  );
}
