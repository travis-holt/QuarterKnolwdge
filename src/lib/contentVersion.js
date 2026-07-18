import {
  OBGYN_RULE_SET_VERSION,
  OBGYN_SOP_VERSION,
  OBGYN_SOURCE_AUTHORITY,
  OBGYN_WORKFLOW_RULES,
} from '../data/obgynWorkflowRules.js';

const OBGYN_RULE_IDS = new Set(OBGYN_WORKFLOW_RULES.map((rule) => rule.id));

// Version-status model (four separate concepts — never collapsed):
//   • activeSopVersion  — the ACTIVE supervisor-managed SOP grounding version
//                         (`active-sop:<dept>:v<N>`), or null when none exists.
//   • fallbackSopVersion — the hardcoded department fallback grounding version.
//   • sourceRuleVersion — the current executable rule-set version (OB/GYN only).
//   • sourceAuthority   — where the item's content authority comes from.
// When an active supervisor SOP exists, AI-generated content is current ONLY if
// it was grounded in that exact active SOP version; fallback-grounded content is
// stale/review even if its executable rule version still matches. Only when NO
// active SOP exists may fallback-grounded content be current. Owner-curated
// current-floor content (sourceAuthority = owner-confirmed-current-floor, not
// claiming active-SOP grounding) is evaluated separately against the executable
// rule-set version alone.
export function currentContentVersionContext(department = 'pediatrics', activeSop = null) {
  return {
    department,
    activeSopVersion: activeSop ? `active-sop:${department}:v${activeSop.version ?? 'unversioned'}` : null,
    fallbackSopVersion: department === 'obgyn' ? OBGYN_SOP_VERSION : `${department}-hardcoded-fallback-v1`,
    sourceRuleVersion: department === 'obgyn' ? OBGYN_RULE_SET_VERSION : null,
    knownRuleIds: department === 'obgyn' ? OBGYN_RULE_IDS : new Set(),
  };
}

const status = (name, label, extra = {}) => ({
  status: name,
  label,
  legacy: name === 'legacy',
  stale: name === 'stale' || name === 'unknown_rules',
  matchesActive: name === 'current',
  unknownRuleIds: [],
  ...extra,
});

export function contentVersionStatus(item, context) {
  const ruleIds = Array.isArray(item?.ruleIds) ? item.ruleIds.filter(Boolean) : [];
  const hasMetadata = Boolean(item?.sourceSopVersion || item?.sourceRuleVersion || ruleIds.length || item?.sourceAuthority);
  if (!hasMetadata) return status('legacy', 'Legacy · unversioned');

  const unknownRuleIds = ruleIds.filter((id) => !context?.knownRuleIds?.has(id));
  if (unknownRuleIds.length) {
    return status('unknown_rules', 'Review · unknown rules', { unknownRuleIds });
  }

  const ruleVersionCurrent = !context?.sourceRuleVersion
    || item.sourceRuleVersion === context.sourceRuleVersion;
  const claimsActiveSop = String(item?.sourceSopVersion ?? '').startsWith('active-sop:');

  // Owner-curated / code-backed current-floor content: current while the
  // executable rule set is current — but only when it is NOT claiming
  // active-SOP grounding (a false active-SOP claim is judged as such below).
  if (item?.sourceAuthority === OBGYN_SOURCE_AUTHORITY && !claimsActiveSop) {
    return ruleVersionCurrent
      ? status('current', 'Current rules')
      : status('stale', 'Stale · review');
  }

  let sopMatches;
  if (context?.activeSopVersion) {
    // An active supervisor SOP exists: AI-generated content must match that
    // EXACT active version. Fallback-grounded content is stale even when its
    // rule version still matches.
    sopMatches = item.sourceSopVersion === context.activeSopVersion;
  } else {
    // No active SOP: fallback-grounded content is current when its fallback
    // version matches; a stale active-SOP claim from a since-archived SOP does
    // not match and lands in review.
    sopMatches = item.sourceSopVersion === context.fallbackSopVersion;
  }

  return sopMatches && ruleVersionCurrent
    ? status('current', 'Current rules')
    : status('stale', 'Stale · review');
}
