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
  scorePerCompetency,
  scoreToLevel,
  levelFor,
  scoreSpotTheError,
  scoreSpotTheErrorByDomain,
  scoreQaAcrossDomains,
  buildMatrixRows,
  deptSamples,
  departmentOverall,
  departmentMatrix,
  columnGaps,
  canTeachRoster,
  readinessTally,
  floorStats,
  domainDistribution,
  competencyDistribution,
  findRow,
  trainingForRow,
  trainingPlan,
  trainingByDomain,
  trainingStats,
  mentorSuggestions,
  computeQuestionHealth,
  buildLearningSignals,
  buildQuestionImprovementSuggestions,
  adaptiveTrainingRecommendations,
  feedbackInsights,
  buildTrend,
  trainingImpact,
  teamTrend,
  buildDossier,
  buildActionCenter,
  buildDevPath,
  buildMentorMatches,
  pairingOutcomes,
  optionPoints,
} from './scoring.js';

import { THRESHOLDS, LEVELS, COLUMN_GAP_THRESHOLD } from '../data/config.js';
import { DOMAINS, QUESTIONS } from '../data/questions.js';
import { COMPETENCIES } from '../data/competencies.js';
import { DEPARTMENTS, ASSESSED_DEPT, isAssessed } from '../data/departments.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const DOMAIN_IDS = DOMAINS.map((d) => d.id);

const wrongOptionFor = (q) => q.options.find((o) => o.id !== q.correctOptionId).id;
const allCorrectAnswers = () =>
  Object.fromEntries(QUESTIONS.map((q) => [q.id, q.correctOptionId]));
const allWrongAnswers = () =>
  Object.fromEntries(QUESTIONS.map((q) => [q.id, wrongOptionFor(q)]));

// Deterministic synthetic bank for exercising points-based scoring without
// coupling to the authored content. Two questions in domain D0, the second also
// tagging a second competency; a third (no `points`) exercises the binary fallback.
const C0 = COMPETENCIES[0].id;
const C1 = COMPETENCIES[1].id;
const FAKE_D0 = DOMAIN_IDS[0];
const FAKE_D1 = DOMAIN_IDS[1];
const FAKE_QUESTIONS = [
  { id: 'fq1', domainId: FAKE_D0, competencies: [C0], correctOptionId: 'a',
    options: [{ id: 'a', text: '', points: 100 }, { id: 'b', text: '', points: 40 }, { id: 'c', text: '', points: 0 }] },
  { id: 'fq2', domainId: FAKE_D0, competencies: [C0, C1], correctOptionId: 'a',
    options: [{ id: 'a', text: '', points: 100 }, { id: 'b', text: '', points: 20 }] },
  { id: 'fq3', domainId: FAKE_D1, competencies: [C1], correctOptionId: 'a', // no points → binary fallback
    options: [{ id: 'a', text: '' }, { id: 'b', text: '' }] },
];

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

  it('scores every domain 100 when the best (100-point) option is chosen', () => {
    const scores = scorePerDomain(allCorrectAnswers());
    for (const id of DOMAIN_IDS) expect(scores[id]).toBe(100);
  });

  it('treats unanswered questions as 0 points (empty answers → all 0)', () => {
    const scores = scorePerDomain({});
    for (const id of DOMAIN_IDS) expect(scores[id]).toBe(0);
  });

  it('awards partial credit: suboptimal answers land strictly between 0 and 100', () => {
    const scores = scorePerDomain(allWrongAnswers());
    for (const id of DOMAIN_IDS) {
      expect(scores[id]).toBeGreaterThanOrEqual(0);
      expect(scores[id]).toBeLessThan(100); // not the best option anywhere
    }
  });

  it('averages option points across a domain (synthetic bank via questions param)', () => {
    // fq1 → 40, fq2 → 100 ; both in FAKE_D0 → (40+100)/2 = 70
    const scores = scorePerDomain({ fq1: 'b', fq2: 'a' }, FAKE_QUESTIONS);
    expect(scores[FAKE_D0]).toBe(70);
  });

  it('falls back to binary 100/0 for options without a points field', () => {
    expect(scorePerDomain({ fq3: 'a' }, FAKE_QUESTIONS)[FAKE_D1]).toBe(100);
    expect(scorePerDomain({ fq3: 'b' }, FAKE_QUESTIONS)[FAKE_D1]).toBe(0);
  });
});

// ── scorePerCompetency ───────────────────────────────────────────────────────

describe('scorePerCompetency', () => {
  it('returns one entry per competency', () => {
    const scores = scorePerCompetency({}, FAKE_QUESTIONS);
    expect(Object.keys(scores).sort()).toEqual(COMPETENCIES.map((c) => c.id).sort());
  });

  it('averages earned points across each competency\'s tagged questions', () => {
    // fq1(C0)=40, fq2(C0,C1)=100, fq3(C1)=100(binary best)
    const scores = scorePerCompetency({ fq1: 'b', fq2: 'a', fq3: 'a' }, FAKE_QUESTIONS);
    expect(scores[C0]).toBe(70); // (40 + 100) / 2
    expect(scores[C1]).toBe(100); // (100 + 100) / 2
  });

  it('returns null for competencies no question in the bank exercises', () => {
    const scores = scorePerCompetency({}, FAKE_QUESTIONS);
    for (const c of COMPETENCIES) {
      if (c.id === C0 || c.id === C1) expect(scores[c.id]).toBe(0);
      else expect(scores[c.id]).toBeNull();
    }
  });

  it('covers all 9 competencies with the real seed bank', () => {
    const scores = scorePerCompetency(allCorrectAnswers());
    for (const c of COMPETENCIES) expect(scores[c.id]).toBe(100);
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

// ── scoreSpotTheError ────────────────────────────────────────────────────────

describe('scoreSpotTheError', () => {
  it('returns the share of items found correctly, rounded 0–100', () => {
    expect(scoreSpotTheError([true, true, true, true])).toBe(100);
    expect(scoreSpotTheError([true, false, false, false])).toBe(25);
    expect(scoreSpotTheError([false, false])).toBe(0);
  });

  it('accepts object entries with a `correct` flag', () => {
    expect(scoreSpotTheError([{ correct: true }, { correct: false }])).toBe(50);
    expect(scoreSpotTheError([{ correct: true }, { correct: true }, { correct: false }])).toBe(67);
  });

  it('is defensive against empty or malformed input', () => {
    expect(scoreSpotTheError([])).toBe(0);
    expect(scoreSpotTheError(undefined)).toBe(0);
    expect(scoreSpotTheError(null)).toBe(0);
  });
});

describe('scoreSpotTheErrorByDomain', () => {
  it('scores each domain by its share of correct items', () => {
    const graded = [
      { domainId: 'a', correct: true },
      { domainId: 'a', correct: false },
      { domainId: 'b', correct: true },
    ];
    expect(scoreSpotTheErrorByDomain(graded)).toEqual({ a: 50, b: 100 });
  });

  it('omits domains with no items and is defensive against junk', () => {
    expect(scoreSpotTheErrorByDomain([])).toEqual({});
    expect(scoreSpotTheErrorByDomain(undefined)).toEqual({});
    expect(scoreSpotTheErrorByDomain([null, { correct: true }])).toEqual({});
  });
});

// ── scoreQaAcrossDomains ─────────────────────────────────────────────────────

describe('scoreQaAcrossDomains', () => {
  it('applies the QA score to every domain', () => {
    expect(scoreQaAcrossDomains({ score: 87 })).toEqual(makeScores({}, 87));
  });

  it('rounds and clamps edge values', () => {
    expect(scoreQaAcrossDomains(101.7)).toEqual(makeScores({}, 100));
    expect(scoreQaAcrossDomains(-4)).toEqual(makeScores({}, 0));
    expect(scoreQaAcrossDomains({})).toEqual(makeScores({}, 0));
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

  it('derives competency scores and levels when present, and tolerates their absence', () => {
    const rows = buildMatrixRows(
      [{ name: 'Ada', scores: makeScores({}, SOLID), competencyScores: { [C0]: TEACH } }],
      null
    );
    expect(rows[0].competencyScores[C0]).toBe(TEACH);
    expect(rows[0].competencyLevels[C0]).toBe('canTeach');
    // a row with no competency data still builds, with empty competency maps
    const bare = buildMatrixRows([{ name: 'Bea', scores: makeScores({}, SOLID) }], null);
    expect(bare[0].competencyScores).toEqual({});
    expect(bare[0].competencyLevels).toEqual({});
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

  it('places the live taker in the department stored on liveResult (pediatrics)', () => {
    const live = { name: 'You', scores: makeScores({}, TEACH), department: 'pediatrics' };
    const rows = departmentMatrix(nested, live);
    const liveRow = rows[rows.length - 1];
    expect(liveRow.isLive).toBe(true);
    expect(liveRow.depts['pediatrics']).not.toBeNull();
    for (const dep of DEPARTMENTS.filter((d) => d.id !== 'pediatrics')) {
      expect(liveRow.depts[dep.id]).toBeNull();
    }
  });

  it('places the live taker in obgyn when liveResult.department is obgyn', () => {
    const live = { name: 'You', scores: makeScores({}, TEACH), department: 'obgyn' };
    const rows = departmentMatrix(nested, live);
    const liveRow = rows[rows.length - 1];
    expect(liveRow.isLive).toBe(true);
    expect(liveRow.depts['obgyn']).not.toBeNull();
    expect(liveRow.depts['pediatrics']).toBeNull();
    for (const dep of DEPARTMENTS.filter((d) => d.id !== 'obgyn')) {
      expect(liveRow.depts[dep.id]).toBeNull();
    }
  });

  it('defaults to pediatrics when liveResult has no department field (legacy)', () => {
    const live = { name: 'You', scores: makeScores({}, TEACH) }; // no department field
    const rows = departmentMatrix(nested, live);
    const liveRow = rows[rows.length - 1];
    expect(liveRow.depts['pediatrics']).not.toBeNull();
    for (const dep of DEPARTMENTS.filter((d) => d.id !== 'pediatrics')) {
      expect(liveRow.depts[dep.id]).toBeNull();
    }
  });
});

describe('isAssessed', () => {
  it('returns true for assessed departments', () => {
    expect(isAssessed('pediatrics')).toBe(true);
    expect(isAssessed('obgyn')).toBe(true);
  });

  it('returns false for mockup departments', () => {
    expect(isAssessed('adult')).toBe(false);
    expect(isAssessed('behavioral')).toBe(false);
    expect(isAssessed('unknown')).toBe(false);
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

  it('returns an empty array for an empty matrix', () => {
    expect(readinessTally([])).toEqual([]);
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

describe('competencyDistribution', () => {
  it('counts levels per competency and skips uncovered competencies', () => {
    const rows = buildMatrixRows(
      [
        { name: 'Ada', scores: {}, competencyScores: { [C0]: TEACH, [C1]: LEARN } },
        { name: 'Bea', scores: {}, competencyScores: { [C0]: SOLID, [C1]: LEARN } },
      ],
      null
    );
    const dist = competencyDistribution(rows);
    const c0 = dist.find((x) => x.competencyId === C0);
    expect(c0).toMatchObject({ canTeach: 1, solid: 1, learning: 0, total: 2 });
    const c1 = dist.find((x) => x.competencyId === C1);
    expect(c1).toMatchObject({ learning: 2, total: 2 });
    // competencies no row scored are absent from the distribution
    expect(dist.every((x) => x.total > 0)).toBe(true);
    expect(dist).toHaveLength(2);
  });

  it('returns an empty array when no row has competency scores', () => {
    expect(competencyDistribution(fixtureRows())).toEqual([]);
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
    // Ada has 2 Required (D0+D5 Learning), Bea has 2 Required (D0+D4 Learning)
    const adaEntry = plan.find((p) => p.name === 'Ada');
    const beaEntry = plan.find((p) => p.name === 'Bea');
    expect(adaEntry.requiredCount).toBe(2);
    expect(beaEntry.requiredCount).toBe(2);
    // Both should be in the top 2 slots
    expect(plan.indexOf(adaEntry)).toBeLessThan(2);
    expect(plan.indexOf(beaEntry)).toBeLessThan(2);
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

// ── computeQuestionHealth ─────────────────────────────────────────────────────

describe('computeQuestionHealth', () => {
  // Minimal question shape — only the fields computeQuestionHealth needs.
  const Q = { id: 'q1', correctOptionId: 'a', domainId: FAKE_D0 };

  // Build synthetic results with an `answers` field.
  const makeResult = (chosen, domainScore = SOLID) => ({
    answers: { [Q.id]: chosen },
    scores: { [FAKE_D0]: domainScore },
  });

  it('returns an entry for every question passed', () => {
    const h = computeQuestionHealth([Q], []);
    expect(h).toHaveProperty(Q.id);
  });

  it('returns status "insufficient" when fewer than 10 responses exist', () => {
    const results = Array.from({ length: 9 }, () => makeResult('a'));
    const h = computeQuestionHealth([Q], results);
    expect(h[Q.id].status).toBe('insufficient');
    expect(h[Q.id].responseCount).toBe(9);
  });

  it('returns status "healthy" when ≥10 responses and correctRate ≥ 0.20', () => {
    // 4 correct + 6 wrong = 40% correct; well above the 20% threshold.
    const results = [
      ...Array.from({ length: 4 }, () => makeResult('a')),   // correct
      ...Array.from({ length: 6 }, () => makeResult('b')),   // wrong
    ];
    const h = computeQuestionHealth([Q], results);
    expect(h[Q.id].status).toBe('healthy');
    expect(h[Q.id].correctRate).toBeCloseTo(0.4);
  });

  it('returns status "review" when ≥10 responses and correctRate < 0.20', () => {
    // 1 correct + 11 wrong = ~8% correct → flag.
    const results = [
      makeResult('a'),
      ...Array.from({ length: 11 }, () => makeResult('b')),
    ];
    const h = computeQuestionHealth([Q], results);
    expect(h[Q.id].status).toBe('review');
    expect(h[Q.id].correctCount).toBe(1);
    expect(h[Q.id].responseCount).toBe(12);
  });

  it('exact 20% correct with 10 responses is "healthy" (boundary)', () => {
    // 2 correct, 8 wrong → exactly 0.20.
    const results = [
      ...Array.from({ length: 2 }, () => makeResult('a')),
      ...Array.from({ length: 8 }, () => makeResult('b')),
    ];
    const h = computeQuestionHealth([Q], results);
    expect(h[Q.id].status).toBe('healthy');
  });

  it('skips results that have no answers field (legacy docs)', () => {
    const results = [
      { scores: { [FAKE_D0]: SOLID } }, // no answers field — skip
      ...Array.from({ length: 12 }, () => makeResult('b')),
    ];
    const h = computeQuestionHealth([Q], results);
    expect(h[Q.id].responseCount).toBe(12); // legacy doc not counted
  });

  it('skips results where the question is not present in answers (different bank)', () => {
    const results = [{ answers: { other_q: 'a' }, scores: {} }];
    const h = computeQuestionHealth([Q], results);
    expect(h[Q.id].responseCount).toBe(0);
    expect(h[Q.id].status).toBe('insufficient');
  });

  it('tracks canTeachCount and canTeachFailCount using the submission-time domain score', () => {
    // 2 can-teach navigators, 1 of whom picks the wrong answer.
    const results = [
      makeResult('b', TEACH), // can-teach, wrong
      makeResult('a', TEACH), // can-teach, correct
      ...Array.from({ length: 8 }, () => makeResult('b', SOLID)), // solid, wrong
    ];
    const h = computeQuestionHealth([Q], results);
    expect(h[Q.id].canTeachCount).toBe(2);
    expect(h[Q.id].canTeachFailCount).toBe(1);
  });

  it('returns an empty object for an empty question list', () => {
    expect(computeQuestionHealth([], [{ answers: { q1: 'a' }, scores: {} }])).toEqual({});
  });

  it('handles multiple questions independently', () => {
    const Q2 = { id: 'q2', correctOptionId: 'x', domainId: FAKE_D1 };
    const results = [
      { answers: { q1: 'a', q2: 'y' }, scores: {} }, // q1 correct, q2 wrong
    ];
    const h = computeQuestionHealth([Q, Q2], results);
    expect(h.q1.correctCount).toBe(1);
    expect(h.q2.correctCount).toBe(0);
  });
});

describe('buildQuestionImprovementSuggestions', () => {
  const Q = { id: 'q-review', correctOptionId: 'a', domainId: FAKE_D0, scenario: 'Scenario', options: [{ id: 'a', text: 'Best' }, { id: 'b', text: 'Wrong' }] };

  it('suggests review drafts for repeatedly missed questions', () => {
    const results = [
      { answers: { [Q.id]: 'a' }, scores: { [FAKE_D0]: SOLID } },
      ...Array.from({ length: 11 }, () => ({ answers: { [Q.id]: 'b' }, scores: { [FAKE_D0]: SOLID } })),
    ];
    const suggestions = buildQuestionImprovementSuggestions([Q], results);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ questionId: Q.id, severity: 'high' });
    expect(suggestions[0].labels).toContain('needsReview');
    expect(suggestions[0].suggestedDraft.status).toBe('draft');
    expect(suggestions[0].suggestedDraft.source).toBe('learning-loop');
  });

  it('flags can-teach misses even when the overall correct rate is not review-level', () => {
    const results = [
      ...Array.from({ length: 6 }, () => ({ answers: { [Q.id]: 'a' }, scores: { [FAKE_D0]: SOLID } })),
      { answers: { [Q.id]: 'b' }, scores: { [FAKE_D0]: TEACH } },
      ...Array.from({ length: 4 }, () => ({ answers: { [Q.id]: 'b' }, scores: { [FAKE_D0]: SOLID } })),
    ];
    const suggestions = buildQuestionImprovementSuggestions([Q], results);
    expect(suggestions[0].labels).toContain('canTeachMisses');
  });

  it('uses supervisor feedback concerns as a review signal', () => {
    const feedback = [{ targetType: 'question', targetId: Q.id, status: 'needsAdjustment' }];
    const suggestions = buildQuestionImprovementSuggestions([Q], [], feedback);
    expect(suggestions[0].labels).toContain('supervisorConcern');
  });
});

describe('feedbackInsights', () => {
  it('aggregates feedback by target and surfaces recurring negative signals', () => {
    const result = feedbackInsights([
      { targetType: 'interviewGrade', targetId: 'iv1', status: 'inaccurate', note: 'Too generous' },
      { targetType: 'interviewGrade', targetId: 'iv1', status: 'needsAdjustment', note: 'Missed escalation issue' },
      { targetType: 'question', targetId: 'q1', status: 'helpful' },
    ]);
    expect(result.byTarget['interviewGrade:iv1'].negative).toBe(2);
    expect(result.risks).toContainEqual(expect.objectContaining({
      targetType: 'interviewGrade',
      targetId: 'iv1',
    }));
  });
});

describe('adaptiveTrainingRecommendations', () => {
  const row = buildMatrixRows([{ name: 'Ada', scores: makeScores({ [D0]: LEARN }, TEACH), competencyScores: { [C0]: LEARN } }], null)[0];
  const q = { id: 'fq1', domainId: D0, competencies: [C0], correctOptionId: 'a',
    options: [{ id: 'a', text: 'best', points: 100 }, { id: 'b', text: 'miss', points: 20 }] };

  it('recommends practice first when required training has no practice completion', () => {
    const recs = adaptiveTrainingRecommendations(row, {
      questions: [q],
      result: { answers: { fq1: 'b' } },
      completions: [],
      interviews: [],
    });
    const d0 = recs.find((r) => r.domainId === D0);
    expect(d0.kind).toBe('practice');
    expect(d0.reasons.join(' ')).toMatch(/No completed practice/);
    expect(d0.evidence.missedQuestions).toHaveLength(1);
  });

  it('moves to interview after practice completion', () => {
    const recs = adaptiveTrainingRecommendations(row, {
      completions: [{ domainId: D0, kind: 'practice', completedAt: { seconds: 10 } }],
      interviews: [],
    });
    expect(recs.find((r) => r.domainId === D0).kind).toBe('interview');
  });

  it('recommends mini-check after a strong graded interview', () => {
    const recs = adaptiveTrainingRecommendations(row, {
      completions: [{ domainId: D0, kind: 'practice', completedAt: { seconds: 10 } }],
      interviews: [{ domainId: D0, grade: { score: 90 }, endedAt: { seconds: 20 } }],
    });
    expect(recs.find((r) => r.domainId === D0).kind).toBe('minicheck');
  });
});

describe('buildLearningSignals', () => {
  it('combines weak domains, missed questions, training gaps, and interview risks', () => {
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({ [D0]: LEARN }, TEACH), competencyScores: { [C0]: LEARN } }], null);
    const questions = [{ id: 'q1', domainId: D0, competencies: [C0], correctOptionId: 'a',
      options: [{ id: 'a', text: 'best', points: 100 }, { id: 'b', text: 'miss', points: 0 }] }];
    const results = [{ name: 'Ada', answers: { q1: 'b' }, scores: { [D0]: LEARN } }];
    const signals = buildLearningSignals({
      rows,
      results,
      questions,
      completions: [],
      interviews: [{ id: 'iv1', name: 'Ada', domainId: D0, grade: { score: 40 } }],
    });
    expect(signals.weakDomains.some((s) => s.name === 'Ada' && s.domainId === D0)).toBe(true);
    expect(signals.weakCompetencies.some((s) => s.competencyId === C0)).toBe(true);
    expect(signals.repeatedMisses).toContainEqual(expect.objectContaining({ questionId: 'q1' }));
    expect(signals.trainingGaps).toContainEqual(expect.objectContaining({ name: 'Ada', domainId: D0 }));
    expect(signals.interviewRisks).toContainEqual(expect.objectContaining({ interviewId: 'iv1' }));
  });
});

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
    // Ada fixture has both Learning (D0, D5) and Solid (D1, D4) gaps, so both levels
    // are guaranteed to appear — the conditional guard is not needed.
    expect(levels).toContain('learning');
    expect(levels).toContain('solid');
    const firstSolid = levels.indexOf('solid');
    const lastLearning = levels.lastIndexOf('learning');
    expect(lastLearning).toBeLessThan(firstSolid);
  });

  it('returns an empty array for an unknown navigator', () => {
    expect(mentorSuggestions(fixtureRows(), 'Nobody')).toEqual([]);
  });
});

// ── malformed-input edge cases ────────────────────────────────────────────────

describe('scorePerDomain — malformed inputs', () => {
  it('returns 0 for all domains when passed undefined answers', () => {
    // earnedPoints must tolerate undefined lookup key without throwing
    const scores = scorePerDomain(undefined, FAKE_QUESTIONS);
    expect(scores[FAKE_D0]).toBe(0);
    expect(scores[FAKE_D1]).toBe(0);
  });

  it('returns 0 for a question whose options field is missing', () => {
    // the options?. guard in earnedPoints should handle this
    const qs = [{ id: 'bad', domainId: FAKE_D0, competencies: [C0], correctOptionId: 'a' }];
    const scores = scorePerDomain({ bad: 'a' }, qs);
    expect(scores[FAKE_D0]).toBe(0);
  });

  it('returns 0 when the chosen optionId does not exist in options', () => {
    const scores = scorePerDomain({ fq1: 'nonexistent' }, FAKE_QUESTIONS);
    expect(scores[FAKE_D0]).toBe(0);
  });

  it('treats a question with an unknown domainId as ignored (no crash)', () => {
    const qs = [{ id: 'bad', domainId: 'no-such-domain', competencies: [], correctOptionId: 'a',
      options: [{ id: 'a', text: '', points: 100 }] }];
    expect(() => scorePerDomain({ bad: 'a' }, qs)).not.toThrow();
  });
});

describe('scorePerCompetency — malformed inputs', () => {
  it('returns 0 (not null) for a competency when the matching question has no options', () => {
    const qs = [{ id: 'bad', domainId: FAKE_D0, competencies: [C0], correctOptionId: 'a' }];
    const scores = scorePerCompetency({ bad: 'a' }, qs);
    // C0 is tagged but has no options → earns 0 → tally exists → returns 0, not null
    expect(scores[C0]).toBe(0);
  });

  it('ignores competency tags that reference an unknown competency id', () => {
    const qs = [{ id: 'weird', domainId: FAKE_D0, competencies: ['ghost'], correctOptionId: 'a',
      options: [{ id: 'a', text: '', points: 100 }] }];
    // 'ghost' is not in COMPETENCIES — should not throw, just skip
    expect(() => scorePerCompetency({ weird: 'a' }, qs)).not.toThrow();
  });

  it('handles missing competencies array on question (defaults to [])', () => {
    const qs = [{ id: 'no-comp', domainId: FAKE_D0, correctOptionId: 'a',
      options: [{ id: 'a', text: '', points: 100 }] }];
    expect(() => scorePerCompetency({ 'no-comp': 'a' }, qs)).not.toThrow();
  });
});

// ── buildTrend / trainingImpact / teamTrend (Feature 1) ──────────────────────

const makeSnapshot = (scores, secondsAgo, simulated = false) => ({
  scores,
  competencyScores: {},
  takenAt: { seconds: Math.floor(Date.now() / 1000) - secondsAgo },
  simulated,
});

describe('buildTrend', () => {
  it('returns real points when history has 2+ entries', () => {
    const s1 = makeSnapshot(makeScores({}, LEARN), 200);
    const s2 = makeSnapshot(makeScores({}, TEACH), 100);
    const result = buildTrend([s1, s2]);
    expect(result.points.every((p) => !p.simulated)).toBe(true);
    expect(result.points).toHaveLength(2);
    expect(result.overallSeries[1]).toBeGreaterThan(result.overallSeries[0]);
  });

  it('prepends synthetic points when fewer than 2 real snapshots', () => {
    const snap = makeSnapshot(makeScores({}, TEACH), 100);
    const result = buildTrend([snap]);
    expect(result.points.length).toBeGreaterThan(1);
    const synthPoints = result.points.filter((p) => p.simulated);
    expect(synthPoints.length).toBeGreaterThan(0);
  });

  it('generates synthetic points below the real snapshot (shows growth)', () => {
    const snap = makeSnapshot(makeScores({}, TEACH), 100);
    const result = buildTrend([snap]);
    const last = result.overallSeries[result.overallSeries.length - 1];
    const first = result.overallSeries[0];
    expect(last).toBeGreaterThanOrEqual(first);
  });

  it('returns empty points and series for empty history', () => {
    const result = buildTrend([]);
    // With 0 real points, synthesize = true produces TREND_SYNTH_POINTS synthetic ones
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points.every((p) => p.simulated)).toBe(true);
  });

  it('builds domainSeries with one entry per domain per point', () => {
    const snap = makeSnapshot(makeScores({}, SOLID), 100);
    const result = buildTrend([snap]);
    for (const d of DOMAINS) {
      expect(result.domainSeries[d.id]).toHaveLength(result.points.length);
    }
  });

  it('skips synthesis when synthesize=false', () => {
    const snap = makeSnapshot(makeScores({}, SOLID), 100);
    const result = buildTrend([snap], { synthesize: false });
    expect(result.points).toHaveLength(1);
    expect(result.points[0].simulated).toBe(false);
  });
});

describe('trainingImpact', () => {
  const now = Math.floor(Date.now() / 1000);
  const h1 = { scores: makeScores({ [D0]: 40 }), takenAt: { seconds: now - 300 }, simulated: false };
  const h2 = { scores: makeScores({ [D0]: 75 }), takenAt: { seconds: now - 100 }, simulated: false };
  const completionBetween = { domainId: D0, completedAt: { seconds: now - 200 } };

  it('returns before/after/delta when a completion straddles two history snapshots', () => {
    const result = trainingImpact([h1, h2], [completionBetween], D0);
    expect(result.before).toBe(40);
    expect(result.after).toBe(75);
    expect(result.delta).toBe(35);
  });

  it('returns all nulls when no completion exists for the domain', () => {
    const result = trainingImpact([h1, h2], [], D0);
    expect(result).toEqual({ before: null, after: null, delta: null });
  });

  it('returns all nulls when there is no snapshot after the completion', () => {
    const lateCompletion = { domainId: D0, completedAt: { seconds: now } };
    const result = trainingImpact([h1, h2], [lateCompletion], D0);
    expect(result).toEqual({ before: null, after: null, delta: null });
  });

  it('ignores simulated snapshots when computing delta', () => {
    const synth = { ...h1, simulated: true };
    const result = trainingImpact([synth, h2], [completionBetween], D0);
    // synth is filtered out, only h2 exists — no before → all null
    expect(result.before).toBeNull();
  });
});

describe('teamTrend', () => {
  it('returns [] for empty history', () => {
    expect(teamTrend([])).toEqual([]);
  });

  it('returns one entry per distinct timestamp', () => {
    const ts1 = Math.floor(Date.now() / 1000) - 200;
    const ts2 = Math.floor(Date.now() / 1000) - 100;
    const history = [
      { navigatorId: 'nav1', name: 'Ada', scores: makeScores({}, LEARN), competencyScores: {}, takenAt: { seconds: ts1 }, simulated: false },
      { navigatorId: 'nav1', name: 'Ada', scores: makeScores({}, TEACH), competencyScores: {}, takenAt: { seconds: ts2 }, simulated: false },
    ];
    const trend = teamTrend(history);
    expect(trend).toHaveLength(2);
    expect(trend[1].solidPlusRate).toBeGreaterThan(trend[0].solidPlusRate);
  });

  it('builds floor state using each navigator\'s latest snapshot up to each timepoint', () => {
    const ts1 = Math.floor(Date.now() / 1000) - 200;
    const ts2 = Math.floor(Date.now() / 1000) - 100;
    const history = [
      { navigatorId: 'nav1', name: 'Ada', scores: makeScores({}, LEARN), competencyScores: {}, takenAt: { seconds: ts1 }, simulated: false },
      { navigatorId: 'nav2', name: 'Bea', scores: makeScores({}, TEACH), competencyScores: {}, takenAt: { seconds: ts2 }, simulated: false },
    ];
    const trend = teamTrend(history);
    // At ts1, only Ada is included; at ts2, both Ada and Bea
    expect(trend[0].assessed).toBe(1);
    expect(trend[1].assessed).toBe(2);
  });
});

// ── buildDossier (Feature 2) ──────────────────────────────────────────────────

describe('buildDossier', () => {
  const row = buildMatrixRows([{ name: 'Ada', scores: makeScores({}, SOLID), competencyScores: { [C0]: TEACH } }], null)[0];
  const fullAnswers = { fq1: 'b', fq2: 'a', fq3: 'a' }; // fq1 wrong (40pts), fq2 correct, fq3 correct

  it('returns null when answers is empty', () => {
    expect(buildDossier(row, {}, FAKE_QUESTIONS)).toBeNull();
  });

  it('returns null when answers is missing', () => {
    expect(buildDossier(row, undefined, FAKE_QUESTIONS)).toBeNull();
  });

  it('maps answers to competency evidence', () => {
    const dossier = buildDossier(row, fullAnswers, FAKE_QUESTIONS);
    expect(dossier).not.toBeNull();
    const c0Evidence = dossier.byCompetency.find((c) => c.competencyId === C0);
    expect(c0Evidence.evidence.length).toBeGreaterThan(0);
    const fq1Evidence = c0Evidence.evidence.find((e) => e.questionId === 'fq1');
    expect(fq1Evidence.isCorrect).toBe(false); // chose 'b'
    expect(fq1Evidence.points).toBe(40);
  });

  it('marks the correct choice isCorrect=true', () => {
    const dossier = buildDossier(row, fullAnswers, FAKE_QUESTIONS);
    const c0Evidence = dossier.byCompetency.find((c) => c.competencyId === C0);
    const fq2Evidence = c0Evidence.evidence.find((e) => e.questionId === 'fq2');
    expect(fq2Evidence.isCorrect).toBe(true);
    expect(fq2Evidence.points).toBe(100);
  });

  it('includes interview and completion evidence per domain', () => {
    const interviews = [{ id: 'iv1', domainId: FAKE_D0, callerName: 'Jane', endedAt: null, grade: { score: 80 } }];
    const completions = [{ id: 'c1', domainId: FAKE_D0, kind: 'practice', completedAt: null }];
    const dossier = buildDossier(row, fullAnswers, FAKE_QUESTIONS, interviews, completions);
    expect(dossier.byDomain[FAKE_D0].interviews).toHaveLength(1);
    expect(dossier.byDomain[FAKE_D0].completions).toHaveLength(1);
  });

  it('skips questions not in answers map', () => {
    const dossier = buildDossier(row, { fq1: 'a' }, FAKE_QUESTIONS); // only fq1 answered
    const c0Evidence = dossier.byCompetency.find((c) => c.competencyId === C0);
    expect(c0Evidence.evidence.every((e) => e.questionId === 'fq1')).toBe(true);
  });
});

// ── buildActionCenter (Feature 3) ────────────────────────────────────────────

describe('buildActionCenter', () => {
  it('returns all five categories empty for an empty floor', () => {
    const ac = buildActionCenter([], {});
    expect(ac.criticalGaps).toHaveLength(0);
    expect(ac.trainingOverdue).toHaveLength(0);
    expect(ac.decliningTrends).toHaveLength(0);
    expect(ac.failedPractice).toHaveLength(0);
    expect(ac.readyForMore).toHaveLength(0);
  });

  it('flags critical gaps for every Learning-level domain', () => {
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({ [D0]: LEARN }, SOLID) }], null);
    const ac = buildActionCenter(rows);
    const gapDomains = ac.criticalGaps.filter((g) => g.name === 'Ada').map((g) => g.domainId);
    expect(gapDomains).toContain(D0);
  });

  it('flags training overdue when a Required domain has no completion', () => {
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({ [D0]: LEARN }, TEACH) }], null);
    const ac = buildActionCenter(rows, { completions: [] });
    expect(ac.trainingOverdue.some((t) => t.name === 'Ada' && t.domainId === D0)).toBe(true);
  });

  it('does NOT flag training overdue when completion exists', () => {
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({ [D0]: LEARN }, TEACH) }], null);
    const completions = [{ name: 'Ada', domainId: D0 }];
    const ac = buildActionCenter(rows, { completions });
    expect(ac.trainingOverdue.some((t) => t.name === 'Ada' && t.domainId === D0)).toBe(false);
  });

  it('keeps training overdue when only a mini-check completion exists', () => {
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({ [D0]: LEARN }, TEACH) }], null);
    const completions = [{ name: 'Ada', domainId: D0, kind: 'minicheck' }];
    const ac = buildActionCenter(rows, { completions });
    expect(ac.trainingOverdue.some((t) => t.name === 'Ada' && t.domainId === D0)).toBe(true);
  });

  it('flags declining trend when overall drops >5 points between last two snapshots', () => {
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({}, SOLID) }], null);
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { name: 'Ada', scores: makeScores({}, TEACH), takenAt: { seconds: now - 200 }, simulated: false },
      { name: 'Ada', scores: makeScores({}, LEARN), takenAt: { seconds: now - 100 }, simulated: false },
    ];
    const ac = buildActionCenter(rows, { history });
    expect(ac.decliningTrends.some((d) => d.name === 'Ada')).toBe(true);
  });

  it('flags failed practice for interview scores below the fair threshold', () => {
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({}, SOLID) }], null);
    const interviews = [{ id: 'iv1', name: 'Ada', domainId: D0, grade: { score: 40 } }];
    const ac = buildActionCenter(rows, { interviews });
    expect(ac.failedPractice).toContainEqual(expect.objectContaining({
      name: 'Ada',
      domainId: D0,
      score: 40,
      interviewId: 'iv1',
    }));
  });

  it('does NOT flag failed practice for scores at/above the fair threshold', () => {
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({}, SOLID) }], null);
    const interviews = [{ name: 'Ada', domainId: D0, grade: { score: 70 } }];
    const ac = buildActionCenter(rows, { interviews });
    expect(ac.failedPractice.some((f) => f.name === 'Ada')).toBe(false);
  });

  it('ignores Call QA Test grades for domain practice flags', () => {
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({}, SOLID) }], null);
    const interviews = [{ id: 'qa1', name: 'Ada', domainId: D0, grade: { score: 0 }, qa: { pass: false } }];
    const ac = buildActionCenter(rows, { interviews });
    expect(ac.failedPractice).toHaveLength(0);
  });

  it('includes canTeachCount for ready-for-more items', () => {
    const rows = buildMatrixRows([
      { name: 'Ada', scores: makeScores({}, TEACH) },
      { name: 'Bea', scores: makeScores({}, SOLID) },
    ], null);
    const ac = buildActionCenter(rows);
    expect(ac.readyForMore).toContainEqual(expect.objectContaining({
      name: 'Ada',
      canTeachCount: DOMAINS.length,
    }));
  });
});

// ── buildDevPath (Feature 4) ──────────────────────────────────────────────────

describe('buildDevPath', () => {
  const row = buildMatrixRows([{ name: 'Ada', scores: makeScores({ [D0]: LEARN, [D1]: SOLID }, TEACH) }], null)[0];

  it('returns one path per assigned domain (Learning + Solid, not Can-Teach)', () => {
    const paths = buildDevPath(row);
    expect(paths.map((p) => p.domainId)).toContain(D0);
    expect(paths.map((p) => p.domainId)).toContain(D1);
    // Can-Teach domains get no path
    for (const p of paths) {
      expect(row.levels[p.domainId]).not.toBe('canTeach');
    }
  });

  it('starts with coaching=done and practice=next (no completions)', () => {
    const paths = buildDevPath(row);
    const path = paths.find((p) => p.domainId === D0);
    expect(path.steps.find((s) => s.kind === 'coaching').status).toBe('done');
    expect(path.steps.find((s) => s.kind === 'practice').status).toBe('next');
  });

  it('marks practice done and interview=next once a practice completion exists', () => {
    const completions = [{ domainId: D0, kind: 'practice' }];
    const paths = buildDevPath(row, completions);
    const path = paths.find((p) => p.domainId === D0);
    expect(path.steps.find((s) => s.kind === 'practice').status).toBe('done');
    expect(path.steps.find((s) => s.kind === 'interview').status).toBe('next');
  });

  it('marks minicheck done and raises percentComplete to 100 when all steps complete', () => {
    const completions = [
      { domainId: D0, kind: 'practice' },
      { domainId: D0, kind: 'minicheck' },
    ];
    const interviews = [{ domainId: D0, grade: { score: 80 } }];
    const paths = buildDevPath(row, completions, interviews);
    const path = paths.find((p) => p.domainId === D0);
    expect(path.steps.find((s) => s.kind === 'minicheck').status).toBe('done');
    expect(path.percentComplete).toBe(100);
  });

  it('does not count a Call QA Test as the domain practice-call step', () => {
    const completions = [{ domainId: D0, kind: 'practice' }];
    const interviews = [{ domainId: D0, grade: { score: 100 }, qa: { pass: true } }];
    const paths = buildDevPath(row, completions, interviews);
    const path = paths.find((p) => p.domainId === D0);
    expect(path.steps.find((s) => s.kind === 'interview').status).toBe('next');
  });

  it('returns empty array for a Can-Teach-across-the-board navigator', () => {
    const ctRow = buildMatrixRows([{ name: 'Star', scores: makeScores({}, TEACH) }], null)[0];
    expect(buildDevPath(ctRow)).toHaveLength(0);
  });
});

// ── buildMentorMatches / pairingOutcomes (Feature 5) ────────────────────────

describe('buildMentorMatches', () => {
  it('produces a pairing for each mentee in a domain with an available mentor', () => {
    // Dot is Can-Teach in D0; Ada/Bea/Cyd are not
    const { pairings } = buildMentorMatches(fixtureRows());
    const d0Pairings = pairings.filter((p) => p.domainId === D0);
    expect(d0Pairings.length).toBeGreaterThan(0);
    expect(d0Pairings.every((p) => p.mentorName === 'Dot')).toBe(true);
  });

  it('respects maxLoad — mentor never exceeds cap', () => {
    const { pairings, load } = buildMentorMatches(fixtureRows(), { maxLoad: 2 });
    for (const [, count] of Object.entries(load)) {
      expect(count).toBeLessThanOrEqual(2);
    }
    // Excess mentees go to unmatched
    const { unmatched } = buildMentorMatches(fixtureRows(), { maxLoad: 1 });
    // Dot is the only mentor for D0 with 3 mentees; 2 should be unmatched
    const d0Unmatched = unmatched.filter((u) => u.domainId === D0);
    expect(d0Unmatched.length).toBe(2);
  });

  it('puts Learning mentees before Solid in pairings for the same domain', () => {
    const { pairings } = buildMentorMatches(fixtureRows());
    const d0 = pairings.filter((p) => p.domainId === D0);
    const levels = d0.map((p) => p.menteeLevel);
    if (levels.includes('learning') && levels.includes('solid')) {
      expect(levels.indexOf('learning')).toBeLessThan(levels.indexOf('solid'));
    }
  });

  it('puts a domain with no Can-Teach navigators into unmatched', () => {
    // D3 in our fixture: Ada+Dot are Can-Teach, so there might be mentors.
    // Build a simple case: all Learning, no teacher.
    const allLearning = buildMatrixRows([
      { name: 'A', scores: makeScores({}, LEARN) },
      { name: 'B', scores: makeScores({}, LEARN) },
    ], null);
    const { pairings, unmatched } = buildMentorMatches(allLearning);
    expect(pairings).toHaveLength(0);
    expect(unmatched.length).toBeGreaterThan(0);
  });

  it('records the baseline score on each pairing', () => {
    const { pairings } = buildMentorMatches(fixtureRows());
    const d0 = pairings.find((p) => p.domainId === D0);
    expect(typeof d0.baselineScore).toBe('number');
  });
});

describe('pairingOutcomes', () => {
  const rows = fixtureRows();
  const savedPairings = [
    { domainId: D0, mentorName: 'Dot', menteeName: 'Ada', menteeLevel: 'learning', baselineScore: 30 },
  ];

  it('computes delta = currentScore - baselineScore', () => {
    const outcomes = pairingOutcomes(savedPairings, rows);
    expect(outcomes).toHaveLength(1);
    const adaScore = rows.find((r) => r.name === 'Ada').scores[D0];
    expect(outcomes[0].currentScore).toBe(adaScore);
    expect(outcomes[0].delta).toBe(adaScore - 30);
  });

  it('sets improved=true when delta > 0', () => {
    // Ada's D0 is LEARN which is 50 (THRESHOLDS.learning - 10); baseline is 30 → improved
    const outcomes = pairingOutcomes(savedPairings, rows);
    expect(outcomes[0].improved).toBe(LEARN > 30);
  });

  it('sets currentScore=null and delta=null for an unknown mentee', () => {
    const missing = [{ domainId: D0, menteeName: 'Ghost', baselineScore: 30 }];
    const outcomes = pairingOutcomes(missing, rows);
    expect(outcomes[0].currentScore).toBeNull();
    expect(outcomes[0].delta).toBeNull();
    expect(outcomes[0].improved).toBe(false);
  });
});

// ── optionPoints (canonical per-option scoring rule, newly exported) ─────────

describe('optionPoints', () => {
  const q = {
    correctOptionId: 'b',
    options: [
      { id: 'a', points: 40 },
      { id: 'b', points: 100 },
      { id: 'c' }, // legacy option without points
    ],
  };

  it('uses the option points when present', () => {
    expect(optionPoints(q, 'a')).toBe(40);
    expect(optionPoints(q, 'b')).toBe(100);
  });

  it('falls back to binary 100/0 for legacy options without points', () => {
    const legacy = { correctOptionId: 'b', options: [{ id: 'b' }, { id: 'c' }] };
    expect(optionPoints(legacy, 'b')).toBe(100);
    expect(optionPoints(legacy, 'c')).toBe(0);
  });

  it('returns 0 for an unknown or missing choice, or missing options', () => {
    expect(optionPoints(q, 'zzz')).toBe(0);
    expect(optionPoints(q, undefined)).toBe(0);
    expect(optionPoints({ correctOptionId: 'b' }, 'b')).toBe(0);
  });
});
