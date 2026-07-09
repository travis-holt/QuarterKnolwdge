import { describe, it, expect } from 'vitest';

import {
  aiQaPass,
  qaFinalReviewStatus,
  qaFinalVerdict,
  qaFinalReviewLabel,
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
