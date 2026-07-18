import { ASSESSED_DEPTS } from './departments.js';

// Anonymous product requirements only. Runtime Call QA scenario instances and
// their metadata live exclusively in the server-only Firestore bank.
//
// Scored Call QA rollout scope: only departments listed here have a scored
// Call QA phase, a private-bank provisioning minimum, and runtime coverage
// requirements. A department can be assessed (MCQ/Spot live) without being in
// the scored Call QA rollout — Pediatrics keeps its MCQ/Spot/practice features
// and historical QA attempts, but is NOT part of this rollout. Adding a
// department later is a configuration change here (plus private provisioning),
// not another security redesign.
export const CALL_QA_ROLLOUT_DEPARTMENTS = Object.freeze(['obgyn']);

export function isCallQaRolloutDept(department) {
  return CALL_QA_ROLLOUT_DEPARTMENTS.includes(department);
}

export const CALL_QA_COVERAGE_BLUEPRINT = Object.freeze({
  obgyn: Object.freeze({ minimumScenarioCount: 15 }),
});

export function callQaScenarioCoverage(department) {
  return {
    department,
    assessed: ASSESSED_DEPTS.includes(department),
    inCallQaRollout: isCallQaRolloutDept(department),
    minimumScenarioCount: CALL_QA_COVERAGE_BLUEPRINT[department]?.minimumScenarioCount ?? 0,
  };
}
