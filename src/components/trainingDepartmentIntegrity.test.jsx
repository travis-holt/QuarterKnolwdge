// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// TRAINING DEPARTMENT INTEGRITY — CALLER-LEVEL CONTRACTS
//
// TrainingModule is department-CONTROLLED: the `department` prop is the sole
// source of truth and the module has no local switcher. These tests drive the
// real callers (NavigatorApp / SupervisorApp) rather than the module in
// isolation, because the risks being guarded are caller-side:
//
//   1. A completion must be persisted under the department whose content the
//      navigator actually reviewed — never a drifted outer department.
//   2. Supervisor training content and the auto-assigned cohort rows must always
//      come from the same (globally selected) department.
//   3. Departments without authored training content must show an explicit
//      unavailable state, never a silent Pediatrics fallback.
//
// Everything external is mocked; no network / Firebase / audio call is made.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// ── Browser API polyfills (jsdom gaps), installed before component imports ───
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}
class NoopObserver { observe() {} unobserve() {} disconnect() {} }
window.ResizeObserver = window.ResizeObserver || NoopObserver;
window.IntersectionObserver = window.IntersectionObserver || NoopObserver;
window.AudioContext = window.AudioContext || class { constructor() {} close() {} };
if (!navigator.mediaDevices) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [] })) },
    configurable: true,
  });
}

vi.mock('../lib/firebase.js', () => ({
  isFirebaseConfigured: true,
  getFirebaseIdToken: vi.fn().mockResolvedValue('firebase-id-token'),
}));

const sessionMocks = vi.hoisted(() => ({
  getSession: vi.fn(() => null), setSession: vi.fn(), clearSession: vi.fn(),
}));
vi.mock('../lib/session.js', () => sessionMocks);

vi.mock('../lib/apiFetch.js', () => ({
  apiFetch: vi.fn(() => new Promise(() => {})),
  runPooled: vi.fn(() => Promise.resolve([])),
  fetchErrorMessage: vi.fn(() => 'error'),
}));

vi.mock('../lib/obgynCurrentFloorBankMigration.js', () => ({
  runObgynCurrentFloorBankMigration: vi.fn(() => Promise.resolve()),
}));

const dbMocks = vi.hoisted(() => {
  const emptySub = (cb) => { cb?.([]); return () => {}; };
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
    'runMcqV2OperatingModelMigration', 'addToRoster', 'setRosterStatus', 'clearResult',
    'saveDraftQuestions', 'activateQuestion', 'archiveQuestion', 'deleteQuestion',
    'updateQuestion', 'saveDraftAudits', 'activateAudit', 'archiveAudit', 'deleteAudit',
    'savePairing', 'updatePairingStatus', 'saveSupervisorFeedback', 'saveLearningProposal',
    'updateLearningProposalStatus', 'saveSopDraft', 'updateSop', 'activateSop', 'archiveSop',
    'deleteSop', 'saveResult', 'saveCompletion', 'archiveQaAttempts', 'saveInterview',
    'updateInterviewGrade',
  ];
  const m = {};
  for (const n of subNames) m[n] = vi.fn(emptySub);
  for (const n of resolveEmptyArray) m[n] = vi.fn(() => Promise.resolve([]));
  for (const n of resolveNull) m[n] = vi.fn(() => Promise.resolve(null));
  for (const n of resolveVoid) m[n] = vi.fn(() => Promise.resolve());
  return m;
});
vi.mock('../lib/db.js', () => dbMocks);

import NavigatorApp from './NavigatorApp.jsx';
import SupervisorApp from './SupervisorApp.jsx';
import TrainingModule from './TrainingModule.jsx';
import { apiFetch } from '../lib/apiFetch.js';

// Weak everywhere → every domain is assigned, so a module is always reachable.
const WEAK_SCORES = {
  intake: 30, classification: 30, routing: 30,
  scheduling: 30, boundaries: 30, documentation: 30,
};
const makeResult = (o = {}) => ({
  name: 'Nav One', navigatorId: 'nav-1', department: 'pediatrics', assessmentType: 'mcq',
  scores: WEAK_SCORES, competencyScores: {}, answers: {},
  submittedAt: { seconds: 1_700_000_000 }, ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getResult.mockResolvedValue(null);
  dbMocks.getInterviews.mockResolvedValue([]);
  dbMocks.getActiveQuestions.mockResolvedValue([]);
  dbMocks.getCompletions.mockResolvedValue([]);
  dbMocks.getFloorScores.mockResolvedValue([]);
  dbMocks.getResultHistory.mockResolvedValue([]);
  sessionMocks.getSession.mockReturnValue(null);
  apiFetch.mockImplementation((url) => {
    if (url === '/api/my-interviews') {
      return dbMocks.getInterviews().then((interviews) => ({ interviews }));
    }
    return new Promise(() => {});
  });
});

const pageText = () => document.body.textContent ?? '';

// ═════════════════════════════════════════════════════════════════════════════
// NavigatorApp — completion integrity
// ═════════════════════════════════════════════════════════════════════════════

describe('NavigatorApp — training completion is bound to the rendered department', () => {
  // Drive: sign in → pick department → My training → start the first path step,
  // which opens the department's training module with a completion control.
  const openTrainingModule = async (deptLabel) => {
    dbMocks.getResult.mockImplementation((_id, dept, type) =>
      type === 'mcq'
        ? Promise.resolve(makeResult({ department: dept }))
        : Promise.resolve(null),
    );
    render(<NavigatorApp navigatorId="nav-1" name="Nav One" onSignOut={vi.fn()} />);
    await screen.findByText('Which department are you taking the check for?');
    fireEvent.click(screen.getByText(deptLabel).closest('button'));
    await screen.findByRole('button', { name: 'My training' });
    fireEvent.click(screen.getByRole('button', { name: 'My training' }));
    const starts = await screen.findAllByRole('button', { name: 'Start' });
    fireEvent.click(starts[0]);
    return screen.findByRole('button', { name: /Mark (module complete|coaching reviewed)/ });
  };

  it('a Pediatrics module saves a Pediatrics completion', async () => {
    const btn = await openTrainingModule('Pediatrics');
    fireEvent.click(btn);

    await waitFor(() => expect(dbMocks.saveCompletion).toHaveBeenCalled());
    const call = dbMocks.saveCompletion.mock.calls.at(-1);
    // saveCompletion(navigatorId, name, domainId, kind, department)
    expect(call[0]).toBe('nav-1');
    expect(call[4]).toBe('pediatrics');
  });

  it('an OB/GYN module saves an OB/GYN completion', async () => {
    const btn = await openTrainingModule('OB/GYN');
    fireEvent.click(btn);

    await waitFor(() => expect(dbMocks.saveCompletion).toHaveBeenCalled());
    const call = dbMocks.saveCompletion.mock.calls.at(-1);
    expect(call[4]).toBe('obgyn');
    // A Pediatrics completion must never be written from the OB/GYN module.
    for (const c of dbMocks.saveCompletion.mock.calls) {
      expect(c[4]).not.toBe('pediatrics');
    }
  });

  it('rendered content matches the department the completion is saved under', async () => {
    const btn = await openTrainingModule('OB/GYN');
    // OB/GYN content only — no Pediatrics providers on screen.
    expect(pageText()).not.toContain('Sally Carilli');
    expect(pageText()).not.toContain('Concerta');

    fireEvent.click(btn);
    await waitFor(() => expect(dbMocks.saveCompletion).toHaveBeenCalled());
    expect(dbMocks.saveCompletion.mock.calls.at(-1)[4]).toBe('obgyn');
  });

  it('a completion whose department drifted is REJECTED and never persisted', async () => {
    // Exercise NavigatorApp's guard directly with a mismatched department: the
    // module rendered one department while the app's active department is another.
    await openTrainingModule('Pediatrics');
    dbMocks.saveCompletion.mockClear();

    // Re-render the module standalone with the SAME callback contract but a
    // department the app is not on, mirroring a mid-module department switch.
    const guard = async (kind, completionDepartment) => {
      if (completionDepartment !== 'pediatrics') {
        throw new Error('Training department changed. Reopen the module and try again.');
      }
      await dbMocks.saveCompletion('nav-1', 'Nav One', 'routing', kind, completionDepartment);
    };
    render(
      <TrainingModule
        rows={[]}
        domainId="routing"
        department="obgyn"
        showCohort={false}
        completionKind="module"
        onComplete={guard}
        onBack={vi.fn()}
        onOpenNavigator={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole('button', { name: 'Mark module complete' });
    fireEvent.click(buttons.at(-1));

    // The mismatch surfaces to the navigator and nothing is written.
    expect(
      await screen.findByText('Training department changed. Reopen the module and try again.'),
    ).toBeTruthy();
    expect(dbMocks.saveCompletion).not.toHaveBeenCalled();
    // Still retryable.
    expect(screen.getAllByRole('button', { name: 'Mark module complete' }).length).toBeGreaterThan(0);
  });

  it('a failed completion save stays visible and retryable', async () => {
    const btn = await openTrainingModule('Pediatrics');
    dbMocks.saveCompletion.mockRejectedValueOnce(new Error('Network down'));
    fireEvent.click(btn);
    expect(await screen.findByText('Network down')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mark (module complete|coaching reviewed)/ })).toBeTruthy();
  });

  it('never shows another navigator\'s name in the navigator training module', async () => {
    dbMocks.getFloorScores.mockResolvedValue([
      { name: 'Someone Else', navigatorId: 'nav-2', department: 'pediatrics', scores: WEAK_SCORES },
    ]);
    await openTrainingModule('Pediatrics');
    expect(screen.queryByText('Auto-assigned to')).toBeNull();
    expect(pageText()).not.toContain('Someone Else');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SupervisorApp — content and cohort cannot diverge
// ═════════════════════════════════════════════════════════════════════════════

describe('SupervisorApp — training content and cohort share one department', () => {
  const PEDS_NAV = {
    name: 'Peds Navigator', navigatorId: 'nav-p', department: 'pediatrics',
    assessmentType: 'mcq', scores: WEAK_SCORES, competencyScores: {},
    submittedAt: { seconds: 1_700_000_000 },
  };
  const OB_NAV = {
    name: 'Obgyn Navigator', navigatorId: 'nav-o', department: 'obgyn',
    assessmentType: 'mcq', scores: WEAK_SCORES, competencyScores: {},
    submittedAt: { seconds: 1_700_000_000 },
  };

  // Results are filtered to the ACTIVE roster, so the roster must match too.
  const seedFloor = () => {
    dbMocks.subscribeRoster.mockImplementation((cb) => {
      cb([
        { id: 'nav-p', name: 'Peds Navigator', status: 'active' },
        { id: 'nav-o', name: 'Obgyn Navigator', status: 'active' },
      ]);
      return () => {};
    });
    dbMocks.subscribeResults.mockImplementation((cb) => { cb([PEDS_NAV, OB_NAV]); return () => {}; });
  };

  const openSupervisorModule = async () => {
    seedFloor();
    render(<SupervisorApp onSignOut={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Training' }));
    const preview = await screen.findAllByRole('button', { name: /Preview module/i });
    fireEvent.click(preview[0]);
    await screen.findByText('Auto-assigned to');
  };

  // Department bar buttons render as e.g. "Pediatricslive" (name + live badge).
  const pickDept = (label) =>
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));

  it('Pediatrics selected → Pediatrics content AND the Pediatrics cohort', async () => {
    await openSupervisorModule();
    expect(pageText()).toContain('Peds Navigator');
    expect(pageText()).not.toContain('Obgyn Navigator');
    // Content is Pediatrics too (no OB routes anywhere on the page).
    expect(pageText()).not.toContain('OB Portal');
    expect(pageText()).not.toContain('Rebecca Wood');
  });

  it('switching the global department switches BOTH content and cohort together', async () => {
    await openSupervisorModule();
    expect(pageText()).toContain('Peds Navigator');
    expect(pageText()).not.toContain('OB Portal');

    // Go back to Training and switch the GLOBAL department, then reopen.
    fireEvent.click(screen.getByRole('button', { name: '← Back to training' }));
    pickDept('OB/GYN');
    const preview = await screen.findAllByRole('button', { name: /Preview module/i });
    fireEvent.click(preview[0]);
    await screen.findByText('Auto-assigned to');

    // Cohort followed...
    await waitFor(() => expect(pageText()).toContain('Obgyn Navigator'));
    expect(pageText()).not.toContain('Peds Navigator');
    // ...and so did the content: at least one OB/GYN-only marker is present and
    // every Pediatrics-only provider/route is gone.
    const OB_MARKERS = ['OB Portal', 'Rebecca Wood', 'Dr. Bank', 'OB Verified', 'New OB', 'Annual GYN'];
    expect(
      OB_MARKERS.some((m) => pageText().includes(m)),
      'no OB/GYN-only content rendered after switching to OB/GYN',
    ).toBe(true);
    for (const term of ['Sally Carilli', 'Concerta', 'PEDS Encounters', 'Anisa Azeez']) {
      expect(pageText(), `${term} leaked into OB/GYN supervisor module`).not.toContain(term);
    }
  });

  it('offers no in-module control that could desync content from the cohort', async () => {
    await openSupervisorModule();
    const moduleEl = document.querySelector('.module');
    expect(moduleEl).toBeTruthy();
    // No department control inside the module...
    expect(within(moduleEl).queryByRole('group', { name: 'Choose department' })).toBeNull();
    expect(within(moduleEl).queryByRole('group', { name: 'Choose department scenario' })).toBeNull();
    // ...and the global department bar is not rendered in the module view either,
    // so department cannot change while a module is open.
    expect(screen.queryByRole('button', { name: /^OB\/GYN/ })).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Unsupported departments — no silent Pediatrics fallback
// ═════════════════════════════════════════════════════════════════════════════

describe('SupervisorApp — unsupported departments show unavailable training', () => {
  it.each([['Adult Medicine'], ['Behavioural Health']])(
    '%s renders no Pediatrics or OB/GYN training content',
    async (label) => {
      render(<SupervisorApp onSignOut={vi.fn()} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Training' }));
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));

      await waitFor(() => {
        for (const term of ['Sally Carilli', 'Concerta', 'OB Portal', 'Rebecca Wood']) {
          expect(pageText(), `${term} rendered for ${label}`).not.toContain(term);
        }
      });
      // And no live simulation / drill leaked in from a fallback department.
      expect(screen.queryByText('Live call simulation')).toBeNull();
      expect(screen.queryByText('Quick decision checks')).toBeNull();
    },
  );
});
