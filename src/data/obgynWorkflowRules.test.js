import { describe, expect, it } from 'vitest';
import { COMPETENCY_IDS } from './competencies.js';
import { DOMAINS } from './questions.js';
import {
  OBGYN_RULE_SET_VERSION,
  OBGYN_SOP_VERSION,
  OBGYN_WORKFLOW_RULES,
  getObgynWorkflowRule,
  obgynRulesFor,
  formatObgynRulesForPrompt,
} from './obgynWorkflowRules.js';

describe('OB/GYN executable workflow rules', () => {
  it('contains at least 24 unique, versioned, fully structured rules', () => {
    expect(OBGYN_WORKFLOW_RULES.length).toBeGreaterThanOrEqual(24);
    expect(new Set(OBGYN_WORKFLOW_RULES.map((rule) => rule.id)).size).toBe(OBGYN_WORKFLOW_RULES.length);
    const domainIds = new Set(DOMAINS.map((domain) => domain.id));
    for (const rule of OBGYN_WORKFLOW_RULES) {
      expect(rule).toMatchObject({ department: 'obgyn', version: OBGYN_RULE_SET_VERSION });
      expect(rule.sourceAuthority).toBe('owner-confirmed-current-floor');
      for (const field of ['triggers', 'chartChecks', 'requiredActions', 'prohibitedActions', 'documentationRequirements', 'allowedVariants']) {
        expect(rule[field].length).toBeGreaterThan(0);
      }
      expect(rule.escalationPath).toBeTruthy();
      rule.domainIds.forEach((id) => expect(domainIds.has(id)).toBe(true));
      rule.competencyIds.forEach((id) => expect(COMPETENCY_IDS.has(id)).toBe(true));
    }
    expect(OBGYN_SOP_VERSION).toBe('obgyn-current-floor-2026-07-17');
  });

  it('selects rules by id, workflow, and domain and renders only selected rules', () => {
    expect(getObgynWorkflowRule('mfm_routing')?.title).toMatch(/MFM/);
    expect(obgynRulesFor({ department: 'pediatrics' })).toEqual([]);
    expect(obgynRulesFor({ department: 'obgyn', workflowType: 'mfm_owner' }).map((rule) => rule.id)).toEqual(['mfm_routing']);
    const selected = obgynRulesFor({ department: 'obgyn', ruleIds: ['lab_boundary'] });
    const prompt = formatObgynRulesForPrompt(selected);
    expect(prompt).toContain('lab_boundary');
    expect(prompt).not.toContain('dr_bank_waitlist');
  });
});
