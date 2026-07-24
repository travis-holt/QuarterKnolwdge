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

// ── Navigator-visible chart context (the "Simulated ECW chart") ──────────────
//
// A DELIBERATELY CURATED representation of what a real navigator could see in
// ECW during this call: current plan / RTO, active orders, open Telephone
// Encounters/messages, future appointments, and other operationally-visible
// chart facts (including explicit "none on file" facts). It is the ONE piece of
// scenario chart data that is SAFE to show the navigator and to send to the
// browser, and it is what the grader must judge chart-dependent decisions
// against.
//
// It is deliberately SEPARATE from `hiddenChartState`:
//   * `hiddenChartState` is grader-only ground truth — it may contain facts the
//     navigator could NOT see, and it is never sent to the browser.
//   * `navigatorChartState` contains ONLY facts a navigator could legitimately
//     observe and act on. It must NOT tell the navigator what action to take.
//
// Scalars are optional single lines; list fields are arrays of short fact
// strings. Every value is a chart FACT, never a grading instruction, correct
// action, or scoring note.
//
// ── PRESENCE SEMANTICS (three distinct states — never collapse them) ─────────
//
// A chart section has THREE meaningfully different states, and confusing any two
// of them fabricates information the scenario author never asserted:
//
//   1. MISSING / null  — this section is NOT part of the simulated information
//      available for this scenario. It says NOTHING about whether anything
//      exists. It must never be rendered, described, or reasoned about, and it
//      must NEVER be presented as "None on file".
//   2. EXPLICIT []     — the navigator checked this section and there is NOTHING
//      ON FILE. This is REAL, decisive information ("no active orders" is often
//      the single fact the whole call turns on) and must survive end to end.
//   3. NON-EMPTY array — exactly these items are visible on file.
//
// The pipeline preserves that distinction at every hop:
//   validatePrivateScenario → attempt snapshot → relay projection → UI → grader.
// `null` stays `null` (omitted downstream); `[]` stays `[]` (rendered "None on
// file"); a populated array keeps its sanitized items.
export const NAVIGATOR_CHART_SCALAR_FIELDS = Object.freeze(['summary', 'planRto']);
export const NAVIGATOR_CHART_LIST_FIELDS = Object.freeze([
  'activeOrders', 'openEncounters', 'futureAppointments', 'otherFacts',
]);

export function validateNavigatorChartState(raw, scenarioId) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Private Call QA navigator chart state is invalid for ${scenarioId}.`);
  }
  const chart = {};
  for (const field of NAVIGATOR_CHART_SCALAR_FIELDS) {
    const value = raw[field];
    // Absent scalar → null (unavailable), never an empty string.
    if (value === undefined || value === null) { chart[field] = null; continue; }
    if (!nonEmptyString(value)) {
      throw new Error(`Private Call QA navigator chart ${field} is invalid for ${scenarioId}.`);
    }
    chart[field] = value;
  }
  for (const field of NAVIGATOR_CHART_LIST_FIELDS) {
    const value = raw[field];
    // ABSENT is NOT "none on file": a missing section stays null so nothing
    // downstream can claim the navigator saw an empty section they never saw.
    if (value === undefined || value === null) { chart[field] = null; continue; }
    if (!stringArray(value, { allowEmpty: true })) {
      throw new Error(`Private Call QA navigator chart ${field} is invalid for ${scenarioId}.`);
    }
    // An explicit [] is PRESERVED — it is the author asserting "nothing on file".
    chart[field] = [...value];
  }
  return chart;
}

// True when the curated chart SUPPLIES at least one navigator-visible section.
//
// An explicit empty list COUNTS: "no active orders on file" / "no future
// appointment on file" is frequently the decisive chart fact a correct
// no-booking workflow depends on, so a scenario whose whole point is an absent
// order is legitimately chart-dependent. Only a chart that supplies NOTHING
// (null, {}, or every section missing) is treated as absent — that is the case
// that must fail closed when `requiresNavigatorChartContext` is true.
export function navigatorChartStateHasContent(chart) {
  if (!chart || typeof chart !== 'object' || Array.isArray(chart)) return false;
  return NAVIGATOR_CHART_SCALAR_FIELDS.some((field) => nonEmptyString(chart[field]))
    || NAVIGATOR_CHART_LIST_FIELDS.some((field) => Array.isArray(chart[field]));
}

// The SAFE, presence-preserving projection of the navigator-visible chart.
//
// Shared by the browser `ready` projection and the grader context so the
// navigator and the grader see EXACTLY the same sections. It carries only
// curated navigator-observable facts — never grader-only data (gradingContext,
// expectedActions, criticalMisses, scoringNotes, hiddenChartState,
// callerCaseFile, rule ids). A section the scenario did not supply is OMITTED
// (not emptied); an explicitly empty section is preserved as `[]`.
// Returns null when the chart supplies no sections at all.
export function sanitizeNavigatorChartState(chart) {
  if (!chart || typeof chart !== 'object' || Array.isArray(chart)) return null;
  const projection = {};
  for (const field of NAVIGATOR_CHART_SCALAR_FIELDS) {
    if (nonEmptyString(chart[field])) projection[field] = chart[field];
  }
  for (const field of NAVIGATOR_CHART_LIST_FIELDS) {
    if (!Array.isArray(chart[field])) continue; // missing section stays missing
    projection[field] = chart[field].filter((item) => nonEmptyString(item));
  }
  return Object.keys(projection).length ? projection : null;
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
  // The navigator-visible chart is validated for ALL departments (sanitized to a
  // safe shape); the fail-closed REQUIREMENT below is enforced per rollout dept.
  const navigatorChartState = validateNavigatorChartState(data.navigatorChartState, data.id);
  const callerCaseFile = validateCallerCaseFile(data.callerCaseFile, data.id);
  if (![data.sourceSopVersion, data.sourceRuleVersion, data.sourceAuthority].every(nullableString)) {
    throw new Error(`Private Call QA source provenance is invalid for ${data.id}.`);
  }

  // ── Navigator-visible chart requirement (fail closed) ──────────────────────
  //
  // Every OB/GYN rollout scenario must DECLARE whether the correct workflow
  // decision depends on chart facts (`requiresNavigatorChartContext`, an explicit
  // boolean). When it does, a non-empty `navigatorChartState` is MANDATORY so the
  // navigator actually SEES those facts in the simulated ECW chart. A scored
  // decision must never depend on a chart fact that lives only in grader-only
  // hidden state, so a scenario that needs chart context but exposes none is
  // rejected here — the relay then fails closed with a scenario-unavailable error
  // instead of administering an impossible test.
  const requiresNavigatorChartContext = data.requiresNavigatorChartContext;
  if (data.department === 'obgyn') {
    if (typeof requiresNavigatorChartContext !== 'boolean') {
      throw new Error(`Private Call QA scenario must declare requiresNavigatorChartContext for ${data.id}.`);
    }
    if (requiresNavigatorChartContext && !navigatorChartStateHasContent(navigatorChartState)) {
      throw new Error(`Private Call QA scenario requires a non-empty navigatorChartState for ${data.id}.`);
    }
  } else if (requiresNavigatorChartContext !== undefined && typeof requiresNavigatorChartContext !== 'boolean') {
    throw new Error(`Private Call QA scenario requiresNavigatorChartContext must be a boolean for ${data.id}.`);
  }

  let primaryDomainId = data.primaryDomainId;
  let domainIds = [...data.domainIds];
  let competencyIds = [...data.competencyIds];
  if (data.department === 'obgyn') {
    // OB/GYN rollout scenarios require COMPLETE, current provenance: null or
    // empty values never validate. The rule-set version and source authority
    // must match the current executable constants, and the SOP version must be
    // exactly the owner-confirmed current-floor version — the launch contract
    // deliberately pins private Call QA content to OBGYN_SOP_VERSION (no
    // dynamic active-SOP grounding; re-pin the constant on a deliberate
    // content re-authoring, never implicitly).
    if (data.sourceRuleVersion !== OBGYN_RULE_SET_VERSION) {
      throw new Error(`Private Call QA scenario rule-set version is not current for ${data.id}.`);
    }
    if (data.sourceAuthority !== OBGYN_SOURCE_AUTHORITY) {
      throw new Error(`Private Call QA scenario source authority is invalid for ${data.id}.`);
    }
    if (data.sourceSopVersion !== OBGYN_SOP_VERSION) {
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
    navigatorChartState,
    requiresNavigatorChartContext: requiresNavigatorChartContext === true,
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
