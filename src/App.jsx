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
import TrainingModule from './components/TrainingModule.jsx';
import DeptBar from './components/DeptBar.jsx';
import { scorePerDomain, buildMatrixRows, deptSamples, departmentMatrix } from './lib/scoring.js';
import { SAMPLE_NAVIGATORS } from './data/navigators.js';
import { DEPARTMENTS, ASSESSED_DEPT, departmentName } from './data/departments.js';

// Views: start · check · results · matrix · overview · navigators · navigator.
// State is in-memory only.
const DEPT_SCOPED_VIEWS = ['overview', 'matrix', 'navigators', 'training', 'navigator'];

export default function App() {
  const [view, setView] = useState('start');
  // The live taker's result: { name, scores } — appears as a new matrix row.
  const [liveResult, setLiveResult] = useState(null);
  // Currently drilled-into navigator (by name) for the detail dashboard.
  const [selected, setSelected] = useState(null);
  // Currently previewed training module (by domainId) + where to return to.
  const [moduleDomain, setModuleDomain] = useState(null);
  const [moduleReturn, setModuleReturn] = useState('training');
  // Which department the dashboards are scoped to.
  const [selectedDept, setSelectedDept] = useState(ASSESSED_DEPT);

  // Rows scoped to the selected department. The live taker only appears in the
  // assessed department (that's all the check measures).
  const rows = buildMatrixRows(
    deptSamples(SAMPLE_NAVIGATORS, selectedDept),
    selectedDept === ASSESSED_DEPT ? liveResult : null
  );
  // Cross-department strength (all departments at once).
  const deptMatrix = departmentMatrix(SAMPLE_NAVIGATORS, liveResult);
  const deptName = departmentName(selectedDept);

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

  const openModule = (domainId, returnTo = 'training') => {
    setModuleDomain(domainId);
    setModuleReturn(returnTo);
    setView('module');
  };

  return (
    <div className="app">
      <Nav view={view} setView={setView} hasResult={!!liveResult} />

      {DEPT_SCOPED_VIEWS.includes(view) && (
        <DeptBar selectedDept={selectedDept} setSelectedDept={setSelectedDept} />
      )}

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
          <Matrix rows={rows} deptName={deptName} onTakeCheck={() => setView('check')} onOpenNavigator={openNavigator} />
        )}

        {view === 'overview' && (
          <Overview
            rows={rows}
            deptName={deptName}
            deptMatrix={deptMatrix}
            onOpenNavigator={openNavigator}
            onViewMatrix={() => setView('matrix')}
          />
        )}

        {view === 'navigators' && (
          <Navigators rows={rows} deptName={deptName} onOpenNavigator={openNavigator} />
        )}

        {view === 'training' && (
          <Training
            rows={rows}
            deptName={deptName}
            onOpenNavigator={openNavigator}
            onPreviewModule={(d) => openModule(d, 'training')}
          />
        )}

        {view === 'navigator' && (
          <NavigatorDetail
            rows={rows}
            name={selected}
            deptName={deptName}
            deptMatrix={deptMatrix}
            onBack={() => setView('navigators')}
            onOpenNavigator={openNavigator}
            onPreviewModule={(d) => openModule(d, 'navigator')}
          />
        )}

        {view === 'module' && (
          <TrainingModule
            rows={rows}
            domainId={moduleDomain}
            onBack={() => setView(moduleReturn)}
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
