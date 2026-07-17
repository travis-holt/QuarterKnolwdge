import { ASSESSED_DEPTS } from './departments.js';

// Anonymous product requirements only. Runtime Call QA scenario instances and
// their metadata live exclusively in the server-only Firestore bank.
export const CALL_QA_COVERAGE_BLUEPRINT = Object.freeze({
  pediatrics: Object.freeze({ minimumScenarioCount: 8 }),
  obgyn: Object.freeze({ minimumScenarioCount: 15 }),
});

export function callQaScenarioCoverage(department) {
  return {
    department,
    assessed: ASSESSED_DEPTS.includes(department),
    minimumScenarioCount: CALL_QA_COVERAGE_BLUEPRINT[department]?.minimumScenarioCount ?? 0,
  };
}
