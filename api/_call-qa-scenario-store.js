import { compareTimestampValues } from '../src/lib/time.js';
import {
  getObgynWorkflowRule,
  OBGYN_RULE_SET_VERSION,
  OBGYN_SOP_VERSION,
  OBGYN_SOURCE_AUTHORITY,
} from '../src/data/obgynWorkflowRules.js';

export const CALL_QA_PRIVATE_SCENARIOS_COLLECTION = 'callQaScenariosPrivate';

export function privateScenarioDocumentId({ id, version }) {
  return `${id}__${version}`;
}

function nonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function stringArray(value, { allowEmpty = false } = {}) {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(nonEmptyString);
}

function nullableString(value) {
  return value === null || nonEmptyString(value);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

// The caller's private contract: what the AI caller consistently knows and how
// it reveals it. Lives ONLY in the private Firestore scenario document and the
// immutable server attempt snapshot; it is passed server-side into the caller
// system instruction and never reaches the browser. It is deliberately separate
// from hiddenChartState, which is grader-authoritative chart information and is
// NOT automatically caller knowledge.
export function validateCallerCaseFile(raw, scenarioId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Private Call QA caller case file is invalid for ${scenarioId}.`);
  }
  if (!nonEmptyString(raw.callerGoal)) {
    throw new Error(`Private Call QA caller goal is invalid for ${scenarioId}.`);
  }
  if (!stringArray(raw.knownFacts)) {
    throw new Error(`Private Call QA caller known facts are invalid for ${scenarioId}.`);
  }
  for (const field of ['factsToReveal', 'revealRules', 'behavior', 'consistencyConstraints']) {
    if (raw[field] != null && !stringArray(raw[field], { allowEmpty: true })) {
      throw new Error(`Private Call QA caller ${field} is invalid for ${scenarioId}.`);
    }
  }
  return {
    callerGoal: raw.callerGoal,
    knownFacts: [...raw.knownFacts],
    factsToReveal: [...(raw.factsToReveal ?? [])],
    revealRules: [...(raw.revealRules ?? [])],
    behavior: [...(raw.behavior ?? [])],
    consistencyConstraints: [...(raw.consistencyConstraints ?? [])],
  };
}

export function validatePrivateScenario(data, { documentId, department, activeSopVersion = null }) {
  if (!data || data.active !== true) throw new Error('Private Call QA scenario is not active.');

  const requiredStrings = [
    'id', 'version', 'department', 'title', 'workflowType', 'difficulty',
    'primaryDomainId', 'callerName', 'openingLine', 'publicBriefing', 'gradingContext',
  ];
  for (const field of requiredStrings) {
    if (!nonEmptyString(data[field])) throw new Error(`Private Call QA scenario ${field} is invalid.`);
  }
  if (data.department !== department) throw new Error(`Private Call QA scenario department mismatch for ${data.id}.`);
  if (documentId !== privateScenarioDocumentId(data)) {
    throw new Error(`Private Call QA scenario document identity mismatch for ${data.id}.`);
  }
  if (!['easy', 'medium', 'hard'].includes(data.difficulty)) {
    throw new Error(`Private Call QA scenario difficulty is invalid for ${data.id}.`);
  }
  if (!stringArray(data.domainIds) || !data.domainIds.includes(data.primaryDomainId)) {
    throw new Error(`Private Call QA scenario domains are invalid for ${data.id}.`);
  }
  if (!stringArray(data.competencyIds)) {
    throw new Error(`Private Call QA scenario competencies are invalid for ${data.id}.`);
  }
  if (!stringArray(data.ruleIds, { allowEmpty: true })) {
    throw new Error(`Private Call QA scenario rules are invalid for ${data.id}.`);
  }
  if (!stringArray(data.expectedActions)) {
    throw new Error(`Private Call QA expected actions are invalid for ${data.id}.`);
  }
  if (!stringArray(data.criticalMisses)) {
    throw new Error(`Private Call QA critical misses are invalid for ${data.id}.`);
  }
  if (!stringArray(data.scoringNotes, { allowEmpty: true })) {
    throw new Error(`Private Call QA scoring notes are invalid for ${data.id}.`);
  }
  if (data.hiddenChartState !== null && (
    typeof data.hiddenChartState !== 'object' || Array.isArray(data.hiddenChartState)
  )) {
    throw new Error(`Private Call QA hidden chart state is invalid for ${data.id}.`);
  }
  const callerCaseFile = validateCallerCaseFile(data.callerCaseFile, data.id);
  if (![data.sourceSopVersion, data.sourceRuleVersion, data.sourceAuthority].every(nullableString)) {
    throw new Error(`Private Call QA source provenance is invalid for ${data.id}.`);
  }

  let primaryDomainId = data.primaryDomainId;
  let domainIds = [...data.domainIds];
  let competencyIds = [...data.competencyIds];
  if (data.department === 'obgyn') {
    // OB/GYN rollout scenarios require COMPLETE, current provenance: null or
    // empty values never validate. The rule-set version and source authority
    // must match the current executable constants, and the SOP version must be
    // the owner-confirmed current-floor version (or the verified active SOP
    // version supplied by the caller of this validator).
    if (data.sourceRuleVersion !== OBGYN_RULE_SET_VERSION) {
      throw new Error(`Private Call QA scenario rule-set version is not current for ${data.id}.`);
    }
    if (data.sourceAuthority !== OBGYN_SOURCE_AUTHORITY) {
      throw new Error(`Private Call QA scenario source authority is invalid for ${data.id}.`);
    }
    const supportedSopVersions = [OBGYN_SOP_VERSION, activeSopVersion].filter(Boolean);
    if (!nonEmptyString(data.sourceSopVersion) || !supportedSopVersions.includes(data.sourceSopVersion)) {
      throw new Error(`Private Call QA scenario SOP version is unsupported for ${data.id}.`);
    }
    if (!stringArray(data.ruleIds)) {
      throw new Error(`Private Call QA scenario has no OB/GYN rule ids for ${data.id}.`);
    }
    const rules = data.ruleIds.map(getObgynWorkflowRule);
    if (rules.some((rule) => !rule)) {
      throw new Error(`Private Call QA scenario references an unknown OB/GYN rule for ${data.id}.`);
    }
    const derivedDomains = unique(rules.flatMap((rule) => rule.domainIds));
    const derivedCompetencies = unique(rules.flatMap((rule) => rule.competencyIds));
    if (!derivedDomains.length || !derivedCompetencies.length) {
      throw new Error(`Private Call QA scenario has no OB/GYN rule coverage for ${data.id}.`);
    }
    primaryDomainId = derivedDomains.includes(data.primaryDomainId)
      ? data.primaryDomainId
      : derivedDomains[0];
    domainIds = unique([primaryDomainId, ...derivedDomains]);
    competencyIds = derivedCompetencies;
  }

  return {
    id: data.id,
    version: data.version,
    department: data.department,
    title: data.title,
    workflowType: data.workflowType,
    difficulty: data.difficulty,
    primaryDomainId,
    domainIds,
    competencyIds,
    callerName: data.callerName,
    openingLine: data.openingLine,
    publicBriefing: data.publicBriefing,
    gradingContext: data.gradingContext,
    expectedActions: [...data.expectedActions],
    criticalMisses: [...data.criticalMisses],
    scoringNotes: [...data.scoringNotes],
    hiddenChartState: data.hiddenChartState,
    callerCaseFile,
    ruleIds: [...data.ruleIds],
    sourceSopVersion: data.sourceSopVersion,
    sourceRuleVersion: data.sourceRuleVersion,
    sourceAuthority: data.sourceAuthority,
  };
}

// Server-side random selection. Recently used scenarios (server-trusted prior
// attempts only, never a browser-supplied history) are excluded first; when
// every scenario was recently used, selection falls back to a random choice
// among the full valid set. `random` is injectable for deterministic tests and
// defaults to a server-side source — the browser can never influence which
// scenario it gets or predict the next one from the sorted bank order.
export function selectLoadedCallQaScenario(scenarios, { department, priorAttempts = [], random = Math.random } = {}) {
  const ordered = scenarios
    .filter((item) => item.department === department)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!ordered.length) return null;

  const recentIds = new Set(
    priorAttempts
      .filter((attempt) =>
        (attempt.department ?? 'pediatrics') === department &&
        attempt?.qa &&
        !attempt?.qaArchived
      )
      .sort((a, b) => compareTimestampValues(b.endedAt, a.endedAt))
      .slice(0, 3)
      .map((attempt) => attempt.qaScenarioId)
      .filter(Boolean)
  );
  const eligible = ordered.filter((item) => !recentIds.has(item.id));
  const pool = eligible.length ? eligible : ordered;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index];
}

export async function selectServerCallQaScenario(db, { department, priorAttempts = [], random } = {}) {
  const snap = await db.collection(CALL_QA_PRIVATE_SCENARIOS_COLLECTION)
    .where('department', '==', department)
    .get();
  const scenarios = snap.docs
    .filter((doc) => doc.data()?.active === true)
    .map((doc) => validatePrivateScenario(doc.data(), { documentId: doc.id, department }));
  return selectLoadedCallQaScenario(scenarios, { department, priorAttempts, random });
}
