import { describe, it, expect } from 'vitest';

import {
  aiQaPass,
  qaFinalReviewStatus,
  qaFinalVerdict,
  qaFinalReviewLabel,
  qaHistoryBadgeLabel,
  qaBadgeTone,
  qaAiResultLabel,
} from './qaFinalReview.js';

describe('qaFinalReview helpers', () => {
  it('pending AI pass', () => {
    const session = { qa: { pass: true } };
    expect(aiQaPass(session.qa)).toBe(true);
    expect(qaFinalVerdict(session)).toEqual({
      aiPass: true,
      finalPass: null,
      status: 'pending',
      needsSupervisorReview: true,
      label: 'AI PASS - Pending supervisor review',
    });
  });

  it('pending AI fail', () => {
    const session = { qa: { pass: false } };
    expect(qaFinalVerdict(session).label).toBe('AI FAIL - Pending supervisor review');
  });

  it('preserves an AI needs-review verdict while supervisor review is pending', () => {
    const session = {
      qa: { pass: true, review: { recommendation: 'needs_review' } },
    };
    expect(qaFinalVerdict(session)).toMatchObject({
      finalPass: null,
      needsSupervisorReview: true,
      label: 'AI NEEDS REVIEW - Pending supervisor review',
    });
  });

  it('confirmed pass', () => {
    const session = {
      qa: { pass: true },
      qaFinalReview: { status: 'confirmed_pass', finalPass: true },
    };
    expect(qaFinalReviewStatus(session)).toBe('confirmed_pass');
    expect(qaFinalReviewLabel(session)).toBe('FINAL PASS');
    expect(qaFinalVerdict(session)).toMatchObject({
      aiPass: true,
      finalPass: true,
      status: 'confirmed_pass',
      needsSupervisorReview: false,
      label: 'FINAL PASS',
    });
  });

  it('confirmed fail', () => {
    const session = {
      qa: { pass: false },
      qaFinalReview: { status: 'confirmed_fail', finalPass: false },
    };
    expect(qaFinalReviewLabel(session)).toBe('FINAL FAIL');
  });

  it('overridden pass', () => {
    const session = {
      qa: { pass: false },
      qaFinalReview: { status: 'overridden_pass', finalPass: true },
    };
    expect(qaFinalVerdict(session)).toMatchObject({
      aiPass: false,
      finalPass: true,
      status: 'overridden_pass',
      needsSupervisorReview: false,
      label: 'OVERRIDDEN PASS',
    });
  });

  it('overridden fail', () => {
    const session = {
      qa: { pass: true },
      qaFinalReview: { status: 'overridden_fail', finalPass: false },
    };
    expect(qaFinalReviewLabel(session)).toBe('OVERRIDDEN FAIL');
  });

  it('missing qaFinalReview defaults to pending', () => {
    const session = { qa: { score: 86, passThreshold: 85 } };
    expect(qaFinalReviewStatus(session)).toBe('pending');
    expect(aiQaPass(session.qa)).toBe(true);
  });
});

describe('qaAiResultLabel — navigator-facing immediate result (always non-final)', () => {
  it('an AI pass is labelled as pending review, never a standalone PASS', () => {
    const label = qaAiResultLabel({ pass: true });
    expect(label).toBe('AI PASS — PENDING SUPERVISOR REVIEW');
    expect(label).not.toBe('PASS');
  });
  it('an AI fail is labelled as pending review, never a standalone FAIL', () => {
    const label = qaAiResultLabel({ pass: false });
    expect(label).toBe('AI FAIL — PENDING SUPERVISOR REVIEW');
    expect(label).not.toBe('FAIL');
  });
  it('a needs-review result says NEEDS SUPERVISOR REVIEW', () => {
    expect(qaAiResultLabel({ pass: true, review: { recommendation: 'needs_review' } }))
      .toBe('NEEDS SUPERVISOR REVIEW');
  });
});

describe('qaHistoryBadgeLabel — stored-attempt badges', () => {
  it('pending AI pass/fail/needs-review badges say pending / needs review, never a bare verdict', () => {
    expect(qaHistoryBadgeLabel({ qa: { pass: true } })).toBe('QA TEST · AI PASS — PENDING REVIEW');
    expect(qaHistoryBadgeLabel({ qa: { pass: false } })).toBe('QA TEST · AI FAIL — PENDING REVIEW');
    expect(qaHistoryBadgeLabel({ qa: { pass: true, review: { recommendation: 'needs_review' } } }))
      .toBe('QA TEST · NEEDS SUPERVISOR REVIEW');
  });
  it('a confirmed final verdict shows FINAL PASS/FAIL', () => {
    expect(qaHistoryBadgeLabel({ qa: { pass: true }, qaFinalReview: { status: 'confirmed_pass', finalPass: true } }))
      .toBe('QA TEST · FINAL PASS');
    expect(qaHistoryBadgeLabel({ qa: { pass: false }, qaFinalReview: { status: 'confirmed_fail', finalPass: false } }))
      .toBe('QA TEST · FINAL FAIL');
  });
  it('an overridden verdict shows OVERRIDDEN PASS/FAIL', () => {
    expect(qaHistoryBadgeLabel({ qa: { pass: false }, qaFinalReview: { status: 'overridden_pass', finalPass: true } }))
      .toBe('QA TEST · OVERRIDDEN PASS');
    expect(qaHistoryBadgeLabel({ qa: { pass: true }, qaFinalReview: { status: 'overridden_fail', finalPass: false } }))
      .toBe('QA TEST · OVERRIDDEN FAIL');
  });
});

describe('qaBadgeTone', () => {
  it('maps pending AI verdicts to pass/fail/review tone', () => {
    expect(qaBadgeTone({ qa: { pass: true } })).toBe('pass');
    expect(qaBadgeTone({ qa: { pass: false } })).toBe('fail');
    expect(qaBadgeTone({ qa: { pass: true, review: { recommendation: 'needs_review' } } })).toBe('review');
  });
  it('maps reviewed verdicts to the FINAL/OVERRIDDEN tone', () => {
    expect(qaBadgeTone({ qa: { pass: false }, qaFinalReview: { status: 'overridden_pass' } })).toBe('pass');
    expect(qaBadgeTone({ qa: { pass: true }, qaFinalReview: { status: 'confirmed_fail' } })).toBe('fail');
  });
});
