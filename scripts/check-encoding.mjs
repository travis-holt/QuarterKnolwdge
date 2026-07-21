// Repository encoding guard: fails when UTF-8 mojibake byte sequences (a UTF-8
// file decoded as Latin-1/Windows-1252 and re-encoded, e.g. the three-char
// sequence for a curly apostrophe, an arrow, a box-drawing rule, or the
// round-tripped U+FFFD replacement character) appear in tracked text sources.
// Intentional non-ASCII (real arrows, real box-drawing characters, em dashes,
// curly quotes, accented letters, Arabic, etc.) is untouched: only the
// characteristic double-encoded sequences are flagged. Every pattern is written
// with \\u escapes so this file never contains the raw sequences it hunts.
//
// 2026-07-20: widened from a single hard-coded lead pair to the full
// continuation class after a PowerShell Add-Content round-trip corrupted arrows
// and box-drawing rules that the narrower guard did not catch.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Characters a UTF-8 continuation byte (0x80-0xBF) becomes when the file is
// mis-decoded as Windows-1252: bytes 0xA0-0xBF map straight to U+00A0-U+00BF,
// and bytes 0x80-0x9F map to the cp1252 punctuation block.
const CONTINUATION = '\\u00a0-\\u00bf\\u0152\\u0153\\u0160\\u0161\\u0178\\u017d\\u017e'
  + '\\u0192\\u02c6\\u02dc\\u2013\\u2014\\u2018-\\u201e\\u2020-\\u2022'
  + '\\u2026\\u2030\\u2039\\u203a\\u20ac\\u2122';

export const MOJIBAKE_PATTERNS = [
  // Double-encoded 3-byte UTF-8 (lead byte 0xE2 -> U+00E2 'a-circumflex').
  // 0xE2 leads U+2000-U+2FFF, so this one pattern covers general punctuation
  // (curly quotes, en/em dashes, ellipsis), ARROWS (U+2190-U+21FF, e.g. the
  // right arrow that mangles to a-circumflex + dagger + right-quote), and
  // BOX DRAWING (U+2500-U+257F, e.g. the light horizontal used in the section
  // rules throughout this repo), plus math, block and geometric shapes.
  //
  // Requiring a continuation-class character immediately after the lead keeps
  // legitimately accented text safe: real words spell a-circumflex followed by
  // an ASCII letter, never by a dagger, a curly quote or a euro sign.
  new RegExp(`\\u00e2[${CONTINUATION}]`),
  new RegExp(`\\u00c3[${CONTINUATION}]`), // double-encoded Latin accents (2-byte, 0xC3 lead)
  new RegExp('\\u00ef\\u00bf\\u00bd'), // round-tripped U+FFFD replacement char
  new RegExp('\\u00c2[\\u00b7\\u00b0\\u00ba\\u00a0]'), // stray 0xC2 lead before punctuation/NBSP
];

const TEXT_EXTENSIONS = /\.(js|jsx|mjs|cjs|ts|tsx|json|md|css|html|txt|yml|yaml)$/;

export function scanTextForMojibake(text) {
  return MOJIBAKE_PATTERNS.filter((pattern) => pattern.test(text)).map(String);
}

export function scanRepository(root = process.cwd()) {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => TEXT_EXTENSIONS.test(file));
  const findings = [];
  for (const file of files) {
    let text;
    try { text = readFileSync(`${root}/${file}`, 'utf8'); } catch { continue; }
    const hits = scanTextForMojibake(text);
    if (hits.length) findings.push({ file, patterns: hits });
  }
  return findings;
}

if (process.argv[1] && process.argv[1].endsWith('check-encoding.mjs')) {
  const findings = scanRepository();
  if (findings.length) {
    for (const finding of findings) console.error(`Mojibake in ${finding.file}: ${finding.patterns.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('Encoding scan passed: no mojibake sequences found.');
  }
}
