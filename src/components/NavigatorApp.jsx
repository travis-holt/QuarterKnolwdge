import { useState, useEffect } from 'react';
import Nav from './Nav.jsx';
import Check from './Check.jsx';
import Coaching from './Coaching.jsx';
import NavigatorDetail from './NavigatorDetail.jsx';
import MyTraining from './MyTraining.jsx';
import TrainingModule from './TrainingModule.jsx';
import Interview from './Interview.jsx';
import SpotTheError from './SpotTheError.jsx';
import EmptyState from './EmptyState.jsx';
import Footer from './Footer.jsx';
import {
  scorePerDomain,
  scorePerCompetency,
  buildMatrixRows,
  departmentMatrix,
  findRow,
} from '../lib/scoring.js';
import { getResult, saveResult, subscribeResults, getActiveQuestions, getCompletions, saveCompletion } from '../lib/db.js';
import { MINICHECK_SIZE, MINICHECK_PASS } from '../data/config.js';
import { isFirebaseConfigured } from '../lib/firebase.js';
import { SEED_QUESTIONS, SEED_QUESTIONS_OBGYN } from '../data/questions.js';
import { ASSESSED_DEPTS, departmentName } from '../data/departments.js';

// Seed fallbacks keyed by department so offline mode works for both.
const SEED_BY_DEPT = {
  pediatrics: SEED_QUESTIONS,
  obgyn: SEED_QUESTIONS_OBGYN,
};

// The navigator's self-contained app. They can ONLY ever see their own data:
// there is no route to the matrix, overview, or other navigators' dashboards.
// (They do receive the floor's results — read-only — so mentor suggestions can
// name colleagues who can teach their growth domains, but those names are not
// clickable and open nothing.)
export default function NavigatorApp({ navigatorId, name, onSignOut }) {
  const [view, setView] = useState('loading'); // loading · deptselect · check · coaching · dashboard · training · module · interview · audit · minicheck
  const [activeDept, setActiveDept] = useState(null); // chosen by navigator at deptselect
  const [ownResult, setOwnResult] = useState(null); // { name, navigatorId, scores, competencyScores, department }
  const [lastAnswers, setLastAnswers] = useState(null); // answers from the just-taken check (for coaching)
  const [questions, setQuestions] = useState(SEED_QUESTIONS); // active bank (seed fallback)
  const [results, setResults] = useState([]); // whole floor (for mentor data)
  const [moduleDomain, setModuleDomain] = useState(null);
  const [auditDomain, setAuditDomain] = useState(null);
  const [miniCheckDomain, setMiniCheckDomain] = useState(null);
  const [completedDomains, setCompletedDomains] = useState(new Set());
  const [loadError, setLoadError] = useState(false);
  // Cross-dept scores keyed by deptId — populated on mount + updated after each check.
  // Feeds deptMatrix so the "Strength across departments" strip shows real data for
  // every dept the navigator has taken, not just the currently active one.
  const [allDeptResults, setAllDeptResults] = useState({});

  // On mount: skip straight to deptselect so the navigator picks their department.
  // Also pre-fetch results for all assessed depts to power the cross-dept matrix.
  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoadError(true);
      setView('error');
      return;
    }
    setView('deptselect');
    Promise.all(
      ASSESSED_DEPTS.map(async (deptId) => {
        const res = await getResult(navigatorId, deptId).catch(() => null);
        return { deptId, scores: res?.scores ?? null };
      })
    ).then((entries) => {
      const map = {};
      for (const { deptId, scores } of entries) {
        if (scores) map[deptId] = scores;
      }
      setAllDeptResults(map);
    });
  }, [navigatorId]);

  // When a department is selected, check if this navigator already has a result there.
  const handleDeptSelect = async (dept) => {
    setActiveDept(dept);
    setView('loading');
    try {
      const res = await getResult(navigatorId, dept);
      if (res) {
        setOwnResult(res);
        setAllDeptResults((prev) => ({ ...prev, [dept]: res.scores }));
        // Fetch the active question bank for this department.
        const qs = await getActiveQuestions(dept).catch(() => []);
        if (qs.length > 0) setQuestions(qs);
        else setQuestions(SEED_BY_DEPT[dept] ?? SEED_QUESTIONS);
        setView('dashboard');
      } else {
        const qs = await getActiveQuestions(dept).catch(() => []);
        if (qs.length > 0) setQuestions(qs);
        else setQuestions(SEED_BY_DEPT[dept] ?? SEED_QUESTIONS);
        setView('check');
      }
    } catch {
      setLoadError(true);
      setView('error');
    }
  };

  // Live floor results — used only to compute mentor suggestions.
  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    const unsub = subscribeResults(setResults, (err) => {
      console.error('subscribeResults (navigator):', err);
      // Non-critical — mentor suggestions just won't update live.
    });
    return () => unsub();
  }, []);

  // Load the navigator's "Spot the Error" completions so MyTraining can show badges.
  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    let active = true;
    getCompletions(navigatorId)
      .then((list) => {
        if (!active) return;
        setCompletedDomains(new Set(list.map((c) => c.domainId)));
      })
      .catch(() => { /* completions are non-critical */ });
    return () => { active = false; };
  }, [navigatorId]);

  const handleSubmit = async (_ignoredName, answers) => {
    const dept = activeDept ?? 'pediatrics';
    const scores = scorePerDomain(answers, questions);
    const competencyScores = scorePerCompetency(answers, questions);
    setOwnResult({ name, navigatorId, scores, competencyScores, department: dept });
    setAllDeptResults((prev) => ({ ...prev, [dept]: scores }));
    setLastAnswers(answers);
    setView('coaching');
    try {
      await saveResult(navigatorId, name, scores, competencyScores, dept, answers);
    } catch {
      // Dashboard shows from local state; a failed write means supervisor won't see it.
    }
  };

  const handleChangeDept = () => {
    setActiveDept(null);
    setOwnResult(null);
    setLastAnswers(null);
    setView('deptselect');
  };

  const openModule = (domainId) => {
    setModuleDomain(domainId);
    setView('module');
  };

  const startAudit = (domainId) => {
    setAuditDomain(domainId);
    setView('audit');
  };

  const startMiniCheck = (domainId) => {
    setMiniCheckDomain(domainId);
    setView('minicheck');
  };

  // When a "Spot the Error" scenario completes, add the domain to the local Set
  // so the badge appears immediately without waiting for a Firestore round-trip.
  const handleAuditComplete = (domainId) => {
    setCompletedDomains((prev) => new Set([...prev, domainId]));
  };

  // Merge own result into the floor results for mentor suggestions.
  const merged = new Map();
  for (const r of results) merged.set(r.navigatorId ?? r.id, r);
  if (ownResult)
    merged.set(navigatorId, {
      name,
      navigatorId,
      scores: ownResult.scores,
      competencyScores: ownResult.competencyScores,
    });
  const rows = buildMatrixRows([...merged.values()], null);

  const dept = activeDept ?? 'pediatrics';
  const deptName = departmentName(dept);
  // Include allDeptResults so the strip shows real scores for every dept taken,
  // not just the currently active one. Merge ownResult in case it's fresher.
  const deptScoresMap = ownResult?.scores
    ? { ...allDeptResults, [dept]: ownResult.scores }
    : allDeptResults;
  const deptMatrix = Object.keys(deptScoresMap).length > 0
    ? departmentMatrix([{ name, departments: deptScoresMap }], null)
    : [];
  const myRow = findRow(rows, name);

  if (view === 'loading') {
    return (
      <Shell role="navigator" view="dashboard" setView={() => {}} onSignOut={onSignOut}>
        <EmptyState title="Loading…">One moment while we pull up your check.</EmptyState>
      </Shell>
    );
  }

  if (view === 'error') {
    return (
      <Shell role="navigator" view="dashboard" setView={() => {}} onSignOut={onSignOut}>
        <EmptyState title="Couldn't connect">
          The check isn't connected to its database yet, or the connection failed. Please let your
          supervisor know.
        </EmptyState>
      </Shell>
    );
  }

  if (view === 'deptselect') {
    return (
      <Shell role="navigator" view="deptselect" setView={() => {}} onSignOut={onSignOut}>
        <div className="dept-select view-enter">
          <h2 className="dept-select__title">Which department are you taking the check for?</h2>
          <p className="dept-select__sub">Your results are stored separately per department, so you can hold checks for multiple teams.</p>
          <div className="dept-select__grid">
            {ASSESSED_DEPTS.map((id) => (
              <button
                key={id}
                className="dept-select__card card"
                onClick={() => handleDeptSelect(id)}
              >
                <span className="dept-select__name">{departmentName(id)}</span>
                <span className="dept-select__badge">Live check</span>
              </button>
            ))}
          </div>
        </div>
      </Shell>
    );
  }

  // Only show dept switcher outside the check itself — switching mid-quiz would lose progress.
  const showDeptSwitcher = activeDept && view !== 'check' && view !== 'coaching';

  return (
    <Shell
      role="navigator"
      view={view}
      setView={setView}
      onSignOut={onSignOut}
      activeDeptName={showDeptSwitcher ? deptName : null}
      onChangeDept={handleChangeDept}
    >
      {view === 'check' && (
        <Check
          onSubmit={handleSubmit}
          onCancel={() => setView('deptselect')}
          questions={questions}
          hideName
          greetingName={name}
          deptName={deptName}
        />
      )}

      {view === 'coaching' && lastAnswers && ownResult && (
        <Coaching
          questions={questions}
          answers={lastAnswers}
          competencyScores={ownResult.competencyScores}
          name={name}
          onContinue={() => setView('dashboard')}
        />
      )}

      {view === 'dashboard' &&
        (myRow ? (
          <NavigatorDetail
            rows={rows}
            name={name}
            deptName={deptName}
            dept={activeDept ?? 'pediatrics'}
            deptMatrix={deptMatrix}
            onBack={null}
            onOpenNavigator={null}
            onPreviewModule={openModule}
            onChangeDept={handleDeptSelect}
            navigatorId={navigatorId}
            answers={ownResult?.answers ?? lastAnswers}
            questions={questions}
          />
        ) : (
          <EmptyState title="No results yet">
            It looks like your check hasn't been recorded.{' '}
            <button className="linkbtn" onClick={() => setView('check')}>Take the check</button>.
          </EmptyState>
        ))}

      {view === 'training' &&
        (myRow ? (
          <MyTraining
            row={myRow}
            onPreviewModule={openModule}
            onStartAudit={startAudit}
            onStartMiniCheck={startMiniCheck}
            completedDomains={completedDomains}
            department={activeDept ?? 'pediatrics'}
          />
        ) : (
          <EmptyState title="No training yet">
            Take the check first and your training plan will appear here.
          </EmptyState>
        ))}

      {view === 'module' && (
        <TrainingModule
          rows={rows}
          domainId={moduleDomain}
          onBack={() => setView('training')}
          onOpenNavigator={null}
          showCohort={false}
          backLabel="← Back to my training"
        />
      )}

      {view === 'interview' && (
        <Interview navigatorId={navigatorId} name={name} department={dept} />
      )}

      {view === 'audit' && auditDomain && (
        <SpotTheError
          navigatorId={navigatorId}
          name={name}
          domainId={auditDomain}
          department={dept}
          onBack={() => setView('training')}
          onComplete={handleAuditComplete}
        />
      )}

      {view === 'minicheck' && miniCheckDomain && (
        <Check
          onSubmit={async (_n, answers) => {
            const scores = scorePerDomain(answers, questions);
            const domainScore = scores[miniCheckDomain] ?? 0;
            const passed = domainScore >= MINICHECK_PASS;
            // Always record the minicheck completion regardless of pass/fail
            try {
              await saveCompletion(navigatorId, name, miniCheckDomain, 'minicheck');
              setCompletedDomains((prev) => new Set([...prev, miniCheckDomain]));
            } catch {/* non-critical */}
            if (passed) {
              // Re-save result with updated scores so the trend chart gains a new point
              const allScores = { ...(ownResult?.scores ?? {}), [miniCheckDomain]: domainScore };
              const competencyScores = scorePerCompetency(answers, questions);
              try {
                await saveResult(navigatorId, name, allScores, competencyScores, dept, answers);
              } catch {/* non-critical */}
            }
            setView('training');
          }}
          onCancel={() => setView('training')}
          questions={questions}
          hideName
          greetingName={name}
          miniDomain={miniCheckDomain}
          limit={MINICHECK_SIZE}
        />
      )}
    </Shell>
  );
}

// Shared shell for the navigator: nav + main + footer.
function Shell({ role, view, setView, onSignOut, activeDeptName, onChangeDept, children }) {
  return (
    <div className="app">
      <Nav
        role={role}
        view={view}
        setView={setView}
        onSignOut={onSignOut}
        activeDeptName={activeDeptName}
        onChangeDept={onChangeDept}
      />
      <main className="main">{children}</main>
      <Footer />
    </div>
  );
}
