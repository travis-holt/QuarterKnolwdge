import { COMPETENCIES } from '../data/competencies.js';
import { DOMAINS } from '../data/questions.js';
import { QA_RUBRIC, rubricCriteria } from '../data/qaRubric.js';

function initBuckets(items) {
  return Object.fromEntries(items.map((item) => [item.id, null]));
}

function roundDetail(value) {
  return Math.round(value * 100) / 100;
}

function scoreQaByTag(qa, tagKey, items, rubric = QA_RUBRIC) {
  const criteria = Array.isArray(qa?.criteria) ? qa.criteria : [];
  const verdicts = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const scores = initBuckets(items);

  for (const def of rubricCriteria(rubric)) {
    const verdict = verdicts.get(def.id)?.verdict;
    if (!verdict || verdict === 'NA') continue;
    const tagIds = def[tagKey] ?? [];
    if (!tagIds.length) continue;
    const share = def.points / tagIds.length;
    for (const tagId of tagIds) {
      const current = scores[tagId] ?? { earned: 0, possible: 0, criteria: [] };
      current.possible += share;
      if (verdict === 'MET') current.earned += share;
      current.criteria.push(def.id);
      scores[tagId] = current;
    }
  }

  for (const item of items) {
    const detail = scores[item.id];
    if (!detail || detail.possible === 0) {
      scores[item.id] = null;
      continue;
    }
    scores[item.id] = {
      earned: roundDetail(detail.earned),
      possible: roundDetail(detail.possible),
      score: Math.round((detail.earned / detail.possible) * 100),
      criteria: detail.criteria,
    };
  }

  return scores;
}

export function scoreQaByDomain(qa, rubric = QA_RUBRIC) {
  return scoreQaByTag(qa, 'domainIds', DOMAINS, rubric);
}

export function scoreQaByCompetency(qa, rubric = QA_RUBRIC) {
  return scoreQaByTag(qa, 'competencyIds', COMPETENCIES, rubric);
}

export function qaDomainScoreSummary(qa, rubric = QA_RUBRIC) {
  return {
    domainScores: scoreQaByDomain(qa, rubric),
    competencyScores: scoreQaByCompetency(qa, rubric),
  };
}
