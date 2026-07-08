import { describe, expect, it } from 'vitest';
import {
  CALL_QA_SCENARIOS,
  callQaScenarioCoverage,
  selectCallQaScenario,
} from './callQaScenarios.js';
import { DOMAINS } from './questions.js';
import { COMPETENCIES } from './competencies.js';
import { ASSESSED_DEPTS } from './departments.js';

const domainIds = new Set(DOMAINS.map((domain) => domain.id));
const competencyIds = new Set(COMPETENCIES.map((competency) => competency.id));

const REQUIRED_WORKFLOWS = {
  pediatrics: [
    'new_appointment_scheduling',
    'multiple_siblings_family_lookup',
    'referral',
    'prescription_refill',
    'records_forms',
    'urgent_symptom_boundary',
    'insurance_eligibility_confusion',
    'wrong_department_unclear_request',
  ],
  obgyn: [
    'new_gyn_visit',
    'pregnancy_related_visit',
    'mfm_related_request',
    'prescription_refill',
    'test_result_medical_advice_boundary',
    'scheduling_change',
    'records_forms',
    'wrong_department_unclear_request',
  ],
};

describe('CALL_QA_SCENARIOS', () => {
  it('has unique scenario ids', () => {
    const ids = CALL_QA_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has valid required fields and tags', () => {
    for (const scenario of CALL_QA_SCENARIOS) {
      expect(ASSESSED_DEPTS).toContain(scenario.department);
      expect(scenario.title).toBeTruthy();
      expect(scenario.workflowType).toBeTruthy();
      expect(['easy', 'medium', 'hard']).toContain(scenario.difficulty);
      expect(scenario.scenario).toBeTruthy();
      expect(scenario.callerName).toBeTruthy();
      expect(scenario.openingLine).toBeTruthy();
      expect(scenario.domainIds?.length).toBeGreaterThan(0);
      expect(scenario.competencyIds?.length).toBeGreaterThan(0);
      expect(scenario.expectedActions?.length).toBeGreaterThan(0);
      expect(scenario.criticalMisses?.length).toBeGreaterThan(0);
      for (const id of scenario.domainIds) expect(domainIds.has(id)).toBe(true);
      for (const id of scenario.competencyIds) expect(competencyIds.has(id)).toBe(true);
    }
  });

  it('has at least 8 scenarios for each live department', () => {
    for (const dept of ASSESSED_DEPTS) {
      expect(callQaScenarioCoverage(dept).count).toBeGreaterThanOrEqual(8);
    }
  });

  it('covers required Pediatrics and OB/GYN workflows', () => {
    for (const [department, workflows] of Object.entries(REQUIRED_WORKFLOWS)) {
      const covered = callQaScenarioCoverage(department).workflowCounts;
      for (const workflow of workflows) {
        expect(covered[workflow]).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('selectCallQaScenario', () => {
  it('avoids recent active QA scenario ids when possible', () => {
    const scenarios = CALL_QA_SCENARIOS.filter((scenario) => scenario.department === 'pediatrics');
    const selected = selectCallQaScenario({
      department: 'pediatrics',
      priorAttempts: [
        { department: 'pediatrics', qa: { score: 90 }, endedAt: { seconds: 3 }, qaScenarioId: scenarios[0].id },
        { department: 'pediatrics', qa: { score: 88 }, endedAt: { seconds: 2 }, qaScenarioId: scenarios[1].id },
        { department: 'pediatrics', qa: { score: 80 }, endedAt: { seconds: 1 }, qaScenarioId: scenarios[2].id },
      ],
    });
    expect(selected.id).toBe(scenarios[3].id);
  });

  it('does not repeat a very recent scenario just because all scenarios were used historically', () => {
    const scenarios = CALL_QA_SCENARIOS.filter((scenario) => scenario.department === 'obgyn');
    const selected = selectCallQaScenario({
      department: 'obgyn',
      priorAttempts: scenarios.map((scenario, index) => ({
        department: 'obgyn',
        qa: { score: 80 },
        endedAt: { seconds: scenarios.length - index },
        qaScenarioId: scenario.id,
      })),
    });
    expect(selected.id).toBe(scenarios[3].id);
  });
});
