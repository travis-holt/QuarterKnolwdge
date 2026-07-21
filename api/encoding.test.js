import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { scanRepository, scanTextForMojibake } from '../scripts/check-encoding.mjs';

// Mojibake samples are BUILT from unicode escapes so this test file itself
// never contains the raw sequences (the repo scan below would flag them).
const MOJIBAKE_APOSTROPHE = '\u00e2\u20ac\u2122';
const MOJIBAKE_E_ACUTE = '\u00c3\u00a9';
const MOJIBAKE_REPLACEMENT = '\u00ef\u00bf\u00bd';
// U+2192 RIGHTWARDS ARROW round-tripped through Windows-1252.
const MOJIBAKE_ARROW = '\u00e2\u2020\u2019';
// U+2500 BOX DRAWINGS LIGHT HORIZONTAL round-tripped through Windows-1252.
const MOJIBAKE_BOX = '\u00e2\u201d\u20ac';

describe('repository encoding guard', () => {
  it('detects the classic double-encoded sequences', () => {
    expect(scanTextForMojibake(`women['${MOJIBAKE_APOSTROPHE}]s`).length).toBeGreaterThan(0);
    expect(scanTextForMojibake(`caf${MOJIBAKE_E_ACUTE}`).length).toBeGreaterThan(0);
    expect(scanTextForMojibake(`broken${MOJIBAKE_REPLACEMENT}char`).length).toBeGreaterThan(0);
  });

  // Regression: these two families survived an earlier repair because the guard
  // only matched the curly-quote lead pair, not the whole continuation class.
  it('detects corrupted ARROW sequences', () => {
    expect(scanTextForMojibake(`34 ${MOJIBAKE_ARROW} 72`).length).toBeGreaterThan(0);
    expect(scanTextForMojibake(`complete ${MOJIBAKE_ARROW} canTeach`).length).toBeGreaterThan(0);
  });

  it('detects corrupted BOX-DRAWING sequences', () => {
    expect(scanTextForMojibake(`${MOJIBAKE_BOX}${MOJIBAKE_BOX} section`).length).toBeGreaterThan(0);
    expect(scanTextForMojibake(`// ${MOJIBAKE_BOX.repeat(20)}`).length).toBeGreaterThan(0);
  });

  it('does not flag intentional Unicode', () => {
    const intentional = `women['\u2019]s \u2014 caf\u00e9 \u0645\u0631\u062d\u0628\u0627`;
    expect(scanTextForMojibake(intentional)).toEqual([]);
  });

  it('allows the REAL arrows and box-drawing characters this repo uses', () => {
    // Real U+2192 arrow, real U+2500 rule, em dash, curly quotes, accents, Arabic.
    const legitimate = [
      '34 \u2192 72',
      'MCQ \u2192 Spot the Error \u2192 Call QA',
      `// ${'\u2500'.repeat(77)}`,
      '\u2500\u2500 section \u2500\u2500',
      'Overall \u2014 72% \u00b7 Solid',
      '\u201cCan-Teach\u201d and it\u2019s fine',
      'caf\u00e9 na\u00efve \u00e2me ch\u00e2teau',
      '\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645',
      '\u21d2 \u2190 \u2194 \u2502 \u250c \u2514 \u253c', // more arrows + box drawing
    ].join('\n');
    expect(scanTextForMojibake(legitimate)).toEqual([]);
  });

  it('does not flag French words where a-circumflex precedes a letter', () => {
    // The widened pattern must not turn real accented prose into a false positive.
    expect(scanTextForMojibake('\u00e2me b\u00e2timent ch\u00e2teau p\u00e2te')).toEqual([]);
  });

  it('finds no mojibake in tracked source files', () => {
    // fileURLToPath, not .pathname: on Windows `.pathname` yields "/C:/Users/..."
    // which is not a valid cwd, so `git ls-files` failed with ENOENT and this
    // guard silently never ran on a Windows checkout.
    const findings = scanRepository(fileURLToPath(new URL('..', import.meta.url)));
    expect(findings).toEqual([]);
  });
});
