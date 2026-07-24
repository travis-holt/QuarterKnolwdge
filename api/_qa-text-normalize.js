// ─────────────────────────────────────────────────────────────────────────────
// Shared conservative text normalization for Call QA evidence matching.
//
// Extracted from `_qa-rubric.js` so the identity-verification module and the
// rubric pipeline share ONE normalization definition without a circular import.
// Changing anything here changes what counts as a verbatim quote everywhere, so
// it stays deliberately small: case, punctuation, whitespace, curly quotes, and
// a fixed list of unambiguous contractions. No fuzzy or semantic matching.
// ─────────────────────────────────────────────────────────────────────────────

// Applied to BOTH sides before punctuation is stripped, so a quote and a
// transcript turn match even when one wrote "I'm" and the other "I am".
// Possessive "'s" is left to be stripped as punctuation.
export const CONTRACTIONS = [
  [/\bcan['’]t\b/g, 'can not'],
  [/\bwon['’]t\b/g, 'will not'],
  [/\bshan['’]t\b/g, 'shall not'],
  [/\bain['’]t\b/g, 'is not'],
  [/(\w)n['’]t\b/g, '$1 not'],       // didn't → did not, isn't → is not, …
  [/\bi['’]m\b/g, 'i am'],
  [/\bit['’]s\b/g, 'it is'],
  [/\bthat['’]s\b/g, 'that is'],
  [/\bwhat['’]s\b/g, 'what is'],
  [/\bhe['’]s\b/g, 'he is'],
  [/\bshe['’]s\b/g, 'she is'],
  [/\bthere['’]s\b/g, 'there is'],
  [/\blet['’]s\b/g, 'let us'],
  [/(\w)['’]re\b/g, '$1 are'],       // you're → you are, we're → we are
  [/(\w)['’]ve\b/g, '$1 have'],      // I've → I have
  [/(\w)['’]ll\b/g, '$1 will'],      // I'll → I will
  [/(\w)['’]d\b/g, '$1 would'],      // I'd → I would
];

export function normalizeForMatch(s) {
  let text = String(s ?? '').toLowerCase().replace(/[‘’]/g, "'");
  for (const [pattern, replacement] of CONTRACTIONS) text = text.replace(pattern, replacement);
  return text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A quote must be substantive (2+ words) to be evidence — a single word can
// match by accident and proves nothing.
export function quoteWords(needle) {
  return String(needle ?? '').split(' ').filter(Boolean);
}

// Strip a leading role label ("Navigator:", "Caller:") a grader may have copied
// into its quote along with the line.
export function stripRoleLabel(quote) {
  return String(quote ?? '').replace(/^\s*["'“”]*\s*(navigator|caller|patient)\s*:\s*/i, '');
}
