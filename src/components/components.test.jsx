// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT TESTS — pure-render and key stateful components.
// Uses @testing-library/react.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import EmptyState from './EmptyState.jsx';
import Footer     from './Footer.jsx';
import Nav        from './Nav.jsx';

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
    expect(screen.getByText(/Cruciby/)).toBeInTheDocument();
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
