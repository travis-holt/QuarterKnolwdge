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

// AI FAIL: a confident sub-threshold verdict.
function qaFailSession(extra = {}) {
  return qaSession({
    qa: {
      pass: false,
      score: 40,
      passThreshold: 85,
      review: { recommendation: 'fail', confidence: 'high', safetyRisk: 'high', reviewFlags: [] },
    },
    ...extra,
  });
}

// AI NEEDS REVIEW: borderline / low-confidence — supervisor must decide (override-only).
function qaNeedsReviewSession(extra = {}) {
  return qaSession({
    qa: {
      pass: false,
      score: 84,
      passThreshold: 85,
      review: { recommendation: 'needs_review', confidence: 'low', safetyRisk: 'medium', reviewFlags: ['borderline-score'] },
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

  it('labels an auto-failed domain in the QA-only domain signal', async () => {
    renderDetail(qaSession({
      qa: {
        pass: false,
        score: 0,
        passThreshold: 85,
        review: { recommendation: 'fail', confidence: 'high', safetyRisk: 'high', reviewFlags: [] },
        domainScores: {
          intake: { score: 92 },
          boundaries: { score: 0, earned: 0, possible: 6, criteria: ['verify-three'], autoFailed: true, autoFails: [{ id: 'af-scope', text: 'Read lab/imaging results...' }] },
        },
      },
    }));
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('QA-only domain signal')).toBeInTheDocument();
    const boundariesLi = screen.getByText(/Scope & Privacy:/).closest('li');
    expect(boundariesLi?.textContent).toContain('Auto-fail');
    expect(boundariesLi?.textContent).not.toMatch(/92/); // affected tag never reads as a clean high score
  });

  it('does not render QA-only domain signal when missing', async () => {
    renderDetail(qaSession());
    fireEvent.click(await screen.findByText('Jordan'));
    expect(screen.queryByText('QA-only domain signal')).not.toBeInTheDocument();
  });

  it('shows fairness repair evidence to the supervisor', async () => {
    renderDetail(qaSession({ qa: {
      pass: true, score: 92, passThreshold: 85,
      review: { recommendation: 'pass', confidence: 'high', safetyRisk: 'none', reviewFlags: [] },
      repairs: [{ criterionId: 'doc-te', rule: 'natural-message-routing-wording', reason: 'Accepted natural wording.', evidence: 'I will send this request to the refill team.' }],
    } }));
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('Fairness guardrails applied')).toBeInTheDocument();
    expect(screen.getByText(/Accepted natural wording/)).toBeInTheDocument();
    expect(screen.getByText(/send this request to the refill team/)).toBeInTheDocument();
  });

  it('shows the original grader verdict, note, and evidence on each repair', async () => {
    renderDetail(qaSession({ qa: {
      pass: true, score: 92, passThreshold: 85,
      review: { recommendation: 'needs_review', confidence: 'high', safetyRisk: 'none', reviewFlags: [] },
      repairs: [{
        criterionId: 'doc-te', rule: 'natural-message-routing-wording',
        reason: 'Accepted natural wording.', evidence: 'I will send this request to the refill team.',
        originalVerdict: 'NOT_MET',
        originalNote: 'The navigator did not say Telephone Encounter.',
        originalEvidence: 'send this request over',
      }],
    } }));
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('Fairness guardrails applied')).toBeInTheDocument();
    expect(screen.getByText('Original AI grader output')).toBeInTheDocument();
    expect(screen.getByText('Original AI verdict:').parentElement?.textContent).toContain('NOT_MET');
    expect(screen.getByText('Original AI reason:').parentElement?.textContent).toContain('did not say Telephone Encounter');
    expect(screen.getByText('Original AI evidence:').parentElement?.textContent).toContain('send this request over');
    expect(screen.getByText('Replacement reason:').parentElement?.textContent).toContain('Accepted natural wording.');
  });

  it('shows an explicit "No evidence supplied" state for an evidence-less original verdict', async () => {
    renderDetail(qaSession({ qa: {
      pass: true, score: 92, passThreshold: 85,
      review: { recommendation: 'needs_review', confidence: 'high', safetyRisk: 'none', reviewFlags: [] },
      repairs: [{
        criterionId: 'know-rule', rule: 'standard-refill-no-pe-requirement',
        reason: 'PE not required.', evidence: 'I will send this to PEDS Encounters.',
        originalVerdict: 'NOT_MET', originalNote: 'PE was not verified.', originalEvidence: '',
      }],
    } }));
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('No evidence supplied')).toBeInTheDocument();
  });

  it('renders deterministic grading conflicts in their own supervisor section', async () => {
    renderDetail(qaSession({ qa: {
      pass: true, score: 100, passThreshold: 85,
      review: { recommendation: 'needs_review', confidence: 'high', safetyRisk: 'none', reviewFlags: [] },
      deterministicFindings: [
        {
          id: 'model-routing-conflict', type: 'routing', reason: 'wrong-destination',
          evidence: 'I will send this refill to the billing team.', destinationId: 'billing',
          affectedCriteria: ['know-rule', 'doc-te'],
        },
        {
          id: 'deterministic-overpromise', type: 'safety', reason: 'unsafe-promise-language',
          evidence: 'I guarantee approval today.', destinationId: null, affectedCriteria: ['know-rule'],
        },
      ],
    } }));
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('Deterministic grading conflicts')).toBeInTheDocument();
    const routingItem = screen.getByText(/wrong-destination/).closest('li');
    expect(routingItem?.textContent).toContain('Routing destination: billing');
    expect(routingItem?.textContent).toContain('know-rule, doc-te');
    expect(screen.getByText(/I will send this refill to the billing team/)).toBeInTheDocument();
    expect(screen.getByText(/unsafe-promise-language/)).toBeInTheDocument();
    expect(screen.getByText(/I guarantee approval today/)).toBeInTheDocument();
  });

  it('does not render the deterministic conflicts section when there are none', async () => {
    renderDetail(qaSession());
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('AI verdict:')).toBeInTheDocument();
    expect(screen.queryByText('Deterministic grading conflicts')).not.toBeInTheDocument();
  });

  it('AI PASS shows only Confirm Pass + Override to Fail', async () => {
    renderDetail(qaSession());
    fireEvent.click(await screen.findByText('Jordan'));
    expect(screen.getByRole('button', { name: 'Confirm Pass' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Override to Fail' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm Fail' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Override to Pass' })).not.toBeInTheDocument();
  });

  it('AI FAIL shows only Confirm Fail + Override to Pass', async () => {
    renderDetail(qaFailSession());
    fireEvent.click(await screen.findByText('Jordan'));
    expect(screen.getByRole('button', { name: 'Confirm Fail' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Override to Pass' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm Pass' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Override to Fail' })).not.toBeInTheDocument();
  });

  it('AI NEEDS REVIEW hides both confirm buttons and shows both override actions', async () => {
    renderDetail(qaNeedsReviewSession());
    fireEvent.click(await screen.findByText('Jordan'));
    expect(screen.queryByRole('button', { name: 'Confirm Pass' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm Fail' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Override to Pass' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Override to Fail' })).toBeInTheDocument();
  });

  it('NEEDS REVIEW: Override to Pass requires a reason', async () => {
    renderDetail(qaNeedsReviewSession());
    fireEvent.click(await screen.findByText('Jordan'));
    fireEvent.click(screen.getByRole('button', { name: 'Override to Pass' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save final review' }));
    expect(await screen.findByText(/reason is required for overrides/i)).toBeInTheDocument();
    expect(dbMocks.updateQaFinalReview).not.toHaveBeenCalled();
  });

  it('NEEDS REVIEW: Override to Fail requires a reason', async () => {
    renderDetail(qaNeedsReviewSession());
    fireEvent.click(await screen.findByText('Jordan'));
    fireEvent.click(screen.getByRole('button', { name: 'Override to Fail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save final review' }));
    expect(await screen.findByText(/reason is required for overrides/i)).toBeInTheDocument();
    expect(dbMocks.updateQaFinalReview).not.toHaveBeenCalled();
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

  it('Confirm Fail (AI FAIL) calls updateQaFinalReview with confirmed_fail', async () => {
    dbMocks.updateQaFinalReview.mockResolvedValue();
    renderDetail(qaFailSession());
    fireEvent.click(await screen.findByText('Jordan'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Fail' }));
    await waitFor(() =>
      expect(dbMocks.updateQaFinalReview).toHaveBeenCalledWith('qa-1', {
        status: 'confirmed_fail',
        reason: '',
      })
    );
    expect(await screen.findByText('FINAL FAIL')).toBeInTheDocument();
  });

  it('Override to Fail (AI PASS) calls updateQaFinalReview with overridden_fail and reason', async () => {
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

describe('NavigatorDetail — QA history badge is never an unreviewed bare verdict', () => {
  it('a pending AI pass badge says AI PASS — PENDING REVIEW (never a bare PASS)', async () => {
    renderDetail(qaSession());
    expect(await screen.findByText('QA TEST · AI PASS — PENDING REVIEW')).toBeInTheDocument();
    // The compact badge is never a standalone PASS.
    expect(screen.queryByText('QA TEST · PASS')).not.toBeInTheDocument();
  });

  it('a pending AI fail badge says AI FAIL — PENDING REVIEW', async () => {
    renderDetail(qaFailSession());
    expect(await screen.findByText('QA TEST · AI FAIL — PENDING REVIEW')).toBeInTheDocument();
  });

  it('a needs-review badge says NEEDS SUPERVISOR REVIEW', async () => {
    renderDetail(qaNeedsReviewSession());
    expect(await screen.findByText('QA TEST · NEEDS SUPERVISOR REVIEW')).toBeInTheDocument();
  });

  it('a confirmed final verdict shows FINAL PASS on the badge', async () => {
    renderDetail(qaSession({
      qaFinalReview: { status: 'confirmed_pass', finalPass: true, reviewedBy: 'supervisor', reviewedAt: { seconds: 1 } },
    }));
    expect(await screen.findByText('QA TEST · FINAL PASS')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rubric interpretability is resolved at RENDER time (correction pass #2).
//
// The previous build trusted a persisted `qa.scoringUnavailable` boolean. That
// flag is written by whichever build GRADED the attempt, so a record produced by
// a future/unknown rubric carries its own stored `domainScores` and no flag at
// all — and the projection rendered anyway, presenting scores this build cannot
// interpret. These tests drive the real component.
// ─────────────────────────────────────────────────────────────────────────────

describe('NavigatorDetail — unknown rubric versions withhold the domain projection', () => {
  const unknownVersionSession = (extra = {}) => qaSession({
    qa: {
      pass: true,
      score: 92,
      passThreshold: 85,
      review: { recommendation: 'pass', confidence: 'high', safetyRisk: 'none', reviewFlags: [] },
      gradingMetadata: { rubricVersion: 'qa-rubric-obgyn-v99', rubricDepartment: 'obgyn' },
      // Stale projections written by the build that graded it.
      domainScores: { intake: { score: 95, possible: 10, earned: 9.5, criteria: [] } },
      ...extra,
    },
  });

  it('withholds stale stored domainScores under an unknown recorded version', async () => {
    renderDetail(unknownVersionSession());
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText(/Unavailable/)).toBeInTheDocument();
    expect(screen.getByText('qa-rubric-obgyn-v99')).toBeInTheDocument();
    expect(screen.queryByText(/95%/)).not.toBeInTheDocument();
  });

  it('ignores a stored scoringUnavailable:false on an unknown version', async () => {
    renderDetail(unknownVersionSession({ scoringUnavailable: false }));
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText(/Unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/95%/)).not.toBeInTheDocument();
  });

  it('still renders the projection for a KNOWN rubric version', async () => {
    renderDetail(qaSession({
      qa: {
        pass: true,
        score: 92,
        passThreshold: 85,
        review: { recommendation: 'pass', confidence: 'high', safetyRisk: 'none', reviewFlags: [] },
        gradingMetadata: { rubricVersion: 'qa-rubric-obgyn-v1', rubricDepartment: 'obgyn' },
        domainScores: { intake: { score: 95, possible: 10, earned: 9.5, criteria: [] } },
      },
    }));
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('QA-only domain signal')).toBeInTheDocument();
    expect(screen.queryByText(/Unavailable/)).not.toBeInTheDocument();
  });

  it('renders a metadata-less legacy attempt without crashing', async () => {
    renderDetail(qaSession({
      qa: {
        pass: true,
        score: 92,
        passThreshold: 85,
        review: { recommendation: 'pass', confidence: 'high', safetyRisk: 'none', reviewFlags: [] },
        domainScores: { intake: { score: 95, possible: 10, earned: 9.5, criteria: [] } },
      },
    }));
    fireEvent.click(await screen.findByText('Jordan'));
    expect(await screen.findByText('QA-only domain signal')).toBeInTheDocument();
    expect(screen.queryByText(/Unavailable/)).not.toBeInTheDocument();
  });
});
