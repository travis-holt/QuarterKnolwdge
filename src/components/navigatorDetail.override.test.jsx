// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// NavigatorDetail — supervisor grade-override behaviour (F15 supervisor override).
// db writes are mocked; no real Firebase calls. Focuses on the Practice sessions
// panel: displaying AI vs override score, opening the form, validation, and payload.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import NavigatorDetail from './NavigatorDetail.jsx';
import { buildMatrixRows } from '../lib/scoring.js';

const dbMocks = vi.hoisted(() => ({
  getInterviews: vi.fn(),
  getResultHistory: vi.fn(),
  updateInterviewGradeOverride: vi.fn(),
}));

vi.mock('../lib/db.js', () => dbMocks);

const rows = buildMatrixRows([
  {
    name: 'Alex Rivera',
    scores: { intake: 70, classification: 65, routing: 55, scheduling: 80, boundaries: 60, documentation: 75 },
  },
]);

function baseSession(extra = {}) {
  return {
    id: 'iv1',
    navigatorId: 'nav-1',
    domainId: 'intake',
    callerName: 'Jordan',
    scenario: 'A parent calls about a refill.',
    endedAt: { seconds: 1000 },
    transcript: [
      { role: 'patient', text: 'Hi, I need help.' },
      { role: 'navigator', text: 'Sure, let me verify your details.' },
    ],
    grade: { score: 72, summary: 'Solid call.', strengths: ['Polite'], improvements: ['Verify sooner'] },
    ...extra,
  };
}

function renderDetail(session) {
  dbMocks.getInterviews.mockResolvedValue([session]);
  dbMocks.getResultHistory.mockResolvedValue([]);
  return render(
    <NavigatorDetail rows={rows} name="Alex Rivera" deptName="Pediatrics" dept="pediatrics" navigatorId="nav-1" />
  );
}

beforeEach(() => vi.clearAllMocks());

describe('NavigatorDetail — supervisor grade override', () => {
  it('shows the AI score when there is no override', async () => {
    renderDetail(baseSession());
    // Open the session to reveal the grade panel.
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('Override score')).toBeInTheDocument();
    expect(screen.getByText(/Score:/).textContent).toContain('72/100');
    expect(screen.queryByText('Supervisor override')).not.toBeInTheDocument();
  });

  it('shows the override score and the original AI score when an override exists', async () => {
    renderDetail(baseSession({ gradeOverride: { score: 88, reason: 'Missed by grader', overriddenBy: 'supervisor' } }));
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('Supervisor override')).toBeInTheDocument();
    expect(screen.getByText('Original AI score: 72/100')).toBeInTheDocument();
    expect(screen.getByText(/Score:/).textContent).toContain('88/100');
    expect(screen.getByText(/Reason:/).textContent).toContain('Missed by grader');
  });

  it('opens the inline form when "Override score" is clicked', async () => {
    renderDetail(baseSession());
    fireEvent.click(await screen.findByText('Jordan'));
    fireEvent.click(await screen.findByText('Override score'));
    expect(screen.getByLabelText('Override score')).toBeInTheDocument();
    expect(screen.getByLabelText('Override reason')).toBeInTheDocument();
  });

  it('rejects an out-of-range score', async () => {
    renderDetail(baseSession());
    fireEvent.click(await screen.findByText('Jordan'));
    fireEvent.click(await screen.findByText('Override score'));
    fireEvent.change(screen.getByLabelText('Override score'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/between 0 and 100/)).toBeInTheDocument();
    expect(dbMocks.updateInterviewGradeOverride).not.toHaveBeenCalled();
  });

  it('rejects a missing reason', async () => {
    renderDetail(baseSession());
    fireEvent.click(await screen.findByText('Jordan'));
    fireEvent.click(await screen.findByText('Override score'));
    fireEvent.change(screen.getByLabelText('Override score'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/reason is required/)).toBeInTheDocument();
    expect(dbMocks.updateInterviewGradeOverride).not.toHaveBeenCalled();
  });

  it('saves a valid override with the expected payload and reflects it immediately', async () => {
    dbMocks.updateInterviewGradeOverride.mockResolvedValue();
    renderDetail(baseSession());
    fireEvent.click(await screen.findByText('Jordan'));
    fireEvent.click(await screen.findByText('Override score'));
    fireEvent.change(screen.getByLabelText('Override score'), { target: { value: '85' } });
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'Grader missed the verification' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(dbMocks.updateInterviewGradeOverride).toHaveBeenCalledWith('iv1', {
        score: 85,
        reason: 'Grader missed the verification',
      })
    );
    expect(await screen.findByText('Supervisor override')).toBeInTheDocument();
    expect(screen.getByText('Original AI score: 72/100')).toBeInTheDocument();
  });
});
