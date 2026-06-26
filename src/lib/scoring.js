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

import { THRESHOLDS, LEVELS, COLUMN_GAP_THRESHOLD, TRAINING_RULES } from '../data/config.js';
import { DOMAINS, SEED_QUESTIONS } from '../data/questions.js';
import { COMPETENCIES } from '../data/competencies.js';
import { moduleForDomain } from '../data/training.js';
import { DEPARTMENTS } from '../data/departments.js';

/**
 * Points earned for one question given the chosen option.
 * Uses the option's `points` (partial credit) when present; falls back to a
 * binary 100/0 against `correctOptionId` for legacy/ungraded options. An absent
 * or invalid answer earns 0.
 * @param {string|undefined} answer - chosen optionId
 * @param {object} question
 * @returns {number} 0–100
 */
function earnedPoints(answer, question) {
  const opt = question.options.find((o) => o.id === answer);
  if (!opt) return 0;
  if (typeof opt.points === 'number') return opt.points;
  return answer === question.correctOptionId ? 100 : 0;
}

/**
 * Score a set of answers into a per-domain map (0–100), averaging earned points
 * across each domain's questions.
 * @param {Record<string,string>} answers - questionId -> chosen optionId
 * @param {object[]} [questions] - the active question bank (defaults to the seed)
 * @returns {Record<string,number>} domainId -> score (0–100, rounded)
 */
export function scorePerDomain(answers, questions = SEED_QUESTIONS) {
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
export function scorePerCompetency(answers, questions = SEED_QUESTIONS) {
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
