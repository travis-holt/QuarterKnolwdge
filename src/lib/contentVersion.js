import {
  OBGYN_RULE_SET_VERSION,
  OBGYN_SOP_VERSION,
  OBGYN_WORKFLOW_RULES,
} from '../data/obgynWorkflowRules.js';

const OBGYN_RULE_IDS = new Set(OBGYN_WORKFLOW_RULES.map((rule) => rule.id));

export function currentContentVersionContext(department = 'pediatrics', activeSop = null) {
  const activeVersion = activeSop ? `active-sop:${department}:v${activeSop.version ?? 'unversioned'}` : null;
  const sourceSopVersion = activeVersion
    ?? (department === 'obgyn' ? OBGYN_SOP_VERSION : `${department}-hardcoded-fallback-v1`);
  return {
    department,
    sourceSopVersion,
    sourceSopVersions: new Set([sourceSopVersion, department === 'obgyn' ? OBGYN_SOP_VERSION : null].filter(Boolean)),
    sourceRuleVersion: department === 'obgyn' ? OBGYN_RULE_SET_VERSION : null,
    knownRuleIds: department === 'obgyn' ? OBGYN_RULE_IDS : new Set(),
  };
}

export function contentVersionStatus(item, context) {
  const ruleIds = Array.isArray(item?.ruleIds) ? item.ruleIds.filter(Boolean) : [];
  const hasMetadata = Boolean(item?.sourceSopVersion || item?.sourceRuleVersion || ruleIds.length || item?.sourceAuthority);
  if (!hasMetadata) {
    return { status: 'legacy', label: 'Legacy · unversioned', legacy: true, stale: false, matchesActive: false, unknownRuleIds: [] };
  }

  const unknownRuleIds = ruleIds.filter((id) => !context?.knownRuleIds?.has(id));
  if (unknownRuleIds.length) {
    return { status: 'unknown_rules', label: 'Review · unknown rules', legacy: false, stale: true, matchesActive: false, unknownRuleIds };
  }

  const sopMatches = context?.sourceSopVersions
    ? context.sourceSopVersions.has(item.sourceSopVersion)
    : item.sourceSopVersion === context?.sourceSopVersion;
  const stale = !sopMatches
    || (context?.sourceRuleVersion && item.sourceRuleVersion !== context.sourceRuleVersion);
  return stale
    ? { status: 'stale', label: 'Stale · review', legacy: false, stale: true, matchesActive: false, unknownRuleIds: [] }
    : { status: 'current', label: 'Current rules', legacy: false, stale: false, matchesActive: true, unknownRuleIds: [] };
}
