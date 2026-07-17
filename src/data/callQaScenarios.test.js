import { describe, expect, it } from 'vitest';
import * as bank from './callQaScenarios.js';
import { ASSESSED_DEPTS } from './departments.js';

describe('Call QA public coverage blueprint', () => {
  it('contains only anonymous aggregate requirements', () => {
    expect(Object.keys(bank).sort()).toEqual([
      'CALL_QA_COVERAGE_BLUEPRINT',
      'callQaScenarioCoverage',
    ]);
    expect(Object.keys(bank.CALL_QA_COVERAGE_BLUEPRINT).sort()).toEqual([...ASSESSED_DEPTS].sort());

    const serialized = JSON.stringify(bank.CALL_QA_COVERAGE_BLUEPRINT);
    for (const privateField of [
      'id', 'version', 'callerName', 'openingLine', 'publicBriefing', 'workflowType',
      'difficulty', 'domainIds', 'competencyIds', 'ruleIds', 'gradingContext',
      'expectedActions', 'criticalMisses', 'scoringNotes', 'hiddenChartState',
    ]) {
      expect(serialized).not.toContain(privateField);
    }
  });

  it('reports minimum coverage without exposing runtime scenarios', () => {
    expect(bank.callQaScenarioCoverage('pediatrics')).toEqual({
      department: 'pediatrics',
      assessed: true,
      minimumScenarioCount: 8,
    });
    expect(bank.callQaScenarioCoverage('obgyn')).toEqual({
      department: 'obgyn',
      assessed: true,
      minimumScenarioCount: 15,
    });
    expect(bank.callQaScenarioCoverage('unknown')).toEqual({
      department: 'unknown',
      assessed: false,
      minimumScenarioCount: 0,
    });
  });
});
