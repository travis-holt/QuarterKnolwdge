import { describe, it, expect } from 'vitest';
import { chooseBalancedWorkflowTypes, pickDiverseAudits } from './auditWorkflows.js';

describe('auditWorkflows helpers', () => {
  it('balanced generation fills the least-covered workflow types first', () => {
    const picks = chooseBalancedWorkflowTypes([
      { domainId: 'routing', workflowType: 'standard_refill_queue' },
      { domainId: 'routing', workflowType: 'standard_refill_queue' },
      { domainId: 'routing', workflowType: 'referral_owner' },
    ], 'routing', 3);

    expect(picks[0]).not.toBe('standard_refill_queue');
    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it('balanced generation ignores archived audits when calculating coverage', () => {
    const picks = chooseBalancedWorkflowTypes([
      { domainId: 'routing', workflowType: 'standard_refill_queue', status: 'archived' },
      { domainId: 'routing', workflowType: 'standard_refill_queue', status: 'archived' },
      { domainId: 'routing', workflowType: 'controlled_substance_owner', status: 'active' },
    ], 'routing', 1);

    expect(picks).toEqual(['standard_refill_queue']);
  });

  it('pickDiverseAudits rotates workflow types before repeating one', () => {
    const picked = pickDiverseAudits([
      { id: 'a1', workflowType: 'standard_refill_queue' },
      { id: 'a2', workflowType: 'standard_refill_queue' },
      { id: 'b1', workflowType: 'referral_owner' },
      { id: 'c1', workflowType: 'shots_or_imaging_owner' },
    ], 3);

    expect(picked.map((a) => a.id)).toEqual(['a1', 'b1', 'c1']);
  });
});
