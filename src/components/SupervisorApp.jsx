import { useState, useEffect } from 'react';
import Nav from './Nav.jsx';
import DeptBar from './DeptBar.jsx';
import Overview from './Overview.jsx';
import Matrix from './Matrix.jsx';
import Navigators from './Navigators.jsx';
import NavigatorDetail from './NavigatorDetail.jsx';
import Training from './Training.jsx';
import TrainingModule from './TrainingModule.jsx';
import EmptyState from './EmptyState.jsx';
import Footer from './Footer.jsx';
import { buildMatrixRows, departmentMatrix } from '../lib/scoring.js';
import { subscribeResults, subscribeRoster, addToRoster } from '../lib/db.js';
import { isFirebaseConfigured } from '../lib/firebase.js';
import { ASSESSED_DEPT, departmentName } from '../data/departments.js';

// Views where the DeptBar appears. The Navigators tab is intentionally NOT here:
// roster management is global (not department-scoped), so it always shows the
// live Pediatrics check plus the full roster regardless of department.
const DEPT_SCOPED_VIEWS = ['overview', 'matrix', 'training', 'navigator'];
// Analytics views that should show an empty state when there's no live data.
const DATA_VIEWS = ['overview', 'matrix', 'training', 'navigator'];

// The full management experience, fed live from Firestore via onSnapshot.
export default function SupervisorApp({ onSignOut }) {
  const [view, setView] = useState('overview');
  const [results, setResults] = useState([]);
  const [roster, setRoster] = useState([]);
  const [selected, setSelected] = useState(null);
  const [moduleDomain, setModuleDomain] = useState(null);
  const [moduleReturn, setModuleReturn] = useState('training');
  const [selectedDept, setSelectedDept] = useState(ASSESSED_DEPT);

  // Live listeners — results + roster. Unsubscribe on unmount.
  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    const unsubResults = subscribeResults(setResults);
    const unsubRoster = subscribeRoster(setRoster);
    return () => {
      unsubResults();
      unsubRoster();
    };
  }, []);

  const isAssessed = selectedDept === ASSESSED_DEPT;
  const deptName = departmentName(selectedDept);

  // The live check only scores Pediatrics, so that's where real rows come from.
  const pediatricRows = buildMatrixRows(results, null);
  // Analytics views are empty for non-assessed departments (no live check yet).
  const rows = isAssessed ? pediatricRows : [];
  // Cross-department strip: wrap each result as a single-department navigator so
  // Pediatrics is populated and the other departments read "not assessed".
  const deptMatrix = departmentMatrix(
    results.map((r) => ({ name: r.name, departments: { [ASSESSED_DEPT]: r.scores } })),
    null
  );

  const openNavigator = (name) => {
    setSelected(name);
    setView('navigator');
  };

  const openModule = (domainId, returnTo = 'training') => {
    setModuleDomain(domainId);
    setModuleReturn(returnTo);
    setView('module');
  };

  const handleAddNavigator = (name, pin) => addToRoster(name, pin);

  // Decide whether a data view should be replaced by an empty state.
  const emptyState = () => {
    if (!isFirebaseConfigured) {
      return (
        <EmptyState title="Database not connected yet">
          Add your Firebase config to <code>.env.local</code> (see{' '}
          <code>.env.local.example</code>) and restart, then results will appear here live.
        </EmptyState>
      );
    }
    if (!isAssessed) {
      return (
        <EmptyState title={`${deptName} isn’t a live check yet`}>
          Only <strong>Pediatrics</strong> is assessed in this pilot. Switch the department back to
          Pediatrics up top to see live results.
        </EmptyState>
      );
    }
    return (
      <EmptyState title="No results yet">
        As navigators complete the check, their results appear here automatically — no refresh
        needed. Add navigators to the roster from the <strong>Navigators</strong> tab to get started.
      </EmptyState>
    );
  };

  const showEmpty = DATA_VIEWS.includes(view) && rows.length === 0;

  return (
    <div className="app">
      <Nav role="supervisor" view={view} setView={setView} onSignOut={onSignOut} />

      {DEPT_SCOPED_VIEWS.includes(view) && (
        <DeptBar selectedDept={selectedDept} setSelectedDept={setSelectedDept} />
      )}

      <main className="main">
        {showEmpty ? (
          emptyState()
        ) : (
          <>
            {view === 'overview' && (
              <Overview
                rows={rows}
                deptName={deptName}
                deptMatrix={deptMatrix}
                onOpenNavigator={openNavigator}
                onViewMatrix={() => setView('matrix')}
              />
            )}

            {view === 'matrix' && (
              <Matrix
                rows={rows}
                deptName={deptName}
                onTakeCheck={null}
                onOpenNavigator={openNavigator}
              />
            )}

            {view === 'navigators' && (
              <Navigators
                rows={pediatricRows}
                roster={roster}
                deptName={departmentName(ASSESSED_DEPT)}
                onOpenNavigator={openNavigator}
                onAddNavigator={handleAddNavigator}
              />
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
                rows={pediatricRows}
                domainId={moduleDomain}
                onBack={() => setView(moduleReturn)}
                onOpenNavigator={openNavigator}
              />
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
