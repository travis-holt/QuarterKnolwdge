import { describe, it, expect } from 'vitest';
import { auditPlanComplete, selectAuditItems } from './SpotTheError.jsx';

describe('selectAuditItems', () => {
  it('avoids repeated workflow types in single-domain mode when alternatives exist', () => {
    const { fromBank, toGenerate } = selectAuditItems(
      ['routing', 'routing', 'routing'],
      {
        routing: [
          { workflowType: 'standard_refill_queue', transcript: [], errorIndex: 0, modelExplanation: 'a' },
          { workflowType: 'standard_refill_queue', transcript: [], errorIndex: 0, modelExplanation: 'b' },
          { workflowType: 'referral_owner', transcript: [], errorIndex: 0, modelExplanation: 'c' },
          { workflowType: 'shots_or_imaging_owner', transcript: [], errorIndex: 0, modelExplanation: 'd' },
        ],
      }
    );

    expect(toGenerate).toEqual([]);
    expect(fromBank.map((a) => a.modelExplanation)).toEqual(['a', 'c', 'd']);
  });
});

describe('auditPlanComplete', () => {
  it('requires every full-profile domain before scoring', () => {
    const plan = ['intake', 'routing', 'scheduling'];
    expect(auditPlanComplete(plan, [
      { domainId: 'intake' },
      { domainId: 'routing' },
      { domainId: 'scheduling' },
    ])).toBe(true);
    expect(auditPlanComplete(plan, [
      { domainId: 'intake' },
      { domainId: 'routing' },
    ])).toBe(false);
  });

  it('validates repeated-domain assessment counts, not just unique ids', () => {
    const plan = ['routing', 'routing', 'routing'];
    expect(auditPlanComplete(plan, [{ domainId: 'routing' }, { domainId: 'routing' }])).toBe(false);
    expect(auditPlanComplete(plan, [
      { domainId: 'routing' },
      { domainId: 'routing' },
      { domainId: 'routing' },
    ])).toBe(true);
  });
});
