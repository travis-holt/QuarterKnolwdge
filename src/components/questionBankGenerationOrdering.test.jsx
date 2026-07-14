// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// QUESTION BANK — generation request-ordering guard (2026-07-14, 4th pass).
//
// The real QuestionBankGenerateDialog structurally serializes generation
// requests (the "Generate scenarios" button disables itself while pending,
// and dismissal is suppressed while generating) — by design, a second
// request normally can't start until the first has settled. That's a good
// property, but it means the underlying guard in QuestionBank.jsx (each
// request gets its own IMMUTABLE { dept, seq } tag, threaded through the
// whole round-trip rather than read back out of a mutable "latest" ref)
// can't be exercised through ordinary simulated clicks on the real dialog.
//
// This file mocks QuestionBankGenerateDialog with a minimal, non-serializing
// stand-in that can fire onGenerate as many times as the test wants, so the
// actual guarantee — an out-of-order-resolving OLDER request can never
// override a NEWER one's tab/banner — is tested directly and honestly,
// independent of the dialog's own (separately-tested) UI restrictions.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('./QuestionBankGenerateDialog.jsx', () => ({
  default: function MockGenerateDialog({ onGenerate, onGenerated }) {
    const trigger = async () => {
      const { n, tag } = await onGenerate({ domainId: 'intake', count: 1 });
      onGenerated(`${n} draft scenario${n === 1 ? '' : 's'} added to the Review Queue.`, tag);
    };
    return (
      <div data-testid="mock-dialog">
        <button type="button" onClick={trigger}>trigger-generate</button>
      </div>
    );
  },
}));

import QuestionBank from './QuestionBank.jsx';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
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
    onGenerate: vi.fn(),
    onSaveFeedback: vi.fn(),
    onSaveProposal: vi.fn(),
    ...overrides,
  };
}

describe('QuestionBank — generation request-ordering guard (immutable per-request tags)', () => {
  it('an older request (A) resolving AFTER a newer request (B) does not override B\'s accepted completion', async () => {
    const a = deferred();
    const b = deferred();
    const onGenerate = vi.fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);

    render(<QuestionBank {...baseProps({ onGenerate })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }));

    const trigger = await screen.findByText('trigger-generate');
    fireEvent.click(trigger); // request A starts (seq 1)
    fireEvent.click(trigger); // request B starts (seq 2) — supersedes A
    expect(onGenerate).toHaveBeenCalledTimes(2);

    // B resolves FIRST and becomes the accepted completion.
    b.resolve(5);
    await waitFor(() => expect(screen.getByText(/5 draft scenarios added/i)).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /review queue/i })).toHaveAttribute('aria-selected', 'true');

    // A resolves LAST (stale) — must be silently dropped, not shown, not reapplied.
    a.resolve(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/1 draft scenario added/i)).not.toBeInTheDocument();
    expect(screen.getByText(/5 draft scenarios added/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /review queue/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('a stale completion from a different department (captured via the tag, not a mutable ref) is dropped', async () => {
    const a = deferred();
    const onGenerate = vi.fn().mockReturnValue(a.promise);

    const { rerender } = render(<QuestionBank {...baseProps({ selectedDept: 'pediatrics', onGenerate })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }));
    const trigger = await screen.findByText('trigger-generate');
    fireEvent.click(trigger); // request tagged { dept: 'pediatrics', seq: 1 }

    rerender(<QuestionBank {...baseProps({ selectedDept: 'obgyn', onGenerate })} />);
    expect(screen.getByRole('tab', { name: /^active/i })).toHaveAttribute('aria-selected', 'true');

    a.resolve(2);
    await new Promise((r) => setTimeout(r, 0));
    // Still on OB/GYN's own default tab — the pediatrics-tagged completion never applied.
    expect(screen.getByRole('tab', { name: /^active/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText(/added to the Review Queue/i)).not.toBeInTheDocument();
  });
});
