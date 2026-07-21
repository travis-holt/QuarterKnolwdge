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
// Deliberately conservative: a real calendar date with an explicit 4-digit year,
// or a full numeric triple. A bare year, a bare month, a phone number, and a
// street address must all FAIL, because the whole point of the OB/GYN rule is
// that a phone number or address never substitutes for a date of birth.

const MONTH = 'january|february|march|april|may|june|july|august|september|october|november|december'
  + '|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';
const DAY = '(?:3[01]|[12][0-9]|0?[1-9])(?:st|nd|rd|th)?';
const YEAR = '(?:18|19|20)\\d{2}';

const DOB_PATTERNS = [
  // March 2nd 1991 · March 2, 1991 · Mar 2 1991
  new RegExp(`\\b(?:${MONTH})\\s+${DAY}\\s*,?\\s*${YEAR}\\b`, 'i'),
  // 2 March 1991 · 2nd of March 1991 · 2 March, 1991
  new RegExp(`\\b${DAY}\\s+(?:of\\s+)?(?:${MONTH})\\s*,?\\s*${YEAR}\\b`, 'i'),
  // 3/2/1991 · 03-02-1991 · 3.2.1991
  /\b(?:0?[1-9]|1[0-2])\s*[/\-.]\s*(?:3[01]|[12][0-9]|0?[1-9])\s*[/\-.]\s*(?:18|19|20)\d{2}\b/,
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
 * Return the matched date-of-birth span, or null. A phone number or an address
 * can never produce a match, and neither can a bare year or a bare month/day.
 */
export function extractDateOfBirth(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return null;
  if (looksLikePhoneNumber(raw) || looksLikeAddress(raw)) return null;
  for (const pattern of DOB_PATTERNS) {
    const match = pattern.exec(raw);
    if (match) return match[0];
  }
  return null;
}

// A name value must look like a name: 1–3 alphabetic tokens. This rejects a
// grader trying to pass "date of birth", a number, or a whole sentence as a name.
const NAME_TOKEN = /^[\p{L}][\p{L}'’-]*$/u;

export function looksLikePersonName(value) {
  const tokens = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 3) return false;
  return tokens.every((token) => NAME_TOKEN.test(token));
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
 *      like a name; a DOB parses as a real date and is not a phone/address).
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
    // The claimed value itself must parse as a date of birth. A phone number or
    // an address quoted from a real turn can never satisfy this.
    if (!extractDateOfBirth(rawValue)) return { ok: false, field, reason: 'value-is-not-a-date-of-birth' };
  } else if (!looksLikePersonName(rawValue)) {
    return { ok: false, field, reason: 'value-is-not-a-name' };
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

// Explicitly NOT a protected disclosure. Checked first so ordinary, safe
// helpfulness is never mistaken for revealing patient information.
const NOT_DISCLOSURE = [
  /^\s*let me (?:open|pull up|bring up|take a look at|look at|check|review)\b/i,
  /^\s*(?:one|just a) moment\b/i,
  /^\s*i can help\b/i,
  /^\s*(?:sure|okay|of course|absolutely|certainly)\b[^.?!]{0,40}$/i,
  /^\s*(?:can|could|may) i (?:have|get|confirm|ask)\b/i,   // verification questions
  /^\s*what(?:['’]s| is) your\b/i,
  /^\s*and your\b/i,
];

function isExplicitlyNotDisclosure(text) {
  return NOT_DISCLOSURE.some((pattern) => pattern.test(String(text ?? '')));
}

/**
 * Classify ONE navigator turn. Returns the matching category id, or null.
 */
export function classifyProtectedDisclosure(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return null;
  if (isExplicitlyNotDisclosure(raw)) return null;
  for (const [category, patterns] of Object.entries(PROTECTED_DISCLOSURE_CATEGORIES)) {
    if (patterns.some((pattern) => pattern.test(raw))) return category;
  }
  return null;
}

/**
 * Index of the FIRST navigator turn that discloses protected information, or -1.
 */
export function findProtectedDisclosureIndex(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  for (let index = 0; index < turns.length; index++) {
    if (turns[index]?.role !== 'navigator') continue;
    if (classifyProtectedDisclosure(turns[index].text)) return index;
  }
  return -1;
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
 * @returns {{ satisfied: boolean, reason: string, uncertain: boolean,
 *             completedAtIndex: number|null, disclosureIndex: number,
 *             disclosureCategory: string|null }}
 */
export function evaluateVerificationBeforeAccess(transcript, identityEvidence) {
  const identity = evaluateIdentityEvidence(transcript, identityEvidence);
  const disclosureIndex = findProtectedDisclosureIndex(transcript);
  const disclosureCategory = disclosureIndex >= 0
    ? classifyProtectedDisclosure(transcript[disclosureIndex]?.text)
    : null;

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
    identity,
  };
}
