// ─────────────────────────────────────────────────────────────────────────────
// UNIT TESTS for lib/scoring.js — the pure logic layer.
//
// Design notes:
//  - Fixtures are built from the REAL data modules (DOMAINS, QUESTIONS, …) so the
//    tests track the actual content rather than a parallel copy that can drift.
//  - Level boundaries are asserted RELATIVE to THRESHOLDS (not hard-coded 60/85),
//    so re-banding the "knobs" in config.js does not break these tests.
//  - Read-off / analytics tests use small synthetic matrices with hand-computed
//    expectations, kept independent of the editable SAMPLE_NAVIGATORS values.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';

import {
  scorePerDomain,
  scoreToLevel,
  levelFor,
  buildMatrixRows,
  deptSamples,
  departmentOverall,
  departmentMatrix,
  columnGaps,
  canTeachRoster,
  readinessTally,
  floorStats,
  domainDistribution,
  findRow,
  trainingForRow,
  trainingPlan,
  trainingByDomain,
  trainingStats,
  mentorSuggestions,
} from './scoring.js';

import { THRESHOLDS, LEVELS, COLUMN_GAP_THRESHOLD } from '../data/config.js';
import { DOMAINS, QUESTIONS } from '../data/questions.js';
import { DEPARTMENTS, ASSESSED_DEPT } from '../data/departments.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const DOMAIN_IDS = DOMAINS.map((d) => d.id);

const wrongOptionFor = (q) => q.options.find((o) => o.id !== q.correctOptionId).id;
const allCorrectAnswers = () =>
  Object.fromEntries(QUESTIONS.map((q) => [q.id, q.correctOptionId]));
const allWrongAnswers = () =>
  Object.fromEntries(QUESTIONS.map((q) => [q.id, wrongOptionFor(q)]));
const questionsInDomain = (domainId) => QUESTIONS.filter((q) => q.domainId === domainId);

// Representative score for each band, expressed relative to the thresholds so the
// tests stay correct if the thresholds move.
const LEARN = THRESHOLDS.learning - 10; // below learning floor
const SOLID = THRESHOLDS.learning + 5; // between the two thresholds
const TEACH = THRESHOLDS.canTeach + 5; // at/above can-teach floor

// Build a full per-domain score map over DOMAINS, overriding some, filling rest.
const makeScores = (overrides = {}, fill = SOLID) =>
  Object.fromEntries(DOMAINS.map((d) => [d.id, overrides[d.id] ?? fill]));

// A deterministic 4-navigator matrix used across the read-off/analytics tests.
// Columns are DOMAINS in order: [sites, scheduling, providers, routing, insurance, registration]
const [D0, D1, D2, D3, D4, D5] = DOMAIN_IDS;
const FIXTURE_SAMPLES = [
  { name: 'Ada', scores: makeScores({ [D0]: LEARN, [D1]: SOLID, [D2]: TEACH, [D3]: TEACH, [D4]: SOLID, [D5]: LEARN }) },
  { name: 'Bea', scores: makeScores({ [D0]: LEARN, [D1]: SOLID, [D2]: SOLID, [D3]: TEACH, [D4]: LEARN, [D5]: SOLID }) },
  { name: 'Cyd', scores: makeScores({ [D0]: LEARN, [D1]: TEACH, [D2]: SOLID, [D3]: SOLID, [D4]: SOLID, [D5]: SOLID }) },
  { name: 'Dot', scores: makeScores({ [D0]: TEACH, [D1]: SOLID, [D2]: SOLID, [D3]: LEARN, [D4]: TEACH, [D5]: TEACH }) },
];
const fixtureRows = () => buildMatrixRows(FIXTURE_SAMPLES, null);

// ── scorePerDomain ───────────────────────────────────────────────────────────

describe('scorePerDomain', () => {
  it('returns exactly one entry per domain', () => {
    const scores = scorePerDomain({});
    expect(Object.keys(scores).sort()).toEqual([...DOMAIN_IDS].sort());
  });

  it('scores every domain 100 when all answers are correct', () => {
    const scores = scorePerDomain(allCorrectAnswers());
    for (const id of DOMAIN_IDS) expect(scores[id]).toBe(100);
  });

  it('scores every domain 0 when all answers are wrong', () => {
    const scores = scorePerDomain(allWrongAnswers());
    for (const id of DOMAIN_IDS) expect(scores[id]).toBe(0);
  });

  it('treats unanswered questions as incorrect (empty answers → all 0)', () => {
    const scores = scorePerDomain({});
    for (const id of DOMAIN_IDS) expect(scores[id]).toBe(0);
  });

  it('rounds partial domain results and leaves other domains untouched', () => {
    const answers = allCorrectAnswers();
    const sitesQs = questionsInDomain('sites');
    // flip exactly one question in the "sites" domain
    answers[sitesQs[0].id] = wrongOptionFor(sitesQs[0]);

    const scores = scorePerDomain(answers);
    const expected = Math.round(((sitesQs.length - 1) / sitesQs.length) * 100);
    expect(scores.sites).toBe(expected);
    // all other domains remain perfect
    for (const id of DOMAIN_IDS.filter((d) => d !== 'sites')) {
      expect(scores[id]).toBe(100);
    }
  });
});

// ── scoreToLevel / levelFor ──────────────────────────────────────────────────

describe('scoreToLevel', () => {
  it('maps below the learning threshold to "learning"', () => {
    expect(scoreToLevel(THRESHOLDS.learning - 1)).toBe('learning');
    expect(scoreToLevel(0)).toBe('learning');
  });

  it('maps the learning threshold (inclusive) up to canTeach-1 to "solid"', () => {
    expect(scoreToLevel(THRESHOLDS.learning)).toBe('solid');
    expect(scoreToLevel(THRESHOLDS.canTeach - 1)).toBe('solid');
  });

  it('maps the canTeach threshold (inclusive) and above to "canTeach"', () => {
    expect(scoreToLevel(THRESHOLDS.canTeach)).toBe('canTeach');
    expect(scoreToLevel(100)).toBe('canTeach');
  });
});

describe('levelFor', () => {
  it('returns the full level descriptor for a percentage', () => {
    expect(levelFor(TEACH)).toBe(LEVELS.canTeach);
    expect(levelFor(SOLID)).toBe(LEVELS.solid);
    expect(levelFor(LEARN)).toBe(LEVELS.learning);
    expect(levelFor(TEACH).label).toBe('Can-Teach');
  });
});

// ── buildMatrixRows ──────────────────────────────────────────────────────────

describe('buildMatrixRows', () => {
  it('builds one row per sample with derived levels and isLive=false', () => {
    const rows = buildMatrixRows(FIXTURE_SAMPLES, null);
    expect(rows).toHaveLength(FIXTURE_SAMPLES.length);
    expect(rows.every((r) => r.isLive === false)).toBe(true);
    expect(rows[0].levels[D0]).toBe('learning'); // Ada's sites = LEARN
    expect(rows[3].levels[D0]).toBe('canTeach'); // Dot's sites = TEACH
  });

  it('appends the live taker as a highlighted (isLive) final row', () => {
    const live = { name: 'You', scores: makeScores({}, TEACH) };
    const rows = buildMatrixRows(FIXTURE_SAMPLES, live);
    expect(rows).toHaveLength(FIXTURE_SAMPLES.length + 1);
    const last = rows[rows.length - 1];
    expect(last.isLive).toBe(true);
    expect(last.name).toBe('You');
  });

  it('defaults a missing domain score to 0 → "learning"', () => {
    const rows = buildMatrixRows([{ name: 'Sparse', scores: {} }], null);
    for (const id of DOMAIN_IDS) expect(rows[0].levels[id]).toBe('learning');
  });

  it('returns an empty array for no samples and no live taker', () => {
    expect(buildMatrixRows([], null)).toEqual([]);
  });
});

// ── deptSamples / departmentOverall / departmentMatrix ───────────────────────

describe('deptSamples', () => {
  const nested = [
    { name: 'Ada', departments: { pediatrics: makeScores({}, 80), adult: makeScores({}, 50) } },
    { name: 'Bea', departments: { pediatrics: makeScores({}, 70) } },
  ];

  it('flattens the chosen department into { name, scores }', () => {
    const flat = deptSamples(nested, 'pediatrics');
    expect(flat).toHaveLength(2);
    expect(flat[0]).toEqual({ name: 'Ada', scores: nested[0].departments.pediatrics });
  });

  it('returns empty scores when a navigator lacks the department', () => {
    const flat = deptSamples(nested, 'adult');
    expect(flat[1]).toEqual({ name: 'Bea', scores: {} });
  });
});

describe('departmentOverall', () => {
  it('returns the rounded mean of the domain scores', () => {
    expect(departmentOverall(makeScores({}, 80))).toBe(80);
    const mixed = makeScores({ [D0]: 90, [D1]: 60 }, 75); // 90,60,75,75,75,75 → 75
    expect(departmentOverall(mixed)).toBe(75);
  });

  it('returns null when there are no numeric scores', () => {
    expect(departmentOverall({})).toBeNull();
    expect(departmentOverall(undefined)).toBeNull();
  });
});

describe('departmentMatrix', () => {
  const nested = [
    {
      name: 'Ada',
      departments: {
        pediatrics: makeScores({}, TEACH),
        adult: makeScores({}, SOLID),
        obgyn: makeScores({}, LEARN),
        behavioral: makeScores({}, SOLID),
      },
    },
  ];

  it('gives each sample an overall + level for every department', () => {
    const [row] = departmentMatrix(nested, null);
    expect(row.isLive).toBe(false);
    for (const dep of DEPARTMENTS) {
      expect(row.depts[dep.id]).not.toBeNull();
      expect(typeof row.depts[dep.id].overall).toBe('number');
    }
    expect(row.depts.pediatrics.level).toBe('canTeach');
    expect(row.depts.obgyn.level).toBe('learning');
  });

  it('assesses the live taker only in ASSESSED_DEPT; other departments are null', () => {
    const live = { name: 'You', scores: makeScores({}, TEACH) };
    const rows = departmentMatrix(nested, live);
    const liveRow = rows[rows.length - 1];
    expect(liveRow.isLive).toBe(true);
    expect(liveRow.depts[ASSESSED_DEPT]).not.toBeNull();
    for (const dep of DEPARTMENTS.filter((d) => d.id !== ASSESSED_DEPT)) {
      expect(liveRow.depts[dep.id]).toBeNull();
    }
  });
});

// ── columnGaps / canTeachRoster / readinessTally ─────────────────────────────

describe('columnGaps', () => {
  it('flags only domains at/above the learning-share threshold', () => {
    const gaps = columnGaps(fixtureRows());
    // In the fixture, only D0 has a majority (3/4) at Learning.
    expect(gaps.map((g) => g.domainId)).toEqual([D0]);
    const gap = gaps[0];
    expect(gap.learningCount).toBe(3);
    expect(gap.total).toBe(4);
    expect(gap.share).toBeGreaterThanOrEqual(COLUMN_GAP_THRESHOLD);
  });

  it('returns no gaps for an empty matrix', () => {
    expect(columnGaps([])).toEqual([]);
  });
});

describe('canTeachRoster', () => {
  it('lists the can-teach navigators per domain', () => {
    const roster = canTeachRoster(fixtureRows());
    expect(roster[D0]).toEqual(['Dot']);
    expect(roster[D3].sort()).toEqual(['Ada', 'Bea']);
    expect(roster[D2]).toEqual(['Ada']);
  });

  it('returns an empty array per domain for an empty matrix', () => {
    const roster = canTeachRoster([]);
    for (const id of DOMAIN_IDS) expect(roster[id]).toEqual([]);
  });
});

describe('readinessTally', () => {
  it('counts can-teach cells per navigator, highest first', () => {
    const tally = readinessTally(fixtureRows());
    expect(tally).toHaveLength(4);
    expect(tally[0]).toMatchObject({ name: 'Dot', canTeachCount: 3 });
    expect(tally[1]).toMatchObject({ name: 'Ada', canTeachCount: 2 });
    // remaining two each have a single can-teach cell
    expect(tally[2].canTeachCount).toBe(1);
    expect(tally[3].canTeachCount).toBe(1);
  });

  it('is sorted in non-increasing order of canTeachCount', () => {
    const counts = readinessTally(fixtureRows()).map((t) => t.canTeachCount);
    const sorted = [...counts].sort((a, b) => b - a);
    expect(counts).toEqual(sorted);
  });
});

// ── floorStats / domainDistribution / findRow ────────────────────────────────

describe('floorStats', () => {
  it('computes headline floor metrics from the matrix', () => {
    const stats = floorStats(fixtureRows());
    expect(stats.assessed).toBe(4);
    expect(stats.totalDomains).toBe(DOMAINS.length);
    // 24 cells, 6 at Learning → 25% learning, 75% solid-or-better
    expect(stats.learningRate).toBe(25);
    expect(stats.solidPlusRate).toBe(75);
    // every domain has at least one teacher in the fixture
    expect(stats.coveredDomains).toBe(DOMAINS.length);
    // 7 total can-teach cells across 4 navigators
    expect(stats.avgReadiness).toBeCloseTo(7 / 4);
  });

  it('handles an empty matrix without dividing by zero', () => {
    const stats = floorStats([]);
    expect(stats).toMatchObject({
      assessed: 0,
      solidPlusRate: 0,
      learningRate: 0,
      coveredDomains: 0,
      avgReadiness: 0,
    });
  });
});

describe('domainDistribution', () => {
  it('returns per-domain level counts that sum to the row count', () => {
    const dist = domainDistribution(fixtureRows());
    expect(dist).toHaveLength(DOMAINS.length);
    const sites = dist.find((d) => d.domainId === D0);
    expect(sites).toMatchObject({ learning: 3, solid: 0, canTeach: 1, total: 4 });
    for (const d of dist) {
      expect(d.learning + d.solid + d.canTeach).toBe(d.total);
    }
  });
});

describe('findRow', () => {
  it('finds a row by name and returns null when absent', () => {
    const rows = fixtureRows();
    expect(findRow(rows, 'Ada').name).toBe('Ada');
    expect(findRow(rows, 'Nobody')).toBeNull();
  });
});

// ── training: trainingForRow / trainingPlan / trainingByDomain / trainingStats ─

describe('trainingForRow', () => {
  it('assigns Required for Learning and Stretch for Solid, none for Can-Teach', () => {
    const ada = findRow(fixtureRows(), 'Ada');
    const assignments = trainingForRow(ada);
    // Ada: D0/D5 Learning (Required), D1/D4 Solid (Stretch), D2/D3 Can-Teach (none)
    expect(assignments).toHaveLength(4);
    const byDomain = Object.fromEntries(assignments.map((a) => [a.domainId, a]));
    expect(byDomain[D0].priority).toBe('Required');
    expect(byDomain[D5].priority).toBe('Required');
    expect(byDomain[D1].priority).toBe('Stretch');
    expect(byDomain[D4].priority).toBe('Stretch');
    expect(byDomain[D2]).toBeUndefined();
    expect(byDomain[D3]).toBeUndefined();
  });

  it('orders Required items before Stretch items', () => {
    const ada = findRow(fixtureRows(), 'Ada');
    const priorities = trainingForRow(ada).map((a) => a.priority);
    expect(priorities).toEqual(['Required', 'Required', 'Stretch', 'Stretch']);
  });

  it('attaches the matching training module for each assignment', () => {
    const ada = findRow(fixtureRows(), 'Ada');
    for (const a of trainingForRow(ada)) {
      expect(a.module).not.toBeNull();
      expect(a.module.domainId).toBe(a.domainId);
    }
  });
});

describe('trainingPlan', () => {
  it('lists every navigator sorted by required-item count, descending', () => {
    const plan = trainingPlan(fixtureRows());
    expect(plan).toHaveLength(4);
    const counts = plan.map((p) => p.requiredCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(plan[0].requiredCount).toBe(2); // Ada and Bea both have 2 Required
  });
});

describe('trainingByDomain', () => {
  it('groups required/stretch cohorts per domain and drops empty domains', () => {
    const byDomain = trainingByDomain(fixtureRows());
    const sites = byDomain.find((d) => d.domainId === D0);
    expect(sites.required.sort()).toEqual(['Ada', 'Bea', 'Cyd']);
    expect(sites.stretch).toEqual([]); // Dot is Can-Teach, not assigned
    expect(sites.module.domainId).toBe(D0);
    // every returned domain has at least one assigned navigator
    for (const d of byDomain) {
      expect(d.required.length + d.stretch.length).toBeGreaterThan(0);
    }
  });
});

describe('trainingStats', () => {
  it('totals required/stretch counts and affected navigators/domains', () => {
    const stats = trainingStats(fixtureRows());
    // 6 Learning cells → Required; 11 Solid cells → Stretch
    expect(stats.totalRequired).toBe(6);
    expect(stats.totalStretch).toBe(11);
    expect(stats.navigatorsWithRequired).toBe(4); // every navigator has ≥1 Learning
    expect(stats.domainsNeedingTraining).toBe(4); // D0, D3, D4, D5 have Learning navs
  });
});

// ── mentorSuggestions ────────────────────────────────────────────────────────

describe('mentorSuggestions', () => {
  it('suggests teachers for each non-can-teach domain, excluding self', () => {
    const suggestions = mentorSuggestions(fixtureRows(), 'Ada');
    // Ada is Can-Teach in D2/D3, so those are excluded; the other four have teachers.
    const domains = suggestions.map((s) => s.domainId);
    expect(domains).not.toContain(D2);
    expect(domains).not.toContain(D3);
    const sites = suggestions.find((s) => s.domainId === D0);
    expect(sites.mentors).toEqual(['Dot']);
    expect(suggestions.every((s) => !s.mentors.includes('Ada'))).toBe(true);
  });

  it('surfaces the biggest gaps first (Learning before Solid)', () => {
    const levels = mentorSuggestions(fixtureRows(), 'Ada').map((s) => s.level);
    const firstSolid = levels.indexOf('solid');
    const lastLearning = levels.lastIndexOf('learning');
    // every Learning entry precedes every Solid entry
    if (firstSolid !== -1 && lastLearning !== -1) {
      expect(lastLearning).toBeLessThan(firstSolid);
    }
  });

  it('returns an empty array for an unknown navigator', () => {
    expect(mentorSuggestions(fixtureRows(), 'Nobody')).toEqual([]);
  });
});
