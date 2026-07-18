// Repository encoding guard: fails when UTF-8 mojibake byte sequences (a UTF-8
// file decoded as Latin-1/Windows-1252 and re-encoded, e.g. the three-char
// sequence for a curly apostrophe, or the round-tripped U+FFFD replacement
// character) appear in tracked text sources. Intentional non-ASCII (em dashes,
// curly quotes, accented letters, Arabic, etc.) is untouched: only the
// characteristic double-encoded sequences are flagged. Every pattern is written
// with \\u escapes so this file never contains the raw sequences it hunts.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Characters that only follow a double-encoded 0xC3 lead byte (Latin-1 range +
// the Windows-1252 punctuation remaps of UTF-8 continuation bytes).
const CONTINUATION = '\\u00a0-\\u00bf\\u0152\\u0153\\u0160\\u0161\\u0178\\u017d\\u017e'
  + '\\u0192\\u02c6\\u02dc\\u2013\\u2014\\u2018-\\u201e\\u2020-\\u2022'
  + '\\u2026\\u2030\\u2039\\u203a\\u20ac\\u2122';

export const MOJIBAKE_PATTERNS = [
  new RegExp('\\u00e2\\u20ac'), // double-encoded curly quote / dash / ellipsis lead
  new RegExp(`\\u00c3[${CONTINUATION}]`), // double-encoded Latin accents
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
