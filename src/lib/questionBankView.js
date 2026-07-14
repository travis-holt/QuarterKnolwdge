// Pure, render-free helpers for the supervisor Question Bank workspace
// (src/components/QuestionBank.jsx + friends). Kept here so filtering/sorting/
// status-count/navigation logic can be unit tested without mounting React.
//
// Nothing here mutates Firestore, scores, or the question shape — it only
// derives view state (which questions are visible, in what order, and which
// tab/row is "current") from the existing question/health data.

import { compareTimestampValues } from './time.js';

export const STATUS_TABS = ['draft', 'active', 'archived'];

export const TAB_LABELS = {
  draft: 'Review Queue',
  active: 'Active',
  archived: 'Archived',
};

/** Question status, defaulting to 'active' the same way the old QuestionBank did. */
export function questionStatus(q) {
  return q?.status ?? 'active';
}

/** { draft, active, archived } counts for a (already department-scoped) question list. */
export function statusCounts(questions = []) {
  const counts = { draft: 0, active: 0, archived: 0 };
  for (const q of questions) {
    const s = questionStatus(q);
    if (counts[s] !== undefined) counts[s] += 1;
  }
  return counts;
}

/** Review Queue if it has anything to review, otherwise Active. */
export function defaultStatusTab(counts) {
  return counts.draft > 0 ? 'draft' : 'active';
}

/**
 * Health status for a single question, tolerant of questions with no computed
 * health entry (drafts/archived items never get live health data). Never
 * reports 'healthy' for a question that simply hasn't been measured.
 */
export function getHealthStatus(question, health = {}) {
  return health?.[question.id]?.status ?? 'notLive';
}

export const HEALTH_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'healthy', label: 'Healthy' },
  { id: 'review', label: 'Needs review' },
  { id: 'insufficient', label: 'Insufficient data' },
  { id: 'notLive', label: 'Not live' },
];

function normalize(text) {
  return String(text ?? '').toLowerCase();
}

/** Case-insensitive match across scenario text, question id, and option text. */
export function matchesSearch(question, query) {
  const q = normalize(query).trim();
  if (!q) return true;
  if (normalize(question.scenario).includes(q)) return true;
  if (normalize(question.id).includes(q)) return true;
  return (question.options ?? []).some((o) => normalize(o.text).includes(q));
}

/**
 * Filter a question list by search text, domain, competency, and health
 * status. Returns a new array; never mutates the input.
 */
export function filterQuestions(questions = [], filters = {}, health = {}) {
  const { search = '', domainId = 'all', competencyId = 'all', healthFilter = 'all' } = filters;
  return questions.filter((q) => {
    if (!matchesSearch(q, search)) return false;
    if (domainId !== 'all' && q.domainId !== domainId) return false;
    if (competencyId !== 'all' && !(q.competencies ?? []).includes(competencyId)) return false;
    if (healthFilter !== 'all' && getHealthStatus(q, health) !== healthFilter) return false;
    return true;
  });
}

// Labels say "created" (not "updated") because sorting uses `createdAt` — questions
// have no maintained `updatedAt` field. Don't rename the ids (existing state/urls/
// tests key on them); just keep the label honest about what's actually sorted.
export const SORT_OPTIONS = [
  { id: 'updatedDesc', label: 'Newest created' },
  { id: 'updatedAsc', label: 'Oldest created' },
  { id: 'domain', label: 'Domain' },
  { id: 'id', label: 'Question ID' },
  { id: 'correctRateAsc', label: 'Lowest correct rate' },
  { id: 'correctRateDesc', label: 'Highest correct rate' },
  { id: 'responseCountDesc', label: 'Most responses' },
];

/** True if a sort mode is meaningful for the given questions (i.e. some have health data). */
export function isHealthSortAvailable(questions = [], health = {}) {
  return questions.some((q) => health?.[q.id]);
}

/**
 * Sort a question list. Always returns a NEW array (never sorts in place),
 * so callers holding the original reference are unaffected. Health-based
 * sorts always place questions with no health data after ones that have it —
 * never mislabeled as a 0% or 100% correct rate.
 */
export function sortQuestions(questions = [], sortMode = 'updatedDesc', health = {}) {
  const copy = [...questions];
  const hasHealth = (q) => Boolean(health?.[q.id]);

  switch (sortMode) {
    case 'updatedAsc':
      return copy.sort((a, b) => compareTimestampValues(a.createdAt, b.createdAt));
    case 'domain':
      return copy.sort((a, b) => String(a.domainId ?? '').localeCompare(String(b.domainId ?? '')));
    case 'id':
      return copy.sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
    case 'correctRateAsc':
      return copy.sort((a, b) => {
        if (hasHealth(a) !== hasHealth(b)) return hasHealth(a) ? -1 : 1;
        if (!hasHealth(a)) return 0;
        return health[a.id].correctRate - health[b.id].correctRate;
      });
    case 'correctRateDesc':
      return copy.sort((a, b) => {
        if (hasHealth(a) !== hasHealth(b)) return hasHealth(a) ? -1 : 1;
        if (!hasHealth(a)) return 0;
        return health[b.id].correctRate - health[a.id].correctRate;
      });
    case 'responseCountDesc':
      return copy.sort((a, b) => {
        if (hasHealth(a) !== hasHealth(b)) return hasHealth(a) ? -1 : 1;
        if (!hasHealth(a)) return 0;
        return health[b.id].responseCount - health[a.id].responseCount;
      });
    case 'updatedDesc':
    default:
      return copy.sort((a, b) => compareTimestampValues(b.createdAt, a.createdAt));
  }
}

/** True when any search/filter/sort value differs from the defaults. */
export function hasActiveFilters({ search = '', domainId = 'all', competencyId = 'all', healthFilter = 'all' }) {
  return Boolean(search.trim()) || domainId !== 'all' || competencyId !== 'all' || healthFilter !== 'all';
}

/** id of the question that should stay/become expanded after the visible list changes. */
export function nextExpandedId(visibleQuestions, expandedId) {
  if (!expandedId) return null;
  return visibleQuestions.some((q) => q.id === expandedId) ? expandedId : null;
}

/** Index (0-based) of a question id within a list, or -1. */
export function indexOfQuestion(list, id) {
  return list.findIndex((q) => q.id === id);
}

/** id of the previous/next question relative to `currentId`, or null at the ends. */
export function adjacentQuestionId(list, currentId, direction) {
  const idx = indexOfQuestion(list, currentId);
  if (idx === -1) return null;
  const nextIdx = idx + direction;
  if (nextIdx < 0 || nextIdx >= list.length) return null;
  return list[nextIdx].id;
}
