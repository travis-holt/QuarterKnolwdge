// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Check, { questionSetVersion } from './Check.jsx';

const question = (id, domainId = 'scheduling') => ({
  id,
  domainId,
  scenario: `Scenario ${id}`,
  correctOptionId: 'a',
  options: [
    { id: 'a', text: 'Best action', points: 100 },
    { id: 'b', text: 'Wrong action', points: 0 },
  ],
});

beforeEach(() => sessionStorage.clear());

describe('Check reliability', () => {
  it('renders a safe empty state instead of dereferencing a missing question', () => {
    render(<Check questions={[]} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'No questions available' })).toBeInTheDocument();
  });

  it('submits exactly the displayed mini-check subset to the scorer', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const bank = [
      question('s1'),
      question('s2'),
      question('s3'),
      question('s4'),
      question('s5'),
      question('r1', 'routing'),
    ];
    render(
      <Check
        questions={bank}
        miniDomain="scheduling"
        limit={4}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('radio', { name: 'Best action' }));
      fireEvent.click(screen.getByRole('button', { name: i === 3 ? /Submit/ : 'Next' }));
    }

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][2].map((q) => q.id)).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('guards an in-flight submission against duplicate clicks', async () => {
    let finish;
    const onSubmit = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    render(<Check questions={[question('q1')]} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Best action' }));
    const submit = screen.getByRole('button', { name: /Submit/ });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: /Submit/ })).not.toBeDisabled());
  });

  it('versions persisted progress to scored question content', () => {
    const original = [question('q1')];
    const edited = [{ ...question('q1'), options: [
      { id: 'a', text: 'Changed answer', points: 100 },
      { id: 'b', text: 'Wrong action', points: 0 },
    ] }];
    expect(questionSetVersion(original)).not.toBe(questionSetVersion(edited));
  });

  it('restarts a mounted attempt when the scored bank changes', async () => {
    const original = [question('q1')];
    const edited = [{ ...question('q1'), options: [
      { id: 'a', text: 'Changed best action', points: 100 },
      { id: 'b', text: 'Wrong action', points: 0 },
    ] }];
    const { rerender } = render(<Check questions={original} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Best action' }));
    expect(screen.getByRole('button', { name: /Submit/ })).not.toBeDisabled();

    rerender(<Check questions={edited} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByText(/question bank changed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit/ })).toBeDisabled();
  });
});
