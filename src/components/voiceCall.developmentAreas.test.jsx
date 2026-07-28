// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QaDevelopmentAreas } from './QaDevelopmentAreas.jsx';

const criteria = [
  { id: 'verify-three', verdict: 'NOT_MET', categoryId: 'verification', categoryName: 'Verification', points: 6, text: 'Collect first name, last name, and date of birth.', note: 'Ask for and receive all three identifiers before discussing the chart.' },
  { id: 'verify-before-access', verdict: 'NOT_MET', categoryId: 'verification', categoryName: 'Verification', points: 4, text: 'Verify before protected disclosure.', note: 'Complete verification before sharing chart details.' },
  { id: 'know-rule', verdict: 'NOT_MET', categoryId: 'knowledge', categoryName: 'Knowledge', points: 6, text: 'Use the transfer-review workflow.', note: '' },
  { id: 'close-offer-help', verdict: 'MET', categoryId: 'closing', categoryName: 'Closing', points: 5, text: 'Offer further help.', note: '' },
];

describe('QaDevelopmentAreas', () => {
  it('uses coaching-forward language and groups deductions without mutating score data', () => {
    const before = JSON.stringify(criteria);
    render(<QaDevelopmentAreas criteria={criteria} />);

    expect(screen.getByRole('heading', { name: 'Areas to develop' })).toBeTruthy();
    expect(screen.queryByText('Points you lost')).toBeNull();
    expect(screen.getByText('2 areas · 16 points to recover')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Verification' })).toBeTruthy();
    expect(screen.getByText('−10 pts')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Knowledge' })).toBeTruthy();
    expect(JSON.stringify(criteria)).toBe(before);
  });

  it('makes the coaching note primary and preserves formal rubric detail behind an accessible disclosure', () => {
    render(<QaDevelopmentAreas criteria={criteria} />);
    expect(screen.getAllByText('What to improve')).toHaveLength(3);
    expect(screen.getByText(/Ask for and receive all three identifiers/i)).toBeTruthy();
    const details = screen.getAllByText('Rubric detail');
    expect(details).toHaveLength(2);
    fireEvent.click(details[0]);
    expect(screen.getByText('Collect first name, last name, and date of birth.')).toBeTruthy();
  });

  it('uses rubric text as useful feedback when no coaching note exists and omits itself with no misses', () => {
    const { rerender } = render(<QaDevelopmentAreas criteria={criteria} />);
    expect(screen.getByText('Use the transfer-review workflow.')).toBeTruthy();
    rerender(<QaDevelopmentAreas criteria={criteria.map((criterion) => ({ ...criterion, verdict: 'MET' }))} />);
    expect(screen.queryByRole('heading', { name: 'Areas to develop' })).toBeNull();
  });
});
