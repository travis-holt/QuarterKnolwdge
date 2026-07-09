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

const REFILL_ROUTING = [/send (the|this|that|your)? ?(request|message|note)/i, /send .* (over|to)/i, /route .* (to|over)/i, /put .* (note|message)/i, /forward .* (request|message)/i, /pass .* (along|to)/i, /clinical team/i, /refill team/i, /nurse/i, /provider/i, /peds encounters/i, /pediatrics encounters/i, /team .* follow up/i];
const OTHER_WORKFLOW_FAILURE = /wrong (queue|destination)|promis|missing (medication|pharmacy)|failed to.*(medication|pharmacy)|did not.*(medication|pharmacy)|no (medication|pharmacy|routing)|clinical advice/i;

export function isStandardPediatricRefill({ scenario = '', department = 'pediatrics', metadata = {} } = {}) {
  const text = normalizeQaText(scenario);
  if (department !== 'pediatrics' || /referral|shots|immunization|vaccine|specialty|school form|pe scheduling|physical exam.*governing|pe status.*governing/.test(text)) return false;
  return metadata.workflowType === 'prescription_refill' || String(metadata.qaScenarioId ?? '').toLowerCase().includes('refill') || /standard pediatric medication refill|standard prescription refill/.test(text) || (text.includes('medication refill') && !/referral|shots|immunization|vaccine|specialty eligibility/.test(text));
}

export function getRefillWorkflowSignals(transcript) {
  const lines = navigatorLines(transcript);
  const matches = (regexes) => lines.some((line) => lineMatchesAny(line, regexes));
  return {
    medication: matches([/medication name/i, /prescription name/i, /what medication/i, /which medicine/i, /name of the medicine/i, /allergy medicine/i, /refill.*for/i]),
    pharmacy: matches([/preferred pharmacy/i, /which pharmacy/i, /what pharmacy/i, /pharmacy.*send/i, /send.*pharmacy/i]),
    callback: matches([/callback/i, /call back/i, /best number/i, /phone number/i, /reach you/i]),
    outOrUrgency: matches([/completely out/i, /out of (the )?medication/i, /out of (her|his|their) medicine/i, /any left/i, /how many.*left/i, /mark.*urgent/i, /high priority/i, /priority/i]),
    naturalRoutingLine: findBestNavigatorLine(transcript, REFILL_ROUTING),
    overPromise: matches([/will be approved/i, /guarantee/i, /definitely/i, /will be sent today/i, /doctor will send/i, /provider will approve/i, /i.?ll make sure.*approved/i]),
    clinicalAdvice: matches([/give (her|him|them).*dose/i, /take .* twice/i, /increase/i, /decrease/i, /stop taking/i, /safe to/i, /not serious/i, /you should take/i, /medical advice/i]),
    wrongDestination: matches([/referral coordinator/i, /school\/?forms team/i, /records team/i, /scheduling only/i, /front desk only/i, /specialist referral/i, /ob portal/i, /pss ob/i]),
  };
}

export function repairQaVerdictsForScenario(validated, transcript, context = {}) {
  const criteria = validated.criteria.map((criterion) => ({ ...criterion }));
  const repairs = [];
  const signals = getRefillWorkflowSignals(transcript);
  const standardRefill = isStandardPediatricRefill(context);
  const requiredDetailsMissing = standardRefill && (!signals.medication || !signals.pharmacy);
  const workflowFailure = criteria.some((criterion) => criterion.id !== 'doc-te' && criterion.verdict === 'NOT_MET' && OTHER_WORKFLOW_FAILURE.test(`${criterion.note} ${criterion.evidence}`));
  const safeRouting = signals.naturalRoutingLine && !signals.overPromise && !signals.clinicalAdvice && !signals.wrongDestination;
  const peOnly = (criterion) => /\bpe\b|physical exam|physical status|up to date|\butd\b|not current/i.test(`${criterion.note} ${criterion.evidence}`) && !OTHER_WORKFLOW_FAILURE.test(`${criterion.note} ${criterion.evidence}`);
  const needsMessage = ['prescription_refill', 'referral', 'records_forms', 'urgent_symptom_boundary', 'wrong_department_unclear_request'].includes(context.metadata?.workflowType) || /refill|referral|lab result|medical question|form|record|message|route|request|nurse|provider|clinical team/i.test(context.scenario ?? '');
  const literalTeFailure = (criterion) => /telephone encounter|\bte\b|does not contain evidence|did not say|not documented|no evidence.*rout|no evidence.*log/i.test(`${criterion.note} ${criterion.evidence}`);

  for (const criterion of criteria) {
    if (criterion.id === 'know-rule' && standardRefill && criterion.verdict === 'NOT_MET' && peOnly(criterion) && signals.medication && signals.pharmacy && safeRouting) {
      const reason = 'Fairness repair: standard pediatric refill does not require caller-facing PE/Physical Exam verification unless PE is the governing issue.';
      criterion.verdict = 'MET'; criterion.evidence = signals.naturalRoutingLine; criterion.note = reason;
      repairs.push({ criterionId: criterion.id, rule: CALL_QA_FAIRNESS_RULES.standardRefillNoPeRequirement, from: 'NOT_MET', to: 'MET', reason, evidence: criterion.evidence });
    }
    if (criterion.id === 'doc-te' && criterion.verdict === 'NOT_MET' && needsMessage && literalTeFailure(criterion) && safeRouting && !workflowFailure && !requiredDetailsMissing) {
      const reason = 'Fairness repair: accepted natural patient-facing message/routing wording; exact TE/Telephone Encounter phrase is not required.';
      criterion.verdict = 'MET'; criterion.evidence = signals.naturalRoutingLine; criterion.note = reason;
      repairs.push({ criterionId: criterion.id, rule: CALL_QA_FAIRNESS_RULES.naturalMessageRoutingWording, from: 'NOT_MET', to: 'MET', reason, evidence: criterion.evidence });
    }
  }
  return { criteria, autoFails: validated.autoFails, repairs };
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
