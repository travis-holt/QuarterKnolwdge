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

// A criterion is `core` when it applies to EVERY call (greeting, verification,
// tone, closing…). Only scenario-dependent criteria (scheduling, documentation
// specifics) may legitimately come back NA.
export const QA_RUBRIC = [
  {
    id: 'opening', name: 'Opening', criteria: [
      { id: 'open-greet', points: 4, core: true,
        text: 'Opened with a pleasant, professional greeting.' },
      { id: 'open-name', points: 3, core: true,
        text: 'Stated their own first name during the greeting.' },
      { id: 'open-org', points: 3, core: true,
        text: 'Identified the organization (Aizer Health) during the greeting.' },
    ],
  },
  {
    id: 'verification', name: 'Verification', criteria: [
      { id: 'verify-three', points: 6, core: true,
        text: 'Collected three (3) identifiers — first name, last name, and DOB (or home address / phone number) — before discussing any account or chart specifics.' },
      { id: 'verify-before-access', points: 4, core: true,
        text: 'Completed identity verification BEFORE sharing or confirming any account, appointment, or chart detail.' },
    ],
  },
  {
    id: 'callControl', name: 'Call Control', criteria: [
      { id: 'control-narrate', points: 5, core: true,
        text: 'Narrated system actions or explained waits before them ("I\'m pulling up the schedule now…"), and explained why before any hold.' },
      { id: 'control-guide', points: 5, core: true,
        text: 'Kept the call moving toward a resolution with purposeful questions — did not drift, stall, or leave the caller directing the call.' },
    ],
  },
  {
    id: 'docReason', name: 'Documentation Reason', criteria: [
      { id: 'doc-reason', points: 6, core: false,
        text: 'Stated or confirmed an accurate, specific visit/documentation reason matching SOP conventions (e.g., "Shots PE UTD", "GS" for Good Samaritan newborns).' },
      { id: 'doc-te', points: 4, core: false,
        text: 'Routed or logged a Telephone Encounter to the correct queue or contact when the scenario called for one (per the escalation matrix).' },
    ],
  },
  {
    id: 'communication', name: 'Communication', criteria: [
      { id: 'comm-plain', points: 5, core: true,
        text: 'Used simple, jargon-free language the caller could follow.' },
      { id: 'comm-professional', points: 5, core: true,
        text: 'Was courteous and professional in every turn.' },
      { id: 'comm-empathy', points: 5, core: true,
        text: 'Responded warmly and empathetically where the caller expressed worry, frustration, or urgency.' },
    ],
  },
  {
    id: 'activeListening', name: 'Active Listening', criteria: [
      { id: 'listen-ack', points: 5, core: true,
        text: 'Explicitly acknowledged the caller\'s concern ("I understand…", "I hear you…").' },
      { id: 'listen-gather', points: 5, core: true,
        text: 'Gathered the needed information before answering — no assumptions or premature answers.' },
    ],
  },
  {
    id: 'knowledge', name: 'Knowledge', criteria: [
      { id: 'know-rule', points: 9, core: true,
        text: 'Applied the correct SOP rule for this scenario (PE frequency, newborn scheduling, provider constraints, escalation-matrix routing, queue selection…).' },
      { id: 'know-details', points: 6, core: false,
        text: 'Every concrete detail given (facility, address, provider, process step) was accurate per the SOP — nothing invented.' },
    ],
  },
  {
    id: 'scheduling', name: 'Appointment Scheduling', criteria: [
      { id: 'sched-flow', points: 8, core: false,
        text: 'Reached the correct scheduling outcome — right provider, visit type, and location for the request.' },
      { id: 'sched-recap', points: 7, core: false,
        text: 'Recapped the appointment date, time, and place, and gave arrival instructions.' },
    ],
  },
  {
    id: 'closing', name: 'Closing', criteria: [
      { id: 'close-survey', points: 3, core: true,
        text: 'Prompted the caller to stay on the line for the survey before the call ended.' },
      { id: 'close-anything-thanks', points: 2, core: true,
        text: 'Closed the call courteously — offered further help and/or exchanged thanks and a goodbye. A natural, mutual close counts; exact scripted wording is not required.' },
    ],
  },
];

// Critical -100 deductions. An auto-fail zeroes the test regardless of the
// rubric score — but ONLY when the model can quote the offending transcript
// line and that quote verifies. A hallucinated auto-fail must never fail a real
// person's test.
export const QA_AUTO_FAILS = [
  { id: 'af-hipaa',
    text: 'Disclosed Protected Health Information or discussed account/chart details WITHOUT first completing 3-point identity verification.' },
  { id: 'af-scope',
    text: 'Read lab/imaging results to the caller or gave clinical/medication advice, instead of transferring to nursing.' },
  { id: 'af-conduct',
    text: 'Used profanity or sarcasm toward the caller.' },
];

export const QA_PASS_THRESHOLD = 85;

export const VERDICTS = new Set(['MET', 'NOT_MET', 'NA']);

// Flat list of all criteria with their category attached.
export function rubricCriteria() {
  return QA_RUBRIC.flatMap((cat) =>
    cat.criteria.map((c) => ({ ...c, categoryId: cat.id, categoryName: cat.name })));
}

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
export function assessQa(qa, transcript, { correctedTurns = 0 } = {}) {
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
