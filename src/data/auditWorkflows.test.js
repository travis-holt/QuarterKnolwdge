import { describe, it, expect } from 'vitest';
import { OBGYN_AUDIT_WORKFLOWS, auditRuleIdsFor, chooseBalancedWorkflowTypes, pickDiverseAudits, workflowOptionsFor } from './auditWorkflows.js';

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

  it('exposes all 14 OB/GYN workflow taxonomy entries with rule mappings', () => {
    const workflows = new Set(Object.values(OBGYN_AUDIT_WORKFLOWS).flat());
    expect(workflows.size).toBe(14);
    expect(workflowOptionsFor('routing', 'obgyn')).toContain('mfm_owner');
    for (const workflow of workflows) expect(auditRuleIdsFor(workflow, 'obgyn').length).toBeGreaterThan(0);
  });

  it('balances OB/GYN independently from Pediatrics', () => {
    const picks = chooseBalancedWorkflowTypes([], 'routing', 3, 'obgyn');
    expect(picks).toEqual(['existing_te_take_action', 'dr_bank_waitlist', 'mfm_owner']);
  });
});
