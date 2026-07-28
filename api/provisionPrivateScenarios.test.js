import { describe, expect, it } from 'vitest';
import {
  applyProvisioningChanges,
  diffAgainstExisting,
  parseArgs,
  validateProvisioningPayload,
} from '../scripts/call-qa/provision-private-scenarios.mjs';
import { privateScenarioDocumentId } from './_call-qa-scenario-store.js';
import {
  OBGYN_RULE_SET_VERSION,
  OBGYN_SOP_VERSION,
  OBGYN_SOURCE_AUTHORITY,
} from '../src/data/obgynWorkflowRules.js';

function scenarioDoc(id, overrides = {}) {
  return {
    active: true,
    id,
    version: 'prov-v1',
    department: 'obgyn',
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
    requiresNavigatorChartContext: false,
    callerCaseFile: {
      callerGoal: 'Resolve a fictional request.',
      knownFacts: ['A fictional consistent fact.'],
    },
    ruleIds: ['rto_documentation'],
    sourceSopVersion: OBGYN_SOP_VERSION,
    sourceRuleVersion: OBGYN_RULE_SET_VERSION,
    sourceAuthority: OBGYN_SOURCE_AUTHORITY,
    ...overrides,
  };
}

function fullPayload() {
  return {
    scenarios: Array.from({ length: 15 }, (_, index) => scenarioDoc(`prov-obgyn-${index}`)),
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

  it('accepts an OB/GYN-only payload meeting the 15-scenario minimum, with no Pediatrics section', () => {
    const { documents, activeByDepartment } = validateProvisioningPayload(fullPayload());
    expect(documents.size).toBe(15);
    expect(activeByDepartment).toEqual({ obgyn: 15 });
  });

  it('rejects fewer than 15 active OB/GYN scenarios', () => {
    const short = fullPayload();
    short.scenarios = short.scenarios.slice(0, 14);
    expect(() => validateProvisioningPayload(short)).toThrow(/minimum/);
  });

  it('rejects Pediatrics (non-rollout) scenarios instead of requiring them', () => {
    const withPeds = fullPayload();
    withPeds.scenarios.push(scenarioDoc('prov-peds-0', {
      department: 'pediatrics',
      ruleIds: [],
      sourceSopVersion: null,
      sourceRuleVersion: null,
      sourceAuthority: null,
    }));
    expect(() => validateProvisioningPayload(withPeds)).toThrow(/not in the scored Call QA rollout/);
  });

  it('rejects duplicates, missing caller case files, missing provenance, and bad rule ids', () => {
    const dupes = fullPayload();
    dupes.scenarios.push(scenarioDoc('prov-obgyn-0'));
    expect(() => validateProvisioningPayload(dupes)).toThrow(/Duplicate/);

    const missingCaseFile = fullPayload();
    delete missingCaseFile.scenarios[0].callerCaseFile;
    expect(() => validateProvisioningPayload(missingCaseFile)).toThrow(/caller case file/);

    const nullProvenance = fullPayload();
    nullProvenance.scenarios[3].sourceRuleVersion = null;
    expect(() => validateProvisioningPayload(nullProvenance)).toThrow(/rule-set version/);

    const emptyRules = fullPayload();
    emptyRules.scenarios[5].ruleIds = [];
    expect(() => validateProvisioningPayload(emptyRules)).toThrow(/rule ids/);

    const badRule = fullPayload();
    badRule.scenarios[10].ruleIds = ['nonexistent_rule'];
    expect(() => validateProvisioningPayload(badRule)).toThrow(/unknown OB\/GYN rule/);
  });

  it('diffs create/update/deactivate against the existing collection', () => {
    const { documents } = validateProvisioningPayload(fullPayload());
    const [firstId] = documents.keys();
    const existing = [
      { id: firstId, data: { active: true, department: 'obgyn' } },
      { id: 'stale__old-v0', data: { active: true, department: 'obgyn' } },
      { id: 'retired__old-v0', data: { active: false, department: 'obgyn' } },
    ];
    const diff = diffAgainstExisting(documents, existing);
    expect(diff.updates).toEqual([firstId]);
    expect(diff.unchanged).toEqual([]);
    expect(diff.creates).toHaveLength(14);
    expect(diff.deactivates).toEqual(['stale__old-v0']);
  });

  it('classifies identical full documents as unchanged', () => {
    const { documents } = validateProvisioningPayload(fullPayload());
    const [documentId, data] = documents.entries().next().value;
    expect(diffAgainstExisting(new Map([[documentId, data]]), [{ id: documentId, data }])).toEqual({
      creates: [], updates: [], unchanged: [documentId], deactivates: [],
    });
  });

  it('updates one wording-only change without classifying it unchanged', () => {
    const { documents } = validateProvisioningPayload(fullPayload());
    const [documentId, data] = documents.entries().next().value;
    const existing = { ...data, expectedActions: ['Different wording.'] };
    const diff = diffAgainstExisting(new Map([[documentId, data]]), [{ id: documentId, data: existing }]);
    expect(diff.updates).toEqual([documentId]);
    expect(diff.unchanged).toEqual([]);
  });

  it('classifies a 15-document manifest with one wording change as 1 update and 14 unchanged', () => {
    const { documents } = validateProvisioningPayload(fullPayload());
    const existing = [...documents].map(([id, data], index) => ({
      id,
      data: index === 4 ? { ...data, criticalMisses: ['Different wording.'] } : data,
    }));
    const diff = diffAgainstExisting(documents, existing);
    expect(diff.creates).toHaveLength(0);
    expect(diff.updates).toHaveLength(1);
    expect(diff.unchanged).toHaveLength(14);
    expect(diff.deactivates).toHaveLength(0);
  });

  it('classifies a remote absence as a create', () => {
    const data = { active: true, department: 'obgyn' };
    expect(diffAgainstExisting(new Map([['new__v1', data]]), []).creates).toEqual(['new__v1']);
  });

  it('never deactivates an out-of-scope (Pediatrics) document from an OB/GYN-only manifest', () => {
    const { documents } = validateProvisioningPayload(fullPayload());
    const existing = [
      { id: 'legacy-peds__v1', data: { active: true, department: 'pediatrics' } },
      { id: 'stale-obgyn__v0', data: { active: true, department: 'obgyn' } },
    ];
    const diff = diffAgainstExisting(documents, existing);
    expect(diff.deactivates).toEqual(['stale-obgyn__v0']);
    expect(diff.deactivates).not.toContain('legacy-peds__v1');
  });

  it('ignores object key insertion order but preserves meaningful array order', () => {
    const candidate = { active: true, department: 'obgyn', nested: { b: 2, a: 1 }, ordered: ['first', 'second'] };
    const same = { ordered: ['first', 'second'], nested: { a: 1, b: 2 }, department: 'obgyn', active: true };
    const reordered = { ...same, ordered: ['second', 'first'] };
    expect(diffAgainstExisting(new Map([['doc__v1', candidate]]), [{ id: 'doc__v1', data: same }]).unchanged)
      .toEqual(['doc__v1']);
    expect(diffAgainstExisting(new Map([['doc__v1', candidate]]), [{ id: 'doc__v1', data: reordered }]).updates)
      .toEqual(['doc__v1']);
  });

  it.each([
    ['null', { value: null }],
    ['empty array', { value: [] }],
    ['false', { value: false }],
  ])('treats a missing property as different from explicit %s', (_label, existing) => {
    const candidate = { active: true, department: 'obgyn' };
    expect(diffAgainstExisting(new Map([['doc__v1', candidate]]), [{ id: 'doc__v1', data: { ...candidate, ...existing } }]).updates)
      .toEqual(['doc__v1']);
  });

  it('normalizes equivalent recovered JSON and Firestore Timestamp representations', () => {
    const candidate = { active: true, department: 'obgyn', changedAt: { _seconds: 12, _nanoseconds: 34 } };
    const existing = { active: true, department: 'obgyn', changedAt: { seconds: 12, nanoseconds: 34, toDate() {} } };
    expect(diffAgainstExisting(new Map([['doc__v1', candidate]]), [{ id: 'doc__v1', data: existing }]).unchanged)
      .toEqual(['doc__v1']);
  });

  it('applies only classified creates and updates, never unchanged documents', async () => {
    const writes = [];
    const collection = { doc: (id) => ({ set: (...args) => { writes.push([id, args]); } }) };
    const documents = new Map([
      ['create__v1', { active: true }],
      ['update__v1', { active: true }],
      ...Array.from({ length: 14 }, (_, index) => [`same-${index}__v1`, { active: true }]),
    ]);
    await applyProvisioningChanges({
      collection, documents, creates: ['create__v1'], updates: ['update__v1'],
      unchanged: Array.from({ length: 14 }, (_, index) => `same-${index}__v1`), deactivates: [],
    });
    expect(writes.map(([id]) => id)).toEqual(['create__v1', 'update__v1']);
  });

  it('applies only the identified deactivation as a merge update', async () => {
    const writes = [];
    const collection = { doc: (id) => ({ set: (...args) => { writes.push([id, args]); } }) };
    await applyProvisioningChanges({
      collection, documents: new Map(), creates: [], updates: [], deactivates: ['stale__v1'],
    });
    expect(writes).toEqual([['stale__v1', [{ active: false }, { merge: true }]]]);
  });

  it('document identities bind id and version', () => {
    expect(privateScenarioDocumentId({ id: 'a', version: 'v2' })).toBe('a__v2');
  });
});
