// Calibration scenario references for the PRIVATE Call QA runtime bank.
//
// The production runtime bank lives ONLY in the Admin-denied Firestore
// collection `callQaScenariosPrivate`; no runtime scenario instance (IDs,
// opening lines, briefings, grading context, hidden facts, caller case files)
// may be committed to this public repository. Calibration and pilot-smoke code
// therefore never import a public runtime bank. Scenario descriptors come from
// exactly two places:
//
//   1. SYNTHETIC_CALIBRATION_SCENARIOS — explicitly NON-PRODUCTION synthetic
//      rehearsal descriptors (structural metadata only: no opening line, no
//      briefing, no answers). They let the committed synthetic example fixtures
//      and the management pilot smoke validate the pipeline shape. They carry
//      no calibration authority and can never be loaded by production runtime
//      code (nothing in api/live-relay.js or grade-call-qa.js imports them).
//
//   2. An operator-supplied PRIVATE MANIFEST — an ignored local JSON file
//      (metadata-only export of the provisioned private bank) passed to the
//      calibration CLI via --private-manifest, or an injected loader in tests.
//      The manifest loader rejects any entry carrying private instance fields,
//      so answers cannot leak into operator tooling either.
//
// Running coverage without a private manifest reports the missing runtime-bank
// evidence honestly; it never claims runtime coverage from the anonymous
// aggregate minimum counts alone.

export const SYNTHETIC_SCENARIO_VERSION = 'synthetic-rehearsal-v1';

const synthetic = (id, department, workflowType, difficulty, domainIds, competencyIds) => Object.freeze({
  id,
  version: SYNTHETIC_SCENARIO_VERSION,
  department,
  workflowType,
  difficulty,
  domainIds: Object.freeze([...domainIds]),
  competencyIds: Object.freeze([...competencyIds]),
  nonProduction: true,
  calibrationAuthority: 'none',
  evidenceUse: 'synthetic-rehearsal-only',
});

export const SYNTHETIC_CALIBRATION_SCENARIOS = Object.freeze([
  synthetic('synthetic-peds-refill-01', 'pediatrics', 'prescription_refill', 'medium', ['classification', 'documentation'], ['sopApplication', 'communication']),
  synthetic('synthetic-peds-scheduling-01', 'pediatrics', 'appointment_scheduling', 'easy', ['scheduling', 'intake'], ['sopKnowledge', 'customerHandling']),
  synthetic('synthetic-peds-urgent-boundary-01', 'pediatrics', 'urgent_symptoms', 'hard', ['routing', 'boundaries'], ['riskManagement', 'escalation']),
  synthetic('synthetic-peds-unclear-01', 'pediatrics', 'unclear_request', 'medium', ['classification', 'intake'], ['criticalThinking', 'communication']),
  synthetic('synthetic-peds-records-01', 'pediatrics', 'records_request', 'easy', ['documentation', 'boundaries'], ['compliance', 'sopKnowledge']),
  synthetic('synthetic-peds-referral-01', 'pediatrics', 'referral_request', 'medium', ['routing', 'documentation'], ['sopApplication', 'problemResolution']),
  synthetic('synthetic-peds-insurance-01', 'pediatrics', 'insurance_question', 'easy', ['boundaries', 'intake'], ['communication', 'compliance']),
  synthetic('synthetic-obgyn-refill-01', 'obgyn', 'prescription_refill', 'medium', ['classification', 'documentation'], ['sopApplication', 'communication']),
  synthetic('synthetic-obgyn-new-gyn-01', 'obgyn', 'annual_vs_gyn_ov', 'medium', ['classification', 'scheduling'], ['sopKnowledge', 'criticalThinking']),
  synthetic('synthetic-obgyn-results-boundary-01', 'obgyn', 'results_boundary', 'hard', ['boundaries', 'routing'], ['compliance', 'riskManagement']),
  synthetic('synthetic-obgyn-mfm-01', 'obgyn', 'mfm_routing', 'hard', ['routing', 'scheduling'], ['escalation', 'sopApplication']),
  synthetic('synthetic-obgyn-unclear-01', 'obgyn', 'unclear_request', 'medium', ['classification', 'intake'], ['criticalThinking', 'communication']),
  synthetic('synthetic-obgyn-records-01', 'obgyn', 'records_request', 'easy', ['documentation', 'boundaries'], ['compliance', 'sopKnowledge']),
  synthetic('synthetic-obgyn-pregnancy-01', 'obgyn', 'new_ob_vs_confirmation', 'medium', ['classification', 'scheduling'], ['sopApplication', 'customerHandling']),
]);

export function scenarioResolverFrom(scenarios = SYNTHETIC_CALIBRATION_SCENARIOS) {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  return (id) => byId.get(id) ?? null;
}

// Private-instance field names that may NEVER appear in an operator manifest —
// the manifest is metadata-only so coverage tooling can run without touching a
// single answer.
const PRIVATE_INSTANCE_FIELDS = [
  'openingLine', 'publicBriefing', 'callerName', 'gradingContext',
  'hiddenChartState', 'callerCaseFile', 'expectedActions', 'criticalMisses',
  'scoringNotes',
];

export function validateScenarioManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['manifest: must be an object'], scenarios: [] };
  }
  if (!Array.isArray(manifest.scenarios)) {
    return { valid: false, errors: ['manifest.scenarios: must be an array'], scenarios: [] };
  }
  const seen = new Set();
  const scenarios = [];
  for (const [index, entry] of manifest.scenarios.entries()) {
    const path = `manifest.scenarios[${index}]`;
    if (!entry || typeof entry !== 'object') { errors.push(`${path}: must be an object`); continue; }
    for (const field of PRIVATE_INSTANCE_FIELDS) {
      if (field in entry) errors.push(`${path}.${field}: private instance fields are forbidden in a metadata manifest`);
    }
    for (const field of ['id', 'version', 'department', 'workflowType', 'difficulty']) {
      if (!String(entry[field] ?? '').trim()) errors.push(`${path}.${field}: is required`);
    }
    if (!Array.isArray(entry.domainIds) || !entry.domainIds.length) errors.push(`${path}.domainIds: must be a non-empty array`);
    if (!Array.isArray(entry.competencyIds) || !entry.competencyIds.length) errors.push(`${path}.competencyIds: must be a non-empty array`);
    if (seen.has(entry.id)) errors.push(`${path}.id: duplicate scenario id`);
    seen.add(entry.id);
    scenarios.push({
      id: entry.id,
      version: entry.version,
      department: entry.department,
      workflowType: entry.workflowType,
      difficulty: entry.difficulty,
      domainIds: [...(entry.domainIds ?? [])],
      competencyIds: [...(entry.competencyIds ?? [])],
    });
  }
  return { valid: errors.length === 0, errors, scenarios };
}
