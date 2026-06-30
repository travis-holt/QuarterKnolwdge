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
 * Points earned for one question given the chosen option.
 * Uses the option's `points` (partial credit) when present; falls back to a
 * binary 100/0 against `correctOptionId` for legacy/ungraded options. An absent
 * or invalid answer earns 0.
 * @param {string|undefined} answer - chosen optionId
 * @param {object} question
 * @returns {number} 0–100
 */
function earnedPoints(answer, question) {
  const opt = question.options?.find((o) => o.id === answer);
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
    const points = typeof chosenOpt.points === 'number' ? chosenOpt.points : (isCorrect ? 100 : 0);
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
        .filter((iv) => iv.domainId === d.id)
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
 *   failedPractice: {name,reason,domainId,severity}[],
 *   readyForMore:   {name,reason,severity}[],
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
      completions.filter((c) => c.name === row.name).map((c) => c.domainId)
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
    if (iv.grade?.score != null && iv.grade.score < INTERVIEW_SCORE_BANDS.fair) {
      const row = rows.find((r) => r.name === iv.name);
      if (row) {
        failedPractice.push({ name: iv.name, reason: `Practice score ${iv.grade.score}/100`, domainId: iv.domainId, severity: 'medium' });
      }
    }
  }

  const avgCanTeach = tally.length > 0 ? tally.reduce((s, t) => s + t.canTeachCount, 0) / tally.length : 0;
  for (const t of tally) {
    if (t.canTeachCount >= Math.ceil(avgCanTeach) + 1 && t.canTeachCount >= 3) {
      readyForMore.push({ name: t.name, reason: `Can-Teach in ${t.canTeachCount} of ${DOMAINS.length} domains`, severity: 'info' });
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
    const hasInterview = interviews.some((iv) => iv.domainId === domainId && iv.grade?.score != null);
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
