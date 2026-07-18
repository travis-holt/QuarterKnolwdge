import { describe, expect, it, vi } from 'vitest';
import {
  CALL_QA_PRIVATE_SCENARIOS_COLLECTION,
  privateScenarioDocumentId,
  selectLoadedCallQaScenario,
  selectServerCallQaScenario,
  validatePrivateScenario,
} from './_call-qa-scenario-store.js';
import {
  getObgynWorkflowRule,
  OBGYN_RULE_SET_VERSION,
  OBGYN_SOP_VERSION,
  OBGYN_SOURCE_AUTHORITY,
} from '../src/data/obgynWorkflowRules.js';

// Valid OB/GYN rollout provenance: OB/GYN scenarios must carry the real,
// current constants — null provenance only remains legacy-tolerated for
// non-rollout (Pediatrics) fixtures.
const OBGYN_PROVENANCE = {
  sourceSopVersion: OBGYN_SOP_VERSION,
  sourceRuleVersion: OBGYN_RULE_SET_VERSION,
  sourceAuthority: OBGYN_SOURCE_AUTHORITY,
};

function privateScenario(id = 'qa-test-alpha', overrides = {}) {
  return {
    active: true,
    id,
    version: 'test-v1',
    department: 'pediatrics',
    title: 'Fictional test call',
    workflowType: 'fictional_workflow',
    difficulty: 'medium',
    primaryDomainId: 'intake',
    domainIds: ['intake'],
    competencyIds: ['communication'],
    callerName: 'Test Caller',
    openingLine: 'I need help with an administrative request.',
    publicBriefing: 'A caller asks for help with a fictional administrative request.',
    gradingContext: 'Use the fictional unit-test expectations for this call.',
    expectedActions: ['Complete the fictional observable step.'],
    criticalMisses: ['State the fictional unsafe outcome.'],
    scoringNotes: ['Accept natural wording in this fictional fixture.'],
    hiddenChartState: { fixture: true },
    callerCaseFile: {
      callerGoal: 'Get a fictional administrative request resolved.',
      knownFacts: ['Fictional fact the caller knows.', 'A second consistent fictional fact.'],
      factsToReveal: ['A fictional detail shared only when asked.'],
      revealRules: ['Do not volunteer the detail unprompted.'],
      behavior: ['Polite but slightly rushed.'],
      consistencyConstraints: ['Never contradict the fictional facts above.'],
    },
    ruleIds: [],
    sourceSopVersion: null,
    sourceRuleVersion: null,
    sourceAuthority: null,
    ...overrides,
  };
}

function fakeDb(data) {
  const where = vi.fn((field, op, value) => ({
    get: vi.fn(async () => ({
      docs: data
        .filter((item) => item.department === value)
        .map((item) => ({
          id: privateScenarioDocumentId(item),
          data: () => structuredClone(item),
        })),
    })),
  }));
  return {
    where,
    db: {
      collection: vi.fn((name) => {
        expect(name).toBe(CALL_QA_PRIVATE_SCENARIOS_COLLECTION);
        return { where };
      }),
    },
  };
}

describe('private Call QA scenario validation', () => {
  it('returns only the validated runtime allowlist', () => {
    const data = privateScenario('qa-test-alpha', { futurePrivateField: 'do not merge' });
    const result = validatePrivateScenario(data, {
      documentId: privateScenarioDocumentId(data),
      department: 'pediatrics',
    });
    expect(result).toMatchObject({
      id: data.id,
      publicBriefing: data.publicBriefing,
      gradingContext: data.gradingContext,
      expectedActions: data.expectedActions,
      hiddenChartState: data.hiddenChartState,
      callerCaseFile: data.callerCaseFile,
    });
    expect(result).not.toHaveProperty('active');
    expect(result).not.toHaveProperty('futurePrivateField');
  });

  it('derives narrow OB/GYN coverage from trusted rule ids', () => {
    const data = privateScenario('qa-test-obgyn', {
      department: 'obgyn',
      primaryDomainId: 'intake',
      domainIds: ['intake', 'classification', 'routing', 'scheduling', 'boundaries', 'documentation'],
      competencyIds: ['communication', 'riskManagement'],
      ruleIds: ['rto_documentation'],
      ...OBGYN_PROVENANCE,
    });
    const result = validatePrivateScenario(data, {
      documentId: privateScenarioDocumentId(data),
      department: 'obgyn',
    });
    const rule = getObgynWorkflowRule('rto_documentation');
    expect(result.primaryDomainId).toBe(rule.domainIds[0]);
    expect(result.domainIds).toEqual([...new Set(rule.domainIds)]);
    expect(result.competencyIds).toEqual([...new Set(rule.competencyIds)]);
    expect(result.domainIds).not.toHaveLength(data.domainIds.length);
  });

  it.each([
    ['document identity', (data) => ({ documentId: `${data.id}__wrong` })],
    ['department', () => ({ department: 'obgyn' })],
    ['grading context', (data) => ({ data: { ...data, gradingContext: '' } })],
    ['private arrays', (data) => ({ data: { ...data, expectedActions: [] } })],
    ['hidden chart shape', (data) => ({ data: { ...data, hiddenChartState: [] } })],
    ['missing caller case file', (data) => ({ data: { ...data, callerCaseFile: null } })],
    ['caller case file goal', (data) => ({ data: { ...data, callerCaseFile: { ...data.callerCaseFile, callerGoal: '' } } })],
    ['caller case file known facts', (data) => ({ data: { ...data, callerCaseFile: { ...data.callerCaseFile, knownFacts: [] } } })],
    ['caller case file reveal shape', (data) => ({ data: { ...data, callerCaseFile: { ...data.callerCaseFile, factsToReveal: 'not-an-array' } } })],
  ])('fails closed on invalid %s', (_label, mutate) => {
    const original = privateScenario();
    const changed = mutate(original);
    expect(() => validatePrivateScenario(changed.data ?? original, {
      documentId: changed.documentId ?? privateScenarioDocumentId(original),
      department: changed.department ?? 'pediatrics',
    })).toThrow();
  });
  it.each([
    ['null SOP version', { sourceSopVersion: null }],
    ['unsupported SOP version', { sourceSopVersion: 'obgyn-something-else' }],
    ['null rule-set version', { sourceRuleVersion: null }],
    ['stale rule-set version', { sourceRuleVersion: 'obgyn-workflow-rules-v1' }],
    ['null source authority', { sourceAuthority: null }],
    ['wrong source authority', { sourceAuthority: 'active-sop' }],
    ['empty rule ids', { ruleIds: [] }],
    ['unknown rule id', { ruleIds: ['no_such_rule'] }],
  ])('rejects an OB/GYN scenario with %s', (_label, overrides) => {
    const data = privateScenario('qa-test-obgyn-prov', {
      department: 'obgyn',
      ruleIds: ['rto_documentation'],
      ...OBGYN_PROVENANCE,
      ...overrides,
    });
    expect(() => validatePrivateScenario(data, {
      documentId: privateScenarioDocumentId(data),
      department: 'obgyn',
    })).toThrow();
  });

  it('pins OB/GYN scenarios to the owner-confirmed current-floor SOP version only', () => {
    // Launch contract: no dynamic active-SOP grounding for private Call QA
    // content — anything other than OBGYN_SOP_VERSION is rejected.
    const data = privateScenario('qa-test-obgyn-active-sop', {
      department: 'obgyn',
      ruleIds: ['rto_documentation'],
      ...OBGYN_PROVENANCE,
      sourceSopVersion: 'obgyn-active-sop-v9',
    });
    expect(() => validatePrivateScenario(data, {
      documentId: privateScenarioDocumentId(data),
      department: 'obgyn',
    })).toThrow(/SOP version is unsupported/);
    const pinned = privateScenario('qa-test-obgyn-pinned', {
      department: 'obgyn', ruleIds: ['rto_documentation'], ...OBGYN_PROVENANCE,
    });
    expect(validatePrivateScenario(pinned, {
      documentId: privateScenarioDocumentId(pinned),
      department: 'obgyn',
    }).sourceSopVersion).toBe(OBGYN_SOP_VERSION);
  });
});

describe('private Call QA scenario selection', () => {
  it('avoids the three most recent completed, unarchived scenario ids', () => {
    const scenarios = ['alpha', 'beta', 'delta', 'gamma'].map((suffix) => {
      const data = privateScenario(`qa-test-${suffix}`);
      return validatePrivateScenario(data, {
        documentId: privateScenarioDocumentId(data),
        department: 'pediatrics',
      });
    });
    const priorAttempts = scenarios.slice(0, 3).map((scenario, index) => ({
      department: 'pediatrics',
      qa: { score: 80 },
      endedAt: { seconds: 3 - index },
      qaScenarioId: scenario.id,
    }));
    for (const random of [() => 0, () => 0.5, () => 0.999]) {
      const selected = selectLoadedCallQaScenario(scenarios, {
        department: 'pediatrics',
        priorAttempts,
        random,
      });
      expect(selected.id).toBe('qa-test-gamma');
    }
  });

  it('chooses randomly among multiple eligible scenarios', () => {
    const scenarios = ['alpha', 'beta', 'delta', 'gamma'].map((suffix) => {
      const data = privateScenario(`qa-test-${suffix}`);
      return validatePrivateScenario(data, {
        documentId: privateScenarioDocumentId(data),
        department: 'pediatrics',
      });
    });
    const pickedIds = [0, 0.3, 0.6, 0.999].map((value) =>
      selectLoadedCallQaScenario(scenarios, {
        department: 'pediatrics',
        priorAttempts: [],
        random: () => value,
      }).id);
    expect(new Set(pickedIds).size).toBe(4);
    expect(pickedIds.sort()).toEqual(['qa-test-alpha', 'qa-test-beta', 'qa-test-delta', 'qa-test-gamma']);
  });

  it('falls back to a random choice among the full set when every scenario is recent', () => {
    const scenarios = ['alpha', 'beta', 'delta'].map((suffix) => {
      const data = privateScenario(`qa-test-${suffix}`);
      return validatePrivateScenario(data, {
        documentId: privateScenarioDocumentId(data),
        department: 'pediatrics',
      });
    });
    const priorAttempts = scenarios.map((scenario, index) => ({
      department: 'pediatrics',
      qa: { score: 80 },
      endedAt: { seconds: 3 - index },
      qaScenarioId: scenario.id,
    }));
    const first = selectLoadedCallQaScenario(scenarios, {
      department: 'pediatrics', priorAttempts, random: () => 0,
    });
    const last = selectLoadedCallQaScenario(scenarios, {
      department: 'pediatrics', priorAttempts, random: () => 0.999,
    });
    expect(first.id).toBe('qa-test-alpha');
    expect(last.id).toBe('qa-test-delta');
  });

  it('never selects a scenario from another department regardless of the random draw', () => {
    const data = privateScenario('qa-test-obgyn-only', {
      department: 'obgyn', ruleIds: ['rto_documentation'], ...OBGYN_PROVENANCE,
    });
    const scenario = validatePrivateScenario(data, {
      documentId: privateScenarioDocumentId(data),
      department: 'obgyn',
    });
    expect(selectLoadedCallQaScenario([scenario], {
      department: 'pediatrics', priorAttempts: [], random: () => 0,
    })).toBeNull();
  });

  it('queries by department, ignores inactive docs, and returns a validated scenario', async () => {
    const active = privateScenario();
    const inactive = privateScenario('qa-test-inactive', { active: false });
    const other = privateScenario('qa-test-other', { department: 'obgyn' });
    const { db, where } = fakeDb([inactive, other, active]);

    const selected = await selectServerCallQaScenario(db, {
      department: 'pediatrics',
      priorAttempts: [],
    });

    expect(where).toHaveBeenCalledWith('department', '==', 'pediatrics');
    expect(selected.id).toBe(active.id);
    expect(selected.publicBriefing).toBe(active.publicBriefing);
    expect(selected.gradingContext).toBe(active.gradingContext);
  });

  it('returns null when the department has no active private scenarios', async () => {
    const { db } = fakeDb([privateScenario('qa-test-inactive', { active: false })]);
    await expect(selectServerCallQaScenario(db, {
      department: 'pediatrics',
      priorAttempts: [],
    })).resolves.toBeNull();
  });
});
