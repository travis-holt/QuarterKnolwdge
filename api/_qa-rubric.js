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

export { QA_RUBRIC, QA_AUTO_FAILS, QA_PASS_THRESHOLD, QA_RUBRIC_VERSION, VERDICTS, BASES, rubricCriteria };

// ── Evidence verification ────────────────────────────────────────────────────

// A small, conservative, deterministic contraction expansion so a quote and a
// transcript turn match even when one wrote "I'm" and the other "I am". Applied
// to BOTH sides before punctuation is stripped. Only unambiguous contractions
// are expanded; possessive "'s" is left to be stripped as punctuation.
const CONTRACTIONS = [
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

function normalizeForMatch(s) {
  let text = String(s ?? '').toLowerCase().replace(/[‘’]/g, "'");
  for (const [pattern, replacement] of CONTRACTIONS) text = text.replace(pattern, replacement);
  return text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

// A quote must be substantive (2+ words) to be evidence — a single word can
// match by accident and proves nothing.
function quoteWords(needle) {
  return needle.split(' ').filter(Boolean);
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
  const stripped = String(quote ?? '').replace(/^\s*["'“”]*\s*(navigator|caller|patient)\s*:\s*/i, '');
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

// ── Response validation (model output → trusted verdicts) ───────────────────

// Is there a substantive (2+ word) evidence quote present?
function hasSubstantiveEvidence(evidence) {
  return quoteWords(normalizeForMatch(evidence)).length >= 2;
}

/**
 * Validate one criterion's verdict/basis/evidence combination. Returns an error
 * string for a malformed combination (so the whole response is rejected and the
 * existing malformed-response retry runs), or null when the combination is legal.
 *
 * Legal shapes:
 *   MET      + EVIDENCE + non-empty evidence
 *   NOT_MET  + EVIDENCE + non-empty evidence   (observed wrong/unsafe behavior)
 *   NOT_MET  + ABSENCE  + no substantive evidence (behavior simply absent)
 *   NA       + ABSENCE
 */
export function validateCriterionBasis(verdict, basis, evidence) {
  if (!BASES.has(basis)) return `unknown or missing basis "${basis}".`;
  const hasEvidence = String(evidence ?? '').trim().length > 0;
  if (verdict === 'MET') {
    if (basis !== 'EVIDENCE') return 'MET must use basis EVIDENCE.';
    if (!hasEvidence) return 'MET requires a non-empty evidence quote.';
  } else if (verdict === 'NOT_MET') {
    if (basis === 'EVIDENCE' && !hasEvidence) return 'NOT_MET with basis EVIDENCE requires an evidence quote.';
    if (basis === 'ABSENCE' && hasSubstantiveEvidence(evidence)) return 'NOT_MET with basis ABSENCE must not carry a substantive evidence quote.';
  } else if (verdict === 'NA') {
    if (basis !== 'ABSENCE') return 'NA must use basis ABSENCE.';
  }
  return null;
}

/**
 * Validate the model's raw JSON against the rubric. Pure; no I/O.
 * @returns {{ data: {criteria: [], autoFails: []} } | { error: string }}
 */
export function validateQaResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') return { error: 'Response is not an object.' };
  const critList = Array.isArray(parsed.criteria) ? parsed.criteria : null;
  if (!critList) return { error: 'Missing criteria array.' };

  const byId = new Map();
  for (const c of critList) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') continue;
    const verdict = String(c.verdict ?? '').toUpperCase();
    if (!VERDICTS.has(verdict)) continue;
    const basis = String(c.basis ?? '').toUpperCase();
    const evidence = typeof c.evidence === 'string' ? c.evidence : '';
    const note = typeof c.note === 'string' ? c.note : '';
    // Reject malformed verdict/basis/evidence combinations rather than silently
    // coercing them — this trips the endpoint's malformed-response retry.
    const basisError = validateCriterionBasis(verdict, basis, evidence);
    if (basisError) return { error: `Criterion ${c.id}: ${basisError}` };
    byId.set(c.id, { id: c.id, verdict, basis, evidence, note });
  }

  const missing = rubricCriteria().filter((c) => !byId.has(c.id)).map((c) => c.id);
  if (missing.length > 0) return { error: `Missing verdicts for: ${missing.join(', ')}` };

  const afIds = new Set(QA_AUTO_FAILS.map((a) => a.id));
  const autoFails = (Array.isArray(parsed.autoFails) ? parsed.autoFails : [])
    .filter((a) => a && typeof a === 'object' && afIds.has(a.id) && a.triggered === true)
    .map((a) => ({
      id: a.id,
      evidence: typeof a.evidence === 'string' ? a.evidence : '',
      note: typeof a.note === 'string' ? a.note : '',
    }));

  return { data: { criteria: rubricCriteria().map((c) => byId.get(c.id)), autoFails } };
}

export const CALL_QA_FAIRNESS_RULES = {
  standardRefillNoPeRequirement: 'standard-refill-no-pe-requirement',
  naturalMessageRoutingWording: 'natural-message-routing-wording',
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
    prescription_refill: { allowed: ['ob-nursing'], messageRepair: true },
    mfm_related_request: { allowed: ['ob-mfm-owner'] },
    records_forms: { allowed: ['medical-records'] },
    scheduling_change: { allowed: ['ob-pss'] },
    wrong_department_unclear_request: { allowed: [], reviewOnly: true },
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
    .split(/[.;!?]|—|--|,?\s+\bbut\b|,?\s+\bhowever\b|,?\s+\balthough\b|,?\s*\bmeanwhile,?\b/i)
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
export const REPAIRABLE_CRITERIA = new Set(['know-rule', 'doc-te']);

export function repairQaVerdictsForScenario(validated, transcript, context = {}) {
  const criteria = validated.criteria.map((criterion) => ({ ...criterion }));
  const repairs = [];
  const signals = getRefillWorkflowSignals(transcript, context);
  const routingPolicy = routingPolicyFor(context);
  const standardRefill = isStandardPediatricRefill(context);
  const requiredDetailsMissing = standardRefill && (!signals.medication || !signals.pharmacy);
  const workflowFailure = criteria.some((criterion) => criterion.id !== 'doc-te' && criterion.verdict === 'NOT_MET' && OTHER_WORKFLOW_FAILURE.test(`${criterion.note} ${criterion.evidence}`));
  // Repair evidence must be the contradiction-safe final commitment accepted by
  // this department/workflow policy. Over-promises and clinical advice still block it.
  const safeRouting = signals.committedRoutingLine && !signals.overPromise && !signals.clinicalAdvice;
  // A complete standard refill means ALL required workflow signals are present:
  // medication, pharmacy, callback details, and out-of-medication/urgency
  // handling. The PE repair only applies to a COMPLETE refill.
  const completeRefill = signals.medication && signals.pharmacy && signals.callback && signals.outOrUrgency;
  const needsMessage = routingPolicy?.messageRepair === true;

  // A repair may only be applied when its replacement evidence verifies as ONE
  // navigator turn — a repair must never introduce unverifiable (or caller-side)
  // evidence. If it does not verify, the grader's NOT_MET stands.
  const applyRepair = (criterion, rule, reason) => {
    if (!verifyNavigatorEvidence(transcript, signals.committedRoutingLine)) return;
    repairs.push({
      criterionId: criterion.id, rule, from: criterion.verdict, to: 'MET', reason,
      evidence: signals.committedRoutingLine,
      originalVerdict: criterion.verdict, originalBasis: criterion.basis,
      originalNote: criterion.note, originalEvidence: criterion.evidence,
    });
    criterion.verdict = 'MET'; criterion.basis = 'EVIDENCE';
    criterion.evidence = signals.committedRoutingLine; criterion.note = reason;
  };

  for (const criterion of criteria) {
    if (criterion.id === 'know-rule' && standardRefill && criterion.verdict === 'NOT_MET' && isStrictPeOnlyFailure(criterion) && completeRefill && safeRouting) {
      applyRepair(criterion, CALL_QA_FAIRNESS_RULES.standardRefillNoPeRequirement,
        'Fairness repair: standard pediatric refill does not require caller-facing PE/Physical Exam verification unless PE is the governing issue.');
    }
    if (criterion.id === 'doc-te' && criterion.verdict === 'NOT_MET' && needsMessage && isLiteralTeWordingFailure(criterion) && safeRouting && !workflowFailure && !requiredDetailsMissing) {
      applyRepair(criterion, CALL_QA_FAIRNESS_RULES.naturalMessageRoutingWording,
        'Fairness repair: accepted natural patient-facing message/routing wording; exact TE/Telephone Encounter phrase is not required.');
    }
  }
  return {
    criteria,
    autoFails: validated.autoFails,
    repairs,
    reviewReasons: routingPolicy?.reviewOnly ? ['routing-policy-review-only'] : [],
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
  const findings = [];
  const signals = getRefillWorkflowSignals(transcript, context);
  const policy = routingPolicyFor(context);
  const metRoutingCriteria = (Array.isArray(criteria) ? criteria : [])
    .filter((criterion) => REPAIRABLE_CRITERIA.has(criterion.id) && criterion.verdict === 'MET')
    .map((criterion) => criterion.id);

  const decision = signals.routingDecision;
  if (policy && !policy.reviewOnly && !decision.acceptable && metRoutingCriteria.length > 0) {
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
export function scoreQa(verdicts, autoFails, transcript) {
  const defs = new Map(rubricCriteria().map((c) => [c.id, c]));

  const criteria = verdicts.map((v) => {
    const def = defs.get(v.id);
    // Preserve the raw validated model judgment untouched, so trust-gate and
    // repair changes never erase what the grader actually said.
    const modelJudgment = { verdict: v.verdict, basis: v.basis, evidence: v.evidence, note: v.note };
    let verdict = v.verdict;
    let basis = v.basis;
    let unverified = false;
    let unresolved = false;
    let unresolvedReason = null;

    if (verdict === 'MET' && !verifyNavigatorEvidence(transcript, v.evidence)) {
      // A MET whose quote can't be verified in a navigator turn loses the credit.
      verdict = 'NOT_MET';
      basis = 'ABSENCE';
      unverified = true;
    } else if (verdict === 'NOT_MET' && basis === 'EVIDENCE'
      && !verifyNavigatorEvidence(transcript, v.evidence)) {
      // An evidence-based negative whose offending quote can't be verified in a
      // navigator turn is NOT fully trustworthy. It stays provisionally NOT_MET
      // for scoring (never becomes MET), but is marked unresolved so the review
      // layer forces supervisor review and the UI never calls it "observed".
      unresolved = true;
      unresolvedReason = 'negative-evidence-not-verified';
    }
    if (verdict === 'NA' && def.core) { verdict = 'NOT_MET'; basis = 'ABSENCE'; }

    return {
      id: def.id, text: def.text, points: def.points,
      categoryId: def.categoryId, categoryName: def.categoryName,
      verdict, basis, evidence: v.evidence, note: v.note,
      unverified, unresolved, unresolvedReason,
      modelJudgment,
    };
  });

  const categories = QA_RUBRIC.map((cat) => {
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

  const withText = (a) => ({ ...a, text: QA_AUTO_FAILS.find((d) => d.id === a.id)?.text ?? a.id });
  const verifiedAutoFails = [];
  const unverifiedAutoFails = [];
  for (const a of autoFails) {
    // An auto-fail is a navigator behavior: only a navigator turn can verify it.
    (verifyNavigatorEvidence(transcript, a.evidence) ? verifiedAutoFails : unverifiedAutoFails).push(withText(a));
  }

  const autoFailed = verifiedAutoFails.length > 0;
  const score = autoFailed ? 0 : rawScore;
  const pass = !autoFailed && score >= QA_PASS_THRESHOLD;

  return {
    score, rawScore, pass, passThreshold: QA_PASS_THRESHOLD, categories, criteria,
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
export const SAFETY_CRITICAL_CRITERIA = new Set([
  'verify-three', 'verify-before-access', 'know-rule', 'doc-te',
]);

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
export function assessQa(qa, transcript, { correctedTurns = 0, repairs = [], deterministicFindings = [] } = {}) {
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
  // the quote does not hold up. They stay provisionally NOT_MET but must not be
  // presented as definitively observed, and they force supervisor review.
  const unresolvedNegatives = qa.criteria.filter((c) => c.unresolved);
  if (unresolvedNegatives.length > 0) {
    flags.push({
      id: 'unresolved-negative-evidence',
      label: 'Negative finding could not be verified',
      detail: `The grader reported ${unresolvedNegatives.length} negative finding(s) as observed (${unresolvedNegatives.map((c) => c.id).join(', ')}) but the quoted navigator evidence did not verify. Confirm against the transcript before treating them as observed behaviors.`,
    });
  }
  const unresolvedSafety = unresolvedNegatives.filter((c) => SAFETY_CRITICAL_CRITERIA.has(c.id));

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
    .filter((c) => c.verdict === 'NOT_MET' && SAFETY_CRITICAL_CRITERIA.has(c.id));
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
  const defs = new Map(rubricCriteria().map((c) => [c.id, c]));
  const repairedPoints = repairs
    .filter((r) => r.to === 'MET' && r.from === 'NOT_MET')
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

  // Only quote evidence that actually verified: never present an unverified MET
  // or an unresolved (unverifiable) negative quote as if it were observed.
  const quote = (c) => (c.evidence && !c.unverified && !c.unresolved ? ` — "${c.evidence}"` : '');
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
