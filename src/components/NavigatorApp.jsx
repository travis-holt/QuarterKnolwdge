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
import PhaseHub from './PhaseHub.jsx';
import EmptyState from './EmptyState.jsx';
import Footer from './Footer.jsx';
import {
  scorePerDomain,
  scorePerCompetency,
  buildMatrixRows,
  departmentMatrix,
  findRow,
} from '../lib/scoring.js';
import { mergeNavigatorFloorAndOwnResult } from '../lib/navigatorResultMerge.js';
import { getResult, saveResult, getActiveQuestions, getCompletions, saveCompletion } from '../lib/db.js';
import { apiFetch } from '../lib/apiFetch.js';
import { MINICHECK_SIZE, MINICHECK_PASS } from '../data/config.js';
import { phasesComplete, completedCount, latestQaForDept } from '../lib/phases.js';
import { ResultSaveQueue } from '../lib/resultSaveQueue.js';
import { clientTimestamp, compareTimestampValues, timestampMillis } from '../lib/time.js';
import { qaSummaryLabel, qaBadgeTone } from '../lib/qaFinalReview.js';
import { isFirebaseConfigured } from '../lib/firebase.js';
import { SEED_QUESTIONS, SEED_QUESTIONS_OBGYN, DOMAINS, domainName } from '../data/questions.js';
import { ASSESSED_DEPTS, departmentName } from '../data/departments.js';

// Seed fallbacks keyed by department so offline mode works for both.
const SEED_BY_DEPT = {
  pediatrics: SEED_QUESTIONS,
  obgyn: SEED_QUESTIONS_OBGYN,
};

// Every domain id — the full-profile "Spot the Error" assessment covers them all.
const ALL_DOMAIN_IDS = DOMAINS.map((d) => d.id);

const getOwnInterviews = () => apiFetch('/api/my-interviews', {}, 15_000)
  .then((data) => data?.interviews ?? []);

// The navigator's self-contained app. They can ONLY ever see their own data:
// there is no route to the matrix, overview, or other navigators' dashboards.
// (They do receive the floor's results — read-only — so mentor suggestions can
// name colleagues who can teach their growth domains, but those names are not
// clickable and open nothing.)
export default function NavigatorApp({ navigatorId, name, onSignOut }) {
  const [view, setView] = useState('loading'); // loading · deptselect · phases · check · spotfull · coaching · dashboard · history · training · module · interview · audit · minicheck · qatest
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
  const [moduleCompletionKind, setModuleCompletionKind] = useState(null);
  const [auditDomain, setAuditDomain] = useState(null);
  const [miniCheckDomain, setMiniCheckDomain] = useState(null);
  const [miniCheckOutcome, setMiniCheckOutcome] = useState(null); // { domainId, score, passed, pending? }
  const [practiceMode, setPracticeMode] = useState(null); // null (chooser) · 'voice' · 'chat'
  const [practiceDomain, setPracticeDomain] = useState(null); // targeted dev-path domain; null = random practice
  const [completedDomains, setCompletedDomains] = useState(new Set());
  const [completions, setCompletions] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [loadError, setLoadError] = useState(false);
  // H2: surface (and allow retry of) failed result saves instead of swallowing
  // them. When a save to Firestore fails, the navigator's dashboard still renders
  // from local state, but the supervisor never sees the result — so we must tell
  // the navigator and let them retry rather than leaving them falsely "done".
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const resultSaveQueueRef = useRef(null);
  resultSaveQueueRef.current ??= new ResultSaveQueue(saveResult);
  // Cross-dept scores keyed by deptId — populated on mount + updated after each check.
  // Feeds deptMatrix so the "Strength across departments" strip shows real data for
  // every dept the navigator has taken, not just the currently active one.
  const [allDeptResults, setAllDeptResults] = useState({});

  // Derived: the result currently in view, and which types exist.
  const ownResult = activeType ? resultsByType[activeType] : null;
  const hasMcq = Boolean(resultsByType.mcq);
  const hasSpot = Boolean(resultsByType.spot);

  // Given both loaded results, which one to show by default (the most recent).
  const pickActiveType = (byType) => {
    return ['mcq', 'spot', 'qa']
      .filter((type) => type !== 'qa')
      .filter((type) => byType[type])
      .sort((a, b) => compareTimestampValues(byType[b].submittedAt, byType[a].submittedAt))[0] ?? null;
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
      const [mcq, spot, qa, ivs] = await Promise.all([
        getResult(navigatorId, dept, 'mcq'),
        getResult(navigatorId, dept, 'spot'),
        getResult(navigatorId, dept, 'qa'),
        getOwnInterviews().catch(() => []),
      ]);
      setResultsByType({ mcq, spot, qa });
      setInterviews(ivs);
      const byType = { mcq, spot, qa };
      const type = pickActiveType(byType);
      setActiveType(type);
      // Fetch the active question bank for this department (needed by MCQ + coaching).
      const qs = await getActiveQuestions(dept).catch(() => []);
      setQuestions(qs.length > 0 ? qs : (SEED_BY_DEPT[dept] ?? SEED_QUESTIONS));
      if (type) setAllDeptResults((prev) => ({ ...prev, [dept]: byType[type].scores }));
      // Land on the dashboard only when the full 3-phase assessment is complete;
      // otherwise the phase hub shows what's next (D5).
      const allDone = phasesComplete({
        mcq: Boolean(mcq),
        spot: Boolean(spot),
        qa: Boolean(latestQaForDept(ivs, dept)),
      });
      setView(allDone ? 'dashboard' : 'phases');
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
    if (!activeDept) return undefined;
    apiFetch('/api/mentor-scores', { department: activeDept }, 15_000)
      .then((data) => { if (active) setResults(data.results ?? []); })
      .catch((err) => console.error('mentor-scores (navigator):', err));
    return () => { active = false; };
  }, [activeDept]);

  // Load exercise/interview evidence when views need progress indicators.
  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    if (view !== 'dashboard' && view !== 'training') return undefined;
    let active = true;
    const dept = activeDept ?? 'pediatrics';
    getCompletions(navigatorId, dept)
      .then((list) => {
        if (!active) return;
        setCompletions(list);
        setCompletedDomains(new Set(
          list.filter((c) => !c.kind || c.kind === 'practice').map((c) => c.domainId)
        ));
      })
      .catch(() => { /* completions are non-critical */ });
    return () => { active = false; };
  }, [navigatorId, activeDept, view]);

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    if (view !== 'dashboard' && view !== 'training' && view !== 'phases') return undefined;
    let active = true;
    getOwnInterviews()
      .then((list) => {
        if (!active) return;
        setInterviews(list);
      })
      .catch(() => { /* interviews are non-critical */ });
    return () => { active = false; };
  }, [navigatorId, view]);

  // Reset the practice-type chooser whenever the navigator leaves the Practice tab.
  // (Must live with the other hooks, above the early returns — never after them.)
  useEffect(() => {
    if (view !== 'interview') {
      setPracticeMode(null);
      setPracticeDomain(null);
    }
  }, [view]);

  // Persist a result to Firestore, surfacing failures for retry. Local UI state
  // is updated by the callers BEFORE this runs, so the navigator always sees
  // their score; this only governs whether the supervisor's copy is written.
  const persistResult = async (args, onSuccess) => {
    const saved = await resultSaveQueueRef.current.save(args, onSuccess);
    setPendingSaveCount(resultSaveQueueRef.current.size);
    return saved;
  };

  const retrySave = async () => {
    if (resultSaveQueueRef.current.size === 0 || retrying) return;
    setRetrying(true);
    await resultSaveQueueRef.current.retryAll();
    setPendingSaveCount(resultSaveQueueRef.current.size);
    setRetrying(false);
  };

  const handleSubmit = async (_ignoredName, answers) => {
    const dept = activeDept ?? 'pediatrics';
    const scores = scorePerDomain(answers, questions);
    const competencyScores = scorePerCompetency(answers, questions);
    const now = clientTimestamp();
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

  // From the dashboard: back to the 3-phase assessment hub (continue or retake).
  const handleTakeAnother = () => setView('phases');

  // Switch which stored result the dashboard/training views reflect.
  const handleSwitchType = (type) => {
    if (resultsByType[type]) setActiveType(type);
  };

  const openModule = (domainId, completionKind = null) => {
    setModuleDomain(domainId);
    setModuleCompletionKind(completionKind === 'coaching' || completionKind === 'module' ? completionKind : null);
    setView('module');
  };

  const completeLearningStep = async (kind) => {
    if (!moduleDomain || (kind !== 'coaching' && kind !== 'module')) return;
    await saveCompletion(navigatorId, name, moduleDomain, kind, dept);
    setCompletions((prev) => [
      ...prev,
      {
        navigatorId,
        name,
        department: dept,
        domainId: moduleDomain,
        kind,
        completedAt: clientTimestamp(),
      },
    ]);
    setModuleCompletionKind(null);
    setView('training');
  };

  const startAudit = (domainId) => {
    setAuditDomain(domainId);
    setView('audit');
  };

  const startInterview = (domainId = null) => {
    setPracticeDomain(DOMAINS.some((domain) => domain.id === domainId) ? domainId : null);
    setPracticeMode(null);
    setView('interview');
  };

  const startMiniCheck = (domainId) => {
    setMiniCheckDomain(domainId);
    setMiniCheckOutcome(null);
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
    const now = clientTimestamp();

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
    const localCompletions = domainIds.map((domainId) => ({
      navigatorId,
      name,
      department: dept,
      domainId,
      kind: 'practice',
      passed: true,
      completedAt: now,
    }));
    const markComplete = () => {
      setCompletedDomains((prev) => new Set([...prev, ...domainIds]));
      setCompletions((prev) => [...prev, ...localCompletions]);
    };
    return persistResult([
      navigatorId,
      name,
      allScores,
      competencyScores,
      dept,
      answers,
      targetType,
      domainIds.map((domainId) => ({ domainId, kind: 'practice', passed: true, score: domainScores[domainId] })),
    ], markComplete);
  };

  const handleQaComplete = async (qa, metadata = {}) => {
    setInterviews((prev) => [
      ...prev,
      { name, navigatorId, department: dept, endedAt: clientTimestamp(), qa, ...metadata },
    ]);
  };

  // Merge own result into the floor results for mentor suggestions. Floor rows
  // come from the minimized projection (name + navigatorId? + scores only).
  // navigatorId is the primary identity — a stale floor copy keyed by the
  // navigator's own navigatorId must not survive alongside a freshly loaded/
  // submitted own result, and a legacy no-ID floor row sharing the display
  // name must not duplicate it either. See lib/navigatorResultMerge.js.
  const ownProjection = ownResult
    ? { scores: ownResult.scores, competencyScores: ownResult.competencyScores }
    : null;
  const mergedResults = mergeNavigatorFloorAndOwnResult(results, ownProjection, { navigatorId, name });
  const rows = buildMatrixRows(mergedResults, null);

  const dept = activeDept ?? 'pediatrics';
  const deptName = departmentName(dept);
  const latestQa = latestQaForDept(interviews, dept);
  const practiceInterviews = interviews.filter((iv) => !iv?.qa);
  // 3-phase assessment: completion is derived, never stored (see src/lib/phases.js).
  // Phase 3 completion comes from the interview docs (the QA test does not write a
  // results doc), so a saved-but-ungraded call does not count as complete.
  const phaseDone = { mcq: hasMcq, spot: hasSpot, qa: Boolean(latestQa) };
  // Where to go after finishing a phase: the hub while phases remain, else the dashboard.
  const afterPhase = () => setView(phasesComplete(phaseDone) ? 'dashboard' : 'phases');
  // Include allDeptResults so the strip shows real scores for every dept taken,
  // not just the currently active one. Merge ownResult in case it's fresher.
  const deptScoresMap = ownResult?.scores
    ? { ...allDeptResults, [dept]: ownResult.scores }
    : allDeptResults;
  const deptMatrix = Object.keys(deptScoresMap).length > 0
    ? departmentMatrix([{ name, departments: deptScoresMap }], null)
    : [];
  const myRow = findRow(rows, navigatorId ?? name);

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
      {pendingSaveCount > 0 && (
        <div className="subscribe-error" role="alert">
          ⚠ {pendingSaveCount === 1 ? 'One result has' : `${pendingSaveCount} results have`} not
          saved to the server yet — your supervisor can’t see {pendingSaveCount === 1 ? 'it' : 'them'}. Stay
          on this page and{' '}
          <button className="linkbtn" onClick={retrySave} disabled={retrying}>
            {retrying ? 'retrying…' : 'retry all now'}
          </button>
          .
        </div>
      )}

      {view === 'phases' && (
        <PhaseHub
          deptName={deptName}
          done={phaseDone}
          results={resultsByType}
          latestQa={latestQa}
          onStart={(id) => setView(id === 'spot' ? 'spotfull' : id === 'qa' ? 'qatest' : 'check')}
        />
      )}

      {view === 'check' && (
        <Check
          onSubmit={handleSubmit}
          onCancel={() => setView('phases')}
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
          onBack={() => setView('phases')}
          onFinish={afterPhase}
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
          onExit={() => setView('phases')}
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
          onContinue={afterPhase}
        />
      )}

      {view === 'dashboard' && (
        <>
          {latestQa && (
            <QaLatestCard attempt={latestQa} onRetake={() => setView('qatest')} />
          )}
          {myRow ? (
            <>
              <AssessmentBar
                activeType={activeType}
                resultsByType={resultsByType}
                onSwitch={handleSwitchType}
                onTakeAnother={handleTakeAnother}
                phasesDone={completedCount(phaseDone)}
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
              Complete the assessment phases and your six domain scores will appear here.{' '}
              <button className="linkbtn" onClick={() => setView('phases')}>Start Phase 1 now</button>.
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
          <>
            {miniCheckOutcome && (
              <div className={`subscribe-error ${miniCheckOutcome.passed ? '' : 'is-warning'}`} role="status">
                {miniCheckOutcome.passed
                  ? miniCheckOutcome.pending
                    ? `You passed ${domainName(miniCheckOutcome.domainId)} at ${miniCheckOutcome.score}%, but the result is waiting to save before the path advances.`
                    : `Mini re-check passed: ${miniCheckOutcome.score}%. Your path has advanced.`
                  : `Mini re-check score: ${miniCheckOutcome.score}%. You need ${MINICHECK_PASS}% to validate this step, so it remains available to retake.`}
              </div>
            )}
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
          </>
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
          completionKind={moduleCompletionKind}
          completed={completions.some((c) => c.domainId === moduleDomain && c.kind === moduleCompletionKind)}
          onComplete={completeLearningStep}
        />
      )}

      {view === 'interview' && practiceMode === null && (
        <PracticeChooser onPick={setPracticeMode} />
      )}
      {view === 'interview' && practiceMode === 'voice' && (
        <VoiceCall
          navigatorId={navigatorId}
          name={name}
          department={dept}
          preferredDomain={practiceDomain}
          onExit={() => setPracticeMode(null)}
        />
      )}
      {view === 'interview' && practiceMode === 'chat' && (
        <>
          <button className="linkbtn" onClick={() => setPracticeMode(null)} style={{ marginBottom: '1rem' }}>← Call type</button>
          <Interview navigatorId={navigatorId} name={name} department={dept} preferredDomain={practiceDomain} />
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
          onSubmit={async (_n, answers, miniQuestions) => {
            const scores = scorePerDomain(answers, miniQuestions);
            const domainScore = scores[miniCheckDomain] ?? 0;
            const passed = domainScore >= MINICHECK_PASS;
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
              const localCompletion = {
                navigatorId,
                name,
                department: dept,
                domainId: miniCheckDomain,
                kind: 'minicheck',
                passed: true,
                score: domainScore,
                completedAt: clientTimestamp(),
              };
              const markComplete = () => {
                setCompletions((prev) => [...prev, localCompletion]);
                setMiniCheckOutcome({ domainId: miniCheckDomain, score: domainScore, passed: true, pending: false });
              };
              const saved = await persistResult([
                navigatorId,
                name,
                allScores,
                competencyScores,
                dept,
                savedAnswers,
                targetType,
                { domainId: miniCheckDomain, kind: 'minicheck', passed: true, score: domainScore },
              ], markComplete);
              if (!saved) {
                setMiniCheckOutcome({ domainId: miniCheckDomain, score: domainScore, passed: true, pending: true });
              }
            } else {
              setMiniCheckOutcome({ domainId: miniCheckDomain, score: domainScore, passed: false, pending: false });
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

// Dashboard control bar — shows which assessment the profile is from, lets the
// navigator switch between saved assessment results, and launches another one.
const TYPE_LABEL = { mcq: 'Multiple choice', spot: 'Spot the Error', qa: 'Call QA Test' };

function formatQaDate(ts) {
  const millis = timestampMillis(ts);
  if (!millis) return 'Date pending';
  return new Date(millis).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function AssessmentBar({ activeType, resultsByType, onSwitch, onTakeAnother, phasesDone = 0 }) {
  const takenTypes = ['mcq', 'spot'].filter((t) => resultsByType[t]);
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
        {phasesDone >= 3 ? 'Retake a phase' : `Continue assessment (Phase ${phasesDone + 1} of 3)`}
      </button>
    </div>
  );
}

function QaLatestCard({ attempt, onRetake }) {
  const qa = attempt?.qa ?? {};
  // Shared helpers: a pending attempt is always an AI recommendation pending
  // supervisor review (or NEEDS SUPERVISOR REVIEW), never a bare PASS/FAIL; a
  // reviewed attempt shows the supervisor's final/overridden verdict.
  const tone = qaBadgeTone(attempt);
  const label = qaSummaryLabel(attempt);
  return (
    <div className={`card qa-latest qa-latest--${tone}`}>
      <div>
        <p className="qa-latest__eyebrow">Latest Call QA Test</p>
        <h2 className="qa-latest__title">{label}</h2>
        <p className="qa-latest__meta">{qa.score}/100 - {formatQaDate(attempt?.endedAt)}</p>
      </div>
      <button className="btn btn--ghost btn--sm" onClick={onRetake} type="button">
        Retake
      </button>
    </div>
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
