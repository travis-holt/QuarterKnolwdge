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

/** Backwards-compatible span accessor: the matched text, or null. */
export function extractDateOfBirth(text) {
  return parseDateOfBirth(text)?.text ?? null;
}

// A name value must look like a name: 1–3 alphabetic tokens. This rejects a
// grader trying to pass "date of birth", a number, or a whole sentence as a name.
const NAME_TOKEN = /^[\p{L}][\p{L}'’-]*$/u;

export function looksLikePersonName(value) {
  const tokens = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 3) return false;
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

const NAME_CAPTURE = "([\\p{L}][\\p{L}'’-]*(?:\\s+[\\p{L}][\\p{L}'’-]*){0,2})";

// The patient is explicitly someone other than (or named apart from) the speaker.
const THIRD_PARTY_PATIENT_PATTERNS = [
  new RegExp(`\\b(?:the\\s+)?(?:appointment|visit|call|referral)\\s+is\\s+for\\s+${NAME_CAPTURE}`, 'iu'),
  new RegExp(`\\bcalling\\s+(?:in\\s+)?(?:for|about|on\\s+behalf\\s+of)\\s+(?:my\\s+[\\p{L}]+\\s*,?\\s*)?${NAME_CAPTURE}`, 'iu'),
  new RegExp(`\\b(?:the\\s+)?patient(?:'s|’s)?(?:\\s+name)?\\s+is\\s+${NAME_CAPTURE}`, 'iu'),
  new RegExp(`\\bfor\\s+my\\s+(?:daughter|son|child|wife|husband|mother|father|partner|sister|brother)\\s*,?\\s*${NAME_CAPTURE}`, 'iu'),
  new RegExp(`\\bmy\\s+(?:daughter|son|child|wife|husband|mother|father|partner|sister|brother)(?:'s|’s)?\\s*,?\\s*(?:name\\s+is\\s+)?${NAME_CAPTURE}`, 'iu'),
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
  /\bwho\s+(?:is|am\s+i\s+speaking\s+(?:with|to)|is\s+the\s+patient)\b/i,
  // "Can I have ... name?" in any phrasing that reaches the word "name".
  /\b(?:can|could|may)\s+i\s+(?:have|get|ask\s+for)\b[^?.!]{0,60}\bname\b/i,
  /\bspell\s+(?:your|the|her|his|their)\s+(?:last\s+)?name\b/i,
  /\bname\s+on\s+the\s+(?:account|chart|file)\b/i,
];

// Titles that mark a name as a provider or staff member, never the patient.
const PROVIDER_TITLE_BEFORE = /\b(?:dr|dr\.|doctor|nurse|midwife|np|pa|rn|md|provider|receptionist|pharmacist)\s+$/i;

function isPatientNameQuestion(text) {
  return PATIENT_NAME_QUESTION_PATTERNS.some((pattern) => pattern.test(String(text ?? '')));
}

function collectSpans(text, patterns) {
  const spans = [];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) spans.push(match[1]);
  }
  return spans;
}

/**
 * Every name span in ONE caller turn that genuinely designates THE PATIENT.
 *
 * @param {string} text            the caller turn
 * @param {string} precedingNavigatorText the navigator turn immediately before it
 * @returns {string[]} patient-owned name spans (possibly empty)
 */
export function patientNameSpans(text, precedingNavigatorText = '') {
  const raw = String(text ?? '');
  if (!raw.trim()) return [];

  // Precedence 1 — an explicit third-party designation. When the caller names
  // the patient separately, a self-identification in the SAME turn is the
  // caller's own name, not the patient's.
  const thirdParty = collectSpans(raw, THIRD_PARTY_PATIENT_PATTERNS);
  if (thirdParty.length > 0) return thirdParty;

  // Precedence 2 — the caller identifies themselves as the patient.
  const self = collectSpans(raw, SELF_IDENTIFICATION_PATTERNS);
  if (self.length > 0) return self;

  // Precedence 3 — an answer to the navigator's patient-name question.
  //
  // The answer is frequently NOT bare: a caller asked for "first name, last name
  // and date of birth" replies "Sure, Liam Carter, March 2nd 2021." So take the
  // LEADING name span — the first run of name-shaped tokens after any filler,
  // stopping at a month name or anything containing a digit, because from there
  // on the caller is answering the date-of-birth part of the same question.
  if (isPatientNameQuestion(precedingNavigatorText)) {
    const stripped = raw
      .replace(/\b(?:it\s+is|that\s+is|sure\s+it(?:'s|’s)|yes|yeah|yep|sure|okay|ok|hi|hello|um|uh|it(?:'s|’s)|that(?:'s|’s))\b/gi, ' ')
      .replace(/[^\p{L}\p{N}\s'’-]/gu, ' ');
    const span = [];
    for (const token of stripped.split(/\s+/).filter(Boolean)) {
      const lower = token.toLowerCase();
      if (MONTHS[lower] !== undefined || /\p{N}/u.test(token)) break;
      if (!NAME_TOKEN.test(token)) break;
      span.push(token);
      if (span.length === 3) break;
    }
    if (span.length > 0) return [span.join(' ')];
  }

  return [];
}

/**
 * Is `value` established as the patient's name in this turn?
 *
 * Returns a reason string when it is NOT, or null when it is.
 */
function nameOwnershipFailure(turns, turnIndex, role, value) {
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

  const spans = patientNameSpans(text, preceding);
  if (spans.length === 0) return 'not-a-patient-identity-context';

  const normalizedValue = normalizeForMatch(value);
  const owned = spans.some((span) => normalizeForMatch(span).split(' ').includes(normalizedValue));
  return owned ? null : 'not-a-patient-identity-context';
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
  if (quoteWords(quote).length < 2) return { ok: false, field, reason: 'quote-too-short' };
  if (!normalizeForMatch(turn?.text).includes(quote)) {
    return { ok: false, field, reason: 'quote-not-in-declared-turn' };
  }

  const rawValue = String(claim?.value ?? '').trim();
  if (!rawValue) return { ok: false, field, reason: 'missing-value' };
  const value = normalizeForMatch(rawValue);
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
    const ownership = nameOwnershipFailure(turns, turnIndex, role, rawValue);
    if (ownership) return { ok: false, field, reason: ownership };
  }

  return { ok: true, field, value, turnIndex, role, quote: rawValue };
}

/**
 * Verify a whole structured identity-evidence array and decide whether the three
 * required identifiers were genuinely collected — and by which turn.
 *
 * Identifiers may be spread across any number of chronological turns, and a
 * single caller sentence may satisfy all three. `completedAtIndex` is the LAST
 * turn needed to complete the set, which is what "verification was complete by
 * turn N" means and what the before-disclosure ordering check consumes.
 *
 * @returns {{ complete: boolean, completedAtIndex: number|null,
 *             verified: Record<string, object>, failures: object[] }}
 */
export function evaluateIdentityEvidence(transcript, identityEvidence) {
  const claims = Array.isArray(identityEvidence) ? identityEvidence : [];
  const verified = {};
  const failures = [];

  for (const claim of claims) {
    const result = verifyIdentifierClaim(transcript, claim);
    if (!result.ok) { failures.push(result); continue; }
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

  const complete = IDENTITY_FIELDS.every((field) => Boolean(verified[field]));
  const completedAtIndex = complete
    ? Math.max(...IDENTITY_FIELDS.map((field) => verified[field].turnIndex))
    : null;

  return { complete, completedAtIndex, verified, failures };
}

// ── Protected-disclosure detection (centralized) ─────────────────────────────
//
// ONE detector, used by the ordering check and by tests. It looks for a
// NAVIGATOR turn that confirms or reveals something patient-specific.
//
// Conservative by construction: it can only REJECT a claimed MET, never create
// one, so an over-match costs a criterion the supervisor still reviews, and an
// under-match is handled by the explicit uncertainty path below.

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
  return String(text ?? '')
    .split(CLAUSE_BOUNDARY)
    .map((clause) => String(clause ?? '').trim())
    .filter((clause) => clause.length > 0);
}

function matchDisclosureCategory(text) {
  for (const [category, patterns] of Object.entries(PROTECTED_DISCLOSURE_CATEGORIES)) {
    if (patterns.some((pattern) => pattern.test(text))) return category;
  }
  return null;
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

  // 1. Per clause. A safe clause vetoes ONLY itself.
  for (let index = 0; index < clauses.length; index++) {
    const clause = clauses[index];
    if (isExplicitlyNotDisclosure(clause)) continue;
    const category = matchDisclosureCategory(clause);
    if (category) return { category, clauseIndex: index, clause };
  }

  // 2. Whole turn, as a safety net for a disclosure the split fragmented
  //    ("your results, which came back normal"). Only when at least one clause
  //    was not itself safe, so a wholly-benign turn can never match across a
  //    boundary it does not really contain.
  const firstOpen = clauses.findIndex((clause) => !isExplicitlyNotDisclosure(clause));
  if (firstOpen === -1) return null;
  const category = matchDisclosureCategory(raw);
  return category ? { category, clauseIndex: firstOpen, clause: clauses[firstOpen] } : null;
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
