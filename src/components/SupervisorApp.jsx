import { useState, useEffect } from 'react';
import Nav from './Nav.jsx';
import DeptBar from './DeptBar.jsx';
import Overview from './Overview.jsx';
import Matrix from './Matrix.jsx';
import Navigators from './Navigators.jsx';
import NavigatorDetail from './NavigatorDetail.jsx';
import Training from './Training.jsx';
import TrainingModule from './TrainingModule.jsx';
import QuestionBank from './QuestionBank.jsx';
import EmptyState from './EmptyState.jsx';
import Footer from './Footer.jsx';
import { buildMatrixRows, departmentMatrix } from '../lib/scoring.js';
import {
  subscribeResults,
  subscribeRoster,
  addToRoster,
  updateRosterEntry,
  setRosterStatus,
  clearResult,
  subscribeQuestions,
  seedQuestionsIfEmpty,
  saveDraftQuestions,
  activateQuestion,
  archiveQuestion,
  deleteQuestion,
  updateQuestion,
  subscribeCompletions,
} from '../lib/db.js';
import { isFirebaseConfigured } from '../lib/firebase.js';
import { SEED_QUESTIONS } from '../data/questions.js';
import { SUPERVISOR_PASSCODE } from '../data/config.js';
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
  const [questions, setQuestions] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [moduleDomain, setModuleDomain] = useState(null);
  const [moduleReturn, setModuleReturn] = useState('training');
  const [selectedDept, setSelectedDept] = useState(ASSESSED_DEPT);
  const [subscribeError, setSubscribeError] = useState(false);

  // Live listeners — results + roster + completions. Unsubscribe on unmount.
  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    const onError = (err) => {
      console.error('Firestore subscription error:', err);
      setSubscribeError(true);
    };
    const unsubResults = subscribeResults(setResults, onError);
    const unsubRoster = subscribeRoster(setRoster, onError);
    const unsubCompletions = subscribeCompletions(setCompletions, (err) => {
      console.error('subscribeCompletions:', err);
      // Non-critical — checkmarks just won't appear live.
    });
    return () => {
      unsubResults();
      unsubRoster();
      unsubCompletions();
    };
  }, []);

  // Question bank — seed once from the static seed, then live-subscribe.
  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    seedQuestionsIfEmpty(SEED_QUESTIONS).catch((err) => console.error('seedQuestions:', err));
    const unsub = subscribeQuestions(setQuestions, (err) => {
      console.error('subscribeQuestions:', err);
      setSubscribeError(true);
    });
    return () => unsub();
  }, []);

  const isAssessed = selectedDept === ASSESSED_DEPT;
  const deptName = departmentName(selectedDept);

  // Build a lookup: navigatorId → Set<domainId> for "Spot the Error" completions.
  const completionMap = {};
  for (const c of completions) {
    if (!completionMap[c.navigatorId]) completionMap[c.navigatorId] = new Set();
    completionMap[c.navigatorId].add(c.domainId);
  }

  // Exclude inactive navigators from the matrix and floor stats so deactivated
  // team members don't skew gaps, can-teach tallies, or training cohorts.
  const activeRosterIds = new Set(
    roster.filter((m) => m.status !== 'inactive').map((m) => m.id)
  );
  const activeResults = results.filter((r) => activeRosterIds.has(r.navigatorId));

  // The live check only scores Pediatrics, so that's where real rows come from.
  const pediatricRows = buildMatrixRows(activeResults, null);
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

  // Roster UUID for the currently selected navigator (used to fetch interviews).
  const selectedNavigatorId = roster.find((m) => m.name === selected)?.id ?? null;

  const openModule = (domainId, returnTo = 'training') => {
    setModuleDomain(domainId);
    setModuleReturn(returnTo);
    setView('module');
  };

  const handleAddNavigator = (name, pin) => addToRoster(name, pin);
  const handleUpdateNavigator = (id, patch) => updateRosterEntry(id, patch);
  const handleDeactivateNavigator = (id) => setRosterStatus(id, 'inactive');
  const handleReactivateNavigator = (id) => setRosterStatus(id, 'active');
  const handleResetResult = (id) => clearResult(id);

  // Generate scenarios via the serverless Gemini proxy. The function returns
  // validated draft questions; we persist them as `draft` for review (they never
  // go live until activated). The supervisor passcode gates the endpoint
  // (pilot-grade — see firestore.rules / CLAUDE.md security notes).
  const handleGenerate = async ({ domainId, count }) => {
    const res = await fetch('/api/generate-scenarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domainId, count, secret: SUPERVISOR_PASSCODE }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Generation failed (${res.status})`);
    }
    const { questions: drafts } = await res.json();
    if (!drafts?.length) throw new Error('No scenarios returned.');
    await saveDraftQuestions(drafts, 'gemini');
    return drafts.length;
  };

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
        {subscribeError && (
          <div className="subscribe-error">
            Lost connection to the database — data may be stale. Check your network and reload.
          </div>
        )}
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
                onUpdateNavigator={handleUpdateNavigator}
                onDeactivateNavigator={handleDeactivateNavigator}
                onReactivateNavigator={handleReactivateNavigator}
                onResetResult={handleResetResult}
              />
            )}

            {view === 'training' && (
              <Training
                rows={rows}
                deptName={deptName}
                onOpenNavigator={openNavigator}
                onPreviewModule={(d) => openModule(d, 'training')}
                completionMap={completionMap}
                roster={roster}
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
                navigatorId={selectedNavigatorId}
                completedDomains={selectedNavigatorId ? (completionMap[selectedNavigatorId] ?? new Set()) : new Set()}
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

            {view === 'questions' && (
              <QuestionBank
                questions={questions}
                onActivate={activateQuestion}
                onArchive={archiveQuestion}
                onDelete={deleteQuestion}
                onSaveEdit={updateQuestion}
                onGenerate={handleGenerate}
              />
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
