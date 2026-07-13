// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// QUESTION BANK — the redesigned collapsible review workspace (2026-07-13).
// Behavior/accessible-output focused; no snapshots.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import QuestionBank from './QuestionBank.jsx';

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

function baseProps(overrides = {}) {
  return {
    questions: [],
    results: [],
    selectedDept: 'pediatrics',
    onActivate: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onSaveEdit: vi.fn().mockResolvedValue(undefined),
    onGenerate: vi.fn().mockResolvedValue(2),
    onSaveFeedback: vi.fn(),
    onSaveProposal: vi.fn(),
    ...overrides,
  };
}

const tab = (name) => screen.getByRole('tab', { name: new RegExp(name, 'i') });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QuestionBank — status tabs', () => {
  it('shows only one status tabpanel at a time', () => {
    const questions = [makeQuestion({ id: 'a', status: 'active' }), makeQuestion({ id: 'd', status: 'draft' })];
    render(<QuestionBank {...baseProps({ questions })} />);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    fireEvent.click(tab('Active'));
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('defaults to Review Queue when drafts exist', () => {
    const questions = [makeQuestion({ id: 'a', status: 'active' }), makeQuestion({ id: 'd', status: 'draft' })];
    render(<QuestionBank {...baseProps({ questions })} />);
    expect(tab('Review Queue').getAttribute('aria-selected')).toBe('true');
  });

  it('defaults to Active when there are no drafts', () => {
    const questions = [makeQuestion({ id: 'a', status: 'active' })];
    render(<QuestionBank {...baseProps({ questions })} />);
    expect(tab('Active').getAttribute('aria-selected')).toBe('true');
  });
});

describe('QuestionBank — collapsible rows', () => {
  it('renders questions collapsed by default (no options/rationale visible)', () => {
    const questions = [makeQuestion({ id: 'a' })];
    render(<QuestionBank {...baseProps({ questions })} />);
    expect(screen.queryByText('Process the refill immediately')).not.toBeInTheDocument();
    expect(screen.queryByText(/Best answer:/)).not.toBeInTheDocument();
  });

  it('expanding a question reveals options and rationale', () => {
    const questions = [makeQuestion({ id: 'a' })];
    render(<QuestionBank {...baseProps({ questions })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('Process the refill immediately')).toBeInTheDocument();
    expect(screen.getByText(/Best answer:/)).toBeInTheDocument();
  });

  it('expanding a second question collapses the first', () => {
    const questions = [makeQuestion({ id: 'a', scenario: 'Scenario A' }), makeQuestion({ id: 'b', scenario: 'Scenario B' })];
    render(<QuestionBank {...baseProps({ questions })} />);
    const rows = screen.getAllByRole('button', { expanded: false });
    fireEvent.click(rows[0]);
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1);
    const stillCollapsed = screen.getAllByRole('button', { expanded: false })[0];
    fireEvent.click(stillCollapsed);
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1);
  });

  it('clicking an action inside the expanded row does not toggle the accordion closed', () => {
    const onArchive = vi.fn();
    const questions = [makeQuestion({ id: 'a', status: 'active' })];
    render(<QuestionBank {...baseProps({ questions, onArchive })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onArchive).toHaveBeenCalledWith('a');
    // Row should still be expanded (Archive click should not have toggled it shut).
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
  });
});

describe('QuestionBank — search / filter / sort', () => {
  it('filters by scenario text', () => {
    const questions = [
      makeQuestion({ id: 'a', scenario: 'A caller asks about a refill.' }),
      makeQuestion({ id: 'b', scenario: 'A caller wants to reschedule an appointment.' }),
    ];
    render(<QuestionBank {...baseProps({ questions })} />);
    fireEvent.change(screen.getByLabelText('Search questions'), { target: { value: 'reschedule' } });
    expect(screen.getByText(/1 of 2 questions/)).toBeInTheDocument();
  });

  it('filters by option text', () => {
    const questions = [
      makeQuestion({ id: 'a', options: [{ id: 'a', text: 'Zephyr unique wording', points: 100, rationale: 'r' }, { id: 'b', text: 'other', points: 0, rationale: 'r' }] }),
      makeQuestion({ id: 'b' }),
    ];
    render(<QuestionBank {...baseProps({ questions })} />);
    fireEvent.change(screen.getByLabelText('Search questions'), { target: { value: 'zephyr' } });
    expect(screen.getByText(/1 of 2 questions/)).toBeInTheDocument();
  });

  it('filters by domain', () => {
    const questions = [
      makeQuestion({ id: 'a', domainId: 'intake' }),
      makeQuestion({ id: 'b', domainId: 'routing' }),
    ];
    render(<QuestionBank {...baseProps({ questions })} />);
    fireEvent.change(screen.getByLabelText('Filter by domain'), { target: { value: 'routing' } });
    expect(screen.getByText(/1 of 2 questions/)).toBeInTheDocument();
  });

  it('filters by competency', () => {
    const questions = [
      makeQuestion({ id: 'a', competencies: ['sopKnowledge'] }),
      makeQuestion({ id: 'b', competencies: ['communication'] }),
    ];
    render(<QuestionBank {...baseProps({ questions })} />);
    fireEvent.change(screen.getByLabelText('Filter by competency'), { target: { value: 'communication' } });
    expect(screen.getByText(/1 of 2 questions/)).toBeInTheDocument();
  });

  it('clear filters restores the full list', () => {
    const questions = [makeQuestion({ id: 'a' }), makeQuestion({ id: 'b' })];
    render(<QuestionBank {...baseProps({ questions })} />);
    fireEvent.change(screen.getByLabelText('Search questions'), { target: { value: 'nothing matches this' } });
    expect(screen.getByText(/0 of 2 questions/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(screen.getByText(/2 of 2 questions/)).toBeInTheDocument();
  });

  it('health filter narrows active questions by health status', () => {
    const questions = [makeQuestion({ id: 'a' }), makeQuestion({ id: 'b' })];
    const results = [
      // 'a' gets 10 correct responses (healthy); 'b' gets no responses (insufficient).
      ...Array.from({ length: 10 }, () => ({ answers: { a: 'a' }, scores: {} })),
    ];
    render(<QuestionBank {...baseProps({ questions, results })} />);
    fireEvent.change(screen.getByLabelText('Filter by question health'), { target: { value: 'healthy' } });
    expect(screen.getByText(/1 of 2 questions/)).toBeInTheDocument();
  });

  it('sorting does not mutate the original questions array', () => {
    const questions = [makeQuestion({ id: 'b' }), makeQuestion({ id: 'a' })];
    const originalOrder = questions.map((q) => q.id);
    render(<QuestionBank {...baseProps({ questions })} />);
    fireEvent.change(screen.getByLabelText('Sort questions'), { target: { value: 'id' } });
    expect(questions.map((q) => q.id)).toEqual(originalOrder);
  });
});

describe('QuestionBank — generation', () => {
  it('Generate questions opens the generation dialog', () => {
    render(<QuestionBank {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a successful generation switches to the Review Queue tab', async () => {
    const questions = [makeQuestion({ id: 'a', status: 'active' })];
    const onGenerate = vi.fn().mockResolvedValue(2);
    render(<QuestionBank {...baseProps({ questions, onGenerate })} />);
    expect(tab('Active').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }));
    fireEvent.click(screen.getByRole('button', { name: /generate scenarios/i }));
    await within(screen.getByRole('tabpanel')).findByText(/added to the Review Queue/i);
    expect(tab('Review Queue').getAttribute('aria-selected')).toBe('true');
  });
});

describe('QuestionBank — draft/active/archived actions', () => {
  it('activating a draft calls onActivate with the correct id', () => {
    const onActivate = vi.fn();
    const questions = [makeQuestion({ id: 'd1', status: 'draft' })];
    render(<QuestionBank {...baseProps({ questions, onActivate })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(onActivate).toHaveBeenCalledWith('d1');
  });

  it('restoring an archived question calls onActivate with the correct id', () => {
    const onActivate = vi.fn();
    const questions = [makeQuestion({ id: 'z1', status: 'archived' })];
    render(<QuestionBank {...baseProps({ questions, onActivate })} />);
    fireEvent.click(tab('Archived'));
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onActivate).toHaveBeenCalledWith('z1');
  });

  it('archiving an active question calls onArchive with the correct id', () => {
    const onArchive = vi.fn();
    const questions = [makeQuestion({ id: 'x1', status: 'active' })];
    render(<QuestionBank {...baseProps({ questions, onArchive })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onArchive).toHaveBeenCalledWith('x1');
  });

  it('discarding a draft calls onDelete with the correct id', () => {
    const onDelete = vi.fn();
    const questions = [makeQuestion({ id: 'd2', status: 'draft' })];
    render(<QuestionBank {...baseProps({ questions, onDelete })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDelete).toHaveBeenCalledWith('d2');
  });

  it('deleting an archived question calls onDelete with the correct id', () => {
    const onDelete = vi.fn();
    const questions = [makeQuestion({ id: 'z2', status: 'archived' })];
    render(<QuestionBank {...baseProps({ questions, onDelete })} />);
    fireEvent.click(tab('Archived'));
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('z2');
  });

  it('blocks activation/restore of content flagged with a blocking guard', () => {
    const questions = [makeQuestion({
      id: 'blocked1',
      status: 'draft',
      scenario: 'Verify DOB first before doing anything for the refill.',
    })];
    render(<QuestionBank {...baseProps({ questions })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
    expect(screen.getByText(/Blocked:/)).toBeInTheDocument();
  });
});

describe('QuestionBank — editing', () => {
  it('Edit opens the editor for the correct question', () => {
    const questions = [makeQuestion({ id: 'a', scenario: 'Scenario for question A' }), makeQuestion({ id: 'b', scenario: 'Scenario for question B' })];
    render(<QuestionBank {...baseProps({ questions })} />);
    const rows = screen.getAllByRole('button', { expanded: false });
    fireEvent.click(rows[1]); // expand question B
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByDisplayValue('Scenario for question B')).toBeInTheDocument();
  });
});

describe('QuestionBank — empty states', () => {
  it('shows a Clear filters action when filters return nothing', () => {
    const questions = [makeQuestion({ id: 'a' })];
    render(<QuestionBank {...baseProps({ questions })} />);
    fireEvent.change(screen.getByLabelText('Search questions'), { target: { value: 'nonexistent-term' } });
    expect(screen.getByText('No questions match these filters.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThan(0);
  });

  it('shows a department-empty message when there are no questions at all', () => {
    render(<QuestionBank {...baseProps({ questions: [] })} />);
    expect(screen.getByText(/No questions yet for this department/)).toBeInTheDocument();
  });
});

describe('QuestionBank — accessibility', () => {
  it('exposes tablist/tab/tabpanel and accordion aria attributes', () => {
    const questions = [makeQuestion({ id: 'a' })];
    render(<QuestionBank {...baseProps({ questions })} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const activeTab = tab('Active');
    expect(activeTab).toHaveAttribute('aria-selected');
    expect(activeTab).toHaveAttribute('aria-controls');
    const row = screen.getByRole('button', { expanded: false });
    expect(row).toHaveAttribute('aria-controls');
    fireEvent.click(row);
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { expanded: true })).toHaveAttribute('aria-controls');
  });
});
