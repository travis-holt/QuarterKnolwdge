// Operator-only, READ-ONLY recovery of the PRIVATE Call QA scenario bank.
//
//   node --import ./load-env.js scripts/call-qa/recover-private-scenarios.mjs \
//     --project <firebase-project-id> [--output private-call-qa/scenarios.json]
//
// WHY THIS EXISTS. The private scenario bank is deliberately never committed
// (see .gitignore: private-call-qa/, call-qa-private*.json), so the ONLY copy of
// the operator authoring manifest lives on the operator's machine. When that
// local manifest is lost, the provisioning tool has no trusted input and every
// schema-compatibility change is blocked. This command reconstructs the manifest
// from the collection that is already the live source of truth.
//
// HARD GUARANTEES:
//   * READ-ONLY. It calls `.get()` on exactly ONE collection
//     (`callQaScenariosPrivate`) and performs ZERO Firestore writes. There is no
//     `--apply`, no `set`, no `update`, no `delete`, and no other collection is
//     touched.
//   * Requires an EXPLICIT `--project` and refuses to run when it does not match
//     the configured service-account project.
//   * Refuses to write anywhere Git tracks. The destination must be ignored by
//     `git check-ignore` AND absent from `git ls-files`, so a recovered private
//     manifest can never be staged or committed by accident.
//   * NEVER prints scenario content. No opening lines, public briefings, grading
//     context, expected actions, critical misses, scoring notes, hidden chart
//     state, caller case files, navigator chart state, identifiers, or secrets.
//     Logs carry counts and department names only.
//   * Recovers documents VERBATIM. It does not edit, normalize, or re-author
//     scenario content — compatibility authoring is a separate, explicit step.
//
// This script is never invoked by app startup, build, tests, or deployment; it is
// a deliberate operator action.

import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CALL_QA_PRIVATE_SCENARIOS_COLLECTION,
} from '../../api/_call-qa-scenario-store.js';
import { isCallQaRolloutDept } from '../../src/data/callQaScenarios.js';

const DEFAULT_OUTPUT = 'private-call-qa/scenarios.json';

export function parseArgs(argv) {
  const options = { project: null, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project' || arg === '--output') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = value;
      index += 1;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.project) {
    throw new Error('--project <firebase-project-id> is required (explicit confirmation of the source project)');
  }
  return options;
}

/**
 * Build the provisioning-tool manifest from recovered Firestore documents.
 *
 * Documents are copied VERBATIM. Only scored-rollout departments are placed in
 * the manifest, because that is the scope the provisioning tool manages and
 * `validateProvisioningPayload` rejects anything else. Out-of-scope documents are
 * never silently dropped: they are COUNTED and reported so the operator can see
 * that the collection holds more than the manifest describes.
 *
 * Ordering is deterministic (by document id) so re-running produces a stable file.
 */
export function buildRecoveredManifest(docs) {
  const scenarios = [];
  const counts = { total: docs.length, byDepartment: {}, skippedNonRollout: 0 };
  const sorted = [...docs].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const doc of sorted) {
    const data = doc?.data ?? {};
    const department = data.department;
    if (!isCallQaRolloutDept(department)) {
      counts.skippedNonRollout += 1;
      continue;
    }
    const bucket = counts.byDepartment[department] ?? { active: 0, inactive: 0 };
    if (data.active === true) bucket.active += 1; else bucket.inactive += 1;
    counts.byDepartment[department] = bucket;
    scenarios.push(data);
  }
  return { manifest: { scenarios }, counts };
}

function git(args) {
  return new Promise((resolve) => {
    execFile('git', args, (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? '') }));
  });
}

/**
 * Fail closed unless the destination is BOTH ignored by Git and untracked.
 * A recovered private manifest must never be stageable.
 */
export async function assertDestinationIsPrivate(relativePath, runGit = git) {
  const ignored = await runGit(['check-ignore', '--quiet', relativePath]);
  if (!ignored.ok) {
    throw new Error(`Refusing to write: ${relativePath} is NOT ignored by Git. Add it to .gitignore first.`);
  }
  const tracked = await runGit(['ls-files', '--error-unmatch', relativePath]);
  if (tracked.ok) {
    throw new Error(`Refusing to write: ${relativePath} is TRACKED by Git.`);
  }
  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const relativeOutput = options.output.split(path.sep).join('/');

  // Prove the destination is private BEFORE any Firestore access, so an unsafe
  // path aborts the run without reading anything.
  await assertDestinationIsPrivate(relativeOutput);
  console.log(`Destination ${relativeOutput} is gitignored and untracked.`);

  const { getFirebaseAdmin } = await import('../../api/_firebase-admin.js');
  const admin = getFirebaseAdmin();
  const configuredProject = admin.app?.options?.projectId
    ?? admin.app?.options?.credential?.projectId ?? null;
  if (configuredProject && configuredProject !== options.project) {
    throw new Error(`--project ${options.project} does not match the configured service-account project. Refusing to run.`);
  }
  console.log('Service-account project matches --project.');

  // The ONLY Firestore operation in this script: one read of one collection.
  const snap = await admin.db.collection(CALL_QA_PRIVATE_SCENARIOS_COLLECTION).get();
  const docs = snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  const { manifest, counts } = buildRecoveredManifest(docs);

  console.log(`Recovered ${counts.total} document(s) from ${CALL_QA_PRIVATE_SCENARIOS_COLLECTION} (read-only).`);
  for (const [department, bucket] of Object.entries(counts.byDepartment)) {
    console.log(`  ${department}: active ${bucket.active} · inactive ${bucket.inactive}`);
  }
  if (counts.skippedNonRollout > 0) {
    console.log(`  out-of-scope (non-rollout department) documents not placed in the manifest: ${counts.skippedNonRollout}`);
  }

  await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await writeFile(path.resolve(options.output), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${manifest.scenarios.length} scenario(s) to ${relativeOutput}.`);
  console.log('ZERO Firestore writes were performed.');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
