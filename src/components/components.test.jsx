// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT TESTS — pure-render and key stateful components.
// Uses @testing-library/react.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import EmptyState from './EmptyState.jsx';
import Footer     from './Footer.jsx';
import Nav        from './Nav.jsx';
import PhaseHub   from './PhaseHub.jsx';
import Start      from './Start.jsx';
import { callQaScenarioMetadata, runQaPersistenceSequence, buildCallQaGradingScenario } from './VoiceCall.jsx';
import { CALL_QA_SCENARIOS } from '../data/callQaScenarios.js';

const startMocks = vi.hoisted(() => ({
  getRoster: vi.fn(),
  updateRosterEntry: vi.fn(),
  saveInterview: vi.fn(),
  updateInterviewGrade: vi.fn(),
}));

vi.mock('../lib/firebase.js', () => ({ isFirebaseConfigured: true }));
vi.mock('../lib/db.js', () => ({
  getRoster: startMocks.getRoster,
  updateRosterEntry: startMocks.updateRosterEntry,
  saveInterview: startMocks.saveInterview,
  updateInterviewGrade: startMocks.updateInterviewGrade,
}));

beforeEach(() => vi.clearAllMocks());

// ── EmptyState ───────────────────────────────────────────────────────────────

describe('EmptyState', () => {
  it('renders the title prop', () => {
    render(<EmptyState title="Nothing here yet">Add some data first.</EmptyState>);
    expect(screen.getByRole('heading', { name: 'Nothing here yet' })).toBeInTheDocument();
  });

  it('renders children as body text', () => {
    render(<EmptyState title="T">Some helpful message.</EmptyState>);
    expect(screen.getByText('Some helpful message.')).toBeInTheDocument();
  });

  it('renders the SVG icon (aria-hidden)', () => {
    const { container } = render(<EmptyState title="T">Body</EmptyState>);
    const icon = container.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });
});

// ── Footer ───────────────────────────────────────────────────────────────────

describe('Footer', () => {
  it('renders the brand name', () => {
    render(<Footer />);
    expect(screen.getByText(/Knowledge Check/)).toBeInTheDocument();
  });

  it('renders inside a <footer> element', () => {
    const { container } = render(<Footer />);
    expect(container.querySelector('footer')).toBeInTheDocument();
  });
});

// ── Nav ──────────────────────────────────────────────────────────────────────

describe('Nav — supervisor role', () => {
  const supervisorProps = () => ({
    role:     'supervisor',
    view:     'overview',
    setView:  vi.fn(),
    onSignOut: vi.fn(),
  });

  it('renders all supervisor tabs', () => {
    render(<Nav {...supervisorProps()} />);
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Matrix' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Navigators' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Training' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Questions' })).toBeInTheDocument();
  });

  it('marks the active view tab with is-active class', () => {
    render(<Nav {...supervisorProps()} view="matrix" />);
    const matrixBtn = screen.getByRole('button', { name: 'Matrix' });
    expect(matrixBtn).toHaveClass('is-active');
    const overviewBtn = screen.getByRole('button', { name: 'Overview' });
    expect(overviewBtn).not.toHaveClass('is-active');
  });

  it('calls setView with the tab id when a tab is clicked', () => {
    const setView = vi.fn();
    render(<Nav {...supervisorProps()} setView={setView} />);
    fireEvent.click(screen.getByRole('button', { name: 'Matrix' }));
    expect(setView).toHaveBeenCalledWith('matrix');
  });

  it('calls onSignOut when the Sign out button is clicked', () => {
    const onSignOut = vi.fn();
    render(<Nav {...supervisorProps()} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('does not render the dept-switch pill for supervisors', () => {
    render(<Nav {...supervisorProps()} activeDeptName="Pediatrics" onChangeDept={vi.fn()} />);
    expect(screen.queryByTitle('Switch department')).not.toBeInTheDocument();
  });
});

describe('Nav — navigator role', () => {
  const navigatorProps = () => ({
    role:     'navigator',
    view:     'dashboard',
    setView:  vi.fn(),
    onSignOut: vi.fn(),
  });

  it('renders navigator tabs (not supervisor tabs)', () => {
    render(<Nav {...navigatorProps()} />);
    expect(screen.getByRole('button', { name: 'My results' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My training' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
  });

  it('shows "Switch user" instead of "Sign out"', () => {
    render(<Nav {...navigatorProps()} />);
    expect(screen.getByRole('button', { name: 'Switch user' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('renders the dept-switch pill when activeDeptName and onChangeDept are provided', () => {
    const onChangeDept = vi.fn();
    render(<Nav {...navigatorProps()} activeDeptName="Pediatrics" onChangeDept={onChangeDept} />);
    const pill = screen.getByTitle('Switch department');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent('Pediatrics');
  });

  it('calls onChangeDept when the dept pill is clicked', () => {
    const onChangeDept = vi.fn();
    render(<Nav {...navigatorProps()} activeDeptName="OB/GYN" onChangeDept={onChangeDept} />);
    fireEvent.click(screen.getByTitle('Switch department'));
    expect(onChangeDept).toHaveBeenCalledTimes(1);
  });

  it('does not render the dept-switch pill when activeDeptName is absent', () => {
    render(<Nav {...navigatorProps()} />);
    expect(screen.queryByTitle('Switch department')).not.toBeInTheDocument();
  });
});

describe('Start navigator gate', () => {
  it('lets a navigator create a PIN when their roster row has none', async () => {
    startMocks.getRoster.mockResolvedValue([{ id: 'ada', name: 'Ada', pin: '' }]);
    startMocks.updateRosterEntry.mockResolvedValue();
    const onNavigatorEntry = vi.fn();

    render(<Start onNavigatorEntry={onNavigatorEntry} onSupervisorEntry={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /I.m a navigator/i }));
    fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByLabelText('Create your PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(startMocks.updateRosterEntry).toHaveBeenCalledWith('ada', { pin: '1234' }));
    expect(onNavigatorEntry).toHaveBeenCalledWith('ada', 'Ada');
  });

  it('uses an existing PIN without overwriting it', async () => {
    startMocks.getRoster.mockResolvedValue([{ id: 'bea', name: 'Bea', pin: '2222' }]);
    const onNavigatorEntry = vi.fn();

    render(<Start onNavigatorEntry={onNavigatorEntry} onSupervisorEntry={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /I.m a navigator/i }));
    fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: 'bea' } });
    fireEvent.change(screen.getByLabelText('Your PIN'), { target: { value: '2222' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onNavigatorEntry).toHaveBeenCalledWith('bea', 'Bea'));
    expect(startMocks.updateRosterEntry).not.toHaveBeenCalled();
  });
});

describe('PhaseHub', () => {
  const noop = () => {};

  it('locks phases 2 and 3 when nothing is done', () => {
    render(<PhaseHub deptName="Pediatrics" done={{}} results={{}} latestQa={null} onStart={noop} />);
    expect(screen.getByText('0 of 3 phases complete')).toBeTruthy();
    const cards = screen.getAllByRole('button').filter((b) => b.className.includes('phase-card'));
    expect(cards).toHaveLength(3);
    expect(cards[0].disabled).toBe(false);
    expect(cards[1].disabled).toBe(true);
    expect(cards[2].disabled).toBe(true);
    expect(screen.getAllByText(/Complete Phase \d first/)).toHaveLength(2);
  });

  it('starts the first phase on click', () => {
    let picked = null;
    render(<PhaseHub deptName="Pediatrics" done={{}} results={{}} latestQa={null} onStart={(id) => { picked = id; }} />);
    const cards = screen.getAllByRole('button').filter((b) => b.className.includes('phase-card'));
    fireEvent.click(cards[0]);
    expect(picked).toBe('mcq');
  });

  it('unlocks phase 2 after the MCQ and shows its summary', () => {
    const results = { mcq: { scores: { intake: 80, classification: 60 } } };
    let picked = null;
    render(<PhaseHub deptName="Pediatrics" done={{ mcq: true }} results={results} latestQa={null} onStart={(id) => { picked = id; }} />);
    expect(screen.getByText('1 of 3 phases complete')).toBeTruthy();
    expect(screen.getByText(/avg 70%/)).toBeTruthy();
    const cards = screen.getAllByRole('button').filter((b) => b.className.includes('phase-card'));
    fireEvent.click(cards[1]);
    expect(picked).toBe('spot');
    expect(cards[2].disabled).toBe(true);
  });

  it('shows the QA verdict and all-complete state when every phase is done', () => {
    const latestQa = { qa: { pass: false, score: 62, review: null } };
    render(
      <PhaseHub
        deptName="Pediatrics"
        done={{ mcq: true, spot: true, qa: true }}
        results={{ mcq: { scores: { intake: 90 } }, spot: { scores: { intake: 100 } } }}
        latestQa={latestQa}
        onStart={noop}
      />
    );
    expect(screen.getByText('All 3 phases complete')).toBeTruthy();
    expect(screen.getByText(/FAIL · 62\/100/)).toBeTruthy();
    const cards = screen.getAllByRole('button').filter((b) => b.className.includes('phase-card'));
    expect(cards.every((c) => !c.disabled)).toBe(true);
  });
});

describe('runQaPersistenceSequence', () => {
  it('does not grade or save a grade when interview save fails', async () => {
    const saveInterviewFn = vi.fn().mockRejectedValue(new Error('save failed'));
    const gradeQaFn = vi.fn();
    const saveGradeFn = vi.fn();

    await expect(runQaPersistenceSequence({
      navigatorId: 'nav-1',
      name: 'Ada',
      domainId: 'routing',
      scenario: 'Scenario',
      callerName: 'Caller',
      transcript: [{ role: 'patient', text: 'Help' }],
      department: 'pediatrics',
    }, {
      saveInterviewFn,
      gradeQaFn,
      saveGradeFn,
    })).rejects.toMatchObject({ stage: 'save' });

    expect(gradeQaFn).not.toHaveBeenCalled();
    expect(saveGradeFn).not.toHaveBeenCalled();
  });

  it('passes curated scenario metadata to the interview save helper', async () => {
    const saveInterviewFn = vi.fn().mockResolvedValue('iv-1');
    const gradeQaFn = vi.fn().mockResolvedValue({
      grade: { score: 90 },
      qa: { score: 90, pass: true },
    });
    const saveGradeFn = vi.fn().mockResolvedValue();
    const metadata = callQaScenarioMetadata(CALL_QA_SCENARIOS[0]);

    await runQaPersistenceSequence({
      navigatorId: 'nav-1',
      name: 'Ada',
      domainId: 'routing',
      scenario: 'Scenario',
      callerName: 'Caller',
      transcript: [{ role: 'patient', text: 'Help' }],
      department: 'pediatrics',
      metadata,
    }, {
      saveInterviewFn,
      gradeQaFn,
      saveGradeFn,
    });

    expect(saveInterviewFn).toHaveBeenCalledWith(
      'nav-1',
      'Ada',
      'routing',
      'Scenario',
      'Caller',
      [{ role: 'patient', text: 'Help' }],
      'pediatrics',
      metadata
    );
  });

  it('passes curated expectedActions/criticalMisses into the scenario sent to the grader', async () => {
    const saveInterviewFn = vi.fn().mockResolvedValue('iv-1');
    const gradeQaFn = vi.fn().mockResolvedValue({
      grade: { score: 90 },
      qa: { score: 90, pass: true },
    });
    const saveGradeFn = vi.fn().mockResolvedValue();
    const source = CALL_QA_SCENARIOS[0];
    const metadata = callQaScenarioMetadata(source);

    await runQaPersistenceSequence({
      navigatorId: 'nav-1',
      name: 'Ada',
      domainId: 'routing',
      scenario: 'Scenario',
      callerName: 'Caller',
      transcript: [{ role: 'patient', text: 'Help' }],
      department: 'pediatrics',
      metadata,
    }, {
      saveInterviewFn,
      gradeQaFn,
      saveGradeFn,
    });

    expect(gradeQaFn).toHaveBeenCalledTimes(1);
    const sentScenario = gradeQaFn.mock.calls[0][0].scenario;
    expect(sentScenario).toContain('Scenario');
    expect(sentScenario).toContain('GRADING CONTEXT');
    source.expectedActions.forEach((a) => expect(sentScenario).toContain(a));
    source.criticalMisses.forEach((m) => expect(sentScenario).toContain(m));
  });
});

describe('buildCallQaGradingScenario', () => {
  it('returns the original scenario unchanged when there is no curated metadata', () => {
    expect(buildCallQaGradingScenario('Base scenario')).toBe('Base scenario');
    expect(buildCallQaGradingScenario('Base scenario', {})).toBe('Base scenario');
  });

  it('appends a plain-text grading context block from curated metadata', () => {
    const out = buildCallQaGradingScenario('Base scenario', {
      qaScenarioTitle: 'Refill request',
      workflowType: 'prescription_refill',
      difficulty: 'medium',
      expectedActions: ['Verify identity', 'Route to pharmacy queue'],
      criticalMisses: ['Gives medical advice'],
    });
    expect(out).toContain('Base scenario');
    expect(out).toContain('Refill request');
    expect(out).toContain('prescription_refill');
    expect(out).toContain('Verify identity');
    expect(out).toContain('Route to pharmacy queue');
    expect(out).toContain('Gives medical advice');
  });
});
