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
import { getResult, saveResult, subscribeResults, getActiveQuestions, getCompletions } from '../lib/db.js';
import { isFirebaseConfigured } from '../lib/firebase.js';
import { SEED_QUESTIONS } from '../data/questions.js';
import { ASSESSED_DEPT, departmentName } from '../data/departments.js';

// The navigator's self-contained app. They can ONLY ever see their own data:
// there is no route to the matrix, overview, or other navigators' dashboards.
// (They do receive the floor's results — read-only — so mentor suggestions can
// name colleagues who can teach their growth domains, but those names are not
// clickable and open nothing.)
export default function NavigatorApp({ navigatorId, name, onSignOut }) {
  const [view, setView] = useState('loading'); // loading · check · coaching · dashboard · training · module · audit
  const [ownResult, setOwnResult] = useState(null); // { name, navigatorId, scores, competencyScores }
  const [lastAnswers, setLastAnswers] = useState(null); // answers from the just-taken check (for coaching)
  const [questions, setQuestions] = useState(SEED_QUESTIONS); // active bank (seed fallback)
  const [results, setResults] = useState([]); // whole floor (for mentor data)
  const [moduleDomain, setModuleDomain] = useState(null);
  const [auditDomain, setAuditDomain] = useState(null);
  const [completedDomains, setCompletedDomains] = useState(new Set());
  const [loadError, setLoadError] = useState(false);

  // Decide the entry view: returning navigator → dashboard, new → check.
  useEffect(() => {
    let active = true;
    if (!isFirebaseConfigured) {
      setLoadError(true);
      setView('error');
      return undefined;
    }
    getResult(navigatorId)
      .then((res) => {
        if (!active) return;
        if (res) {
          setOwnResult(res);
          setView('dashboard');
        } else {
          setView('check');
        }
      })
      .catch(() => {
        if (active) {
          setLoadError(true);
          setView('error');
        }
      });
    return () => {
      active = false;
    };
  }, [navigatorId]);

  // Live floor results — used only to compute mentor suggestions.
  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    const unsub = subscribeResults(setResults, (err) => {
      console.error('subscribeResults (navigator):', err);
      // Non-critical — mentor suggestions just won't update live.
    });
    return () => unsub();
  }, []);

  // Load the active question bank; fall back to the static seed if the bank is
  // empty (not yet seeded) or unreachable, so the check always works.
  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    let active = true;
    getActiveQuestions()
      .then((qs) => {
        if (active && qs.length > 0) setQuestions(qs);
      })
      .catch(() => {
        /* keep the seed fallback */
      });
    return () => {
      active = false;
    };
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
    const scores = scorePerDomain(answers, questions);
    const competencyScores = scorePerCompetency(answers, questions);
    setOwnResult({ name, navigatorId, scores, competencyScores });
    setLastAnswers(answers);
    // Land on the coaching review first; the navigator continues to their
    // dashboard from there.
    setView('coaching');
    try {
      await saveResult(navigatorId, name, scores, competencyScores);
    } catch {
      // The dashboard already shows their result from local state; a failed
      // write just means it won't sync to the supervisor. Surfacing a toast is
      // a future nicety — for the pilot, local state keeps the UX intact.
    }
  };

  const openModule = (domainId) => {
    setModuleDomain(domainId);
    setView('module');
  };

  const startAudit = (domainId) => {
    setAuditDomain(domainId);
    setView('audit');
  };

  // When a "Spot the Error" scenario completes, add the domain to the local Set
  // so the badge appears immediately without waiting for a Firestore round-trip.
  const handleAuditComplete = (domainId) => {
    setCompletedDomains((prev) => new Set([...prev, domainId]));
  };

  // Merge own result into the floor results (dedup by navigatorId) so the
  // navigator's own row is present immediately after submit, before the
  // onSnapshot listener catches up.
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

  const deptName = departmentName(ASSESSED_DEPT);
  const deptMatrix = ownResult
    ? departmentMatrix([{ name, departments: { [ASSESSED_DEPT]: ownResult.scores } }], null)
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

  return (
    <Shell role="navigator" view={view} setView={setView} onSignOut={onSignOut}>
      {view === 'check' && (
        <Check
          onSubmit={handleSubmit}
          onCancel={onSignOut}
          questions={questions}
          hideName
          greetingName={name}
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
            deptMatrix={deptMatrix}
            onBack={null}
            onOpenNavigator={null}
            onPreviewModule={openModule}
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
            completedDomains={completedDomains}
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
        <Interview navigatorId={navigatorId} name={name} />
      )}

      {view === 'audit' && auditDomain && (
        <SpotTheError
          navigatorId={navigatorId}
          name={name}
          domainId={auditDomain}
          onBack={() => setView('training')}
          onComplete={handleAuditComplete}
        />
      )}
    </Shell>
  );
}

// Shared shell for the navigator: nav + main + footer.
function Shell({ role, view, setView, onSignOut, children }) {
  return (
    <div className="app">
      <Nav role={role} view={view} setView={setView} onSignOut={onSignOut} />
      <main className="main">{children}</main>
      <Footer />
    </div>
  );
}
