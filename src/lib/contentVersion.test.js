import { describe, expect, it } from 'vitest';
import { OBGYN_RULE_SET_VERSION, OBGYN_SOP_VERSION } from '../data/obgynWorkflowRules.js';
import { contentVersionStatus, currentContentVersionContext } from './contentVersion.js';

describe('contentVersionStatus', () => {
  const context = currentContentVersionContext('obgyn', { version: 7 });

  it('marks unversioned historical content legacy without mutating it', () => {
    expect(contentVersionStatus({}, context).status).toBe('legacy');
  });

  it('accepts owner-current and active-SOP content as current authorities', () => {
    expect(contentVersionStatus({ sourceSopVersion: OBGYN_SOP_VERSION, sourceRuleVersion: OBGYN_RULE_SET_VERSION }, context).status).toBe('current');
    expect(contentVersionStatus({ sourceSopVersion: 'active-sop:obgyn:v7', sourceRuleVersion: OBGYN_RULE_SET_VERSION }, context).status).toBe('current');
  });

  it('marks old versions and unknown rules for review', () => {
    expect(contentVersionStatus({ sourceSopVersion: 'old', sourceRuleVersion: 'old' }, context).status).toBe('stale');
    expect(contentVersionStatus({ sourceSopVersion: OBGYN_SOP_VERSION, sourceRuleVersion: OBGYN_RULE_SET_VERSION, ruleIds: ['removed_rule'] }, context)).toMatchObject({ status: 'unknown_rules', unknownRuleIds: ['removed_rule'] });
  });
});
