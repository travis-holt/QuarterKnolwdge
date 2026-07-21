// ─────────────────────────────────────────────────────────────────────────────
// SCORING + MATRIX READ-OFFS
//
// Two scoring axes, both derived from the same answers:
//   • per-DOMAIN  (topic: routing, scheduling, …)          — scorePerDomain
//   • per-COMPETENCY (capability: critical thinking, …)    — scorePerCompetency
// Each option carries a `points` value (0–100 = quality of that choice), so an
// answer earns partial credit, not just right/wrong.
//
// ONE OFFICIAL STATUS PER NAVIGATOR PER DEPARTMENT.
// Each department assessment produces exactly one official capability status,
// calculated from the arithmetic mean of all six domain scores
// (`overallScore` / `overallLevel` / `overallStatus`). The six domain
// percentages remain visible as DIAGNOSTIC evidence — they drive targeted
// training, coaching, trends, critical-gap alerts, question-health evidence and
// mentor qualification, but they are never presented as six official navigator
// classifications. Bands come from THRESHOLDS in data/config.js.
// ─────────────────────────────────────────────────────────────────────────────

import { THRESHOLDS, COMPETENCY_THRESHOLDS, LEVELS, LEVEL_ORDER, INCOMPLETE_LABEL, UNASSESSED_LABEL, COLUMN_GAP_THRESHOLD, TRAINING_RULES, REQUIRED_TRAINING_PRIORITIES, TREND_SYNTH_POINTS, MENTOR_MAX_LOAD, INTERVIEW_SCORE_BANDS } from '../data/config.js';
import { DOMAINS, SEED_QUESTIONS } from '../data/questions.js';
import { COMPETENCIES } from '../data/competencies.js';
import { moduleForDomain } from '../data/training.js';
import { DEPARTMENTS } from '../data/departments.js';
import { compareTimestampValues, timestampMillis } from './time.js';

/** The configured domain ids, for fast membership checks. */
const DOMAIN_IDS = new Set(DOMAINS.map((d) => d.id));

function sameNavigator(record, row) {
  if (record?.navigatorId && row?.navigatorId) return record.navigatorId === row.navigatorId;
  return record?.name === row?.name;
}

export function effectiveInterviewScore(interview) {
  const score = interview?.gradeOverride?.score ?? interview?.grade?.score;
  return Number.isFinite(score) ? score : null;
}

const assessmentTypeOf = (item) => item?.assessmentType ?? 'mcq';

/**
 * Points earned for one question given the chosen option — THE canonical
 * per-option scoring rule (exported so components and API handlers never
 * re-derive it inline). Uses the option's `points` (partial credit) when
 * present; falls back to a binary 100/0 against `correctOptionId` for
 * legacy/ungraded options. An absent or invalid choice earns 0.
 * @param {object} question
 * @param {string|undefined} optionId - chosen optionId
 * @returns {number} 0–100
 */
export function optionPoints(question, optionId) {
  const opt = question.options?.find((o) => o.id === optionId);
  if (!opt) return 0;
  if (typeof opt.points === 'number') return opt.points;
  return optionId === question.correctOptionId ? 100 : 0;
}

const earnedPoints = (answer, question) => optionPoints(question, answer);

/**
 * Is this a usable, scoreable assessment question?
 * A question with no options, or with no domain we recognise, cannot contribute
 * a score and must not count as coverage for its domain.
 */
export function isScoreableQuestion(question) {
  if (!question || typeof question !== 'object') return false;
  if (!DOMAIN_IDS.has(question.domainId)) return false;
  return Array.isArray(question.options) && question.options.length > 0;
}

/**
 * THE canonical assessment-bank coverage check.
 *
 * An MCQ assessment may only start (and may only be saved) when the active bank
 * carries at least one scoreable question for EVERY configured domain. A domain
 * with no questions cannot be measured, and measuring nothing must never be
 * recorded as a score of 0 — that would fabricate a Critical result out of a
 * supervisor's incomplete bank, not the navigator's performance.
 *
 * @param {object[]} questions - the active question bank
 * @returns {{ complete: boolean, covered: string[], missing: string[],
 *             countsByDomain: Record<string, number>, scoreable: number, total: number }}
 */
export function assessmentBankCoverage(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const countsByDomain = Object.fromEntries(DOMAINS.map((d) => [d.id, 0]));
  let scoreable = 0;
  for (const q of list) {
    if (!isScoreableQuestion(q)) continue;
    countsByDomain[q.domainId] += 1;
    scoreable += 1;
  }
  const missing = DOMAINS.filter((d) => countsByDomain[d.id] === 0).map((d) => d.id);
  return {
    complete: missing.length === 0,
    covered: DOMAINS.filter((d) => countsByDomain[d.id] > 0).map((d) => d.id),
    missing,
    countsByDomain,
    scoreable,
    total: list.length,
  };
}

/** Convenience predicate: does this bank cover all six configured domains? */
export function isAssessmentBankComplete(questions) {
  return assessmentBankCoverage(questions).complete;
}

/**
 * Thrown before scoring when a bank cannot produce a complete official profile.
 * Carries the missing domain ids so callers can name them to the supervisor.
 */
export class IncompleteAssessmentBankError extends Error {
  constructor(missing) {
    super(`Assessment bank is missing questions for: ${missing.join(', ')}`);
    this.name = 'IncompleteAssessmentBankError';
    this.missing = missing;
  }
}

/**
 * Score a set of answers into a per-domain map (0–100), averaging earned points
 * across each domain's questions.
 *
 * MISSING BANK COVERAGE IS NOT A ZERO. A domain with no scoreable questions in
 * the bank returns **null** ("this domain had nothing to answer"), never 0.
 * A domain that DID have questions and earned nothing still returns a genuine
 * numeric `0`, which correctly drives Critical behaviour downstream.
 *
 * Callers persisting an official result should validate with
 * `assessmentBankCoverage()` first (or pass `{ strict: true }` to get an
 * `IncompleteAssessmentBankError` instead of a profile with null holes).
 *
 * @param {Record<string,string>} answers - questionId -> chosen optionId
 * @param {object[]} [questions] - the active question bank (defaults to the seed)
 * @param {{ strict?: boolean }} [opts]
 * @returns {Record<string, number|null>} domainId -> score (0–100) or null
 */
export function scorePerDomain(answers = {}, questions = SEED_QUESTIONS, { strict = false } = {}) {
  const tally = {}; // domainId -> { earned, total }
  for (const domain of DOMAINS) {
    tally[domain.id] = { earned: 0, total: 0 };
  }

  for (const q of questions) {
    if (!isScoreableQuestion(q)) continue;
    const bucket = tally[q.domainId];
    bucket.total += 1;
    bucket.earned += earnedPoints(answers[q.id], q);
  }

  if (strict) {
    const missing = DOMAINS.filter((d) => tally[d.id].total === 0).map((d) => d.id);
    if (missing.length > 0) throw new IncompleteAssessmentBankError(missing);
  }

  const scores = {};
  for (const domain of DOMAINS) {
    const { earned, total } = tally[domain.id];
    // null = the bank had nothing to measure here. 0 = measured and earned zero.
    scores[domain.id] = total === 0 ? null : Math.round(earned / total);
  }
  return scores;
}

/**
 * Score a set of answers into a per-competency map (0–100), averaging earned
 * points across each competency's tagged SCOREABLE questions.
 *
 * `null` means "no measurable evidence": the competency had no tagged questions
 * in the active bank, or every question tagged to it was unscoreable (no
 * options / unknown domain). A genuine `0` means the competency WAS measured
 * and the navigator earned nothing — including when they left a valid question
 * unanswered or picked an option worth zero points.
 *
 * @param {Record<string,string>} answers
 * @param {object[]} [questions] - the active question bank (defaults to the seed)
 * @returns {Record<string,number|null>} competencyId -> score (0–100) or null
 */
export function scorePerCompetency(answers = {}, questions = SEED_QUESTIONS) {
  const tally = {}; // competencyId -> { earned, total }
  for (const c of COMPETENCIES) {
    tally[c.id] = { earned: 0, total: 0 };
  }

  for (const q of questions) {
    // Same scoreability rule as scorePerDomain: a question with no options (or
    // an unknown domain) measured NOTHING, so it must not contribute a zero to
    // its tagged competencies. Counting it would drag a competency's average
    // down for evidence that never existed.
    if (!isScoreableQuestion(q)) continue;
    const earned = earnedPoints(answers[q.id], q);
    for (const cid of q.competencies ?? []) {
      const bucket = tally[cid];
      if (!bucket) continue; // ignore unknown/typo competency tags
      bucket.total += 1;
      bucket.earned += earned;
    }
  }

  const scores = {};
  for (const c of COMPETENCIES) {
    const { earned, total } = tally[c.id];
    scores[c.id] = total === 0 ? null : Math.round(earned / total);
  }
  return scores;
}

/**
 * THE canonical band mapping. Non-overlapping ranges:
 *   0–39 Critical · 40–64 Learning · 65–89 Solid · 90–100 Can-Teach
 *
 * Used for BOTH the official overall status and the diagnostic band of a single
 * domain score. Never re-derive these bands inline.
 * @param {number} pct
 * @returns {'critical'|'learning'|'solid'|'canTeach'}
 */
export function scoreToLevel(pct) {
  const score = Number.isFinite(pct) ? pct : 0;
  if (score < THRESHOLDS.critical) return 'critical';
  if (score < THRESHOLDS.solid) return 'learning';
  if (score < THRESHOLDS.canTeach) return 'solid';
  return 'canTeach';
}

/** Convenience: full level descriptor ({id,label,color,text,tint}) for a percentage. */
export function levelFor(pct) {
  return LEVELS[scoreToLevel(pct)];
}

/**
 * Diagnostic band for ONE domain percentage.
 *
 * MISSING EVIDENCE IS NOT A ZERO. A domain the navigator was never scored on
 * returns `null` (an explicit "unassessed" diagnostic state) — never `'critical'`.
 * Only a genuinely recorded number from 0 through 39 is a critical gap, so an
 * absent domain can never fabricate a gap, a training assignment, a column gap,
 * a distribution count, a learning signal, or an Action Center alert.
 *
 * @param {number} pct
 * @returns {'critical'|'learning'|'solid'|'canTeach'|null} null = unassessed
 */
export function domainBand(pct) {
  if (!Number.isFinite(pct)) return null;
  return scoreToLevel(pct);
}

/** True only for a RECORDED numeric domain score below 40. Missing ≠ critical. */
export function isCriticalDomainGap(pct) {
  return Number.isFinite(pct) && pct < THRESHOLDS.critical;
}

/** How many of the six domains carry a real numeric score. */
export function assessedDomainCount(scores) {
  return DOMAINS.filter((d) => Number.isFinite(scores?.[d.id])).length;
}

/** A profile is complete only when every one of the six domains has a numeric score. */
export function overallComplete(scores) {
  return DOMAINS.every((d) => Number.isFinite(scores?.[d.id]));
}

/**
 * THE canonical overall score for one department: the arithmetic mean of ALL
 * SIX configured domain scores, rounded only after the complete average.
 *
 * Returns **null unless all six domains are numeric**. A partial profile has no
 * official overall score — a one-domain `{ intake: 100 }` must never be reported
 * or averaged as "100% overall", because that would let thin evidence inflate a
 * navigator's status and the floor-wide KPIs. Use `partialAverage()` if a
 * surface genuinely needs the mean of the evidence that does exist; it is a
 * diagnostic number and is never an official score.
 *
 * Averages within a single department only, over the six configured domains,
 * and never mixes MCQ / Spot the Error / Call QA instruments — callers pass one
 * result's `scores` object.
 *
 * @param {Record<string, number>} scores
 * @returns {number|null}
 */
export function overallScore(scores) {
  if (!overallComplete(scores)) return null;
  const vals = DOMAINS.map((d) => scores[d.id]);
  return Math.round(vals.reduce((a, b) => a + b, 0) / DOMAINS.length);
}

/**
 * DIAGNOSTIC ONLY: the mean of the domains actually scored, for a profile that
 * is not yet complete. Never an official overall score, never fed into an
 * official KPI, and never rendered with a capability level.
 * @returns {number|null} null when no domain is scored
 */
export function partialAverage(scores) {
  const vals = DOMAINS.map((d) => scores?.[d.id]).filter((v) => Number.isFinite(v));
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/**
 * THE official capability level for one department.
 *
 * MISSING-DOMAIN SAFETY: an incomplete profile has **no official level at all**
 * — this returns null. `{ intake: 100 }` is Incomplete, not Can-Teach and not
 * Learning. Because of this, `overallLevel(scores) === 'canTeach'` already
 * implies a complete profile, so every downstream mentor / readiness /
 * question-health check inherits the safety without re-checking.
 *
 * @param {Record<string, number>} scores
 * @returns {'critical'|'learning'|'solid'|'canTeach'|null} null = no official status
 */
export function overallLevel(scores) {
  const score = overallScore(scores);
  return score == null ? null : scoreToLevel(score);
}

/**
 * The single official status object a supervisor sees, e.g. "72% Overall · Solid".
 *
 * Exactly one of these is true for any profile:
 *   • `unassessed` — no domain scored at all
 *   • `!complete`  — some but not all six scored → Incomplete, NO official level
 *   • `complete`   — all six scored → one official level
 *
 * @param {Record<string, number>} scores
 * @returns {{
 *   score: number|null, level: string|null, complete: boolean, unassessed: boolean,
 *   label: string, assessedDomains: number, totalDomains: number,
 *   partialAverage: number|null,
 * }}
 */
export function overallStatus(scores) {
  const assessedDomains = assessedDomainCount(scores);
  const complete = assessedDomains === DOMAINS.length;
  const unassessed = assessedDomains === 0;
  const score = complete ? overallScore(scores) : null;
  return {
    score,
    level: complete ? scoreToLevel(score) : null,
    complete,
    unassessed,
    label: unassessed ? UNASSESSED_LABEL : complete ? LEVELS[scoreToLevel(score)].label : INCOMPLETE_LABEL,
    assessedDomains,
    totalDomains: DOMAINS.length,
    // Diagnostic only — never an official score.
    partialAverage: complete ? null : partialAverage(scores),
  };
}

/** Rank helper: higher is stronger. No-official-status sorts below Critical. */
export function overallLevelRank(level) {
  const idx = LEVEL_ORDER.indexOf(level);
  return idx === -1 ? -1 : idx;
}

/**
 * COMPETENCY axis level — a SEPARATE scale from the official capability bands.
 *
 * The 2026-07-20 redesign re-banded the official department status only.
 * Competencies keep their original three-level thresholds
 * (`<60` Learning · `60–84` Solid · `85+` Can-Teach) from
 * `COMPETENCY_THRESHOLDS`, and have no Critical band.
 *
 * Do NOT substitute `scoreToLevel()` here: it would silently re-band every
 * competency rating and emit a `'critical'` id that the competency
 * distribution has no bucket for.
 *
 * @param {number} pct
 * @returns {'learning'|'solid'|'canTeach'|null} null = not scored
 */
export function competencyScoreToLevel(pct) {
  if (!Number.isFinite(pct)) return null;
  if (pct >= COMPETENCY_THRESHOLDS.canTeach) return 'canTeach';
  if (pct < COMPETENCY_THRESHOLDS.learning) return 'learning';
  return 'solid';
}

/**
 * Score a "Spot the Error" assessment run into a per-domain percentage (0–100).
 * Each item is graded purely on click accuracy: the navigator either identified
 * the flawed agent message on their one attempt (correct) or did not. The score
 * is the share of items found correctly, so it lands on the same 0–100 scale as
 * the main check and can feed the capability matrix domain score directly.
 * @param {(boolean | {correct:boolean})[]} picks - one entry per presented item
 * @returns {number} 0–100, rounded
 */
export function scoreSpotTheError(picks) {
  if (!Array.isArray(picks) || picks.length === 0) return 0;
  const correct = picks.filter((p) => (typeof p === 'boolean' ? p : p?.correct)).length;
  return Math.round((correct / picks.length) * 100);
}

/**
 * Score a multi-domain "Spot the Error" run into a per-domain percentage map.
 * Each graded item is `{ domainId, correct }`; a domain's score is the share of
 * its items found correctly (0–100). Domains with no items are omitted (callers
 * that need a complete profile fill the gaps themselves).
 * @param {{domainId:string, correct:boolean}[]} graded
 * @returns {Record<string, number>} domainId -> score (0–100, rounded)
 */
export function scoreSpotTheErrorByDomain(graded) {
  if (!Array.isArray(graded)) return {};
  const tally = {}; // domainId -> { correct, total }
  for (const g of graded) {
    if (!g || !g.domainId) continue;
    const bucket = tally[g.domainId] ?? (tally[g.domainId] = { correct: 0, total: 0 });
    bucket.total += 1;
    if (g.correct) bucket.correct += 1;
  }
  const scores = {};
  for (const [domainId, { correct, total }] of Object.entries(tally)) {
    scores[domainId] = total === 0 ? 0 : Math.round((correct / total) * 100);
  }
  return scores;
}

/**
 * A Call QA Test is one full-call quality score, not six separate domain items.
 * Until the QA rubric is domain-tagged, that score updates every domain equally.
 * @param {{score:number}|number} qa
 * @returns {Record<string, number>} domainId -> score
 */
export function scoreQaAcrossDomains(qa) {
  const score = typeof qa === 'number' ? qa : qa?.score;
  const pct = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  return Object.fromEntries(DOMAINS.map((d) => [d.id, pct]));
}

/**
 * Build the matrix rows from sample navigators + the optional live taker.
 *
 * The OFFICIAL fields are `overallScore` and `overallLevel` — one status per
 * navigator per department. `domainDevelopmentBands` holds the per-domain
 * DIAGNOSTIC bands used for tints and training assignment; it is deliberately
 * not called "levels" so no surface renders "Routing · Solid" as if it were an
 * official classification.
 *
 * `levels` is retained as a read-only backward-compatibility alias of
 * `domainDevelopmentBands` for legacy/third-party callers; first-party code
 * uses `domainDevelopmentBands`.
 *
 * @param {{name,scores,competencyScores?}[]} samples
 * @param {{name,scores,competencyScores?}|null} liveResult
 */
export function buildMatrixRows(samples, liveResult) {
  const toRow = (nav, isLive) => {
    const scores = nav.scores ?? {};
    const competencyScores = nav.competencyScores ?? {};
    const status = overallStatus(scores);
    // A domain the navigator was never scored on is `null` (unassessed), NOT a
    // zero and NOT 'critical'. Missing evidence never becomes a finding.
    const domainDevelopmentBands = Object.fromEntries(
      DOMAINS.map((d) => [d.id, domainBand(scores[d.id])])
    );
    return {
      navigatorId: nav.navigatorId ?? null,
      name: nav.name,
      isLive,
      assessmentType: nav.assessmentType ?? 'mcq',
      scores,
      // ── The one official status ───────────────────────────────────────
      overallScore: status.score,
      overallLevel: status.level,
      overallComplete: status.complete,
      overallUnassessed: status.unassessed,
      overallLabel: status.label,
      assessedDomains: status.assessedDomains,
      // Diagnostic only — never an official score, never fed to an official KPI.
      partialAverage: status.partialAverage,
      // ── Diagnostic evidence ───────────────────────────────────────────
      domainDevelopmentBands,
      levels: domainDevelopmentBands, // deprecated alias — see doc comment
      competencyScores,
      // Competencies use their OWN thresholds — see competencyScoreToLevel.
      competencyLevels: Object.fromEntries(
        COMPETENCIES.filter((c) => Number.isFinite(competencyScores[c.id])).map((c) => [
          c.id,
          competencyScoreToLevel(competencyScores[c.id]),
        ])
      ),
    };
  };

  const rows = samples.map((n) => toRow(n, false));
  if (liveResult) rows.push(toRow(liveResult, true));
  return rows;
}

/** Per-domain diagnostic bands for a row, tolerating legacy row shapes. */
function bandsOf(row) {
  return row?.domainDevelopmentBands ?? row?.levels ?? {};
}

/**
 * The diagnostic band for one domain on a row, or `null` when that domain was
 * never scored. Derives from the raw score first so a legacy row whose `levels`
 * map fabricated a band for a missing domain cannot reintroduce a phantom gap.
 */
function bandFor(row, domainId) {
  if (Number.isFinite(row?.scores?.[domainId])) return domainBand(row.scores[domainId]);
  // No numeric score: honour an explicit legacy band only if the row carries no
  // `scores` object at all (pure legacy shape); otherwise it is unassessed.
  if (row?.scores === undefined) return bandsOf(row)[domainId] ?? null;
  return null;
}

/** True when this row has a real numeric score for that domain. */
function hasDomainScore(row, domainId) {
  return Number.isFinite(row?.scores?.[domainId]);
}

/** The official overall level for a row, tolerating legacy row shapes. */
function levelOf(row) {
  return row?.overallLevel !== undefined ? row.overallLevel : overallLevel(row?.scores);
}

/** The official overall score for a row, tolerating legacy row shapes. */
function scoreOf(row) {
  return row?.overallScore !== undefined ? row.overallScore : overallScore(row?.scores);
}

/**
 * Pull one department's per-domain scores out of the nested navigator data,
 * returning the flat { name, scores } shape the rest of the app expects.
 */
export function deptSamples(samples, deptId) {
  return samples.map((n) => ({
    ...(n.navigatorId ? { navigatorId: n.navigatorId } : {}),
    name: n.name,
    scores: n.departments[deptId] ?? {},
  }));
}

/**
 * Overall score for a department. Thin alias of the canonical `overallScore` so
 * there is exactly ONE averaging formula in the app.
 */
export function departmentOverall(scores) {
  return overallScore(scores);
}

/**
 * Cross-department strength: each navigator with an overall + level per
 * department. The live taker is only assessed in ASSESSED_DEPT; elsewhere their
 * cells are null (not yet assessed).
 * @returns {{name:string, isLive:boolean,
 *            depts:Record<string,{overall:number,level:string}|null>}[]}
 */
export function departmentMatrix(samples, liveResult) {
  const cellsFor = (getScores) =>
    Object.fromEntries(
      DEPARTMENTS.map((dep) => {
        const status = overallStatus(getScores(dep.id));
        // ONLY a genuinely unassessed department (0 of 6 domains) is null.
        // An INCOMPLETE department (1-5 of 6) must still return a real cell:
        // both have `score === null`, so keying on the score alone would
        // collapse "we have partial evidence" into "we have none" and hide an
        // in-progress assessment from the cross-department view.
        if (status.unassessed) return [dep.id, null];
        return [
          dep.id,
          {
            overall: status.score, // null unless complete
            level: status.level, // null unless complete
            complete: status.complete,
            label: status.label, // 'Incomplete' or the official level label
            assessedDomains: status.assessedDomains,
            totalDomains: status.totalDomains,
          },
        ];
      })
    );

  const rows = samples.map((n) => ({
    navigatorId: n.navigatorId ?? null,
    name: n.name,
    isLive: false,
    depts: cellsFor((deptId) => n.departments[deptId]),
  }));

  if (liveResult) {
    // Place the live taker's row in the department they took the check for.
    // liveResult.department defaults to 'pediatrics' for legacy callers.
    const takerDept = liveResult.department ?? 'pediatrics';
    rows.push({
      navigatorId: liveResult.navigatorId ?? null,
      name: liveResult.name,
      isLive: true,
      depts: cellsFor((deptId) => (deptId === takerDept ? liveResult.scores : null)),
    });
  }
  return rows;
}

/**
 * Column gaps — domains where a majority (COLUMN_GAP_THRESHOLD) of navigators
 * score below the Solid threshold. These are floor-wide training priorities.
 * Diagnostic only: a column gap describes scores, not official statuses.
 * @returns {{domainId:string, belowSolidCount:number, criticalCount:number,
 *            learningCount:number, total:number, share:number}[]}
 */
export function columnGaps(rows) {
  const gaps = [];
  for (const domain of DOMAINS) {
    // Only navigators who were actually scored on this domain are evidence.
    // A missing score is neither a gap nor a silent pass, so it is excluded
    // from BOTH the numerator and the denominator.
    const assessed = rows.filter((r) => hasDomainScore(r, domain.id));
    if (assessed.length === 0) continue;
    const criticalCount = assessed.filter((r) => bandFor(r, domain.id) === 'critical').length;
    const learningCount = assessed.filter((r) => bandFor(r, domain.id) === 'learning').length;
    const belowSolidCount = criticalCount + learningCount;
    const share = belowSolidCount / assessed.length;
    if (share >= COLUMN_GAP_THRESHOLD) {
      gaps.push({
        domainId: domain.id,
        belowSolidCount,
        criticalCount,
        learningCount,
        total: assessed.length,
        assessed: assessed.length,
        share,
      });
    }
  }
  return gaps;
}

/**
 * Domain mentor roster — for each domain, the navigators QUALIFIED to mentor it.
 *
 * SAFETY: a navigator may mentor a domain only when BOTH hold:
 *   1. their OFFICIAL overall status is Can-Teach, and
 *   2. they scored at least THRESHOLDS.canTeach (90%) in that specific domain.
 * A high domain score alone never qualifies someone whose overall status is
 * lower, and a Can-Teach overall never qualifies someone for a domain they are
 * weak in. The domain itself is never described as "Can-Teach" — the domain
 * score is only the subject qualification.
 *
 * @returns {Record<string, string[]>} domainId -> [names]
 */
export function domainMentorRoster(rows) {
  const roster = {};
  for (const domain of DOMAINS) {
    roster[domain.id] = rows
      .filter(
        (r) =>
          levelOf(r) === 'canTeach' &&
          Number.isFinite(r.scores?.[domain.id]) &&
          r.scores[domain.id] >= THRESHOLDS.canTeach
      )
      .map((r) => r.name);
  }
  return roster;
}

/** @deprecated Backward-compatibility wrapper — use `domainMentorRoster`. */
export const canTeachRoster = domainMentorRoster;

/**
 * Readiness — navigators ranked by OFFICIAL overall status, then overall score.
 * `canTeachDomainCount` is supporting depth only; it is never the official
 * classification. `readyForMore` is true only for overall Can-Teach navigators.
 * @returns {{name, isLive, overallScore, overallLevel, overallLabel,
 *            canTeachDomainCount, readyForMore}[]}
 */
export function readinessTally(rows) {
  return rows
    .map((r) => {
      const level = levelOf(r);
      const assessed = r.assessedDomains ?? assessedDomainCount(r.scores);
      return {
        navigatorId: r.navigatorId ?? null,
        name: r.name,
        isLive: r.isLive,
        overallScore: scoreOf(r),
        overallLevel: level,
        overallLabel: r.overallLabel ?? overallStatus(r.scores).label,
        // Lets consumers tell Incomplete (1-5 scored) from Not assessed (0).
        assessedDomains: assessed,
        totalDomains: DOMAINS.length,
        complete: assessed === DOMAINS.length,
        canTeachDomainCount: DOMAINS.filter(
          (d) => Number.isFinite(r.scores?.[d.id]) && r.scores[d.id] >= THRESHOLDS.canTeach
        ).length,
        readyForMore: level === 'canTeach',
      };
    })
    .sort(
      (a, b) =>
        overallLevelRank(b.overallLevel) - overallLevelRank(a.overallLevel)
        || (b.overallScore ?? -1) - (a.overallScore ?? -1)
        || b.canTeachDomainCount - a.canTeachDomainCount
    );
}

/**
 * Official overall-status distribution across the floor — how many navigators
 * hold each official status. Incomplete profiles are counted separately so they
 * never inflate a status band.
 * @returns {{critical:number, learning:number, solid:number, canTeach:number,
 *            incomplete:number, unassessed:number, total:number}}
 */
export function overallDistribution(rows) {
  const counts = { critical: 0, learning: 0, solid: 0, canTeach: 0, incomplete: 0, unassessed: 0 };
  for (const r of rows) {
    // MUTUALLY EXCLUSIVE: each navigator lands in exactly ONE bucket, so
    // critical + learning + solid + canTeach + incomplete + unassessed === total.
    // An incomplete or unassessed profile holds no official capability status
    // and must never also be counted inside one.
    const assessed = r.assessedDomains ?? assessedDomainCount(r.scores);
    if (assessed === 0) { counts.unassessed += 1; continue; }
    if (assessed < DOMAINS.length) { counts.incomplete += 1; continue; }
    counts[levelOf(r)] += 1;
  }
  return { ...counts, total: rows.length };
}

/**
 * Floor-wide headline stats for the Team Overview dashboard — NAVIGATOR-level,
 * not cell-level. Every rate below counts people holding an official status,
 * never individual domain cells.
 *
 * ELIGIBLE PROFILES: all official-status KPIs (`solidPlusRate`, `canTeachCount`,
 * `criticalCount`, `learningCount`, `avgOverallScore`) are computed over
 * **complete six-domain profiles only**. Incomplete and unassessed navigators
 * have no official status, so they can neither inflate nor deflate an official
 * KPI; they are reported separately via `incompleteCount`/`unassessedCount` and
 * the `distribution`.
 *
 * `assessed` counts navigators with a COMPLETE profile (i.e. the population the
 * KPIs describe). `rowCount` is every row on the floor.
 */
export function floorStats(rows) {
  const distribution = overallDistribution(rows);
  // Only complete profiles carry an official status.
  const eligible = rows.filter(
    (r) => (r.assessedDomains ?? assessedDomainCount(r.scores)) === DOMAINS.length
  );
  const assessed = eligible.length;
  const solidPlus = distribution.solid + distribution.canTeach;
  const scores = eligible.map(scoreOf).filter((s) => Number.isFinite(s));
  return {
    assessed,
    rowCount: rows.length,
    incompleteCount: distribution.incomplete,
    unassessedCount: distribution.unassessed,
    // NO EVIDENCE IS NOT ZERO. With no complete profile there is nothing to
    // average or rate, so these are null and render as "N/A" — reporting 0%
    // would read as "the whole floor scored zero". A complete floor that really
    // does average 0 still returns a genuine numeric 0.
    solidPlusRate: assessed ? Math.round((solidPlus / assessed) * 100) : null,
    avgOverallScore: scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null,
    // Counts are genuine zeroes: "zero navigators are Critical" is a real fact.
    canTeachCount: distribution.canTeach,
    criticalCount: distribution.critical,
    learningCount: distribution.learning,
    totalDomains: DOMAINS.length,
    distribution,
  };
}

/**
 * Per-domain DIAGNOSTIC score distribution — drives the stacked bars on the
 * Team Overview dashboard. These are score-range counts, not navigator statuses.
 * @returns {{domainId, critical, learning, solid, canTeach, total,
 *            avgScore, belowCritical, belowSolid, needsTraining}[]}
 */
export function domainDistribution(rows) {
  return DOMAINS.map((d) => {
    const counts = { critical: 0, learning: 0, solid: 0, canTeach: 0 };
    const scores = [];
    let unassessed = 0;
    for (const r of rows) {
      const band = bandFor(r, d.id);
      // An unassessed domain is counted as unassessed — never bucketed into a
      // band (which previously produced NaN) and never inflated into Critical.
      if (band == null) { unassessed += 1; continue; }
      counts[band] += 1;
      scores.push(r.scores[d.id]);
    }
    return {
      domainId: d.id,
      ...counts,
      unassessed,
      // Band counts + unassessed sum to `total`; `assessed` is the band population.
      assessed: scores.length,
      total: rows.length,
      // null = nobody was scored in this domain (render "N/A"), not an average
      // of zero. A domain where everyone genuinely scored 0 still returns 0.
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      belowCritical: counts.critical,
      belowSolid: counts.critical + counts.learning,
      needsTraining: counts.critical + counts.learning + counts.solid,
    };
  });
}

/**
 * Per-competency level distribution (counts) — the capability-axis analogue of
 * domainDistribution. Skips competencies no row has a score for, and only counts
 * rows that were actually assessed on each competency.
 * @returns {{competencyId:string, learning:number, solid:number, canTeach:number, total:number}[]}
 */
export function competencyDistribution(rows) {
  return COMPETENCIES.map((c) => {
    const counts = { learning: 0, solid: 0, canTeach: 0 };
    let total = 0;
    for (const r of rows) {
      // Derive from the SCORE via the competency mapper rather than trusting a
      // row's precomputed level: a row built by an older/other code path could
      // carry a capability-band id ('critical') that has no bucket here, which
      // previously produced NaN counts and silently dropped the navigator.
      const score = r.competencyScores?.[c.id];
      const lvl = Number.isFinite(score)
        ? competencyScoreToLevel(score)
        : (r.competencyLevels?.[c.id] ?? null);
      if (!lvl || counts[lvl] === undefined) continue;
      counts[lvl] += 1;
      total += 1;
    }
    return { competencyId: c.id, ...counts, total };
  }).filter((x) => x.total > 0);
}

/** Find a single built row by stable navigator id, with a legacy name fallback. */
export function findRow(rows, identifier) {
  return rows.find((r) => r.navigatorId && r.navigatorId === identifier)
    ?? rows.find((r) => r.name === identifier)
    ?? null;
}

/** True when a training assignment priority counts as required (Critical or Required). */
export function isRequiredAssignment(priority) {
  return REQUIRED_TRAINING_PRIORITIES.includes(priority);
}

/**
 * Why does this navigator have no training assignments?
 *
 * `trainingForRow()` correctly skips unscored domains, so an EMPTY assignment
 * list is ambiguous: it can mean genuine mastery, or it can mean there was
 * nothing to assess. Surfaces must never congratulate a navigator who simply
 * has not been assessed, so every empty-state consumer resolves the reason here
 * instead of treating `assignments.length === 0` as proof of mastery.
 *
 * @returns {'unassessed'|'incomplete'|'mastered'|'has-assignments'}
 */
export function trainingEmptyStateReason(row, assignments = trainingForRow(row)) {
  if (assignments.length > 0) return 'has-assignments';
  const assessed = row?.assessedDomains ?? assessedDomainCount(row?.scores);
  if (assessed === 0) return 'unassessed';
  if (assessed < DOMAINS.length) return 'incomplete';
  // Complete profile with nothing assigned: every domain really is >= 90.
  return 'mastered';
}

/** True only when the navigator has a complete profile AND every domain >= 90. */
export function hasMasteredAllDomains(row) {
  return trainingEmptyStateReason(row) === 'mastered';
}

/**
 * Auto-assigned training for a single navigator, driven ENTIRELY by individual
 * DOMAIN scores via TRAINING_RULES — never by the official overall status.
 *
 * A navigator who is Can-Teach overall still receives targeted training for a
 * weaker domain; a high average never suppresses a domain assignment.
 * Critical (0–39) items come first, then Required (40–64), then Stretch (65–89).
 *
 * @returns {{domainId, band, score, priority, assignment, goal, isCritical,
 *            module, level}[]}  (`level` is a deprecated alias of `band`)
 */
export function trainingForRow(row) {
  return DOMAINS
    // A domain with no recorded score produces NO assignment. Missing evidence
    // is not a weakness, so it can never manufacture required training.
    .filter((d) => hasDomainScore(row, d.id))
    .map((d) => ({
      domainId: d.id,
      band: bandFor(row, d.id),
      score: row.scores[d.id],
    }))
    .filter(({ band }) => TRAINING_RULES[band]?.assign)
    .map(({ domainId, band, score }) => {
      const rule = TRAINING_RULES[band];
      return {
        domainId,
        band,
        level: band, // deprecated alias
        score,
        priority: rule.priority,
        assignment: rule.assignment,
        goal: rule.goal,
        isCritical: band === 'critical',
        module: moduleForDomain(domainId),
      };
    })
    .sort((a, b) => TRAINING_RULES[a.band].rank - TRAINING_RULES[b.band].rank);
}

/**
 * Floor-wide training plan: every navigator with their auto-assigned modules,
 * plus a count of required items. Navigators with the most Required items first.
 * @returns {{name:string, isLive:boolean, assignments:object[], requiredCount:number}[]}
 */
export function trainingPlan(rows) {
  return rows
    .map((r) => {
      const assignments = trainingForRow(r);
      const criticalCount = assignments.filter((a) => a.priority === 'Critical').length;
      return {
        name: r.name,
        isLive: r.isLive,
        assignments,
        criticalCount,
        // Required = Critical + Required (both are mandatory assignments).
        requiredCount: assignments.filter((a) => isRequiredAssignment(a.priority)).length,
        stretchCount: assignments.filter((a) => a.priority === 'Stretch').length,
      };
    })
    .sort((a, b) => b.criticalCount - a.criticalCount || b.requiredCount - a.requiredCount);
}

/**
 * Training grouped by domain — a "run one session for this cohort" view.
 * @returns {{domainId:string, module:object|null, required:string[], stretch:string[]}[]}
 */
export function trainingByDomain(rows) {
  return DOMAINS.map((d) => {
    const critical = [];
    const required = [];
    const stretch = [];
    for (const r of rows) {
      const rule = TRAINING_RULES[bandFor(r, d.id)];
      if (!rule?.assign) continue;
      if (rule.priority === 'Critical') critical.push(r.name);
      else if (rule.priority === 'Required') required.push(r.name);
      else stretch.push(r.name);
    }
    return { domainId: d.id, module: moduleForDomain(d.id), critical, required, stretch };
  }).filter((x) => x.critical.length > 0 || x.required.length > 0 || x.stretch.length > 0);
}

/**
 * Headline training stats for the dashboard.
 * @returns {{totalRequired:number, totalStretch:number, navigatorsWithRequired:number,
 *            domainsNeedingTraining:number}}
 */
export function trainingStats(rows) {
  const byDomain = trainingByDomain(rows);
  const plan = trainingPlan(rows);
  const totalCritical = byDomain.reduce((s, d) => s + d.critical.length, 0);
  return {
    totalCritical,
    // "Required" is the mandatory total: Critical + Required assignments.
    totalRequired: totalCritical + byDomain.reduce((s, d) => s + d.required.length, 0),
    totalStretch: byDomain.reduce((s, d) => s + d.stretch.length, 0),
    navigatorsWithCritical: plan.filter((p) => p.criticalCount > 0).length,
    navigatorsWithRequired: plan.filter((p) => p.requiredCount > 0).length,
    domainsNeedingTraining: byDomain.filter(
      (d) => d.critical.length > 0 || d.required.length > 0
    ).length,
    domainsWithCritical: byDomain.filter((d) => d.critical.length > 0).length,
  };
}

/**
 * Compute health metrics for each question from navigator answer history.
 *
 * A question is "Review Required" when it has been answered at least
 * HEALTH_MIN_RESPONSES times and fewer than HEALTH_REVIEW_THRESHOLD of those
 * answers selected the correct option. This can signal a poorly worded question
 * OR a real SOP/floor-practice mismatch ("Reverse QA").
 *
 * An extra signal — `canTeachFailCount` — surfaces when Can-Teach navigators are
 * also missing the question, the strongest indicator that the SOP itself is the
 * problem. "Can-Teach" here means the navigator's OFFICIAL OVERALL status for
 * that submission (the mean of all six domain scores), not their score in the
 * question's individual domain. An incomplete profile is never counted as
 * Can-Teach, because `overallLevel` refuses to promote one.
 *
 * Only result docs that carry an `answers` field (written by the updated client)
 * contribute; legacy docs without it are silently skipped.
 *
 * @param {object[]} questions  - each needs .id, .correctOptionId, .domainId
 * @param {object[]} results    - Firestore result docs
 * @returns {Record<string, {
 *   responseCount: number,
 *   correctCount: number,
 *   correctRate: number,
 *   canTeachCount: number,
 *   canTeachFailCount: number,
 *   status: 'insufficient'|'healthy'|'review'
 * }>}
 */
const HEALTH_MIN_RESPONSES = 10;
const HEALTH_REVIEW_THRESHOLD = 0.20;

export function computeQuestionHealth(questions, results) {
  const health = {};
  for (const q of questions) {
    let responseCount = 0;
    let correctCount = 0;
    let canTeachCount = 0;
    let canTeachFailCount = 0;

    for (const r of results) {
      if (!r.answers) continue;
      const chosen = r.answers[q.id];
      if (chosen === undefined) continue;

      responseCount += 1;
      const isCorrect = chosen === q.correctOptionId;
      if (isCorrect) correctCount += 1;

      // OFFICIAL overall status of the whole submission — not the domain score.
      if (overallLevel(r.scores) === 'canTeach') {
        canTeachCount += 1;
        if (!isCorrect) canTeachFailCount += 1;
      }
    }

    const correctRate = responseCount === 0 ? 0 : correctCount / responseCount;
    let status;
    if (responseCount < HEALTH_MIN_RESPONSES) status = 'insufficient';
    else if (correctRate < HEALTH_REVIEW_THRESHOLD) status = 'review';
    else status = 'healthy';

    health[q.id] = { responseCount, correctCount, correctRate, canTeachCount, canTeachFailCount, status };
  }
  return health;
}

function latestBy(items, getTs) {
  return [...items].sort((a, b) => compareTimestampValues(getTs(b), getTs(a)))[0] ?? null;
}

const isDomainInterview = (iv) => !iv?.qa;

/**
 * Build database-driven learning signals from stored attempts and review data.
 * This is intentionally deterministic: it explains patterns and produces
 * evidence for review, but never changes scores, active questions, or training.
 *
 * @param {{
 *   rows?: object[],
 *   results?: object[],
 *   history?: object[],
 *   questions?: object[],
 *   completions?: object[],
 *   interviews?: object[],
 *   feedback?: object[],
 * }} input
 * @returns {{
 *   weakDomains: object[],
 *   weakCompetencies: object[],
 *   repeatedMisses: object[],
 *   questionRisks: object[],
 *   trainingGaps: object[],
 *   interviewRisks: object[],
 *   feedbackRisks: object[],
 * }}
 */
export function buildLearningSignals({
  rows = [],
  results = [],
  history = [],
  questions = [],
  completions = [],
  interviews = [],
  feedback = [],
} = {}) {
  const questionById = Object.fromEntries(questions.map((q) => [q.id, q]));
  const resultByIdentity = new Map();
  for (const result of results) {
    if (result.navigatorId) resultByIdentity.set(`id:${result.navigatorId}`, result);
    if (result.name) resultByIdentity.set(`name:${result.name}`, result);
  }

  const weakDomains = [];
  const weakCompetencies = [];
  const repeatedMisses = [];
  const trainingGaps = [];
  const interviewRisks = [];

  for (const row of rows) {
    const result = (row.navigatorId && resultByIdentity.get(`id:${row.navigatorId}`))
      ?? resultByIdentity.get(`name:${row.name}`);
    for (const d of DOMAINS) {
      const band = bandFor(row, d.id);
      // `band == null` means the domain was never scored — no weak-domain
      // signal is generated from absent evidence.
      if (band != null && band !== 'canTeach') {
        const score = row.scores[d.id];
        const navCompletions = completions.filter((c) => sameNavigator(c, row) && c.domainId === d.id);
        const navInterviews = interviews.filter((iv) => isDomainInterview(iv) && sameNavigator(iv, row) && iv.domainId === d.id);
        weakDomains.push({
          name: row.name,
          domainId: d.id,
          score,
          band,
          level: band, // deprecated alias
          isCriticalGap: band === 'critical',
          practiceCount: navCompletions.filter((c) => !c.kind || c.kind === 'practice').length,
          miniCheckCount: navCompletions.filter((c) => c.kind === 'minicheck').length,
          interviewCount: navInterviews.filter((iv) => effectiveInterviewScore(iv) != null).length,
          evidence: [
            // Evidence is stated as a measured score, not an official level.
            `${d.id} scored ${Math.round(score)}%.${band === 'critical' ? ' Critical domain gap.' : ''}`,
            `${navCompletions.length} completed exercise${navCompletions.length === 1 ? '' : 's'}`,
          ],
        });
      }
    }

    for (const c of COMPETENCIES) {
      const score = row.competencyScores?.[c.id];
      // Competency axis keeps its OWN thresholds — see competencyScoreToLevel.
      if (Number.isFinite(score) && score < COMPETENCY_THRESHOLDS.canTeach) {
        weakCompetencies.push({
          name: row.name,
          competencyId: c.id,
          score,
          level: competencyScoreToLevel(score),
          evidence: [`${Math.round(score)}% in ${c.id}`],
        });
      }
    }

    const answers = result?.answers ?? {};
    for (const [questionId, chosen] of Object.entries(answers)) {
      const question = questionById[questionId];
      if (!question) continue;
      const points = optionPoints(question, chosen);
      if (points >= 100) continue;
      repeatedMisses.push({
        name: row.name,
        questionId,
        domainId: question.domainId,
        competencies: question.competencies ?? [],
        points,
        chosenOptionId: chosen,
        correctOptionId: question.correctOptionId,
        evidence: [`Earned ${points}/100 on ${questionId}`],
      });
    }

    const rowTraining = trainingForRow(row);
    for (const assignment of rowTraining) {
      const practiced = completions.some((c) => sameNavigator(c, row) && c.domainId === assignment.domainId && (!c.kind || c.kind === 'practice'));
      if (isRequiredAssignment(assignment.priority) && !practiced) {
        trainingGaps.push({
          name: row.name,
          domainId: assignment.domainId,
          priority: assignment.priority,
          isCritical: assignment.isCritical,
          reason: assignment.isCritical
            ? 'Critical domain gap — required practice has not been completed yet.'
            : 'Required practice has not been completed yet.',
          evidence: [
            `${assignment.domainId} scored ${Math.round(assignment.score)}%.`,
            'No completed practice is recorded.',
          ],
        });
      }
    }
  }

  // Critical domain gaps rank ahead of ordinary required-training gaps.
  trainingGaps.sort((a, b) => (b.isCritical ? 1 : 0) - (a.isCritical ? 1 : 0));

  for (const iv of interviews) {
    if (!isDomainInterview(iv)) continue;
    const score = effectiveInterviewScore(iv);
    if (score != null && score < INTERVIEW_SCORE_BANDS.fair) {
      interviewRisks.push({
        name: iv.name,
        domainId: iv.domainId,
        interviewId: iv.id,
        score,
        reason: `Practice call scored ${score}/100`,
      });
    }
  }

  const questionRisks = buildQuestionImprovementSuggestions(questions, results, feedback);
  const feedbackRisks = feedbackInsights(feedback).risks;

  // Supervisor-level signal on the OFFICIAL overall status, Critical first.
  const overallRisks = rows
    .filter((row) => levelOf(row) === 'critical' || levelOf(row) === 'learning')
    .map((row) => {
      const level = levelOf(row);
      return {
        navigatorId: row.navigatorId ?? null,
        name: row.name,
        overallScore: scoreOf(row),
        overallLevel: level,
        severity: level === 'critical' ? 'high' : 'medium',
        reason: level === 'critical'
          ? 'Immediate supervisor attention recommended.'
          : 'Overall status is Learning — targeted development recommended.',
      };
    })
    .sort(
      (a, b) =>
        overallLevelRank(a.overallLevel) - overallLevelRank(b.overallLevel)
        || (a.overallScore ?? 0) - (b.overallScore ?? 0)
    );

  return {
    overallRisks,
    weakDomains: weakDomains.sort(
      (a, b) => (b.isCriticalGap ? 1 : 0) - (a.isCriticalGap ? 1 : 0) || a.score - b.score
    ),
    weakCompetencies: weakCompetencies.sort((a, b) => a.score - b.score),
    repeatedMisses: repeatedMisses.sort((a, b) => a.points - b.points),
    questionRisks,
    trainingGaps,
    interviewRisks,
    feedbackRisks,
    historyCount: history.length,
  };
}

/**
 * Suggest review-safe question improvements from performance history. Returned
 * suggestions are draft/proposal data only; callers must route them through the
 * supervisor review gate before a live question changes.
 */
export function buildQuestionImprovementSuggestions(questions, results, feedback = []) {
  const health = computeQuestionHealth(questions, results);
  const byTarget = feedbackInsights(feedback).byTarget;

  return questions
    .map((q) => {
      const h = health[q.id];
      if (!h) return null;
      const feedbackSummary = byTarget[`question:${q.id}`];
      const correctRate = h.correctRate;
      const reasons = [];
      const labels = [];

      if (h.status === 'review') {
        labels.push('needsReview');
        reasons.push(`Only ${Math.round(correctRate * 100)}% correct after ${h.responseCount} responses.`);
      }
      if (h.responseCount >= HEALTH_MIN_RESPONSES && correctRate >= 0.9) {
        labels.push('tooEasy');
        reasons.push('High correct rate may mean the scenario is no longer discriminating skill.');
      }
      if (h.responseCount >= HEALTH_MIN_RESPONSES && correctRate < 0.5) {
        labels.push('tooHard');
        reasons.push('Low correct rate suggests the wording or SOP alignment needs review.');
      }
      if (h.canTeachFailCount > 0) {
        labels.push('canTeachMisses');
        reasons.push(`${h.canTeachFailCount} navigator${h.canTeachFailCount === 1 ? '' : 's'} with an overall Can-Teach status missed it.`);
      }
      if (feedbackSummary?.negative > 0) {
        labels.push('supervisorConcern');
        reasons.push(`${feedbackSummary.negative} supervisor feedback item${feedbackSummary.negative === 1 ? '' : 's'} flagged concern.`);
      }

      if (labels.length === 0) return null;
      const severity = labels.includes('needsReview') || labels.includes('canTeachMisses') ? 'high' : 'medium';
      return {
        questionId: q.id,
        domainId: q.domainId,
        severity,
        labels,
        reasons,
        responseCount: h.responseCount,
        correctRate,
        canTeachFailCount: h.canTeachFailCount,
        suggestedDraft: {
          ...q,
          status: 'draft',
          source: 'learning-loop',
          reviewNotes: [
            'Review wording, answer-option clarity, rationale language, and SOP alignment before activating.',
            ...reasons,
          ].join(' '),
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.severity === 'high' ? -1 : 1) - (b.severity === 'high' ? -1 : 1));
}

/**
 * Build the next best review-safe training recommendation for each weak domain.
 */
export function adaptiveTrainingRecommendations(row, {
  questions = [],
  result = null,
  history = [],
  completions = [],
  interviews = [],
  feedback = [],
} = {}) {
  if (!row) return [];
  const answers = result?.answers ?? {};
  const missedByDomain = {};
  for (const q of questions) {
    const chosen = answers[q.id];
    if (chosen === undefined) continue;
    const points = optionPoints(q, chosen);
    if (points < 100) {
      (missedByDomain[q.domainId] ??= []).push({ questionId: q.id, points, competencies: q.competencies ?? [] });
    }
  }

  const feedbackSummary = feedbackInsights(feedback).byTarget;

  const recommendations = trainingForRow(row).map((assignment) => {
    const domainId = assignment.domainId;
    const domainCompletions = completions.filter((c) => c.domainId === domainId);
    const hasPractice = domainCompletions.some((c) => !c.kind || c.kind === 'practice');
    const hasMiniCheck = domainCompletions.some((c) => c.kind === 'minicheck');
    const latestInterview = latestBy(
      interviews.filter((iv) => isDomainInterview(iv) && iv.domainId === domainId && effectiveInterviewScore(iv) != null),
      (iv) => iv.endedAt
    );
    const impact = trainingImpact(history, domainCompletions, domainId);
    const misses = missedByDomain[domainId] ?? [];

    let kind = 'module';
    let label = 'Review the training module';
    // Evidence wording states the measured score, not an official level name.
    const reasons = [
      `${domainId} scored ${Math.round(assignment.score)}%.`
      + (assignment.isCritical ? ' Critical domain gap — immediate focus.' : ''),
    ];

    if (!hasPractice) {
      kind = 'practice';
      label = 'Complete a Spot the Error practice scenario';
      reasons.push('No completed practice scenario is recorded for this domain.');
    } else if (!latestInterview || effectiveInterviewScore(latestInterview) < INTERVIEW_SCORE_BANDS.strong) {
      kind = 'interview';
      label = 'Complete a practice call';
      reasons.push(latestInterview ? `Latest practice call was ${effectiveInterviewScore(latestInterview)}/100.` : 'No graded practice call is recorded.');
    } else if (!hasMiniCheck) {
      kind = 'minicheck';
      label = 'Take the mini re-check';
      reasons.push('Practice exists; mini-check evidence is still missing.');
    } else if (impact.delta != null && impact.delta < 5) {
      kind = 'coaching';
      label = 'Review coaching notes with a supervisor';
      reasons.push(`Training impact is only ${impact.delta >= 0 ? '+' : ''}${impact.delta} points so far.`);
    }

    if (misses.length > 0) reasons.push(`${misses.length} missed or partial question${misses.length === 1 ? '' : 's'} in this domain.`);
    const fb = feedbackSummary[`training:${row.name}:${domainId}`];
    if (fb?.negative > 0) reasons.push('Supervisor feedback previously marked this recommendation as needing adjustment.');

    return {
      name: row.name,
      domainId,
      kind,
      label,
      priority: assignment.priority,
      isCritical: assignment.isCritical,
      module: assignment.module,
      reasons,
      evidence: {
        score: assignment.score,
        band: assignment.band,
        level: assignment.band, // deprecated alias
        missedQuestions: misses,
        completionCount: domainCompletions.length,
        latestInterviewScore: effectiveInterviewScore(latestInterview),
        trainingImpact: impact,
      },
    };
  });

  // Critical domain gaps rank ahead of ordinary required-training work.
  return recommendations.sort(
    (a, b) => (b.isCritical ? 1 : 0) - (a.isCritical ? 1 : 0) || a.evidence.score - b.evidence.score
  );
}

/**
 * Summarise supervisor feedback so future recommendations can surface recurring
 * weak spots. This does not mutate prompts or behavior; callers decide how to
 * display or include the summary in advisory AI context.
 */
export function feedbackInsights(feedback = []) {
  const byTarget = {};
  const risks = [];
  const negativeStatuses = new Set(['inaccurate', 'needsAdjustment', 'rejected']);
  const positiveStatuses = new Set(['helpful', 'approved']);

  for (const item of feedback) {
    const targetType = item.targetType ?? 'unknown';
    const targetId = item.targetId ?? 'unknown';
    const key = `${targetType}:${targetId}`;
    const bucket = (byTarget[key] ??= {
      targetType,
      targetId,
      helpful: 0,
      approved: 0,
      inaccurate: 0,
      needsAdjustment: 0,
      rejected: 0,
      positive: 0,
      negative: 0,
      notes: [],
    });
    if (bucket[item.status] !== undefined) bucket[item.status] += 1;
    if (positiveStatuses.has(item.status)) bucket.positive += 1;
    if (negativeStatuses.has(item.status)) bucket.negative += 1;
    if (item.note) bucket.notes.push(item.note);
  }

  for (const bucket of Object.values(byTarget)) {
    if (bucket.negative >= 2 || bucket.negative > bucket.positive) {
      risks.push({
        targetType: bucket.targetType,
        targetId: bucket.targetId,
        negative: bucket.negative,
        positive: bucket.positive,
        reason: 'Supervisor feedback shows recurring concern.',
        notes: bucket.notes.slice(-3),
      });
    }
  }

  return { byTarget, risks };
}

/**
 * Suggested mentors for one navigator: for each domain they have not yet
 * mastered, list qualified colleagues (excluding themselves). Mentors come from
 * `domainMentorRoster`, so every suggestion satisfies BOTH mentor safety rules
 * (overall Can-Teach AND ≥90% in that domain).
 * @returns {{domainId, score, band, isCriticalGap, mentors}[]}
 */
export function mentorSuggestions(rows, name) {
  const me = findRow(rows, name);
  if (!me) return [];
  const roster = domainMentorRoster(rows);
  return DOMAINS
    // Only domains this navigator was actually scored on and has not mastered.
    // An unscored domain is not a gap, so it never requests a mentor.
    .filter((d) => hasDomainScore(me, d.id) && bandFor(me, d.id) !== 'canTeach')
    .map((d) => {
      const band = bandFor(me, d.id);
      return {
        domainId: d.id,
        score: me.scores[d.id],
        band,
        level: band, // deprecated alias
        isCriticalGap: band === 'critical',
        mentors: roster[d.id].filter((n) => n !== name),
      };
    })
    .filter((x) => x.mentors.length > 0)
    // surface the biggest gaps first (Critical, then Learning, then Solid)
    .sort((a, b) => TRAINING_RULES[a.band].rank - TRAINING_RULES[b.band].rank || a.score - b.score);
}

// ─────────────────────────────────────────────────────────────────────────────
// LONGITUDINAL TRENDS (Feature 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * STRICT overall for comparisons: the canonical official score, or null when the
 * snapshot is not a complete six-domain profile. Callers that compare two
 * snapshots (e.g. the declining-trend check) must skip a null rather than treat
 * it as 0, otherwise a partial snapshot fabricates a huge "decline".
 */
function computeOverall(scores) {
  return overallScore(scores);
}

/**
 * DISPLAY-ONLY overall for sparklines. Prefers the official score, then the
 * diagnostic partial average so an incomplete historical snapshot still renders
 * at roughly the right height instead of collapsing the line.
 *
 * Returns **null** when a snapshot carries no measurable domain evidence at all
 * — that is a GAP in the chart, not a zero. Coercing it to 0 would draw (and
 * label) an artificial collapse for a check that simply recorded nothing.
 * This value is never a status, never labelled with a level, never fed to a KPI.
 *
 * @returns {number|null}
 */
function trendOverall(scores) {
  return overallScore(scores) ?? partialAverage(scores);
}

function formatTrendLabel(ts) {
  if (!ts) return '—';
  const date = new Date(timestampMillis(ts));
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/**
 * Build a trend series from a navigator's result history snapshots.
 * If fewer than TREND_SYNTH_POINTS real snapshots exist, prepend illustrative
 * synthetic points (clearly flagged simulated:true) so the chart is never empty.
 *
 * @param {object[]} history  getResultHistory() output, sorted oldest→newest
 * @param {{ synthesize?: boolean }} [opts]
 * @returns {{
 *   points: { label:string, scores:object, competencyScores:object, overall:number, simulated:boolean }[],
 *   domainSeries: Record<string, number[]>,
 *   overallSeries: number[],
 * }}
 */
export function buildTrend(history, { synthesize = true } = {}) {
  const realPoints = history.map((h) => ({
    label: formatTrendLabel(h.takenAt),
    scores: h.scores ?? {},
    competencyScores: h.competencyScores ?? {},
    overall: trendOverall(h.scores),
    simulated: h.simulated ?? false,
  }));

  const syntheticPoints = [];
  if (synthesize && realPoints.length < TREND_SYNTH_POINTS) {
    const needed = TREND_SYNTH_POINTS - realPoints.length;
    const baseScores = realPoints[0]?.scores ?? {};
    // Scale factors create a visible upward trend toward current snapshot.
    const factors = [0.60, 0.78].slice(0, needed);
    const labels = ['Q−2 (illustrative)', 'Q−1 (illustrative)'].slice(TREND_SYNTH_POINTS - needed);
    for (let i = 0; i < needed; i++) {
      const f = factors[i] ?? 0.65;
      const synScores = {};
      for (const d of DOMAINS) synScores[d.id] = Math.round((baseScores[d.id] ?? 50) * f);
      syntheticPoints.push({
        label: labels[i],
        scores: synScores,
        competencyScores: {},
        overall: trendOverall(synScores),
        simulated: true,
      });
    }
  }

  const points = [...syntheticPoints, ...realPoints];
  const domainSeries = {};
  // A snapshot with no score for a domain contributes `null` (a gap in the
  // line), never 0 — inserting a zero would draw an artificial crash for a
  // domain that simply was not measured in that check.
  for (const d of DOMAINS) {
    domainSeries[d.id] = points.map((p) => (Number.isFinite(p.scores[d.id]) ? p.scores[d.id] : null));
  }
  // `overallSeries` is (number|null)[] for the same reason: an empty or
  // unmeasurable snapshot is a gap, not a zero.
  return {
    points,
    domainSeries,
    overallSeries: points.map((p) => (Number.isFinite(p.overall) ? p.overall : null)),
  };
}

/**
 * Pre/post training impact for one domain: score before vs after the first
 * completion of any practice exercise in that domain.
 * Returns { before, after, delta } or nulls if not enough history.
 *
 * @param {object[]} history     sorted oldest→newest
 * @param {object[]} completions all completions for this navigator
 * @param {string}   domainId
 * @returns {{ before:number|null, after:number|null, delta:number|null }}
 */
export function trainingImpact(history, completions, domainId) {
  const firstTs = completions
    .filter((c) => c.domainId === domainId)
    .map((c) => timestampMillis(c.completedAt))
    .filter((ts) => ts > 0)
    .sort((a, b) => a - b)[0];

  if (firstTs == null) return { before: null, after: null, delta: null };

  const byType = new Map();
  for (const snapshot of history.filter((h) => !h.simulated)) {
    const type = assessmentTypeOf(snapshot);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(snapshot);
  }

  const candidates = [];
  for (const [assessmentType, snapshots] of byType) {
    const ordered = [...snapshots].sort((a, b) => timestampMillis(a.takenAt) - timestampMillis(b.takenAt));
    const before = [...ordered].filter((h) => timestampMillis(h.takenAt) <= firstTs).pop();
    const after = ordered.find((h) => timestampMillis(h.takenAt) > firstTs);
    const b = before?.scores?.[domainId];
    const a = after?.scores?.[domainId];
    if (!Number.isFinite(b) || !Number.isFinite(a)) continue;
    candidates.push({
      before: b,
      after: a,
      delta: a - b,
      assessmentType,
      distance: (firstTs - timestampMillis(before.takenAt)) + (timestampMillis(after.takenAt) - firstTs),
    });
  }
  const best = candidates.sort((a, b) => a.distance - b.distance)[0];
  return best
    ? { before: best.before, after: best.after, delta: best.delta, assessmentType: best.assessmentType }
    : { before: null, after: null, delta: null };
}

/**
 * Floor-level trend over time, measured on each navigator's OFFICIAL OVERALL
 * status — never on a count of Can-Teach domain cells.
 * Groups all history snapshots chronologically; for each distinct timestamp,
 * builds the floor state using each navigator's latest snapshot up to that point.
 * The existing assessment-type comparability rule is preserved, so MCQ and Spot
 * the Error snapshots are never mixed within one navigator's series.
 *
 * @param {object[]} allHistory  subscribeResultHistory() output (all navigators)
 * @returns {{ ts, label, avgOverallScore, solidPlusRate, canTeachRate,
 *             criticalCount, assessed }[]}
 */
export function teamTrend(allHistory) {
  if (allHistory.length === 0) return [];
  // A person's MCQ and Spot snapshots are different instruments. Anchor each
  // navigator to their most recently used assessment type so the trend never
  // manufactures movement by switching instruments mid-series.
  const preferredType = new Map();
  for (const item of allHistory) {
    const current = preferredType.get(item.navigatorId);
    if (!current || timestampMillis(item.takenAt) > current.ts) {
      preferredType.set(item.navigatorId, { type: assessmentTypeOf(item), ts: timestampMillis(item.takenAt) });
    }
  }
  const comparable = allHistory.filter((h) => assessmentTypeOf(h) === preferredType.get(h.navigatorId)?.type);
  const timePoints = [...new Set(comparable.map((h) => timestampMillis(h.takenAt)))].sort((a, b) => a - b);
  const navIds = [...new Set(comparable.map((h) => h.navigatorId))];

  return timePoints.map((ts) => {
    const snapshots = navIds
      .map((navId) =>
        comparable
          .filter((h) => h.navigatorId === navId && timestampMillis(h.takenAt) <= ts)
          .sort((a, b) => timestampMillis(b.takenAt) - timestampMillis(a.takenAt))[0]
      )
      .filter(Boolean);

    if (snapshots.length === 0) return null;
    const rows = buildMatrixRows(
      snapshots.map((s) => ({
        navigatorId: s.navigatorId ?? null,
        name: s.name,
        scores: s.scores ?? {},
        competencyScores: s.competencyScores ?? {},
      })),
      null
    );
    const stats = floorStats(rows);
    // A timepoint with no COMPLETE profile has no official aggregate. Omit it
    // rather than plotting 0%, which would draw an artificial collapse.
    if (stats.assessed === 0) return null;
    return {
      ts,
      label: formatTrendLabel(ts),
      avgOverallScore: stats.avgOverallScore,
      solidPlusRate: stats.solidPlusRate,
      canTeachRate: Math.round((stats.canTeachCount / stats.assessed) * 100),
      criticalCount: stats.criticalCount,
      assessed: stats.assessed,
    };
  }).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE DOSSIER (Feature 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an evidence dossier tying each competency rating to the concrete
 * question answers that produced it, plus domain-level practice evidence
 * (interviews and completions).
 *
 * Returns null when `answers` is empty/absent (legacy result docs without
 * the answers field — same tolerance as computeQuestionHealth).
 *
 * @param {object}   row         matrix row for this navigator
 * @param {object}   answers     result.answers: { questionId → optionId }
 * @param {object[]} questions   active question bank
 * @param {object[]} [interviews]  all interviews for this navigator
 * @param {object[]} [completions] all completions for this navigator
 * @returns {{ byCompetency: object[], byDomain: object } | null}
 */
export function buildDossier(row, answers, questions, interviews = [], completions = []) {
  if (!answers || Object.keys(answers).length === 0) return null;

  const byCompetency = {};
  for (const c of COMPETENCIES) {
    byCompetency[c.id] = {
      competencyId: c.id,
      score: row.competencyScores?.[c.id] ?? null,
      level: row.competencyLevels?.[c.id] ?? null,
      evidence: [],
    };
  }

  for (const q of questions) {
    const chosen = answers[q.id];
    if (chosen === undefined) continue;
    const chosenOpt = q.options?.find((o) => o.id === chosen);
    const bestOpt = q.options?.find((o) => o.id === q.correctOptionId);
    if (!chosenOpt) continue;
    const isCorrect = chosen === q.correctOptionId;
    const points = optionPoints(q, chosen);
    const item = {
      questionId: q.id,
      domainId: q.domainId,
      scenario: q.scenario,
      chosenText: chosenOpt.text,
      chosenRationale: chosenOpt.rationale ?? null,
      bestText: bestOpt?.text ?? null,
      bestRationale: bestOpt?.rationale ?? null,
      points,
      isCorrect,
    };
    for (const cid of q.competencies ?? []) {
      if (byCompetency[cid]) byCompetency[cid].evidence.push(item);
    }
  }

  const byDomain = {};
  for (const d of DOMAINS) {
    byDomain[d.id] = {
      domainId: d.id,
      interviews: interviews
        .filter((iv) => isDomainInterview(iv) && iv.domainId === d.id)
        .map((iv) => ({ id: iv.id, callerName: iv.callerName, endedAt: iv.endedAt, grade: iv.grade ?? null })),
      completions: completions
        .filter((c) => c.domainId === d.id)
        .map((c) => ({ id: c.id, kind: c.kind ?? 'practice', completedAt: c.completedAt })),
    };
  }

  return { byCompetency: Object.values(byCompetency), byDomain };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION CENTER (Feature 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a prioritized supervisor action center from the current floor state.
 *
 * `criticalOverall` is the most urgent category: a navigator whose OFFICIAL
 * overall status is Critical (below 40%). It ranks above ordinary Learning
 * cases. This is a developmental and supervisory signal only — it never drives
 * an automatic employment decision, restriction, or suspension.
 *
 * `criticalDomainGaps` is separate: a navigator with a healthy overall status
 * can still have one domain below 40, and the supervisor must see it.
 *
 * @param {object[]} rows      buildMatrixRows output
 * @param {{ history?: object[], interviews?: object[], completions?: object[] }} [opts]
 * @returns {{
 *   criticalOverall:    {name,overallScore,reason,severity}[],
 *   criticalDomainGaps: {name,domainId,score,reason,severity}[],
 *   learningOverall:    {name,overallScore,reason,severity}[],
 *   trainingOverdue:    {name,reason,domainId,severity}[],
 *   decliningTrends:    {name,reason,delta,severity}[],
 *   failedPractice:     {name,reason,domainId,score,interviewId,severity}[],
 *   readyForMore:       {name,overallScore,reason,severity}[],
 *   criticalGaps:       alias of criticalDomainGaps (deprecated),
 * }}
 */
export function buildActionCenter(rows, { history = [], interviews = [], completions = [] } = {}) {
  const criticalOverall = [];
  const criticalDomainGaps = [];
  const learningOverall = [];
  const trainingOverdue = [];
  const decliningTrends = [];
  const failedPractice = [];
  const readyForMore = [];

  for (const row of rows) {
    const level = levelOf(row);
    const score = scoreOf(row);

    // ── Official overall status signals ──────────────────────────────────
    if (level === 'critical') {
      criticalOverall.push({
        navigatorId: row.navigatorId ?? null,
        name: row.name,
        overallScore: score,
        reason: 'Immediate supervisor attention recommended',
        severity: 'high',
      });
    } else if (level === 'learning') {
      learningOverall.push({
        navigatorId: row.navigatorId ?? null,
        name: row.name,
        overallScore: score,
        reason: 'Overall status is Learning',
        severity: 'medium',
      });
    }

    // ── Critical domain gaps (independent of overall status) ─────────────
    // ONLY a recorded numeric score in 0–39 is a critical gap. A domain that
    // was never scored produces no alert.
    for (const d of DOMAINS) {
      if (hasDomainScore(row, d.id) && bandFor(row, d.id) === 'critical') {
        criticalDomainGaps.push({
          navigatorId: row.navigatorId ?? null,
          name: row.name,
          domainId: d.id,
          score: row.scores[d.id],
          reason: 'Critical domain gap',
          severity: 'high',
        });
      }
    }

    const training = trainingForRow(row);
    const navCompleted = new Set(
      completions
        .filter((c) => sameNavigator(c, row) && (!c.kind || c.kind === 'practice'))
        .map((c) => c.domainId)
    );
    for (const a of training) {
      if (isRequiredAssignment(a.priority) && !navCompleted.has(a.domainId)) {
        trainingOverdue.push({
          navigatorId: row.navigatorId ?? null,
          name: row.name,
          reason: `Required training pending: ${a.domainId}`,
          domainId: a.domainId,
          isCritical: a.isCritical,
          severity: a.isCritical ? 'high' : 'medium',
        });
      }
    }

    const navHistory = history.filter((h) => sameNavigator(h, row) && !h.simulated);
    const grouped = Object.groupBy
      ? Object.groupBy(navHistory, assessmentTypeOf)
      : navHistory.reduce((acc, item) => ((acc[assessmentTypeOf(item)] ??= []).push(item), acc), {});
    const declines = Object.entries(grouped).flatMap(([assessmentType, snapshots]) => {
      const ordered = [...snapshots].sort((a, b) => timestampMillis(a.takenAt) - timestampMillis(b.takenAt));
      if (ordered.length < 2) return [];
      const prev = computeOverall(ordered.at(-2).scores);
      const curr = computeOverall(ordered.at(-1).scores);
      // Compare only two COMPLETE profiles. An incomplete snapshot has no
      // official score, and treating it as 0 would fabricate a huge decline.
      if (prev == null || curr == null) return [];
      return curr < prev - 5 ? [{ assessmentType, prev, curr, ts: timestampMillis(ordered.at(-1).takenAt) }] : [];
    }).sort((a, b) => b.ts - a.ts);
    if (declines.length) {
      const { assessmentType, prev, curr } = declines[0];
      decliningTrends.push({
        navigatorId: row.navigatorId ?? null,
        name: row.name,
        reason: `${assessmentType.toUpperCase()} overall dropped ${prev - curr} points`,
        delta: curr - prev,
        assessmentType,
        severity: 'medium',
      });
    }
  }

  for (const iv of interviews) {
    if (!isDomainInterview(iv)) continue;
    const score = effectiveInterviewScore(iv);
    if (score != null && score < INTERVIEW_SCORE_BANDS.fair) {
      const row = rows.find((r) => sameNavigator(iv, r));
      if (row) {
        failedPractice.push({
          navigatorId: row.navigatorId ?? null,
          name: row.name,
          reason: `Practice score ${score}/100`,
          domainId: iv.domainId,
          score,
          interviewId: iv.id ?? `${row.navigatorId ?? row.name}-${iv.domainId}-${timestampMillis(iv.endedAt) || 'practice'}`,
          severity: 'medium',
        });
      }
    }
  }

  // Ready for more = OFFICIAL overall Can-Teach only. Domain depth is shown as
  // supporting context, never as the qualifying signal.
  for (const t of readinessTally(rows)) {
    if (t.readyForMore) {
      readyForMore.push({
        navigatorId: t.navigatorId ?? null,
        name: t.name,
        overallScore: t.overallScore,
        overallLevel: t.overallLevel,
        canTeachDomainCount: t.canTeachDomainCount,
        reason: `${t.overallScore}% overall · Can-Teach`,
        severity: 'info',
      });
    }
  }

  criticalDomainGaps.sort((a, b) => a.score - b.score);
  criticalOverall.sort((a, b) => (a.overallScore ?? 0) - (b.overallScore ?? 0));
  learningOverall.sort((a, b) => (a.overallScore ?? 0) - (b.overallScore ?? 0));

  return {
    criticalOverall,
    criticalDomainGaps,
    learningOverall,
    trainingOverdue,
    decliningTrends,
    failedPractice,
    readyForMore,
    /** @deprecated use `criticalDomainGaps` */
    criticalGaps: criticalDomainGaps,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTIVE DEV PATHS (Feature 4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a per-domain development path for a navigator, tracking progress
 * through 5 ordered steps: coaching → practice → interview → module → mini-check.
 * Step status derives from existing completions and graded interviews.
 *
 * @param {object}   row         matrix row
 * @param {object[]} completions all completions for this navigator
 * @param {object[]} interviews  all interviews for this navigator
 * @returns {{
 *   domainId:string, level:string, priority:string, percentComplete:number,
 *   steps:{kind:string, label:string, status:'done'|'next'|'todo'}[],
 * }[]}
 */
export function buildDevPath(row, completions = [], interviews = []) {
  return trainingForRow(row).map(({ domainId, band, score, priority, isCritical }) => {
    const hasCoaching = completions.some((c) => c.domainId === domainId && c.kind === 'coaching');
    const hasPractice = completions.some((c) => c.domainId === domainId && (!c.kind || c.kind === 'practice'));
    const hasInterview = interviews.some((iv) => isDomainInterview(iv) && iv.domainId === domainId && effectiveInterviewScore(iv) != null);
    const hasModule = completions.some((c) => c.domainId === domainId && c.kind === 'module');
    // Legacy mini-check completions did not record pass/fail and included failed
    // attempts. Only explicit mastery evidence may close validation now.
    const hasMiniCheck = completions.some((c) => (
      c.domainId === domainId && c.kind === 'minicheck' && c.passed === true
    ));

    const steps = sequenceDevSteps([
      { kind: 'coaching',   label: 'Review coaching notes',   status: hasCoaching ? 'done' : 'todo' },
      { kind: 'practice',   label: 'Spot the Error scenario', status: hasPractice ? 'done' : 'todo' },
      { kind: 'interview',  label: 'Practice call',           status: hasInterview ? 'done' : 'todo' },
      { kind: 'module',     label: 'Training module',         status: hasModule ? 'done' : 'todo' },
      { kind: 'minicheck',  label: 'Mini domain check',       status: hasMiniCheck ? 'done' : 'todo' },
    ]);

    return {
      domainId,
      band,
      level: band, // deprecated alias
      score,
      priority,
      isCritical,
      steps,
      percentComplete: Math.round((steps.filter((s) => s.status === 'done').length / steps.length) * 100),
    };
  });
}

/**
 * Preserve completed steps while making exactly the first incomplete step
 * actionable. Works for both the deterministic order and an AI-reordered path.
 */
export function sequenceDevSteps(steps = []) {
  let assignedNext = false;
  return steps.map((step) => {
    if (step.status === 'done') return { ...step, status: 'done' };
    if (!assignedNext) {
      assignedNext = true;
      return { ...step, status: 'next' };
    }
    return { ...step, status: 'todo' };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MENTOR MATCHING (Feature 5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build load-balanced mentor-mentee pairings for all domains.
 *
 * MENTOR SAFETY: only navigators returned by `domainMentorRoster` may mentor a
 * domain — official overall status Can-Teach AND ≥90% in that specific domain.
 * A navigator who is Can-Teach overall but weak in a domain cannot mentor it,
 * and a strong domain score never qualifies someone whose overall status is
 * lower. Mentees are prioritized Critical → Learning → Solid by domain score.
 *
 * New pairing records carry explicit overall/domain provenance; the legacy
 * `menteeLevel` / `baselineScore` fields are preserved so existing saved
 * pairing documents keep rendering unchanged.
 *
 * @param {object[]} rows
 * @param {{ maxLoad?: number }} [opts]
 */
export function buildMentorMatches(rows, { maxLoad = MENTOR_MAX_LOAD } = {}) {
  const pairings = [];
  const unmatched = [];
  const load = {}; // mentorName → total pairings assigned
  const roster = domainMentorRoster(rows);
  const rowByName = new Map(rows.map((r) => [r.name, r]));

  const menteeShape = (mentee, domainId) => {
    const band = bandFor(mentee, domainId);
    return {
      domainId,
      menteeName: mentee.name,
      menteeOverallScore: scoreOf(mentee),
      menteeOverallLevel: levelOf(mentee),
      baselineDomainScore: mentee.scores[domainId],
      menteeDomainBand: band,
      // Legacy fields kept for backward compatibility with saved pairings.
      menteeLevel: band,
      baselineScore: mentee.scores[domainId],
    };
  };

  for (const d of DOMAINS) {
    const mentors = roster[d.id];
    const mentorNames = new Set(mentors);
    const mentees = rows
      // A navigator with no score for this domain has no demonstrated need, so
      // they are never paired (and never counted as unmatched) for it.
      .filter((r) => !mentorNames.has(r.name)
        && hasDomainScore(r, d.id)
        && bandFor(r, d.id) !== 'canTeach')
      .sort(
        (a, b) =>
          TRAINING_RULES[bandFor(a, d.id)].rank - TRAINING_RULES[bandFor(b, d.id)].rank
          || (a.scores?.[d.id] ?? 0) - (b.scores?.[d.id] ?? 0)
      );

    if (mentors.length === 0) {
      for (const mentee of mentees) unmatched.push(menteeShape(mentee, d.id));
      continue;
    }

    for (const mentee of mentees) {
      const available = mentors
        .map((m) => ({ name: m, currentLoad: load[m] ?? 0 }))
        .filter((m) => m.currentLoad < maxLoad)
        .sort((a, b) => a.currentLoad - b.currentLoad);

      if (available.length === 0) {
        unmatched.push(menteeShape(mentee, d.id));
        continue;
      }

      const mentor = available[0];
      const mentorRow = rowByName.get(mentor.name);
      load[mentor.name] = (load[mentor.name] ?? 0) + 1;
      pairings.push({
        ...menteeShape(mentee, d.id),
        mentorName: mentor.name,
        mentorOverallScore: scoreOf(mentorRow),
        mentorOverallLevel: levelOf(mentorRow),
        mentorDomainScore: mentorRow?.scores?.[d.id] ?? null,
      });
    }
  }

  return { pairings, load, unmatched };
}

/**
 * For each saved Firestore pairing, compute how the mentee's domain score has
 * changed since the baseline was recorded.
 *
 * @param {object[]} savedPairings  from subscribePairings()
 * @param {object[]} rows           current matrix rows
 * @returns {object[]} pairings enriched with { currentScore, delta, improved }
 */
export function pairingOutcomes(savedPairings, rows) {
  return savedPairings.map((p) => {
    const menteeRow = findRow(rows, p.menteeName);
    const currentScore = menteeRow?.scores?.[p.domainId] ?? null;
    // Legacy pairing documents only carry `baselineScore`; newer ones also
    // carry `baselineDomainScore`. Both keep working.
    const baseline = p.baselineDomainScore ?? p.baselineScore ?? 0;
    const delta = currentScore !== null ? currentScore - baseline : null;
    return { ...p, baseline, currentScore, delta, improved: delta !== null && delta > 0 };
  });
}
