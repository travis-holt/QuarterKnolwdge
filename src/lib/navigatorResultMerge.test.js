// ─────────────────────────────────────────────────────────────────────────────
// UNIT TESTS for lib/navigatorResultMerge.js — stable-identity floor/own merge.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { navigatorResultIdentityKey, mergeNavigatorFloorAndOwnResult } from './navigatorResultMerge.js';

describe('navigatorResultIdentityKey', () => {
  it('keys by navigatorId when present', () => {
    expect(navigatorResultIdentityKey({ navigatorId: 'nav-1', name: 'Omar' })).toBe('id:nav-1');
  });

  it('falls back to a name key when navigatorId is absent', () => {
    expect(navigatorResultIdentityKey({ name: 'Omar' })).toBe('name:Omar');
  });

  it('prefixes keys so an id and a name can never collide', () => {
    // A navigatorId string equal to another row's display name must not
    // accidentally produce the same Map key.
    expect(navigatorResultIdentityKey({ navigatorId: 'Bob' })).toBe('id:Bob');
    expect(navigatorResultIdentityKey({ name: 'Bob' })).toBe('name:Bob');
    expect(navigatorResultIdentityKey({ navigatorId: 'Bob' }))
      .not.toBe(navigatorResultIdentityKey({ name: 'Bob' }));
  });
});

describe('mergeNavigatorFloorAndOwnResult', () => {
  it('replaces a stale floor result with the fresh own result under the same stable ID', () => {
    const floor = [{ navigatorId: 'nav-1', name: 'Old Name', scores: { communication: 40 } }];
    const own = { scores: { communication: 92 } };
    const merged = mergeNavigatorFloorAndOwnResult(floor, own, { navigatorId: 'nav-1', name: 'Current Name' });

    expect(merged).toHaveLength(1);
    expect(merged[0].navigatorId).toBe('nav-1');
    expect(merged[0].name).toBe('Current Name');
    expect(merged[0].scores.communication).toBe(92);
  });

  it('replaces a legacy no-ID floor row that matches the own display name', () => {
    const floor = [{ name: 'Omar', scores: { communication: 40 } }];
    const own = { scores: { communication: 92 } };
    const merged = mergeNavigatorFloorAndOwnResult(floor, own, { navigatorId: 'nav-1', name: 'Omar' });

    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Omar');
    expect(merged[0].navigatorId).toBe('nav-1');
    expect(merged[0].scores.communication).toBe(92);
  });

  it('does not merge two different stable IDs just because their names match', () => {
    const floor = [
      { navigatorId: 'nav-1', name: 'Same Name', scores: { a: 1 } },
      { navigatorId: 'nav-2', name: 'Same Name', scores: { a: 2 } },
    ];
    const merged = mergeNavigatorFloorAndOwnResult(floor, null, { navigatorId: 'nav-3', name: 'Someone Else' });

    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.navigatorId).sort()).toEqual(['nav-1', 'nav-2']);
  });

  it('replaces the projected same-ID result even when the display names differ (rename)', () => {
    const floor = [{ navigatorId: 'nav-1', name: 'Old Display Name', scores: { a: 1 } }];
    const own = { scores: { a: 99 } };
    const merged = mergeNavigatorFloorAndOwnResult(floor, own, { navigatorId: 'nav-1', name: 'New Display Name' });

    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('New Display Name');
    expect(merged[0].scores.a).toBe(99);
  });

  it('with no own result, returns the floor rows unmutated and does not mutate inputs', () => {
    const floor = [{ navigatorId: 'nav-1', name: 'A', scores: { a: 1 } }];
    const floorCopy = JSON.parse(JSON.stringify(floor));
    const merged = mergeNavigatorFloorAndOwnResult(floor, null, { navigatorId: 'nav-9', name: 'Nobody' });

    expect(merged).toEqual(floor);
    expect(merged).not.toBe(floor);
    expect(floor).toEqual(floorCopy);
  });

  it('collapses duplicate projected copies with the same navigatorId deterministically', () => {
    const floor = [
      { navigatorId: 'nav-9', name: 'X', scores: { a: 1 } },
      { navigatorId: 'nav-9', name: 'X', scores: { a: 2 } },
    ];
    const merged = mergeNavigatorFloorAndOwnResult(floor, null, { navigatorId: 'nav-3', name: 'Someone Else' });

    expect(merged).toHaveLength(1);
    expect(merged[0].scores.a).toBe(2); // last one in wins, deterministically
  });

  it('never mutates the input result objects', () => {
    const floorRow = { navigatorId: 'nav-1', name: 'Old', scores: { a: 1 } };
    const ownResult = { scores: { a: 2 } };
    mergeNavigatorFloorAndOwnResult([floorRow], ownResult, { navigatorId: 'nav-1', name: 'New' });

    expect(floorRow.name).toBe('Old');
    expect(ownResult.navigatorId).toBeUndefined();
  });
});
