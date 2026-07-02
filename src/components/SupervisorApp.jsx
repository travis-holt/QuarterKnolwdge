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
import AuditBank from './AuditBank.jsx';
import SopManager from './SopManager.jsx';
import ActionCenter from './ActionCenter.jsx';
import Mentorship from './Mentorship.jsx';
import LearningLoop from './LearningLoop.jsx';
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
  subscribeAudits,
  saveDraftAudits,
  activateAudit,
  archiveAudit,
  deleteAudit,
  subscribeCompletions,
  subscribeResultHistory,
  subscribeInterviews,
  subscribePairings,
  savePairing,
  updatePairingStatus,
  saveSupervisorFeedback,
  subscribeSupervisorFeedback,
  saveLearningProposal,
  subscribeLearningProposals,
  updateLearningProposalStatus,
  subscribeSops,
  saveSopDraft,
  updateSop,
  activateSop,
  archiveSop,
  deleteSop,
} from '../lib/db.js';
import { isFirebaseConfigured } from '../lib/firebase.js';
import { ALL_SEED_QUESTIONS } from '../data/questions.js';
import { DEFAULT_DEPT, isAssessed as deptIsAssessed, departmentName } from '../data/departments.js';
import { apiFetch, runPooled } from '../lib/apiFetch.js';

// Views where the DeptBar appears. The Navigators tab is intentionally NOT here:
// roster management is global (not department-scoped), so it always shows the
// live Pediatrics check plus the full roster regardless of department.
const DEPT_SCOPED_VIEWS = ['overview', 'matrix', 'training', 'navigator', 'learning', 'sops'];
// Analytics views that should show an empty state when there's no live data.
const DATA_VIEWS = ['overview', 'matrix', 'training', 'navigator'];

// The full management experience, fed live from Firestore via onSnapshot.
export default function SupervisorApp({ onSignOut }) {
  const [view, setView] = useState('overview');
  const [results, setResults] = useState([]);
  const [roster, setRoster] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [audits, setAudits] = useState([]); // pre-generated Spot the Error transcript bank
  const [completions, setCompletions] = useState([]);
  const [resultHistory, setResultHistory] = useState([]); // append-only history for trends
  const [allInterviews, setAllInterviews] = useState([]); // all interview sessions for action center
  const [pairings, setPairings] = useState([]); // active/completed mentor pairings
  const [feedback, setFeedback] = useState([]); // supervisor judgments for the learning loop
  const [learningProposals, setLearningProposals] = useState([]); // human-review improvement queue
  const [sops, setSops] = useState([]); // versioned department SOPs (F24)
  const [selected, setSelected] = useState(null);
  const [moduleDomain, setModuleDomain] = useState(null);
  const [moduleReturn, setModuleReturn] = useState('training');
  const [selectedDept, setSelectedDept] = useState(DEFAULT_DEPT);
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
    });
    const unsubHistory = subscribeResultHistory(setResultHistory, (err) => {
      console.error('subscribeResultHistory:', err);
    });
    const unsubInterviews = subscribeInterviews(setAllInterviews, (err) => {
      console.error('subscribeInterviews:', err);
    });
    const unsubPairings = subscribePairings(setPairings, (err) => {
      console.error('subscribePairings:', err);
    });
    const unsubFeedback = subscribeSupervisorFeedback(setFeedback, (err) => {
      console.error('subscribeSupervisorFeedback:', err);
    });
    const unsubProposals = subscribeLearningProposals(setLearningProposals, (err) => {
      console.error('subscribeLearningProposals:', err);
    });
    const unsubSops = subscribeSops(setSops, (err) => {
      console.error('subscribeSops:', err);
    });
    return () => {
      unsubResults();
      unsubRoster();
      unsubCompletions();
      unsubHistory();
      unsubInterviews();
      unsubPairings();
      unsubFeedback();
      unsubProposals();
      unsubSops();
    };
  }, []);

  // Question bank — seed once from the static seed, then live-subscribe.
  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    seedQuestionsIfEmpty(ALL_SEED_QUESTIONS).catch((err) => console.error('seedQuestions:', err));
    const unsub = subscribeQuestions(setQuestions, (err) => {
      console.error('subscribeQuestions:', err);
      setSubscribeError(true);
    });
    const unsubAudits = subscribeAudits(setAudits, (err) => {
      console.error('subscribeAudits:', err);
    });
    return () => {
      unsub();
      unsubAudits();
    };
  }, []);

  const isAssessedDept = deptIsAssessed(selectedDept);
  const deptName = departmentName(selectedDept);

  // Build a lookup: navigatorId → Set<domainId> for "Spot the Error" completions.
  const completionMap = {};
  for (const c of completions) {
    if (c.kind && c.kind !== 'practice') continue;
    if (!completionMap[c.navigatorId]) completionMap[c.navigatorId] = new Set();
    completionMap[c.navigatorId].add(c.domainId);
  }

  // Exclude inactive navigators from the matrix and floor stats so deactivated
  // team members don't skew gaps, can-teach tallies, or training cohorts.
  const activeRosterIds = new Set(
    roster.filter((m) => m.status !== 'inactive').map((m) => m.id)
  );
  const rawActiveResults = results.filter((r) => activeRosterIds.has(r.navigatorId));

  // A navigator can now hold BOTH an MCQ and a Spot the Error result per
  // department. Collapse to one canonical result per navigator+department —
  // their most recent submission — so the matrix shows a single current row.
  const activeResults = Object.values(
    rawActiveResults.reduce((acc, r) => {
      const key = `${r.navigatorId}__${r.department ?? 'pediatrics'}`;
      const prev = acc[key];
      if (!prev || (r.submittedAt?.seconds ?? 0) >= (prev.submittedAt?.seconds ?? 0)) acc[key] = r;
      return acc;
    }, {})
  );

  // Filter results by the currently selected department. Legacy docs without a
  // `department` field are treated as 'pediatrics'.
  const deptResults = activeResults.filter(
    (r) => (r.department ?? 'pediatrics') === selectedDept
  );

  // Build matrix rows for the selected department (empty for non-assessed depts).
  const deptRows = buildMatrixRows(deptResults, null);
  const rows = isAssessedDept ? deptRows : [];

  // Cross-department strip: one row per navigator, merging all their dept results
  // (a navigator who took two departments has two result docs — merge, don't split).
  const deptMatrix = departmentMatrix(
    Object.values(
      activeResults.reduce((acc, r) => {
        const sample = (acc[r.navigatorId] ??= { name: r.name, departments: {} });
        sample.departments[r.department ?? 'pediatrics'] = r.scores;
        return acc;
      }, {})
    ),
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
  const handleResetResult = (id) => clearResult(id, selectedDept);
  const handleSavePairing = (pairing) => savePairing(pairing);
  const handleUpdatePairing = (id, status) => updatePairingStatus(id, status);
  const handleSaveFeedback = (item) => saveSupervisorFeedback(item);
  const handleSaveLearningProposal = (proposal) => saveLearningProposal(proposal);
  const handleUpdateLearningProposal = (id, status, review) => updateLearningProposalStatus(id, status, review);
  const handleCreateQuestionDraft = (draft) => saveDraftQuestions([draft], 'learning-loop', selectedDept);

  // Generate scenarios via the serverless Gemini proxy. The function returns
  // validated draft questions; we persist them as `draft` for review (they never
  // go live until activated). The supervisor passcode gates the endpoint
  // (pilot-grade — see firestore.rules / CLAUDE.md security notes).
  const handleGenerate = async ({ domainId, count }) => {
    const data = await apiFetch('/api/generate-scenarios', { domainId, count, department: selectedDept }, 60_000);
    if (!data.questions?.length) throw new Error('No scenarios returned.');
    await saveDraftQuestions(data.questions, 'gemini', selectedDept);
    return data.questions.length;
  };

  // Generate "Spot the Error" audit transcripts into the bank (F16 speed fix).
  // /api/generate-audit produces one transcript per call, so fan out with
  // bounded concurrency and keep whatever succeeds. Drafts only — the
  // supervisor reviews and activates before anything is served.
  const handleGenerateAudits = async ({ domainId, count }) => {
    const plan = Array.from({ length: count }, () => domainId);
    const results = await runPooled(plan, 2, (d) =>
      apiFetch('/api/generate-audit', { domain: d, department: selectedDept }, 30_000)
    );
    const drafts = results
      .filter((r) => r.status === 'fulfilled' && Array.isArray(r.value?.transcript))
      .map((r) => ({ domainId, ...r.value }));
    if (!drafts.length) {
      const firstErr = results.find((r) => r.status === 'rejected')?.reason;
      throw new Error(firstErr?.message || 'No transcripts returned.');
    }
    await saveDraftAudits(drafts, 'gemini', selectedDept);
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
    if (!isAssessedDept) {
      return (
        <EmptyState title={`${deptName} isn’t a live check yet`}>
          Only <strong>Pediatrics</strong> and <strong>OB/GYN</strong> are live in this pilot.
          Switch to one of those departments up top to see results.
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

  // Find the selected navigator's result doc (for answers + dossier)
  const selectedResult = selected
    ? deptResults.find((r) => r.name === selected)
    : null;
  // Dept-filtered history for the trend/action center
  const deptHistory = resultHistory.filter((h) => (h.department ?? 'pediatrics') === selectedDept);

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
                teamHistory={deptHistory}
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
                rows={deptRows}
                roster={roster}
                deptName={deptName}
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
                dept={selectedDept}
                deptMatrix={deptMatrix}
                onBack={() => setView('navigators')}
                onOpenNavigator={openNavigator}
                onPreviewModule={(d) => openModule(d, 'navigator')}
                navigatorId={selectedNavigatorId}
                completedDomains={selectedNavigatorId ? (completionMap[selectedNavigatorId] ?? new Set()) : new Set()}
                completions={completions.filter((c) => (
                  selectedNavigatorId ? c.navigatorId === selectedNavigatorId : c.name === selected
                ))}
                answers={selectedResult?.answers}
                questions={questions.filter((q) => q.status === 'active')}
                onSaveFeedback={handleSaveFeedback}
              />
            )}

            {view === 'module' && (
              <TrainingModule
                rows={deptRows}
                domainId={moduleDomain}
                onBack={() => setView(moduleReturn)}
                onOpenNavigator={openNavigator}
              />
            )}

            {view === 'action' && (
              <ActionCenter
                rows={rows}
                history={deptHistory}
                interviews={allInterviews.filter((iv) => (iv.department ?? 'pediatrics') === selectedDept)}
                completions={completions}
                onOpenNavigator={openNavigator}
              />
            )}

            {view === 'mentorship' && (
              <Mentorship
                rows={rows}
                savedPairings={pairings}
                onSavePairing={handleSavePairing}
                onUpdatePairing={handleUpdatePairing}
                onOpenNavigator={openNavigator}
              />
            )}

            {view === 'learning' && (
              <LearningLoop
                rows={rows}
                results={deptResults}
                questions={questions.filter((q) => (q.department ?? 'pediatrics') === selectedDept)}
                completions={completions}
                interviews={allInterviews.filter((iv) => (iv.department ?? 'pediatrics') === selectedDept)}
                history={deptHistory}
                feedback={feedback}
                proposals={learningProposals.filter((p) => !p.target?.department || p.target.department === selectedDept)}
                deptName={deptName}
                onSaveFeedback={handleSaveFeedback}
                onSaveProposal={handleSaveLearningProposal}
                onUpdateProposal={handleUpdateLearningProposal}
                onCreateQuestionDraft={handleCreateQuestionDraft}
              />
            )}

            {view === 'sops' && (
              <SopManager
                sops={sops}
                selectedDept={selectedDept}
                deptName={deptName}
                onSaveDraft={saveSopDraft}
                onUpdateSop={updateSop}
                onActivate={activateSop}
                onArchive={archiveSop}
                onDelete={deleteSop}
              />
            )}

            {view === 'questions' && (
              <>
                <QuestionBank
                  questions={questions}
                  results={deptResults}
                  selectedDept={selectedDept}
                  onActivate={activateQuestion}
                  onArchive={archiveQuestion}
                  onDelete={deleteQuestion}
                  onSaveEdit={updateQuestion}
                  onGenerate={handleGenerate}
                  onSaveFeedback={handleSaveFeedback}
                  onSaveProposal={handleSaveLearningProposal}
                />
                <AuditBank
                  audits={audits}
                  selectedDept={selectedDept}
                  onGenerate={handleGenerateAudits}
                  onActivate={activateAudit}
                  onArchive={archiveAudit}
                  onDelete={deleteAudit}
                />
              </>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
