import { useState } from 'react';
import Nav from './components/Nav.jsx';
import Start from './components/Start.jsx';
import Check from './components/Check.jsx';
import Results from './components/Results.jsx';
import Matrix from './components/Matrix.jsx';
import Overview from './components/Overview.jsx';
import Navigators from './components/Navigators.jsx';
import NavigatorDetail from './components/NavigatorDetail.jsx';
import Training from './components/Training.jsx';
import { scorePerDomain, buildMatrixRows } from './lib/scoring.js';
import { SAMPLE_NAVIGATORS } from './data/navigators.js';

// Views: start · check · results · matrix · overview · navigators · navigator.
// State is in-memory only.
export default function App() {
  const [view, setView] = useState('start');
  // The live taker's result: { name, scores } — appears as a new matrix row.
  const [liveResult, setLiveResult] = useState(null);
  // Currently drilled-into navigator (by name) for the detail dashboard.
  const [selected, setSelected] = useState(null);

  // Single source of truth for every screen that needs the full roster.
  const rows = buildMatrixRows(SAMPLE_NAVIGATORS, liveResult);

  const handleSubmit = (name, answers) => {
    const scores = scorePerDomain(answers);
    setLiveResult({ name: name?.trim() || 'You', scores });
    setView('results');
  };

  const retake = () => {
    setLiveResult(null);
    setView('check');
  };

  const openNavigator = (name) => {
    setSelected(name);
    setView('navigator');
  };

  return (
    <div className="app">
      <Nav view={view} setView={setView} hasResult={!!liveResult} />

      <main className="main">
        {view === 'start' && (
          <Start onStart={() => setView('check')} onOverview={() => setView('overview')} />
        )}

        {view === 'check' && (
          <Check onSubmit={handleSubmit} onCancel={() => setView('start')} />
        )}

        {view === 'results' && liveResult && (
          <Results
            result={liveResult}
            onViewMatrix={() => setView('matrix')}
            onViewDashboard={() => openNavigator(liveResult.name)}
            onRetake={retake}
          />
        )}

        {view === 'matrix' && (
          <Matrix rows={rows} onTakeCheck={() => setView('check')} onOpenNavigator={openNavigator} />
        )}

        {view === 'overview' && (
          <Overview rows={rows} onOpenNavigator={openNavigator} onViewMatrix={() => setView('matrix')} />
        )}

        {view === 'navigators' && (
          <Navigators rows={rows} onOpenNavigator={openNavigator} />
        )}

        {view === 'training' && (
          <Training rows={rows} onOpenNavigator={openNavigator} />
        )}

        {view === 'navigator' && (
          <NavigatorDetail
            rows={rows}
            name={selected}
            onBack={() => setView('navigators')}
            onOpenNavigator={openNavigator}
          />
        )}
      </main>

      <footer className="footer">
        Prototype · illustrative sample data only · development and fit, not pass/fail
      </footer>
    </div>
  );
}
