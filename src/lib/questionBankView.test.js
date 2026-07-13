import { describe, it, expect } from 'vitest';
import {
  statusCounts,
  defaultStatusTab,
  getHealthStatus,
  matchesSearch,
  filterQuestions,
  sortQuestions,
  hasActiveFilters,
  nextExpandedId,
  adjacentQuestionId,
  indexOfQuestion,
} from './questionBankView.js';

const q = (overrides) => ({ id: 'q1', scenario: 'text', domainId: 'intake', competencies: [], options: [], ...overrides });

describe('questionBankView — statusCounts / defaultStatusTab', () => {
  it('counts by status, defaulting to active', () => {
    const counts = statusCounts([q({ status: 'draft' }), q({ status: 'active' }), q({})]);
    expect(counts).toEqual({ draft: 1, active: 2, archived: 0 });
  });

  it('defaults to draft tab when drafts exist, else active', () => {
    expect(defaultStatusTab({ draft: 1, active: 0, archived: 0 })).toBe('draft');
    expect(defaultStatusTab({ draft: 0, active: 5, archived: 0 })).toBe('active');
  });
});

describe('questionBankView — getHealthStatus', () => {
  it('returns notLive when there is no health entry', () => {
    expect(getHealthStatus(q({}), {})).toBe('notLive');
  });
  it('returns the computed status when present', () => {
    expect(getHealthStatus(q({}), { q1: { status: 'healthy' } })).toBe('healthy');
  });
});

describe('questionBankView — matchesSearch / filterQuestions', () => {
  it('matches scenario, id, and option text case-insensitively', () => {
    const question = q({ id: 'ABC', scenario: 'Refill request', options: [{ id: 'a', text: 'Zephyr' }] });
    expect(matchesSearch(question, 'refill')).toBe(true);
    expect(matchesSearch(question, 'abc')).toBe(true);
    expect(matchesSearch(question, 'zephyr')).toBe(true);
    expect(matchesSearch(question, 'nomatch')).toBe(false);
  });

  it('empty search matches everything', () => {
    expect(matchesSearch(q({}), '')).toBe(true);
  });

  it('filters by domain, competency, and health without mutating the input', () => {
    const list = [
      q({ id: 'a', domainId: 'intake', competencies: ['sopKnowledge'] }),
      q({ id: 'b', domainId: 'routing', competencies: ['communication'] }),
    ];
    const copy = [...list];
    const result = filterQuestions(list, { domainId: 'routing' }, {});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
    expect(list).toEqual(copy);
  });
});

describe('questionBankView — sortQuestions', () => {
  it('never mutates the original array', () => {
    const list = [q({ id: 'b' }), q({ id: 'a' })];
    const originalRefs = [...list];
    const sorted = sortQuestions(list, 'id', {});
    expect(sorted).not.toBe(list);
    expect(list).toEqual(originalRefs);
    expect(sorted.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('places questions with no health data after ones with health data on health sorts', () => {
    const list = [q({ id: 'noHealth' }), q({ id: 'healthy' })];
    const health = { healthy: { correctRate: 0.5, responseCount: 20 } };
    const sorted = sortQuestions(list, 'correctRateDesc', health);
    expect(sorted[0].id).toBe('healthy');
    expect(sorted[1].id).toBe('noHealth');
  });

  it('sorts by domain and by id', () => {
    const list = [q({ id: 'b', domainId: 'z' }), q({ id: 'a', domainId: 'a' })];
    expect(sortQuestions(list, 'domain', {}).map((x) => x.id)).toEqual(['a', 'b']);
    expect(sortQuestions(list, 'id', {}).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('questionBankView — hasActiveFilters', () => {
  it('is false at defaults, true when any filter changes', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ search: 'x' })).toBe(true);
    expect(hasActiveFilters({ domainId: 'intake' })).toBe(true);
    expect(hasActiveFilters({ competencyId: 'communication' })).toBe(true);
    expect(hasActiveFilters({ healthFilter: 'review' })).toBe(true);
  });
});

describe('questionBankView — expansion/navigation helpers', () => {
  it('nextExpandedId clears an id no longer in the visible list', () => {
    const visible = [q({ id: 'a' })];
    expect(nextExpandedId(visible, 'a')).toBe('a');
    expect(nextExpandedId(visible, 'gone')).toBe(null);
    expect(nextExpandedId(visible, null)).toBe(null);
  });

  it('indexOfQuestion / adjacentQuestionId navigate a list safely', () => {
    const list = [q({ id: 'a' }), q({ id: 'b' }), q({ id: 'c' })];
    expect(indexOfQuestion(list, 'b')).toBe(1);
    expect(adjacentQuestionId(list, 'b', 1)).toBe('c');
    expect(adjacentQuestionId(list, 'b', -1)).toBe('a');
    expect(adjacentQuestionId(list, 'a', -1)).toBe(null);
    expect(adjacentQuestionId(list, 'c', 1)).toBe(null);
    expect(adjacentQuestionId(list, 'missing', 1)).toBe(null);
  });
});
