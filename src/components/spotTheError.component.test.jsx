// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// SpotTheError COMPONENT TESTS — deferred-feedback assessment flow.
//
// Covers the 2026-07-17 redesign: picking a message shows NO correct/wrong
// verdict during the run; each pick requires a typed "why is this the error"
// explanation before advancing (and stays changeable until then); all
// correctness feedback + the navigator's reasoning appear only on the review
// screen after the last item.
//
// Firebase/db/apiFetch are mocked; items load from the (mocked) audit bank so
// no network or Gemini call is involved.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getActiveAudits: vi.fn(),
  apiFetch: vi.fn(),
  runPooled: vi.fn(),
}));

vi.mock('../lib/firebase.js', () => ({ isFirebaseConfigured: true }));
vi.mock('../lib/db.js', () => ({ getActiveAudits: mocks.getActiveAudits }));
vi.mock('../lib/apiFetch.js', () => ({
  apiFetch: mocks.apiFetch,
  runPooled: mocks.runPooled,
  fetchErrorMessage: (err, timeoutMsg, fallbackMsg) => fallbackMsg,
}));

import SpotTheError from './SpotTheError.jsx';

// Two single-error transcripts: routing's error is the SECOND agent turn,
// intake's error is the FIRST agent turn.
const BANK = [
  {
    domainId: 'routing',
    transcript: [
      { speaker: 'Patient', message: 'Routing patient line' },
      { speaker: 'Agent',   message: 'Routing agent turn one' },
      { speaker: 'Agent',   message: 'Routing agent turn two' },
    ],
    errorIndex: 2,
    modelExplanation: 'Model explanation for the routing error.',
  },
  {
    domainId: 'intake',
    transcript: [
      { speaker: 'Patient', message: 'Intake patient line' },
      { speaker: 'Agent',   message: 'Intake agent turn one' },
      { speaker: 'Agent',   message: 'Intake agent turn two' },
    ],
    errorIndex: 1,
    modelExplanation: 'Model explanation for the intake error.',
  },
];

function renderAssessment() {
  return render(
    <SpotTheError
      navigatorId="nav-1"
      name="Test Navigator"
      domains={['routing', 'intake']}
      mode="full"
      department="pediatrics"
      onBack={() => {}}
      onFinish={() => {}}
      onComplete={vi.fn().mockResolvedValue(true)}
    />
  );
}

const explanationBox = () => screen.getByLabelText(/Why is this the error\?/);
const advanceButton = (last) =>
  screen.getByRole('button', { name: last ? 'Finish & see results' : 'Next item →' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveAudits.mockResolvedValue(BANK);
});

describe('SpotTheError — deferred feedback + explanation', () => {
  it('shows no correct/wrong verdict when a message is picked, only the explain panel', async () => {
    renderAssessment();
    fireEvent.click(await screen.findByText('Routing agent turn two'));

    expect(screen.queryByText(/✓ Correct/)).toBeNull();
    expect(screen.queryByText(/✗/)).toBeNull();
    expect(explanationBox()).toBeInTheDocument();
    // No reveal styling either — correctness must not leak through classes.
    expect(document.querySelector('.spot-error__bubble--found')).toBeNull();
    expect(document.querySelector('.spot-error__bubble--wrong')).toBeNull();
    expect(document.querySelector('.spot-error__bubble--selected')).not.toBeNull();
  });

  it('requires a non-empty explanation before advancing, and the pick stays changeable', async () => {
    renderAssessment();
    fireEvent.click(await screen.findByText('Routing agent turn one'));
    expect(advanceButton(false)).toBeDisabled();
    fireEvent.change(explanationBox(), { target: { value: '   ' } });
    expect(advanceButton(false)).toBeDisabled();

    // Change the pick before committing — allowed, still no verdict.
    fireEvent.click(screen.getByText('Routing agent turn two'));
    fireEvent.change(explanationBox(), { target: { value: 'Wrong queue for a refill.' } });
    expect(advanceButton(false)).toBeEnabled();

    fireEvent.click(advanceButton(false));
    expect(screen.getByText('Item 2 of 2')).toBeInTheDocument();
    // Pick + explanation reset for the next item — no panel until a new pick.
    expect(screen.queryByLabelText(/Why is this the error\?/)).toBeNull();
    expect(document.querySelector('.spot-error__bubble--selected')).toBeNull();
    fireEvent.click(screen.getByText('Intake agent turn one'));
    expect(explanationBox().value).toBe('');
  });

  it('patient turns are not pickable', async () => {
    renderAssessment();
    const patient = await screen.findByText('Routing patient line');
    expect(patient).toBeDisabled();
    fireEvent.click(patient);
    expect(screen.queryByLabelText(/Why is this the error\?/)).toBeNull();
  });

  it('reveals correctness, the missed pick, and the typed reasoning only in the review', async () => {
    renderAssessment();

    // Item 1 (routing): correct pick.
    fireEvent.click(await screen.findByText('Routing agent turn two'));
    fireEvent.change(explanationBox(), { target: { value: 'Refill routed to the wrong queue.' } });
    fireEvent.click(advanceButton(false));

    // Item 2 (intake): wrong pick (error is turn one).
    fireEvent.click(screen.getByText('Intake agent turn two'));
    fireEvent.change(explanationBox(), { target: { value: 'No identity verification.' } });
    fireEvent.click(advanceButton(true));

    // Review: first time any verdict appears.
    expect(screen.getByText('Assessment results')).toBeInTheDocument();
    expect(screen.getByText('✓ Correct')).toBeInTheDocument();
    expect(screen.getByText('✗ Missed')).toBeInTheDocument();
    // Missed item shows what they picked alongside the actual error.
    expect(screen.getByText(/Your pick:/)).toBeInTheDocument();
    expect(screen.getByText(/“Intake agent turn two”/)).toBeInTheDocument();
    // Both model explanations and both typed reasonings are shown.
    expect(screen.getByText('Model explanation for the routing error.')).toBeInTheDocument();
    expect(screen.getByText('Model explanation for the intake error.')).toBeInTheDocument();
    expect(screen.getByText('Refill routed to the wrong queue.')).toBeInTheDocument();
    expect(screen.getByText('No identity verification.')).toBeInTheDocument();
  });
});
