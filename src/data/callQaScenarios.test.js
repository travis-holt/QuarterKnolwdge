import { describe, expect, it } from 'vitest';
import * as bank from './callQaScenarios.js';

describe('Call QA public coverage blueprint', () => {
  it('contains only anonymous aggregate/rollout configuration', () => {
    expect(Object.keys(bank).sort()).toEqual([
      'CALL_QA_COVERAGE_BLUEPRINT',
      'CALL_QA_ROLLOUT_DEPARTMENTS',
      'callQaScenarioCoverage',
      'isCallQaRolloutDept',
    ]);
    expect(Object.keys(bank.CALL_QA_COVERAGE_BLUEPRINT)).toEqual(['obgyn']);

    const serialized = JSON.stringify(bank.CALL_QA_COVERAGE_BLUEPRINT);
    for (const privateField of [
      'id', 'version', 'callerName', 'openingLine', 'publicBriefing', 'workflowType',
      'difficulty', 'domainIds', 'competencyIds', 'ruleIds', 'gradingContext',
      'expectedActions', 'criticalMisses', 'scoringNotes', 'hiddenChartState',
      'callerCaseFile',
    ]) {
      expect(serialized).not.toContain(privateField);
    }
  });

  it('scopes the scored Call QA rollout to OB/GYN only', () => {
    expect(bank.CALL_QA_ROLLOUT_DEPARTMENTS).toEqual(['obgyn']);
    expect(bank.isCallQaRolloutDept('obgyn')).toBe(true);
    expect(bank.isCallQaRolloutDept('pediatrics')).toBe(false);
  });

  it('reports minimum coverage without exposing runtime scenarios', () => {
    expect(bank.callQaScenarioCoverage('obgyn')).toEqual({
      department: 'obgyn',
      assessed: true,
      inCallQaRollout: true,
      minimumScenarioCount: 15,
    });
    // Pediatrics stays assessed (MCQ/Spot) but is outside the scored rollout:
    // no private-bank minimum and no Call QA provisioning requirement.
    expect(bank.callQaScenarioCoverage('pediatrics')).toEqual({
      department: 'pediatrics',
      assessed: true,
      inCallQaRollout: false,
      minimumScenarioCount: 0,
    });
    expect(bank.callQaScenarioCoverage('unknown')).toEqual({
      department: 'unknown',
      assessed: false,
      inCallQaRollout: false,
      minimumScenarioCount: 0,
    });
  });
});
