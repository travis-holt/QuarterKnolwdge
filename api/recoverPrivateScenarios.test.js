// Tests for the operator-only READ-ONLY private-scenario recovery tool.
//
// The tool exists because the private bank is never committed, so a lost local
// operator manifest can only be reconstructed from the collection that is already
// the live source of truth. These tests pin the safety properties that make that
// acceptable: an explicit project is mandatory, the destination must be provably
// private before anything is read, out-of-scope documents are counted rather than
// silently dropped, and recovered documents are copied VERBATIM.
//
// Pure — no Firestore, no network, no credentials.

import { describe, expect, it } from 'vitest';
import {
  parseArgs,
  buildRecoveredManifest,
  assertDestinationIsPrivate,
} from '../scripts/call-qa/recover-private-scenarios.mjs';

const doc = (id, department, active, extra = {}) => ({
  id, data: { id, department, active, title: `fixture ${id}`, ...extra },
});

describe('recover-private-scenarios parseArgs', () => {
  it('requires an explicit --project (never inferred from the environment)', () => {
    expect(() => parseArgs([])).toThrow(/--project .* is required/);
  });

  it('defaults the destination to the gitignored operator path', () => {
    expect(parseArgs(['--project', 'proj-a'])).toEqual({
      project: 'proj-a', output: 'private-call-qa/scenarios.json',
    });
  });

  it('accepts an explicit --output and rejects unknown flags', () => {
    expect(parseArgs(['--project', 'p', '--output', 'call-qa-private-x.json']).output)
      .toBe('call-qa-private-x.json');
    expect(() => parseArgs(['--project', 'p', '--apply'])).toThrow(/Unknown option/);
    // There is deliberately no --apply: this tool can never write to Firestore.
  });

  it('rejects a flag with no value', () => {
    expect(() => parseArgs(['--project'])).toThrow(/requires a value/);
  });
});

describe('recover-private-scenarios buildRecoveredManifest', () => {
  it('copies documents verbatim and counts active/inactive per department', () => {
    const { manifest, counts } = buildRecoveredManifest([
      doc('b', 'obgyn', true, { hiddenChartState: { encounters: 'x' } }),
      doc('a', 'obgyn', false),
    ]);
    expect(counts.total).toBe(2);
    expect(counts.byDepartment.obgyn).toEqual({ active: 1, inactive: 1 });
    // Verbatim: the recovery step must not edit, normalize, or re-author content.
    expect(manifest.scenarios.find((s) => s.id === 'b').hiddenChartState)
      .toEqual({ encounters: 'x' });
  });

  it('orders scenarios deterministically by document id', () => {
    const { manifest } = buildRecoveredManifest([
      doc('zeta', 'obgyn', true), doc('alpha', 'obgyn', true), doc('mid', 'obgyn', true),
    ]);
    expect(manifest.scenarios.map((s) => s.id)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('COUNTS out-of-scope departments instead of silently dropping them', () => {
    // The provisioning manifest only manages rollout departments, but an operator
    // must still be told the collection holds more than the manifest describes.
    const { manifest, counts } = buildRecoveredManifest([
      doc('a', 'obgyn', true), doc('b', 'pediatrics', true),
    ]);
    expect(manifest.scenarios).toHaveLength(1);
    expect(counts.skippedNonRollout).toBe(1);
    expect(counts.total).toBe(2);
  });

  it('is safe on an empty collection', () => {
    const { manifest, counts } = buildRecoveredManifest([]);
    expect(manifest).toEqual({ scenarios: [] });
    expect(counts).toEqual({ total: 0, byDepartment: {}, skippedNonRollout: 0 });
  });
});

describe('recover-private-scenarios assertDestinationIsPrivate', () => {
  const gitStub = (ignored, tracked) => async (args) => {
    if (args[0] === 'check-ignore') return { ok: ignored, stdout: '' };
    if (args[0] === 'ls-files') return { ok: tracked, stdout: '' };
    return { ok: false, stdout: '' };
  };

  it('accepts a path that is ignored and untracked', async () => {
    await expect(assertDestinationIsPrivate('private-call-qa/scenarios.json', gitStub(true, false)))
      .resolves.toBe(true);
  });

  it('refuses a path Git does not ignore', async () => {
    await expect(assertDestinationIsPrivate('docs/scenarios.json', gitStub(false, false)))
      .rejects.toThrow(/NOT ignored by Git/);
  });

  it('refuses a path Git already tracks, even if a rule would ignore it', async () => {
    await expect(assertDestinationIsPrivate('some/tracked.json', gitStub(true, true)))
      .rejects.toThrow(/TRACKED by Git/);
  });
});
