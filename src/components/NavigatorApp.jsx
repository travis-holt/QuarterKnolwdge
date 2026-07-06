import { useState, useEffect, useRef } from 'react';
import Nav from './Nav.jsx';
import Check from './Check.jsx';
import Coaching from './Coaching.jsx';
import NavigatorDetail from './NavigatorDetail.jsx';
import MyTraining from './MyTraining.jsx';
import TrainingModule from './TrainingModule.jsx';
import Interview from './Interview.jsx';
import MyHistory from './MyHistory.jsx';
import VoiceCall from './VoiceCall.jsx';
import SpotTheError from './SpotTheError.jsx';
import EmptyState from './EmptyState.jsx';
import Footer from './Footer.jsx';
import {
  scorePerDomain,
  scorePerCompetency,
  scoreQaAcrossDomains,
  buildMatrixRows,
  departmentMatrix,
  findRow,
} from '../lib/scoring.js';
import { getResult, saveResult, getFloorScores, getActiveQuestions, getCompletions, getInterviews, saveCompletion } from '../lib/db.js';
import { MINICHECK_SIZE, MINICHECK_PASS } from '../data/config.js';
import { isFirebaseConfigured } from '../lib/firebase.js';
import { SEED_QUESTIONS, SEED_QUESTIONS_OBGYN, DOMAINS } from '../data/questions.js';
import { ASSESSED_DEPTS, departmentName } from '../data/departments.js';

// Seed fallbacks keyed by department so offline mode works for both.
const SEED_BY_DEPT = {
  pediatrics: SEED_QUESTIONS,
  obgyn: SEED_QUESTIONS_OBGYN,
};

// Every domain id — the full-profile "Spot the Error" assessment covers them all.
const ALL_DOMAIN_IDS = DOMAINS.map((d) => d.id);

// The navigator's self-contained app. They can ONLY ever see their own data:
// there is no route to the matrix, overview, or other navigators' dashboards.
// (They do receive the floor's results — read-only — so mentor suggestions can
// name colleagues who can teach their growth domains, but those names are not
// clickable and open nothing.)
export default function NavigatorApp({ navigatorId, name, onSignOut }) {
  const [view, setView] = useState('loading'); // loading · deptselect · typeselect · check · spotfull · coaching · dashboard · history · training · module · interview · audit · minicheck
  const [activeDept, setActiveDept] = useState(null); // chosen by navigator at deptselect
  // A navigator can hold BOTH an MCQ and a Spot the Error result per department;
  // both are kept so they can take (and view) either. `activeType` is the one
  // currently being viewed/updated; `ownResult` is derived from it.
  const [resultsByType, setResultsByType] = useState({ mcq: null, spot: null, qa: null });
  const [activeType, setActiveType] = useState(null); // 'mcq' | 'spot' | 'qa' | null
  const [lastAnswers, setLastAnswers] = useState(null); // answers from the just-taken check (for coaching)
  const [questions, setQuestions] = useState(SEED_QUESTIONS); // active bank (seed fallback)
  const [results, setResults] = useState([]); // whole floor (for mentor data)
  const [moduleDomain, setModuleDomain] = useState(null);
  const [auditDomain, setAuditDomain] = useState(null);
  const [miniCheckDomain, setMiniCheckDomain] = useState(null);
  const [practiceMode, setPracticeMode] = useState(null); // null (chooser) · 'voice' · 'chat'
  const [completedDomains, setCompletedDomains] = useState(new Set());
  const [completions, setCompletions] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [loadError, setLoadError] = useState(false);
  // H2: surface (and allow retry of) failed result saves instead of swallowing
  // them. When a save to Firestore fails, the navigator's dashboard still renders
  // from local state, but the supervisor never sees the result — so we must tell
  // the navigator and let them retry rather than leaving them falsely "done".
  const [saveError, setSaveError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const pendingSaveRef = useRef(null); // { args:[...saveResult args], onSuccess? }
  // Cross-dept scores keyed by deptId — populated on mount + updated after each check.
  // Feeds deptMatrix so the "Strength across departments" strip shows real data for
  // every dept the navigator has taken, not just the currently active one.
  const [allDeptResults, setAllDeptResults] = useState({});

  // Derived: the result currently in view, and which types exist.
  const ownResult = activeType ? resultsByType[activeType] : null;
  const hasMcq = Boolean(resultsByType.mcq);
  const hasSpot = Boolean(resultsByType.spot);
  const hasQa = Boolean(resultsByType.qa);

  // Given both loaded results, which one to show by default (the most recent).
  const pickActiveType = (byType) => {
    return ['mcq', 'spot', 'qa']
      .filter((type) => byType[type])
      .sort((a, b) => (byType[b].submittedAt?.seconds ?? -1) - (byType[a].submittedAt?.seconds ?? -1))[0] ?? null;
  };

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
        const [mcq, spot, qa] = await Promise.all([
          getResult(navigatorId, deptId, 'mcq').catch(() => null),
          getResult(navigatorId, deptId, 'spot').catch(() => null),
          getResult(navigatorId, deptId, 'qa').catch(() => null),
        ]);
        // Most recent result's scores drive the cross-dept strip for this dept.
        const byType = { mcq, spot, qa };
        const type = pickActiveType(byType);
        return { deptId, scores: type ? byType[type].scores : null };
      })
    ).then((entries) => {
      const map = {};
      for (const { deptId, scores } of entries) {
        if (scores) map[deptId] = scores;
      }
      setAllDeptResults(map);
    });
  }, [navigatorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a department is selected, load BOTH result types for it.
  const handleDeptSelect = async (dept) => {
    setActiveDept(dept);
    setView('loading');
    try {
      const [mcq, spot, qa] = await Promise.all([
        getResult(navigatorId, dept, 'mcq'),
        getResult(navigatorId, dept, 'spot'),
        getResult(navigatorId, dept, 'qa'),
      ]);
      setResultsByType({ mcq, spot, qa });
      const byType = { mcq, spot, qa };
      const type = pickActiveType(byType);
      setActiveType(type);
      // Fetch the active question bank for this department (needed by MCQ + coaching).
      const qs = await getActiveQuestions(dept).catch(() => []);
      setQuestions(qs.length > 0 ? qs : (SEED_BY_DEPT[dept] ?? SEED_QUESTIONS));
      if (type) {
        setAllDeptResults((prev) => ({ ...prev, [dept]: byType[type].scores }));
        setView('dashboard');
      } else {
        setView('typeselect'); // no results yet → pick an assessment
      }
    } catch {
      setLoadError(true);
      setView('error');
    }
  };

  // Floor scores — used ONLY to compute mentor suggestions (which colleagues can
  // teach a domain). C4: a one-time, minimized `{ name, scores }` projection
  // instead of a live subscription to every peer's full result doc. This drops
  // peers' raw `answers` + competency detail from the navigator's client and
  // stops the continuous broadcast. Mentor suggestions no longer update live —
  // acceptable (they were already flagged non-critical).
  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    let active = true;
    getFloorScores()
      .then((list) => { if (active) setResults(list); })
      .catch((err) => console.error('getFloorScores (navigator):', err));
    return () => { active = false; };
  }, []);

  // Load exercise/interview evidence when views need progress indicators.
  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    if (view !== 'dashboard' && view !== 'training') return undefined;
    let active = true;
    getCompletions(navigatorId)
      .then((list) => {
        if (!active) return;
        setCompletions(list);
        setCompletedDomains(new Set(
          list.filter((c) => !c.kind || c.kind === 'practice').map((c) => c.domainId)
        ));
      })
      .catch(() => { /* completions are non-critical */ });
    return () => { active = false; };
  }, [navigatorId, view]);

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    if (view !== 'dashboard' && view !== 'training') return undefined;
    let active = true;
    getInterviews(navigatorId)
      .then((list) => {
        if (!active) return;
        setInterviews(list);
      })
      .catch(() => { /* interviews are non-critical */ });
    return () => { active = false; };
  }, [navigatorId, view]);

  // Reset the practice-type chooser whenever the navigator leaves the Practice tab.
  // (Must live with the other hooks, above the early returns — never after them.)
  useEffect(() => { if (view !== 'interview') setPracticeMode(null); }, [view]);

  // Persist a result to Firestore, surfacing failures for retry. Local UI state
  // is updated by the callers BEFORE this runs, so the navigator always sees
  // their score; this only governs whether the supervisor's copy is written.
  const persistResult = async (args, onSuccess) => {
    try {
      await saveResult(...args);
      setSaveError(false);
      pendingSaveRef.current = null;
      onSuccess?.();
      return true;
    } catch {
      pendingSaveRef.current = { args, onSuccess };
      setSaveError(true);
      return false;
    }
  };

  const retrySave = async () => {
    const pending = pendingSaveRef.current;
    if (!pending || retrying) return;
    setRetrying(true);
    try {
      await saveResult(...pending.args);
      setSaveError(false);
      pendingSaveRef.current = null;
      pending.onSuccess?.();
    } catch {
      setSaveError(true);
    } finally {
      setRetrying(false);
    }
  };

  const handleSubmit = async (_ignoredName, answers) => {
    const dept = activeDept ?? 'pediatrics';
    const scores = scorePerDomain(answers, questions);
    const competencyScores = scorePerCompetency(answers, questions);
    const now = { seconds: Math.floor(Date.now() / 1000) };
    const result = { name, navigatorId, scores, competencyScores, answers, department: dept, assessmentType: 'mcq', submittedAt: now };
    setResultsByType((prev) => ({ ...prev, mcq: result }));
    setActiveType('mcq');
    setAllDeptResults((prev) => ({ ...prev, [dept]: scores }));
    setLastAnswers(answers);
    setView('coaching');
    await persistResult([navigatorId, name, scores, competencyScores, dept, answers, 'mcq']);
  };

  const handleChangeDept = () => {
    setActiveDept(null);
    setResultsByType({ mcq: null, spot: null, qa: null });
    setActiveType(null);
    setLastAnswers(null);
    setView('deptselect');
  };

  // From the dashboard: go take another assessment (MCQ or Spot) for this dept.
  const handleTakeAnother = () => setView('typeselect');

  // Switch which stored result the dashboard/training views reflect.
  const handleSwitchType = (type) => {
    if (resultsByType[type]) setActiveType(type);
  };

  const openModule = (domainId) => {
    setModuleDomain(domainId);
    setView('module');
  };

  const startAudit = (domainId) => {
    setAuditDomain(domainId);
    setView('audit');
  };

  const startInterview = () => {
    setPracticeMode(null);
    setView('interview');
  };

  const startMiniCheck = (domainId) => {
    setMiniCheckDomain(domainId);
    setView('minicheck');
  };

  // When a "Spot the Error" assessment completes, feed its click-accuracy scores
  // back into the navigator's capability ratings and record a practice completion
  // for each assessed domain. `domainScores` is a { domainId: percent } map (one
  // entry in training mode, all domains in full-profile mode).
  //   mode 'full'   → this IS the Spot result: replace the whole Spot profile.
  //   mode 'domain' → merge the assessed domain into whichever profile is active
  //                   (the training plan is derived from the active result).
  const handleSpotComplete = async (domainScores, mode) => {
    const domainIds = Object.keys(domainScores);
    const now = { seconds: Math.floor(Date.now() / 1000) };
    setCompletedDomains((prev) => new Set([...prev, ...domainIds]));
    setCompletions((prev) => [
      ...prev,
      ...domainIds.map((domainId) => ({ navigatorId, name, domainId, kind: 'practice', completedAt: now })),
    ]);
    for (const domainId of domainIds) {
      try { await saveCompletion(navigatorId, name, domainId, 'practice'); } catch (err) { console.error('saveCompletion (practice):', err); }
    }

    const targetType = mode === 'full' ? 'spot' : (activeType ?? 'spot');
    const target = resultsByType[targetType];
    const baseScores = mode === 'full' ? {} : (target?.scores ?? {});
    const allScores = { ...baseScores, ...domainScores };
    const competencyScores = mode === 'full' ? {} : (target?.competencyScores ?? {});
    const answers = mode === 'full' ? {} : (target?.answers ?? {});
    const result = { name, navigatorId, department: dept, assessmentType: targetType, scores: allScores, competencyScores, answers, submittedAt: now };
    setResultsByType((prev) => ({ ...prev, [targetType]: result }));
    setActiveType(targetType);
    setAllDeptResults((prev) => ({ ...prev, [dept]: allScores }));
    await persistResult([navigatorId, name, allScores, competencyScores, dept, answers, targetType]);
  };

  const handleQaComplete = async (qa) => {
    const scores = scoreQaAcrossDomains(qa);
    const now = { seconds: Math.floor(Date.now() / 1000) };
    const result = { name, navigatorId, department: dept, assessmentType: 'qa', scores, competencyScores: {}, answers: {}, submittedAt: now };
    setResultsByType((prev) => ({ ...prev, qa: result }));
    setActiveType('qa');
    setAllDeptResults((prev) => ({ ...prev, [dept]: scores }));
    await persistResult([navigatorId, name, scores, {}, dept, {}, 'qa']);
  };

  // Merge own result into the floor results for mentor suggestions. Floor rows
  // come from the minimized projection (name + scores only, keyed by name); the
  // navigator's own row is keyed by name too so it replaces any floor copy.
  const merged = new Map();
  for (const r of results) merged.set(r.navigatorId ?? r.name, r);
  if (ownResult)
    merged.set(name, {
      name,
      navigatorId,
      scores: ownResult.scores,
      competencyScores: ownResult.competencyScores,
    });
  const rows = buildMatrixRows([...merged.values()], null);

  const dept = activeDept ?? 'pediatrics';
  const deptName = departmentName(dept);
  const latestQa = latestQaForDept(interviews, dept);
  const practiceInterviews = interviews.filter((iv) => !iv?.qa);
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

  // Only show dept switcher outside an in-progress assessment — switching mid-quiz would lose progress.
  const showDeptSwitcher = activeDept && view !== 'check' && view !== 'spotfull' && view !== 'qatest' && view !== 'coaching';

  return (
    <Shell
      role="navigator"
      view={view}
      setView={setView}
      onSignOut={onSignOut}
      activeDeptName={showDeptSwitcher ? deptName : null}
      onChangeDept={handleChangeDept}
    >
      {saveError && (
        <div className="subscribe-error" role="alert">
          ⚠ Your latest result hasn’t saved to the server yet — your supervisor can’t see it. Stay
          on this page and{' '}
          <button className="linkbtn" onClick={retrySave} disabled={retrying}>
            {retrying ? 'retrying…' : 'retry now'}
          </button>
          .
        </div>
      )}

      {view === 'typeselect' && (
        <AssessmentTypeChooser
          deptName={deptName}
          taken={{ mcq: hasMcq, spot: hasSpot, qa: hasQa }}
          latestQa={latestQa}
          onPick={(type) => setView(type === 'spot' ? 'spotfull' : type === 'qa' ? 'qatest' : 'check')}
        />
      )}

      {view === 'check' && (
        <Check
          onSubmit={handleSubmit}
          onCancel={() => setView('typeselect')}
          questions={questions}
          hideName
          greetingName={name}
          deptName={deptName}
          persistKey={`qkc_progress_${navigatorId}_${dept}`}
        />
      )}

      {view === 'spotfull' && (
        <SpotTheError
          navigatorId={navigatorId}
          name={name}
          domains={ALL_DOMAIN_IDS}
          mode="full"
          department={dept}
          onBack={() => setView('typeselect')}
          onFinish={() => setView('dashboard')}
          onComplete={handleSpotComplete}
        />
      )}

      {view === 'qatest' && (
        <VoiceCall
          navigatorId={navigatorId}
          name={name}
          department={dept}
          mode="test"
          onQaResult={handleQaComplete}
          onExit={() => setView('typeselect')}
          onDone={() => setView('dashboard')}
        />
      )}

      {view === 'coaching' && lastAnswers && ownResult && (
        <Coaching
          questions={questions}
          answers={lastAnswers}
          competencyScores={ownResult.competencyScores}
          name={name}
          completions={completions}
          interviews={practiceInterviews}
          priorResults={Object.entries(allDeptResults).map(([department, scores]) => ({ department, scores }))}
          onContinue={() => setView('dashboard')}
        />
      )}

      {view === 'dashboard' && (
        <>
          {latestQa && (
            <QaLatestCard qa={latestQa.qa} endedAt={latestQa.endedAt} onRetake={() => setView('qatest')} />
          )}
          {myRow ? (
            <>
              <AssessmentBar
                activeType={activeType}
                resultsByType={resultsByType}
                onSwitch={handleSwitchType}
                onTakeAnother={handleTakeAnother}
              />
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
                completions={completions}
                answers={ownResult?.answers ?? lastAnswers}
                questions={questions}
              />
            </>
          ) : (
            <EmptyState title="No domain results yet">
              Take any assessment and your six domain scores will appear here.{' '}
              <button className="linkbtn" onClick={() => setView('typeselect')}>Start one now</button>.
            </EmptyState>
          )}
        </>
      )}

      {view === 'history' && (
        <MyHistory
          navigatorId={navigatorId}
          department={dept}
          deptName={deptName}
          resultsByType={resultsByType}
          questions={questions}
        />
      )}

      {view === 'training' &&
        (myRow ? (
          <MyTraining
            row={myRow}
            onPreviewModule={openModule}
            onStartAudit={startAudit}
            onStartInterview={startInterview}
            onStartMiniCheck={startMiniCheck}
            completedDomains={completedDomains}
            completions={completions}
            interviews={practiceInterviews}
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

      {view === 'interview' && practiceMode === null && (
        <PracticeChooser onPick={setPracticeMode} />
      )}
      {view === 'interview' && practiceMode === 'voice' && (
        <VoiceCall navigatorId={navigatorId} name={name} department={dept} onExit={() => setPracticeMode(null)} />
      )}
      {view === 'interview' && practiceMode === 'test' && (
        <VoiceCall
          navigatorId={navigatorId}
          name={name}
          department={dept}
          onExit={() => setPracticeMode(null)}
          onQaResult={handleQaComplete}
          mode="test"
        />
      )}
      {view === 'interview' && practiceMode === 'chat' && (
        <>
          <button className="linkbtn" onClick={() => setPracticeMode(null)} style={{ marginBottom: '1rem' }}>← Call type</button>
          <Interview navigatorId={navigatorId} name={name} department={dept} />
        </>
      )}

      {view === 'audit' && auditDomain && (
        <SpotTheError
          navigatorId={navigatorId}
          name={name}
          domains={[auditDomain]}
          mode="domain"
          department={dept}
          onBack={() => setView('training')}
          onFinish={() => setView('training')}
          onComplete={handleSpotComplete}
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
            } catch (err) { console.error('saveCompletion (minicheck):', err); }
            if (passed) {
              // Re-save the active profile with the updated domain so the trend chart gains a point.
              const targetType = activeType ?? 'mcq';
              const target = resultsByType[targetType];
              const allScores = { ...(target?.scores ?? {}), [miniCheckDomain]: domainScore };
              const baseAnswers = target?.answers ?? lastAnswers ?? {};
              const mergedAnswers = { ...baseAnswers, ...answers };
              const hasFullAnswerContext = Object.keys(baseAnswers).length > 0;
              const competencyScores = hasFullAnswerContext
                ? scorePerCompetency(mergedAnswers, questions)
                : (target?.competencyScores ?? {});
              const savedAnswers = hasFullAnswerContext ? mergedAnswers : answers;
              // Update local state immediately so the navigator sees the new
              // score, then persist (with retry-on-failure surfacing) for the
              // supervisor's copy.
              setResultsByType((prev) => ({
                ...prev,
                [targetType]: {
                  ...(prev[targetType] ?? {}),
                  name,
                  navigatorId,
                  department: dept,
                  assessmentType: targetType,
                  scores: allScores,
                  competencyScores,
                  answers: savedAnswers,
                },
              }));
              setAllDeptResults((prev) => ({ ...prev, [dept]: allScores }));
              await persistResult([navigatorId, name, allScores, competencyScores, dept, savedAnswers, targetType]);
            }
            setCompletions((prev) => [
              ...prev,
              { navigatorId, name, domainId: miniCheckDomain, kind: 'minicheck', completedAt: { seconds: Math.floor(Date.now() / 1000) } },
            ]);
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

// Dashboard control bar — shows which assessment the profile is from, lets the
// navigator switch between saved assessment results, and launches another one.
const TYPE_LABEL = { mcq: 'Multiple choice', spot: 'Spot the Error', qa: 'Call QA Test' };

function latestBy(items, score) {
  return items.reduce((best, item) => (!best || score(item) > score(best) ? item : best), null);
}

function latestQaForDept(interviews, dept) {
  return latestBy(
    interviews.filter((iv) => iv?.qa && (iv.department ?? 'pediatrics') === dept),
    (iv) => iv.endedAt?.seconds ?? 0
  );
}

function formatQaDate(ts) {
  if (!ts?.seconds) return 'Date pending';
  return new Date(ts.seconds * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function AssessmentBar({ activeType, resultsByType, onSwitch, onTakeAnother }) {
  const takenTypes = ['mcq', 'spot', 'qa'].filter((t) => resultsByType[t]);
  const multiTaken = takenTypes.length > 1;
  return (
    <div className="assess-bar">
      {multiTaken ? (
        <div className="assess-bar__toggle" role="group" aria-label="Which assessment to view">
          <span className="assess-bar__label">Showing:</span>
          {takenTypes.map((t) => (
            <button
              key={t}
              type="button"
              className={`assess-bar__pill ${activeType === t ? 'is-active' : ''}`}
              onClick={() => onSwitch(t)}
              aria-pressed={activeType === t}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      ) : (
        <span className="assess-bar__label">
          From your <strong>{TYPE_LABEL[activeType] ?? 'assessment'}</strong> result
        </span>
      )}
      <button type="button" className="btn btn--ghost btn--sm" onClick={onTakeAnother}>
        {multiTaken ? 'Retake an assessment' : 'Take another assessment'}
      </button>
    </div>
  );
}

// Assessment-type chooser: all three assessment types feed the capability matrix.
function QaLatestCard({ qa, endedAt, onRetake }) {
  return (
    <div className={`card qa-latest ${qa.pass ? 'qa-latest--pass' : 'qa-latest--fail'}`}>
      <div>
        <p className="qa-latest__eyebrow">Latest Call QA Test</p>
        <h2 className="qa-latest__title">{qa.pass ? 'PASS' : 'FAIL'}</h2>
        <p className="qa-latest__meta">{qa.score}/100 - {formatQaDate(endedAt)}</p>
      </div>
      <button className="btn btn--ghost btn--sm" onClick={onRetake} type="button">
        Retake
      </button>
    </div>
  );
}

function AssessmentTypeChooser({ deptName, taken = {}, latestQa, onPick }) {
  return (
    <section className="interview view-enter">
      <header className="overview__head">
        <div>
          <h1 className="overview__title">Choose your assessment</h1>
          <p className="overview__lede">
            Choose how to be assessed for {deptName}. All assessment types update your domain profile.
          </p>
        </div>
      </header>
      <div className="practice-choice">
        <button className="card practice-choice__card" onClick={() => onPick('mcq')} type="button">
          {taken.mcq && <span className="practice-choice__taken">✓ Completed — retake</span>}
          <span className="practice-choice__glyph" aria-hidden="true">📝</span>
          <h2 className="practice-choice__title">Multiple choice</h2>
          <p className="practice-choice__desc">
            Work through scenario questions and choose the best action. Measures every domain and
            competency.
          </p>
        </button>
        <button className="card practice-choice__card" onClick={() => onPick('spot')} type="button">
          {taken.spot && <span className="practice-choice__taken">✓ Completed — retake</span>}
          <span className="practice-choice__glyph" aria-hidden="true">🔍</span>
          <h2 className="practice-choice__title">Spot the Error</h2>
          <p className="practice-choice__desc">
            Read real call transcripts and find where the agent broke policy — one per domain. Scores
            your whole capability profile on click accuracy.
          </p>
        </button>
        <button className="card practice-choice__card practice-choice__card--test" onClick={() => onPick('qa')} type="button">
          {(latestQa || taken.qa) && <span className="practice-choice__taken">{latestQa ? (latestQa.qa.pass ? 'PASS' : 'FAIL') : 'Completed'} - retake</span>}
          <span className="practice-choice__glyph" aria-hidden="true">QA</span>
          <h2 className="practice-choice__title">Call QA Test</h2>
          <p className="practice-choice__desc">
            Graded voice call, pass/fail. Updates all six domain scores.
          </p>
        </button>
      </div>
    </section>
  );
}

// Shared shell for the navigator: nav + main + footer.
// Practice-type chooser — keeps the real-time voice call and the text chat as
// two separate experiences rather than mixing voice into the chat UI.
function PracticeChooser({ onPick }) {
  return (
    <section className="interview view-enter">
      <header className="overview__head">
        <div>
          <h1 className="overview__title">Practice Call</h1>
          <p className="overview__lede">Practice handling a patient call. Pick how you want to do it.</p>
        </div>
      </header>
      <div className="practice-choice">
        <button className="card practice-choice__card" onClick={() => onPick('voice')} type="button">
          <span className="practice-choice__glyph" aria-hidden="true">🎙️</span>
          <h2 className="practice-choice__title">Voice call</h2>
          <p className="practice-choice__desc">Talk out loud with a simulated patient in real time, like a real phone call. Needs a mic (works best in Chrome/Edge, with headphones).</p>
        </button>
        <button className="card practice-choice__card" onClick={() => onPick('chat')} type="button">
          <span className="practice-choice__glyph" aria-hidden="true">💬</span>
          <h2 className="practice-choice__title">Text chat</h2>
          <p className="practice-choice__desc">Type your responses turn by turn. Works on any browser, no mic needed.</p>
        </button>
        <button className="card practice-choice__card practice-choice__card--test" onClick={() => onPick('test')} type="button">
          <span className="practice-choice__glyph" aria-hidden="true">🎯</span>
          <h2 className="practice-choice__title">Call QA Test</h2>
          <p className="practice-choice__desc">
            A graded voice call scored hard against the full quality scorecard — pass or fail,
            with auto-fail rules. Needs a mic.
          </p>
        </button>
      </div>
    </section>
  );
}

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
