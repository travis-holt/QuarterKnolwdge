// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// QUESTION BANK — the redesigned collapsible review workspace (2026-07-13).
// Behavior/accessible-output focused; no snapshots.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

import QuestionBank from './QuestionBank.jsx';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

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

describe('QuestionBank — async-load-aware initial tab resolution', () => {
  it('waits past an initial empty snapshot: rerendering with an active question + a draft selects Review Queue', () => {
    const { rerender } = render(<QuestionBank {...baseProps({ questions: [] })} />);
    // Nothing has loaded yet — the best available guess is Active.
    expect(tab('Active').getAttribute('aria-selected')).toBe('true');

    const questions = [makeQuestion({ id: 'a', status: 'active' }), makeQuestion({ id: 'd', status: 'draft' })];
    rerender(<QuestionBank {...baseProps({ questions })} />);

    expect(tab('Review Queue').getAttribute('aria-selected')).toBe('true');
  });

  it('waits past an initial empty snapshot: rerendering with active-only questions selects Active', () => {
    const { rerender } = render(<QuestionBank {...baseProps({ questions: [] })} />);
    expect(tab('Active').getAttribute('aria-selected')).toBe('true');

    const questions = [makeQuestion({ id: 'a', status: 'active' }), makeQuestion({ id: 'b', status: 'active' })];
    rerender(<QuestionBank {...baseProps({ questions })} />);

    expect(tab('Active').getAttribute('aria-selected')).toBe('true');
  });

  it('does not override a manual tab selection when more questions load in later', () => {
    const questions = [makeQuestion({ id: 'a', status: 'active' }), makeQuestion({ id: 'd', status: 'draft' })];
    const { rerender } = render(<QuestionBank {...baseProps({ questions })} />);
    // Auto-default picked Review Queue because a draft exists.
    expect(tab('Review Queue').getAttribute('aria-selected')).toBe('true');

    // Supervisor manually switches to Active.
    fireEvent.click(tab('Active'));
    expect(tab('Active').getAttribute('aria-selected')).toBe('true');

    // More questions arrive (another draft loads in) — must NOT snap back to Review Queue.
    const moreQuestions = [...questions, makeQuestion({ id: 'd2', status: 'draft' })];
    rerender(<QuestionBank {...baseProps({ questions: moreQuestions })} />);
    expect(tab('Active').getAttribute('aria-selected')).toBe('true');
  });

  it('re-resolves the default tab after switching departments, even if the previous department resolved to Active', () => {
    const pedsActive = [makeQuestion({ id: 'p1', status: 'active', department: 'pediatrics' })];
    const { rerender } = render(<QuestionBank {...baseProps({ questions: pedsActive, selectedDept: 'pediatrics' })} />);
    expect(tab('Active').getAttribute('aria-selected')).toBe('true');

    // Switch to obgyn, whose first available snapshot already contains a draft.
    const withObgynDraft = [...pedsActive, makeQuestion({ id: 'o1', status: 'draft', department: 'obgyn' })];
    rerender(<QuestionBank {...baseProps({ questions: withObgynDraft, selectedDept: 'obgyn' })} />);

    expect(tab('Review Queue').getAttribute('aria-selected')).toBe('true');
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

  it('implements roving-tabindex keyboard navigation (arrows/Home/End) across the tablist', () => {
    const questions = [makeQuestion({ id: 'a', status: 'active' }), makeQuestion({ id: 'd', status: 'draft' })];
    render(<QuestionBank {...baseProps({ questions })} />);
    // Drafts exist -> Review Queue is selected/focusable; others are -1.
    expect(tab('Review Queue')).toHaveAttribute('tabindex', '0');
    expect(tab('Active')).toHaveAttribute('tabindex', '-1');
    expect(tab('Archived')).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(tab('Review Queue'), { key: 'ArrowRight' });
    expect(tab('Active').getAttribute('aria-selected')).toBe('true');
    expect(tab('Active')).toHaveAttribute('tabindex', '0');
    expect(tab('Review Queue')).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(tab('Active'));

    fireEvent.keyDown(tab('Active'), { key: 'ArrowRight' });
    expect(tab('Archived').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Archived'));

    // Wraps around from the last tab back to the first.
    fireEvent.keyDown(tab('Archived'), { key: 'ArrowRight' });
    expect(tab('Review Queue').getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(tab('Review Queue'), { key: 'ArrowLeft' });
    expect(tab('Archived').getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(tab('Archived'), { key: 'Home' });
    expect(tab('Review Queue').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Review Queue'));

    fireEvent.keyDown(tab('Review Queue'), { key: 'End' });
    expect(tab('Archived').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Archived'));
  });
});

describe('QuestionBank — failure-safe persistence actions', () => {
  it('activation failure keeps the question expanded, shows an accessible error, and does not auto-advance', async () => {
    const { promise, reject } = deferred();
    const onActivate = vi.fn().mockReturnValue(promise);
    const questions = [makeQuestion({ id: 'd1', status: 'draft' }), makeQuestion({ id: 'd2', status: 'draft' })];
    render(<QuestionBank {...baseProps({ questions, onActivate })} />);
    const rows = screen.getAllByRole('button', { expanded: false });
    fireEvent.click(rows[0]); // expand d1
    const activateBtn = screen.getByRole('button', { name: 'Activate' });
    fireEvent.click(activateBtn);
    expect(activateBtn).toBeDisabled();

    reject(new Error('network down'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('network down');
    // Still expanded on the SAME question (d1) — no auto-advance to d2.
    expect(screen.getByRole('button', { expanded: true })).toHaveAttribute('id', 'qbank-head-d1');
  });

  it('duplicate clicks on Activate while pending do not trigger duplicate writes', async () => {
    const { promise, resolve } = deferred();
    const onActivate = vi.fn().mockReturnValue(promise);
    const questions = [makeQuestion({ id: 'd1', status: 'draft' })];
    render(<QuestionBank {...baseProps({ questions, onActivate })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const activateBtn = screen.getByRole('button', { name: 'Activate' });
    fireEvent.click(activateBtn);
    fireEvent.click(activateBtn);
    fireEvent.click(activateBtn);
    resolve();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('a successful activation still auto-advances to the next remaining draft once the list updates', async () => {
    const onActivate = vi.fn().mockResolvedValue(undefined);
    const questions = [makeQuestion({ id: 'd1', status: 'draft' }), makeQuestion({ id: 'd2', status: 'draft' })];
    const { rerender } = render(<QuestionBank {...baseProps({ questions, onActivate })} />);
    const rows = screen.getAllByRole('button', { expanded: false });
    fireEvent.click(rows[0]); // expand d1
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(onActivate).toHaveBeenCalledWith('d1'));

    // Simulate the real Firestore round-trip: d1 is now active, d2 still a draft.
    const updated = [makeQuestion({ id: 'd1', status: 'active' }), makeQuestion({ id: 'd2', status: 'draft' })];
    rerender(<QuestionBank {...baseProps({ questions: updated, onActivate })} />);
    expect(screen.getByRole('button', { expanded: true })).toHaveAttribute('id', 'qbank-head-d2');
  });

  it('archive failure shows a pending state then an accessible error (equivalent handling)', async () => {
    const { promise, reject } = deferred();
    const onArchive = vi.fn().mockReturnValue(promise);
    const questions = [makeQuestion({ id: 'x1', status: 'active' })];
    render(<QuestionBank {...baseProps({ questions, onArchive })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const archiveBtn = screen.getByRole('button', { name: 'Archive' });
    fireEvent.click(archiveBtn);
    expect(archiveBtn).toBeDisabled();
    reject(new Error('archive failed'));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('archive failed');
  });

  it('restore (archived tab) failure shows a pending state then an accessible error (equivalent handling)', async () => {
    const { promise, reject } = deferred();
    const onActivate = vi.fn().mockReturnValue(promise);
    const questions = [makeQuestion({ id: 'z1', status: 'archived' })];
    render(<QuestionBank {...baseProps({ questions, onActivate })} />);
    fireEvent.click(tab('Archived'));
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const restoreBtn = screen.getByRole('button', { name: 'Restore' });
    fireEvent.click(restoreBtn);
    expect(restoreBtn).toBeDisabled();
    reject(new Error('restore failed'));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('restore failed');
  });

  it('archived delete failure shows a pending state then an accessible error (equivalent handling)', async () => {
    const { promise, reject } = deferred();
    const onDelete = vi.fn().mockReturnValue(promise);
    const questions = [makeQuestion({ id: 'z2', status: 'archived' })];
    render(<QuestionBank {...baseProps({ questions, onDelete })} />);
    fireEvent.click(tab('Archived'));
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(deleteBtn);
    expect(deleteBtn).toBeDisabled();
    reject(new Error('delete failed'));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('delete failed');
  });
});

describe('QuestionBank — generation stale-completion guard', () => {
  it('ignores a Pediatrics generation completion after the supervisor switches to OB/GYN', async () => {
    const { promise, resolve } = deferred();
    const onGenerate = vi.fn().mockReturnValue(promise);
    const { rerender } = render(<QuestionBank {...baseProps({ questions: [], selectedDept: 'pediatrics', onGenerate })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }));
    fireEvent.click(screen.getByRole('button', { name: /generate scenarios/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);

    // Supervisor switches to OB/GYN while the Pediatrics request is still in flight.
    rerender(<QuestionBank {...baseProps({ questions: [], selectedDept: 'obgyn', onGenerate })} />);
    expect(tab('Active').getAttribute('aria-selected')).toBe('true'); // obgyn's own (empty) default

    resolve(3); // the STALE pediatrics generation now completes
    // The (still-mounted) dialog shows its own transient completion text...
    await within(screen.getByRole('dialog')).findByText(/added to the Review Queue/i);
    // ...but the current department's (OB/GYN's) tab/messaging must be unaffected.
    expect(tab('Active').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent(/added to the Review Queue/i);
  });
});

describe('QuestionBank — department-scoped transient messages', () => {
  it('does not leak a Pediatrics generation success message into OB/GYN', async () => {
    const onGenerate = vi.fn().mockResolvedValue(2);
    const pedsQuestions = [makeQuestion({ id: 'p-active', status: 'active', department: 'pediatrics' })];
    const { rerender } = render(<QuestionBank {...baseProps({ questions: pedsQuestions, selectedDept: 'pediatrics', onGenerate })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }));
    fireEvent.click(screen.getByRole('button', { name: /generate scenarios/i }));
    await within(screen.getByRole('tabpanel')).findByText(/added to the Review Queue/i);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    // Switch to OB/GYN, which has its own draft (so its Review Queue is reachable).
    const obgynQuestions = [...pedsQuestions, makeQuestion({ id: 'o-draft', status: 'draft', department: 'obgyn' })];
    rerender(<QuestionBank {...baseProps({ questions: obgynQuestions, selectedDept: 'obgyn', onGenerate })} />);
    expect(tab('Review Queue').getAttribute('aria-selected')).toBe('true'); // obgyn auto-resolves (has a draft)
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent(/added to the Review Queue/i);
  });

  it('does not leak a Learning Loop queue message between departments', async () => {
    const onSaveProposal = vi.fn().mockResolvedValue(undefined);
    const q = makeQuestion({ id: 'flagged-1', status: 'active', department: 'pediatrics' });
    // 10 wrong answers -> correctRate 0 -> health status 'review' -> "Queue revision" renders.
    const results = Array.from({ length: 10 }, () => ({ answers: { [q.id]: 'b' }, scores: {} }));
    const { rerender } = render(<QuestionBank {...baseProps({ questions: [q], results, selectedDept: 'pediatrics', onSaveProposal })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Queue revision' }));
    await screen.findByText('Question revision queued in Learning Loop.');

    rerender(<QuestionBank {...baseProps({ questions: [q], results, selectedDept: 'obgyn', onSaveProposal })} />);
    expect(screen.queryByText('Question revision queued in Learning Loop.')).not.toBeInTheDocument();
  });
});

describe('QuestionBank — Edit disabled during a pending action', () => {
  it('disables Edit while Activate is pending (the row must not switch into QuestionEditor mid-write)', async () => {
    const { promise, reject } = deferred();
    const onActivate = vi.fn().mockReturnValue(promise);
    const questions = [makeQuestion({ id: 'd1', status: 'draft' })];
    render(<QuestionBank {...baseProps({ questions, onActivate })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    const editBtn = screen.getByRole('button', { name: 'Edit' });
    expect(editBtn).toBeDisabled();
    fireEvent.click(editBtn); // clicking a disabled button must not open the editor
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    reject(new Error('failed'));
    await screen.findByRole('alert');
    // Once the write settles (here: fails, so the row stays put), Edit is enabled again.
    expect(screen.getByRole('button', { name: 'Edit' })).not.toBeDisabled();
  });

  it('disables Edit while Archive is pending', () => {
    const { promise } = deferred();
    const onArchive = vi.fn().mockReturnValue(promise);
    const questions = [makeQuestion({ id: 'x1', status: 'active' })];
    render(<QuestionBank {...baseProps({ questions, onArchive })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
  });
});

describe('QuestionBank — empty-department tab state', () => {
  it('resets to Active immediately when switching to a department with no questions, even if the previous department had resolved to Review Queue', () => {
    const pedsWithDraft = [makeQuestion({ id: 'p1', status: 'draft', department: 'pediatrics' })];
    const { rerender } = render(<QuestionBank {...baseProps({ questions: pedsWithDraft, selectedDept: 'pediatrics' })} />);
    expect(tab('Review Queue').getAttribute('aria-selected')).toBe('true');

    // OB/GYN has zero questions in this data set.
    rerender(<QuestionBank {...baseProps({ questions: pedsWithDraft, selectedDept: 'obgyn' })} />);
    expect(tab('Active').getAttribute('aria-selected')).toBe('true');
  });
});

describe('QuestionBank — edit-save error placement', () => {
  it('renders the edit-save error beside the active editor with an accessible alert', async () => {
    const onSaveEdit = vi.fn().mockRejectedValue(new Error('save failed'));
    const questions = [makeQuestion({ id: 'a', scenario: 'Scenario A' })];
    render(<QuestionBank {...baseProps({ questions, onSaveEdit })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save question' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('save failed');
    // The error sits inside the SAME editing <li> as the editor, not after the whole list.
    expect(alert.closest('li.is-editing')).not.toBeNull();
    expect(screen.getByDisplayValue('Scenario A')).toBeInTheDocument(); // editor still open
  });
});
