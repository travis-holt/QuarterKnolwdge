import { describe, expect, it } from 'vitest';
import {
  diffAgainstExisting,
  parseArgs,
  validateProvisioningPayload,
} from '../scripts/call-qa/provision-private-scenarios.mjs';
import { privateScenarioDocumentId } from './_call-qa-scenario-store.js';

function scenarioDoc(id, department, overrides = {}) {
  return {
    active: true,
    id,
    version: 'prov-v1',
    department,
    title: 'Fictional provisioning fixture',
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
    scoringNotes: [],
    hiddenChartState: null,
    callerCaseFile: {
      callerGoal: 'Resolve a fictional request.',
      knownFacts: ['A fictional consistent fact.'],
    },
    ruleIds: department === 'obgyn' ? ['rto_documentation'] : [],
    sourceSopVersion: null,
    sourceRuleVersion: null,
    sourceAuthority: null,
    ...overrides,
  };
}

function fullPayload() {
  return {
    scenarios: [
      ...Array.from({ length: 8 }, (_, index) => scenarioDoc(`prov-peds-${index}`, 'pediatrics')),
      ...Array.from({ length: 15 }, (_, index) => scenarioDoc(`prov-obgyn-${index}`, 'obgyn')),
    ],
  };
}

describe('provision-private-scenarios operator tool', () => {
  it('requires an explicit input path and project, and defaults to dry-run', () => {
    expect(() => parseArgs([])).toThrow(/--input/);
    expect(() => parseArgs(['--input', 'x.json'])).toThrow(/--project/);
    const options = parseArgs(['--input', 'x.json', '--project', 'proj-1']);
    expect(options.apply).toBe(false);
    expect(parseArgs(['--input', 'x.json', '--project', 'proj-1', '--apply']).apply).toBe(true);
  });

  it('accepts a payload meeting the anonymous minimums (8 peds / 15 obgyn)', () => {
    const { documents, activeByDepartment } = validateProvisioningPayload(fullPayload());
    expect(documents.size).toBe(23);
    expect(activeByDepartment).toEqual({ pediatrics: 8, obgyn: 15 });
  });

  it('rejects payloads below the minimums, with duplicates, or with invalid scenarios', () => {
    const short = fullPayload();
    short.scenarios = short.scenarios.slice(0, 10);
    expect(() => validateProvisioningPayload(short)).toThrow(/minimum/);

    const dupes = fullPayload();
    dupes.scenarios.push(scenarioDoc('prov-peds-0', 'pediatrics'));
    expect(() => validateProvisioningPayload(dupes)).toThrow(/Duplicate/);

    const missingCaseFile = fullPayload();
    delete missingCaseFile.scenarios[0].callerCaseFile;
    expect(() => validateProvisioningPayload(missingCaseFile)).toThrow(/caller case file/);

    const badRule = fullPayload();
    badRule.scenarios[10].ruleIds = ['nonexistent_rule'];
    expect(() => validateProvisioningPayload(badRule)).toThrow(/unknown OB\/GYN rule/);
  });

  it('diffs create/update/deactivate against the existing collection', () => {
    const { documents } = validateProvisioningPayload(fullPayload());
    const [firstId] = documents.keys();
    const existing = [
      { id: firstId, data: { active: true } },
      { id: 'stale__old-v0', data: { active: true } },
      { id: 'retired__old-v0', data: { active: false } },
    ];
    const diff = diffAgainstExisting(documents, existing);
    expect(diff.updates).toEqual([firstId]);
    expect(diff.creates).toHaveLength(22);
    expect(diff.deactivates).toEqual(['stale__old-v0']);
  });

  it('document identities bind id and version', () => {
    expect(privateScenarioDocumentId({ id: 'a', version: 'v2' })).toBe('a__v2');
  });
});
