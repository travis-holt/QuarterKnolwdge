// ─────────────────────────────────────────────────────────────────────────────
// UNIT TESTS for lib/scoring.js — the pure logic layer.
//
// Design notes:
//  - Fixtures are built from the REAL data modules (DOMAINS, QUESTIONS, …) so the
//    tests track the actual content rather than a parallel copy that can drift.
//  - The four capability bands (0–39 Critical · 40–64 Learning · 65–89 Solid ·
//    90–100 Can-Teach) are pinned BOTH as exact numbers (so a silent re-band is
//    caught) and relative to THRESHOLDS (so a deliberate re-band stays coherent).
//  - `overallScore`/`overallLevel` are the ONE official classification per
//    navigator per department; domain scores are diagnostic evidence only.
//  - Read-off / analytics tests use small synthetic matrices with hand-computed
//    expectations, kept independent of the editable SAMPLE_NAVIGATORS values.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';

import {
  scorePerDomain,
  scorePerCompetency,
  isScoreableQuestion,
  assessmentBankCoverage,
  isAssessmentBankComplete,
  IncompleteAssessmentBankError,
  trainingEmptyStateReason,
  hasMasteredAllDomains,
  scoreToLevel,
  levelFor,
  domainBand,
  isCriticalDomainGap,
  overallScore,
  overallLevel,
  overallStatus,
  overallComplete,
  overallDistribution,
  partialAverage,
  assessedDomainCount,
  competencyScoreToLevel,
  domainMentorRoster,
  isRequiredAssignment,
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
  sequenceDevSteps,
  buildMentorMatches,
  pairingOutcomes,
  optionPoints,
} from './scoring.js';

import { THRESHOLDS, COMPETENCY_THRESHOLDS, LEVELS, LEVEL_ORDER, COMPETENCY_LEVEL_ORDER, COLUMN_GAP_THRESHOLD } from '../data/config.js';
import { DOMAINS, QUESTIONS, SEED_QUESTIONS_OBGYN } from '../data/questions.js';
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
// Bands: 0–39 Critical · 40–64 Learning · 65–89 Solid · 90–100 Can-Teach.
const CRIT = THRESHOLDS.critical - 10; // below the critical ceiling
const LEARN = THRESHOLDS.critical + 5; // between critical and solid
const SOLID = THRESHOLDS.solid + 5; // between solid and can-teach
const TEACH = THRESHOLDS.canTeach + 5; // at/above the can-teach floor

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
  // The exact, non-overlapping capability ranges. Every boundary is pinned so a
  // future threshold edit cannot silently re-band a navigator.
  it.each([
    [0, 'critical'],
    [39, 'critical'],
    [40, 'learning'],
    [64, 'learning'],
    [65, 'solid'],
    [89, 'solid'],
    [90, 'canTeach'],
    [100, 'canTeach'],
  ])('maps %i%% to "%s"', (score, expected) => {
    expect(scoreToLevel(score)).toBe(expected);
  });

  it('derives every boundary from the centralized THRESHOLDS', () => {
    expect(scoreToLevel(THRESHOLDS.critical - 1)).toBe('critical');
    expect(scoreToLevel(THRESHOLDS.critical)).toBe('learning');
    expect(scoreToLevel(THRESHOLDS.solid - 1)).toBe('learning');
    expect(scoreToLevel(THRESHOLDS.solid)).toBe('solid');
    expect(scoreToLevel(THRESHOLDS.canTeach - 1)).toBe('solid');
    expect(scoreToLevel(THRESHOLDS.canTeach)).toBe('canTeach');
  });

  it('domainBand is the same canonical mapping, named for diagnostic use', () => {
    for (const score of [0, 39, 40, 64, 65, 89, 90, 100]) {
      expect(domainBand(score)).toBe(scoreToLevel(score));
    }
  });

  it('flags a domain score below 40 as a critical gap', () => {
    expect(isCriticalDomainGap(39)).toBe(true);
    expect(isCriticalDomainGap(40)).toBe(false);
    expect(isCriticalDomainGap(undefined)).toBe(false);
  });
});

describe('levelFor', () => {
  it('returns the full level descriptor for a percentage', () => {
    expect(levelFor(TEACH)).toBe(LEVELS.canTeach);
    expect(levelFor(SOLID)).toBe(LEVELS.solid);
    expect(levelFor(LEARN)).toBe(LEVELS.learning);
    expect(levelFor(CRIT)).toBe(LEVELS.critical);
    expect(levelFor(TEACH).label).toBe('Can-Teach');
    expect(levelFor(CRIT).label).toBe('Critical');
  });

  it('every level carries a strong colour, readable text and a diagnostic tint', () => {
    for (const id of LEVEL_ORDER) {
      expect(LEVELS[id].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(LEVELS[id].text).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(LEVELS[id].tint).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('orders the levels lowest → highest', () => {
    expect(LEVEL_ORDER).toEqual(['critical', 'learning', 'solid', 'canTeach']);
  });
});

// ── overallScore / overallLevel / overallStatus — THE official classification ──

describe('overall capability status', () => {
  const sixDomains = (values) => Object.fromEntries(DOMAINS.map((d, i) => [d.id, values[i]]));

  it('averages all six domain scores, rounding only after the complete average', () => {
    // 92 + 88 + 96 + 90 + 94 + 86 = 546 → 546 / 6 = 91
    const scores = sixDomains([92, 88, 96, 90, 94, 86]);
    expect(overallScore(scores)).toBe(91);
    expect(overallLevel(scores)).toBe('canTeach');
  });

  it('averages a mixed profile to Solid', () => {
    const scores = sixDomains([100, 100, 100, 50, 50, 50]);
    expect(overallScore(scores)).toBe(75);
    expect(overallLevel(scores)).toBe('solid');
  });

  it('reaches Can-Teach overall while one domain still needs stretch development', () => {
    const scores = sixDomains([95, 95, 95, 95, 95, 65]);
    expect(overallScore(scores)).toBe(90);
    expect(overallLevel(scores)).toBe('canTeach');

    // The 65 domain is Stretch development — never labelled Can-Teach.
    const [row] = buildMatrixRows([{ name: 'Eve', scores }], null);
    const weakest = trainingForRow(row).find((a) => a.domainId === DOMAIN_IDS[5]);
    expect(weakest.priority).toBe('Stretch');
    expect(row.domainDevelopmentBands[DOMAIN_IDS[5]]).toBe('solid');
    expect(row.domainDevelopmentBands[DOMAIN_IDS[5]]).not.toBe('canTeach');
  });

  it('reports Critical when the six-domain average falls below 40', () => {
    const scores = sixDomains([30, 35, 20, 45, 38, 40]);
    expect(overallScore(scores)).toBe(35);
    expect(overallLevel(scores)).toBe('critical');
    expect(overallStatus(scores).label).toBe('Critical');
  });

  it('keeps a Solid overall status even when one domain is a critical gap', () => {
    // 34 + 80 + 80 + 80 + 80 + 78 = 432 → 72 overall
    const scores = sixDomains([34, 80, 80, 80, 80, 78]);
    expect(overallScore(scores)).toBe(72);
    expect(overallLevel(scores)).toBe('solid');

    const [row] = buildMatrixRows([{ name: 'Fay', scores }], null);
    expect(row.overallLevel).toBe('solid');
    expect(row.domainDevelopmentBands[DOMAIN_IDS[0]]).toBe('critical');
    expect(isCriticalDomainGap(row.scores[DOMAIN_IDS[0]])).toBe(true);
  });

  it('averages only within one department, over the six configured domains', () => {
    const scores = { ...sixDomains([60, 60, 60, 60, 60, 60]), notADomain: 100 };
    expect(overallScore(scores)).toBe(60);
  });

  // ── MISSING-DOMAIN SAFETY ──────────────────────────────────────────────────

  it('gives an incomplete profile NO official score and NO official level', () => {
    const partial = { [DOMAIN_IDS[0]]: 100 };
    expect(overallComplete(partial)).toBe(false);
    // No official score at all — a one-domain profile is not "100% overall".
    expect(overallScore(partial)).toBeNull();
    expect(overallLevel(partial)).toBeNull();
    const status = overallStatus(partial);
    expect(status.label).toBe('Incomplete');
    expect(status.assessedDomains).toBe(1);
    expect(status.unassessed).toBe(false);
    // The partial mean is available as an explicitly diagnostic field only.
    expect(status.partialAverage).toBe(100);
    expect(status.score).toBeNull();
  });

  it('gives a mostly-complete profile no official status either', () => {
    const five = Object.fromEntries(DOMAIN_IDS.slice(0, 5).map((id) => [id, 80]));
    expect(overallComplete(five)).toBe(false);
    expect(overallScore(five)).toBeNull();
    expect(overallLevel(five)).toBeNull();
    expect(overallStatus(five).label).toBe('Incomplete');
    expect(overallStatus(five).assessedDomains).toBe(5);
  });

  it('does not report a low incomplete profile as Critical either', () => {
    // Critical is an official status, and an incomplete profile has none.
    expect(overallLevel({ [DOMAIN_IDS[0]]: 10 })).toBeNull();
    expect(overallStatus({ [DOMAIN_IDS[0]]: 10 }).label).toBe('Incomplete');
  });

  it('treats a non-numeric domain score as missing, not as a value', () => {
    const bad = { ...Object.fromEntries(DOMAINS.map((d) => [d.id, 95])), [DOMAIN_IDS[3]]: 'high' };
    expect(overallComplete(bad)).toBe(false);
    expect(overallScore(bad)).toBeNull();
    expect(overallLevel(bad)).toBeNull();
    // …and the bad domain is unassessed, not a critical gap.
    expect(domainBand(bad[DOMAIN_IDS[3]])).toBeNull();
    expect(isCriticalDomainGap(bad[DOMAIN_IDS[3]])).toBe(false);
  });

  it('partialAverage is diagnostic only and never an official score', () => {
    const partial = { [DOMAIN_IDS[0]]: 100, [DOMAIN_IDS[1]]: 50 };
    expect(partialAverage(partial)).toBe(75);
    expect(overallScore(partial)).toBeNull();
    // A complete profile reports no partialAverage — the official score stands.
    const complete = Object.fromEntries(DOMAIN_IDS.map((id) => [id, 70]));
    expect(overallStatus(complete).partialAverage).toBeNull();
    expect(overallStatus(complete).score).toBe(70);
  });

  it('an incomplete profile can never qualify as a mentor', () => {
    const rows = buildMatrixRows([{ name: 'Partial', scores: { [DOMAIN_IDS[0]]: 100 } }], null);
    expect(domainMentorRoster(rows)[DOMAIN_IDS[0]]).toEqual([]);
  });

  it('returns null (not zero) when nothing has been assessed', () => {
    expect(overallScore({})).toBeNull();
    expect(overallLevel({})).toBeNull();
    expect(overallStatus({}).label).toBe('Not assessed');
  });

  it('departmentOverall is the same canonical formula', () => {
    const scores = sixDomains([92, 88, 96, 90, 94, 86]);
    expect(departmentOverall(scores)).toBe(overallScore(scores));
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
  it('builds one row per sample with derived bands and isLive=false', () => {
    const rows = buildMatrixRows(FIXTURE_SAMPLES, null);
    expect(rows).toHaveLength(FIXTURE_SAMPLES.length);
    expect(rows.every((r) => r.isLive === false)).toBe(true);
    expect(rows[0].domainDevelopmentBands[D0]).toBe('learning'); // Ada's D0 = LEARN
    expect(rows[3].domainDevelopmentBands[D0]).toBe('canTeach'); // Dot's D0 = TEACH
  });

  it('exposes the official overall status alongside untouched raw domain scores', () => {
    const rows = buildMatrixRows(FIXTURE_SAMPLES, null);
    for (const row of rows) {
      // One official status per row.
      expect(row.overallScore).toBe(overallScore(row.scores));
      expect(row.overallLevel).toBe(overallLevel(row.scores));
      expect(row.overallComplete).toBe(true);
      expect(typeof row.overallLabel).toBe('string');
      // Raw domain scores are preserved exactly as submitted.
      for (const id of DOMAIN_IDS) {
        expect(row.scores[id]).toBe(FIXTURE_SAMPLES.find((s) => s.name === row.name).scores[id]);
      }
      // Diagnostic bands are separate from the official status.
      for (const id of DOMAIN_IDS) {
        expect(row.domainDevelopmentBands[id]).toBe(domainBand(row.scores[id]));
      }
    }
  });

  it('keeps `levels` as a read-only alias of domainDevelopmentBands', () => {
    const [row] = buildMatrixRows([{ name: 'Ada', scores: makeScores({}, SOLID) }], null);
    expect(row.levels).toEqual(row.domainDevelopmentBands);
  });

  it('marks a partially-scored row incomplete and refuses to promote it', () => {
    const [row] = buildMatrixRows([{ name: 'Sparse', scores: { [D0]: 100 } }], null);
    expect(row.overallComplete).toBe(false);
    expect(row.overallLevel).not.toBe('canTeach');
    expect(row.overallLabel).toBe('Incomplete');
  });

  it('preserves the stable navigator id for downstream joins', () => {
    const [row] = buildMatrixRows([{ navigatorId: 'nav-1', name: 'Ada', scores: makeScores({}, SOLID) }], null);
    expect(row.navigatorId).toBe('nav-1');
    expect(findRow([row], 'nav-1')).toBe(row);
  });

  it('appends the live taker as a highlighted (isLive) final row', () => {
    const live = { name: 'You', scores: makeScores({}, TEACH) };
    const rows = buildMatrixRows(FIXTURE_SAMPLES, live);
    expect(rows).toHaveLength(FIXTURE_SAMPLES.length + 1);
    const last = rows[rows.length - 1];
    expect(last.isLive).toBe(true);
    expect(last.name).toBe('You');
  });

  // REPLACES the former "missing domain defaults to 0 → critical" test.
  // Missing evidence must never be converted into a score of 0.
  it('marks a missing domain as unassessed (null), NEVER as 0 or "critical"', () => {
    const rows = buildMatrixRows([{ name: 'Sparse', scores: {} }], null);
    for (const id of DOMAIN_IDS) {
      expect(rows[0].domainDevelopmentBands[id]).toBeNull();
      expect(rows[0].domainDevelopmentBands[id]).not.toBe('critical');
      expect(rows[0].scores[id]).toBeUndefined();
    }
    // No scores at all → not assessed, never a promoted status.
    expect(rows[0].overallScore).toBeNull();
    expect(rows[0].overallLevel).toBeNull();
    expect(rows[0].overallUnassessed).toBe(true);
    expect(rows[0].overallLabel).toBe('Not assessed');
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

// A fixture built specifically for the TWO-PART mentor eligibility rule:
// overall Can-Teach AND ≥90% in the specific domain being mentored.
const MENTOR_SAMPLES = [
  // Can-Teach overall and ≥90 everywhere — qualified in every domain.
  { name: 'Universal', scores: makeScores({}, 95) },
  // Can-Teach overall (91) but only 65 in D5 — NOT qualified to mentor D5.
  { name: 'Narrow', scores: makeScores({ [D0]: 100, [D1]: 95, [D2]: 95, [D3]: 95, [D4]: 95, [D5]: 65 }) },
  // 100 in D5 but only Solid overall (67) — NOT qualified to mentor anything.
  { name: 'Lopsided', scores: makeScores({ [D5]: 100 }, 60) },
  // Ordinary mentees.
  { name: 'Learner', scores: makeScores({}, 50) },
  { name: 'AtRisk', scores: makeScores({}, 30) },
];
const mentorRows = () => buildMatrixRows(MENTOR_SAMPLES, null);

describe('domainMentorRoster', () => {
  it('requires BOTH overall Can-Teach and ≥90% in that specific domain', () => {
    const roster = domainMentorRoster(mentorRows());
    // D0: both Universal (95) and Narrow (100) are Can-Teach overall and ≥90.
    expect(roster[D0].sort()).toEqual(['Narrow', 'Universal']);
    // D5: Narrow scored only 65 there, so it drops out despite being Can-Teach.
    expect(roster[D5]).toEqual(['Universal']);
  });

  it('excludes a navigator with a perfect domain score but a lower overall status', () => {
    const rows = mentorRows();
    const lopsided = rows.find((r) => r.name === 'Lopsided');
    expect(lopsided.scores[D5]).toBe(100);
    expect(lopsided.overallLevel).toBe('solid');
    expect(domainMentorRoster(rows)[D5]).not.toContain('Lopsided');
  });

  it('excludes a Can-Teach navigator from a domain they are weak in', () => {
    const rows = mentorRows();
    const narrow = rows.find((r) => r.name === 'Narrow');
    expect(narrow.overallLevel).toBe('canTeach');
    expect(narrow.scores[D5]).toBe(65);
    expect(domainMentorRoster(rows)[D5]).not.toContain('Narrow');
  });

  it('returns an empty array per domain for an empty matrix', () => {
    const roster = domainMentorRoster([]);
    for (const id of DOMAIN_IDS) expect(roster[id]).toEqual([]);
  });

  it('canTeachRoster remains as a backward-compatible alias', () => {
    expect(canTeachRoster(mentorRows())).toEqual(domainMentorRoster(mentorRows()));
  });
});

describe('readinessTally', () => {
  it('ranks by official overall status, then overall score', () => {
    const tally = readinessTally(fixtureRows());
    expect(tally).toHaveLength(4);
    // All four are Solid overall here, so the overall SCORE breaks the tie.
    expect(tally.map((t) => t.name)).toEqual(['Dot', 'Ada', 'Cyd', 'Bea']);
    expect(tally[0]).toMatchObject({ name: 'Dot', overallScore: 78, overallLevel: 'solid' });
    expect(tally[3]).toMatchObject({ name: 'Bea', overallScore: 66 });
  });

  it('marks readyForMore only for navigators who are Can-Teach OVERALL', () => {
    const tally = readinessTally(mentorRows());
    const ready = tally.filter((t) => t.readyForMore).map((t) => t.name).sort();
    expect(ready).toEqual(['Narrow', 'Universal']);
    // Lopsided has a 100% domain but is only Solid overall.
    expect(tally.find((t) => t.name === 'Lopsided').readyForMore).toBe(false);
  });

  it('carries domain depth as supporting context, not as the classification', () => {
    const narrow = readinessTally(mentorRows()).find((t) => t.name === 'Narrow');
    expect(narrow.canTeachDomainCount).toBe(5); // 5 of 6 domains at 90%+
    expect(narrow.overallLevel).toBe('canTeach'); // the official status
  });

  it('returns an empty array for an empty matrix', () => {
    expect(readinessTally([])).toEqual([]);
  });
});

describe('overallDistribution', () => {
  it('counts navigators per official status', () => {
    const dist = overallDistribution(mentorRows());
    expect(dist.canTeach).toBe(2); // Universal, Narrow
    expect(dist.solid).toBe(1); // Lopsided
    expect(dist.learning).toBe(1); // Learner
    expect(dist.critical).toBe(1); // AtRisk
    expect(dist.total).toBe(5);
  });

  it('counts an incomplete profile separately and never inflates a status', () => {
    const rows = buildMatrixRows([{ name: 'Partial', scores: { [D0]: 100 } }], null);
    const dist = overallDistribution(rows);
    expect(dist.incomplete).toBe(1);
    expect(dist.canTeach).toBe(0);
    expect(dist.solid).toBe(0);
  });
});

// ── floorStats / domainDistribution / findRow ────────────────────────────────

describe('floorStats', () => {
  it('computes NAVIGATOR-level headline metrics, not cell-level ones', () => {
    const stats = floorStats(fixtureRows());
    expect(stats.assessed).toBe(4);
    expect(stats.totalDomains).toBe(DOMAINS.length);
    // Overall scores: Dot 78, Ada 70, Cyd 70, Bea 66 — all four Solid overall.
    expect(stats.solidPlusRate).toBe(100);
    expect(stats.canTeachCount).toBe(0);
    expect(stats.criticalCount).toBe(0);
    expect(stats.avgOverallScore).toBe(71); // (78+70+70+66)/4 = 71
  });

  it('counts Critical and Can-Teach navigators by official overall status', () => {
    const stats = floorStats(mentorRows());
    expect(stats.canTeachCount).toBe(2);
    expect(stats.criticalCount).toBe(1);
    expect(stats.solidPlusRate).toBe(60); // 3 of 5 are Solid or above
  });

  it('handles an empty matrix without dividing by zero', () => {
    const stats = floorStats([]);
    // Counts are genuine zeroes; RATES/AVERAGES are null because there is no
    // evidence to average — 0% would read as "the whole floor scored zero".
    expect(stats).toMatchObject({ assessed: 0, canTeachCount: 0, criticalCount: 0 });
    expect(stats.solidPlusRate).toBeNull();
    expect(stats.avgOverallScore).toBeNull();
  });
});

describe('domainDistribution', () => {
  it('returns per-domain diagnostic band counts that sum to the row count', () => {
    const dist = domainDistribution(fixtureRows());
    expect(dist).toHaveLength(DOMAINS.length);
    const d0 = dist.find((d) => d.domainId === D0);
    expect(d0).toMatchObject({ critical: 0, learning: 3, solid: 0, canTeach: 1, total: 4 });
    for (const d of dist) {
      expect(d.critical + d.learning + d.solid + d.canTeach).toBe(d.total);
    }
  });

  it('reports diagnostic score measures alongside the band counts', () => {
    const rows = buildMatrixRows([{ name: 'X', scores: makeScores({ [D0]: 30 }, 80) }], null);
    const d0 = domainDistribution(rows).find((d) => d.domainId === D0);
    expect(d0.avgScore).toBe(30);
    expect(d0.belowCritical).toBe(1);
    expect(d0.belowSolid).toBe(1);
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

  // ── Exact band → assignment boundaries ────────────────────────────────────
  it.each([
    [0, 'Critical', 'required'],
    [39, 'Critical', 'required'],
    [40, 'Required', 'required'],
    [64, 'Required', 'required'],
    [65, 'Stretch', 'optional'],
    [89, 'Stretch', 'optional'],
  ])('a domain scoring %i%% is assigned %s (%s)', (score, priority, assignment) => {
    const [row] = buildMatrixRows([{ name: 'X', scores: makeScores({ [D0]: score }, 100) }], null);
    const a = trainingForRow(row).find((x) => x.domainId === D0);
    expect(a.priority).toBe(priority);
    expect(a.assignment).toBe(assignment);
    expect(a.score).toBe(score);
  });

  it.each([90, 100])('a domain scoring %i%% gets no automatic assignment', (score) => {
    const [row] = buildMatrixRows([{ name: 'X', scores: makeScores({ [D0]: score }, 100) }], null);
    expect(trainingForRow(row).find((x) => x.domainId === D0)).toBeUndefined();
  });

  it('orders Critical before Required before Stretch', () => {
    const [row] = buildMatrixRows([{
      name: 'X',
      scores: makeScores({ [D0]: 70, [D1]: 50, [D2]: 20 }, 95),
    }], null);
    expect(trainingForRow(row).map((a) => a.priority)).toEqual(['Critical', 'Required', 'Stretch']);
  });

  it('a Can-Teach OVERALL navigator still receives targeted domain training', () => {
    // 58 + 100*5 = 558 → 93 overall → Can-Teach, with one weak domain.
    const [row] = buildMatrixRows([{ name: 'Star', scores: makeScores({ [D0]: 58 }, 100) }], null);
    expect(row.overallLevel).toBe('canTeach');
    const assignments = trainingForRow(row);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ domainId: D0, priority: 'Required', score: 58 });
  });

  it('a Can-Teach OVERALL navigator still receives a CRITICAL domain assignment', () => {
    // 34 + 100*5 = 534 → 89 → Solid; push to 100s + 40 for a can-teach overall.
    const [row] = buildMatrixRows([{ name: 'Star', scores: makeScores({ [D0]: 45 }, 100) }], null);
    expect(row.overallLevel).toBe('canTeach'); // (45 + 500) / 6 = 90.8 → 91
    expect(trainingForRow(row)[0].priority).toBe('Required');
  });

  it('isRequiredAssignment treats Critical and Required as mandatory', () => {
    expect(isRequiredAssignment('Critical')).toBe(true);
    expect(isRequiredAssignment('Required')).toBe(true);
    expect(isRequiredAssignment('Stretch')).toBe(false);
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
  // NOTE: the Can-Teach health signal keys off the navigator's OFFICIAL OVERALL
  // status, so these fixtures carry a COMPLETE six-domain profile. A partial
  // profile is deliberately never counted as Can-Teach.
  const makeResult = (chosen, fill = SOLID) => ({
    answers: { [Q.id]: chosen },
    scores: makeScores({}, fill),
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

  it('tracks canTeachCount/canTeachFailCount from the OVERALL status, not the domain score', () => {
    // 2 navigators who are Can-Teach OVERALL, 1 of whom picks the wrong answer.
    const results = [
      makeResult('b', TEACH), // can-teach overall, wrong
      makeResult('a', TEACH), // can-teach overall, correct
      ...Array.from({ length: 8 }, () => makeResult('b', SOLID)), // solid overall, wrong
    ];
    const h = computeQuestionHealth([Q], results);
    expect(h[Q.id].canTeachCount).toBe(2);
    expect(h[Q.id].canTeachFailCount).toBe(1);
  });

  it('does NOT count a high score in the question\'s own domain as Can-Teach', () => {
    // 95 in this question's domain but 40 everywhere else → 49 overall = Learning.
    const results = Array.from({ length: 10 }, () => ({
      answers: { [Q.id]: 'b' },
      scores: makeScores({ [FAKE_D0]: TEACH }, 40),
    }));
    const h = computeQuestionHealth([Q], results);
    expect(overallLevel(results[0].scores)).toBe('learning');
    expect(h[Q.id].canTeachCount).toBe(0);
    expect(h[Q.id].canTeachFailCount).toBe(0);
  });

  it('never counts an incomplete profile as Can-Teach', () => {
    const results = Array.from({ length: 10 }, () => ({
      answers: { [Q.id]: 'b' },
      scores: { [FAKE_D0]: 100 }, // one domain only
    }));
    const h = computeQuestionHealth([Q], results);
    expect(h[Q.id].canTeachCount).toBe(0);
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
    // Complete six-domain profiles, so the OVERALL status is what qualifies.
    const results = [
      ...Array.from({ length: 6 }, () => ({ answers: { [Q.id]: 'a' }, scores: makeScores({}, SOLID) })),
      { answers: { [Q.id]: 'b' }, scores: makeScores({}, TEACH) },
      ...Array.from({ length: 4 }, () => ({ answers: { [Q.id]: 'b' }, scores: makeScores({}, SOLID) })),
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

  it('keeps recommending interview after a weak graded interview', () => {
    const recs = adaptiveTrainingRecommendations(row, {
      completions: [{ domainId: D0, kind: 'practice', completedAt: { seconds: 10 } }],
      interviews: [{ domainId: D0, grade: { score: 50 }, endedAt: { seconds: 20 } }],
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
  it('suggests only QUALIFIED mentors for each weaker domain, excluding self', () => {
    const suggestions = mentorSuggestions(mentorRows(), 'Learner');
    const domains = suggestions.map((s) => s.domainId);
    // Learner is 50 everywhere, so every domain is a gap with a qualified mentor.
    expect(domains).toContain(D0);
    expect(suggestions.every((s) => !s.mentors.includes('Learner'))).toBe(true);
    // D0 mentors are the two Can-Teach-overall navigators scoring ≥90 there.
    expect(suggestions.find((s) => s.domainId === D0).mentors.sort())
      .toEqual(['Narrow', 'Universal']);
    // D5: Narrow only scored 65 there, so it is not offered as a mentor.
    expect(suggestions.find((s) => s.domainId === D5).mentors).toEqual(['Universal']);
  });

  it('never offers a mentor who is only strong in that one domain', () => {
    const suggestions = mentorSuggestions(mentorRows(), 'Learner');
    // Lopsided scored 100 in D5 but is only Solid overall.
    expect(suggestions.every((s) => !s.mentors.includes('Lopsided'))).toBe(true);
  });

  it('surfaces the biggest gaps first (Critical before Learning before Solid)', () => {
    const rows = buildMatrixRows([
      ...MENTOR_SAMPLES,
      { name: 'Mixed', scores: makeScores({ [D0]: 70, [D1]: 50, [D2]: 20 }, 70) },
    ], null);
    const bands = mentorSuggestions(rows, 'Mixed').map((s) => s.band);
    expect(bands).toContain('critical');
    expect(bands).toContain('learning');
    expect(bands).toContain('solid');
    expect(bands.indexOf('critical')).toBeLessThan(bands.indexOf('learning'));
    expect(bands.lastIndexOf('learning')).toBeLessThan(bands.indexOf('solid'));
  });

  it('reports the measured domain score and flags a critical gap', () => {
    const rows = buildMatrixRows([
      ...MENTOR_SAMPLES,
      { name: 'Mixed', scores: makeScores({ [D2]: 20 }, 70) },
    ], null);
    const gap = mentorSuggestions(rows, 'Mixed').find((s) => s.domainId === D2);
    expect(gap.score).toBe(20);
    expect(gap.isCriticalGap).toBe(true);
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

  it('treats a question with no options as UNSCOREABLE, not as a zero', () => {
    // A malformed question cannot measure anything, so it provides no coverage
    // for its domain and the domain reports null rather than a fabricated 0.
    const qs = [{ id: 'bad', domainId: FAKE_D0, competencies: [C0], correctOptionId: 'a' }];
    const scores = scorePerDomain({ bad: 'a' }, qs);
    expect(scores[FAKE_D0]).toBeNull();
    expect(isScoreableQuestion(qs[0])).toBe(false);
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

  it('never compares different assessment instruments across training', () => {
    const beforeMcq = { ...h1, assessmentType: 'mcq' };
    const afterSpot = { ...h2, assessmentType: 'spot' };
    expect(trainingImpact([beforeMcq, afterSpot], [completionBetween], D0))
      .toEqual({ before: null, after: null, delta: null });
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
  it('returns every category empty for an empty floor', () => {
    const ac = buildActionCenter([], {});
    expect(ac.criticalOverall).toHaveLength(0);
    expect(ac.criticalDomainGaps).toHaveLength(0);
    expect(ac.learningOverall).toHaveLength(0);
    expect(ac.trainingOverdue).toHaveLength(0);
    expect(ac.decliningTrends).toHaveLength(0);
    expect(ac.failedPractice).toHaveLength(0);
    expect(ac.readyForMore).toHaveLength(0);
  });

  it('flags a navigator whose OFFICIAL overall status is Critical', () => {
    const rows = buildMatrixRows([{ name: 'AtRisk', scores: makeScores({}, 30) }], null);
    const ac = buildActionCenter(rows);
    expect(ac.criticalOverall).toHaveLength(1);
    expect(ac.criticalOverall[0]).toMatchObject({
      name: 'AtRisk',
      overallScore: 30,
      reason: 'Immediate supervisor attention recommended',
      severity: 'high',
    });
    // A Critical navigator is NOT double-listed as Learning.
    expect(ac.learningOverall).toHaveLength(0);
  });

  it('ranks Critical overall navigators ahead of ordinary Learning cases', () => {
    const rows = buildMatrixRows([
      { name: 'Learner', scores: makeScores({}, 50) },
      { name: 'AtRisk', scores: makeScores({}, 25) },
    ], null);
    const ac = buildActionCenter(rows);
    expect(ac.criticalOverall.map((i) => i.name)).toEqual(['AtRisk']);
    expect(ac.learningOverall.map((i) => i.name)).toEqual(['Learner']);
    // The Critical category is the first, most urgent list the supervisor reads.
    expect(Object.keys(ac)[0]).toBe('criticalOverall');
  });

  it('flags a critical DOMAIN gap even when the overall status is healthy', () => {
    // 34 + 80*5 = 434 → 72 overall (Solid), but D0 is a critical gap.
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({ [D0]: 34 }, 80) }], null);
    const ac = buildActionCenter(rows);
    expect(rows[0].overallLevel).toBe('solid');
    expect(ac.criticalOverall).toHaveLength(0);
    expect(ac.criticalDomainGaps).toContainEqual(expect.objectContaining({
      name: 'Ada',
      domainId: D0,
      score: 34,
      reason: 'Critical domain gap',
    }));
  });

  it('does not report a domain at or above 40 as a critical gap', () => {
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({ [D0]: 40 }, 80) }], null);
    expect(buildActionCenter(rows).criticalDomainGaps).toHaveLength(0);
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

  it('does not manufacture a decline by comparing MCQ with Spot', () => {
    const rows = buildMatrixRows([{ navigatorId: 'nav-1', name: 'Ada', scores: makeScores({}, SOLID) }], null);
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { navigatorId: 'nav-1', name: 'Old name', assessmentType: 'mcq', scores: makeScores({}, TEACH), takenAt: { seconds: now - 200 } },
      { navigatorId: 'nav-1', name: 'Old name', assessmentType: 'spot', scores: makeScores({}, LEARN), takenAt: { seconds: now - 100 } },
    ];
    expect(buildActionCenter(rows, { history }).decliningTrends).toHaveLength(0);
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

  it('uses the supervisor override as the effective practice score', () => {
    const rows = buildMatrixRows([{ navigatorId: 'nav-1', name: 'Ada renamed', scores: makeScores({}, SOLID) }], null);
    const interviews = [{
      navigatorId: 'nav-1', name: 'Ada', domainId: D0,
      grade: { score: 40 }, gradeOverride: { score: 85 },
    }];
    expect(buildActionCenter(rows, { interviews }).failedPractice).toHaveLength(0);
  });

  it('ignores Call QA Test grades for domain practice flags', () => {
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({}, SOLID) }], null);
    const interviews = [{ id: 'qa1', name: 'Ada', domainId: D0, grade: { score: 0 }, qa: { pass: false } }];
    const ac = buildActionCenter(rows, { interviews });
    expect(ac.failedPractice).toHaveLength(0);
  });

  it('includes ONLY overall Can-Teach navigators in ready-for-more', () => {
    const rows = buildMatrixRows([
      { name: 'Ada', scores: makeScores({}, TEACH) },
      { name: 'Bea', scores: makeScores({}, SOLID) },
    ], null);
    const ac = buildActionCenter(rows);
    expect(ac.readyForMore.map((i) => i.name)).toEqual(['Ada']);
    expect(ac.readyForMore[0]).toMatchObject({
      name: 'Ada',
      overallLevel: 'canTeach',
      reason: `${TEACH}% overall · Can-Teach`,
    });
  });

  it('excludes a Solid-overall navigator from ready-for-more despite deep domain strength', () => {
    // 100 in five domains but 0 in one → 83 overall = Solid, not Can-Teach.
    const rows = buildMatrixRows([{ name: 'Lopsided', scores: makeScores({ [D0]: 0 }, 100) }], null);
    expect(rows[0].overallLevel).toBe('solid');
    expect(buildActionCenter(rows).readyForMore).toHaveLength(0);
  });

  it('escalates a critical training assignment above an ordinary required one', () => {
    const rows = buildMatrixRows([{ name: 'Ada', scores: makeScores({ [D0]: 20 }, TEACH) }], null);
    const overdue = buildActionCenter(rows, { completions: [] }).trainingOverdue;
    const d0 = overdue.find((t) => t.domainId === D0);
    expect(d0.isCritical).toBe(true);
    expect(d0.severity).toBe('high');
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

  it('starts with coaching as the only next step when no evidence exists', () => {
    const paths = buildDevPath(row);
    const path = paths.find((p) => p.domainId === D0);
    expect(path.steps.find((s) => s.kind === 'coaching').status).toBe('next');
    expect(path.steps.filter((s) => s.status === 'next')).toHaveLength(1);
  });

  it('marks coaching and practice done, then exposes only interview', () => {
    const completions = [
      { domainId: D0, kind: 'coaching' },
      { domainId: D0, kind: 'practice' },
    ];
    const paths = buildDevPath(row, completions);
    const path = paths.find((p) => p.domainId === D0);
    expect(path.steps.find((s) => s.kind === 'practice').status).toBe('done');
    expect(path.steps.find((s) => s.kind === 'interview').status).toBe('next');
    expect(path.steps.filter((s) => s.status === 'next')).toHaveLength(1);
  });

  it('marks minicheck done and raises percentComplete to 100 when all steps complete', () => {
    const completions = [
      { domainId: D0, kind: 'coaching' },
      { domainId: D0, kind: 'practice' },
      { domainId: D0, kind: 'module' },
      { domainId: D0, kind: 'minicheck', passed: true },
    ];
    const interviews = [{ domainId: D0, grade: { score: 80 } }];
    const paths = buildDevPath(row, completions, interviews);
    const path = paths.find((p) => p.domainId === D0);
    expect(path.steps.find((s) => s.kind === 'minicheck').status).toBe('done');
    expect(path.percentComplete).toBe(100);
  });

  it('does not count a Call QA Test as the domain practice-call step', () => {
    const completions = [
      { domainId: D0, kind: 'coaching' },
      { domainId: D0, kind: 'practice' },
    ];
    const interviews = [{ domainId: D0, grade: { score: 100 }, qa: { pass: true } }];
    const paths = buildDevPath(row, completions, interviews);
    const path = paths.find((p) => p.domainId === D0);
    expect(path.steps.find((s) => s.kind === 'interview').status).toBe('next');
  });

  it('does not accept a legacy or failed mini-check as mastery', () => {
    const base = [
      { domainId: D0, kind: 'coaching' },
      { domainId: D0, kind: 'practice' },
      { domainId: D0, kind: 'module' },
    ];
    const interviews = [{ domainId: D0, grade: { score: 80 } }];
    for (const completion of [
      { domainId: D0, kind: 'minicheck' },
      { domainId: D0, kind: 'minicheck', passed: false },
    ]) {
      const path = buildDevPath(row, [...base, completion], interviews).find((p) => p.domainId === D0);
      expect(path.steps.find((s) => s.kind === 'minicheck').status).toBe('next');
    }
  });

  it('returns empty array for a Can-Teach-across-the-board navigator', () => {
    const ctRow = buildMatrixRows([{ name: 'Star', scores: makeScores({}, TEACH) }], null)[0];
    expect(buildDevPath(ctRow)).toHaveLength(0);
  });
});

describe('sequenceDevSteps', () => {
  it('recomputes a single actionable step after AI reordering', () => {
    const reordered = sequenceDevSteps([
      { kind: 'module', status: 'todo' },
      { kind: 'practice', status: 'done' },
      { kind: 'minicheck', status: 'todo' },
      { kind: 'coaching', status: 'done' },
      { kind: 'interview', status: 'todo' },
    ]);
    expect(reordered.filter((step) => step.status === 'next')).toEqual([
      expect.objectContaining({ kind: 'module' }),
    ]);
    expect(reordered.find((step) => step.kind === 'minicheck').status).toBe('todo');
  });
});

// ── buildMentorMatches / pairingOutcomes (Feature 5) ────────────────────────

describe('buildMentorMatches', () => {
  // A single qualified mentor (Can-Teach overall AND ≥90 in D0) with 3 mentees.
  const oneMentorRows = () => buildMatrixRows([
    { name: 'Dot', scores: makeScores({}, TEACH) },
    { name: 'Ada', scores: makeScores({}, LEARN) },
    { name: 'Bea', scores: makeScores({}, LEARN) },
    { name: 'Cyd', scores: makeScores({}, SOLID) },
  ], null);

  it('produces a pairing for each mentee in a domain with an available mentor', () => {
    const { pairings } = buildMentorMatches(oneMentorRows());
    const d0Pairings = pairings.filter((p) => p.domainId === D0);
    expect(d0Pairings.length).toBe(3);
    expect(d0Pairings.every((p) => p.mentorName === 'Dot')).toBe(true);
  });

  it('never pairs a mentor who is not Can-Teach OVERALL', () => {
    const { pairings } = buildMentorMatches(mentorRows());
    // Lopsided scored 100 in D5 but is only Solid overall.
    expect(pairings.every((p) => p.mentorName !== 'Lopsided')).toBe(true);
  });

  it('never pairs a Can-Teach mentor for a domain they scored below 90 in', () => {
    const { pairings } = buildMentorMatches(mentorRows());
    // Narrow scored 65 in D5, so it can mentor other domains but not D5.
    const d5 = pairings.filter((p) => p.domainId === D5);
    expect(d5.every((p) => p.mentorName !== 'Narrow')).toBe(true);
    expect(pairings.some((p) => p.domainId === D0 && p.mentorName === 'Narrow')).toBe(true);
  });

  it('respects maxLoad — mentor never exceeds cap', () => {
    const { load } = buildMentorMatches(oneMentorRows(), { maxLoad: 2 });
    for (const [, count] of Object.entries(load)) {
      expect(count).toBeLessThanOrEqual(2);
    }
    // Dot is the only mentor for D0 with 3 mentees; at maxLoad 1, 2 go unmatched.
    const { unmatched } = buildMentorMatches(oneMentorRows(), { maxLoad: 1 });
    expect(unmatched.filter((u) => u.domainId === D0).length).toBe(2);
  });

  it('prioritises Critical mentees, then Learning, then Solid', () => {
    const rows = buildMatrixRows([
      { name: 'Dot', scores: makeScores({}, TEACH) },
      { name: 'SolidOne', scores: makeScores({}, SOLID) },
      { name: 'LearnOne', scores: makeScores({}, LEARN) },
      { name: 'CritOne', scores: makeScores({}, CRIT) },
    ], null);
    const d0 = buildMentorMatches(rows).pairings.filter((p) => p.domainId === D0);
    expect(d0.map((p) => p.menteeName)).toEqual(['CritOne', 'LearnOne', 'SolidOne']);
  });

  it('puts a domain with no qualified mentor into unmatched', () => {
    const allLearning = buildMatrixRows([
      { name: 'A', scores: makeScores({}, LEARN) },
      { name: 'B', scores: makeScores({}, LEARN) },
    ], null);
    const { pairings, unmatched } = buildMentorMatches(allLearning);
    expect(pairings).toHaveLength(0);
    expect(unmatched.length).toBeGreaterThan(0);
  });

  it('records overall + domain provenance and the legacy baseline fields', () => {
    const { pairings } = buildMentorMatches(oneMentorRows());
    const d0 = pairings.find((p) => p.domainId === D0);
    // New explicit provenance
    expect(d0.mentorOverallLevel).toBe('canTeach');
    expect(typeof d0.mentorOverallScore).toBe('number');
    expect(d0.mentorDomainScore).toBeGreaterThanOrEqual(THRESHOLDS.canTeach);
    expect(typeof d0.menteeOverallScore).toBe('number');
    expect(typeof d0.menteeOverallLevel).toBe('string');
    expect(typeof d0.baselineDomainScore).toBe('number');
    // Legacy fields preserved for existing saved pairing documents
    expect(typeof d0.baselineScore).toBe('number');
    expect(typeof d0.menteeLevel).toBe('string');
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

// ── Backward compatibility with existing Firestore data ─────────────────────
// No migration ships with the capability redesign: every official status is
// derived at runtime from the `scores` object that result documents already
// carry. These tests pin that contract.

describe('backward compatibility — no Firestore migration required', () => {
  it('derives the official status from an existing result document shape', () => {
    // Exactly the shape saveResult() has always written.
    const legacyResultDoc = {
      name: 'Ada',
      navigatorId: 'nav-1',
      department: 'pediatrics',
      assessmentType: 'mcq',
      scores: makeScores({}, 70),
      competencyScores: { [C0]: 80 },
      answers: {},
      submittedAt: { seconds: 1 },
    };
    const [row] = buildMatrixRows([legacyResultDoc], null);
    expect(row.overallScore).toBe(70);
    expect(row.overallLevel).toBe('solid');
    // Nothing new is required on the stored document itself.
    expect(legacyResultDoc.overallScore).toBeUndefined();
    expect(legacyResultDoc.overallLevel).toBeUndefined();
  });

  it('renders a legacy result missing competencyScores/assessmentType', () => {
    const [row] = buildMatrixRows([{ name: 'Old', scores: makeScores({}, 66) }], null);
    expect(row.assessmentType).toBe('mcq');
    expect(row.competencyScores).toEqual({});
    expect(row.overallLevel).toBe('solid');
  });

  it('pairingOutcomes keeps working on legacy pairing records', () => {
    const rows = fixtureRows();
    // A legacy pairing document: only `baselineScore`, no `baselineDomainScore`.
    const legacyPairing = {
      domainId: D0, mentorName: 'Dot', menteeName: 'Ada',
      menteeLevel: 'learning', baselineScore: 30, status: 'active',
    };
    const [outcome] = pairingOutcomes([legacyPairing], rows);
    expect(outcome.baseline).toBe(30);
    expect(outcome.currentScore).toBe(rows.find((r) => r.name === 'Ada').scores[D0]);
    expect(outcome.delta).toBe(outcome.currentScore - 30);
    expect(outcome.improved).toBe(true);
  });

  it('pairingOutcomes prefers the new baselineDomainScore when present', () => {
    const rows = fixtureRows();
    const modern = {
      domainId: D0, mentorName: 'Dot', menteeName: 'Ada',
      baselineDomainScore: 20, baselineScore: 20, status: 'active',
    };
    expect(pairingOutcomes([modern], rows)[0].baseline).toBe(20);
  });

  it('tolerates a legacy row object that only carries `levels`', () => {
    const legacyRow = {
      name: 'Legacy',
      scores: makeScores({}, 70),
      levels: Object.fromEntries(DOMAIN_IDS.map((id) => [id, 'solid'])),
    };
    // Consumers fall back to `levels` and still derive the official status.
    expect(() => trainingForRow(legacyRow)).not.toThrow();
    expect(readinessTally([legacyRow])[0].overallScore).toBe(70);
    expect(overallDistribution([legacyRow]).solid).toBe(1);
  });
});

// ── teamTrend — overall-status based ────────────────────────────────────────

describe('teamTrend', () => {
  const snap = (navigatorId, name, ts, fill) => ({
    navigatorId, name, assessmentType: 'mcq',
    takenAt: { seconds: ts }, scores: makeScores({}, fill),
  });

  it('tracks the average overall score and the Solid+ rate over time', () => {
    const trend = teamTrend([
      snap('n1', 'Ada', 100, 50),
      snap('n1', 'Ada', 200, 80),
    ]);
    expect(trend).toHaveLength(2);
    expect(trend[0].avgOverallScore).toBe(50);
    expect(trend[0].solidPlusRate).toBe(0); // 50 overall = Learning
    expect(trend[1].avgOverallScore).toBe(80);
    expect(trend[1].solidPlusRate).toBe(100); // 80 overall = Solid
  });

  it('reports Can-Teach rate and Critical count per point', () => {
    const trend = teamTrend([
      snap('n1', 'Ada', 100, 95),
      snap('n2', 'Bea', 100, 20),
    ]);
    expect(trend[0].assessed).toBe(2);
    expect(trend[0].canTeachRate).toBe(50);
    expect(trend[0].criticalCount).toBe(1);
  });

  it('does not mix MCQ and Spot snapshots within one navigator series', () => {
    const trend = teamTrend([
      { ...snap('n1', 'Ada', 100, 40), assessmentType: 'mcq' },
      { ...snap('n1', 'Ada', 200, 90), assessmentType: 'spot' },
    ]);
    // Ada's most recent instrument is `spot`, so only spot snapshots count.
    expect(trend.every((t) => t.assessed === 1)).toBe(true);
    expect(trend.at(-1).avgOverallScore).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MERGE-BLOCKER REGRESSIONS (2026-07-20 review of PR #40)
//
// 1. Missing domain evidence must never become a score of 0.
// 2. Incomplete/unassessed profiles are mutually exclusive from official bands.
// 3. Competencies keep their own axis and never produce NaN counts.
// ─────────────────────────────────────────────────────────────────────────────

describe('BLOCKER 1 — missing domain evidence is never a zero', () => {
  const oneDomain = { [D0]: 100 };
  const oneDomainRows = () => buildMatrixRows([{ name: 'Partial', scores: oneDomain }], null);

  it('is Incomplete, with no official score or level', () => {
    const [row] = oneDomainRows();
    expect(row.overallLabel).toBe('Incomplete');
    expect(row.overallScore).toBeNull();
    expect(row.overallLevel).toBeNull();
    expect(row.overallComplete).toBe(false);
    expect(row.assessedDomains).toBe(1);
  });

  it('creates ZERO critical domain gaps from the five missing domains', () => {
    const ac = buildActionCenter(oneDomainRows());
    expect(ac.criticalDomainGaps).toHaveLength(0);
    expect(ac.criticalOverall).toHaveLength(0);
    expect(ac.learningOverall).toHaveLength(0);
    expect(ac.trainingOverdue).toHaveLength(0);
  });

  it('creates ZERO training assignments for missing domains', () => {
    const [row] = oneDomainRows();
    expect(trainingForRow(row)).toHaveLength(0);
    expect(buildDevPath(row)).toHaveLength(0);
    expect(adaptiveTrainingRecommendations(row)).toHaveLength(0);
  });

  it('creates ZERO column gaps from missing domains', () => {
    expect(columnGaps(oneDomainRows())).toHaveLength(0);
  });

  it('creates ZERO Learning Loop weak-domain signals from missing domains', () => {
    const signals = buildLearningSignals({ rows: oneDomainRows() });
    expect(signals.weakDomains).toHaveLength(0);
    expect(signals.trainingGaps).toHaveLength(0);
  });

  it('creates ZERO mentor suggestions for missing domains', () => {
    const rows = buildMatrixRows([...MENTOR_SAMPLES, { name: 'Partial', scores: oneDomain }], null);
    expect(mentorSuggestions(rows, 'Partial')).toHaveLength(0);
    // …and it is never paired or reported as an unmatched mentee either.
    const { pairings, unmatched } = buildMentorMatches(rows);
    expect(pairings.every((p) => p.menteeName !== 'Partial')).toBe(true);
    expect(unmatched.every((u) => u.menteeName !== 'Partial')).toBe(true);
  });

  it('does not bucket missing domains into a distribution band', () => {
    const dist = domainDistribution(oneDomainRows());
    const missing = dist.find((d) => d.domainId === D1);
    expect(missing.critical).toBe(0);
    expect(missing.unassessed).toBe(1);
    expect(missing.assessed).toBe(0);
    // Every COUNT is a real number — no NaN leaks from an unbucketed band.
    for (const d of dist) {
      for (const key of ['critical', 'learning', 'solid', 'canTeach', 'unassessed']) {
        expect(Number.isFinite(d[key])).toBe(true);
      }
      // avgScore is null when nobody was scored (never a fabricated 0), and a
      // real number otherwise — but never NaN.
      expect(d.avgScore === null || Number.isFinite(d.avgScore)).toBe(true);
      expect(Number.isNaN(d.avgScore)).toBe(false);
      expect(d.critical + d.learning + d.solid + d.canTeach + d.unassessed).toBe(d.total);
    }
    // The wholly-unscored domain reports no average at all.
    expect(missing.avgScore).toBeNull();
  });

  it('does not inflate the floor average', () => {
    const rows = buildMatrixRows([
      { name: 'Partial', scores: oneDomain },              // 100 in one domain
      { name: 'Real', scores: makeScores({}, 60) },        // genuine 60 overall
    ], null);
    const stats = floorStats(rows);
    // The 100 must not drag the floor average upward.
    expect(stats.avgOverallScore).toBe(60);
    expect(stats.assessed).toBe(1);
    expect(stats.rowCount).toBe(2);
  });

  it('a RECORDED score of 0 still creates a Critical gap and Critical training', () => {
    const rows = buildMatrixRows([{ name: 'Zero', scores: makeScores({ [D0]: 0 }, 80) }], null);
    const [row] = rows;
    expect(row.domainDevelopmentBands[D0]).toBe('critical');
    expect(isCriticalDomainGap(0)).toBe(true);

    const gaps = buildActionCenter(rows).criticalDomainGaps;
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ domainId: D0, score: 0 });

    const assignment = trainingForRow(row).find((a) => a.domainId === D0);
    expect(assignment.priority).toBe('Critical');
    expect(assignment.score).toBe(0);

    // …and it IS a real weak-domain signal.
    expect(buildLearningSignals({ rows }).weakDomains.some((w) => w.domainId === D0)).toBe(true);
  });

  it('distinguishes a recorded 0 from a missing domain everywhere', () => {
    const recorded = buildMatrixRows([{ name: 'Zero', scores: makeScores({ [D0]: 0 }, 80) }], null);
    const missing = buildMatrixRows([{ name: 'Gap', scores: makeScores({}, 80) }], null);
    // Same domain, opposite meaning.
    delete missing[0].scores[D0];
    const rebuiltMissing = buildMatrixRows([{ name: 'Gap', scores: missing[0].scores }], null);
    expect(recorded[0].domainDevelopmentBands[D0]).toBe('critical');
    expect(rebuiltMissing[0].domainDevelopmentBands[D0]).toBeNull();
    expect(buildActionCenter(recorded).criticalDomainGaps).toHaveLength(1);
    expect(buildActionCenter(rebuiltMissing).criticalDomainGaps).toHaveLength(0);
  });
});

describe('BLOCKER 2 — distribution categories are mutually exclusive', () => {
  const mixedRows = () => buildMatrixRows([
    { name: 'Teach', scores: makeScores({}, 95) },   // complete → canTeach
    { name: 'Sol', scores: makeScores({}, 70) },     // complete → solid
    { name: 'Learn', scores: makeScores({}, 50) },   // complete → learning
    { name: 'Crit', scores: makeScores({}, 20) },    // complete → critical
    { name: 'Partial', scores: { [D0]: 100 } },      // incomplete
    { name: 'Partial2', scores: { [D0]: 10 } },      // incomplete (low)
    { name: 'None', scores: {} },                    // unassessed
  ], null);

  it('sums exactly to total with no double counting', () => {
    const dist = overallDistribution(mixedRows());
    const sum = dist.critical + dist.learning + dist.solid + dist.canTeach
      + dist.incomplete + dist.unassessed;
    expect(sum).toBe(dist.total);
    expect(dist.total).toBe(7);
  });

  it('places each navigator in exactly one bucket', () => {
    const dist = overallDistribution(mixedRows());
    expect(dist).toMatchObject({
      canTeach: 1, solid: 1, learning: 1, critical: 1, incomplete: 2, unassessed: 1,
    });
  });

  it('never counts an incomplete navigator inside an official band', () => {
    // Both a high and a low partial profile stay out of every official band.
    const dist = overallDistribution(buildMatrixRows([
      { name: 'High', scores: { [D0]: 100 } },
      { name: 'Low', scores: { [D0]: 5 } },
    ], null));
    expect(dist.incomplete).toBe(2);
    expect(dist.critical).toBe(0);
    expect(dist.learning).toBe(0);
    expect(dist.solid).toBe(0);
    expect(dist.canTeach).toBe(0);
  });

  it('counts an unassessed navigator only as unassessed', () => {
    const dist = overallDistribution(buildMatrixRows([{ name: 'None', scores: {} }], null));
    expect(dist.unassessed).toBe(1);
    expect(dist.incomplete).toBe(0);
    expect(dist.critical + dist.learning + dist.solid + dist.canTeach).toBe(0);
  });

  it('floorStats KPIs use complete profiles only', () => {
    const stats = floorStats(mixedRows());
    expect(stats.assessed).toBe(4);          // only the four complete profiles
    expect(stats.rowCount).toBe(7);
    expect(stats.incompleteCount).toBe(2);
    expect(stats.unassessedCount).toBe(1);
    expect(stats.canTeachCount).toBe(1);
    expect(stats.criticalCount).toBe(1);
    // Solid+ is 2 of the 4 eligible navigators, not 2 of 7.
    expect(stats.solidPlusRate).toBe(50);
    // (95 + 70 + 50 + 20) / 4 = 58.75 → 59
    expect(stats.avgOverallScore).toBe(59);
  });

  it('unassessed rows do not count as assessed', () => {
    const stats = floorStats(buildMatrixRows([
      { name: 'None', scores: {} },
      { name: 'AlsoNone', scores: {} },
    ], null));
    expect(stats.assessed).toBe(0);
    // No eligible evidence -> no official aggregate at all (renders N/A).
    expect(stats.avgOverallScore).toBeNull();
    expect(stats.solidPlusRate).toBeNull();
  });
});

describe('BLOCKER 3 — competencies are a separate axis', () => {
  it('uses its own thresholds, not the capability bands', () => {
    expect(COMPETENCY_THRESHOLDS).toEqual({ learning: 60, canTeach: 85 });
    expect(COMPETENCY_THRESHOLDS.canTeach).not.toBe(THRESHOLDS.canTeach);
  });

  it.each([
    [0, 'learning'],
    [39, 'learning'],
    [40, 'learning'],
    [59, 'learning'],
    [60, 'solid'],
    [84, 'solid'],
    [85, 'canTeach'],
    [100, 'canTeach'],
  ])('maps a competency score of %i to "%s"', (score, expected) => {
    expect(competencyScoreToLevel(score)).toBe(expected);
  });

  it('never emits a "critical" id the competency distribution has no bucket for', () => {
    for (const score of [0, 39, 40, 59, 60, 84, 85, 100]) {
      expect(competencyScoreToLevel(score)).not.toBe('critical');
    }
    expect(competencyScoreToLevel(undefined)).toBeNull();
  });

  it('a below-40 competency neither produces NaN nor disappears', () => {
    const rows = buildMatrixRows([
      { name: 'A', scores: {}, competencyScores: { [C0]: 30 } },
      { name: 'B', scores: {}, competencyScores: { [C0]: 0 } },
    ], null);
    const dist = competencyDistribution(rows);
    const c0 = dist.find((x) => x.competencyId === C0);
    expect(c0).toBeDefined();                 // did not disappear
    expect(c0.learning).toBe(2);              // both counted
    expect(c0.total).toBe(2);
    expect(Number.isNaN(c0.critical)).toBe(false);
    expect(c0.critical).toBeUndefined();      // no critical bucket on this axis
  });

  it('every competency distribution count is finite and sums to total', () => {
    const rows = buildMatrixRows([
      { name: 'A', scores: {}, competencyScores: { [C0]: 0, [C1]: 60 } },
      { name: 'B', scores: {}, competencyScores: { [C0]: 39, [C1]: 85 } },
      { name: 'C', scores: {}, competencyScores: { [C0]: 100, [C1]: 59 } },
    ], null);
    const dist = competencyDistribution(rows);
    expect(dist.length).toBeGreaterThan(0);
    for (const c of dist) {
      for (const key of ['learning', 'solid', 'canTeach', 'total']) {
        expect(Number.isFinite(c[key])).toBe(true);
      }
      expect(c.learning + c.solid + c.canTeach).toBe(c.total);
    }
  });

  it('buildMatrixRows tags competency levels with the competency mapper', () => {
    const [row] = buildMatrixRows([
      { name: 'A', scores: {}, competencyScores: { [C0]: 30, [C1]: 88 } },
    ], null);
    // 30 would be 'critical' on the capability scale; on this axis it is Learning.
    expect(row.competencyLevels[C0]).toBe('learning');
    // 88 would be 'solid' on the capability scale; on this axis it is Can-Teach.
    expect(row.competencyLevels[C1]).toBe('canTeach');
  });

  it('ignores a stray capability band id carried on a legacy row', () => {
    const legacy = [{
      name: 'Legacy',
      scores: {},
      competencyScores: {},
      competencyLevels: { [C0]: 'critical' }, // not a competency level
    }];
    const dist = competencyDistribution(legacy);
    // The unknown id is skipped rather than producing NaN.
    expect(dist).toEqual([]);
  });
});

describe('complete profiles retain all prior behaviour', () => {
  const complete = () => buildMatrixRows([
    { name: 'Teach', scores: makeScores({}, 95) },
    { name: 'Mixed', scores: makeScores({ [D0]: 34, [D1]: 50, [D2]: 70 }, 95) },
  ], null);

  it('keeps threshold, training, readiness, mentorship and health behaviour', () => {
    const rows = complete();
    const [teach, mixed] = rows;

    // Thresholds / official status
    expect(teach.overallLevel).toBe('canTeach');
    expect(teach.overallScore).toBe(95);
    expect(mixed.overallComplete).toBe(true);

    // Training still driven by domain score
    const assignments = trainingForRow(mixed);
    expect(assignments.find((a) => a.domainId === D0).priority).toBe('Critical');
    expect(assignments.find((a) => a.domainId === D1).priority).toBe('Required');
    expect(assignments.find((a) => a.domainId === D2).priority).toBe('Stretch');

    // Readiness / mentorship
    expect(readinessTally(rows)[0].name).toBe('Teach');
    expect(readinessTally(rows)[0].readyForMore).toBe(true);
    expect(domainMentorRoster(rows)[D0]).toEqual(['Teach']);

    // Question health still keys off the official overall status
    const Q = { id: 'q1', correctOptionId: 'a', domainId: D0 };
    const results = Array.from({ length: 10 }, () => ({
      answers: { q1: 'b' }, scores: makeScores({}, 95),
    }));
    expect(computeQuestionHealth([Q], results).q1.canTeachCount).toBe(10);
  });

  it('still produces a critical gap alongside a healthy overall status', () => {
    // 34 + 80*5 = 434 → 72 overall (Solid) with one critical domain.
    const rows = buildMatrixRows([{ name: 'X', scores: makeScores({ [D0]: 34 }, 80) }], null);
    expect(rows[0].overallLevel).toBe('solid');
    expect(buildActionCenter(rows).criticalDomainGaps).toHaveLength(1);
  });
});


// ── Cross-department view keeps Incomplete distinct from Unassessed ─────────
// Both states have `score === null`, so keying a cell on the score alone would
// collapse "partial evidence" into "no evidence" and hide an in-progress
// assessment from the cross-department table.

describe('departmentMatrix — Incomplete is not Unassessed', () => {
  const sixDomains = (fill) => Object.fromEntries(DOMAIN_IDS.map((id) => [id, fill]));
  const nDomains = (n, fill) => Object.fromEntries(DOMAIN_IDS.slice(0, n).map((id) => [id, fill]));

  const cellsFor = (departments) =>
    departmentMatrix([{ name: 'X', departments }], null)[0].depts;

  it('0 of 6 domains stays null (Not assessed)', () => {
    const cells = cellsFor({ pediatrics: {} });
    expect(cells.pediatrics).toBeNull();
  });

  it('a department absent from the record stays null', () => {
    const cells = cellsFor({});
    expect(cells.pediatrics).toBeNull();
  });

  it('1 of 6 domains returns a real Incomplete cell, not null', () => {
    const cell = cellsFor({ pediatrics: nDomains(1, 100) }).pediatrics;
    expect(cell).not.toBeNull();
    expect(cell).toMatchObject({
      overall: null,
      level: null,
      complete: false,
      label: 'Incomplete',
      assessedDomains: 1,
      totalDomains: 6,
    });
  });

  it('5 of 6 domains returns a real Incomplete cell, not null', () => {
    const cell = cellsFor({ pediatrics: nDomains(5, 80) }).pediatrics;
    expect(cell).not.toBeNull();
    expect(cell).toMatchObject({
      overall: null, level: null, complete: false, label: 'Incomplete', assessedDomains: 5,
    });
  });

  it('6 of 6 domains returns the official percentage and level', () => {
    const cell = cellsFor({ pediatrics: sixDomains(95) }).pediatrics;
    expect(cell).toMatchObject({
      overall: 95, level: 'canTeach', complete: true, label: 'Can-Teach', assessedDomains: 6,
    });
  });

  it('a 1/6 profile containing 100% never reports 100% overall or Can-Teach', () => {
    const cell = cellsFor({ pediatrics: nDomains(1, 100) }).pediatrics;
    expect(cell.overall).not.toBe(100);
    expect(cell.overall).toBeNull();
    expect(cell.level).not.toBe('canTeach');
    expect(cell.level).toBeNull();
    expect(cell.label).toBe('Incomplete');
  });

  it('distinguishes all three states side by side in one row', () => {
    const cells = cellsFor({
      pediatrics: sixDomains(95),   // complete
      obgyn: nDomains(1, 100),      // incomplete
      adult: {},                    // unassessed
    });
    expect(cells.pediatrics.complete).toBe(true);
    expect(cells.obgyn).not.toBeNull();
    expect(cells.obgyn.complete).toBe(false);
    expect(cells.adult).toBeNull();
  });

  it('carries assessedDomains so a badge cannot mistake Incomplete for unassessed', () => {
    const cell = cellsFor({ pediatrics: nDomains(3, 70) }).pediatrics;
    expect(cell.assessedDomains).toBe(3);
    expect(cell.totalDomains).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FINAL-REVIEW REGRESSIONS (2026-07-21)
//
// The governing invariant: missing evidence must never be represented as
// failure, mastery, or a real 0%. Only a genuinely measured numeric zero is a
// Critical result.
// ─────────────────────────────────────────────────────────────────────────────

describe('assessment bank coverage', () => {
  const q = (id, domainId) => ({
    id,
    domainId,
    competencies: [C0],
    correctOptionId: 'a',
    options: [{ id: 'a', text: 'right', points: 100 }, { id: 'b', text: 'wrong', points: 0 }],
  });
  const fullBank = () => DOMAIN_IDS.map((d, i) => q(`q${i}`, d));

  it('accepts a bank covering all six configured domains', () => {
    const cov = assessmentBankCoverage(fullBank());
    expect(cov.complete).toBe(true);
    expect(cov.missing).toEqual([]);
    expect(isAssessmentBankComplete(fullBank())).toBe(true);
  });

  it('rejects a bank missing one configured domain', () => {
    const bank = fullBank().filter((x) => x.domainId !== D2);
    const cov = assessmentBankCoverage(bank);
    expect(cov.complete).toBe(false);
    expect(cov.missing).toEqual([D2]);
  });

  it('rejects a bank missing several configured domains', () => {
    const bank = fullBank().filter((x) => [D0, D1].includes(x.domainId));
    const cov = assessmentBankCoverage(bank);
    expect(cov.complete).toBe(false);
    expect(cov.missing).toEqual([D2, D3, D4, D5]);
  });

  it('rejects an empty bank', () => {
    expect(assessmentBankCoverage([]).complete).toBe(false);
    expect(assessmentBankCoverage(undefined).complete).toBe(false);
  });

  it('does not count an unscoreable question as coverage', () => {
    const bank = [...fullBank().filter((x) => x.domainId !== D2), { id: 'x', domainId: D2 }];
    expect(assessmentBankCoverage(bank).missing).toEqual([D2]);
    expect(isScoreableQuestion({ id: 'x', domainId: D2 })).toBe(false);
    expect(isScoreableQuestion({ id: 'x', domainId: D2, options: [] })).toBe(false);
    expect(isScoreableQuestion({ id: 'x', domainId: 'not-a-domain', options: [{ id: 'a' }] })).toBe(false);
  });

  it('the real Pediatrics and OB/GYN seed banks are complete and score normally', () => {
    for (const bank of [QUESTIONS, SEED_QUESTIONS_OBGYN]) {
      expect(isAssessmentBankComplete(bank)).toBe(true);
      const scores = scorePerDomain({}, bank);
      // Every domain measurable -> every domain numeric (all-wrong = 0).
      for (const id of DOMAIN_IDS) expect(Number.isFinite(scores[id])).toBe(true);
      expect(overallComplete(scores)).toBe(true);
    }
  });
});

describe('scorePerDomain — uncovered domain is null, measured zero is 0', () => {
  const q = (id, domainId, points) => ({
    id,
    domainId,
    correctOptionId: 'a',
    options: [{ id: 'a', text: 'right', points: 100 }, { id: 'b', text: 'wrong', points }],
  });

  it('an uncovered domain is never stored as 0', () => {
    const bank = DOMAIN_IDS.filter((d) => d !== D3).map((d, i) => q(`q${i}`, d, 0));
    const scores = scorePerDomain({}, bank);
    expect(scores[D3]).toBeNull();
    expect(scores[D3]).not.toBe(0);
  });

  it('a covered domain where every response earns zero still records a real 0', () => {
    const bank = DOMAIN_IDS.map((d, i) => q(`q${i}`, d, 0));
    const answers = Object.fromEntries(bank.map((x) => [x.id, 'b'])); // all wrong
    const scores = scorePerDomain(answers, bank);
    for (const id of DOMAIN_IDS) expect(scores[id]).toBe(0);
    // A genuine zero profile IS Critical — that behaviour must be preserved.
    expect(overallComplete(scores)).toBe(true);
    expect(overallScore(scores)).toBe(0);
    expect(overallLevel(scores)).toBe('critical');
  });

  it('a partially populated bank cannot generate a complete official profile', () => {
    const bank = DOMAIN_IDS.filter((d) => d !== D3).map((d, i) => q(`q${i}`, d, 0));
    const scores = scorePerDomain({}, bank);
    expect(overallComplete(scores)).toBe(false);
    expect(overallScore(scores)).toBeNull();
    expect(overallLevel(scores)).toBeNull();
    expect(overallStatus(scores).label).toBe('Incomplete');
  });

  it('strict mode throws before scoring an incomplete bank', () => {
    const bank = DOMAIN_IDS.filter((d) => d !== D3).map((d, i) => q(`q${i}`, d, 0));
    expect(() => scorePerDomain({}, bank, { strict: true })).toThrow(IncompleteAssessmentBankError);
    try {
      scorePerDomain({}, bank, { strict: true });
    } catch (err) {
      expect(err.missing).toEqual([D3]);
    }
    // A complete bank does not throw.
    expect(() => scorePerDomain({}, DOMAIN_IDS.map((d, i) => q(`q${i}`, d, 0)), { strict: true })).not.toThrow();
  });

  it('an uncovered domain produces no Critical gap and no training', () => {
    const bank = DOMAIN_IDS.filter((d) => d !== D3).map((d, i) => q(`q${i}`, d, 0));
    const answers = Object.fromEntries(bank.map((x) => [x.id, 'b']));
    const scores = scorePerDomain(answers, bank);
    const [row] = buildMatrixRows([{ name: 'X', scores }], null);
    expect(row.domainDevelopmentBands[D3]).toBeNull();
    expect(buildActionCenter([row]).criticalDomainGaps.every((g) => g.domainId !== D3)).toBe(true);
    expect(trainingForRow(row).every((a) => a.domainId !== D3)).toBe(true);
    // …but the genuinely-zero domains DO produce critical gaps.
    expect(buildActionCenter([row]).criticalDomainGaps.some((g) => g.domainId === D0)).toBe(true);
  });
});

describe('trainingEmptyStateReason — empty assignments are not proof of mastery', () => {
  const rowWith = (scores) => buildMatrixRows([{ name: 'X', scores }], null)[0];

  it('0 of 6 domains -> unassessed', () => {
    expect(trainingEmptyStateReason(rowWith({}))).toBe('unassessed');
    expect(hasMasteredAllDomains(rowWith({}))).toBe(false);
  });

  it('1-5 of 6 domains -> incomplete', () => {
    expect(trainingEmptyStateReason(rowWith({ [D0]: 95 }))).toBe('incomplete');
    const five = Object.fromEntries(DOMAIN_IDS.slice(0, 5).map((id) => [id, 95]));
    expect(trainingEmptyStateReason(rowWith(five))).toBe('incomplete');
    expect(hasMasteredAllDomains(rowWith(five))).toBe(false);
  });

  it('6 of 6 with every score >= 90 -> mastered', () => {
    expect(trainingEmptyStateReason(rowWith(makeScores({}, 95)))).toBe('mastered');
    expect(hasMasteredAllDomains(rowWith(makeScores({}, 95)))).toBe(true);
    // Exactly at the boundary still counts as mastery.
    expect(trainingEmptyStateReason(rowWith(makeScores({}, 90)))).toBe('mastered');
  });

  it('6 of 6 with a weak domain -> has-assignments', () => {
    expect(trainingEmptyStateReason(rowWith(makeScores({ [D0]: 50 }, 95)))).toBe('has-assignments');
    expect(hasMasteredAllDomains(rowWith(makeScores({ [D0]: 50 }, 95)))).toBe(false);
  });

  it('an all-zero complete profile is never mastery', () => {
    expect(trainingEmptyStateReason(rowWith(makeScores({}, 0)))).toBe('has-assignments');
  });
});

describe('aggregates report null (N/A) when there is no evidence', () => {
  it('floorStats: no complete profiles -> null rate and null average', () => {
    const rows = buildMatrixRows([
      { name: 'Partial', scores: { [D0]: 100 } },
      { name: 'None', scores: {} },
    ], null);
    const stats = floorStats(rows);
    expect(stats.assessed).toBe(0);
    expect(stats.avgOverallScore).toBeNull();
    expect(stats.solidPlusRate).toBeNull();
    // Counts remain genuine zeroes.
    expect(stats.canTeachCount).toBe(0);
    expect(stats.criticalCount).toBe(0);
  });

  it('floorStats: a genuine complete zero floor still reports 0%, not null', () => {
    const rows = buildMatrixRows([{ name: 'Zero', scores: makeScores({}, 0) }], null);
    const stats = floorStats(rows);
    expect(stats.assessed).toBe(1);
    expect(stats.avgOverallScore).toBe(0);
    expect(stats.solidPlusRate).toBe(0);
    expect(stats.criticalCount).toBe(1);
  });

  it('floorStats: mixed complete + incomplete uses complete profiles only', () => {
    const rows = buildMatrixRows([
      { name: 'Complete', scores: makeScores({}, 80) },
      { name: 'Partial', scores: { [D0]: 100 } },
      { name: 'None', scores: {} },
    ], null);
    const stats = floorStats(rows);
    expect(stats.assessed).toBe(1);
    expect(stats.avgOverallScore).toBe(80); // not (80+100)/2
    expect(stats.solidPlusRate).toBe(100);
    expect(stats.rowCount).toBe(3);
  });

  it('domainDistribution: avgScore is null when nobody was scored in that domain', () => {
    const rows = buildMatrixRows([{ name: 'X', scores: { [D0]: 70 } }], null);
    const dist = domainDistribution(rows);
    expect(dist.find((d) => d.domainId === D0).avgScore).toBe(70);
    expect(dist.find((d) => d.domainId === D1).avgScore).toBeNull();
  });

  it('domainDistribution: a genuine zero in a domain still averages to 0', () => {
    const rows = buildMatrixRows([{ name: 'X', scores: makeScores({}, 0) }], null);
    expect(domainDistribution(rows).find((d) => d.domainId === D0).avgScore).toBe(0);
  });

  it('teamTrend: omits timepoints with no complete profile', () => {
    const snap = (navigatorId, ts, scores) => ({
      navigatorId, name: navigatorId, assessmentType: 'mcq',
      takenAt: { seconds: ts }, scores,
    });
    const trend = teamTrend([
      snap('n1', 100, { [D0]: 90 }),            // incomplete -> no aggregate
      snap('n1', 200, makeScores({}, 80)),      // complete
    ]);
    expect(trend).toHaveLength(1);
    expect(trend[0].avgOverallScore).toBe(80);
    // No point was emitted at 0% for the incomplete snapshot.
    expect(trend.every((t) => t.avgOverallScore !== 0)).toBe(true);
  });

  it('buildTrend: a missing historical domain score becomes a gap, not a zero', () => {
    const history = [
      { takenAt: { seconds: 100 }, scores: makeScores({}, 80) },
      { takenAt: { seconds: 200 }, scores: makeScores({}, 80) },
      // D0 was not measured in this later check.
      { takenAt: { seconds: 300 }, scores: { ...makeScores({}, 80), [D0]: undefined } },
    ];
    const trend = buildTrend(history, { synthesize: false });
    const series = trend.domainSeries[D0];
    expect(series[series.length - 1]).toBeNull();
    expect(series[series.length - 1]).not.toBe(0);
    // The measured points are untouched.
    expect(series[0]).toBe(80);
  });
});

describe('competency axis stays three-level', () => {
  it.each([
    [0, 'learning'], [39, 'learning'], [40, 'learning'], [59, 'learning'],
    [60, 'solid'], [84, 'solid'], [85, 'canTeach'], [100, 'canTeach'],
  ])('competency %i maps to %s', (score, expected) => {
    expect(competencyScoreToLevel(score)).toBe(expected);
  });

  it('never produces a critical band', () => {
    for (let s = 0; s <= 100; s++) expect(competencyScoreToLevel(s)).not.toBe('critical');
  });

  it('COMPETENCY_LEVEL_ORDER has exactly the three competency levels', () => {
    expect(COMPETENCY_LEVEL_ORDER).toEqual(['learning', 'solid', 'canTeach']);
    expect(COMPETENCY_LEVEL_ORDER).not.toContain('critical');
  });

  it('competency distribution counts are finite and sum to total', () => {
    const rows = buildMatrixRows([
      { name: 'A', scores: {}, competencyScores: { [C0]: 0, [C1]: 60 } },
      { name: 'B', scores: {}, competencyScores: { [C0]: 39, [C1]: 85 } },
      { name: 'C', scores: {}, competencyScores: { [C0]: 100, [C1]: 59 } },
    ], null);
    for (const c of competencyDistribution(rows)) {
      for (const key of ['learning', 'solid', 'canTeach', 'total']) {
        expect(Number.isFinite(c[key])).toBe(true);
      }
      expect(c.critical).toBeUndefined();
      expect(c.learning + c.solid + c.canTeach).toBe(c.total);
    }
  });

  it('the official department status still uses the separate four-band scale', () => {
    // Same number, two different axes.
    expect(competencyScoreToLevel(50)).toBe('learning');
    expect(scoreToLevel(50)).toBe('learning');
    expect(competencyScoreToLevel(30)).toBe('learning'); // no critical band here
    expect(scoreToLevel(30)).toBe('critical'); // but the capability scale has one
    expect(competencyScoreToLevel(87)).toBe('canTeach');
    expect(scoreToLevel(87)).toBe('solid'); // different boundary on purpose
  });
});

describe('readinessTally distinguishes Incomplete from Not assessed', () => {
  it('carries assessedDomains so consumers can tell the two apart', () => {
    const rows = buildMatrixRows([
      { name: 'Partial', scores: { [D0]: 90 } },
      { name: 'None', scores: {} },
      { name: 'Full', scores: makeScores({}, 95) },
    ], null);
    const byName = Object.fromEntries(readinessTally(rows).map((r) => [r.name, r]));
    expect(byName.Partial).toMatchObject({ overallScore: null, overallLabel: 'Incomplete', assessedDomains: 1, complete: false });
    expect(byName.None).toMatchObject({ overallScore: null, overallLabel: 'Not assessed', assessedDomains: 0, complete: false });
    expect(byName.Full).toMatchObject({ overallScore: 95, overallLabel: 'Can-Teach', assessedDomains: 6, complete: true });
  });
});
