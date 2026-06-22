// Top nav: move between the check, the analytics dashboards, and the matrix.
export default function Nav({ view, setView, hasResult }) {
  const tabs = [
    { id: 'overview', label: 'Overview', go: () => setView('overview') },
    {
      id: 'check',
      label: 'Take the check',
      go: () => setView(hasResult ? 'results' : 'check'),
      active: view === 'check' || view === 'results',
    },
    { id: 'matrix', label: 'Matrix', go: () => setView('matrix') },
    {
      id: 'navigators',
      label: 'Navigators',
      go: () => setView('navigators'),
      active: view === 'navigators' || view === 'navigator',
    },
    { id: 'training', label: 'Training', go: () => setView('training') },
  ];

  return (
    <header className="nav">
      <button className="nav__brand" onClick={() => setView('start')}>
        Quarterly Knowledge Check
      </button>
      <nav className="nav__links">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`nav__link ${(t.active ?? view === t.id) ? 'is-active' : ''}`}
            onClick={t.go}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
