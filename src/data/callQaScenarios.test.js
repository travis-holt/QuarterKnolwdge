import { describe, expect, it } from 'vitest';
import {
  CALL_QA_SCENARIOS,
  QA_WORKFLOW_TYPES,
  getQaScenarios,
  qaScenarioCoverage,
  selectQaScenario,
} from './callQaScenarios.js';

const REQUIRED_FIELDS = [
  'id',
  'department',
  'title',
  'callerName',
  'openingLine',
  'scenario',
  'primaryDomainId',
  'domainIds',
  'competencyIds',
  'workflowType',
  'difficulty',
  'expectedActions',
  'autoFailTraps',
  'routingRules',
  'scoringNotes',
];

const DOMAIN_IDS = new Set(['intake', 'classification', 'routing', 'scheduling', 'boundaries', 'documentation']);
const COMPETENCY_IDS = new Set([
  'sopKnowledge',
  'sopApplication',
  'criticalThinking',
  'customerHandling',
  'communication',
  'riskManagement',
  'escalation',
  'compliance',
  'problemResolution',
]);
const DIFFICULTIES = new Set(['standard', 'complex', 'critical']);

describe('CALL_QA_SCENARIOS', () => {
  it('has unique ids and required fields', () => {
    const ids = new Set();
    for (const scenario of CALL_QA_SCENARIOS) {
      for (const field of REQUIRED_FIELDS) {
        expect(scenario[field], `${scenario.id || 'unknown'} missing ${field}`).toBeDefined();
      }
      expect(ids.has(scenario.id), `duplicate id ${scenario.id}`).toBe(false);
      ids.add(scenario.id);
      expect(['pediatrics', 'obgyn']).toContain(scenario.department);
      expect(QA_WORKFLOW_TYPES).toContain(scenario.workflowType);
      expect(DIFFICULTIES.has(scenario.difficulty)).toBe(true);
      expect(DOMAIN_IDS.has(scenario.primaryDomainId)).toBe(true);
      expect(scenario.domainIds.length).toBeGreaterThan(0);
      expect(scenario.competencyIds.length).toBeGreaterThan(0);
      expect(scenario.expectedActions.length).toBeGreaterThan(0);
      for (const id of scenario.domainIds) expect(DOMAIN_IDS.has(id), `${scenario.id} bad domain ${id}`).toBe(true);
      for (const id of scenario.competencyIds) expect(COMPETENCY_IDS.has(id), `${scenario.id} bad competency ${id}`).toBe(true);
    }
  });

  it('contains at least 8 scenarios for Pediatrics and OB/GYN', () => {
    expect(getQaScenarios('pediatrics')).toHaveLength(8);
    expect(getQaScenarios('obgyn')).toHaveLength(8);
  });

  it('covers the critical workflow types needed for management-grade QA', () => {
    const requiredPeds = new Set([
      'scheduling',
      'refill',
      'lab-result',
      'urgent-escalation',
      'angry-caller',
      'privacy-verification',
      'multi-patient',
      'documentation-routing',
    ]);
    const pedsWorkflows = new Set(getQaScenarios('pediatrics').map((s) => s.workflowType));
    for (const workflow of requiredPeds) expect(pedsWorkflows.has(workflow), `missing peds ${workflow}`).toBe(true);

    const requiredObgyn = new Set([
      'pregnancy-routing',
      'documentation-routing',
      'mfm-routing',
      'lab-result',
      'urgent-escalation',
      'angry-caller',
      'privacy-verification',
      'refill',
    ]);
    const obgynWorkflows = new Set(getQaScenarios('obgyn').map((s) => s.workflowType));
    for (const workflow of requiredObgyn) expect(obgynWorkflows.has(workflow), `missing obgyn ${workflow}`).toBe(true);
  });
});

describe('selectQaScenario', () => {
  it('returns a scenario from the requested department', () => {
    expect(selectQaScenario({ department: 'pediatrics' })?.department).toBe('pediatrics');
    expect(selectQaScenario({ department: 'obgyn' })?.department).toBe('obgyn');
  });

  it('avoids recently used scenario ids when alternatives exist', () => {
    const recent = getQaScenarios('pediatrics').slice(0, 3).map((s, i) => ({
      qaScenarioId: s.id,
      endedAt: { seconds: 100 - i },
      workflowType: s.workflowType,
    }));
    const selected = selectQaScenario({ department: 'pediatrics', priorAttempts: recent });
    expect(recent.map((a) => a.qaScenarioId)).not.toContain(selected.id);
  });

  it('prefers underused workflows', () => {
    const priorAttempts = [
      { qaScenarioId: 'old-1', workflowType: 'refill', endedAt: { seconds: 1 } },
      { qaScenarioId: 'old-2', workflowType: 'refill', endedAt: { seconds: 2 } },
      { qaScenarioId: 'old-3', workflowType: 'lab-result', endedAt: { seconds: 3 } },
    ];
    const selected = selectQaScenario({ department: 'pediatrics', priorAttempts });
    expect(['refill', 'lab-result']).not.toContain(selected.workflowType);
  });

  it('returns null when a department has no QA scenarios', () => {
    expect(selectQaScenario({ department: 'adultMedicine' })).toBeNull();
  });
});

describe('qaScenarioCoverage', () => {
  it('summarizes coverage by workflow and difficulty', () => {
    const coverage = qaScenarioCoverage('obgyn');
    expect(coverage.total).toBe(8);
    expect(coverage.byWorkflow['pregnancy-routing']).toBe(1);
    expect(coverage.byWorkflow['mfm-routing']).toBe(1);
    expect(coverage.byDifficulty.critical).toBeGreaterThan(0);
  });
});
