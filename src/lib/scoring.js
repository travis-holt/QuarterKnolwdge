// ─────────────────────────────────────────────────────────────────────────────
// SCORING + MATRIX READ-OFFS
//
// Two scoring axes, both derived from the same answers and never reduced to a
// single overall grade:
//   • per-DOMAIN  (topic: scheduling, insurance, …)        — scorePerDomain
//   • per-COMPETENCY (capability: critical thinking, …)    — scorePerCompetency
// Each option carries a `points` value (0–100 = quality of that choice), so an
// answer earns partial credit, not just right/wrong. Levels are derived from
// THRESHOLDS in data/config.js so the bands are easy to change in one place.
// ─────────────────────────────────────────────────────────────────────────────

import { THRESHOLDS, LEVELS, COLUMN_GAP_THRESHOLD, TRAINING_RULES, TREND_SYNTH_POINTS, MENTOR_MAX_LOAD, INTERVIEW_SCORE_BANDS } from '../data/config.js';
import { DOMAINS, SEED_QUESTIONS } from '../data/questions.js';
import { COMPETENCIES } from '../data/competencies.js';
import { moduleForDomain } from '../data/training.js';
import { DEPARTMENTS } from '../data/departments.js';

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
 * Score a set of answers into a per-domain map (0–100), averaging earned points
 * across each domain's questions.
 * @param {Record<string,string>} answers - questionId -> chosen optionId
 * @param {object[]} [questions] - the active question bank (defaults to the seed)
 * @returns {Record<string,number>} domainId -> score (0–100, rounded)
 */
export function scorePerDomain(answers = {}, questions = SEED_QUESTIONS) {
  const tally = {}; // domainId -> { earned, total }
  for (const domain of DOMAINS) {
    tally[domain.id] = { earned: 0, total: 0 };
  }

  for (const q of questions) {
    const bucket = tally[q.domainId];
    if (!bucket) continue;
    bucket.total += 1;
    bucket.earned += earnedPoints(answers[q.id], q);
  }

  const scores = {};
  for (const domain of DOMAINS) {
    const { earned, total } = tally[domain.id];
    scores[domain.id] = total === 0 ? 0 : Math.round(earned / total);
  }
  return scores;
}

/**
 * Score a set of answers into a per-competency map (0–100), averaging earned
 * points across each competency's tagged questions. Competencies with no tagged
 * questions in the active bank are returned as `null` (consumers skip them).
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
 * Map a per-domain percentage to a capability level id.
 * @param {number} pct
 * @returns {'learning'|'solid'|'canTeach'}
 */
export function scoreToLevel(pct) {
  if (pct >= THRESHOLDS.canTeach) return 'canTeach';
  if (pct < THRESHOLDS.learning) return 'learning';
  return 'solid';
}

/** Convenience: full level descriptor ({id,label,color,text}) for a percentage. */
export function levelFor(pct) {
  return LEVELS[scoreToLevel(pct)];
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
 * Each row carries both scoring axes:
 *   { name, isLive, scores, levels,                 // per-domain
 *     competencyScores, competencyLevels }          // per-competency
 * `competencyLevels` only includes competencies the row actually has a score for
 * (a bank may not exercise all 9), so consumers can iterate it safely.
 * @param {{name,scores,competencyScores?}[]} samples
 * @param {{name,scores,competencyScores?}|null} liveResult
 */
export function buildMatrixRows(samples, liveResult) {
  const toRow = (nav, isLive) => {
    const scores = nav.scores ?? {};
    const competencyScores = nav.competencyScores ?? {};
    return {
      name: nav.name,
      isLive,
      scores,
      levels: Object.fromEntries(
        DOMAINS.map((d) => [d.id, scoreToLevel(scores[d.id] ?? 0)])
      ),
      competencyScores,
      competencyLevels: Object.fromEntries(
        COMPETENCIES.filter((c) => typeof competencyScores[c.id] === 'number').map((c) => [
          c.id,
          scoreToLevel(competencyScores[c.id]),
        ])
      ),
    };
  };

  const rows = samples.map((n) => toRow(n, false));
  if (liveResult) rows.push(toRow(liveResult, true));
  return rows;
}

/**
 * Pull one department's per-domain scores out of the nested navigator data,
 * returning the flat { name, scores } shape the rest of the app expects.
 */
export function deptSamples(samples, deptId) {
  return samples.map((n) => ({ name: n.name, scores: n.departments[deptId] ?? {} }));
}

/** Overall score for a department = mean of its domain scores (or null if none). */
export function departmentOverall(scores) {
  const vals = DOMAINS.map((d) => scores?.[d.id]).filter((v) => typeof v === 'number');
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
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
        const overall = departmentOverall(getScores(dep.id));
        return [dep.id, overall == null ? null : { overall, level: scoreToLevel(overall) }];
      })
    );

  const rows = samples.map((n) => ({
    name: n.name,
    isLive: false,
    depts: cellsFor((deptId) => n.departments[deptId]),
  }));

  if (liveResult) {
    // Place the live taker's row in the department they took the check for.
    // liveResult.department defaults to 'pediatrics' for legacy callers.
    const takerDept = liveResult.department ?? 'pediatrics';
    rows.push({
      name: liveResult.name,
      isLive: true,
      depts: cellsFor((deptId) => (deptId === takerDept ? liveResult.scores : null)),
    });
  }
  return rows;
}

/**
 * Column gaps — domains where a majority (COLUMN_GAP_THRESHOLD) of navigators
 * sit at "Learning". These are floor-wide training priorities.
 * @returns {{domainId:string, learningCount:number, total:number, share:number}[]}
 */
export function columnGaps(rows) {
  const gaps = [];
  for (const domain of DOMAINS) {
    const learningCount = rows.filter((r) => r.levels[domain.id] === 'learning').length;
    const share = rows.length === 0 ? 0 : learningCount / rows.length;
    if (share >= COLUMN_GAP_THRESHOLD) {
      gaps.push({ domainId: domain.id, learningCount, total: rows.length, share });
    }
  }
  return gaps;
}

/**
 * Can-Teach roster — for each domain, the navigators who can teach it.
 * @returns {Record<string, string[]>} domainId -> [names]
 */
export function canTeachRoster(rows) {
  const roster = {};
  for (const domain of DOMAINS) {
    roster[domain.id] = rows
      .filter((r) => r.levels[domain.id] === 'canTeach')
      .map((r) => r.name);
  }
  return roster;
}

/**
 * Readiness tally — each navigator's count of Can-Teach cells, highest first.
 * A data-backed "who's ready for more" signal.
 * @returns {{name:string, isLive:boolean, canTeachCount:number}[]}
 */
export function readinessTally(rows) {
  return rows
    .map((r) => ({
      name: r.name,
      isLive: r.isLive,
      canTeachCount: Object.values(r.levels).filter((lvl) => lvl === 'canTeach').length,
    }))
    .sort((a, b) => b.canTeachCount - a.canTeachCount);
}

/**
 * Floor-wide headline stats for the Team Overview dashboard.
 * @returns {{assessed:number, solidPlusRate:number, coveredDomains:number,
 *            totalDomains:number, avgReadiness:number, learningRate:number}}
 */
export function floorStats(rows) {
  const totalCells = rows.length * DOMAINS.length;
  let solidPlus = 0;
  let learning = 0;
  for (const r of rows) {
    for (const d of DOMAINS) {
      if (r.levels[d.id] === 'learning') learning += 1;
      else solidPlus += 1;
    }
  }
  const roster = canTeachRoster(rows);
  const coveredDomains = DOMAINS.filter((d) => roster[d.id].length > 0).length;
  const totalCanTeach = rows.reduce(
    (sum, r) => sum + Object.values(r.levels).filter((l) => l === 'canTeach').length,
    0
  );
  return {
    assessed: rows.length,
    solidPlusRate: totalCells ? Math.round((solidPlus / totalCells) * 100) : 0,
    learningRate: totalCells ? Math.round((learning / totalCells) * 100) : 0,
    coveredDomains,
    totalDomains: DOMAINS.length,
    avgReadiness: rows.length ? totalCanTeach / rows.length : 0,
  };
}

/**
 * Per-domain level distribution (counts) — drives the stacked bars on the
 * Team Overview dashboard.
 * @returns {{domainId:string, learning:number, solid:number, canTeach:number, total:number}[]}
 */
export function domainDistribution(rows) {
  return DOMAINS.map((d) => {
    const counts = { learning: 0, solid: 0, canTeach: 0 };
    for (const r of rows) counts[r.levels[d.id]] += 1;
    return { domainId: d.id, ...counts, total: rows.length };
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
      const lvl = r.competencyLevels?.[c.id];
      if (!lvl) continue;
      counts[lvl] += 1;
      total += 1;
    }
    return { competencyId: c.id, ...counts, total };
  }).filter((x) => x.total > 0);
}

/** Find a single built row by navigator name (or null). */
export function findRow(rows, name) {
  return rows.find((r) => r.name === name) ?? null;
}

/**
 * Auto-assigned training for a single navigator, driven by TRAINING_RULES.
 * Each weak domain pulls in its training module, tagged with priority and the
 * level it was assigned at. Required (Learning) items come before Stretch.
 * @returns {{domainId:string, level:string, priority:string, goal:string,
 *            module:object|null}[]}
 */
export function trainingForRow(row) {
  return DOMAINS.map((d) => ({ domainId: d.id, level: row.levels[d.id] }))
    .filter(({ level }) => TRAINING_RULES[level]?.assign)
    .map(({ domainId, level }) => {
      const rule = TRAINING_RULES[level];
      return {
        domainId,
        level,
        priority: rule.priority,
        goal: rule.goal,
        module: moduleForDomain(domainId),
      };
    })
    .sort((a, b) => TRAINING_RULES[a.level].rank - TRAINING_RULES[b.level].rank);
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
      return {
        name: r.name,
        isLive: r.isLive,
        assignments,
        requiredCount: assignments.filter((a) => a.priority === 'Required').length,
      };
    })
    .sort((a, b) => b.requiredCount - a.requiredCount);
}

/**
 * Training grouped by domain — a "run one session for this cohort" view.
 * @returns {{domainId:string, module:object|null, required:string[], stretch:string[]}[]}
 */
export function trainingByDomain(rows) {
  return DOMAINS.map((d) => {
    const required = [];
    const stretch = [];
    for (const r of rows) {
      const rule = TRAINING_RULES[r.levels[d.id]];
      if (!rule?.assign) continue;
      (rule.priority === 'Required' ? required : stretch).push(r.name);
    }
    return { domainId: d.id, module: moduleForDomain(d.id), required, stretch };
  }).filter((x) => x.required.length > 0 || x.stretch.length > 0);
}

/**
 * Headline training stats for the dashboard.
 * @returns {{totalRequired:number, totalStretch:number, navigatorsWithRequired:number,
 *            domainsNeedingTraining:number}}
 */
export function trainingStats(rows) {
  const byDomain = trainingByDomain(rows);
  const plan = trainingPlan(rows);
  return {
    totalRequired: byDomain.reduce((s, d) => s + d.required.length, 0),
    totalStretch: byDomain.reduce((s, d) => s + d.stretch.length, 0),
    navigatorsWithRequired: plan.filter((p) => p.requiredCount > 0).length,
    domainsNeedingTraining: byDomain.filter((d) => d.required.length > 0).length,
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
 * An extra signal — `canTeachFailCount` — surfaces when Can-Teach navigators
 * (domain score ≥ canTeach threshold at submission time) are also missing the
 * question, the strongest indicator that the SOP itself is the problem.
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

      const domainScore = r.scores?.[q.domainId];
      if (typeof domainScore === 'number' && scoreToLevel(domainScore) === 'canTeach') {
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

function tsSeconds(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toDate === 'function') return Math.floor(value.toDate().getTime() / 1000);
  return value.seconds ?? 0;
}

function latestBy(items, getTs) {
  return [...items].sort((a, b) => getTs(b) - getTs(a))[0] ?? null;
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
  const resultByName = Object.fromEntries(results.map((r) => [r.name, r]));

  const weakDomains = [];
  const weakCompetencies = [];
  const repeatedMisses = [];
  const trainingGaps = [];
  const interviewRisks = [];

  for (const row of rows) {
    const result = resultByName[row.name];
    for (const d of DOMAINS) {
      const level = row.levels?.[d.id] ?? scoreToLevel(row.scores?.[d.id] ?? 0);
      if (level !== 'canTeach') {
        const navCompletions = completions.filter((c) => c.name === row.name && c.domainId === d.id);
        const navInterviews = interviews.filter((iv) => isDomainInterview(iv) && iv.name === row.name && iv.domainId === d.id);
        weakDomains.push({
          name: row.name,
          domainId: d.id,
          score: row.scores?.[d.id] ?? 0,
          level,
          practiceCount: navCompletions.filter((c) => !c.kind || c.kind === 'practice').length,
          miniCheckCount: navCompletions.filter((c) => c.kind === 'minicheck').length,
          interviewCount: navInterviews.filter((iv) => iv.grade?.score != null).length,
          evidence: [
            `${level} in ${d.id}`,
            `${navCompletions.length} completed exercise${navCompletions.length === 1 ? '' : 's'}`,
          ],
        });
      }
    }

    for (const c of COMPETENCIES) {
      const score = row.competencyScores?.[c.id];
      if (typeof score === 'number' && score < THRESHOLDS.canTeach) {
        weakCompetencies.push({
          name: row.name,
          competencyId: c.id,
          score,
          level: scoreToLevel(score),
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
      const practiced = completions.some((c) => c.name === row.name && c.domainId === assignment.domainId && (!c.kind || c.kind === 'practice'));
      if (assignment.priority === 'Required' && !practiced) {
        trainingGaps.push({
          name: row.name,
          domainId: assignment.domainId,
          priority: assignment.priority,
          reason: 'Required practice has not been completed yet.',
          evidence: [`${assignment.domainId} is ${assignment.level}`],
        });
      }
    }
  }

  for (const iv of interviews) {
    if (!isDomainInterview(iv)) continue;
    if (iv.grade?.score != null && iv.grade.score < INTERVIEW_SCORE_BANDS.fair) {
      interviewRisks.push({
        name: iv.name,
        domainId: iv.domainId,
        interviewId: iv.id,
        score: iv.grade.score,
        reason: `Practice call scored ${iv.grade.score}/100`,
      });
    }
  }

  const questionRisks = buildQuestionImprovementSuggestions(questions, results, feedback);
  const feedbackRisks = feedbackInsights(feedback).risks;

  return {
    weakDomains: weakDomains.sort((a, b) => a.score - b.score),
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
        reasons.push(`${h.canTeachFailCount} Can-Teach navigator${h.canTeachFailCount === 1 ? '' : 's'} missed it.`);
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

  return trainingForRow(row).map((assignment) => {
    const domainId = assignment.domainId;
    const domainCompletions = completions.filter((c) => c.domainId === domainId);
    const hasPractice = domainCompletions.some((c) => !c.kind || c.kind === 'practice');
    const hasMiniCheck = domainCompletions.some((c) => c.kind === 'minicheck');
    const latestInterview = latestBy(
      interviews.filter((iv) => isDomainInterview(iv) && iv.domainId === domainId && iv.grade?.score != null),
      (iv) => tsSeconds(iv.endedAt)
    );
    const impact = trainingImpact(history, domainCompletions, domainId);
    const misses = missedByDomain[domainId] ?? [];

    let kind = 'module';
    let label = 'Review the training module';
    const reasons = [`${domainId} is ${assignment.level} (${row.scores?.[domainId] ?? 0}%).`];

    if (!hasPractice) {
      kind = 'practice';
      label = 'Complete a Spot the Error practice scenario';
      reasons.push('No completed practice scenario is recorded for this domain.');
    } else if (!latestInterview || latestInterview.grade.score < INTERVIEW_SCORE_BANDS.good) {
      kind = 'interview';
      label = 'Complete a practice call';
      reasons.push(latestInterview ? `Latest practice call was ${latestInterview.grade.score}/100.` : 'No graded practice call is recorded.');
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
      module: assignment.module,
      reasons,
      evidence: {
        score: row.scores?.[domainId] ?? 0,
        level: assignment.level,
        missedQuestions: misses,
        completionCount: domainCompletions.length,
        latestInterviewScore: latestInterview?.grade?.score ?? null,
        trainingImpact: impact,
      },
    };
  });
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
 * Suggested mentors for one navigator: for each domain where they are not yet
 * Can-Teach, list colleagues who can teach it (excluding themselves).
 * @returns {{domainId:string, level:string, mentors:string[]}[]}
 */
export function mentorSuggestions(rows, name) {
  const me = findRow(rows, name);
  if (!me) return [];
  const roster = canTeachRoster(rows);
  return DOMAINS.filter((d) => me.levels[d.id] !== 'canTeach')
    .map((d) => ({
      domainId: d.id,
      level: me.levels[d.id],
      mentors: roster[d.id].filter((n) => n !== name),
    }))
    .filter((x) => x.mentors.length > 0)
    // surface the biggest gaps first (Learning before Solid)
    .sort((a, b) => (a.level === 'learning' ? -1 : 1) - (b.level === 'learning' ? -1 : 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// LONGITUDINAL TRENDS (Feature 1)
// ─────────────────────────────────────────────────────────────────────────────

/** Mean of all domain scores, or 0 if empty. */
function computeOverall(scores) {
  if (!scores) return 0;
  const vals = DOMAINS.map((d) => scores[d.id]).filter((v) => typeof v === 'number');
  if (vals.length === 0) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function formatTrendLabel(ts) {
  if (!ts) return '—';
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date((ts.seconds ?? 0) * 1000);
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
    overall: computeOverall(h.scores),
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
        overall: computeOverall(synScores),
        simulated: true,
      });
    }
  }

  const points = [...syntheticPoints, ...realPoints];
  const domainSeries = {};
  for (const d of DOMAINS) domainSeries[d.id] = points.map((p) => p.scores[d.id] ?? 0);
  return { points, domainSeries, overallSeries: points.map((p) => p.overall) };
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
    .map((c) => c.completedAt?.seconds ?? 0)
    .sort((a, b) => a - b)[0];

  if (firstTs == null) return { before: null, after: null, delta: null };

  const realHistory = history.filter((h) => !h.simulated);
  const before = [...realHistory].filter((h) => (h.takenAt?.seconds ?? 0) <= firstTs).pop();
  const after = realHistory.find((h) => (h.takenAt?.seconds ?? 0) > firstTs);

  const b = before?.scores?.[domainId] ?? null;
  const a = after?.scores?.[domainId] ?? null;
  if (b === null || a === null) return { before: null, after: null, delta: null };
  return { before: b, after: a, delta: a - b };
}

/**
 * Floor-level trend: solidPlusRate and avgReadiness over time.
 * Groups all history snapshots chronologically; for each distinct timestamp,
 * builds the floor state using each navigator's latest snapshot up to that point.
 *
 * @param {object[]} allHistory  subscribeResultHistory() output (all navigators)
 * @returns {{ ts:number, label:string, solidPlusRate:number, avgReadiness:number, assessed:number }[]}
 */
export function teamTrend(allHistory) {
  if (allHistory.length === 0) return [];
  const timePoints = [...new Set(allHistory.map((h) => h.takenAt?.seconds ?? 0))].sort((a, b) => a - b);
  const navIds = [...new Set(allHistory.map((h) => h.navigatorId))];

  return timePoints.map((ts) => {
    const snapshots = navIds
      .map((navId) =>
        allHistory
          .filter((h) => h.navigatorId === navId && (h.takenAt?.seconds ?? 0) <= ts)
          .sort((a, b) => (b.takenAt?.seconds ?? 0) - (a.takenAt?.seconds ?? 0))[0]
      )
      .filter(Boolean);

    if (snapshots.length === 0) return null;
    const rows = snapshots.map((s) => ({
      name: s.name,
      isLive: false,
      scores: s.scores ?? {},
      levels: Object.fromEntries(DOMAINS.map((d) => [d.id, scoreToLevel(s.scores?.[d.id] ?? 0)])),
      competencyScores: s.competencyScores ?? {},
      competencyLevels: {},
    }));
    const stats = floorStats(rows);
    return {
      ts,
      label: formatTrendLabel({ seconds: ts }),
      solidPlusRate: stats.solidPlusRate,
      avgReadiness: parseFloat(stats.avgReadiness.toFixed(1)),
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
 * Returns five categorized lists; each item identifies the navigator and reason.
 *
 * @param {object[]} rows      buildMatrixRows output
 * @param {{ history?: object[], interviews?: object[], completions?: object[] }} [opts]
 * @returns {{
 *   criticalGaps:   {name,reason,domainId,severity}[],
 *   trainingOverdue:{name,reason,domainId,severity}[],
 *   decliningTrends:{name,reason,delta,severity}[],
 *   failedPractice: {name,reason,domainId,score,interviewId,severity}[],
 *   readyForMore:   {name,reason,canTeachCount,severity}[],
 * }}
 */
export function buildActionCenter(rows, { history = [], interviews = [], completions = [] } = {}) {
  const criticalGaps = [];
  const trainingOverdue = [];
  const decliningTrends = [];
  const failedPractice = [];
  const readyForMore = [];

  const tally = readinessTally(rows);

  for (const row of rows) {
    for (const d of DOMAINS) {
      if (row.levels[d.id] === 'learning') {
        criticalGaps.push({ name: row.name, reason: `Learning in ${d.id}`, domainId: d.id, severity: 'high' });
      }
    }

    const training = trainingForRow(row);
    const navCompleted = new Set(
      completions
        .filter((c) => c.name === row.name && (!c.kind || c.kind === 'practice'))
        .map((c) => c.domainId)
    );
    for (const a of training) {
      if (a.priority === 'Required' && !navCompleted.has(a.domainId)) {
        trainingOverdue.push({ name: row.name, reason: `Required training pending: ${a.domainId}`, domainId: a.domainId, severity: 'medium' });
      }
    }

    const navHistory = history
      .filter((h) => h.name === row.name && !h.simulated)
      .sort((a, b) => (a.takenAt?.seconds ?? 0) - (b.takenAt?.seconds ?? 0));
    if (navHistory.length >= 2) {
      const prev = computeOverall(navHistory[navHistory.length - 2].scores);
      const curr = computeOverall(navHistory[navHistory.length - 1].scores);
      if (curr < prev - 5) {
        decliningTrends.push({ name: row.name, reason: `Overall dropped ${prev - curr} points`, delta: curr - prev, severity: 'medium' });
      }
    }
  }

  for (const iv of interviews) {
    if (!isDomainInterview(iv)) continue;
    if (iv.grade?.score != null && iv.grade.score < INTERVIEW_SCORE_BANDS.fair) {
      const row = rows.find((r) => r.name === iv.name);
      if (row) {
        failedPractice.push({
          name: iv.name,
          reason: `Practice score ${iv.grade.score}/100`,
          domainId: iv.domainId,
          score: iv.grade.score,
          interviewId: iv.id ?? `${iv.name}-${iv.domainId}-${iv.endedAt?.seconds ?? 'practice'}`,
          severity: 'medium',
        });
      }
    }
  }

  const avgCanTeach = tally.length > 0 ? tally.reduce((s, t) => s + t.canTeachCount, 0) / tally.length : 0;
  for (const t of tally) {
    if (t.canTeachCount >= Math.ceil(avgCanTeach) + 1 && t.canTeachCount >= 3) {
      readyForMore.push({
        name: t.name,
        reason: `Can-Teach in ${t.canTeachCount} of ${DOMAINS.length} domains`,
        canTeachCount: t.canTeachCount,
        severity: 'info',
      });
    }
  }

  return { criticalGaps, trainingOverdue, decliningTrends, failedPractice, readyForMore };
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
  return trainingForRow(row).map(({ domainId, level, priority }) => {
    const hasPractice = completions.some((c) => c.domainId === domainId && (!c.kind || c.kind === 'practice'));
    const hasInterview = interviews.some((iv) => isDomainInterview(iv) && iv.domainId === domainId && iv.grade?.score != null);
    const hasMiniCheck = completions.some((c) => c.domainId === domainId && c.kind === 'minicheck');

    const steps = [
      { kind: 'coaching',   label: 'Review coaching notes',     status: 'done' },
      { kind: 'practice',   label: 'Spot the Error scenario',   status: hasPractice ? 'done' : 'next' },
      { kind: 'interview',  label: 'Practice call',             status: hasInterview ? 'done' : hasPractice ? 'next' : 'todo' },
      { kind: 'module',     label: 'Training module',           status: hasMiniCheck ? 'done' : (hasPractice || hasInterview) ? 'next' : 'todo' },
      { kind: 'minicheck',  label: 'Mini domain check',         status: hasMiniCheck ? 'done' : (hasPractice || hasInterview) ? 'next' : 'todo' },
    ];

    return {
      domainId,
      level,
      priority,
      steps,
      percentComplete: Math.round((steps.filter((s) => s.status === 'done').length / steps.length) * 100),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MENTOR MATCHING (Feature 5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build load-balanced mentor-mentee pairings for all domains.
 * Assigns each Learning/Solid navigator to the least-loaded Can-Teach mentor,
 * capped at maxLoad. Learning navigators are prioritized over Solid.
 *
 * @param {object[]} rows
 * @param {{ maxLoad?: number }} [opts]
 * @returns {{
 *   pairings: {domainId, mentorName, menteeName, menteeLevel, baselineScore}[],
 *   load: Record<string, number>,
 *   unmatched: {domainId, menteeName, menteeLevel}[],
 * }}
 */
export function buildMentorMatches(rows, { maxLoad = MENTOR_MAX_LOAD } = {}) {
  const pairings = [];
  const unmatched = [];
  const load = {}; // mentorName → total pairings assigned

  for (const d of DOMAINS) {
    const mentors = rows.filter((r) => r.levels[d.id] === 'canTeach').map((r) => r.name);
    const mentees = rows
      .filter((r) => r.levels[d.id] !== 'canTeach')
      .sort((a, b) => {
        const order = { learning: 0, solid: 1 };
        return (order[a.levels[d.id]] ?? 2) - (order[b.levels[d.id]] ?? 2);
      });

    if (mentors.length === 0) {
      for (const mentee of mentees) {
        unmatched.push({ domainId: d.id, menteeName: mentee.name, menteeLevel: mentee.levels[d.id] });
      }
      continue;
    }

    for (const mentee of mentees) {
      const available = mentors
        .map((m) => ({ name: m, currentLoad: load[m] ?? 0 }))
        .filter((m) => m.currentLoad < maxLoad)
        .sort((a, b) => a.currentLoad - b.currentLoad);

      if (available.length === 0) {
        unmatched.push({ domainId: d.id, menteeName: mentee.name, menteeLevel: mentee.levels[d.id] });
        continue;
      }

      const mentor = available[0];
      load[mentor.name] = (load[mentor.name] ?? 0) + 1;
      pairings.push({
        domainId: d.id,
        mentorName: mentor.name,
        menteeName: mentee.name,
        menteeLevel: mentee.levels[d.id],
        baselineScore: mentee.scores?.[d.id] ?? 0,
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
    const delta = currentScore !== null ? currentScore - (p.baselineScore ?? 0) : null;
    return { ...p, currentScore, delta, improved: delta !== null && delta > 0 };
  });
}
