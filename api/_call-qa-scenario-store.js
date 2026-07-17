import { compareTimestampValues } from '../src/lib/time.js';
import { getObgynWorkflowRule } from '../src/data/obgynWorkflowRules.js';

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

export function validatePrivateScenario(data, { documentId, department }) {
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
  if (![data.sourceSopVersion, data.sourceRuleVersion, data.sourceAuthority].every(nullableString)) {
    throw new Error(`Private Call QA source provenance is invalid for ${data.id}.`);
  }

  let primaryDomainId = data.primaryDomainId;
  let domainIds = [...data.domainIds];
  let competencyIds = [...data.competencyIds];
  if (data.department === 'obgyn') {
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
    ruleIds: [...data.ruleIds],
    sourceSopVersion: data.sourceSopVersion,
    sourceRuleVersion: data.sourceRuleVersion,
    sourceAuthority: data.sourceAuthority,
  };
}

export function selectLoadedCallQaScenario(scenarios, { department, priorAttempts = [] } = {}) {
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
  return ordered.find((item) => !recentIds.has(item.id)) ?? ordered[0];
}

export async function selectServerCallQaScenario(db, { department, priorAttempts = [] } = {}) {
  const snap = await db.collection(CALL_QA_PRIVATE_SCENARIOS_COLLECTION)
    .where('department', '==', department)
    .get();
  const scenarios = snap.docs
    .filter((doc) => doc.data()?.active === true)
    .map((doc) => validatePrivateScenario(doc.data(), { documentId: doc.id, department }));
  return selectLoadedCallQaScenario(scenarios, { department, priorAttempts });
}
