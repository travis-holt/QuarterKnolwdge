// ─────────────────────────────────────────────────────────────────────────────
// Call-QA transcript glossary — deterministic correction of the SOP proper nouns
// and terms that Gemini Live's transcription mis-hears (it has no domain
// vocabulary of its own).
//
// Why this exists: the voice-call transcription writes "Isr Pediatrics" for
// "Aizer Health", garbles provider / queue / street names, and drops the SOP's
// abbreviations. The QA grader then — correctly, per its literal rule — fails the
// navigator for a term they actually said right. This module snaps those
// mis-hearings back to the canonical SOP term BEFORE grading.
//
// NO-HALLUCINATION GUARANTEE: correction can ONLY ever output a term that is
// already in the curated glossary below. It never invents words — a span that
// doesn't match is left exactly as transcribed. Two conservative mechanisms:
//   1. explicit alias phrases  — known mis-hearings mapped to their canonical
//      form (precise; this is what fixes "Isr Pediatrics" → "Aizer Health").
//   2. single-word fuzzy match — only for distinctive proper nouns (length ≥ 6),
//      only at a high similarity threshold, only replacing whole letter-words.
//      Ordinary conversation is untouched.
//
// The grader is ALSO told the canonical vocabulary + abbreviation equivalences
// (glossaryPromptBlock) so "physical exam" counts as "PE", etc. — without ever
// rewriting the navigator's own wording.
//
// The leading `_` keeps Express from turning this module into a route.
// ─────────────────────────────────────────────────────────────────────────────

// entry: { canonical, aliases?: string[], fuzzy?: boolean }
//   aliases  — lowercase phrases that get replaced verbatim with `canonical`.
//   fuzzy    — when true AND canonical is a single word ≥ 6 chars, near-spellings
//              of it are also snapped to canonical.

const COMMON = [
  { canonical: 'Aizer Health', aliases: [
    'isr pediatrics', 'izer health', 'iser health', 'eiser health', 'ayzer health',
    'eyzer health', 'aizor health', 'aizer pediatrics', 'izer pediatrics', 'iser pediatrics',
  ] },
  // Standalone org-name mis-hearings ("we're part of Izer"). Must come AFTER the
  // 'Aizer Health' entry so the two-word phrase aliases win first. These words
  // don't occur in ordinary conversation, so bare-word replacement is safe.
  { canonical: 'Aizer', aliases: ['izer', 'iser', 'eiser', 'ayzer', 'eyzer', 'aizor', 'aiser'] },
  { canonical: 'Intermedia', fuzzy: true },
];

const PEDIATRICS = [
  // Locations
  { canonical: 'Bakertown', fuzzy: true, aliases: ['baker town'] },
  { canonical: 'Blooming Grove', aliases: ['bloomin grove', 'blooming grow'] },
  // Primary-care providers (distinctive surnames)
  { canonical: 'Polinger', fuzzy: true },
  { canonical: 'Frommer', fuzzy: true },
  { canonical: 'Khaimov', fuzzy: true },
  { canonical: 'Faiden', fuzzy: true, aliases: ['faden', 'fayden', 'faidin'] },
  { canonical: 'Aschkenasy', fuzzy: true },
  { canonical: 'Dachoh', fuzzy: true },
  { canonical: 'Heintz', fuzzy: true, aliases: ['hines', 'heins'] },
  { canonical: 'Namanworth', fuzzy: true },
  // Referral / escalation staff + queues
  { canonical: 'Carilli', fuzzy: true, aliases: ['carrilli', 'carilly', 'carili'] },
  { canonical: 'Azeez', aliases: ['aziz', 'azez', 'azeeze'] },
  { canonical: 'Kraft', aliases: ['craft', 'kraf'] },
  { canonical: 'PEDS Encounters', aliases: ['peds encounter', 'ped encounters', 'peds encounters queue'] },
  { canonical: 'Good Samaritan', aliases: ['good samaratin', 'good sameritan', 'good samaraten', 'good samariton'] },
];

const OBGYN = [
  { canonical: 'Labor and Delivery', aliases: ['l and d', 'labor delivery', 'labour and delivery'] },
  { canonical: 'Prevention Coordinator', aliases: ['prevention coordinater'] },
  { canonical: 'gestational age', aliases: ['gestation age', 'gestational aid'] },
];

// Abbreviation ↔ long-form equivalences the grader should treat as identical.
// These are NOT rewritten in the transcript (that would change the navigator's
// wording) — they're handed to the grader so a synonym never costs a criterion.
const EQUIVALENCES = [
  'PE = physical exam / physical',
  'NB PE = newborn physical exam',
  'TE = telephone encounter',
  'OV = office visit',
  'F/U = follow-up · NP = new patient',
  'GS = Good Samaritan (hospital)',
  'UTD = up to date',
  'ECW / eCW = the charting & scheduling system',
];

const EQUIVALENCES_OBGYN = [
  'L&D = Labor and Delivery',
  'MFM = Maternal-Fetal Medicine',
  'PSS = Patient Scheduling Services',
  'GBS = Group B Strep · NST = Non-Stress Test · GCT = Glucose Challenge Test',
];

export function glossaryFor(department) {
  return department === 'obgyn' ? [...COMMON, ...OBGYN] : [...COMMON, ...PEDIATRICS];
}

// ── Fuzzy matching (Levenshtein similarity) ──────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function ratio(a, b) {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

const FUZZY_THRESHOLD = 0.82;
const FUZZY_MIN_LEN = 6;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Correction ───────────────────────────────────────────────────────────────

/** Snap mis-transcribed SOP terms in one string to their canonical form. */
export function correctText(text, glossary) {
  if (!text || !text.trim()) return text;
  let out = text;

  // 1) explicit alias phrases → canonical (verbatim, case-insensitive).
  //    Replacement is a function so `$`/`&` in a canonical stay literal.
  for (const e of glossary) {
    for (const a of e.aliases || []) {
      out = out.replace(new RegExp(`\\b${escapeRe(a)}\\b`, 'gi'), () => e.canonical);
    }
  }

  // 2) single-word fuzzy for distinctive proper nouns only.
  const singles = glossary
    .filter((e) => e.fuzzy && !/\s/.test(e.canonical) && e.canonical.length >= FUZZY_MIN_LEN)
    .map((e) => ({ canonical: e.canonical, lc: e.canonical.toLowerCase() }));
  if (singles.length) {
    out = out.replace(/[\p{L}][\p{L}'’]*/gu, (w) => {
      const lw = w.toLowerCase();
      for (const s of singles) {
        if (lw === s.lc) return w;                 // already correct
        if (ratio(lw, s.lc) >= FUZZY_THRESHOLD) return s.canonical;
      }
      return w;
    });
  }

  return out;
}

/** Correct every turn's text in a transcript. Pure; returns a new array. */
export function correctTranscript(transcript, department = 'pediatrics') {
  return correctTranscriptWithStats(transcript, department).transcript;
}

/**
 * Like correctTranscript, but also reports how many turns needed correction —
 * a deterministic proxy for transcript quality. Many corrected turns means the
 * transcription was struggling, which the review layer turns into a
 * "low transcript confidence" flag rather than a confident pass/fail.
 */
export function correctTranscriptWithStats(transcript, department = 'pediatrics') {
  if (!Array.isArray(transcript)) return { transcript, correctedTurns: 0 };
  const glossary = glossaryFor(department);
  let correctedTurns = 0;
  const out = transcript.map((t) => {
    const original = String(t?.text ?? '');
    const text = correctText(original, glossary);
    if (text !== original) correctedTurns += 1;
    return { ...t, text };
  });
  return { transcript: out, correctedTurns };
}

/** A short grounding block for the grader: canonical spellings + abbreviation
 *  equivalences so a synonym or the correct term never costs a criterion. */
export function glossaryPromptBlock(department) {
  const glossary = glossaryFor(department);
  const terms = glossary.map((e) => e.canonical).join(', ');
  const equiv = (department === 'obgyn' ? [...EQUIVALENCES, ...EQUIVALENCES_OBGYN] : EQUIVALENCES)
    .map((e) => `  - ${e}`).join('\n');
  return `CANONICAL SOP VOCABULARY — this transcript is auto-transcribed from a live call and \
may mis-spell these terms. Treat the navigator as having said the correct term, and treat each \
abbreviation and its long form as identical.
Known terms: ${terms}
Equivalences:
${equiv}`;
}
