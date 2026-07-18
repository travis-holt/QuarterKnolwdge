import { describe, expect, it } from 'vitest';
import { OBGYN_RULE_SET_VERSION, OBGYN_SOP_VERSION, OBGYN_SOURCE_AUTHORITY } from '../data/obgynWorkflowRules.js';
import { contentVersionStatus, currentContentVersionContext } from './contentVersion.js';

describe('contentVersionStatus', () => {
  const withActiveSop = currentContentVersionContext('obgyn', { version: 7 });
  const noActiveSop = currentContentVersionContext('obgyn', null);

  it('marks unversioned historical content legacy without mutating it', () => {
    expect(contentVersionStatus({}, withActiveSop).status).toBe('legacy');
    expect(contentVersionStatus({}, noActiveSop).status).toBe('legacy');
  });

  it('active SOP v7 + item generated from active-sop:obgyn:v7 is current', () => {
    expect(contentVersionStatus({
      sourceSopVersion: 'active-sop:obgyn:v7',
      sourceRuleVersion: OBGYN_RULE_SET_VERSION,
    }, withActiveSop).status).toBe('current');
  });

  it('active SOP v7 + fallback-grounded generated item is stale even with a current rule version', () => {
    expect(contentVersionStatus({
      sourceSopVersion: OBGYN_SOP_VERSION,
      sourceRuleVersion: OBGYN_RULE_SET_VERSION,
    }, withActiveSop).status).toBe('stale');
  });

  it('no active SOP + matching fallback-grounded item is current', () => {
    expect(contentVersionStatus({
      sourceSopVersion: OBGYN_SOP_VERSION,
      sourceRuleVersion: OBGYN_RULE_SET_VERSION,
    }, noActiveSop).status).toBe('current');
  });

  it('a different active SOP version does not match the current active SOP', () => {
    expect(contentVersionStatus({
      sourceSopVersion: 'active-sop:obgyn:v6',
      sourceRuleVersion: OBGYN_RULE_SET_VERSION,
    }, withActiveSop).status).toBe('stale');
  });

  it('an active-SOP claim with no active SOP present lands in review', () => {
    expect(contentVersionStatus({
      sourceSopVersion: 'active-sop:obgyn:v7',
      sourceRuleVersion: OBGYN_RULE_SET_VERSION,
    }, noActiveSop).status).toBe('stale');
  });

  it('marks old versions and unknown rules for review', () => {
    expect(contentVersionStatus({ sourceSopVersion: 'old', sourceRuleVersion: 'old' }, withActiveSop).status).toBe('stale');
    expect(contentVersionStatus({
      sourceSopVersion: OBGYN_SOP_VERSION,
      sourceRuleVersion: OBGYN_RULE_SET_VERSION,
      ruleIds: ['removed_rule'],
    }, withActiveSop)).toMatchObject({ status: 'unknown_rules', unknownRuleIds: ['removed_rule'] });
  });

  it('owner-confirmed current-floor content is evaluated separately from active-SOP-generated content', () => {
    const ownerItem = {
      sourceSopVersion: OBGYN_SOP_VERSION,
      sourceRuleVersion: OBGYN_RULE_SET_VERSION,
      sourceAuthority: OBGYN_SOURCE_AUTHORITY,
    };
    // Current-floor authority stays current whether or not an active SOP exists…
    expect(contentVersionStatus(ownerItem, withActiveSop).status).toBe('current');
    expect(contentVersionStatus(ownerItem, noActiveSop).status).toBe('current');
    // …but goes stale when the executable rule set moves on…
    expect(contentVersionStatus({ ...ownerItem, sourceRuleVersion: 'obgyn-workflow-rules-v1' }, withActiveSop).status).toBe('stale');
    // …and cannot ride the owner authority while falsely claiming active-SOP grounding.
    expect(contentVersionStatus({
      ...ownerItem, sourceSopVersion: 'active-sop:obgyn:v6',
    }, withActiveSop).status).toBe('stale');
  });

  it('pediatrics fallback content is current only without an active SOP', () => {
    const peds = { sourceSopVersion: 'pediatrics-hardcoded-fallback-v1' };
    expect(contentVersionStatus(peds, currentContentVersionContext('pediatrics', null)).status).toBe('current');
    expect(contentVersionStatus(peds, currentContentVersionContext('pediatrics', { version: 3 })).status).toBe('stale');
    expect(contentVersionStatus({ sourceSopVersion: 'active-sop:pediatrics:v3' },
      currentContentVersionContext('pediatrics', { version: 3 })).status).toBe('current');
  });
});
