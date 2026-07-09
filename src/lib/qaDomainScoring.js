import { COMPETENCIES } from '../data/competencies.js';
import { DOMAINS } from '../data/questions.js';
import { QA_RUBRIC, QA_AUTO_FAILS, rubricCriteria } from '../data/qaRubric.js';

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

  return applyAutoFails(scores, qa, tagKey);
}

// Fold VERIFIED auto-fails into the per-tag summary. `qa.autoFails` is already
// the verified-only list produced by scoreQa (evidence-checked server-side); we
// never re-decide whether a fail is verified here. Any domain/competency tagged
// on a verified auto-fail is forced to score 0 with autoFailed:true so a
// supervisor can never see an affected tag as a clean, high, "normal" score.
// QA-only — never touches the capability matrix or the pass/fail math.
function applyAutoFails(scores, qa, tagKey, autoFailDefs = QA_AUTO_FAILS) {
  const verified = Array.isArray(qa?.autoFails) ? qa.autoFails : [];
  if (!verified.length) return scores;

  const defsById = new Map(autoFailDefs.map((a) => [a.id, a]));

  for (const fail of verified) {
    const def = defsById.get(fail?.id);
    if (!def) continue;
    const tagIds = def[tagKey] ?? [];
    const entry = { id: def.id, text: def.text };
    for (const tagId of tagIds) {
      if (!(tagId in scores)) continue; // unknown tag id — ignore
      const existing = scores[tagId];
      if (existing && existing.autoFailed) {
        existing.autoFails.push(entry);
        continue;
      }
      scores[tagId] = existing
        ? { ...existing, earned: 0, score: 0, autoFailed: true, autoFails: [entry] }
        : { earned: 0, possible: 0, score: 0, criteria: [], autoFailed: true, autoFails: [entry] };
    }
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
