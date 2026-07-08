// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// ROLE-APP SMOKE TESTS
//
// Lightweight "renders without crashing" + basic gate/routing coverage for the
// four top-level shells: App, Start, SupervisorApp, NavigatorApp. These are NOT
// deep behavioural tests — they intentionally stub Firestore/Firebase so the
// shells mount against empty, deterministic data and never touch the network.
//
// What is mocked:
//   • src/lib/firebase.js  → reports "configured" so the apps run their live path.
//   • src/lib/db.js        → every subscription is a no-op that immediately yields
//                            empty data; every getter/mutator resolves empty.
//   • src/lib/session.js   → lets App tests restore a chosen session on mount.
// jsdom lacks IntersectionObserver, which useInView tolerates by rendering as
// "immediately visible", so no polyfill is needed here.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { SUPERVISOR_PASSCODE } from '../data/config.js';

// ── Shared mocks ─────────────────────────────────────────────────────────────

// Firebase reports as configured so the apps take their normal (non-error) path.
vi.mock('../lib/firebase.js', () => ({ isFirebaseConfigured: true }));

// Session is mocked so App tests can control what getSession() returns on mount.
const sessionMocks = vi.hoisted(() => ({
  getSession: vi.fn(() => null),
  setSession: vi.fn(),
  clearSession: vi.fn(),
}));
vi.mock('../lib/session.js', () => sessionMocks);

// db.js — a no-op Firestore. Subscriptions immediately hand back empty data and
// return an unsubscribe noop; getters/mutators resolve to empty/void. This keeps
// the shells mounting deterministically with zero network calls.
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
  ];
  const resolveNull = ['getResult'];
  const resolveVoid = [
    'seedQuestionsIfEmpty', 'runContentQualityFixesMigration', 'updateRosterEntry',
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
import App from '../App.jsx';
import Start from './Start.jsx';
import SupervisorApp from './SupervisorApp.jsx';
import NavigatorApp from './NavigatorApp.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  sessionMocks.getSession.mockReturnValue(null);
});

// ── Start gate ───────────────────────────────────────────────────────────────

describe('Start (gate)', () => {
  it('renders the role selection screen', () => {
    render(<Start onNavigatorEntry={vi.fn()} onSupervisorEntry={vi.fn()} />);
    expect(screen.getByRole('button', { name: /I.m a navigator/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I.m a supervisor/i })).toBeInTheDocument();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the login endpoint on a correct passcode and enters supervisor mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const onSupervisorEntry = vi.fn();
    render(<Start onNavigatorEntry={vi.fn()} onSupervisorEntry={onSupervisorEntry} />);

    fireEvent.click(screen.getByRole('button', { name: /I.m a supervisor/i }));
    fireEvent.change(screen.getByLabelText('Passcode'), { target: { value: SUPERVISOR_PASSCODE } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onSupervisorEntry).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/supervisor-login', expect.objectContaining({ method: 'POST' }));
  });

  it('shows an error and does not enter when the login endpoint rejects the passcode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Incorrect passcode.' }) }));
    const onSupervisorEntry = vi.fn();
    render(<Start onNavigatorEntry={vi.fn()} onSupervisorEntry={onSupervisorEntry} />);

    fireEvent.click(screen.getByRole('button', { name: /I.m a supervisor/i }));
    fireEvent.change(screen.getByLabelText('Passcode'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Incorrect passcode.')).toBeInTheDocument();
    expect(onSupervisorEntry).not.toHaveBeenCalled();
  });

  it('falls back to the bundled passcode when /api is unreachable (dev mode)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    const onSupervisorEntry = vi.fn();
    render(<Start onNavigatorEntry={vi.fn()} onSupervisorEntry={onSupervisorEntry} />);

    fireEvent.click(screen.getByRole('button', { name: /I.m a supervisor/i }));
    fireEvent.change(screen.getByLabelText('Passcode'), { target: { value: SUPERVISOR_PASSCODE } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onSupervisorEntry).toHaveBeenCalledTimes(1));
  });
});

// ── SupervisorApp shell ──────────────────────────────────────────────────────

describe('SupervisorApp (shell)', () => {
  it('renders the supervisor shell with empty mocked data without crashing', () => {
    render(<SupervisorApp onSignOut={vi.fn()} />);
    // Nav tabs are always present in the shell regardless of data.
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Questions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    // It wired up its live subscriptions rather than hitting the network directly.
    expect(dbMocks.subscribeResults).toHaveBeenCalled();
    expect(dbMocks.subscribeRoster).toHaveBeenCalled();
    expect(dbMocks.subscribeQuestions).toHaveBeenCalled();
  });
});

// ── NavigatorApp shell ───────────────────────────────────────────────────────

describe('NavigatorApp (shell)', () => {
  it('renders the department-select entry with mocked data without crashing', async () => {
    render(<NavigatorApp navigatorId="nav-1" name="Nav One" onSignOut={vi.fn()} />);
    // Mount effect routes straight to the deptselect view.
    expect(
      await screen.findByText('Which department are you taking the check for?')
    ).toBeInTheDocument();
  });
});

// ── App session restore + routing ────────────────────────────────────────────

describe('App (session routing)', () => {
  it('shows the Start gate when there is no session', () => {
    sessionMocks.getSession.mockReturnValue(null);
    render(<App />);
    expect(screen.getByRole('button', { name: /I.m a navigator/i })).toBeInTheDocument();
  });

  it('restores a supervisor session and renders the supervisor shell', async () => {
    sessionMocks.getSession.mockReturnValue({ role: 'supervisor', name: 'Supervisor', navigatorId: null });
    render(<App />);
    // SupervisorApp is lazy-loaded behind Suspense — wait for its shell to appear.
    expect(await screen.findByRole('button', { name: 'Overview' })).toBeInTheDocument();
  });

  it('restores a navigator session and renders the navigator shell', async () => {
    sessionMocks.getSession.mockReturnValue({ role: 'navigator', name: 'Nav One', navigatorId: 'nav-1' });
    render(<App />);
    expect(
      await screen.findByText('Which department are you taking the check for?')
    ).toBeInTheDocument();
  });
});
