import { getFirebaseAdmin } from '../../api/_firebase-admin.js';
import { CALL_QA_PRIVATE_SCENARIOS_COLLECTION, validatePrivateScenario } from '../../api/_call-qa-scenario-store.js';
import { CALL_QA_ROLLOUT_DEPARTMENTS } from '../../src/data/callQaScenarios.js';

const db = getFirebaseAdmin().db;
const snap = await db.collection(CALL_QA_PRIVATE_SCENARIOS_COLLECTION).get();
const validActiveByDepartment = new Map();
let failedActive = 0;

for (const doc of snap.docs) {
  const data = doc.data();
  const department = String(data?.department ?? 'unknown');
  try {
    validatePrivateScenario(data, { documentId: doc.id, department });
    console.log(`PASS  ${doc.id}  ${department}`);
    if (data?.active === true) validActiveByDepartment.set(department, (validActiveByDepartment.get(department) ?? 0) + 1);
  } catch (error) {
    console.log(`FAIL  ${doc.id}  ${department}  ${error?.message ?? error}`);
    if (data?.active === true) failedActive += 1;
  }
}

let insufficient = 0;
for (const department of CALL_QA_ROLLOUT_DEPARTMENTS) {
  const count = validActiveByDepartment.get(department) ?? 0;
  console.log(`SUMMARY  ${department}: ${count} valid active scenario(s)`);
  if (count < 15) insufficient += 1;
}

if (failedActive || insufficient) process.exitCode = 1;
