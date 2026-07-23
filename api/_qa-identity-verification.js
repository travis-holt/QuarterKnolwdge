// ─────────────────────────────────────────────────────────────────────────────
// Structured identity-verification evidence + chronological disclosure ordering.
//
// WHY THIS EXISTS
// The first implementation of the OB/GYN identity policy only checked that a
// two-word quote appeared somewhere in one turn. That proved nothing: it could
// not tell a first name from a last name from a phone number, and it could not
// aggregate identifiers collected across several turns. A grader could mark
// `verify-three` MET while quoting "What is your date of birth?" — a question
// the caller never answered — and the server would agree.
//
// This module replaces that with a real contract. The grader must report, per
// identifier, WHAT it claims was collected, WHO said it, WHICH turn, and the
// verbatim quote. The server then independently re-derives every claim from the
// transcript. A model Boolean is never trusted; only re-verified evidence is.
//
// CORRECTION PASS #2 (2026-07-21) — three defects the second review found:
//
//  1. A name-shaped token was accepted as the PATIENT's identifier with no proof
//     it was the patient's name. "this is Dana" (the navigator), "Dr. Reyes"
//     (a provider) and "I spoke with Maria yesterday" all satisfied it. Name
//     claims are now bound to a PATIENT-IDENTITY CONTEXT (§ Name ownership).
//  2. A generic opening clause vetoed the WHOLE navigator turn, so
//     "Let me open your chart. I can see Dr. Smith ordered an ultrasound."
//     was classified safe. Turns are now split into clauses and each clause is
//     classified independently (§ Protected-disclosure detection).
//  3. `extractDateOfBirth` demanded a numeric 4-digit year (so a spoken
//     "March second nineteen ninety-one" lost credit) and accepted impossible
//     calendar dates such as February 31. It is now a real deterministic date
//     parser with spoken-number support and calendar validation (§ DOB).
//
// SCOPE (binding — see docs/GRADING_INVARIANTS.md §0h)
// Caller turns are eligible ONLY for identity collection, and ONLY for the two
// criteria that explicitly opt in. Navigator-only evidence is unchanged for
// every other criterion, for observed negatives, and for every auto-fail.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeForMatch, quoteWords, stripRoleLabel } from './_qa-text-normalize.js';

export const IDENTITY_FIELDS = Object.freeze(['firstName', 'lastName', 'dob']);
const IDENTITY_FIELD_SET = new Set(IDENTITY_FIELDS);

// Only these two roles may carry identity evidence. A caller-side turn may use
// either alias; anything else is rejected outright.
const CALLER_ROLE_ALIASES = new Set(['caller', 'patient']);

function turnRoleMatches(turnRole, claimedRole) {
  if (claimedRole === 'navigator') return turnRole === 'navigator';
  if (CALLER_ROLE_ALIASES.has(claimedRole)) return CALLER_ROLE_ALIASES.has(turnRole);
  return false;
}

// ── Date-of-birth recognition ────────────────────────────────────────────────
//
// Deterministic, auditable, and conservative. It accepts the written and spoken
// forms real speech-to-text produces, and it validates a REAL calendar date.
//
// Birth-year policy is UNCHANGED from the previous implementation: 1800-2099
// (the `(?:18|19|20)\d{2}` range that was already in force). No new age policy
// is invented here.
//
// INTENTIONALLY UNSUPPORTED (documented, not accidental):
//   * a two-digit year ("March 2, 91") — genuinely ambiguous, and a wrong
//     century is worse than a lost criterion the supervisor reviews;
//   * digit-by-digit dictation ("zero three zero two nineteen ninety one") —
//     the digit run is indistinguishable from an account or phone number;
//   * a month/day with no year at all;
//   * relative wording ("she was born last March").
// All of these fall through to "not a date of birth", which withholds credit
// and routes the attempt to supervisor review rather than guessing.

const MIN_BIRTH_YEAR = 1800;
const MAX_BIRTH_YEAR = 2099;

const MONTHS = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};
const MONTH_ALTERNATION = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

// Spoken cardinals and ordinals for a day of month (1-31).
const SMALL_NUMBER_WORDS = {
  one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4,
  five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8,
  nine: 9, ninth: 9, ten: 10, tenth: 10, eleven: 11, eleventh: 11,
  twelve: 12, twelfth: 12, thirteen: 13, thirteenth: 13, fourteen: 14, fourteenth: 14,
  fifteen: 15, fifteenth: 15, sixteen: 16, sixteenth: 16, seventeen: 17, seventeenth: 17,
  eighteen: 18, eighteenth: 18, nineteen: 19, nineteenth: 19,
};
const TENS_WORDS = {
  twenty: 20, twentieth: 20, thirty: 30, thirtieth: 30, forty: 40, fortieth: 40,
  fifty: 50, fiftieth: 50, sixty: 60, sixtieth: 60, seventy: 70, seventieth: 70,
  eighty: 80, eightieth: 80, ninety: 90, ninetieth: 90,
};

const DAY_WORD_ALTERNATION = [
  ...Object.keys(TENS_WORDS).flatMap((tens) =>
    Object.keys(SMALL_NUMBER_WORDS).map((unit) => `${tens}[- ]${unit}`)),
  ...Object.keys(TENS_WORDS),
  ...Object.keys(SMALL_NUMBER_WORDS),
].sort((a, b) => b.length - a.length).join('|');

/** Sum a spoken number phrase ("ninety one", "thirty-first"), or null. */
function spokenNumberValue(text) {
  const words = String(text).toLowerCase().split(/[\s-]+/).filter(Boolean);
  let total = 0;
  for (const word of words) {
    if (TENS_WORDS[word] !== undefined) total += TENS_WORDS[word];
    else if (SMALL_NUMBER_WORDS[word] !== undefined) total += SMALL_NUMBER_WORDS[word];
    else return null;
  }
  return total > 0 ? total : null;
}

/** A spoken number constrained to a day of month. */
function spokenDayValue(text) {
  const value = spokenNumberValue(text);
  return value !== null && value <= 31 ? value : null;
}

// A spoken year: "nineteen ninety-one", "two thousand four", "nineteen oh five".
const CENTURY_WORDS = { eighteen: 18, nineteen: 19, twenty: 20 };
const SPOKEN_YEAR_SOURCE =
  `(?:two\\s+thousand(?:\\s+and)?(?:\\s+(?:${DAY_WORD_ALTERNATION}))?`
  + `|(?:${Object.keys(CENTURY_WORDS).join('|')})\\s+(?:oh\\s+(?:${Object.keys(SMALL_NUMBER_WORDS).join('|')})`
  + `|(?:${DAY_WORD_ALTERNATION})))`;

function spokenYearValue(text) {
  const raw = String(text).toLowerCase().trim().replace(/[-\s]+/g, ' ');
  const thousand = /^two thousand(?: and)?(?:\s+(.+))?$/.exec(raw);
  if (thousand) {
    const remainder = thousand[1] ? spokenNumberValue(thousand[1]) : 0;
    if (remainder === null || remainder > 99) return null;
    return 2000 + remainder;
  }
  const century = /^(eighteen|nineteen|twenty)\s+(?:oh\s+(\w+)|(.+))$/.exec(raw);
  if (!century) return null;
  const base = CENTURY_WORDS[century[1]] * 100;
  if (century[2]) {
    const unit = SMALL_NUMBER_WORDS[century[2]];
    return unit !== undefined && unit <= 9 ? base + unit : null;
  }
  const remainder = spokenNumberValue(century[3]);
  if (remainder === null || remainder > 99) return null;
  return base + remainder;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** True only for a real calendar date inside the supported birth-year range. */
export function isRealCalendarDate(month, day, year) {
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) return false;
  if (month < 1 || month > 12) return false;
  if (year < MIN_BIRTH_YEAR || year > MAX_BIRTH_YEAR) return false;
  const max = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= max;
}

function dayValue(token) {
  if (token === undefined || token === null) return null;
  const text = String(token).trim();
  if (/^\d{1,2}$/.test(text.replace(/(?:st|nd|rd|th)$/i, ''))) {
    return Number(text.replace(/(?:st|nd|rd|th)$/i, ''));
  }
  return spokenDayValue(text);
}

function yearValue(token) {
  const text = String(token ?? '').trim();
  if (/^\d{4}$/.test(text)) return Number(text);
  return spokenYearValue(text);
}

const NUMERIC_DAY = '\\d{1,2}(?:st|nd|rd|th)?';
const YEAR_SOURCE = `(?:\\d{4}|${SPOKEN_YEAR_SOURCE})`;
const DAY_SOURCE = `(?:${NUMERIC_DAY}|${DAY_WORD_ALTERNATION})`;

// Each entry maps its capture groups to { month, day, year }.
const DOB_FORMS = [
  // March 2, 1991 · March 2nd 1991 · March the second, nineteen ninety-one
  {
    pattern: new RegExp(
      `\\b(${MONTH_ALTERNATION})\\s+(?:the\\s+)?(${DAY_SOURCE})\\s*,?\\s*(?:of\\s+)?(${YEAR_SOURCE})\\b`, 'i'),
    map: (m) => ({ month: MONTHS[m[1].toLowerCase()], day: dayValue(m[2]), year: yearValue(m[3]) }),
  },
  // 2 March 1991 · the second of March nineteen ninety-one
  {
    pattern: new RegExp(
      `\\b(?:the\\s+)?(${DAY_SOURCE})\\s+(?:of\\s+)?(${MONTH_ALTERNATION})\\s*,?\\s*(${YEAR_SOURCE})\\b`, 'i'),
    map: (m) => ({ month: MONTHS[m[2].toLowerCase()], day: dayValue(m[1]), year: yearValue(m[3]) }),
  },
  // 3/2/1991 · 03-02-1991 · 3.2.1991 (month-first, the US convention this floor uses)
  {
    pattern: /\b(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4})\b/,
    map: (m) => ({ month: Number(m[1]), day: Number(m[2]), year: Number(m[3]) }),
  },
];

// Shapes that must NEVER be read as a date of birth even if a loose pattern
// brushed against them. Checked BEFORE the DOB patterns.
const PHONE_SHAPES = [
  /\b\d{3}\s*[-.)]?\s*\d{3}\s*[-.]?\s*\d{4}\b/,          // 555-013-0199
  /\b\(?\d{3}\)?[\s.-]*\d{4}\b(?!\s*[/\-.]\s*\d)/,        // (555) 0199
  /\bphone\s*(?:number)?\b/i,
  /\bcell\b|\bmobile\b|\bbest number\b|\bcall(?:back)? number\b/i,
];
const ADDRESS_SHAPES = [
  /\b\d+\s+[a-z][a-z'’-]*(?:\s+[a-z][a-z'’-]*)*\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct|circle|cir|place|pl|way|terrace|highway|hwy|route|rt)\b/i,
  /\b(?:apartment|apt|suite|ste|unit)\s*#?\s*\w+\b/i,
  /\bzip\s*code\b|\baddress\b/i,
];

export function looksLikePhoneNumber(text) {
  return PHONE_SHAPES.some((pattern) => pattern.test(String(text ?? '')));
}

export function looksLikeAddress(text) {
  return ADDRESS_SHAPES.some((pattern) => pattern.test(String(text ?? '')));
}

/**
 * Parse a date of birth. Returns `{ text, month, day, year }` for a REAL
 * calendar date, or null. A phone number, an address, a bare year, a bare
 * month/day, and an impossible date (February 31, February 29 in a non-leap
 * year, April 31, month 13, day 0) all return null.
 */
export function parseDateOfBirth(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return null;
  if (looksLikePhoneNumber(raw) || looksLikeAddress(raw)) return null;
  for (const form of DOB_FORMS) {
    const match = form.pattern.exec(raw);
    if (!match) continue;
    const parts = form.map(match);
    // A pattern match is NOT enough: the parsed date must be a real one.
    if (isRealCalendarDate(parts.month, parts.day, parts.year)) {
      return { text: match[0], ...parts };
    }
  }
  return null;
}

function dateOfBirthOccurrences(text) {
  const raw = String(text ?? '');
  const occurrences = [];
  for (const form of DOB_FORMS) {
    const pattern = new RegExp(form.pattern.source, `${form.pattern.flags.replace('g', '')}g`);
    for (const match of raw.matchAll(pattern)) {
      const parts = form.map(match);
      if (isRealCalendarDate(parts.month, parts.day, parts.year)) {
        occurrences.push({ text: match[0], ...parts, index: match.index });
      }
    }
  }
  return occurrences
    .sort((a, b) => a.index - b.index)
    .filter((item, index, all) => index === 0 || item.index !== all[index - 1].index);
}

/** Backwards-compatible span accessor: the matched text, or null. */
export function extractDateOfBirth(text) {
  return parseDateOfBirth(text)?.text ?? null;
}

// A name value must look like a name: 1–3 alphabetic tokens. This rejects a
// grader trying to pass "date of birth", a number, or a whole sentence as a name.
const NAME_TOKEN = /^[\p{L}][\p{L}'’-]*$/u;

export function looksLikePersonName(value) {
  const tokens = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 4) return false;
  return tokens.every((token) => NAME_TOKEN.test(token));
}

// ── Name ownership: is this the PATIENT's name? ──────────────────────────────
//
// A name-shaped token proves only that a name was said. The review demonstrated
// a fabricated identity that satisfied every earlier check while the patient's
// name was never collected at all:
//
//    firstName "Dana"  from the navigator greeting "this is Dana"
//    lastName  "Reyes" from the caller saying "I need Dr. Reyes"
//    dob       from the caller
//
// So a name claim must now be grounded in a PATIENT-IDENTITY CONTEXT. Two rules
// do the work:
//
//   (a) Identifiers must come from a CALLER-side turn. The navigator saying a
//       name proves nothing about what the caller supplied — it may be a
//       self-introduction, a provider, or a value read off the chart.
//   (b) Within that caller turn, the value must sit inside a span that names
//       THE PATIENT: a self-identification, an explicit third-party designation
//       ("calling for my daughter, Maria Alvarez"), or a direct answer to the
//       navigator's patient-name question.
//
// Precedence matters. "My name is Sarah, but the appointment is for Maria
// Alvarez" contains BOTH a self-identification and an explicit third-party
// designation; the designation wins, so Sarah is not the patient and Maria is.
//
// This can only WITHHOLD credit. It never creates verification, so its failure
// mode is a criterion the supervisor still reviews.

const NAME_CAPTURE = "([\\p{L}][\\p{L}'’-]*(?:\\s+[\\p{L}][\\p{L}'’-]*){0,3})";

// ── Name stopwords (correction pass #3) ──────────────────────────────────────
//
// A captured "name" span may contain ordinary English the broad 1–3-token
// capture swept up ("This is about my refill" → "about my refill"). A real
// patient name token is never one of these, so they are removed from every span
// and a claimed identifier value that IS one is rejected outright. This is a
// SAFETY NET, not the primary gate: the primary gate is that the value must sit
// inside a genuine patient-designation span (see `patientNameSpans`).
const NAME_STOPWORDS = new Set([
  // articles / determiners
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  // pronouns / possessives
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his', 'she',
  'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'ours', 'they', 'them', 'their',
  'theirs', 'who', 'whom', 'whose',
  // prepositions / conjunctions
  'for', 'of', 'to', 'on', 'in', 'at', 'with', 'about', 'from', 'by', 'and',
  'but', 'or', 'so', 'as', 'is', 'am', 'are', 'was', 'were', 'be', 'been',
  // request / action / workflow nouns
  'refill', 'refills', 'prescription', 'prescriptions', 'medication', 'medications',
  'med', 'meds', 'appointment', 'appointments', 'appt', 'visit', 'visits', 'call',
  'calling', 'schedule', 'scheduling', 'reschedule', 'cancel', 'book', 'booking',
  'question', 'questions', 'help', 'need', 'needs', 'want', 'wants', 'result',
  'results', 'lab', 'labs', 'test', 'tests', 'referral', 'referrals', 'message',
  'messages', 'portal', 'order', 'orders', 'ultrasound', 'sonogram', 'exam',
  'chart', 'record', 'records', 'form', 'forms', 'insurance', 'pharmacy',
  // weekdays / relative time
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'today', 'tomorrow', 'yesterday', 'next', 'last', 'morning', 'afternoon',
  'evening', 'week', 'weeks', 'month', 'months', 'day', 'days',
  // fillers / greetings
  'yes', 'no', 'okay', 'ok', 'sure', 'hi', 'hello', 'hey', 'um', 'uh', 'please',
  'thanks', 'thank', 'name', 'first', 'last', 'full', 'birth', 'date', 'dob',
  'also',
]);

function isNameStopword(token) {
  return NAME_STOPWORDS.has(String(token ?? '').toLowerCase());
}

// Keep only genuine name-shaped, non-stopword tokens from a captured span. An
// empty result means the "span" was ordinary request language, not a name.
function filterNameSpanTokens(span) {
  return String(span ?? '')
    .split(/\s+/)
    .filter((token) => token && NAME_TOKEN.test(token) && !isNameStopword(token));
}

// A FULL-PERSON DESIGNATION ("this is Maria Alvarez", "my daughter, Jane
// Alvarez") is a proper name, which is capitalized. The broad self-identification
// capture would otherwise swallow ordinary lowercase phrases — "I am really
// scared" → "really scared" — and treat them as a rival patient name, so a
// designation token must be Title-cased. Deliberately fail-closed: a genuinely
// lowercased name in a designation withholds credit and routes to review rather
// than guessing. Single-FIELD answers to an explicit patient-name question are
// NOT filtered this way — the navigator's question already grounds them.
function properNameTokens(span) {
  const tokens = filterNameSpanTokens(span);
  return tokens.filter((token, index) => {
    if (/^[\p{Lu}]/u.test(token)) return true;
    // Preserve a recognized lowercase surname particle ("de", "la", "van") ONLY
    // when it sits inside a real proper-name structure — flanked by Title-cased
    // proper-name tokens (correction pass #6, B5) — so "Maria de la Cruz" keeps
    // its particles for splitPersonName while ordinary lowercase prose
    // ("really scared") is still dropped.
    if (SURNAME_PARTICLE_WORDS.has(token.toLowerCase())) {
      const properBefore = tokens.slice(0, index).some((t) => /^[\p{Lu}]/u.test(t));
      const properAfter = tokens.slice(index + 1).some((t) => /^[\p{Lu}]/u.test(t));
      return properBefore && properAfter;
    }
    return false;
  });
}

// An optional adjective between the possessive and the family relation.
const RELATION_ADJECTIVE = '(?:other\\s+|second\\s+|third\\s+|eldest\\s+|oldest\\s+|youngest\\s+|older\\s+|younger\\s+|little\\s+|baby\\s+|new\\s+)?';

// The patient is explicitly someone other than (or named apart from) the speaker.
const THIRD_PARTY_PATIENT_PATTERNS = [
  new RegExp(`\\b(?:the\\s+)?(?:appointment|visit|call|referral)\\s+is\\s+for\\s+${NAME_CAPTURE}`, 'iu'),
  new RegExp(`\\bcalling\\s+(?:in\\s+)?(?:for|about|on\\s+behalf\\s+of)\\s+(?:my\\s+[\\p{L}]+\\s*,?\\s*)?${NAME_CAPTURE}`, 'iu'),
  new RegExp(`\\b(?:the\\s+)?patient(?:'s|’s)?(?:\\s+name)?\\s+is\\s+${NAME_CAPTURE}`, 'iu'),
  // An optional relation adjective ("my OTHER daughter", "my second son") is
  // allowed so a switched-to patient is still captured (correction pass #6, B3).
  new RegExp(`\\bfor\\s+my\\s+${RELATION_ADJECTIVE}(?:daughter|son|child|kid|wife|husband|mother|father|partner|sister|brother)\\s*,?\\s*${NAME_CAPTURE}`, 'iu'),
  new RegExp(`\\bmy\\s+${RELATION_ADJECTIVE}(?:daughter|son|child|kid|wife|husband|mother|father|partner|sister|brother)(?:'s|’s)?\\s*,?\\s*(?:name\\s+is\\s+)?${NAME_CAPTURE}`, 'iu'),
];

// Qualifiers that may sit between the possessive and the word "name":
// "my first name", "your last name", "the patient's full legal name".
const NAME_QUALIFIERS = "(?:full\\s+|first\\s+|last\\s+|legal\\s+|maiden\\s+|and\\s+)*";

// The speaker is the patient and is identifying themselves.
const SELF_IDENTIFICATION_PATTERNS = [
  new RegExp(`\\b(?:this\\s+is|it(?:'s|’s|\\s+is))\\s+${NAME_CAPTURE}`, 'iu'),
  new RegExp(`\\bmy\\s+${NAME_QUALIFIERS}name(?:'s|’s)?\\s+(?:is\\s+)?${NAME_CAPTURE}`, 'iu'),
  new RegExp(`\\bi(?:'m|’m|\\s+am)\\s+${NAME_CAPTURE}`, 'iu'),
  new RegExp(`\\bspeaking(?:\\s+with)?\\s*,?\\s*${NAME_CAPTURE}`, 'iu'),
];

// A navigator question that asks for the PATIENT's name, so the caller's next
// turn is an answer that establishes patient identity.
//
// Third-person possessives matter as much as second-person ones: a parent
// calling about a child is asked for HIS or HER name, and that exchange
// establishes the patient's identity just as directly as "your name".
const PATIENT_POSSESSIVE = "(?:patient(?:'s|’s)?|your|his|her|their|the\\s+child(?:'s|’s)?)";
const PATIENT_NAME_QUESTION_PATTERNS = [
  new RegExp(`\\b${PATIENT_POSSESSIVE}\\s+${NAME_QUALIFIERS}name\\b`, 'i'),
  /\bfirst\s+and\s+last\s+name\b/i,
  // A comma list: "first name, last name, and date of birth".
  /\bfirst\s+name\b[^?.!]{0,40}\blast\s+name\b/i,
  // A bare field question — "first name?", "and the last name?", "full name".
  /\b(?:the\s+)?(?:first|last|full|legal|maiden)\s+name\b/i,
  // Narrowed from a bare "who is" (which also swallowed "who is your provider").
  /\bwho\s+(?:am\s+i\s+speaking\s+(?:with|to)|is\s+(?:the\s+patient|this))\b/i,
  // "Can I have ... name?" in any phrasing that reaches the word "name".
  /\b(?:can|could|may)\s+i\s+(?:have|get|ask\s+for)\b[^?.!]{0,60}\bname\b/i,
  /\bspell\s+(?:your|the|her|his|their)\s+(?:last\s+)?name\b/i,
  /\bname\s+on\s+the\s+(?:account|chart|file)\b/i,
];

// A navigator question that asks for a PROVIDER / STAFF name, so the caller's
// answer identifies a clinician — never the patient. This takes precedence over
// the patient-name-question patterns (correction pass #3): "Can I have the
// doctor's name?" contains "name" but is not a patient-identity exchange.
// One clinician/staff term alternation, reused across the patterns. "ob/gyn"
// must precede "ob" in the alternation so the longer form matches first.
// The OB/GYN spellings ("ob-gyn", "ob gyn", "ob/gyn", "obgyn") must be matched
// before bare "ob", so the alternation lists the compound forms first.
const PROVIDER_TERM = "(?:provider|doctor|physician|dr\\.?|nurse|midwife|np|pa|clinician|specialist|surgeon|obstetrician|gynecologist|ob[\\s./-]?gyn|obgyn|ob|gyn)";
// Optional FIELD qualifiers that may sit between the clinician term and "name":
// "first", "last", "first and last", "full", "legal", "maiden". Without these a
// provider FULL-NAME question ("your OB's last name", "the doctor's first and
// last name") slipped past the detector and was treated as a patient question.
const CLINICIAN_NAME_QUALIFIER = "(?:first\\s+and\\s+last\\s+|first\\s+|last\\s+|full\\s+|legal\\s+|maiden\\s+)*";
const PROVIDER_NAME_QUESTION_PATTERNS = [
  // Provider term BEFORE "name": "the doctor's first and last name".
  new RegExp(`\\b${PROVIDER_TERM}(?:'s|’s)?\\s+${CLINICIAN_NAME_QUALIFIER}name\\b`, 'i'),
  // "name" BEFORE the provider term: "first and last name of your doctor",
  // "full name of the provider", "name of the midwife" (correction pass #6, B6).
  new RegExp(`\\b${CLINICIAN_NAME_QUALIFIER}name\\s+of\\s+(?:your|the|her|his|their|our)\\s+${PROVIDER_TERM}\\b`, 'i'),
  new RegExp(`\\bwho\\s+is\\s+(?:your|the|her|his|their)\\s+${PROVIDER_TERM}\\b`, 'i'),
  new RegExp(`\\bwhich\\s+${PROVIDER_TERM}\\b`, 'i'),
  new RegExp(`\\bspell\\s+(?:your|the|her|his|their)\\s+${PROVIDER_TERM}(?:'s|’s)?\\s+${CLINICIAN_NAME_QUALIFIER}name\\b`, 'i'),
];

// Titles that mark a name as a provider or staff member, never the patient.
const PROVIDER_TITLE_BEFORE = /\b(?:dr|dr\.|doctor|nurse|midwife|np|pa|rn|md|provider|receptionist|pharmacist)\s+$/i;

function isProviderNameQuestion(text) {
  return PROVIDER_NAME_QUESTION_PATTERNS.some((pattern) => pattern.test(String(text ?? '')));
}

function isPatientNameQuestion(text) {
  const raw = String(text ?? '');
  // A provider-name question is never a patient-name question, even though it
  // reaches the word "name".
  if (isProviderNameQuestion(raw)) return false;
  return PATIENT_NAME_QUESTION_PATTERNS.some((pattern) => pattern.test(raw));
}

function collectSpans(text, patterns) {
  const spans = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const scanner = new RegExp(pattern.source, flags);
    let match;
    while ((match = scanner.exec(text)) !== null) {
      if (match[1]) spans.push(match[1]);
      if (match[0] === '') scanner.lastIndex += 1;
    }
  }
  return spans;
}

function patientNameQuestionField(text) {
  const raw = String(text ?? '');
  if (isProviderNameQuestion(raw)) return null;
  if (/\bfirst\s+and\s+last\s+name\b/i.test(raw)) return 'fullName';
  const first = /\bfirst\s+name\b/i.test(raw);
  const last = /\blast\s+name\b/i.test(raw);
  if (/\b(?:full|legal)\s+name\b/i.test(raw) || (first && last)) return 'fullName';
  if (first) return 'firstName';
  if (last) return 'lastName';
  return isPatientNameQuestion(raw) ? 'fullName' : null;
}

// ── Conservative name-component splitting (correction pass #5, B4) ───────────
//
// A full name does NOT reliably decompose into "first token = given name, every
// remaining token = surname". "Maria Elena Alvarez" may carry a MIDDLE name, so
// treating "Elena Alvarez" as the surname is wrong — it can award an incorrect
// last name or reject the correct one. The project sources establish no policy
// that every trailing token is the surname, so we FAIL CLOSED on ambiguity.
//
// Supported, bounded, auditable structures:
//   * exactly two tokens                       -> first = t0, last = t1
//   * a recognized surname-particle run that begins right after the first token
//     and is followed by exactly one surname token ("Maria de la Cruz",
//     "Maria del Rio") -> first = t0, last = the particle(s) + final token
//   * hyphenated / apostrophe surnames are already single tokens
// Anything else (3+ tokens with an unrecognized middle) returns null: the
// surname cannot be determined from the full name alone, so a last-name claim
// must be grounded by a separate last-name exchange or route to review.
//
// The particle list is deliberately BOUNDED and documented so it stays
// auditable; it is not a general onomastics engine.
const SURNAME_PARTICLE_SEQUENCES = [
  ['de', 'la'], ['de', 'los'], ['de', 'las'],
  ['van', 'der'], ['van', 'den'], ['von', 'der'],
  ['de'], ['del'], ['della'], ['di'], ['da'], ['dos'], ['das'], ['du'],
  ['van'], ['von'], ['der'], ['den'], ['la'], ['le'], ['el'], ['al'],
  ['bin'], ['ibn'], ['mac'], ['mc'], ['saint'], ['st'],
].sort((a, b) => b.length - a.length);

// The same particle tokens as a flat set, used by `properNameTokens` to keep a
// legitimately-lowercase particle inside a proper-name structure. Referenced
// before its declaration only inside function bodies, which run after the module
// is fully initialized.
const SURNAME_PARTICLE_WORDS = new Set(SURNAME_PARTICLE_SEQUENCES.flat());

/**
 * Split a person name into first-name and surname token arrays, conservatively.
 * Returns null when the surname cannot be determined without guessing.
 */
export function splitPersonName(text) {
  const tokens = filterNameSpanTokens(text);
  if (tokens.length < 2) return null;
  if (tokens.length === 2) return { firstName: [tokens[0]], lastName: [tokens[1]] };
  const lower = tokens.map((token) => token.toLowerCase());
  for (const seq of SURNAME_PARTICLE_SEQUENCES) {
    // The particle run must start exactly at token 1 and be followed by exactly
    // one surname token: first = t0, surname = particle(s) + final token.
    if (tokens.length === 1 + seq.length + 1
      && seq.every((particle, offset) => lower[1 + offset] === particle)) {
      return { firstName: [tokens[0]], lastName: tokens.slice(1) };
    }
  }
  return null;
}

// Retained internal alias for existing call sites.
const nameComponents = splitPersonName;

/**
 * Every name span in ONE caller turn that genuinely designates THE PATIENT.
 *
 * @param {string} text            the caller turn
 * @param {string} precedingNavigatorText the navigator turn immediately before it
 * @returns {string[]} patient-owned name spans (possibly empty)
 */
/**
 * Patient-name spans WITH their kind. `kind` distinguishes a full-person
 * DESIGNATION (a self-identification or third-party designation — "Maria Smith")
 * from a single-FIELD answer to a navigator question ("Maria." / "Alvarez.").
 * Only designations can make an attempt ambiguous; two field answers are two
 * fields of one patient (a first name in one turn, a hyphenated surname in the
 * next), never two different people.
 *
 * @returns {{ text: string, kind: 'designation'|'field' }[]}
 */
export function classifyPatientNameSpans(text, precedingNavigatorText = '') {
  const raw = String(text ?? '');
  if (!raw.trim()) return [];

  // Every candidate span is filtered to its genuine name tokens (stopwords and
  // ordinary request words removed). A span that filters to nothing was request
  // language the broad capture swept up, not a name, and is dropped.
  const keep = (spans) => spans
    .map((span) => properNameTokens(span).join(' '))
    .filter((span) => span.length > 0);

  // Precedence 1 — an explicit third-party designation. When the caller names
  // the patient separately, a self-identification in the SAME turn is the
  // caller's own name, not the patient's.
  const thirdParty = keep(collectSpans(raw, THIRD_PARTY_PATIENT_PATTERNS));
  if (thirdParty.length > 0) return thirdParty.map((span) => ({ text: span, kind: 'designation', subject: 'thirdParty' }));

  // Precedence 2 — the caller identifies themselves as the patient.
  const self = keep(collectSpans(raw, SELF_IDENTIFICATION_PATTERNS));
  if (self.length > 0) {
    const askedField = patientNameQuestionField(precedingNavigatorText);
    const selfField = askedField ?? (/\bmy\s+first\s+name\b/i.test(raw) ? 'firstName'
      : /\bmy\s+last\s+name\b/i.test(raw) ? 'lastName' : null);
    return self.map((span) => selfField
      ? { text: span, kind: 'field', field: selfField, subject: 'self' }
      : { text: span, kind: 'designation', subject: 'self' });
  }

  // Precedence 3 — an answer to the navigator's patient-name question.
  //
  // The answer is frequently NOT bare: a caller asked for "first name, last name
  // and date of birth" replies "Sure, Liam Carter, March 2nd 2021." So take the
  // LEADING name span — the first run of name-shaped tokens after any filler,
  // stopping at a month name or anything containing a digit, because from there
  // on the caller is answering the date-of-birth part of the same question. A
  // one-word answer ("Maria.") is a valid span here.
  const questionField = patientNameQuestionField(precedingNavigatorText);
  if (questionField) {
    const stripped = raw
      .replace(/\b(?:it\s+is|that\s+is|sure\s+it(?:'s|’s)|yes|yeah|yep|sure|okay|ok|hi|hello|um|uh|it(?:'s|’s)|that(?:'s|’s))\b/gi, ' ')
      .replace(/[^\p{L}\p{N}\s'’-]/gu, ' ');
    const span = [];
    for (const token of stripped.split(/\s+/).filter(Boolean)) {
      const lower = token.toLowerCase();
      if (MONTHS[lower] !== undefined || /\p{N}/u.test(token)) break;
      if (!NAME_TOKEN.test(token)) break;
      // A leading filler/stopword ("the", "a") is skipped rather than ending the
      // span, but a real name token that is ALSO a stopword cannot occur, so this
      // conservatively drops stopwords from the answer span.
      if (isNameStopword(token)) {
        if (span.length > 0) break;
        continue;
      }
      span.push(token);
      if (span.length === 4) break;
    }
    if (span.length > 0) return [{ text: span.join(' '), kind: 'field', field: questionField }];
  }

  return [];
}

/** Patient-name span TEXT only (kind discarded), for ownership checks. */
export function patientNameSpans(text, precedingNavigatorText = '') {
  return classifyPatientNameSpans(text, precedingNavigatorText).map((span) => span.text);
}

/**
 * Is `value` established as the patient's name in this turn?
 *
 * Returns a reason string when it is NOT, or null when it is.
 */
function nameOwnershipFailure(turns, turnIndex, role, field, value) {
  // (a) Identifiers must be supplied by the caller side.
  if (!CALLER_ROLE_ALIASES.has(role)) return 'not-a-patient-identity-context';

  const text = String(turns[turnIndex]?.text ?? '');

  // A provider/staff title immediately before the value disqualifies it outright,
  // whatever else the turn contains.
  const position = text.toLowerCase().indexOf(String(value).toLowerCase());
  if (position > 0 && PROVIDER_TITLE_BEFORE.test(text.slice(0, position))) {
    return 'not-a-patient-identity-context';
  }

  // The nearest PRECEDING navigator turn provides question context.
  let preceding = '';
  for (let index = turnIndex - 1; index >= 0; index--) {
    if (turns[index]?.role === 'navigator') { preceding = String(turns[index].text ?? ''); break; }
  }

  const spans = classifyPatientNameSpans(text, preceding);
  if (spans.length === 0) return 'not-a-patient-identity-context';

  // A value may be multi-token after normalization (a hyphenated surname
  // "Alvarez-Reyes" becomes "alvarez reyes"). Every value token must appear in
  // one patient-designation span.
  const valueTokens = normalizeForMatch(value).split(' ').filter(Boolean);
  const owned = spans.some((span) => {
    const spanTokens = normalizeForMatch(span.text).split(' ').filter(Boolean);
    if (span.kind === 'field') {
      if (span.field !== 'fullName') {
        return span.field === field && valueTokens.join(' ') === spanTokens.join(' ');
      }
      const components = nameComponents(span.text);
      const expected = components?.[field]?.map((token) => normalizeForMatch(token));
      return expected && valueTokens.join(' ') === expected.join(' ');
    }
    const components = nameComponents(span.text);
    if (!components) return false;
    const expected = components[field]?.map((token) => normalizeForMatch(token));
    return expected && valueTokens.join(' ') === expected.join(' ');
  });
  return owned ? null : 'name-field-does-not-match-patient-component';
}

// ── Per-claim verification ───────────────────────────────────────────────────

/**
 * Verify ONE structured identifier claim against the transcript.
 *
 * Every link in the chain is re-derived server-side:
 *   1. the field is a known identifier;
 *   2. the declared turn index exists and its role matches the declared role;
 *   3. the quote appears verbatim (under shared normalization) in THAT turn;
 *   4. the claimed value appears inside the quote;
 *   5. the value is shaped like the identifier it claims to be (a name looks
 *      like a name; a DOB parses as a REAL calendar date and is not a
 *      phone/address);
 *   6. for a NAME, the value is established as the PATIENT's name by the turn's
 *      own identity context — a navigator self-introduction, a provider or
 *      staff name, or an unrelated mention can never satisfy it.
 *
 * @returns {{ ok: true, field, value, turnIndex, role, quote } | { ok: false, field, reason }}
 */
export function verifyIdentifierClaim(transcript, claim) {
  const turns = Array.isArray(transcript) ? transcript : [];
  const field = String(claim?.field ?? '');
  if (!IDENTITY_FIELD_SET.has(field)) return { ok: false, field, reason: 'unknown-identifier-field' };

  const role = String(claim?.role ?? '').toLowerCase();
  if (role !== 'navigator' && !CALLER_ROLE_ALIASES.has(role)) {
    return { ok: false, field, reason: 'invalid-role' };
  }

  const turnIndex = Number(claim?.turnIndex);
  if (!Number.isInteger(turnIndex) || turnIndex < 0 || turnIndex >= turns.length) {
    return { ok: false, field, reason: 'turn-index-out-of-range' };
  }
  const turn = turns[turnIndex];
  if (!turnRoleMatches(turn?.role, role)) return { ok: false, field, reason: 'role-mismatch' };

  const quote = normalizeForMatch(stripRoleLabel(claim?.quote));

  const rawValue = String(claim?.value ?? '').trim();
  if (!rawValue) return { ok: false, field, reason: 'missing-value' };
  const value = normalizeForMatch(rawValue);

  // A one-word quote is normally too weak to be evidence. But a genuine one-word
  // name ANSWER — "First name?" / "Maria." — is a legitimate identity exchange
  // (correction pass #3, B3). Allow a single-token quote ONLY when it is a
  // caller-side NAME claim whose quote is essentially just the value, so the
  // preceding patient-name question (checked in ownership below) does the
  // grounding. Everything else still needs a two-word quote, and a DOB is never
  // a single bare token here.
  const singleTokenIdentity = field !== 'dob'
    && CALLER_ROLE_ALIASES.has(role)
    && quoteWords(quote).length === 1
    && quote === value;
  if (!singleTokenIdentity && quoteWords(quote).length < 2) {
    return { ok: false, field, reason: 'quote-too-short' };
  }
  if (!normalizeForMatch(turn?.text).includes(quote)) {
    return { ok: false, field, reason: 'quote-not-in-declared-turn' };
  }

  if (!value || !quote.includes(value)) return { ok: false, field, reason: 'value-not-in-quote' };

  if (field === 'dob') {
    // The claimed value itself must parse as a REAL calendar date of birth. A
    // phone number, an address, or February 31 can never satisfy this.
    if (!parseDateOfBirth(rawValue)) return { ok: false, field, reason: 'value-is-not-a-date-of-birth' };
    // A DOB is an identifier the CALLER supplies; a navigator reading one off
    // the chart proves nothing about verification.
    if (!CALLER_ROLE_ALIASES.has(role)) {
      return { ok: false, field, reason: 'not-a-patient-identity-context' };
    }
  } else {
    if (!looksLikePersonName(rawValue)) return { ok: false, field, reason: 'value-is-not-a-name' };
    // Ordinary request/scheduling words are never a name, even if a broad span
    // captured them. Every token of the claimed value must be a real name token.
    if (rawValue.split(/\s+/).some((token) => isNameStopword(token))) {
      return { ok: false, field, reason: 'value-is-not-a-name' };
    }
    const ownership = nameOwnershipFailure(turns, turnIndex, role, field, rawValue);
    if (ownership) return { ok: false, field, reason: ownership };
  }

  // Preserve the VERIFIED CALLER QUOTE (not the bare value): a multi-turn
  // third-party DOB carries its ownership language in the caller's own answer
  // ("Her DOB is …", "the patient's DOB is …"), and replacing the quote with the
  // value discarded exactly that language (correction pass #5, B2). `value` stays
  // normalized for token comparisons; `rawValue` is the original value text; and
  // `quote` is the original verified caller quote, retained separately.
  return {
    ok: true, field, value, turnIndex, role,
    rawValue,
    quote: stripRoleLabel(String(claim?.quote ?? '')),
    normalizedQuote: quote,
  };
}

// ── One patient subject (correction pass #3, B1) ─────────────────────────────
//
// The three identifiers must belong to ONE patient. The previous evaluation
// accepted each field independently, so a caller's own DOB could pair with a
// different patient's name, or first and last name could come from two different
// people. `resolvePatientSubject` establishes the single patient's name tokens
// from the whole call and reports when two different people were named as the
// patient (ambiguous → fail closed).

// Deterministic navigator/caller cues that a NEW patient is now being discussed.
// A cue closes the current field-answer sequence and opens another, so typed
// field answers on either side of it can never be flattened into one identity.
// Deliberately conservative: bare "now" phrasing only counts when it is followed
// by an explicit other/second-patient reference, so a routine "and now your date
// of birth?" on a single-patient call is NOT a switch.
const SUBJECT_SWITCH_CUES = [
  /\b(?:second|other|another|different|next)\s+patient\b/i,
  /\b(?:second|other|another)\s+child\b/i,
  /\bmy\s+other\s+(?:daughter|son|child|kid)\b/i,
  /\bswitching\s+to\b/i,
  /\bregarding\s+the\s+other\b/i,
  /\bnow\s+for\s+(?:the\s+)?(?:second|other|another|my\s+other)\b/i,
  /\bfor\s+(?:the\s+)?(?:second|other|another)\s+(?:patient|child|one)\b/i,
];

function hasSubjectSwitchCue(text) {
  return SUBJECT_SWITCH_CUES.some((pattern) => pattern.test(String(text ?? '')));
}

/**
 * Resolve the ONE patient the call is about, as a set of normalized name tokens.
 *
 * Correction pass #5 (B3): typed field answers are grouped into discrete
 * candidate SEQUENCES rather than flattened across the whole transcript, so a
 * first name from patient A and a last name from an explicitly-announced second
 * patient B can never be combined. A subject-switch cue (or a second full
 * designation) opens a new candidate; field answers that span more than one
 * candidate fail closed.
 *
 * @returns {{ tokens: Set<string>, ambiguous: boolean, spans: object[],
 *             candidates: object[] }}
 */
export function resolvePatientSubject(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  const spans = [];
  let sequenceId = 0;
  for (let index = 0; index < turns.length; index++) {
    // A switch cue in ANY turn (usually the navigator's prompt) opens a new
    // candidate sequence before the caller's answer is attributed.
    if (hasSubjectSwitchCue(turns[index]?.text)) sequenceId += 1;
    if (!CALLER_ROLE_ALIASES.has(turns[index]?.role)) continue;
    let preceding = '';
    for (let prior = index - 1; prior >= 0; prior--) {
      if (turns[prior]?.role === 'navigator') { preceding = String(turns[prior].text ?? ''); break; }
    }
    for (const span of classifyPatientNameSpans(String(turns[index].text ?? ''), preceding)) {
      const tokens = normalizeForMatch(span.text).split(' ').filter(Boolean);
      if (tokens.length) {
        spans.push({
          tokens, turnIndex: index, kind: span.kind,
          field: span.field ?? null, subject: span.subject ?? null, sequenceId,
        });
      }
    }
  }
  // Two FULL-PERSON DESIGNATIONS that share no tokens, where at least one is a
  // multi-token full name, means two different people were designated as the
  // patient — e.g. "calling for Maria Smith and my daughter Jane Alvarez".
  const designations = spans.filter((span) => span.kind === 'designation' || span.field === 'fullName');
  // Distinguish a THIRD-PARTY designation from a self/patient designation with
  // the SAME name tokens: a caller and a patient who happen to share a name are
  // two different people, so "My name is Maria Alvarez" + "calling for my
  // daughter Maria Alvarez" is an ambiguous subject, not one patient
  // (correction pass #6, B3). A self-identification and a full-name answer with
  // the same tokens remain one candidate.
  const designationKey = (span) => `${span.subject === 'thirdParty' ? 'thirdParty' : 'patient'}|${span.tokens.join(' ')}`;
  const uniqueDesignations = [...new Map(designations.map((span) => [designationKey(span), span])).values()];

  // Typed field answers are grouped by their candidate SEQUENCE. A single field
  // answered with two different values inside ONE candidate is a mid-sequence
  // switch/correction (fail closed); field answers spread across MORE THAN ONE
  // candidate sequence are two different patients (fail closed). Exact repeats
  // inside one candidate deduplicate and are harmless.
  const sequenceFields = spans.filter((span) => span.kind === 'field' && span.field !== 'fullName');
  const fieldSequences = new Map();
  for (const span of sequenceFields) {
    const byField = fieldSequences.get(span.sequenceId) ?? new Map();
    const values = byField.get(span.field) ?? new Set();
    values.add(span.tokens.join(' '));
    byField.set(span.field, values);
    fieldSequences.set(span.sequenceId, byField);
  }
  const withinCandidateConflict = [...fieldSequences.values()]
    .some((byField) => [...byField.values()].some((values) => values.size > 1));
  const fieldCandidateCount = fieldSequences.size;

  const ambiguous = uniqueDesignations.length > 1
    || withinCandidateConflict
    || fieldCandidateCount > 1;
  const canonicalTokens = ambiguous ? []
    : uniqueDesignations.length === 1
      ? uniqueDesignations[0].tokens
      : sequenceFields.flatMap((span) => span.tokens);
  return {
    tokens: new Set(canonicalTokens), ambiguous, spans,
    // Value-free structural audit metadata (no identifier values).
    candidates: uniqueDesignations.map((span) => ({ designationTurn: span.turnIndex, kind: span.kind })),
    fieldCandidateCount,
  };
}

// ── Discrete identity candidates (correction pass #6, B3) ────────────────────
//
// A single global Set of patient tokens cannot bind the three identifiers to ONE
// person: a first name from patient A's designation and a last name from patient
// B's field answer both live in the shared Set. Candidates fix this — every
// identity claim binds to ONE discrete candidate (a designation, or a coherent
// typed-field sequence), and a complete identity requires all three from the
// SAME candidate. Metadata is deliberately VALUE-FREE except the name tokens the
// server must compare against; nothing here is persisted or logged.
//
// @returns {{ candidates: object[] }}
export function resolveIdentityCandidates(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  const subject = resolvePatientSubject(turns);
  const candidates = [];
  let sequenceId = 0;
  let activeCandidate = null;

  for (let index = 0; index < turns.length; index++) {
    if (hasSubjectSwitchCue(turns[index]?.text)) { sequenceId += 1; activeCandidate = null; }
    if (!CALLER_ROLE_ALIASES.has(turns[index]?.role)) continue;
    let preceding = '';
    for (let prior = index - 1; prior >= 0; prior--) {
      if (turns[prior]?.role === 'navigator') { preceding = String(turns[prior].text ?? ''); break; }
    }
    const spans = classifyPatientNameSpans(String(turns[index].text ?? ''), preceding);
    for (const span of spans) {
      const normTokens = normalizeForMatch(span.text).split(' ').filter(Boolean);
      if (!normTokens.length) continue;
      if (span.kind === 'designation' || span.field === 'fullName') {
        const subjectType = span.subject ?? 'unknown';
        const key = `${sequenceId}|${subjectType === 'thirdParty' ? 'thirdParty' : 'patient'}|${normTokens.join(' ')}`;
        let cand = candidates.find((c) => c.key === key);
        if (!cand) {
          const comps = splitPersonName(span.text);
          cand = {
            id: candidates.length, key, sequenceId, subjectType,
            designationTurn: index, anchored: true,
            firstNameTokens: comps ? comps.firstName.map((t) => normalizeForMatch(t)) : null,
            lastNameTokens: comps ? comps.lastName.map((t) => normalizeForMatch(t)) : null,
            firstNameTurn: comps ? index : null,
            lastNameTurn: comps ? index : null,
            dobTurn: null,
            turns: new Set([index]),
          };
          candidates.push(cand);
        } else cand.turns.add(index);
        activeCandidate = cand;
      } else {
        if (!activeCandidate || activeCandidate.sequenceId !== sequenceId) {
          activeCandidate = {
            id: candidates.length, key: `${sequenceId}|field|${candidates.length}`,
            sequenceId, subjectType: 'unknown', designationTurn: null, anchored: false,
            firstNameTokens: null, lastNameTokens: null, firstNameTurn: null, lastNameTurn: null,
            dobTurn: null, turns: new Set(),
          };
          candidates.push(activeCandidate);
        }
        activeCandidate.turns.add(index);
        if (span.field === 'firstName') {
          activeCandidate.firstNameTokens = normTokens;
          if (activeCandidate.firstNameTurn == null) activeCandidate.firstNameTurn = index;
        } else if (span.field === 'lastName') {
          activeCandidate.lastNameTokens = normTokens;
          if (activeCandidate.lastNameTurn == null) activeCandidate.lastNameTurn = index;
        }
      }
    }
    // Independent DOB detection (no model claim), attributed to the candidate
    // active in this turn. Used to establish an EARLIEST identity chronology the
    // model cannot skew (B1).
    if (activeCandidate && activeCandidate.dobTurn == null) {
      const ownedDob = dateOfBirthOccurrences(turns[index].text)
        .find((dob) => !dobOwnershipFailureAtPosition(turns, index, dob.index, subject));
      if (ownedDob) {
        activeCandidate.dobTurn = index;
        activeCandidate.turns.add(index);
      }
    }
  }
  return { candidates };
}

/** The candidate a verified identity claim binds to, or null. */
function candidateForClaim(candidates, result) {
  if (!result) return null;
  const value = String(result.value ?? '').trim();
  if (result.field === 'firstName') {
    return candidates.find((c) => c.turns.has(result.turnIndex) && c.firstNameTokens?.join(' ') === value)
      ?? candidates.find((c) => c.firstNameTokens?.join(' ') === value && c.firstNameTurn === result.turnIndex)
      ?? null;
  }
  if (result.field === 'lastName') {
    return candidates.find((c) => c.turns.has(result.turnIndex) && c.lastNameTokens?.join(' ') === value)
      ?? candidates.find((c) => c.lastNameTokens?.join(' ') === value && c.lastNameTurn === result.turnIndex)
      ?? null;
  }
  return candidates.find((c) => c.dobTurn === result.turnIndex)
    ?? candidates.find((c) => c.turns.has(result.turnIndex))
    ?? null;
}

/**
 * The EARLIEST turn by which a complete, coherent, single-patient identity is
 * INDEPENDENTLY derivable from the transcript — never from the model's selected
 * claims (correction pass #6, B1). This is what the af-hipaa auto-zero and the
 * verify-before-access chronology must consult, so a model that submits only a
 * LATER repetition of an identity cannot make the server believe verification
 * happened after a disclosure when it actually happened before.
 *
 * @returns {{ earliestIndex: number|null, ambiguous: boolean }}
 */
export function earliestCompleteIdentity(transcript) {
  const subject = resolvePatientSubject(transcript);
  const { candidates } = resolveIdentityCandidates(transcript);
  const complete = candidates
    .filter((c) => c.firstNameTokens?.length && c.lastNameTokens?.length && c.dobTurn != null)
    .map((c) => Math.max(c.firstNameTurn ?? 0, c.lastNameTurn ?? 0, c.dobTurn));
  if (complete.length === 0) return { earliestIndex: null, ambiguous: subject.ambiguous };
  return { earliestIndex: Math.min(...complete), ambiguous: subject.ambiguous };
}

// Name-designation spans in ONE turn WITH their character positions, so a DOB can
// be attributed to the nearest preceding designation.
function designationSpansWithPositions(text) {
  const raw = String(text ?? '');
  const out = [];
  const scan = (patterns) => {
    for (const pattern of patterns) {
      const match = pattern.exec(raw);
      if (!match?.[1]) continue;
      const tokens = properNameTokens(match[1]).map((token) => normalizeForMatch(token)).filter(Boolean);
      if (tokens.length === 0) continue;
      const at = raw.indexOf(match[1], Math.max(0, match.index));
      out.push({ tokens, start: at < 0 ? match.index : at });
    }
  };
  scan(THIRD_PARTY_PATIENT_PATTERNS);
  scan(SELF_IDENTIFICATION_PATTERNS);
  return out;
}

/**
 * Does the DOB in `dobTurnIndex` belong to the resolved patient? A DOB is
 * rejected only when the NEAREST name designation before it in the same turn
 * names someone OTHER than the patient — e.g. "My name is Sarah Jones, date of
 * birth March 2 1991, but the appointment is for Maria Alvarez": the DOB is
 * locally bound to Sarah, not to the patient Maria. A DOB with no competing
 * designation (a bare answer, "Her DOB is …") is accepted.
 *
 * @returns {string|null} a reason when it does NOT belong to the patient, else null
 */
// Every 0-based index at which `needle` occurs in `haystack` (case-insensitive).
function allIndexesOf(haystack, needle) {
  const out = [];
  if (!needle) return out;
  const hay = String(haystack).toLowerCase();
  const nee = String(needle).toLowerCase();
  let from = 0;
  for (;;) {
    const at = hay.indexOf(nee, from);
    if (at < 0) break;
    out.push(at);
    from = at + 1;
  }
  return out;
}

function lastMatchIndex(text, pattern) {
  let last = -1;
  for (const match of String(text ?? '').matchAll(pattern)) last = match.index;
  return last;
}

function dobOwnershipFailureAtPosition(transcript, dobTurnIndex, dobPos, subject) {
  const text = String(transcript?.[dobTurnIndex]?.text ?? '');
  const beforeDob = text.slice(0, dobPos);
  const priorThirdParty = subject.spans.some((span) => span.subject === 'thirdParty' && span.turnIndex <= dobTurnIndex);
  if (priorThirdParty) {
    const callerOwnedAt = Math.max(
      lastMatchIndex(beforeDob, /\bmy\s+(?:date\s+of\s+birth|dob)\b/gi),
      lastMatchIndex(beforeDob, /\bi\s+was\s+born\b/gi),
    );
    const patientLinkedAt = Math.max(
      lastMatchIndex(beforeDob, /\b(?:the\s+patient(?:'s|’s)?|his|her|the\s+child(?:'s|’s)?)\s+(?:date\s+of\s+birth|dob)\b/gi),
      lastMatchIndex(beforeDob, /\b[\p{L}'’-]+(?:'s|’s)\s+(?:date\s+of\s+birth|dob)\b/giu),
    );
    if (callerOwnedAt > patientLinkedAt) return 'dob-explicitly-caller-owned';
  }

  if (dobPos < 0) return 'dob-claim-span-not-found';
  const preceding = designationSpansWithPositions(text)
    .filter((span) => span.start >= 0 && span.start < dobPos)
    .sort((a, b) => a.start - b.start)
    .at(-1);
  if (preceding) {
    const belongsToPatient = subject.tokens.size > 0
      && preceding.tokens.every((token) => subject.tokens.has(token));
    if (!belongsToPatient) return 'dob-belongs-to-different-subject';
  }

  let question = '';
  for (let index = dobTurnIndex - 1; index >= 0; index--) {
    if (transcript[index]?.role === 'navigator') { question = String(transcript[index].text ?? ''); break; }
  }
  // Ownership may be established by the navigator's question OR by the caller's
  // own verified answer quote.
  const ownershipText = `${question} ${beforeDob}`;
  const patientLinked = /\b(?:the\s+patient(?:'s|’s)?|his|her|the\s+child(?:'s|’s)?)\s+(?:date\s+of\s+birth|dob)\b/i.test(ownershipText)
    || /\b[\p{L}'’-]+(?:'s|’s)\s+(?:date\s+of\s+birth|dob)\b/iu.test(ownershipText);
  if (priorThirdParty && /\byour\s+(?:date\s+of\s+birth|dob)\b/i.test(question) && !patientLinked) {
    return 'dob-ownership-ambiguous-third-party-caller';
  }
  if (priorThirdParty && !preceding && !patientLinked
      && !/\bpatient\s+(?:date\s+of\s+birth|dob)\b/i.test(question)) {
    return 'dob-ownership-not-patient-linked';
  }
  return null;
}

function dobOwnershipFailure(transcript, dobClaim, subject) {
  const dobTurnIndex = dobClaim.turnIndex;
  const text = String(transcript?.[dobTurnIndex]?.text ?? '');
  const valueText = String(dobClaim.rawValue ?? dobClaim.value ?? '');
  const ownershipQuote = String(dobClaim.quote ?? valueText);
  const quoteOccurrences = allIndexesOf(text, ownershipQuote);
  let dobPos;
  if (ownershipQuote && quoteOccurrences.length === 1) {
    const valueInQuote = ownershipQuote.toLowerCase().indexOf(valueText.toLowerCase());
    if (valueInQuote < 0) return 'dob-value-not-in-quote';
    dobPos = quoteOccurrences[0] + valueInQuote;
  } else if (ownershipQuote && quoteOccurrences.length > 1) {
    return 'dob-claim-quote-ambiguous';
  } else {
    const valueOccurrences = allIndexesOf(text, valueText);
    if (valueOccurrences.length === 0) return 'dob-claim-span-not-found';
    if (valueOccurrences.length > 1) return 'dob-claim-quote-ambiguous';
    dobPos = valueOccurrences[0];
  }
  return dobOwnershipFailureAtPosition(transcript, dobTurnIndex, dobPos, subject);
}

// A privacy-safe, VALUE-FREE audit record of what the server established.
function buildIdentityAudit(verified, complete, subjectConsistent, completedAtIndex) {
  const turnOf = (field) => (verified[field] ? verified[field].turnIndex : null);
  return {
    complete: complete === true,
    subjectConsistent: subjectConsistent === true,
    firstNameTurn: turnOf('firstName'),
    lastNameTurn: turnOf('lastName'),
    dobTurn: turnOf('dob'),
    completedAtTurn: completedAtIndex ?? null,
    ownershipBasis: complete ? 'verified-single-patient-identity' : null,
  };
}

/**
 * Verify a whole structured identity-evidence array and decide whether the three
 * required identifiers were genuinely collected — for ONE patient — and by which
 * turn.
 *
 * Identifiers may be spread across any number of chronological turns, and a
 * single caller sentence may satisfy all three. `completedAtIndex` is the LAST
 * turn needed to complete the set, which is what "verification was complete by
 * turn N" means and what the before-disclosure ordering check consumes. Every
 * identifier is bound to ONE resolved patient subject: a name value that is not a
 * token of the patient's name, or a DOB that belongs to a different person, is
 * rejected, and two people named as the patient fails closed.
 *
 * @returns {{ complete: boolean, completedAtIndex: number|null,
 *             verified: Record<string, object>, failures: object[],
 *             subjectConsistent: boolean, audit: object }}
 */
export function evaluateIdentityEvidence(transcript, identityEvidence) {
  const claims = Array.isArray(identityEvidence) ? identityEvidence : [];
  const verified = {};
  const failures = [];
  const subject = resolvePatientSubject(transcript);

  const rawFirst = claims.find((claim) => claim?.field === 'firstName');
  const rawLast = claims.find((claim) => claim?.field === 'lastName');
  if (rawFirst && rawLast && normalizeForMatch(rawFirst.value) === normalizeForMatch(rawLast.value)) {
    failures.push({ ok: false, field: 'lastName', reason: 'last-name-duplicates-first-name' });
  }

  // Two different people were named as THE patient: the identity cannot be bound
  // to one subject, so it fails closed to supervisor review regardless of the
  // individual claims.
  if (subject.ambiguous) {
    failures.push({ ok: false, field: 'subject', reason: 'ambiguous-patient-subject' });
    return {
      complete: false, completedAtIndex: null, verified: {}, failures,
      subjectConsistent: false,
      audit: buildIdentityAudit({}, false, false, null),
    };
  }

  for (const claim of claims) {
    if (claim === rawLast && failures.some((failure) => failure.reason === 'last-name-duplicates-first-name')) continue;
    const result = verifyIdentifierClaim(transcript, claim);
    if (!result.ok) { failures.push(result); continue; }
    // A NAME must be a token of the ONE resolved patient's name. When no patient
    // subject could be resolved at all (size 0) the per-claim ownership check has
    // already rejected non-patient names, so this only tightens, never loosens.
    if (result.field === 'firstName' || result.field === 'lastName') {
      const valueTokens = String(result.value).split(' ').filter(Boolean);
      if (subject.tokens.size > 0 && !valueTokens.every((token) => subject.tokens.has(token))) {
        failures.push({ ok: false, field: result.field, reason: 'name-not-patient-subject' });
        continue;
      }
    }
    // A DOB must belong to the same patient, not to a different person named in
    // the same turn.
    if (result.field === 'dob') {
      const ownership = dobOwnershipFailure(transcript, result, subject);
      if (ownership) { failures.push({ ok: false, field: 'dob', reason: ownership }); continue; }
    }
    // Keep the EARLIEST verified turn per field: identity is established the
    // first time it is genuinely stated, not the last time it is repeated.
    const existing = verified[result.field];
    if (!existing || result.turnIndex < existing.turnIndex) verified[result.field] = result;
  }

  // A grader must not satisfy two identifiers with the same value — otherwise
  // "Maria" alone could be claimed as both first and last name.
  const firstName = verified.firstName;
  const lastName = verified.lastName;
  if (firstName && lastName && firstName.value === lastName.value) {
    failures.push({ ok: false, field: 'lastName', reason: 'last-name-duplicates-first-name' });
    delete verified.lastName;
  }

  let complete = IDENTITY_FIELDS.every((field) => Boolean(verified[field]));

  // ── One-candidate binding (correction pass #6, B3) ──────────────────────────
  // The three identifiers must belong to ONE discrete candidate, not merely share
  // tokens in the resolved subject. When all three resolve to candidates and they
  // are NOT the same one, the identity crosses a candidate/sequence boundary and
  // fails closed. If a candidate cannot be resolved for a claim, the existing
  // subject-token checks above stand (this only ever tightens, never loosens).
  if (complete) {
    const { candidates } = resolveIdentityCandidates(transcript);
    const fnCand = candidateForClaim(candidates, verified.firstName);
    const lnCand = candidateForClaim(candidates, verified.lastName);
    const dobCand = candidateForClaim(candidates, verified.dob);
    if (!fnCand || !lnCand || !dobCand) {
      failures.push({ ok: false, field: 'subject', reason: 'identifier-candidate-unresolved' });
      complete = false;
    } else if (!(fnCand.id === lnCand.id && fnCand.id === dobCand.id)) {
      failures.push({ ok: false, field: 'subject', reason: 'identifiers-cross-candidate' });
      complete = false;
    }
  }

  const completedAtIndex = complete
    ? Math.max(...IDENTITY_FIELDS.map((field) => verified[field].turnIndex))
    : null;
  const subjectConsistent = complete;

  return {
    complete, completedAtIndex, verified, failures,
    subjectConsistent,
    audit: buildIdentityAudit(verified, complete, subjectConsistent, completedAtIndex),
  };
}

// ── Protected-disclosure detection (centralized) ─────────────────────────────
//
// ONE detector, used by the ordering check and by tests. It looks for a
// NAVIGATOR turn that confirms or reveals something patient-specific.
//
// It is a deterministic PATTERN SET, not a comprehensive PHI detector. An
// OVER-match costs a `verify-before-access` criterion the supervisor still
// reviews (the safe direction). An UNDER-match — a real disclosure phrased in a
// way no pattern catches — does NOT fail closed: with no disclosure detected,
// identifiers collected afterward can satisfy the criterion, so a claimed MET can
// survive. This is a trust gate that RAISES the bar, not a guarantee that every
// disclosure is caught. (Correction pass #3: an earlier note wrongly claimed the
// only failure mode was a lost criterion.)

export const PROTECTED_DISCLOSURE_CATEGORIES = Object.freeze({
  appointment: [
    /\byour (?:appointment|appt|visit|follow[- ]?up)\b[^.?!]*\b(?:is|was|on|at|with|for)\b/i,
    /\byou(?:['’]re| are)\s+(?:scheduled|booked|set up|all set)\b/i,
    /\bi (?:have|see|show)\s+(?:you|her|him|them)\s+(?:down\s+)?(?:for|scheduled|booked)\b/i,
    /\byour (?:next|last|upcoming|previous|recent)\s+(?:appointment|appt|visit)\b/i,
    /\byou (?:are|were) (?:seen|scheduled)\b/i,
  ],
  priorVisit: [
    /\byour (?:annual|physical|exam|ultrasound|sonogram|visit|appointment)\b[^.?!]*\b(?:was|were)\s+(?:completed|done|last|back)\b/i,
    /\byou (?:had|came in for|completed|were here for)\b[^.?!]*\b(?:visit|appointment|exam|annual|ultrasound|sonogram|labs?)\b/i,
    /\b(?:last|your last) (?:visit|appointment|exam) (?:was|you)\b/i,
  ],
  chart: [
    /\b(?:the|your) chart (?:shows|says|has|indicates)\b/i,
    /\bi (?:can )?see (?:in )?(?:the|your) (?:chart|record|file)\b/i,
    /\byour (?:record|file) (?:shows|says|has|indicates)\b/i,
  ],
  order: [
    /\b(?:ordered|has ordered|put in an? order|placed an? order)\b/i,
    /\bthere(?:['’]s| is) an? (?:order|referral|requisition)\b/i,
    /\byour (?:order|referral|requisition)\b[^.?!]*\b(?:is|was|for)\b/i,
    // "I can see an ultrasound order", "I show a referral" — a revealing verb
    // plus an order-shaped noun. "in order to" cannot match: it needs a/an/the.
    /\b(?:i (?:can )?see|i show|i have|we have|it shows?|there(?:['’]s| is))\b[^.?!]{0,60}\b(?:an?|the)\s+(?:[\p{L}]+\s+){0,2}(?:orders?|referrals?|requisitions?)\b/iu,
  ],
  providerNote: [
    /\b(?:the )?note (?:from|by)? ?(?:your )?(?:provider|doctor|dr\.?|nurse|midwife)\b[^.?!]*\b(?:says|said|states|indicates|is)\b/i,
    /\byour (?:provider|doctor|dr\.?|nurse|midwife)\s+(?:noted|wrote|documented|said|recommends|recommended|wants)\b/i,
  ],
  results: [
    /\byour (?:results?|labs?|lab work|blood work|test results?|imaging|ultrasound|sonogram|biopsy|culture|screening)\b[^.?!]*\b(?:show|showed|shows|came|are|is|were|was|look|looked)\b/i,
    /\b(?:results?|labs?) (?:came back|are back|are in)\b/i,
    /\b(?:everything|they|it) (?:looks?|looked|came back)\s+(?:normal|fine|okay|ok|clear|good|abnormal|elevated)\b/i,
  ],
  medication: [
    /\byour (?:prescription|medication|refill|rx)\b[^.?!]*\b(?:is|was|were|shows|sent|filled|ordered|due)\b/i,
    /\byou(?:['’]re| are) (?:currently )?(?:taking|prescribed|on)\b/i,
    /\b(?:last|the) refill (?:was|is)\b/i,
  ],
  account: [
    /\byour (?:balance|account balance|copay|co-pay|outstanding balance)\b/i,
    /\byou (?:owe|have a balance)\b/i,
    /\byour (?:insurance|coverage|policy)\b[^.?!]*\b(?:is|was|shows|expired|active)\b/i,
  ],
  clinicalDetail: [
    /\byou(?:['’]re| are)\s+(?:about\s+)?\d+\s+weeks?\b/i,
    /\byour (?:due date|edd|last menstrual period|lmp)\b[^.?!]*\b(?:is|was)\b/i,
    /\byour (?:diagnosis|condition|history)\b[^.?!]*\b(?:is|was|shows)\b/i,
  ],
});

// Explicitly NOT a protected disclosure. Anchored at the start of a CLAUSE, so
// ordinary, safe helpfulness is never mistaken for revealing patient
// information — and, critically, so a safe clause cannot vouch for the rest of
// a compound turn (see the correction note at the top of this file).
const NOT_DISCLOSURE = [
  /^\s*let me (?:open|pull up|bring up|take a look at|look at|check|review)\b/i,
  /^\s*(?:one|just a) moment\b/i,
  /^\s*i can help\b/i,
  /^\s*(?:sure|okay|of course|absolutely|certainly|thanks|thank you|bye|goodbye)\b[^.?!]{0,40}$/i,
  /^\s*(?:can|could|may) i (?:have|get|confirm|ask)\b/i,   // verification questions
  /^\s*what(?:['’]s| is) your\b/i,
  /^\s*(?:and )?your (?:date of birth|dob|first and last name|full name|name|last name|first name)\b\s*\??$/i,
];

function isExplicitlyNotDisclosure(text) {
  return NOT_DISCLOSURE.some((pattern) => pattern.test(String(text ?? '')));
}

// A navigator REFUSAL / verification-deferral that GOVERNS a protected
// proposition ("I cannot confirm whether your appointment is Tuesday until I
// verify you"). When a refusal appears at or before the disclosure keyword in
// the SAME clause, it is a privacy-PRESERVING statement, not a disclosure
// (correction pass #6, B2). Clause boundaries (comma / "but" / sentence) already
// separate "I cannot confirm anything, but your appointment is Tuesday" into two
// clauses, so a refusal only suppresses the proposition it actually governs.
const DISCLOSURE_REFUSAL = [
  /\b(?:can(?:'?t|not)|could\s*n(?:'|o)?t|cannot|unable\s+to|not\s+able\s+to|won'?t|will\s+not|do(?:n'?t| not))\s+(?:confirm|tell|say|share|disclose|discuss|access|give|provide|verify|see|read|release|reveal|look\s+up|pull\s+up|go\s+into|get\s+into)\b/i,
  /\bdo(?:n'?t| not)\s+have\s+access\b/i,
  /\b(?:need|have|going)\s+to\s+verify\b/i,
  /\bmust\s+verify\b/i,
  /\bafter\s+i\s+(?:verify|confirm)\b/i,
  /\bonce\s+i\s+(?:confirm|verify)\b/i,
  /\bbefore\s+i\s+(?:can\s+)?(?:confirm|verify|share|discuss|access|tell|say|look|release)\b/i,
];

// The earliest character index of a disclosure refusal in `clause`, or -1.
function clauseRefusalIndex(clause) {
  const text = String(clause ?? '');
  let best = -1;
  for (const pattern of DISCLOSURE_REFUSAL) {
    const m = pattern.exec(text);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

/**
 * Split a navigator turn into clauses for independent classification.
 *
 * Conservative on purpose. Sentence terminators, semicolons and commas are
 * unambiguous boundaries. A coordinating conjunction only splits when what
 * follows actually starts a new clause (a subject pronoun or determiner), so
 * "let me open your chart and pull up the schedule" stays whole while
 * "let me check that and your appointment is Tuesday" separates.
 *
 * Splitting can only FRAGMENT a protected phrase, never invent one, and
 * `findProtectedDisclosureInTurn` re-checks the whole turn precisely so a
 * disclosure split across a boundary is still caught.
 */
// A period inside a title, an initial, or a decimal is NOT a sentence end.
// Splitting on it would shred a protected phrase into meaningless fragments
// ("Dr" / "Smith ordered an ultrasound"), which the correction pass must avoid.
// Expressed as negative lookbehinds so the source needs no placeholder
// substitution: nothing is masked, so nothing can be unmasked incorrectly.
const CLAUSE_BOUNDARY = new RegExp(
  [
    // Sentence punctuation, unless it closes an abbreviation, an initial, or a
    // decimal. `(?<!\\b\\p{L})` matches only a ONE-letter word (an initial),
    // never the last letter of a longer word.
    '(?<!\\b(?:dr|mr|mrs|ms|st|ave|rd|blvd|jr|sr|prof|rev|approx|dept|no|vs|etc|inc|apt|ste))'
      + '(?<!\\b\\p{L})(?<!\\d)[.!?;]+\\s*',
    ',\\s*',
    // A coordinating conjunction only splits when what follows actually starts a
    // new clause, so "let me open your chart and pull up the schedule" stays
    // whole while "let me check that and your appointment is Tuesday" separates.
    '\\s+(?:and|but|so|then)\\s+(?=(?:i|we|you|your|the|there|it|they|he|she|dr)\\b)',
  ].join('|'),
  'iu',
);

export function splitDisclosureClauses(text) {
  return clauseSpans(text).map((span) => span.clause);
}

// Offset-aware clause splitting: each clause with its char range in the source,
// so a quote can be mapped to the clause that actually contains it
// (correction pass #6, B2). Kept consistent with `splitDisclosureClauses`.
export function clauseSpans(text) {
  const raw = String(text ?? '');
  const boundary = new RegExp(CLAUSE_BOUNDARY.source, `${CLAUSE_BOUNDARY.flags.includes('g') ? '' : 'g'}${CLAUSE_BOUNDARY.flags}`);
  const spans = [];
  let start = 0;
  let match;
  while ((match = boundary.exec(raw)) !== null) {
    const end = match.index;
    const clause = raw.slice(start, end).trim();
    if (clause.length > 0) spans.push({ clause, start: raw.indexOf(clause, start), end });
    start = boundary.lastIndex;
    if (boundary.lastIndex === match.index) boundary.lastIndex += 1;
  }
  const tail = raw.slice(start).trim();
  if (tail.length > 0) spans.push({ clause: tail, start: raw.indexOf(tail, start), end: raw.length });
  return spans;
}

// The earliest disclosure match in `text` as { category, index }, or null.
function disclosureCategoryMatch(text) {
  let best = null;
  for (const [category, patterns] of Object.entries(PROTECTED_DISCLOSURE_CATEGORIES)) {
    for (const pattern of patterns) {
      const m = pattern.exec(text);
      if (m && (best === null || m.index < best.index)) best = { category, index: m.index };
    }
  }
  return best;
}

function matchDisclosureCategory(text) {
  return disclosureCategoryMatch(text)?.category ?? null;
}

// A clause is a genuine disclosure only when it matches a protected category AND
// is NOT governed by a refusal that precedes (or coincides with) the match.
function clauseDisclosure(clause) {
  if (/^\s*(?:what|when|where|who|why|how)\b/i.test(String(clause ?? ''))) return null;
  const disc = disclosureCategoryMatch(clause);
  if (!disc) return null;
  const refusalIdx = clauseRefusalIndex(clause);
  if (refusalIdx >= 0 && refusalIdx <= disc.index) return null; // privacy-preserving refusal
  return disc;
}

/**
 * Classify ONE navigator turn clause-by-clause.
 *
 * @returns {{ category: string, clauseIndex: number, clause: string } | null}
 */
export function findProtectedDisclosureInTurn(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return null;
  const clauses = splitDisclosureClauses(raw);

  // 1. Per clause — a PROTECTED-DISCLOSURE match takes PRECEDENCE over a generic
  //    safe/benign prefix (correction pass #3), BUT a refusal that governs the
  //    protected proposition in the SAME clause is a privacy-preserving statement,
  //    not a disclosure (correction pass #6, B2).
  for (let index = 0; index < clauses.length; index++) {
    if (clauseDisclosure(clauses[index])) {
      return { category: clauseDisclosure(clauses[index]).category, clauseIndex: index, clause: clauses[index] };
    }
  }

  // 2. Whole turn, as a safety net for a disclosure the split fragmented
  //    ("your results, which came back normal"). Only when at least one clause is
  //    not a wholly-benign action, and only when the raw disclosure is not itself
  //    governed by a refusal — so a governed refusal spanning the whole turn is
  //    never turned into a finding by the safety net.
  const firstOpen = clauses.findIndex((clause) => !isExplicitlyNotDisclosure(clause));
  if (firstOpen === -1) return null;
  const disc = clauseDisclosure(raw);
  return disc ? { category: disc.category, clauseIndex: firstOpen, clause: clauses[firstOpen] } : null;
}

/**
 * Map an af-hipaa evidence quote to the disclosure it actually substantiates.
 *
 * A verified automatic HIPAA fail must classify the FULL navigator clause that
 * CONTAINS the quote — not the detached quote fragment — and require the quote to
 * overlap the detected disclosure span. A quote that maps to no unique navigator
 * turn/clause, sits inside a privacy-preserving refusal, or does not overlap the
 * disclosure keyword never verifies the auto-fail (correction pass #6, B2).
 *
 * @returns {{ verified: boolean, ambiguous: boolean, turnIndex: number,
 *             clauseIndex: number, clause: string|null, category: string|null }}
 */
export function classifyAfHipaaEvidence(transcript, quote) {
  const turns = Array.isArray(transcript) ? transcript : [];
  const nq = normalizeForMatch(stripRoleLabel(quote));
  if (!nq) return { verified: false, ambiguous: false, turnIndex: -1, clauseIndex: -1, clause: null, category: null };

  const navTurns = [];
  for (let index = 0; index < turns.length; index++) {
    if (turns[index]?.role === 'navigator' && normalizeForMatch(turns[index].text).includes(nq)) {
      navTurns.push(index);
    }
  }
  // The quote must map to exactly ONE navigator turn — otherwise it cannot be
  // uniquely attributed, so fail closed to review.
  if (navTurns.length !== 1) return { verified: false, ambiguous: true, turnIndex: navTurns[0] ?? -1, clauseIndex: -1, clause: null, category: null };

  const turnIndex = navTurns[0];
  const rawTurn = String(turns[turnIndex].text ?? '');
  const spans = clauseSpans(rawTurn);
  const containing = spans
    .map((span, clauseIndex) => ({ ...span, clauseIndex }))
    .filter((span) => normalizeForMatch(span.clause).includes(nq));
  // The quote must sit inside exactly ONE clause; spanning/mapping several clauses
  // is ambiguous.
  if (containing.length !== 1) return { verified: false, ambiguous: true, turnIndex, clauseIndex: -1, clause: null, category: null };

  const { clause, clauseIndex } = containing[0];
  const disc = clauseDisclosure(clause);
  if (!disc) return { verified: false, ambiguous: false, turnIndex, clauseIndex, clause, category: null };

  // Overlap: the quote itself must carry the disclosure content, not merely sit
  // in the same clause as one. A quote that is a benign fragment of a disclosure
  // clause ("with Dr. Reyes" from "your appointment is Tuesday with Dr. Reyes")
  // does not, on its own, match a protected pattern, so it does not verify the
  // auto-fail. (Checked in normalized space so trailing punctuation never matters.)
  const overlaps = disclosureCategoryMatch(nq) !== null;
  return { verified: overlaps, ambiguous: false, turnIndex, clauseIndex, clause, category: disc.category };
}

/**
 * Classify ONE navigator turn. Returns the matching category id, or null.
 * Thin accessor over the clause-aware detector, kept for existing callers.
 */
export function classifyProtectedDisclosure(text) {
  return findProtectedDisclosureInTurn(text)?.category ?? null;
}

/**
 * The FIRST protected disclosure in the transcript, preserving turn order and
 * then clause order within a turn.
 *
 * @returns {{ turnIndex, clauseIndex, clause, category } | null}
 */
export function findProtectedDisclosure(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  for (let index = 0; index < turns.length; index++) {
    if (turns[index]?.role !== 'navigator') continue;
    const found = findProtectedDisclosureInTurn(turns[index].text);
    if (found) return { turnIndex: index, ...found };
  }
  return null;
}

/**
 * Index of the FIRST navigator turn that discloses protected information, or -1.
 */
export function findProtectedDisclosureIndex(transcript) {
  return findProtectedDisclosure(transcript)?.turnIndex ?? -1;
}

/**
 * Decide `verify-before-access` from TRANSCRIPT ORDER.
 *
 * FAILS CLOSED: the criterion is satisfied only when the server can prove BOTH
 * that all three identifiers were genuinely collected AND that the collection
 * completed strictly before the first protected disclosure. If identity cannot
 * be verified at all, the order is unknowable — and an unknowable order is never
 * silently awarded; it is reported as uncertain so the review layer escalates.
 *
 * ORDER GRANULARITY (documented decision). Identity is located to a TURN, while
 * a disclosure is located to a CLAUSE within a turn. When both fall in the SAME
 * turn the two are not comparable — a caller's identifiers and a navigator's
 * disclosure cannot even be in the same turn, but a same-index comparison would
 * still be a guess — so `completedAtIndex < disclosureIndex` is required
 * strictly. Identity completing in the same turn as the disclosure therefore
 * does NOT satisfy the criterion; it fails closed to supervisor review.
 *
 * @returns {{ satisfied: boolean, reason: string, uncertain: boolean,
 *             completedAtIndex: number|null, disclosureIndex: number,
 *             disclosureCategory: string|null, disclosureClauseIndex: number|null }}
 */
export function evaluateVerificationBeforeAccess(transcript, identityEvidence) {
  const identity = evaluateIdentityEvidence(transcript, identityEvidence);
  const disclosure = findProtectedDisclosure(transcript);
  const disclosureIndex = disclosure?.turnIndex ?? -1;
  const disclosureCategory = disclosure?.category ?? null;
  const disclosureClauseIndex = disclosure?.clauseIndex ?? null;

  if (!identity.complete) {
    return {
      satisfied: false,
      // Identity was never established, so "verified before access" cannot be
      // true — but the ORDER itself is unproven, which is a review signal, not
      // a confident negative.
      reason: 'identity-not-verified',
      uncertain: true,
      completedAtIndex: null,
      disclosureIndex,
      disclosureCategory,
      disclosureClauseIndex,
      identity,
    };
  }

  if (disclosureIndex === -1) {
    return {
      satisfied: true,
      reason: 'no-protected-disclosure',
      uncertain: false,
      completedAtIndex: identity.completedAtIndex,
      disclosureIndex,
      disclosureCategory,
      disclosureClauseIndex,
      identity,
    };
  }

  const satisfied = identity.completedAtIndex < disclosureIndex;
  return {
    satisfied,
    reason: satisfied ? 'verified-before-disclosure' : 'identifiers-collected-after-disclosure',
    uncertain: false,
    completedAtIndex: identity.completedAtIndex,
    disclosureIndex,
    disclosureCategory,
    disclosureClauseIndex,
    identity,
  };
}
