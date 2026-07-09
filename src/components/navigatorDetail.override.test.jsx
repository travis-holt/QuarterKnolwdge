// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// NavigatorDetail — supervisor session review behaviour.
// db writes are mocked; no real Firebase calls. Covers both the existing
// practice-score override and the Call QA final-review panel.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import NavigatorDetail from './NavigatorDetail.jsx';
import { buildMatrixRows } from '../lib/scoring.js';

const dbMocks = vi.hoisted(() => ({
  getInterviews: vi.fn(),
  getResultHistory: vi.fn(),
  updateInterviewGradeOverride: vi.fn(),
  updateQaFinalReview: vi.fn(),
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

function qaSession(extra = {}) {
  return baseSession({
    id: 'qa-1',
    qa: {
      pass: true,
      score: 92,
      passThreshold: 85,
      review: { recommendation: 'pass', confidence: 'high', safetyRisk: 'none', reviewFlags: [] },
    },
    ...extra,
  });
}

function renderDetail(sessionOrSessions) {
  const sessions = Array.isArray(sessionOrSessions) ? sessionOrSessions : [sessionOrSessions];
  dbMocks.getInterviews.mockResolvedValue(sessions);
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

  it('QA session shows pending final review', async () => {
    renderDetail(qaSession());
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('AI verdict:')).toBeInTheDocument();
    expect(screen.getByText('PASS')).toBeInTheDocument();
    expect(screen.getByText('Final verdict:')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders QA-only domain signal when QA domain scores exist', async () => {
    renderDetail(qaSession({
      qa: {
        pass: true,
        score: 92,
        passThreshold: 85,
        review: { recommendation: 'pass', confidence: 'high', safetyRisk: 'none', reviewFlags: [] },
        domainScores: {
          intake: { score: 92 },
          classification: { score: 80 },
          routing: { score: 70 },
          scheduling: null,
          boundaries: { score: 100 },
          documentation: { score: 85 },
        },
      },
    }));
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('QA-only domain signal')).toBeInTheDocument();
    expect(screen.getByText(/Call Opening & Identification:/).closest('li')?.textContent).toContain('92');
    expect(screen.getByText(/Scheduling & Appointment Rules:/).closest('li')?.textContent).toContain('—');
  });

  it('does not render QA-only domain signal when missing', async () => {
    renderDetail(qaSession());
    fireEvent.click(await screen.findByText('Jordan'));
    expect(screen.queryByText('QA-only domain signal')).not.toBeInTheDocument();
  });

  it('Confirm Pass calls updateQaFinalReview with confirmed_pass', async () => {
    dbMocks.updateQaFinalReview.mockResolvedValue();
    renderDetail(qaSession());
    fireEvent.click(await screen.findByText('Jordan'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Pass' }));
    await waitFor(() =>
      expect(dbMocks.updateQaFinalReview).toHaveBeenCalledWith('qa-1', {
        status: 'confirmed_pass',
        reason: '',
      })
    );
    expect(await screen.findByText('FINAL PASS')).toBeInTheDocument();
  });

  it('Override to Pass requires a reason', async () => {
    renderDetail(qaSession());
    fireEvent.click(await screen.findByText('Jordan'));
    fireEvent.click(screen.getByRole('button', { name: 'Override to Pass' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save final review' }));
    expect(await screen.findByText(/reason is required for overrides/i)).toBeInTheDocument();
    expect(dbMocks.updateQaFinalReview).not.toHaveBeenCalled();
  });

  it('Override to Fail calls updateQaFinalReview with overridden_fail and reason', async () => {
    dbMocks.updateQaFinalReview.mockResolvedValue();
    renderDetail(qaSession());
    fireEvent.click(await screen.findByText('Jordan'));
    fireEvent.click(screen.getByRole('button', { name: 'Override to Fail' }));
    fireEvent.change(screen.getByLabelText('QA final review reason'), {
      target: { value: 'Caller was not safely verified before details were discussed.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save final review' }));
    await waitFor(() =>
      expect(dbMocks.updateQaFinalReview).toHaveBeenCalledWith('qa-1', {
        status: 'overridden_fail',
        reason: 'Caller was not safely verified before details were discussed.',
      })
    );
    expect(await screen.findByText('OVERRIDDEN FAIL')).toBeInTheDocument();
  });

  it('saved final review appears in the session panel', async () => {
    renderDetail(qaSession({
      qaFinalReview: {
        status: 'confirmed_fail',
        finalPass: false,
        reason: '',
        reviewedBy: 'supervisor',
        reviewedAt: { seconds: 1000 },
      },
    }));
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('FINAL FAIL')).toBeInTheDocument();
    expect(screen.getByText(/Reviewed by supervisor on/)).toBeInTheDocument();
    expect(screen.getByText('Edit final review')).toBeInTheDocument();
  });

  it('Practice gradeOverride still renders independently', async () => {
    renderDetail([
      qaSession(),
      baseSession({
        id: 'practice-1',
        callerName: 'Casey',
        gradeOverride: { score: 88, reason: 'Missed by grader', overriddenBy: 'supervisor' },
      }),
    ]);
    fireEvent.click(await screen.findByText('Casey'));
    expect(await screen.findByText('Supervisor override')).toBeInTheDocument();
    expect(screen.getByText('Original AI score: 72/100')).toBeInTheDocument();
    expect(screen.queryByText('Edit final review')).not.toBeInTheDocument();
  });
});
