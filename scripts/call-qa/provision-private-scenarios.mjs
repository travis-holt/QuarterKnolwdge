// Operator-only provisioning for the PRIVATE Call QA scenario bank.
//
//   node scripts/call-qa/provision-private-scenarios.mjs \
//     --input private-call-qa/scenarios.json --project <firebase-project-id> [--apply]
//
// Reads an IGNORED local JSON file supplied explicitly by the operator (never
// committed; see .gitignore: private-call-qa/, call-qa-private*.json), validates
// every scenario through the production validator, and shows what would change
// in the Admin-only `callQaScenariosPrivate` collection. DRY-RUN by default:
// writes require an explicit --apply. Requires an explicit --project that must
// match the service-account project. Never prints hidden facts, answers,
// briefings, opening lines, or caller case files — logs carry ids/versions and
// counts only. This script is never invoked by app startup, build, tests, or
// deployment; it is a deliberate operator action.
//
// Input shape: { "scenarios": [ <full private scenario document>, ... ] }
// Each document must satisfy validatePrivateScenario (including callerCaseFile)
// and carries `active: true|false`. Firestore document ids are `${id}__${version}`.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CALL_QA_PRIVATE_SCENARIOS_COLLECTION,
  privateScenarioDocumentId,
  validatePrivateScenario,
} from '../../api/_call-qa-scenario-store.js';
import {
  CALL_QA_COVERAGE_BLUEPRINT,
  CALL_QA_ROLLOUT_DEPARTMENTS,
  isCallQaRolloutDept,
} from '../../src/data/callQaScenarios.js';

export function parseArgs(argv) {
  const options = { input: null, project: null, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input' || arg === '--project') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg === '--apply') options.apply = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.input) throw new Error('--input <ignored-local-json-path> is required');
  if (!options.project) throw new Error('--project <firebase-project-id> is required (explicit confirmation of the target project)');
  return options;
}

// Validate the full operator payload. Returns per-department counts and the
// validated documents; throws on ANY invalid scenario, duplicate identity, or
// coverage below the anonymous minimums.
export function validateProvisioningPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.scenarios)) {
    throw new Error('Input must be a JSON object with a "scenarios" array.');
  }
  const documents = new Map();
  const activeByDepartment = {};
  for (const [index, raw] of payload.scenarios.entries()) {
    // Only scored-rollout departments may be provisioned (currently OB/GYN
    // only). No Pediatrics section is required — or accepted — in this rollout.
    if (!isCallQaRolloutDept(raw?.department)) {
      throw new Error(`Scenario at index ${index} targets department "${raw?.department}", which is not in the scored Call QA rollout (${CALL_QA_ROLLOUT_DEPARTMENTS.join(', ')}).`);
    }
    const documentId = privateScenarioDocumentId({ id: raw?.id, version: raw?.version });
    if (documents.has(documentId)) {
      throw new Error(`Duplicate scenario identity ${documentId} at index ${index}.`);
    }
    if (raw?.active === true) {
      // The production validator only accepts active docs; run it as-is.
      const validated = validatePrivateScenario(raw, { documentId, department: raw?.department });
      activeByDepartment[validated.department] = (activeByDepartment[validated.department] ?? 0) + 1;
      documents.set(documentId, { ...raw });
    } else if (raw?.active === false) {
      // Inactive docs are validated with active temporarily true so a retired
      // scenario still has to be structurally sound before it is stored.
      validatePrivateScenario({ ...raw, active: true }, { documentId, department: raw?.department });
      documents.set(documentId, { ...raw });
    } else {
      throw new Error(`Scenario at index ${index} must set active: true or false.`);
    }
  }
  for (const [department, { minimumScenarioCount }] of Object.entries(CALL_QA_COVERAGE_BLUEPRINT)) {
    const count = activeByDepartment[department] ?? 0;
    if (count < minimumScenarioCount) {
      throw new Error(`Department ${department} has ${count} active scenarios; the minimum is ${minimumScenarioCount}.`);
    }
  }
  return { documents, activeByDepartment };
}

// Produces a deterministic, type-preserving JSON-comparable representation.
// Recovered manifests are plain JSON; Firestore Timestamps serialize as
// _seconds/_nanoseconds while the Admin SDK exposes seconds/nanoseconds.
export function normalizeComparableValue(value) {
  if (value === undefined) return ['undefined'];
  if (value === null) return ['null'];
  if (value instanceof Date) return ['date', value.getTime()];
  if (typeof value === 'object') {
    const seconds = value.seconds ?? value._seconds;
    const nanoseconds = value.nanoseconds ?? value._nanoseconds;
    if (typeof seconds === 'number' && typeof nanoseconds === 'number') {
      return ['timestamp', seconds, nanoseconds];
    }
    if (Array.isArray(value)) return ['array', value.map(normalizeComparableValue)];
    return ['object', Object.keys(value).sort().map((key) => [key, normalizeComparableValue(value[key])])];
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return ['number', 'NaN'];
    if (Object.is(value, -0)) return ['number', '-0'];
  }
  return [typeof value, value];
}

export function semanticallyEqual(left, right) {
  return JSON.stringify(normalizeComparableValue(left)) === JSON.stringify(normalizeComparableValue(right));
}

export function diffAgainstExisting(documents, existingDocs) {
  const existing = new Map(existingDocs.map((doc) => [doc.id, doc.data]));
  const creates = [];
  const updates = [];
  const unchanged = [];
  const deactivates = [];
  for (const [documentId, data] of documents) {
    if (!existing.has(documentId)) creates.push(documentId);
    else if (semanticallyEqual(data, existing.get(documentId))) unchanged.push(documentId);
    else updates.push(documentId);
  }
  for (const [documentId, data] of existing) {
    // Only rollout-department documents are managed by this manifest. An
    // OB/GYN-only manifest must never deactivate a Pediatrics (or other
    // out-of-scope) document that happens to exist in the collection.
    if (!isCallQaRolloutDept(data?.department)) continue;
    if (!documents.has(documentId) && data?.active === true) deactivates.push(documentId);
  }
  return { creates, updates, unchanged, deactivates };
}

export async function applyProvisioningChanges({ collection, documents, creates, updates, deactivates }) {
  for (const documentId of [...creates, ...updates]) {
    const data = documents.get(documentId);
    if (!data) throw new Error(`Missing validated data for ${documentId}.`);
    await collection.doc(documentId).set(data);
  }
  for (const documentId of deactivates) {
    await collection.doc(documentId).set({ active: false }, { merge: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(await readFile(path.resolve(options.input), 'utf8'));
  const { documents, activeByDepartment } = validateProvisioningPayload(payload);
  console.log(`Validated ${documents.size} private scenario documents.`);
  for (const [department, count] of Object.entries(activeByDepartment)) {
    console.log(`  active ${department}: ${count} (minimum ${CALL_QA_COVERAGE_BLUEPRINT[department]?.minimumScenarioCount ?? 0})`);
  }

  const { getFirebaseAdmin } = await import('../../api/_firebase-admin.js');
  const admin = getFirebaseAdmin();
  const configuredProject = admin.app?.options?.projectId
    ?? admin.app?.options?.credential?.projectId ?? null;
  if (configuredProject && configuredProject !== options.project) {
    throw new Error(`--project ${options.project} does not match the configured service-account project (${configuredProject}). Refusing to run.`);
  }
  const collection = admin.db.collection(CALL_QA_PRIVATE_SCENARIOS_COLLECTION);
  const snap = await collection.get();
  const { creates, updates, unchanged, deactivates } = diffAgainstExisting(
    documents,
    snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  );
  console.log(`Would create: ${creates.length} · update: ${updates.length} · deactivate: ${deactivates.length} · unchanged: ${unchanged.length}`);

  if (!options.apply) {
    console.log('DRY RUN — no writes performed. Re-run with --apply to write.');
    return;
  }
  await applyProvisioningChanges({ collection, documents, creates, updates, deactivates });
  console.log(`Applied: ${creates.length} created, ${updates.length} updated, ${deactivates.length} deactivated.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
