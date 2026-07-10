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
  VERDICTS,
  rubricCriteria,
} from '../src/data/qaRubric.js';

export { QA_RUBRIC, QA_AUTO_FAILS, QA_PASS_THRESHOLD, VERDICTS, rubricCriteria };

// ── Evidence verification ────────────────────────────────────────────────────

function normalizeForMatch(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the quoted evidence actually appears in the transcript.
 *
 * The model is told to quote one contiguous line, but in practice it sometimes
 * stitches lines from several turns (or lightly paraphrases one line while
 * quoting the next verbatim) — so the quote is split into fragments on
 * newlines, ellipses, adjacent quote marks, and sentence boundaries (role
 * labels stripped), and the evidence stands if ANY substantive fragment
 * (2+ words) is really in the call: one genuine quoted sentence is proof of
 * the behavior; the gate exists to kill fully-hallucinated evidence, not to
 * punish quoting format.
 *
 * Per fragment: normalized substring of the full call text, with a fallback for
 * 4+ word fragments where every word appears within one single turn (tolerates
 * reordered stitching like "I'm" → "I am").
 * @param {{role:string, text:string}[]} transcript
 * @param {string} quote
 */
export function verifyEvidence(transcript, quote) {
  const fragments = String(quote ?? '')
    .split(/\r?\n|\.{3}|…|["”]\s*["“]|(?<=[.!?])\s+/)
    .map((f) => f.replace(/^\s*["'“”]*\s*(navigator|caller|patient)\s*:\s*/i, ''))
    .map(normalizeForMatch)
    .filter((f) => f.split(' ').filter(Boolean).length >= 2);
  if (fragments.length === 0) return false;
  const full = normalizeForMatch(transcript.map((t) => t.text).join(' '));
  return fragments.some((q) => {
    if (full.includes(q)) return true;
    const words = q.split(' ');
    if (words.length < 4) return false;
    return transcript.some((t) => {
      const turn = ` ${normalizeForMatch(t.text)} `;
      return words.every((w) => turn.includes(` ${w} `));
    });
  });
}

// ── Response validation (model output → trusted verdicts) ───────────────────

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
    byId.set(c.id, {
      id: c.id,
      verdict,
      evidence: typeof c.evidence === 'string' ? c.evidence : '',
      note: typeof c.note === 'string' ? c.note : '',
    });
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
  ['peds-referral', /\b(?:anisa azeez|pediatrics?\s+referral\s+(?:specialist|coordinator)|referral\s+(?:specialist|coordinator))\b/i],
  ['ob-pss', /\b(?:pss(?:\s+ob)?(?:\s+queue)?|patient scheduling services(?:\s+queue)?|ob(?:\s*\/\s*gyn)?\s+(?:scheduling|pss)\s+queue)\b/i],
  ['ob-prevention', /\b(?:prevention|preventive)\s+coordinator\b/i],
  ['ob-mfm', /\b(?:mfm|maternal[ -]fetal medicine)\s+(?:nurse|coordinator|team)\b/i],
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
    referral: { allowed: ['peds-referral'], messageRepair: true },
    records_forms: { allowed: [], reviewOnly: true },
    urgent_symptom_boundary: { allowed: [], reviewOnly: true },
    wrong_department_unclear_request: { allowed: [], reviewOnly: true },
  },
  obgyn: {
    new_gyn_visit: { allowed: ['ob-pss'] },
    pregnancy_related_visit: { allowed: ['ob-pss'] },
    test_result_medical_advice_boundary: { allowed: ['ob-nursing'], messageRepair: true },
    prescription_refill: { allowed: ['ob-nursing'], messageRepair: true },
    mfm_related_request: { allowed: ['ob-mfm'] },
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
// An offer is not a commitment: "do you want me to send it?" leaves the action
// undecided, so it can never stand as routing evidence.
const ROUTING_OFFER = /\b(?:do you want|would you like|should i|want me to|if you(?:['’]d)? (?:like|want|prefer))\b/i;
const OTHER_WORKFLOW_FAILURE = /wrong (queue|destination)|promis|missing (medication|pharmacy)|failed to.*(medication|pharmacy)|did not.*(medication|pharmacy)|no (medication|pharmacy|routing)|clinical advice/i;
// Grader-note vocabulary that signals a NON-PE failure is mixed into a know-rule
// verdict (wrong routing, identity, scheduling, promising, advice, missing refill
// details...). A note containing any of these is never "PE-only", so the refill
// PE repair stays off — the grader may have had a second, real reason to fail.
const NON_PE_FAILURE_NOTE = /wrong|incorrect|instead of|\brout(?:e|ed|es|ing)\b|queue|escalat|transfer(?:red)?|identity|identifier|hipaa|privacy|schedul|promis|guarantee|advi[cs]|dos(?:e|age|ing)|medication name|which pharmacy|preferred pharmacy|callback|conflat|lab result|interpret/i;
// Grader-note vocabulary that says the routing step was WRONG (not merely worded
// naturally / absent-in-literal-terms). A wrongness note is a substantive verdict
// and must never be repaired away.
const ROUTING_WRONGNESS_NOTE = /wrong|incorrect|instead of|should (?:have|be)|belongs (?:to|in)|mis-?rout/i;

export function routingPolicyFor({ department = '', metadata = {} } = {}) {
  return ROUTING_POLICIES[department]?.[metadata?.workflowType] ?? null;
}

export function routingDestinationsForLine(line) {
  const text = String(line?.text ?? line ?? '');
  const specific = ROUTING_DESTINATIONS
    .filter(([, pattern, generic]) => !generic && pattern.test(text))
    .map(([id]) => id);
  return specific.length
    ? [...new Set(specific)]
    : [...new Set(ROUTING_DESTINATIONS.filter(([, pattern, generic]) => generic && pattern.test(text)).map(([id]) => id))];
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

export function hasRoutingCommitment(line) {
  const text = String(line?.text ?? line ?? '');
  if (isRoutingQuestionOrHypothetical(text)) return false;
  return NAVIGATOR_ROUTING_COMMITMENT_PATTERNS.some((pattern) => pattern.test(text))
    || COMMITTED_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(text));
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

  const commitments = navigatorLines(transcript)
    .map((line) => ({
      line: line.text,
      destinations: routingDestinationsForLine(line),
      correction: ROUTING_CORRECTION.test(line.text),
    }))
    .filter((entry) => hasRoutingCommitment(entry.line));
  if (!commitments.length) {
    return { acceptable: false, reason: 'no-routing-commitment', line: null, destinationId: null };
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

function isSafeNonPromise(line) {
  return /can(?:not|['’]t) (?:promise|guarantee)|not able to guarantee|no guarantee/i.test(String(line?.text ?? line ?? ''));
}

// "I can't say whether that's safe — that's a question for the nurse" is scope
// discipline, not clinical advice; don't let it block a repair.
function isScopeDeferral(line) {
  return /can(?:not|['’]t) (?:say|advise|tell|speak to)|not able to (?:say|advise|tell)|not (?:qualified|allowed) to|that(?:['’]s| is) (?:a question |really )?for the (?:nurse|provider|doctor)|only the (?:nurse|provider|doctor) can/i.test(String(line?.text ?? line ?? ''));
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
  return {
    medication: matches([/medication name/i, /prescription name/i, /what medication/i, /which medicine/i, /name of the medicine/i, /allergy medicine/i, /refill.*for/i]),
    pharmacy: matches([/preferred pharmacy/i, /which pharmacy/i, /what pharmacy/i, /pharmacy.*send/i, /send.*pharmacy/i]),
    callback: matches([/callback/i, /call back/i, /best number/i, /phone number/i, /reach you/i]),
    outOrUrgency: matches([/completely out/i, /out of (the )?medication/i, /out of (her|his|their) medicine/i, /any left/i, /how many.*left/i, /mark.*urgent/i, /high priority/i, /priority/i]),
    naturalRoutingLine: findNaturalRoutingActionLine(transcript),
    committedRoutingLine: routingDecision.acceptable ? routingDecision.line : null,
    routingDecision,
    overPromise: lines.some((line) => !isSafeNonPromise(line) && lineMatchesAny(line, [/will be approved/i, /guarantee.*(approved|sent|today)/i, /definitely (?:will )?(?:be )?(?:approved|approve|sent|filled|ready|done|today)/i, /will definitely/i, /make sure.*approv/i, /make sure.*sent today/i, /doctor.*approv/i, /provider.*approv/i, /gets approved today/i, /approved today/i, /sent today/i])),
    clinicalAdvice: lines.some((line) => !isScopeDeferral(line) && lineMatchesAny(line, [/give (her|him|them).*dose/i, /take .* twice/i, /increase/i, /decrease/i, /stop taking/i, /safe to/i, /not serious/i, /you should take/i, /medical advice/i])),
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
  const peOnly = (criterion) => /\bpe\b|physical exam|physical status|up to date|\butd\b|not current/i.test(`${criterion.note} ${criterion.evidence}`)
    && !OTHER_WORKFLOW_FAILURE.test(`${criterion.note} ${criterion.evidence}`)
    && !NON_PE_FAILURE_NOTE.test(criterion.note);
  const needsMessage = routingPolicy?.messageRepair === true;
  // Only an absence-style / literal-TE-wording complaint is repairable. A note
  // that says the routing was WRONG is a substantive verdict and always stands.
  const literalTeFailure = (criterion) => /telephone encounter|\bte\b|does not contain evidence|did not say|not documented|no evidence.*rout|no evidence.*log/i.test(`${criterion.note} ${criterion.evidence}`)
    && !ROUTING_WRONGNESS_NOTE.test(criterion.note);

  const applyRepair = (criterion, rule, reason) => {
    repairs.push({
      criterionId: criterion.id, rule, from: criterion.verdict, to: 'MET', reason,
      evidence: signals.committedRoutingLine,
      originalVerdict: criterion.verdict, originalNote: criterion.note, originalEvidence: criterion.evidence,
    });
    criterion.verdict = 'MET'; criterion.evidence = signals.committedRoutingLine; criterion.note = reason;
  };

  for (const criterion of criteria) {
    if (criterion.id === 'know-rule' && standardRefill && criterion.verdict === 'NOT_MET' && peOnly(criterion) && signals.medication && signals.pharmacy && safeRouting) {
      applyRepair(criterion, CALL_QA_FAIRNESS_RULES.standardRefillNoPeRequirement,
        'Fairness repair: standard pediatric refill does not require caller-facing PE/Physical Exam verification unless PE is the governing issue.');
    }
    if (criterion.id === 'doc-te' && criterion.verdict === 'NOT_MET' && needsMessage && literalTeFailure(criterion) && safeRouting && !workflowFailure && !requiredDetailsMissing) {
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
    let verdict = v.verdict;
    let unverified = false;
    if (verdict === 'MET' && !verifyEvidence(transcript, v.evidence)) {
      verdict = 'NOT_MET';
      unverified = true;
    }
    if (verdict === 'NA' && def.core) verdict = 'NOT_MET';
    return {
      id: def.id, text: def.text, points: def.points,
      categoryId: def.categoryId, categoryName: def.categoryName,
      verdict, evidence: v.evidence, note: v.note, unverified,
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
    (verifyEvidence(transcript, a.evidence) ? verifiedAutoFails : unverifiedAutoFails).push(withText(a));
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
export function assessQa(qa, transcript, { correctedTurns = 0, repairs = [] } = {}) {
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

  const confidenceHits = flags.filter((f) =>
    ['low-transcript-confidence', 'unverified-evidence', 'possible-unsafe-behavior', 'thin-coverage'].includes(f.id)).length;
  const confidence = confidenceHits >= 2 ? 'low' : confidenceHits === 1 ? 'medium' : 'high';

  const safetyRisk = qa.autoFails.length > 0 || qa.unverifiedAutoFails?.length > 0
    ? 'critical'
    : safetyMissed.length > 0 ? 'elevated' : 'none';

  let recommendation;
  if (qa.autoFails.length > 0) recommendation = 'fail';
  else if (confidence === 'low' || borderline || qa.unverifiedAutoFails?.length > 0) recommendation = 'needs_review';
  else if (qa.pass && safetyMissed.length > 0) recommendation = 'needs_review'; // never an unreviewed pass over a safety miss
  else if (repairFlippedOutcome) recommendation = 'needs_review'; // repairs are decision support, not the final word
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

  const quote = (c) => (c.evidence && !c.unverified ? ` — "${c.evidence}"` : '');
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
