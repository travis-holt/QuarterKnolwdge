import { describe, expect, it } from 'vitest';
import { scanRepository, scanTextForMojibake } from '../scripts/check-encoding.mjs';

// Mojibake samples are BUILT from unicode escapes so this test file itself
// never contains the raw sequences (the repo scan below would flag them).
const MOJIBAKE_APOSTROPHE = '\u00e2\u20ac\u2122';
const MOJIBAKE_E_ACUTE = '\u00c3\u00a9';
const MOJIBAKE_REPLACEMENT = '\u00ef\u00bf\u00bd';

describe('repository encoding guard', () => {
  it('detects the classic double-encoded sequences', () => {
    expect(scanTextForMojibake(`women['${MOJIBAKE_APOSTROPHE}]s`).length).toBeGreaterThan(0);
    expect(scanTextForMojibake(`caf${MOJIBAKE_E_ACUTE}`).length).toBeGreaterThan(0);
    expect(scanTextForMojibake(`broken${MOJIBAKE_REPLACEMENT}char`).length).toBeGreaterThan(0);
  });

  it('does not flag intentional Unicode', () => {
    const intentional = `women['\u2019]s \u2014 caf\u00e9 \u0645\u0631\u062d\u0628\u0627`;
    expect(scanTextForMojibake(intentional)).toEqual([]);
  });

  it('finds no mojibake in tracked source files', () => {
    const findings = scanRepository(new URL('..', import.meta.url).pathname);
    expect(findings).toEqual([]);
  });
});
