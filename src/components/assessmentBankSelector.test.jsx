// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// ASSESSMENT BANK SELECTOR — the top-level Questions-view chooser that lets a
// supervisor switch between the Scenario Question Bank (QuestionBank, PR #28)
// and the Spot the Error transcript bank (AuditBank) without scrolling past
// one to reach the other. Behavior/accessible-output focused; no snapshots.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import AssessmentBankSelector from './AssessmentBankSelector.jsx';

function makeQuestion(overrides = {}) {
  return {
    id: overrides.id ?? 'q1',
    department: 'pediatrics',
    domainId: 'intake',
    competencies: ['sopKnowledge'],
    scenario: 'A caller asks about a refill for their child.',
    options: [
      { id: 'a', text: 'Verify identity then check the chart', points: 100, rationale: 'This matches the SOP.' },
      { id: 'b', text: 'Process the refill immediately', points: 20, rationale: 'Skips verification.' },
    ],
    correctOptionId: 'a',
    status: 'active',
    ...overrides,
  };
}

function makeAudit(overrides = {}) {
  return {
    id: overrides.id ?? 'a1',
    department: 'pediatrics',
    domainId: 'intake',
    status: 'active',
    workflowType: 'general_workflow',
    errorKind: 'workflow_error',
    difficulty: 'medium',
    errorIndex: 1,
    modelExplanation: 'The agent skipped identity verification.',
    transcript: [
      { speaker: 'Patient', message: 'Hi, I need a refill.' },
      { speaker: 'Agent', message: 'Sure, what medication?' },
    ],
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  const questions = overrides.questions ?? [];
  const audits = overrides.audits ?? [];
  const selectedDept = overrides.selectedDept ?? 'pediatrics';
  return {
    questions,
    audits,
    selectedDept,
    questionBankProps: {
      questions,
      results: [],
      selectedDept,
      onActivate: vi.fn(),
      onArchive: vi.fn(),
      onDelete: vi.fn(),
      onSaveEdit: vi.fn().mockResolvedValue(undefined),
      onGenerate: vi.fn().mockResolvedValue(2),
      onSaveFeedback: vi.fn(),
      onSaveProposal: vi.fn(),
    },
    auditBankProps: {
      audits,
      selectedDept,
      onGenerate: vi.fn().mockResolvedValue(2),
      onActivate: vi.fn(),
      onArchive: vi.fn(),
      onDelete: vi.fn(),
    },
  };
}

const bankTab = (name) => screen.getByRole('tab', { name: new RegExp(`^${name}`, 'i') });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AssessmentBankSelector — default state', () => {
  it('selects Scenario Questions by default', () => {
    render(<AssessmentBankSelector {...baseProps()} />);
    expect(bankTab('Scenario Questions').getAttribute('aria-selected')).toBe('true');
    expect(bankTab('Spot the Error').getAttribute('aria-selected')).toBe('false');
  });

  it('shows the Scenario Question Bank heading and hides the Spot the Error heading', () => {
    render(<AssessmentBankSelector {...baseProps()} />);
    expect(screen.getByRole('heading', { name: 'Question bank' })).toBeInTheDocument();
    // AuditBank IS mounted (state preservation), but hidden — not reachable by
    // a default (hidden-respecting) accessibility query, i.e. not visually
    // present in the page flow. This is also the structural proxy for "no
    // scrolling required to reach the other bank": the inactive bank produces
    // zero layout height instead of sitting further down the same page.
    expect(screen.queryByRole('heading', { name: 'Spot the Error bank' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Spot the Error bank', hidden: true })).toBeInTheDocument();
  });

  it('does not render QuestionBank/AuditBank content that requires scrolling past one to reach the other', () => {
    render(<AssessmentBankSelector {...baseProps()} />);
    const spotPanel = document.getElementById('assessbank-tabpanel-spot');
    expect(spotPanel).toHaveAttribute('hidden');
  });
});

describe('AssessmentBankSelector — switching banks', () => {
  it('selecting Spot the Error hides Scenario Questions and shows the audit bank', () => {
    render(<AssessmentBankSelector {...baseProps()} />);
    fireEvent.click(bankTab('Spot the Error'));

    expect(bankTab('Spot the Error').getAttribute('aria-selected')).toBe('true');
    expect(bankTab('Scenario Questions').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('heading', { name: 'Spot the Error bank' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Question bank' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Question bank', hidden: true })).toBeInTheDocument();

    const scenarioPanel = document.getElementById('assessbank-tabpanel-scenario');
    expect(scenarioPanel).toHaveAttribute('hidden');
  });

  it('switching back restores Scenario Questions', () => {
    render(<AssessmentBankSelector {...baseProps()} />);
    fireEvent.click(bankTab('Spot the Error'));
    fireEvent.click(bankTab('Scenario Questions'));

    expect(bankTab('Scenario Questions').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Question bank' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Spot the Error bank' })).not.toBeInTheDocument();
  });

  it('preserves each bank\'s own internal UI state across a switch (both stay mounted)', () => {
    const questions = [
      makeQuestion({ id: 'a1', status: 'active' }),
      makeQuestion({ id: 'a2', status: 'active' }),
      makeQuestion({ id: 'd1', status: 'draft' }),
    ];
    render(<AssessmentBankSelector {...baseProps({ questions })} />);

    const scenarioPanel = document.getElementById('assessbank-tabpanel-scenario');
    // QuestionBank auto-defaults to its own "Review Queue" sub-tab because a
    // draft exists; manually switch its internal tab to "Active".
    fireEvent.click(within(scenarioPanel).getByRole('tab', { name: /^Active/i }));
    expect(within(scenarioPanel).getByRole('tab', { name: /^Active/i }).getAttribute('aria-selected')).toBe('true');

    // Leave and come back to the Scenario Questions bank.
    fireEvent.click(bankTab('Spot the Error'));
    fireEvent.click(bankTab('Scenario Questions'));

    // QuestionBank was never unmounted, so its own "Active" sub-tab choice survived.
    expect(within(scenarioPanel).getByRole('tab', { name: /^Active/i }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('AssessmentBankSelector — keyboard navigation', () => {
  it('supports Left/Right/Home/End roving-tabindex navigation', () => {
    render(<AssessmentBankSelector {...baseProps()} />);
    const scenario = bankTab('Scenario Questions');
    const spot = bankTab('Spot the Error');

    expect(scenario.tabIndex).toBe(0);
    expect(spot.tabIndex).toBe(-1);

    fireEvent.keyDown(scenario, { key: 'ArrowRight' });
    expect(spot.getAttribute('aria-selected')).toBe('true');
    expect(spot.tabIndex).toBe(0);
    expect(scenario.tabIndex).toBe(-1);

    fireEvent.keyDown(spot, { key: 'ArrowLeft' });
    expect(scenario.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(scenario, { key: 'End' });
    expect(spot.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(spot, { key: 'Home' });
    expect(scenario.getAttribute('aria-selected')).toBe('true');
  });

  it('the hidden bank is not keyboard-reachable', () => {
    render(<AssessmentBankSelector {...baseProps()} />);
    // Nothing inside the hidden Spot the Error panel is queryable via the
    // default (accessibility-tree-respecting, hidden-excluding) role query —
    // i.e. it cannot receive Tab focus while inactive.
    expect(screen.queryByRole('button', { name: /Generate transcripts/i })).not.toBeInTheDocument();
  });
});

describe('AssessmentBankSelector — department scoping', () => {
  it('shows department-scoped draft/active counts and updates them when selectedDept changes', () => {
    const questions = [
      makeQuestion({ id: 'p1', status: 'active', department: 'pediatrics' }),
      makeQuestion({ id: 'p2', status: 'draft', department: 'pediatrics' }),
      makeQuestion({ id: 'o1', status: 'active', department: 'obgyn' }),
    ];
    const audits = [
      makeAudit({ id: 'ap1', status: 'active', department: 'pediatrics' }),
      makeAudit({ id: 'ao1', status: 'draft', department: 'obgyn' }),
    ];

    const { rerender } = render(<AssessmentBankSelector {...baseProps({ questions, audits, selectedDept: 'pediatrics' })} />);
    expect(bankTab('Scenario Questions').textContent).toMatch(/1 draft/i);
    expect(bankTab('Scenario Questions').textContent).toMatch(/1 active/i);
    expect(bankTab('Spot the Error').textContent).toMatch(/0 draft/i);
    expect(bankTab('Spot the Error').textContent).toMatch(/1 active/i);

    rerender(<AssessmentBankSelector {...baseProps({ questions, audits, selectedDept: 'obgyn' })} />);
    expect(bankTab('Scenario Questions').textContent).toMatch(/0 draft/i);
    expect(bankTab('Scenario Questions').textContent).toMatch(/1 active/i);
    expect(bankTab('Spot the Error').textContent).toMatch(/1 draft/i);
    expect(bankTab('Spot the Error').textContent).toMatch(/0 active/i);
  });

  it('passes selectedDept straight through to both QuestionBank and AuditBank', () => {
    const questions = [makeQuestion({ id: 'o1', status: 'active', department: 'obgyn', scenario: 'An OB/GYN caller scenario.' })];
    render(<AssessmentBankSelector {...baseProps({ questions, selectedDept: 'obgyn' })} />);
    // QuestionBank's own department-scoping (already covered in questionBank.test.jsx)
    // shows this obgyn question in its Active sub-tab rather than an empty state.
    expect(screen.getByText(/An OB\/GYN caller scenario\./)).toBeInTheDocument();
  });
});

describe('AssessmentBankSelector — no PR #28 QuestionBank behavior removed', () => {
  it('still renders the generation button, status tabs, and search toolbar for the Scenario Question Bank', () => {
    const questions = [makeQuestion({ id: 'a1', status: 'active' })];
    render(<AssessmentBankSelector {...baseProps({ questions })} />);
    const scenarioPanel = document.getElementById('assessbank-tabpanel-scenario');

    expect(within(scenarioPanel).getByRole('button', { name: /Generate questions/i })).toBeInTheDocument();
    expect(within(scenarioPanel).getByRole('tab', { name: /^Review Queue/i })).toBeInTheDocument();
    expect(within(scenarioPanel).getByRole('tab', { name: /^Active/i })).toBeInTheDocument();
    expect(within(scenarioPanel).getByRole('tab', { name: /^Archived/i })).toBeInTheDocument();
    expect(within(scenarioPanel).getByLabelText('Search questions')).toBeInTheDocument();
  });

  it('still renders AuditBank generation, coverage, and review tools when selected', () => {
    render(<AssessmentBankSelector {...baseProps()} />);
    fireEvent.click(bankTab('Spot the Error'));
    const spotPanel = document.getElementById('assessbank-tabpanel-spot');

    expect(within(spotPanel).getByRole('button', { name: /Generate transcripts/i })).toBeInTheDocument();
    expect(within(spotPanel).getByText(/Active coverage by domain/i)).toBeInTheDocument();
    expect(within(spotPanel).getByText(/Review queue/i)).toBeInTheDocument();
  });
});
