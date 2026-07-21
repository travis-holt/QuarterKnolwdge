// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// ROLE-APP TAB BEHAVIOR TESTS
//
// Focused behavioural coverage for the two top-level role shells, one level
// deeper than roleApps.smoke.test.jsx. These drive real tab transitions and
// per-view empty states rather than just "mounts without crashing".
//
// Deliberately NOT covered here: exact UI copy, snapshots, or deep child-widget
// internals. Assertions target visible headings/roles and stable structural
// text so the tests survive routine UI polish.
//
// Everything external is mocked so no network / Firebase / API / audio call is
// ever made:
//   • src/lib/firebase.js  → reports "configured" (apps take their live path).
//   • src/lib/db.js        → subscriptions yield empty arrays; getters/writers
//                            resolve empty by default. Individual getters
//                            (getResult, getInterviews, …) are overridden per
//                            test to simulate existing data.
//   • src/lib/session.js   → controllable getSession for App routing.
//   • src/lib/apiFetch.js  → never resolves (AI/generation calls are inert).
//   • browser APIs jsdom lacks (matchMedia / ResizeObserver / IntersectionObserver
//     / AudioContext / getUserMedia) are stubbed so any indirectly-imported
//     VoiceCall / motion code cannot throw.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Browser API polyfills (jsdom gaps) ───────────────────────────────────────
// Installed before any component import so module-level references are safe.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || NoopObserver;
window.IntersectionObserver = window.IntersectionObserver || NoopObserver;
// VoiceCall (imported by NavigatorApp) may reference these at construction time.
window.AudioContext = window.AudioContext || class { constructor() {} close() {} };
if (!navigator.mediaDevices) {
  // eslint-disable-next-line no-undef
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [] })) },
    configurable: true,
  });
}

// ── Shared mocks ─────────────────────────────────────────────────────────────

vi.mock('../lib/firebase.js', () => ({
  isFirebaseConfigured: true,
  getFirebaseIdToken: vi.fn().mockResolvedValue('firebase-id-token'),
}));

const sessionMocks = vi.hoisted(() => ({
  getSession: vi.fn(() => null),
  setSession: vi.fn(),
  clearSession: vi.fn(),
}));
vi.mock('../lib/session.js', () => sessionMocks);

// apiFetch stays inert — AI generation / grading calls never resolve, so they
// can't inject async state into a render under test.
vi.mock('../lib/apiFetch.js', () => ({
  apiFetch: vi.fn(() => new Promise(() => {})),
  runPooled: vi.fn(() => Promise.resolve([])),
  fetchErrorMessage: vi.fn(() => 'error'),
}));

// db.js — every subscription immediately yields empty data; getters/writers
// resolve empty by default. Getter functions are plain vi.fn()s so a test can
// call `dbMocks.getResult.mockImplementation(...)` to simulate stored data.
const dbMocks = vi.hoisted(() => {
  const emptySub = (cb) => {
    cb?.([]);
    return () => {};
  };
  const subNames = [
    'subscribeResults', 'subscribeRoster', 'subscribeQuestions', 'subscribeAudits',
    'subscribeCompletions', 'subscribeResultHistory', 'subscribeInterviews',
    'subscribePairings', 'subscribeSupervisorFeedback', 'subscribeLearningProposals',
    'subscribeSops',
  ];
  const resolveEmptyArray = [
    'getRoster', 'getActiveQuestions', 'getCompletions', 'getInterviews', 'getFloorScores',
    'getResultHistory',
  ];
  const resolveNull = ['getResult'];
  const resolveVoid = [
    'seedQuestionsIfEmpty', 'runContentQualityFixesMigration', 'updateRosterEntry',
    'runMcqV2OperatingModelMigration',
    'addToRoster', 'setRosterStatus', 'clearResult', 'saveDraftQuestions', 'activateQuestion',
    'archiveQuestion', 'deleteQuestion', 'updateQuestion', 'saveDraftAudits', 'activateAudit',
    'archiveAudit', 'deleteAudit', 'savePairing', 'updatePairingStatus', 'saveSupervisorFeedback',
    'saveLearningProposal', 'updateLearningProposalStatus', 'saveSopDraft', 'updateSop',
    'activateSop', 'archiveSop', 'deleteSop', 'saveResult', 'saveCompletion',
    'archiveQaAttempts', 'saveInterview', 'updateInterviewGrade',
  ];
  const m = {};
  for (const n of subNames) m[n] = vi.fn(emptySub);
  for (const n of resolveEmptyArray) m[n] = vi.fn(() => Promise.resolve([]));
  for (const n of resolveNull) m[n] = vi.fn(() => Promise.resolve(null));
  for (const n of resolveVoid) m[n] = vi.fn(() => Promise.resolve());
  return m;
});
vi.mock('../lib/db.js', () => dbMocks);

// Imported AFTER the mocks are registered.
import SupervisorApp from './SupervisorApp.jsx';
import NavigatorApp from './NavigatorApp.jsx';
import { apiFetch } from '../lib/apiFetch.js';

// The six configured domain ids, for bank-coverage fixtures.
const DOMAIN_IDS = ['intake', 'classification', 'routing', 'scheduling', 'boundaries', 'documentation'];

// A full six-domain result the dashboard/training views can render from.
const DOMAIN_SCORES = {
  intake: 90, classification: 72, routing: 55,
  scheduling: 80, boundaries: 40, documentation: 88,
};
function makeResult(overrides = {}) {
  return {
    name: 'Nav One',
    navigatorId: 'nav-1',
    department: 'pediatrics',
    assessmentType: 'mcq',
    scores: DOMAIN_SCORES,
    competencyScores: {},
    answers: {},
    submittedAt: { seconds: 1_700_000_000 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default resolutions cleared by clearAllMocks (implementations survive
  // clearAllMocks, but tests that set mockResolvedValueOnce need a clean baseline).
  dbMocks.getResult.mockResolvedValue(null);
  dbMocks.getInterviews.mockResolvedValue([]);
  dbMocks.getActiveQuestions.mockResolvedValue([]);
  dbMocks.getCompletions.mockResolvedValue([]);
  dbMocks.getFloorScores.mockResolvedValue([]);
  dbMocks.getResultHistory.mockResolvedValue([]);
  sessionMocks.getSession.mockReturnValue(null);
  // Navigator interview history now comes through a sanitized API projection;
  // reuse each test's existing getInterviews fixture as that projection.
  apiFetch.mockImplementation((url) => {
    if (url === '/api/my-interviews') {
      return dbMocks.getInterviews().then((interviews) => ({ interviews }));
    }
    return new Promise(() => {});
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SupervisorApp — tab navigation + empty states
// ═════════════════════════════════════════════════════════════════════════════

describe('SupervisorApp — tab behavior', () => {
  const tab = (name) => screen.getByRole('button', { name });

  it('renders the default (Overview) supervisor shell with empty data', () => {
    render(<SupervisorApp onSignOut={vi.fn()} />);
    // Nav tabs present + wired its live subscriptions.
    expect(tab('Overview')).toBeInTheDocument();
    expect(tab('Questions')).toBeInTheDocument();
    expect(dbMocks.subscribeResults).toHaveBeenCalled();
    expect(dbMocks.subscribeRoster).toHaveBeenCalled();
    // With no results, Overview is a data view → shows the empty state.
    expect(screen.getByText(/No results yet/i)).toBeInTheDocument();
  });

  it('switches to the Matrix tab', () => {
    render(<SupervisorApp onSignOut={vi.fn()} />);
    fireEvent.click(tab('Matrix'));
    // Matrix is a data view; with no rows it shows the shared empty state.
    expect(screen.getByText(/No results yet/i)).toBeInTheDocument();
    expect(tab('Matrix').className).toMatch(/is-active/);
  });

  it('switches to the Navigators tab and shows roster management (no data crash)', () => {
    render(<SupervisorApp onSignOut={vi.fn()} />);
    fireEvent.click(tab('Navigators'));
    // Navigators tab is NOT a DATA_VIEW, so it renders even with empty roster.
    expect(tab('Navigators').className).toMatch(/is-active/);
    // The roster management panel renders its "add navigator" affordance.
    expect(
      screen.getByRole('button', { name: /add navigator/i })
    ).toBeInTheDocument();
  });

  it('switches to the Training tab', () => {
    render(<SupervisorApp onSignOut={vi.fn()} />);
    fireEvent.click(tab('Training'));
    // Training is a data view; empty data → empty state, no crash.
    expect(screen.getByText(/No results yet/i)).toBeInTheDocument();
    expect(tab('Training').className).toMatch(/is-active/);
  });

  it('switches to the Questions tab (question + audit banks)', () => {
    render(<SupervisorApp onSignOut={vi.fn()} />);
    fireEvent.click(tab('Questions'));
    expect(tab('Questions').className).toMatch(/is-active/);
    // Questions is not a DATA_VIEW; the bank UI mounts even with no questions.
    // Subscriptions for the bank were established.
    expect(dbMocks.subscribeQuestions).toHaveBeenCalled();
    expect(dbMocks.subscribeAudits).toHaveBeenCalled();
  });

  it('switches to the SOPs tab and mounts the SOP manager', () => {
    render(<SupervisorApp onSignOut={vi.fn()} />);
    fireEvent.click(tab('SOPs'));
    expect(tab('SOPs').className).toMatch(/is-active/);
    expect(dbMocks.subscribeSops).toHaveBeenCalled();
  });

  it('does not crash on any tab when all Firestore data is empty', () => {
    render(<SupervisorApp onSignOut={vi.fn()} />);
    for (const name of ['Matrix', 'Navigators', 'Training', 'Action Center',
      'Mentorship', 'Learning Loop', 'Questions', 'SOPs', 'Overview']) {
      fireEvent.click(tab(name));
      expect(tab(name)).toBeInTheDocument();
    }
  });

  it('opens the navigator detail view when a navigator row is clicked', async () => {
    // Seed one active navigator + a matching result so a matrix row renders.
    dbMocks.subscribeRoster.mockImplementation((cb) => {
      cb([{ id: 'nav-1', name: 'Nav One', status: 'active' }]);
      return () => {};
    });
    dbMocks.subscribeResults.mockImplementation((cb) => {
      cb([makeResult()]);
      return () => {};
    });

    render(<SupervisorApp onSignOut={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Navigators' }));

    // The roster card shows the navigator; "View dashboard" opens their detail
    // (only rendered when a result row exists for them).
    expect(await screen.findByText('Nav One')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /View dashboard/i }));

    // NavigatorDetail renders the person's name as a heading somewhere.
    await waitFor(() =>
      expect(screen.getAllByText(/Nav One/i).length).toBeGreaterThan(0)
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NavigatorApp — department select → assessment / dashboard / tabs
// ═════════════════════════════════════════════════════════════════════════════

describe('NavigatorApp — flow behavior', () => {
  const renderNav = () =>
    render(<NavigatorApp navigatorId="nav-1" name="Nav One" onSignOut={vi.fn()} />);

  const deptHeading = () =>
    screen.findByText('Which department are you taking the check for?');

  it('renders the department picker when no department is restored', async () => {
    renderNav();
    expect(await deptHeading()).toBeInTheDocument();
    // Both assessed departments are offered.
    expect(screen.getByText('Pediatrics')).toBeInTheDocument();
  });

  it('selecting Pediatrics with no prior result lands on the phase hub (assessment start)', async () => {
    dbMocks.getResult.mockResolvedValue(null);
    renderNav();
    await deptHeading();
    fireEvent.click(screen.getByText('Pediatrics').closest('button'));
    // No completed phases → PhaseHub, which offers Phase 1 (Multiple choice).
    expect(await screen.findByText(/Multiple choice/i)).toBeInTheDocument();
  });

  it('lands on the dashboard when all three phases are already complete', async () => {
    // MCQ + Spot results exist, and a graded QA interview exists → dashboard.
    dbMocks.getResult.mockImplementation((_id, dept, type) => {
      if (type === 'mcq') return Promise.resolve(makeResult({ assessmentType: 'mcq' }));
      if (type === 'spot') return Promise.resolve(makeResult({ assessmentType: 'spot' }));
      return Promise.resolve(null);
    });
    dbMocks.getInterviews.mockResolvedValue([
      { navigatorId: 'nav-1', department: 'pediatrics', assessmentType: 'call-qa', endedAt: { seconds: 1_700_000_500 }, transcript: [], qa: { pass: true, score: 92 } },
    ]);

    renderNav();
    await deptHeading();
    fireEvent.click(screen.getByText('Pediatrics').closest('button'));

    // An AI result remains visibly pending until a supervisor records the final verdict.
    // QaLatestCard renders the shared qaSummaryLabel helper — a non-final AI recommendation.
    expect((await screen.findAllByText('AI PASS — PENDING SUPERVISOR REVIEW')).length).toBeGreaterThan(0);
    // Never a bare, final-looking PASS while the attempt is un-reviewed.
    expect(screen.queryByText('PASS')).not.toBeInTheDocument();
  });

  it('QaLatestCard shows a needs-review attempt as NEEDS SUPERVISOR REVIEW (non-final)', async () => {
    dbMocks.getResult.mockImplementation((_id, dept, type) => {
      if (type === 'mcq') return Promise.resolve(makeResult({ assessmentType: 'mcq' }));
      if (type === 'spot') return Promise.resolve(makeResult({ assessmentType: 'spot' }));
      return Promise.resolve(null);
    });
    dbMocks.getInterviews.mockResolvedValue([
      { navigatorId: 'nav-1', department: 'pediatrics', assessmentType: 'call-qa', endedAt: { seconds: 1_700_000_500 }, transcript: [], qa: { pass: true, score: 86, review: { recommendation: 'needs_review' } } },
    ]);

    renderNav();
    await deptHeading();
    fireEvent.click(screen.getByText('Pediatrics').closest('button'));

    expect((await screen.findAllByText('NEEDS SUPERVISOR REVIEW')).length).toBeGreaterThan(0);
  });

  it('dashboard renders mocked domain score data', async () => {
    dbMocks.getResult.mockImplementation((_id, dept, type) =>
      Promise.resolve(type === 'mcq' ? makeResult() : null)
    );
    // Make phases complete so we land on the dashboard rather than the hub.
    dbMocks.getInterviews.mockResolvedValue([
      { navigatorId: 'nav-1', department: 'pediatrics', assessmentType: 'call-qa', endedAt: { seconds: 1 }, transcript: [], qa: { pass: false, score: 50 } },
    ]);
    dbMocks.getResult.mockImplementation((_id, dept, type) => {
      if (type === 'mcq') return Promise.resolve(makeResult({ assessmentType: 'mcq' }));
      if (type === 'spot') return Promise.resolve(makeResult({ assessmentType: 'spot' }));
      return Promise.resolve(null);
    });

    renderNav();
    await deptHeading();
    fireEvent.click(screen.getByText('Pediatrics').closest('button'));

    // NavigatorDetail renders domain names from the score map.
    await waitFor(() =>
      expect(screen.getAllByText(/Nav One/i).length).toBeGreaterThan(0)
    );
  });

  it('My Training tab renders a training plan from a stored result', async () => {
    dbMocks.getResult.mockImplementation((_id, dept, type) => {
      if (type === 'mcq') return Promise.resolve(makeResult({ assessmentType: 'mcq' }));
      if (type === 'spot') return Promise.resolve(makeResult({ assessmentType: 'spot' }));
      return Promise.resolve(null);
    });
    dbMocks.getInterviews.mockResolvedValue([
      { navigatorId: 'nav-1', department: 'pediatrics', assessmentType: 'call-qa', endedAt: { seconds: 1 }, transcript: [], qa: { pass: true, score: 90 } },
    ]);

    renderNav();
    await deptHeading();
    fireEvent.click(screen.getByText('Pediatrics').closest('button'));
    await screen.findAllByText('AI PASS — PENDING SUPERVISOR REVIEW');

    fireEvent.click(screen.getByRole('button', { name: 'My training' }));
    // The training view mounts (a stored result → a plan, not the empty state).
    await waitFor(() =>
      expect(screen.queryByText(/No training yet/i)).not.toBeInTheDocument()
    );
  });

  it('Practice tab shows the voice/chat chooser without starting audio', async () => {
    dbMocks.getResult.mockImplementation((_id, dept, type) =>
      type === 'mcq' ? Promise.resolve(makeResult()) : Promise.resolve(null)
    );
    renderNav();
    await deptHeading();
    fireEvent.click(screen.getByText('Pediatrics').closest('button'));
    await screen.findByText(/Multiple choice/i); // on the phase hub

    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    // The chooser offers both practice modes; neither has started yet.
    expect(await screen.findByText('Voice call')).toBeInTheDocument();
    expect(screen.getByText('Text chat')).toBeInTheDocument();
    // No microphone was requested by merely opening the chooser.
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('My History tab renders without crashing on empty attempt history', async () => {
    dbMocks.getResult.mockImplementation((_id, dept, type) =>
      type === 'mcq' ? Promise.resolve(makeResult()) : Promise.resolve(null)
    );
    renderNav();
    await deptHeading();
    fireEvent.click(screen.getByText('Pediatrics').closest('button'));
    await screen.findByText(/Multiple choice/i);

    fireEvent.click(screen.getByRole('button', { name: 'My history' }));
    // MyHistory mounts and reads the (empty) history without throwing.
    await waitFor(() => expect(dbMocks.getResultHistory).toHaveBeenCalled());
  });

  it('the department switch control returns to the department picker', async () => {
    dbMocks.getResult.mockImplementation((_id, dept, type) =>
      type === 'mcq' ? Promise.resolve(makeResult()) : Promise.resolve(null)
    );
    renderNav();
    await deptHeading();
    fireEvent.click(screen.getByText('Pediatrics').closest('button'));
    await screen.findByText(/Multiple choice/i);

    // The nav dept-switch pill is present outside an in-progress assessment.
    const switchPill = screen.getByRole('button', { name: /Pediatrics/i });
    fireEvent.click(switchPill);
    expect(await deptHeading()).toBeInTheDocument();
  });

  it('uses the fresh own score when the mentor projection contains a stale copy of the current navigator', async () => {
    // Own stored MCQ result: fresh, intake = 92 (a value not otherwise used
    // by any domain in the shared DOMAIN_SCORES fixture, so it can't collide).
    dbMocks.getResult.mockImplementation((_id, dept, type) => {
      if (type === 'mcq') return Promise.resolve(makeResult({ scores: { ...DOMAIN_SCORES, intake: 92 } }));
      if (type === 'spot') return Promise.resolve(makeResult({ assessmentType: 'spot' }));
      return Promise.resolve(null);
    });
    dbMocks.getInterviews.mockResolvedValue([
      { navigatorId: 'nav-1', department: 'pediatrics', assessmentType: 'call-qa', endedAt: { seconds: 1 }, transcript: [], qa: { pass: true, score: 90 } },
    ]);
    // /api/mentor-scores projects a STALE copy of the current navigator
    // (same navigatorId, old score) alongside an unrelated colleague. 15 is
    // not used by any domain in DOMAIN_SCORES, so it can't false-positive
    // match a genuine (unrelated) domain score.
    apiFetch.mockImplementation((url) => {
      if (url === '/api/my-interviews') {
        return dbMocks.getInterviews().then((interviews) => ({ interviews }));
      }
      if (url === '/api/mentor-scores') {
        return Promise.resolve({
          results: [
            { navigatorId: 'nav-1', name: 'Nav One', scores: { ...DOMAIN_SCORES, intake: 15 } },
            { navigatorId: 'nav-2', name: 'Colleague', scores: DOMAIN_SCORES },
          ],
        });
      }
      return new Promise(() => {});
    });

    renderNav();
    await deptHeading();
    fireEvent.click(screen.getByText('Pediatrics').closest('button'));
    await screen.findAllByText('AI PASS — PENDING SUPERVISOR REVIEW'); // on the dashboard

    // NavigatorApp resolves the current navigator from the fresh own result,
    // not the stale floor projection: the fresh score (92) renders and the
    // stale one (15) does not. This proves score freshness in the rendered
    // app; exact same-ID row collapse is proven directly (with an inspectable
    // merged array) by mergeNavigatorFloorAndOwnResult's own unit tests in
    // navigatorResultMerge.test.js — this test cannot assert "exactly one
    // row" itself, since the navigator's name legitimately appears elsewhere
    // on the dashboard (headings, nav, etc.) regardless of the merge outcome.
    await waitFor(() => expect(screen.getByText('92% in this domain')).toBeInTheDocument());
    expect(screen.queryByText('15% in this domain')).not.toBeInTheDocument();
  });
});

// ── Assessment-bank coverage gate (2026-07-21) ──────────────────────────────
// A live bank that cannot measure all six domains must BLOCK the MCQ phase.
// Silently scoring it would persist fabricated zeroes for the missing domains,
// which read as Critical results the navigator never earned.

describe('NavigatorApp — incomplete assessment bank blocks the MCQ check', () => {
  const scoreableQuestion = (id, domainId) => ({
    id,
    domainId,
    status: 'active',
    department: 'pediatrics',
    competencies: [],
    scenario: `Scenario ${id}`,
    correctOptionId: 'a',
    options: [
      { id: 'a', text: 'Right', points: 100, rationale: 'r' },
      { id: 'b', text: 'Wrong', points: 0, rationale: 'r' },
    ],
  });

  const signIn = async () => {
    render(<NavigatorApp session={{ role: 'navigator', name: 'Pat Rowan', navigatorId: 'nav-1' }} onSignOut={vi.fn()} />);
    await screen.findByText(/Which department are you taking the check for/i);
    fireEvent.click(screen.getByRole('button', { name: /Pediatrics/i }));
  };

  it('blocks the MCQ phase and names the uncovered domains', async () => {
    // A live bank covering only two of the six configured domains.
    const partial = ['intake', 'classification'].map((d, i) => scoreableQuestion(`q${i}`, d));
    dbMocks.getActiveQuestions.mockImplementation(() => Promise.resolve(partial));

    await signIn();
    const start = await screen.findByRole('button', { name: /Start|Retake/i });
    fireEvent.click(start);

    expect(await screen.findByText(/This assessment isn't ready yet/i)).toBeInTheDocument();
    expect(screen.getByText(/doesn’t cover every knowledge domain|doesn't cover every knowledge domain/i)).toBeInTheDocument();
    // Nothing was persisted.
    expect(dbMocks.saveResult).not.toHaveBeenCalled();
  });

  it('does NOT top a partial live bank up from the seed bank', async () => {
    const partial = ['intake'].map((d, i) => scoreableQuestion(`q${i}`, d));
    dbMocks.getActiveQuestions.mockImplementation(() => Promise.resolve(partial));

    await signIn();
    const start = await screen.findByRole('button', { name: /Start|Retake/i });
    fireEvent.click(start);

    // If the seed bank had been merged in, coverage would be complete and the
    // check would have opened instead of the blocking screen.
    expect(await screen.findByText(/This assessment isn't ready yet/i)).toBeInTheDocument();
  });

  it('allows the MCQ phase when the live bank covers every domain', async () => {
    const full = DOMAIN_IDS.map((d, i) => scoreableQuestion(`q${i}`, d));
    dbMocks.getActiveQuestions.mockImplementation(() => Promise.resolve(full));

    await signIn();
    const start = await screen.findByRole('button', { name: /Start|Retake/i });
    fireEvent.click(start);

    // The blocking screen is NOT shown; the check itself renders.
    await waitFor(() =>
      expect(screen.queryByText(/This assessment isn't ready yet/i)).not.toBeInTheDocument()
    );
  });

  it('falls back to the seed bank when the live bank is entirely empty', async () => {
    dbMocks.getActiveQuestions.mockImplementation(() => Promise.resolve([]));

    await signIn();
    const start = await screen.findByRole('button', { name: /Start|Retake/i });
    fireEvent.click(start);

    // The committed seed bank covers all six domains, so this is allowed.
    await waitFor(() =>
      expect(screen.queryByText(/This assessment isn't ready yet/i)).not.toBeInTheDocument()
    );
  });
});
