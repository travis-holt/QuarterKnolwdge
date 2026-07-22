// ─────────────────────────────────────────────────────────────────────────────
// Call QA rubric — the Aizer Health Navigator Quality Guide as structured data,
// plus the PURE scoring pipeline for the voice-call QA test.
//
// Source of truth: Aizer_Health_Navigator_Quality_Guide_SOP.pdf (the 100-point
// Unified Calibration Guide scorecard + the Auto-Fail Minefield). Timing-based
// metrics from the guide (answer <5s, 11s dead air, 2-min hold) are NOT graded —
// they aren't observable in a transcript — so their intent is folded into the
// observable call-control criteria (narration, explained holds).
//
// Reliability design: the AI never produces a score. It returns one binary
// verdict per criterion (MET / NOT_MET / NA) with a verbatim evidence quote.
// This module then (1) throws out MET verdicts whose evidence can't be found in
// the transcript, (2) converts NA on always-expected criteria to NOT_MET, and
// (3) computes the score, categories, and pass/fail deterministically. Same
// verdicts in → same result out, every time.
//
// The leading `_` keeps Express from turning this module into a route.
// ─────────────────────────────────────────────────────────────────────────────

import {
  QA_RUBRIC,
  QA_AUTO_FAILS,
  QA_PASS_THRESHOLD,
  QA_RUBRIC_VERSION,
  VERDICTS,
  BASES,
  rubricCriteria,
} from '../src/data/qaRubric.js';
import {
  QA_EVIDENCE_POLICIES,
  QA_RUBRIC_PROFILES,
  getQaRubricProfile,
  requireQaRubricProfile,
  UnsupportedQaDepartmentError,
} from '../src/data/qaRubricProfiles.js';
import {
  IDENTITY_FIELDS,
  evaluateIdentityEvidence,
  evaluateVerificationBeforeAccess,
} from './_qa-identity-verification.js';
import { normalizeForMatch, quoteWords, stripRoleLabel } from './_qa-text-normalize.js';
import { detectObgynContradictions, isObgynProhibitedActionNegated } from '../src/lib/contentGuards.js';

export { QA_RUBRIC, QA_AUTO_FAILS, QA_PASS_THRESHOLD, QA_RUBRIC_VERSION, VERDICTS, BASES, rubricCriteria };
export {
  QA_EVIDENCE_POLICIES, QA_RUBRIC_PROFILES,
  getQaRubricProfile, requireQaRubricProfile, UnsupportedQaDepartmentError,
};

// The department profile used when a caller does not supply one. This is the
// HISTORICAL shared rubric (Pediatrics), so pre-existing callers and stored
// results behave exactly as before. The SCORED runtime never relies on it:
// `gradeCallQaTranscript` resolves the profile from the server-authoritative
// attempt department and threads that one object through every stage.
export const DEFAULT_QA_PROFILE = QA_RUBRIC_PROFILES.pediatrics;

function profileOf(profile) {
  return profile ?? DEFAULT_QA_PROFILE;
}

// ── Evidence verification ────────────────────────────────────────────────────
//
// `normalizeForMatch` / `quoteWords` / `stripRoleLabel` come from the shared
// `_qa-text-normalize.js` so this module and the identity-verification module
// use ONE definition of what a verbatim quote means.

// Caller-side role aliases: historical fixtures use `patient`, live transcripts
// use `patient`, and some corpora say `caller`. They are equivalent and are NEVER
// eligible when navigator evidence is required.
const CALLER_ROLES = new Set(['patient', 'caller']);

function turnMatchesRole(turnRole, role) {
  if (role === 'navigator') return turnRole === 'navigator';
  if (role === 'caller' || role === 'patient') return CALLER_ROLES.has(turnRole);
  return turnRole === role;
}

function eligibleTurns(transcript, role) {
  return (Array.isArray(transcript) ? transcript : []).filter((t) => turnMatchesRole(t?.role, role));
}

/**
 * True when the quoted evidence really appears — as ONE contiguous, in-order
 * span — inside a SINGLE eligible transcript turn of the required role.
 *
 * This intentionally does NOT stitch fragments across turns, does NOT match an
 * unordered word bag, and does NOT search the concatenated full transcript. For
 * Call QA, `role` is always 'navigator': caller/patient wording can never award
 * a navigator criterion, verify a navigator auto-fail, or validate an
 * evidence-based negative judgment.
 *
 * Matching tolerances (applied via `normalizeForMatch`): case, punctuation,
 * repeated whitespace, curly vs. straight apostrophes, and a small deterministic
 * contraction normalization ("I'm" ↔ "I am"). No fuzzy/semantic matching.
 *
 * @param {{role:string, text:string}[]} transcript
 * @param {string} quote
 * @param {{role?: 'navigator'|'caller'|'patient', requireSingleTurn?: boolean}} [opts]
 */
export function verifyEvidence(transcript, quote, { role = 'navigator', requireSingleTurn = true } = {}) {
  const stripped = stripRoleLabel(quote);
  const needle = normalizeForMatch(stripped);
  if (quoteWords(needle).length < 2) return false;

  const turns = eligibleTurns(transcript, role);
  if (turns.length === 0) return false;

  // requireSingleTurn (the grading default): the quote must be a contiguous
  // substring of ONE eligible turn. When false, we still never touch the mixed
  // full transcript — we only join same-role eligible turns — so caller wording
  // can never leak in. Grading always passes requireSingleTurn: true.
  if (requireSingleTurn) {
    return turns.some((t) => normalizeForMatch(t.text).includes(needle));
  }
  const sameRoleJoined = normalizeForMatch(turns.map((t) => t.text).join(' '));
  return sameRoleJoined.includes(needle);
}

// Grading always requires one navigator turn. A single shared options object so
// every call site verifies evidence the same way.
const NAVIGATOR_EVIDENCE = { role: 'navigator', requireSingleTurn: true };
export function verifyNavigatorEvidence(transcript, quote) {
  return verifyEvidence(transcript, quote, NAVIGATOR_EVIDENCE);
}

// ── Identity-verification evidence policy (narrow, named exception) ──────────
//
// Identity is frequently established by the CALLER: "Hi, this is Maria Alvarez,
// date of birth March 2nd 1991." A navigator-only evidence gate would mark that
// call's verification unverified even though it is complete, so the identity
// policy lets `verify-three` / `verify-before-access` verify a quote against ONE
// contiguous turn of EITHER role.
//
// Scope limits (all enforced below and by tests):
//  * MET credit only. An evidence-based NEGATIVE stays navigator-only, so a
//    caller line can never substantiate an accusation against the navigator.
//  * Auto-fails are never covered — af-hipaa still needs a navigator quote.
//  * Only criteria that explicitly opt in via `evidencePolicy` are covered, so
//    caller wording can never earn an unrelated navigator-performance criterion.
//  * Transcript ORDER is preserved for `evidenceOrder:'before-protected-disclosure'`.

// The disclosure detector and the structured identifier contract live in
// `_qa-identity-verification.js`. There is exactly ONE detector, so the ordering
// check, the tests, and any future caller cannot drift apart.
export {
  IDENTITY_FIELDS, extractDateOfBirth, looksLikePersonName,
  looksLikePhoneNumber, looksLikeAddress,
  verifyIdentifierClaim, evaluateIdentityEvidence,
  classifyProtectedDisclosure, findProtectedDisclosureIndex,
  evaluateVerificationBeforeAccess, PROTECTED_DISCLOSURE_CATEGORIES,
} from './_qa-identity-verification.js';

/**
 * Verify a criterion's MET evidence, honoring its evidence policy.
 *
 * `identityEvidence` is the model's STRUCTURED identifier array for this
 * criterion. For an identity criterion the free-text `quote` is NOT sufficient
 * on its own — a two-word quote proves nothing about which identifiers were
 * collected — so the structured array is re-derived from the transcript and, for
 * a criterion declaring `evidenceOrder`, the chronological ordering is checked
 * against the first protected disclosure.
 *
 * @returns {{ verified: boolean, reason: string|null, detail: object|null }}
 */
export function verifyCriterionEvidenceDetailed(transcript, quote, criterionDef, identityEvidence) {
  if (criterionDef?.evidencePolicy !== QA_EVIDENCE_POLICIES.IDENTITY_VERIFICATION) {
    return {
      verified: verifyNavigatorEvidence(transcript, quote),
      reason: null,
      detail: null,
    };
  }

  if (criterionDef.evidenceOrder === 'before-protected-disclosure') {
    const order = evaluateVerificationBeforeAccess(transcript, identityEvidence);
    return {
      verified: order.satisfied,
      reason: order.satisfied ? null : order.reason,
      detail: order,
    };
  }

  const identity = evaluateIdentityEvidence(transcript, identityEvidence);
  return {
    verified: identity.complete,
    reason: identity.complete ? null : 'identity-not-verified',
    detail: identity,
  };
}

/**
 * Boolean convenience wrapper. Kept because several call sites only need the
 * yes/no answer; the detailed form above is what scoring uses.
 */
export function verifyCriterionEvidence(transcript, quote, criterionDef, identityEvidence) {
  return verifyCriterionEvidenceDetailed(transcript, quote, criterionDef, identityEvidence).verified;
}

// ── Response validation (model output → trusted verdicts) ───────────────────

/**
 * Validate one criterion's verdict/basis/evidence combination. Returns an error
 * string for a malformed combination (so the whole response is rejected and the
 * existing malformed-response retry runs), or null when the combination is legal.
 *
 * ABSENCE means "there is no evidence quote" — so an ABSENCE judgment must have
 * completely empty or whitespace-only evidence; ANY non-whitespace evidence
 * (even a single word or punctuation like "N/A", ".", "incorrect") is rejected.
 *
 * Legal shapes:
 *   MET      + EVIDENCE + non-empty evidence
 *   NOT_MET  + EVIDENCE + non-empty evidence      (observed wrong/unsafe behavior)
 *   NOT_MET  + ABSENCE  + empty/whitespace evidence (behavior simply absent)
 *   NA       + ABSENCE  + empty/whitespace evidence
 */
export function validateCriterionBasis(verdict, basis, evidence) {
  if (!BASES.has(basis)) return `unknown or missing basis "${basis}".`;
  const hasEvidence = String(evidence ?? '').trim().length > 0;
  if (verdict === 'MET') {
    if (basis !== 'EVIDENCE') return 'MET must use basis EVIDENCE.';
    if (!hasEvidence) return 'MET requires a non-empty evidence quote.';
  } else if (verdict === 'NOT_MET') {
    if (basis === 'EVIDENCE' && !hasEvidence) return 'NOT_MET with basis EVIDENCE requires an evidence quote.';
    if (basis === 'ABSENCE' && hasEvidence) return 'NOT_MET with basis ABSENCE must have empty evidence.';
  } else if (verdict === 'NA') {
    if (basis !== 'ABSENCE') return 'NA must use basis ABSENCE.';
    if (hasEvidence) return 'NA with basis ABSENCE must have empty evidence.';
  }
  return null;
}

// Identity claims are CALLER-ONLY (v6): the navigator saying a name proves
// nothing about verification, and the server always rejects a navigator-sourced
// identifier — so a navigator role in the raw response is a contract violation,
// not something to accept and silently drop later.
const IDENTITY_CLAIM_ROLES = new Set(['caller', 'patient']);

/**
 * Validate the SHAPE of a criterion's structured identity evidence.
 *
 * Two directions matter. A criterion whose profile declares no identity policy
 * must not carry identity claims at all — accepting them would leave a channel
 * open for caller wording to influence an unrelated navigator-performance
 * criterion. And a criterion that DOES declare the policy must send claims the
 * server can actually re-derive; a half-filled claim is a contract violation,
 * not something to quietly drop.
 *
 * @returns {string|null} an error message, or null when the shape is legal
 */
function validateIdentityEvidenceShape(criterion, profile) {
  const raw = criterion.identityEvidence;
  const def = profile.criteriaById.get(criterion.id);
  const allowed = def?.evidencePolicy === QA_EVIDENCE_POLICIES.IDENTITY_VERIFICATION;

  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return 'identityEvidence must be an array when present.';
  if (raw.length === 0) return null;
  if (!allowed) {
    return 'identityEvidence is not permitted on a criterion without the identity-verification policy.';
  }

  const seenFields = new Set();
  for (const [index, claim] of raw.entries()) {
    const at = `identityEvidence[${index}]`;
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
      return `${at} is not an object.`;
    }
    if (!IDENTITY_FIELDS.includes(claim.field)) return `${at}.field is not a known identifier.`;
    if (typeof claim.value !== 'string' || !claim.value.trim()) return `${at}.value must be a non-empty string.`;
    if (typeof claim.quote !== 'string' || !claim.quote.trim()) return `${at}.quote must be a non-empty string.`;
    // Identity claims are caller-only (v6): a navigator role is rejected here so
    // the malformed-response retry runs, rather than being accepted and dropped.
    if (!IDENTITY_CLAIM_ROLES.has(String(claim.role ?? '').toLowerCase())) return `${at}.role must be "caller".`;
    if (!Number.isInteger(claim.turnIndex) || claim.turnIndex < 0) return `${at}.turnIndex must be a non-negative integer.`;
    // No identifier may be claimed twice — otherwise a duplicate could paper over
    // a missing one, or conflict silently.
    if (seenFields.has(claim.field)) return `duplicate identity claim for "${claim.field}".`;
    seenFields.add(claim.field);
  }
  return null;
}

/** Canonical form of an identity-evidence array for equality comparison. */
function canonicalIdentityArray(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((claim) => ({
      field: claim.field,
      value: String(claim.value ?? ''),
      role: String(claim.role ?? '').toLowerCase(),
      turnIndex: claim.turnIndex,
      quote: String(claim.quote ?? ''),
    }))
    .sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * Validate the raw auto-fail array against the profile.
 *
 * The prompt contract asks for EVERY auto-fail id, so a missing one is a
 * contract violation rather than an implicit "not triggered". Unknown and
 * duplicate ids were previously filtered away silently, which hid exactly the
 * malformed output the retry exists to catch.
 *
 * @returns {string|null} an error message, or null when the array is legal
 */
function validateAutoFailShapes(autoFails, profile) {
  if (!Array.isArray(autoFails)) return 'Missing auto-fail array.';
  const seen = new Set();
  for (const [index, a] of autoFails.entries()) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return `Auto-fail at index ${index} is not an object.`;
    if (typeof a.id !== 'string' || !profile.autoFailIds.has(a.id)) {
      return `Unknown auto-fail "${a.id}" for rubric profile "${profile.department}".`;
    }
    if (seen.has(a.id)) return `Duplicate auto-fail "${a.id}".`;
    seen.add(a.id);
    if (typeof a.triggered !== 'boolean') return `Auto-fail ${a.id}: "triggered" must be a boolean.`;
    if (a.evidence !== undefined && typeof a.evidence !== 'string') return `Auto-fail ${a.id}: evidence must be a string.`;
    if (a.note !== undefined && typeof a.note !== 'string') return `Auto-fail ${a.id}: note must be a string.`;
    // A triggered auto-fail accuses the navigator of an explicit unsafe
    // statement, so it must carry the quote the server will verify. An empty
    // one is definitionally unverifiable.
    if (a.triggered === true && !String(a.evidence ?? '').trim()) {
      return `Auto-fail ${a.id}: a triggered auto-fail requires a verbatim evidence quote.`;
    }
  }
  const missing = [...profile.autoFailIds].filter((id) => !seen.has(id));
  if (missing.length > 0) return `Missing auto-fail verdicts for: ${missing.join(', ')}`;
  return null;
}

/**
 * Validate the model's raw JSON against the RESOLVED department rubric profile.
 * Pure; no I/O. The same `profile` object must later be handed to `scoreQa`, so
 * validation and scoring can never run against different criterion sets.
 *
 * @param {object} parsed
 * @param {object} [profile] resolved department profile (default: Pediatrics)
 * @returns {{ data: {criteria: [], autoFails: []} } | { error: string }}
 */
export function validateQaResponse(parsed, profile) {
  const active = profileOf(profile);
  if (!parsed || typeof parsed !== 'object') return { error: 'Response is not an object.' };
  const critList = Array.isArray(parsed.criteria) ? parsed.criteria : null;
  if (!critList) return { error: 'Missing criteria array.' };

  // ── Strict RAW validation, before any normalization ────────────────────────
  //
  // The previous implementation `continue`d past every malformed entry and then
  // rebuilt the array from the profile, so a duplicate id silently overwrote the
  // earlier verdict, and unknown/extra ids and unknown auto-fail ids vanished.
  // The exact-set check downstream then only ever saw the CLEANED array, so a
  // model that broke its contract looked compliant and the malformed-response
  // retry never ran. Every rejection below trips that retry instead.
  const byId = new Map();
  for (const [index, c] of critList.entries()) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      return { error: `Criterion at index ${index} is not an object.` };
    }
    if (typeof c.id !== 'string' || !c.id.trim()) {
      return { error: `Criterion at index ${index} has a missing or non-string id.` };
    }
    if (!active.criterionIds.has(c.id)) {
      return { error: `Unknown criterion "${c.id}" for rubric profile "${active.department}".` };
    }
    if (byId.has(c.id)) return { error: `Duplicate criterion "${c.id}".` };

    const verdict = String(c.verdict ?? '').toUpperCase();
    if (!VERDICTS.has(verdict)) return { error: `Criterion ${c.id}: unknown or missing verdict "${c.verdict}".` };
    const basis = String(c.basis ?? '').toUpperCase();
    // Evidence and note are REQUIRED strings. Coercing a non-string (a number, an
    // object) to "" would let a malformed ABSENCE response pass validation; reject
    // it so the malformed-response retry runs instead (correction pass #3, B7).
    if (typeof c.evidence !== 'string') return { error: `Criterion ${c.id}: evidence must be a string.` };
    if (typeof c.note !== 'string') return { error: `Criterion ${c.id}: note must be a string.` };
    const evidence = c.evidence;
    const note = c.note;
    // Reject malformed verdict/basis/evidence combinations rather than silently
    // coercing them — this trips the endpoint's malformed-response retry.
    const basisError = validateCriterionBasis(verdict, basis, evidence);
    if (basisError) return { error: `Criterion ${c.id}: ${basisError}` };

    // Structured identifier claims travel with the criterion so scoring can
    // re-derive them from the transcript. SHAPE is validated here; whether the
    // claims are TRUE is decided by the server against the transcript.
    const identityError = validateIdentityEvidenceShape(c, active);
    if (identityError) return { error: `Criterion ${c.id}: ${identityError}` };
    const identityEvidence = Array.isArray(c.identityEvidence) ? c.identityEvidence : [];

    byId.set(c.id, { id: c.id, verdict, basis, evidence, note, identityEvidence });
  }

  const missing = active.criteria.filter((c) => !byId.has(c.id)).map((c) => c.id);
  if (missing.length > 0) return { error: `Missing verdicts for: ${missing.join(', ')}` };

  // ── Identity contract (correction pass #3, B1 + B5) ─────────────────────────
  //
  // A MET identity criterion must carry a COMPLETE structured payload — exactly
  // one claim per identifier (firstName, lastName, dob). A MET verdict with a
  // missing/empty/partial array is a model contract failure, not evidence the
  // navigator failed, so it must trip the malformed-response retry rather than
  // silently degrading to a navigator deduction. And the two identity criteria
  // may not submit DIFFERENT arrays — one canonical identity must feed both.
  const identityIds = active.identityVerificationCriteria ?? [];
  const nonEmptyIdentityArrays = [];
  for (const id of identityIds) {
    const criterion = byId.get(id);
    if (!criterion) continue;
    const arr = criterion.identityEvidence ?? [];
    if (criterion.verdict === 'MET') {
      const fields = arr.map((claim) => claim.field);
      const missingIds = IDENTITY_FIELDS.filter((field) => !fields.includes(field));
      if (missingIds.length > 0) {
        return {
          error: `Criterion ${id}: a MET identity criterion must prove all three identifiers `
            + `(missing: ${missingIds.join(', ')}). Do not claim MET with an incomplete identityEvidence array.`,
        };
      }
      if (fields.length !== IDENTITY_FIELDS.length) {
        return { error: `Criterion ${id}: a MET identity criterion must carry exactly one claim per identifier.` };
      }
    }
    if (arr.length > 0) nonEmptyIdentityArrays.push({ id, canonical: JSON.stringify(canonicalIdentityArray(arr)) });
  }
  if (nonEmptyIdentityArrays.length >= 2) {
    const first = nonEmptyIdentityArrays[0];
    const divergent = nonEmptyIdentityArrays.find((entry) => entry.canonical !== first.canonical);
    if (divergent) {
      return {
        error: `Identity criteria ${first.id} and ${divergent.id} submitted DIFFERENT identity evidence; `
          + 'both verification criteria must describe the same patient identity.',
      };
    }
  }

  const autoFailsError = validateAutoFailShapes(parsed.autoFails, active);
  if (autoFailsError) return { error: autoFailsError };

  // Only TRIGGERED auto-fails flow into scoring; the untriggered ones exist so
  // the model must positively answer every auto-fail id rather than omit the
  // ones it wants to ignore.
  const autoFails = parsed.autoFails
    .filter((a) => a.triggered === true)
    .map((a) => ({
      id: a.id,
      evidence: typeof a.evidence === 'string' ? a.evidence : '',
      note: typeof a.note === 'string' ? a.note : '',
    }));

  return {
    data: {
      criteria: active.criteria.map((c) => byId.get(c.id)),
      autoFails,
      // The IMMUTABLE binding to the profile that produced these verdicts. The
      // signature covers points, `core` applicability, categories, evidence
      // policies and auto-fail definitions — not just criterion IDs — so two
      // profiles with the same IDs but different weights are distinguishable.
      // This must survive the repair stage and is re-checked by scoreQa().
      profileBinding: profileBindingOf(active),
    },
  };
}

/** The immutable identity a validated response is bound to. */
export function profileBindingOf(profile) {
  return Object.freeze({
    department: profile.department,
    rubricVersion: profile.rubricVersion,
    signature: profile.signature,
  });
}

/**
 * Compare a carried binding against a profile. Returns null when they match, or
 * a reason string. A MISSING binding is itself a failure in the scored path:
 * losing the stamp is exactly the bug this guards against.
 */
export function profileBindingMismatch(binding, profile) {
  if (!binding) return 'missing-profile-binding';
  if (binding.department !== profile.department) return 'profile-binding-department-mismatch';
  if (binding.rubricVersion !== profile.rubricVersion) return 'profile-binding-version-mismatch';
  if (binding.signature !== profile.signature) return 'profile-binding-signature-mismatch';
  return null;
}

/**
 * Exact criterion-set integrity: no unknown ids, no missing ids, no duplicates,
 * no extras. Returns null when the set is exactly the profile's criteria.
 */
export function criterionSetMismatch(verdicts, profile) {
  const seen = new Set();
  for (const verdict of verdicts) {
    const id = verdict?.id;
    if (!profile.criterionIds.has(id)) return `unknown criterion "${id}"`;
    if (seen.has(id)) return `duplicate criterion "${id}"`;
    seen.add(id);
  }
  const missing = [...profile.criterionIds].filter((id) => !seen.has(id));
  if (missing.length) return `missing criteria: ${missing.join(', ')}`;
  return null;
}

export const CALL_QA_FAIRNESS_RULES = {
  standardRefillNoPeRequirement: 'standard-refill-no-pe-requirement',
  naturalMessageRoutingWording: 'natural-message-routing-wording',
  obgynCallerObservableOutcome: 'obgyn-caller-observable-outcome',
};

export function normalizeQaText(text) {
  return String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function navigatorLines(transcript) {
  return (Array.isArray(transcript) ? transcript : []).filter((turn) => turn?.role === 'navigator' && String(turn.text ?? '').trim());
}

export function transcriptText(transcript) {
  return (Array.isArray(transcript) ? transcript : []).map((turn) => String(turn?.text ?? '')).join(' ');
}

export function lineMatchesAny(line, regexes) {
  return regexes.some((regex) => regex.test(String(line?.text ?? line ?? '')));
}

export function findBestNavigatorLine(transcript, regexes) {
  return navigatorLines(transcript).find((line) => lineMatchesAny(line, regexes))?.text ?? null;
}

export const ROUTING_DESTINATIONS = [
  ['peds-encounters', /\b(?:peds|pediatric(?:s)?)\s+(?:telephone\s+encounters?|encounters?)\s*(?:queue|team)?\b/i],
  ['peds-referral-owner', /\b(?:anisa(?:\s+azeez)?|pediatrics?\s+referral\s+owner\s*,?\s*anisa)\b/i],
  ['ob-pss', /\b(?:pss\s+ob|ob\s+pss|patient scheduling services\s+for\s+ob(?:\s*\/\s*gyn)?)\b/i],
  ['ob-portal', /\b(?:ob\s+portal|pregnancy\s+portal)\b/i],
  ['ob-prevention', /\b(?:prevention|preventive)\s+coordinator\b/i],
  ['ob-mfm-owner', /\b(?:rebecca|mfm\s+owner\s*,?\s*rebecca)\b/i],
  ['ob-waiting-list', /\b(?:waiting\s+list|waitlist)\s+(?:portal|te|telephone encounter)\b/i],
  ['ob-take-action', /\btake action\b/i],
  ['ob-urgent-channel', /\b(?:intermedia|women['’]s health ob urgent calls|ob urgent (?:calls )?channel)\b/i],
  ['ob-nursing', /\b(?:(?:ob(?:\s*\/\s*gyn)?|obstetrics?)\s+nurse|nursing team|clinical team)\b/i],
  ['labor-delivery', /\b(?:l\s*&\s*d|labor (?:and|&) delivery)\b/i],
  ['medical-records', /\b(?:medical records|records)\s+(?:team|department)\b/i],
  ['forms', /\b(?:school\s+)?forms?\s+(?:team|department)\b/i],
  ['billing', /\bbilling\s*(?:team|department)?\b/i],
  ['front-desk', /\bfront desk\b/i],
  ['scheduling', /\bscheduling\s+(?:team|department|queue)\b/i, true],
  ['specialist', /\bspecialist\b/i, true],
  ['generic-team', /\bteam\b/i, true],
  ['generic-provider', /\b(?:provider|doctor)\b/i, true],
  ['generic-queue', /\bqueue\b/i, true],
];

export const ROUTING_POLICIES = {
  pediatrics: {
    prescription_refill: { allowed: ['peds-encounters'], messageRepair: true },
    referral: { allowed: ['peds-referral-owner'], messageRepair: true },
    records_forms: { allowed: [], reviewOnly: true },
    urgent_symptom_boundary: { allowed: [], reviewOnly: true },
    wrong_department_unclear_request: { allowed: [], reviewOnly: true },
  },
  obgyn: {
    new_gyn_visit: { allowed: ['ob-pss'] },
    pregnancy_related_visit: { allowed: ['ob-portal'] },
    test_result_medical_advice_boundary: { allowed: ['ob-portal', 'ob-nursing'], messageRepair: true },
    mfm_related_request: { allowed: ['ob-mfm-owner'] },
    records_forms: { allowed: ['medical-records'] },
    scheduling_change: { allowed: ['ob-pss'] },
    wrong_department_unclear_request: { allowed: [], reviewOnly: true },
    missing_rto_order: { allowed: ['ob-portal'], messageRepair: true },
    transfer_ob: { allowed: ['ob-portal'], messageRepair: true },
    existing_te_take_action: { allowed: ['ob-take-action'], messageRepair: true },
    mfm_owner: { allowed: ['ob-mfm-owner'], messageRepair: true },
    prescription_refill: { allowed: ['ob-portal', 'ob-nursing'], messageRepair: true },
    lab_boundary: { allowed: ['ob-portal'], messageRepair: true },
    dr_bank_waitlist: { allowed: ['ob-waiting-list'], messageRepair: true },
  },
};
// Commitment syntax is separate from destination policy; both are required.
const NAVIGATOR_ROUTING_COMMITMENT_PATTERNS = [
  /\b(?:i|we)\s*(?:will|['’]ll|['’]m going to|am going to|are going to|can)\s+(?:go ahead and\s+)?(?:send|route|forward|message|pass(?:\s+along)?|put\s+in)\b/i,
  /\blet me\s+(?:go ahead and\s+)?(?:send|route|forward|message|pass(?:\s+along)?|put\s+in)\b/i,
  /\bi(?:['’]m| am)\s+(?:sending|routing|forwarding|messaging|passing|putting)\b/i,
  /\b(?:i|we)\s*(?:will|['’]ll|['’]m going to|am going to|are going to)\s+let\s+(?:the\s+)?(?:nurse|provider|doctor|team|refill team|clinical team)\s+know\b/i,
  /\b(?:i|we)\s*(?:will|['’]ll|['’]m going to|am going to|are going to)\s+have\s+(?:the\s+)?(?:team|nurse|provider|doctor|refill team|clinical team)\s+(?:follow up|call(?: you)? back|get back to you|review)\b/i,
];
const COMMITTED_FOLLOW_UP_PATTERNS = [
  /\b(?:the\s+)?(?:team|nurse|provider|doctor|clinical team|peds encounters|pediatrics encounters|pss(?: ob)?|patient scheduling services|referral (?:specialist|coordinator)|mfm nurse|medical records team)\s+(?:will|['’]ll)\s+(?:follow up|call(?: you)? back|get back to you|review)\b/i,
];
const EXTRA_ROUTING_COMMITMENT = /\b(?:i|we)\s+(?:will|shall)\s+(?:assign|submit|create\s+(?:a\s+)?te|put\s+this\s+through)\b|\b(?:this\s+goes\s+to|the\s+correct\s+(?:queue|destination)\s+is|is\s+the\s+correct\s+(?:queue|destination)|this\s+belongs\s+with|handles\s+this)\b/i;
// An offer is not a commitment: "do you want me to send it?" leaves the action
// undecided, so it can never stand as routing evidence.
const ROUTING_OFFER = /\b(?:do you want|would you like|should i|want me to|if you(?:['’]d)? (?:like|want|prefer))\b/i;
const OTHER_WORKFLOW_FAILURE = /wrong (queue|destination)|promis|missing (medication|pharmacy)|failed to.*(medication|pharmacy)|did not.*(medication|pharmacy)|no (medication|pharmacy|routing)|clinical advice/i;

// STRICT positive PE-only check: the know-rule PE repair may only fire when the
// grader's complaint is exclusively about PE / Physical-Exam status. Instead of
// an ever-growing blacklist of "other issues", every token of the note (after
// normalization) must be either a PE term or generic failure scaffolding — any
// substantive residue (urgency, callback, pharmacy, queue, promise...) blocks
// the repair because the grader may have had a second, real reason to fail.
const PE_TERMS = /\bpe\b|physical exam|physical status|up to date|up-to-date|\butd\b|not current/i;
const PE_ONLY_ALLOWED_TOKENS = new Set([
  // PE vocabulary
  'pe', 'physical', 'exam', 'examination', 'status', 'utd', 'current', 'up', 'date',
  // generic failure scaffolding
  'the', 'a', 'an', 'navigator', 'agent', 'did', 'do', 'does', 'not', 'no', 'never',
  'failed', 'fail', 'failure', 'failing', 'to', 'ask', 'asked', 'asking', 'about',
  'check', 'checked', 'checking', 'verify', 'verified', 'verifying', 'verification',
  'confirm', 'confirmed', 'confirming', 'ensure', 'patient', 'patients', 's',
  'before', 'submitting', 'submit', 'submitted', 'processing', 'request', 'requests',
  'refill', 'refills', 'is', 'was', 'were', 'that', 'this', 'it', 'whether', 'if',
  'only', 'because', 'and', 'or', 'of', 'her', 'his', 'their', 'solely', 'due',
]);

export function isStrictPeOnlyFailure(criterion) {
  const text = normalizeQaText(`${criterion.note} ${criterion.evidence}`);
  if (!PE_TERMS.test(text)) return false;
  return text.split(' ').filter(Boolean).every((token) => PE_ONLY_ALLOWED_TOKENS.has(token));
}

// POSITIVELY scoped literal-TE-wording check: the doc-te repair may only fire
// when the grader's complaint is specifically about literal TE/Telephone
// Encounter wording or the absence of the routing/message action itself. The
// note must reference the routing/message action, and must NOT contain any
// substantive wrongness, missing-detail, urgency, destination, or
// incompleteness complaint — those are real verdicts and always stand.
const LITERAL_TE_TARGET = /telephone encounter|\bte\b|\brout(?:e|ed|es|ing)\b|\bsen[dt]\b|\bmessage\b|\blog(?:ged)?\b|\bforward(?:ed)?\b/i;
const SUBSTANTIVE_DOC_COMPLAINT = /wrong|incorrect|instead of|should (?:have|be)|belongs (?:to|in)|mis-?rout|which queue|medication|pharmacy|callback|phone number|urgen|destination|next step|explain|incomplete|missing (?:details?|information)|(?:details?|information) (?:were|was|are|is) missing|correctly|properly|conflat|identity|identifier|hipaa|privacy|promis|guarantee|advi[cs]|dos(?:e|age|ing)|escalat/i;

export function isLiteralTeWordingFailure(criterion) {
  const text = `${criterion.note} ${criterion.evidence}`;
  return LITERAL_TE_TARGET.test(text) && !SUBSTANTIVE_DOC_COMPLAINT.test(text);
}

const OBGYN_INTERNAL_NARRATION_TARGET = /\bob\s+verified\b|\btake\s+action\b|\bhigh\s+priority\b|\btelephone\s+encounter\b|\bte\b|\bob\s+portal\b|\bintermedia\b|\brebecca\s+wood\b|\bwaiting\s+list\s+portal\b/i;
const OBGYN_ABSENCE_COMPLAINT = /\b(?:absen(?:ce|t)|did not|does not|failed to|never|not (?:mention|state|say|use|document)|omit(?:ted)?|missing|without|no (?:evidence|mention|statement)|must|required|should have)\b/i;

// A model miss is eligible for caller-observable normalization only when its
// stated reason is the absence of an internal chart/queue term. Wrong routes,
// missing caller details, unsafe advice, and other substantive failures stand.
export function isObgynInternalNarrationOnlyFailure(criterion) {
  const text = `${criterion?.note ?? ''} ${criterion?.evidence ?? ''}`;
  return OBGYN_INTERNAL_NARRATION_TARGET.test(text)
    && OBGYN_ABSENCE_COMPLAINT.test(text)
    && !SUBSTANTIVE_DOC_COMPLAINT.test(text);
}

export function routingPolicyFor({ department = '', metadata = {} } = {}) {
  return ROUTING_POLICIES[department]?.[metadata?.workflowType] ?? null;
}

export function routingDestinationsForLine(line) {
  const text = String(line?.text ?? line ?? '');
  const matches = ROUTING_DESTINATIONS.flatMap(([id, pattern, generic]) => {
    const match = pattern.exec(text);
    if (!match) return [];
    const start = Math.max(text.lastIndexOf(';', match.index), text.lastIndexOf('.', match.index), text.lastIndexOf('?', match.index), text.lastIndexOf('!', match.index)) + 1;
    return /\bnot\s+(?:sending|routing|forwarding|messaging|passing|assigning|submitting|putting)[^.;?!]*$/i.test(text.slice(start, match.index)) ? [] : [{ id, generic }];
  });
  const specific = matches.filter((match) => !match.generic).map((match) => match.id);
  return [...new Set(specific.length ? specific : matches.map((match) => match.id))];
}

export function hasRoutingDestination(line, context) {
  const ids = routingDestinationsForLine(line);
  if (!context) return ids.some((id) => !id.startsWith('generic-'));
  const policy = routingPolicyFor(context);
  return Boolean(policy && ids.some((id) => policy.allowed.includes(id)));
}

function isRoutingQuestionOrHypothetical(line) {
  const text = String(line?.text ?? line ?? '').trim();
  return /^(?:did|do|does|can you|could you|would you|was|were|has|have you|should|maybe|perhaps|someone should|you can|the caller said)\b/i.test(text)
    || (/\?$/.test(text) && /^(?:who|what|when|where|why|how|is|are|did|do|does|can|could|would|was|were|has|have|should)\b/i.test(text))
    || ROUTING_OFFER.test(text);
}

// Hedged / uncertain routing language ("I think PEDS Encounters handles this",
// "the provider may get back to you") is NOT a completed routing decision and
// can never serve as repair evidence — uncertainty goes to a supervisor.
const ROUTING_UNCERTAINTY = /\bi\s+(?:think|believe|guess|assume)\b|\bi\s+(?:do\s+not|don['’]t)\s+know\b|\bi(?:['’]m|\s+am)\s+not\s+sure\b|\bmaybe\b|\bperhaps\b|\bprobably\b|\bpossibly\b|\bmay\b|\bmight\b|\bcould\b|\bwhether\b|\bsupposed\s+to\b/i;

export function isUncertainRoutingLanguage(line) {
  return ROUTING_UNCERTAINTY.test(String(line?.text ?? line ?? ''));
}

export function hasRoutingCommitment(line) {
  const text = String(line?.text ?? line ?? '');
  if (isRoutingQuestionOrHypothetical(text) || isUncertainRoutingLanguage(text)) return false;
  return NAVIGATOR_ROUTING_COMMITMENT_PATTERNS.some((pattern) => pattern.test(text))
    || COMMITTED_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(text))
    || EXTRA_ROUTING_COMMITMENT.test(text);
}

export function findNaturalRoutingActionLine(transcript) {
  return navigatorLines(transcript).find(hasRoutingCommitment)?.text ?? null;
}

// Only the final committed decision can support a repair. Conflicting earlier
// decisions require an explicit correction; generic/unknown destinations fail.
const ROUTING_CORRECTION = /\b(?:actually|correction|i mean|rather|instead|sorry)\b/i;

export function evaluateRoutingDecision(transcript, context = {}) {
  const policy = routingPolicyFor(context);
  if (!policy || policy.reviewOnly) {
    return { acceptable: false, reason: 'routing-policy-review-only', line: null, destinationId: null };
  }

  const decisions = navigatorLines(transcript)
    .map((line) => ({
      line: line.text,
      destinations: routingDestinationsForLine(line),
      correction: ROUTING_CORRECTION.test(line.text),
      committed: hasRoutingCommitment(line),
    }))
    .filter((entry) => entry.committed || entry.destinations.length > 0);
  if (!decisions.some((entry) => entry.committed)) {
    return { acceptable: false, reason: 'no-routing-commitment', line: null, destinationId: null };
  }

  for (let index = 0; index < decisions.length; index++) {
    const entry = decisions[index];
    if (!entry.committed && entry.correction && !isUncertainRoutingLanguage(entry.line)
      && decisions.slice(0, index).some((prior) => prior.committed)) entry.committed = true;
  }
  const commitments = decisions.filter((entry) => entry.committed);
  const trailingMention = decisions.at(-1);
  if (!trailingMention.committed && commitments.length) {
    return { acceptable: false, reason: 'contradictory-routing-commitments', line: trailingMention.line, destinationId: trailingMention.destinations[0] ?? null };
  }

  const final = commitments.at(-1);
  if (final.destinations.length !== 1 || final.destinations[0].startsWith('generic-')) {
    return {
      acceptable: false,
      reason: 'unknown-or-ambiguous-destination',
      line: final.line,
      destinationId: final.destinations[0] ?? null,
    };
  }

  const destinationId = final.destinations[0];
  const earlier = commitments.slice(0, -1)
    .flatMap((entry) => entry.destinations.filter((id) => !id.startsWith('generic-')));
  if (earlier.some((id) => id !== destinationId) && !final.correction) {
    return { acceptable: false, reason: 'contradictory-routing-commitments', line: final.line, destinationId };
  }

  const acceptable = policy.allowed.includes(destinationId);
  return { acceptable, reason: acceptable ? 'accepted' : 'wrong-destination', line: final.line, destinationId };
}

export function findCommittedRoutingLineWithDestination(transcript, context = {}) {
  const decision = evaluateRoutingDecision(transcript, context);
  return decision.acceptable ? decision.line : null;
}

// Safe disclaimer language only negates matching language WITHIN ITS OWN
// CLAUSE. "I can't promise timing, but I guarantee approval today" contains a
// safe clause and an unsafe one — the unsafe clause makes the whole turn
// unsafe. Clauses split on sentence boundaries, semicolons, em dashes, and
// contrast conjunctions.
export function splitClauses(text) {
  return String(text ?? '')
    .split(/[.;!?]|—|--|,?\s+\bbut\b|,?\s+\bhowever\b|,?\s+\balthough\b|,?\s*\bmeanwhile,?\b|,\s*and\s+(?=(?:i|we)\b)/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function isSafeNonPromise(clause) {
  return /can(?:not|['’]t) (?:promise|guarantee)|not able to guarantee|no guarantee/i.test(String(clause?.text ?? clause ?? ''));
}

// "I can't say whether that's safe — that's a question for the nurse" is scope
// discipline, not clinical advice; don't let it block a repair.
function isScopeDeferral(clause) {
  return /can(?:not|['’]t) (?:say|advise|tell|speak to|give|offer|provide)|not able to (?:say|advise|tell|give)|not (?:qualified|allowed) to|that(?:['’]s| is) (?:a question |really )?for the (?:nurse|provider|doctor)|only the (?:nurse|provider|doctor) can/i.test(String(clause?.text ?? clause ?? ''));
}

const PROMISE_PATTERNS = [
  /will be approved/i, /guarantee.*(approv|sent|today)/i, /\bi promise\b/i, /promise (?:it|this|that|the)\b/i,
  /definitely (?:will )?(?:be )?(?:approved|approve|sent|filled|ready|done|today)/i, /will definitely/i,
  /make sure.*approv/i, /make sure.*sent today/i, /doctor.*approv/i, /provider.*approv/i,
  /gets approved today/i, /approved today/i, /sent today/i,
];

const CLINICAL_ADVICE_PATTERNS = [
  /give (her|him|them).*dose/i, /twice the dose/i, /double the dose/i, /take .* twice/i,
  /increase (?:the )?dos/i, /\bincrease\b/i, /\bdecrease\b/i, /stop taking/i, /safe to/i,
  /probably safe/i, /not serious/i, /you should take/i, /medical advice/i,
];

// Clause-aware detectors: a safe clause exempts ONLY itself; any other clause
// in the same turn is judged on its own. Return the offending line (for
// deterministic-finding evidence) or null.
export function findOverPromiseLine(transcript) {
  return navigatorLines(transcript).find((line) =>
    splitClauses(line.text).some((clause) => !isSafeNonPromise(clause) && lineMatchesAny(clause, PROMISE_PATTERNS)))?.text ?? null;
}

export function findClinicalAdviceLine(transcript) {
  return navigatorLines(transcript).find((line) =>
    splitClauses(line.text).some((clause) => !isScopeDeferral(clause) && lineMatchesAny(clause, CLINICAL_ADVICE_PATTERNS)))?.text ?? null;
}

const OBGYN_CALLER_OUTCOME_CHECKS = {
  known_lmp_new_ob: (text) => /(?:known|reliable|gave|provided).{0,45}(?:lmp|last menstrual|date)/i.test(text)
    && /(?:new\s+ob|pregnan(?:cy|t)).{0,70}(?:ultrasound|sonogram|provider|doctor|appointment)/i.test(text),
  unknown_lmp_confirmation: (text) => /(?:unknown|unsure|do not know|don['’]t know).{0,45}(?:lmp|last menstrual|date)/i.test(text)
    && /(?:clinical team|ob(?:\s*\/\s*gyn)? team|nurs(?:e|ing)|provider|doctor).{0,70}(?:review|follow up|next step|call back)/i.test(text),
  new_ob_pairing: (text) => /(?:ultrasound|sonogram|scan)/i.test(text)
    && /(?:provider|doctor)/i.test(text)
    && /(?:same day|together|back[- ]to[- ]back|paired)/i.test(text)
    && /(?:ultrasound|sonogram|scan).{0,60}(?:first|before)/i.test(text),
  missing_rto_order: (text) => /(?:can(?:not|['’]t)|will not|won['’]t|not able to).{0,45}(?:book|schedule)/i.test(text)
    && /(?:until|without).{0,45}(?:order|rto|document)/i.test(text)
    && /(?:contact|message|send|follow up).{0,70}(?:clinical team|ob(?:\s*\/\s*gyn)? team|nurs(?:e|ing)|provider|doctor)/i.test(text),
  transfer_ob: (text) => /records?/i.test(text)
    && /(?:review|accept|approv)/i.test(text)
    && /(?:before|until|can(?:not|['’]t)).{0,70}(?:book|schedule)|(?:book|schedule).{0,70}(?:after|once)/i.test(text),
  urgent_high_priority_intermedia: (text) => /(?:urgent|immediate|right away)/i.test(text)
    && /(?:send|message|alert|contact|escalat)/i.test(text)
    && /(?:clinical team|ob(?:\s*\/\s*gyn)? team|nurs(?:e|ing)|provider|doctor)/i.test(text),
  existing_te_take_action: (text) => /(?:existing|open|already).{0,55}(?:request|message|case|issue)/i.test(text)
    && /(?:add|attach|update|document).{0,55}(?:information|details?|request|message)|(?:avoid|not|no).{0,30}(?:duplicate|new message|second request)/i.test(text),
  mfm_owner: (text) => /\bmfm\b/i.test(text)
    && /(?:send|route|forward|hand off|pass|contact|message).{0,55}(?:mfm|team|coordinator|nurs)/i.test(text),
  paired_reschedule: (text) => /(?:ultrasound|sonogram|scan)/i.test(text)
    && /(?:provider|doctor|md)/i.test(text)
    && /(?:both|together|paired|same day|back[- ]to[- ]back)/i.test(text)
    && /(?:move|reschedule|cancel|keep)/i.test(text),
  prescription_refill: (text) => /(?:refill|prescription|medication)/i.test(text)
    && /(?:send|forward|message|contact|follow up)/i.test(text)
    && /(?:clinical|ob|nurs(?:e|ing)|provider|doctor|refill team)/i.test(text),
  test_result_medical_advice_boundary: (text) => /(?:send|forward|message|contact|follow up)/i.test(text)
    && /(?:clinical team|ob(?:\s*\/\s*gyn)? team|nurs(?:e|ing)|provider|doctor)/i.test(text)
    && /(?:callback|call back|review|question|result)/i.test(text),
  lab_boundary: (text) => /(?:can(?:not|['’]t)|will not|won['’]t|not able to).{0,50}(?:interpret|order|schedule|tell you whether)/i.test(text)
    && /(?:send|message|contact|follow up).{0,70}(?:clinical team|ob(?:\s*\/\s*gyn)? team|nurs(?:e|ing)|provider|doctor)/i.test(text),
  dr_bank_waitlist: (text) => /(?:dr\.?\s+)?bank/i.test(text)
    && /(?:wait\s*list|waiting\s+list)/i.test(text)
    && /(?:add|put|offer|place)/i.test(text),
  nurse_approved_ob_urgent: (text) => /(?:written|documented|nurs(?:e|ing)|provider).{0,50}approv/i.test(text)
    && /urgent/i.test(text)
    && /(?:book|schedule|appointment)/i.test(text),
};

// Return one verified navigator line that proves the caller-visible workflow
// outcome without relying on internal UI labels or staff assignments.
export function findObgynCallerOutcomeLine(transcript, context = {}) {
  if (context?.department !== 'obgyn') return null;
  const check = OBGYN_CALLER_OUTCOME_CHECKS[context?.metadata?.workflowType];
  if (!check) return null;
  const ruleIds = context?.metadata?.ruleIds ?? [];
  return navigatorLines(transcript).find((line) => (
    check(String(line.text ?? ''))
    && detectObgynContradictions(line.text, { ruleIds }).length === 0
  ))?.text ?? null;
}

export function isStandardPediatricRefill({ scenario = '', department = 'pediatrics', metadata = {} } = {}) {
  const text = normalizeQaText(scenario);
  if (department !== 'pediatrics' || /referral|shots|immunization|vaccine|specialty|school form|pe scheduling|physical exam.*governing|pe status.*governing/.test(text)) return false;
  return metadata.workflowType === 'prescription_refill' || String(metadata.qaScenarioId ?? '').toLowerCase().includes('refill') || /standard pediatric medication refill|standard prescription refill/.test(text) || (text.includes('medication refill') && !/referral|shots|immunization|vaccine|specialty eligibility/.test(text));
}

export function getRefillWorkflowSignals(transcript, context = {}) {
  const lines = navigatorLines(transcript);
  const matches = (regexes) => lines.some((line) => lineMatchesAny(line, regexes));
  const routingDecision = evaluateRoutingDecision(transcript, context);
  const overPromiseLine = findOverPromiseLine(transcript);
  const clinicalAdviceLine = findClinicalAdviceLine(transcript);
  return {
    medication: matches([/medication name/i, /prescription name/i, /what medication/i, /which medicine/i, /name of the medicine/i, /allergy medicine/i, /refill.*for/i]),
    pharmacy: matches([/preferred pharmacy/i, /which pharmacy/i, /what pharmacy/i, /pharmacy.*send/i, /send.*pharmacy/i]),
    callback: matches([/callback/i, /call back/i, /best number/i, /phone number/i, /reach you/i]),
    outOrUrgency: matches([/completely out/i, /out of (the )?medication/i, /out of (her|his|their) medicine/i, /any left/i, /how many.*left/i, /mark.*urgent/i, /high priority/i, /priority/i]),
    naturalRoutingLine: findNaturalRoutingActionLine(transcript),
    committedRoutingLine: routingDecision.acceptable ? routingDecision.line : null,
    routingDecision,
    overPromise: Boolean(overPromiseLine),
    overPromiseLine,
    clinicalAdvice: Boolean(clinicalAdviceLine),
    clinicalAdviceLine,
    wrongDestination: routingDecision.reason === 'wrong-destination' || routingDecision.reason === 'contradictory-routing-commitments',
  };
}

// The ONLY criteria the repair layer may ever touch, and the only direction it
// may move a verdict (NOT_MET → MET). Enforced by tests as a grading invariant.
// The authoritative per-department set lives on the resolved profile; this
// export remains the default (Pediatrics) set for legacy callers.
// LEGACY-COMPATIBILITY EXPORT ONLY. The authoritative set is always
// `profile.repairableCriteria` on the RESOLVED profile, and nothing inside the
// grading pipeline reads this constant. It remains exported because
// `gradingInvariants.test.js` and older callers reference it as the Pediatrics
// default. Do not reintroduce it into the scored path.
export const REPAIRABLE_CRITERIA = DEFAULT_QA_PROFILE.repairableCriteria;

export function repairQaVerdictsForScenario(validated, transcript, context = {}) {
  const activeProfile = profileOf(context.profile);
  const repairable = activeProfile.repairableCriteria;
  // The binding must survive this stage UNCHANGED. If a caller supplied a
  // profile that disagrees with the validated binding, fail closed rather than
  // repairing verdicts under a rubric that did not produce them.
  if (context.profile && validated.profileBinding) {
    const mismatch = profileBindingMismatch(validated.profileBinding, activeProfile);
    if (mismatch) {
      throw new Error(`repairQaVerdictsForScenario: ${mismatch} (validated under `
        + `${validated.profileBinding.department}/${validated.profileBinding.rubricVersion}, `
        + `repairing under ${activeProfile.department}/${activeProfile.rubricVersion}).`);
    }
  }
  const criteria = validated.criteria.map((criterion) => ({
    ...criterion,
    // Preserve the RAW model judgment before any repair mutates the effective
    // verdict/basis/evidence/note, so a repaired effective MET still exposes the
    // grader's original NOT_MET judgment for auditing.
    modelJudgment: criterion.modelJudgment ?? {
      verdict: criterion.verdict, basis: criterion.basis,
      evidence: criterion.evidence, note: criterion.note,
    },
    // Evaluate the ORIGINAL evidence-based negative BEFORE a repair can erase its
    // trust status: an original NOT_MET/EVIDENCE whose quote can't be verified in
    // a navigator turn is an untrustworthy allegation. Even if the effective
    // verdict is later repaired to MET, this must still force supervisor review.
    originalUnresolved: criterion.verdict === 'NOT_MET' && criterion.basis === 'EVIDENCE'
      && !verifyNavigatorEvidence(transcript, criterion.evidence),
  }));
  const repairs = [];
  const signals = getRefillWorkflowSignals(transcript, context);
  const routingPolicy = routingPolicyFor(context);
  const obgynOutcomeLine = findObgynCallerOutcomeLine(transcript, context);
  const standardRefill = isStandardPediatricRefill(context);
  const requiredDetailsMissing = standardRefill && (!signals.medication || !signals.pharmacy);
  const workflowFailure = criteria.some((criterion) => criterion.id !== 'doc-te' && criterion.verdict === 'NOT_MET' && OTHER_WORKFLOW_FAILURE.test(`${criterion.note} ${criterion.evidence}`));
  // Repair evidence must be the contradiction-safe final commitment accepted by
  // this department/workflow policy. Over-promises and clinical advice still block it.
  const safeRouting = signals.committedRoutingLine && !signals.overPromise && !signals.clinicalAdvice;
  const safeObgynOutcome = obgynOutcomeLine && !signals.overPromise && !signals.clinicalAdvice;
  // A complete standard refill means ALL required workflow signals are present:
  // medication, pharmacy, callback details, and out-of-medication/urgency
  // handling. The PE repair only applies to a COMPLETE refill.
  const completeRefill = signals.medication && signals.pharmacy && signals.callback && signals.outOrUrgency;
  const needsMessage = routingPolicy?.messageRepair === true;

  // A repair may only be applied when its replacement evidence verifies as ONE
  // navigator turn — a repair must never introduce unverifiable (or caller-side)
  // evidence. If it does not verify, the grader's NOT_MET stands.
  const applyRepair = (criterion, rule, reason, evidence = signals.committedRoutingLine, reviewRequired = true) => {
    if (!verifyNavigatorEvidence(transcript, evidence)) return;
    repairs.push({
      criterionId: criterion.id, rule, from: criterion.verdict, to: 'MET', reason,
      evidence,
      reviewRequired,
      originalVerdict: criterion.verdict, originalBasis: criterion.basis,
      originalNote: criterion.note, originalEvidence: criterion.evidence,
    });
    criterion.verdict = 'MET'; criterion.basis = 'EVIDENCE';
    criterion.evidence = evidence; criterion.note = reason;
  };

  for (const criterion of criteria) {
    if (criterion.id === 'know-rule' && standardRefill && criterion.verdict === 'NOT_MET' && isStrictPeOnlyFailure(criterion) && completeRefill && safeRouting) {
      applyRepair(criterion, CALL_QA_FAIRNESS_RULES.standardRefillNoPeRequirement,
        'Fairness repair: standard pediatric refill does not require caller-facing PE/Physical Exam verification unless PE is the governing issue.');
    }
    if (context?.department !== 'obgyn' && criterion.id === 'doc-te' && criterion.verdict === 'NOT_MET' && needsMessage && isLiteralTeWordingFailure(criterion) && safeRouting && !workflowFailure && !requiredDetailsMissing) {
      applyRepair(criterion, CALL_QA_FAIRNESS_RULES.naturalMessageRoutingWording,
        'Fairness repair: accepted natural patient-facing message/routing wording; exact TE/Telephone Encounter phrase is not required.');
    }
    if (context?.department === 'obgyn'
      && repairable.has(criterion.id)
      && criterion.verdict === 'NOT_MET'
      && isObgynInternalNarrationOnlyFailure(criterion)
      && safeObgynOutcome
      && !workflowFailure) {
      applyRepair(
        criterion,
        CALL_QA_FAIRNESS_RULES.obgynCallerObservableOutcome,
        'Fairness repair: the caller-facing workflow outcome is explicit and safe; exact narration of internal chart, queue, channel, or staff labels is not required.',
        obgynOutcomeLine,
        false,
      );
    }
  }
  return {
    criteria,
    autoFails: validated.autoFails,
    repairs,
    reviewReasons: routingPolicy?.reviewOnly ? ['routing-policy-review-only'] : [],
    // Carried through UNCHANGED so scoreQa can re-check it. Dropping it here is
    // exactly how the binding was previously lost before scoring.
    profileBinding: validated.profileBinding ?? null,
  };
}

// ── Deterministic conflict findings (model-POSITIVE error protection) ────────
//
// The repair layer protects against grader FALSE NEGATIVES (NOT_MET → MET).
// This layer protects against the opposite error: the grader marking know-rule
// / doc-te MET (with a real, verifiable quote) on a call whose committed
// routing decision the deterministic policy knows is wrong, contradictory,
// ambiguous, or missing — or where a deterministic over-promise / clinical-
// advice signal exists. Findings are NOT repairs: they never change a verdict
// or a score; they force supervisor review of an otherwise-confident pass and
// are persisted on `qa.deterministicFindings` for the supervisor UI.

export function evaluateQaDeterministicFindings(criteria, transcript, context = {}) {
  const repairable = profileOf(context.profile).repairableCriteria;
  const findings = [];
  const signals = getRefillWorkflowSignals(transcript, context);
  const policy = routingPolicyFor(context);
  const metRoutingCriteria = (Array.isArray(criteria) ? criteria : [])
    .filter((criterion) => repairable.has(criterion.id) && criterion.verdict === 'MET')
    .map((criterion) => criterion.id);

  const decision = signals.routingDecision;
  if (context?.department !== 'obgyn' && policy && !policy.reviewOnly && !decision.acceptable && metRoutingCriteria.length > 0) {
    findings.push({
      id: 'model-routing-conflict',
      type: 'routing',
      reason: decision.reason,
      evidence: decision.line ?? null,
      destinationId: decision.destinationId ?? null,
      affectedCriteria: metRoutingCriteria,
    });
  }
  // A finding is a model conflict only when the model gave the affected
  // safety criterion credit. A correctly detected model miss is already
  // preserved in the criterion and is not mislabeled as a conflict.
  if (signals.overPromise && metRoutingCriteria.includes('know-rule')) {
    findings.push({
      id: 'deterministic-overpromise',
      type: 'safety',
      reason: 'unsafe-promise-language',
      evidence: signals.overPromiseLine,
      destinationId: null,
      affectedCriteria: ['know-rule'],
    });
  }
  if (signals.clinicalAdvice && metRoutingCriteria.includes('know-rule')) {
    findings.push({
      id: 'deterministic-clinical-advice',
      type: 'safety',
      reason: 'clinical-advice-language',
      evidence: signals.clinicalAdviceLine,
      destinationId: null,
      affectedCriteria: ['know-rule'],
    });
  }
  // OB/GYN transcript safeguards are contradiction-only. Internal chart clicks,
  // queue names, channel names, visit labels, and staff assignments are not
  // caller-facing requirements and their absence must never create a review.
  // Evaluate each clause independently so a safe disclaimer cannot suppress a
  // later explicit violation ("I cannot advise you, but go to L&D now").
  if (context?.department === 'obgyn') {
    const ruleIds = context?.metadata?.ruleIds ?? [];
    const seen = new Set(findings.map((finding) => finding.reason));
    if (ruleIds.length && metRoutingCriteria.length) {
      for (const line of navigatorLines(transcript)) {
        for (const clause of splitClauses(line.text)) {
          const negated = isObgynProhibitedActionNegated(clause);
          const contextualFlags = [
            ...(ruleIds.includes('new_ob_known_lmp')
              && /(?:book|schedule|require|must use)[\s\S]{0,45}(?:pregnancy\s+)?confirmation/i.test(clause)
              && !negated ? [{ code: 'known_lmp_forced_confirmation' }] : []),
            ...(ruleIds.includes('confirmation_unknown_lmp')
              && /(?:book|schedule|send)[\s\S]{0,45}(?:normal\s+)?new\s+ob/i.test(clause)
              && !negated ? [{ code: 'unknown_lmp_direct_new_ob' }] : []),
          ];
          for (const flag of [...detectObgynContradictions(clause, { ruleIds }), ...contextualFlags]) {
            if (seen.has(flag.code)) continue;
            seen.add(flag.code);
            findings.push({
              id: `obgyn-${flag.code}`,
              type: /urgent|labor|lab|promise|advice|approval/i.test(flag.code) ? 'safety' : 'routing',
              reason: flag.code,
              evidence: clause,
              destinationId: null,
              affectedCriteria: metRoutingCriteria,
            });
          }
        }
      }
    }
    return findings;
  }
  return findings;
}

// ── Deterministic scoring ────────────────────────────────────────────────────

/**
 * Apply the trust gates and compute the scorecard. Pure; no I/O.
 *
 * Gates (the "hard test" rules):
 *  - MET without verifiable evidence → NOT_MET (flagged `unverified`).
 *  - NA on a core criterion → NOT_MET (core behaviors are expected on every call).
 *  - An auto-fail stands only with verified evidence; a verified auto-fail
 *    zeroes the final score and fails the test outright.
 *
 * @param {{id,verdict,evidence,note}[]} verdicts    validated model verdicts
 * @param {{id,evidence,note}[]} autoFails           validated triggered auto-fails
 * @param {{role,text}[]} transcript
 */
/**
 * Flatten an identity/ordering evaluation into a compact, supervisor-readable
 * audit record. Never includes the raw model claims verbatim — only what the
 * SERVER independently verified plus the reasons it rejected the rest.
 */
function summarizeIdentityDetail(evidenceCheck) {
  const detail = evidenceCheck.detail ?? {};
  const identity = detail.identity ?? detail;
  return {
    verified: Object.fromEntries(
      Object.entries(identity.verified ?? {}).map(([field, item]) => [
        field, { role: item.role, turnIndex: item.turnIndex },
      ]),
    ),
    complete: identity.complete === true,
    completedAtIndex: identity.completedAtIndex ?? null,
    rejectedClaims: (identity.failures ?? []).map((failure) => ({
      field: failure.field, reason: failure.reason,
    })),
    ...(detail.disclosureIndex !== undefined
      ? {
        disclosureIndex: detail.disclosureIndex,
        disclosureCategory: detail.disclosureCategory ?? null,
        disclosureClauseIndex: detail.disclosureClauseIndex ?? null,
        orderReason: detail.reason ?? null,
      }
      : {}),
  };
}

// Human labels for the identifier ids, used only in the server-derived summary.
const IDENTITY_FIELD_LABELS = {
  firstName: 'first name', lastName: 'last name', dob: 'date of birth',
};

/**
 * Build the ONLY evidence string an identity criterion is allowed to carry.
 *
 * The model's free-text `evidence` is NEVER trusted for an identity criterion:
 * scoring uses the structured `identityEvidence` array, so a grader could submit
 * valid structured claims alongside an invented quote ("The patient was fully
 * verified.") and that fabricated sentence would previously be persisted and
 * rendered to a supervisor as observed evidence.
 *
 * This summary is derived entirely from what the SERVER re-verified, and it is
 * deliberately PRIVACY-SAFE: it names which identifiers verified and in which
 * turn, never the identifier values themselves. A navigator-facing strength
 * should not repeat a patient's name or date of birth back at them, and the
 * per-field audit record (`identityVerification`) already carries the turn-level
 * detail a supervisor needs.
 *
 * Returns '' when nothing verified — there is genuinely nothing to show.
 */
function buildIdentityEvidenceSummary(evidenceCheck) {
  const detail = evidenceCheck?.detail ?? {};
  const identity = detail.identity ?? detail;
  const fields = IDENTITY_FIELDS.filter((field) => identity.verified?.[field]);
  if (fields.length === 0) return '';

  const labels = fields.map((field) => IDENTITY_FIELD_LABELS[field] ?? field);
  const turn = identity.completedAtIndex;
  const parts = [
    `Server-verified from the transcript: ${labels.join(', ')}`
    + (Number.isInteger(turn) ? ` (complete by turn ${turn})` : ''),
  ];
  if (detail.disclosureIndex !== undefined && detail.reason === 'verified-before-disclosure') {
    parts.push('identity completed before the first protected disclosure');
  }
  return `${parts.join('; ')}.`;
}

export function scoreQa(verdicts, autoFails, transcript, profile, profileBinding) {
  const active = profileOf(profile);
  const defs = active.criteriaById;

  // ── Profile binding + criterion-set integrity (checked BEFORE any scoring) ──
  // Validation and scoring must provably be the same rubric. Criterion IDs alone
  // are not identity: two profiles can share IDs but differ in points, `core`
  // applicability, categories, evidence policies, or auto-fails. The signature
  // covers all of it.
  if (profileBinding !== undefined) {
    const mismatch = profileBindingMismatch(profileBinding, active);
    if (mismatch) {
      throw new Error(`scoreQa: ${mismatch} — verdicts were validated under a different rubric `
        + `profile than the one supplied for scoring (${active.department}/${active.rubricVersion}).`);
    }
  }
  const setMismatch = criterionSetMismatch(verdicts, active);
  if (setMismatch) {
    throw new Error(
      `scoreQa: ${setMismatch} for rubric profile "${active.department}" (${active.rubricVersion}).`,
    );
  }

  // ── ONE canonical identity evaluation feeds BOTH verification criteria (B1) ──
  // The two identity criteria can never be credited from different identities:
  // validation guarantees their arrays are identical when both are present, and
  // here scoring evaluates a SINGLE canonical array once and feeds the result to
  // whichever identity criteria are MET.
  const identityDefs = [...defs.values()]
    .filter((d) => d.evidencePolicy === QA_EVIDENCE_POLICIES.IDENTITY_VERIFICATION);
  let canonicalIdentity = null;
  let canonicalOrder = null;
  if (identityDefs.length > 0) {
    const canonicalArray = identityDefs
      .map((d) => verdicts.find((v) => v.id === d.id)?.identityEvidence)
      .find((arr) => Array.isArray(arr) && arr.length > 0) ?? [];
    canonicalIdentity = evaluateIdentityEvidence(transcript, canonicalArray);
    canonicalOrder = evaluateVerificationBeforeAccess(transcript, canonicalArray);
  }

  const criteria = verdicts.map((v) => {
    const def = defs.get(v.id);
    // Use the raw model judgment preserved by the repair layer (before it mutated
    // the effective fields); fall back to this verdict's own fields when scoreQa
    // is called directly on validated verdicts (no repair layer ran).
    const modelJudgment = v.modelJudgment ?? { verdict: v.verdict, basis: v.basis, evidence: v.evidence, note: v.note };
    let verdict = v.verdict;
    let basis = v.basis;
    let unverified = false;
    // An original evidence-based negative whose quote failed navigator
    // verification is untrustworthy even after a deterministic repair flipped the
    // effective verdict to MET — carry that unresolved status through.
    let unresolved = Boolean(v.originalUnresolved);
    let unresolvedReason = unresolved ? 'negative-evidence-not-verified' : null;

    // MET credit uses the criterion's own evidence policy. For an identity
    // criterion this re-derives the STRUCTURED identifier claims (and, where the
    // criterion declares it, the chronological ordering against the first
    // protected disclosure) from the transcript — a model Boolean or a two-word
    // quote is never sufficient. Negatives below stay navigator-only regardless
    // of policy, so caller wording can never substantiate an accusation.
    let evidenceCheck = null;
    if (verdict === 'MET') {
      if (def.evidencePolicy === QA_EVIDENCE_POLICIES.IDENTITY_VERIFICATION) {
        // Consume the ONE canonical identity evaluation, so both verification
        // criteria are decided from the same server-derived identity result.
        const source = def.evidenceOrder === 'before-protected-disclosure'
          ? { verified: canonicalOrder.satisfied, reason: canonicalOrder.satisfied ? null : canonicalOrder.reason, detail: canonicalOrder }
          : { verified: canonicalIdentity.complete, reason: canonicalIdentity.complete ? null : 'identity-not-verified', detail: canonicalIdentity };
        evidenceCheck = source;
      } else {
        evidenceCheck = verifyCriterionEvidenceDetailed(transcript, v.evidence, def, v.identityEvidence);
      }
    }
    if (verdict === 'MET' && !evidenceCheck.verified) {
      // A MET whose evidence can't be verified loses the credit.
      verdict = 'NOT_MET';
      basis = 'ABSENCE';
      unverified = true;
      // An identity criterion whose ORDER could not be established is not a
      // confident negative — it is an unresolved integrity problem, so it also
      // takes the existing evidence-integrity review treatment.
      if (evidenceCheck.detail?.uncertain) {
        unresolved = true;
        unresolvedReason = 'verification-order-unverified';
      }
    } else if (verdict === 'NOT_MET' && basis === 'EVIDENCE'
      && !verifyNavigatorEvidence(transcript, v.evidence)) {
      // An evidence-based negative whose offending quote can't be verified in a
      // navigator turn is NOT fully trustworthy. It normally stays NOT_MET for
      // scoring, but a whitelist-only deterministic fairness repair backed by
      // DIFFERENT, independently verified navigator evidence may have already
      // changed the effective verdict to MET (in which case v.originalUnresolved
      // above already carried the flag). Either way it is marked unresolved so
      // the review layer forces supervisor review and the UI never calls the
      // original allegation "observed".
      unresolved = true;
      unresolvedReason = 'negative-evidence-not-verified';
    }
    if (verdict === 'NA' && def.core) { verdict = 'NOT_MET'; basis = 'ABSENCE'; }

    // An identity criterion's displayed evidence is SERVER-DERIVED, never the
    // model's free text. Scoring already ignores that free text (it uses the
    // structured claims), so persisting it would let a fabricated quote reach
    // the supervisor panel, the grade projection and coaching prose as if it
    // had been observed. See docs/GRADING_INVARIANTS.md §0.5.
    const isIdentityCriterion = def.evidencePolicy === QA_EVIDENCE_POLICIES.IDENTITY_VERIFICATION;
    const evidence = isIdentityCriterion
      ? buildIdentityEvidenceSummary(evidenceCheck)
      : v.evidence;

    return {
      id: def.id, text: def.text, points: def.points,
      categoryId: def.categoryId, categoryName: def.categoryName,
      verdict, basis, evidence, note: v.note,
      ...(isIdentityCriterion ? { evidenceSource: 'server-derived' } : {}),
      unverified, unresolved, unresolvedReason,
      modelJudgment,
      // Auditable record of WHY an identity criterion was (or was not) credited:
      // which identifiers verified, in which turns, where the first protected
      // disclosure was, and which claims the server rejected.
      ...(evidenceCheck?.detail ? { identityVerification: summarizeIdentityDetail(evidenceCheck) } : {}),
    };
  });

  const categories = active.rubric.map((cat) => {
    const items = criteria.filter((c) => c.categoryId === cat.id);
    const applicable = items.filter((c) => c.verdict !== 'NA');
    return {
      id: cat.id,
      name: cat.name,
      possible: items.reduce((s, c) => s + c.points, 0),
      applicablePoints: applicable.reduce((s, c) => s + c.points, 0),
      earned: applicable.filter((c) => c.verdict === 'MET').reduce((s, c) => s + c.points, 0),
    };
  });

  const applicableTotal = categories.reduce((s, c) => s + c.applicablePoints, 0);
  const earnedTotal = categories.reduce((s, c) => s + c.earned, 0);
  const rawScore = applicableTotal > 0 ? Math.round((earnedTotal / applicableTotal) * 100) : 0;

  const withText = (a) => ({ ...a, text: active.autoFails.find((d) => d.id === a.id)?.text ?? a.id });
  const verifiedAutoFails = [];
  const unverifiedAutoFails = [];
  for (const a of autoFails) {
    // An auto-fail is a navigator behavior: only a navigator turn can verify it.
    (verifyNavigatorEvidence(transcript, a.evidence) ? verifiedAutoFails : unverifiedAutoFails).push(withText(a));
  }

  const autoFailed = verifiedAutoFails.length > 0;
  const score = autoFailed ? 0 : rawScore;
  const pass = !autoFailed && score >= active.passThreshold;

  return {
    score, rawScore, pass, passThreshold: active.passThreshold, categories, criteria,
    rubricDepartment: active.department,
    rubricVersion: active.rubricVersion,
    autoFails: verifiedAutoFails,
    // Reported by the model but its quote didn't verify. It must never fail the
    // navigator (anti-hallucination), but it must ALSO never vanish silently —
    // the review layer surfaces it as a supervisor flag.
    unverifiedAutoFails,
  };
}

// ── Confidence & supervisor-review assessment ────────────────────────────────

// Criteria whose failure represents a patient-safety / compliance risk, not
// just lost quality points: identity verification, applying the right SOP rule,
// and routing to the right queue/contact.
// The authoritative per-department set lives on the resolved profile
// (`profile.safetyCriticalCriteria`); this export remains the default
// (Pediatrics) set for legacy callers and cross-profile invariant checks.
export const SAFETY_CRITICAL_CRITERIA = DEFAULT_QA_PROFILE.safetyCriticalCriteria;

// A score within this many points of the pass mark is "borderline" — the AI
// result alone should not decide pass/fail there.
export const QA_REVIEW_MARGIN = 5;

/**
 * Deterministic confidence + supervisor-review layer on top of a scorecard.
 * Pure; no I/O, no model calls — every flag is derived from observable facts
 * (verification failures, correction counts, score distance, NA coverage), so
 * the same scorecard always produces the same review verdict.
 *
 * @param {ReturnType<typeof scoreQa>} qa
 * @param {{role,text}[]} transcript        the (corrected) graded transcript
 * @param {{correctedTurns?: number}} opts  transcript-quality stats from the glossary
 * @returns {{ recommendation: 'pass'|'needs_review'|'fail',
 *             confidence: 'high'|'medium'|'low',
 *             safetyRisk: 'none'|'elevated'|'critical',
 *             reviewFlags: {id:string, label:string, detail:string}[] }}
 */
export function assessQa(qa, transcript, { correctedTurns = 0, repairs = [], deterministicFindings = [], profile } = {}) {
  const active = profileOf(profile);
  const safetyCritical = active.safetyCriticalCriteria;
  const flags = [];

  const navigatorTurns = (transcript ?? []).filter((t) => t?.role === 'navigator').length;
  if (correctedTurns >= 3 || navigatorTurns < 3 || (transcript ?? []).length < 4) {
    flags.push({
      id: 'low-transcript-confidence',
      label: 'Low transcript confidence',
      detail: correctedTurns >= 3
        ? `${correctedTurns} turns needed terminology correction — the transcription was struggling with this call.`
        : 'The call is very short or has too few navigator responses to grade reliably.',
    });
  }

  const unverified = qa.criteria.filter((c) => c.unverified);
  if (unverified.length > 0) {
    flags.push({
      id: 'unverified-evidence',
      label: 'Grader evidence did not verify',
      detail: `${unverified.length} criterion verdict(s) cited quotes not found in the transcript and were scored NOT MET (${unverified.map((c) => c.id).join(', ')}). Confirm against the transcript.`,
    });
  }

  // Evidence-based NOT_MET judgments whose offending quote could not be verified
  // in a navigator turn: the grader ALLEGED an observed wrong/unsafe behavior but
  // the quote does not hold up. The effective verdict usually stays NOT_MET, but
  // a whitelist-only deterministic fairness repair (backed by DIFFERENT, verified
  // navigator evidence) may have changed it to MET — the original allegation
  // stays unresolved regardless, must not be presented as definitively observed,
  // and forces supervisor review.
  const unresolvedNegatives = qa.criteria.filter((c) => c.unresolved);
  if (unresolvedNegatives.length > 0) {
    flags.push({
      id: 'unresolved-negative-evidence',
      label: 'Negative finding could not be verified',
      detail: `The grader reported ${unresolvedNegatives.length} negative finding(s) as observed (${unresolvedNegatives.map((c) => c.id).join(', ')}) but the quoted navigator evidence did not verify. Confirm against the transcript before treating them as observed behaviors.`,
    });
  }
  const unresolvedSafety = unresolvedNegatives.filter((c) => safetyCritical.has(c.id));

  if (qa.unverifiedAutoFails?.length > 0) {
    flags.push({
      id: 'possible-unsafe-behavior',
      label: 'Possible unsafe behavior — unconfirmed',
      detail: `The grader reported a possible violation (${qa.unverifiedAutoFails.map((a) => a.text).join(' ')}) but its quote could not be verified, so it did NOT fail the test. Review the transcript before accepting this result.`,
    });
  }

  // Only non-core criteria (31 points total) can legitimately be NA; when most
  // of them are, the score rests on a thin slice of the rubric.
  const naPoints = qa.criteria
    .filter((c) => c.verdict === 'NA')
    .reduce((s, c) => s + c.points, 0);
  if (naPoints > 25) {
    flags.push({
      id: 'thin-coverage',
      label: 'Thin rubric coverage',
      detail: `${naPoints} of 100 rubric points were not applicable to this scenario — the score rests on few criteria.`,
    });
  }

  const safetyMissed = qa.criteria
    .filter((c) => c.verdict === 'NOT_MET' && safetyCritical.has(c.id));
  if (safetyMissed.length > 0) {
    flags.push({
      id: 'safety-criterion-missed',
      label: 'Safety-relevant criterion missed',
      detail: `Missed: ${safetyMissed.map((c) => `${c.categoryName} — ${c.text}`).join(' · ')}`,
    });
  }

  const borderline = qa.autoFails.length === 0
    && Math.abs(qa.score - qa.passThreshold) <= QA_REVIEW_MARGIN;
  if (borderline) {
    flags.push({
      id: 'borderline-score',
      label: 'Borderline score',
      detail: `Score ${qa.score} is within ${QA_REVIEW_MARGIN} points of the ${qa.passThreshold} pass mark — supervisor judgment recommended.`,
    });
  }

  if (qa.autoFails.length > 0) {
    flags.push({
      id: 'requires-supervisor-judgment',
      label: 'Auto-fail — supervisor confirmation required',
      detail: 'A verified auto-fail zeroed this test. Confirm the quoted line and the context before treating the fail as final.',
    });
  }
  if (repairs.length > 0) {
    flags.push({ id: 'fairness-repair-applied', label: 'Fairness repair applied', detail: 'Deterministic Call QA guardrails corrected one or more likely false-negative rubric verdicts. Review repaired criteria for transparency.' });
  }

  // A repair may add points but must never silently flip the outcome: if the
  // call would have FAILED without the repaired criteria, a supervisor decides.
  const defs = active.criteriaById;
  const repairedPoints = repairs
    .filter((r) => r.to === 'MET' && r.from === 'NOT_MET' && r.reviewRequired !== false)
    .reduce((s, r) => s + (defs.get(r.criterionId)?.points ?? 0), 0);
  const applicableTotal = qa.categories.reduce((s, c) => s + c.applicablePoints, 0);
  const earnedTotal = qa.categories.reduce((s, c) => s + c.earned, 0);
  const unrepairedScore = applicableTotal > 0
    ? Math.round(((earnedTotal - repairedPoints) / applicableTotal) * 100)
    : 0;
  const repairFlippedOutcome = qa.pass && repairedPoints > 0 && unrepairedScore < qa.passThreshold;
  if (repairFlippedOutcome) {
    flags.push({
      id: 'repair-changed-outcome',
      label: 'Repair changed the outcome',
      detail: `Without the fairness repair(s) this call would have scored ${unrepairedScore} and FAILED. The pass must be confirmed by a supervisor.`,
    });
  }

  if (deterministicFindings.some((finding) => finding.type === 'routing')) {
    flags.push({ id: 'model-routing-conflict', label: 'Grader verdict conflicts with deterministic routing policy', detail: 'Deterministic routing found a conflict with a model-positive routing verdict. Supervisor review is required.' });
  }
  if (deterministicFindings.some((finding) => finding.type === 'safety')) {
    flags.push({ id: 'deterministic-safety-conflict', label: 'Deterministic unsafe-language signal detected', detail: 'Deterministic checks found unsafe language in the navigator transcript. Supervisor review is required.' });
  }

  const confidenceHits = flags.filter((f) =>
    ['low-transcript-confidence', 'unverified-evidence', 'possible-unsafe-behavior', 'thin-coverage'].includes(f.id)).length;
  const confidence = confidenceHits >= 2 ? 'low' : confidenceHits === 1 ? 'medium' : 'high';

  const safetyRisk = qa.autoFails.length > 0 || qa.unverifiedAutoFails?.length > 0
    ? 'critical'
    : safetyMissed.length > 0 || unresolvedSafety.length > 0 ? 'elevated' : 'none';

  let recommendation;
  if (qa.autoFails.length > 0) recommendation = 'fail';
  // An unresolved negative (grader alleged an observed miss its quote can't back
  // up) can never produce a confident verdict — a supervisor decides, regardless
  // of the numerical score. Safety-critical unresolved negatives elevate risk.
  else if (unresolvedNegatives.length > 0) recommendation = 'needs_review';
  else if (confidence === 'low' || borderline || qa.unverifiedAutoFails?.length > 0) recommendation = 'needs_review';
  else if (qa.pass && safetyMissed.length > 0) recommendation = 'needs_review'; // never an unreviewed pass over a safety miss
  else if (repairFlippedOutcome) recommendation = 'needs_review'; // repairs are decision support, not the final word
  else if (deterministicFindings.length > 0 && qa.pass) recommendation = 'needs_review';
  else recommendation = qa.pass ? 'pass' : 'fail';

  return { recommendation, confidence, safetyRisk, reviewFlags: flags };
}

// ── Grade projection (compat with the existing interview grade shape) ────────

/**
 * Project the QA scorecard onto the { score, summary, strengths, improvements }
 * shape the interview doc + supervisor panel already render. Pure.
 */
export function buildGradeProjection(qa) {
  const catLine = qa.categories
    .map((c) => `${c.name} ${c.earned}/${c.applicablePoints || c.possible}`)
    .join(' · ');
  const verdictWord = qa.pass ? 'PASSED' : 'FAILED';
  let summary = qa.autoFails.length > 0
    ? `QA test FAILED — automatic fail: ${qa.autoFails.map((a) => a.text).join(' ')} Rubric score before the auto-fail was ${qa.rawScore}/100.`
    : `QA test ${verdictWord} with ${qa.score}/100 (pass mark ${qa.passThreshold}). ${catLine}.`;
  if (qa.review?.recommendation === 'needs_review') {
    summary += ` FLAGGED FOR SUPERVISOR REVIEW (${qa.review.reviewFlags.map((f) => f.label).join('; ')}).`;
  }

  // Only show evidence that actually verified: never present an unverified MET
  // or an unresolved (unverifiable) negative quote as if it were observed.
  //
  // A `server-derived` string is NOT a transcript quote — it is the server's own
  // summary of what it re-verified for an identity criterion — so it is rendered
  // as a plain statement. Wrapping it in quotation marks would present the
  // server's words as something the navigator said.
  const quote = (c) => {
    if (!c.evidence || c.unverified || c.unresolved) return '';
    return c.evidenceSource === 'server-derived' ? ` — ${c.evidence}` : ` — "${c.evidence}"`;
  };
  const strengths = qa.criteria
    .filter((c) => c.verdict === 'MET')
    .sort((a, b) => b.points - a.points)
    .slice(0, 4)
    .map((c) => `${c.categoryName}: ${c.text}${quote(c)}`);

  const improvements = [
    ...qa.autoFails.map((a) => `AUTO-FAIL — ${a.text}${a.note ? ` (${a.note})` : ''}${a.evidence ? ` — "${a.evidence}"` : ''}`),
    ...qa.criteria
      .filter((c) => c.verdict === 'NOT_MET')
      .sort((a, b) => b.points - a.points)
      .map((c) => `${c.categoryName} (−${c.points}): ${c.text}${c.note ? ` — ${c.note}` : ''}${quote(c)}`),
  ].slice(0, 8);

  return { score: qa.score, summary, strengths, improvements };
}
