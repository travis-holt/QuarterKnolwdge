// ─────────────────────────────────────────────────────────────────────────────
// UNIT TESTS for the MCQ v2 operating-model question bank (questions-v2.js).
//
// These enforce the quality bar for the replacement bank: shape validity, exactly
// one 100-point best answer per question, correctOptionId integrity, content-guard
// compliance, balanced department + domain coverage, and no scoring regression
// (v2 options flow through the existing scoring pipeline unchanged).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  V2_QUESTIONS_PEDS,
  V2_QUESTIONS_OBGYN,
  ALL_V2_QUESTIONS,
  V2_DEPARTMENTS,
} from './questions-v2.js';
import { DOMAINS } from './questions.js';
import { COMPETENCY_IDS } from './competencies.js';
import { validateQuestionContent } from '../lib/contentGuards.js';
import { scorePerDomain, scorePerCompetency } from '../lib/scoring.js';

const DOMAIN_IDS = new Set(DOMAINS.map((d) => d.id));

describe('questions-v2 bank shape', () => {
  it('has 48 questions (24 pediatrics + 24 obgyn)', () => {
    expect(V2_QUESTIONS_PEDS).toHaveLength(24);
    expect(V2_QUESTIONS_OBGYN).toHaveLength(24);
    expect(ALL_V2_QUESTIONS).toHaveLength(48);
  });

  it('has globally unique ids following the qv2-<dept>-<domain>-<n> convention', () => {
    const ids = ALL_V2_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^qv2-(peds|obgyn)-[a-z]+-\d+$/);
    }
  });

  it('tags every question with a known department, domain, and competencies', () => {
    for (const q of ALL_V2_QUESTIONS) {
      expect(V2_DEPARTMENTS).toContain(q.department);
      expect(DOMAIN_IDS.has(q.domainId)).toBe(true);
      expect(Array.isArray(q.competencies)).toBe(true);
      expect(q.competencies.length).toBeGreaterThan(0);
      for (const c of q.competencies) expect(COMPETENCY_IDS.has(c)).toBe(true);
    }
  });

  it('gives each question exactly four options with ids a–d', () => {
    for (const q of ALL_V2_QUESTIONS) {
      expect(q.options).toHaveLength(4);
      expect(q.options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
    }
  });
});

describe('questions-v2 scoring integrity', () => {
  it('has exactly one 100-point option per question', () => {
    for (const q of ALL_V2_QUESTIONS) {
      const best = q.options.filter((o) => o.points === 100);
      expect(best, `question ${q.id} must have exactly one 100-point option`).toHaveLength(1);
    }
  });

  it('points correctOptionId at the single 100-point option', () => {
    for (const q of ALL_V2_QUESTIONS) {
      const best = q.options.find((o) => o.points === 100);
      expect(q.correctOptionId, `question ${q.id}`).toBe(best.id);
    }
  });

  it('keeps every option within 0–100 with partial-credit distractors', () => {
    for (const q of ALL_V2_QUESTIONS) {
      for (const o of q.options) {
        expect(o.points).toBeGreaterThanOrEqual(0);
        expect(o.points).toBeLessThanOrEqual(100);
      }
      // At least one distractor carries partial (non-zero, non-100) credit.
      const partial = q.options.filter((o) => o.points > 0 && o.points < 100);
      expect(partial.length, `question ${q.id}`).toBeGreaterThan(0);
    }
  });

  it('gives every option non-empty text and a rationale', () => {
    for (const q of ALL_V2_QUESTIONS) {
      expect(q.scenario.trim().length).toBeGreaterThan(0);
      for (const o of q.options) {
        expect(o.text.trim().length, `question ${q.id} option ${o.id}`).toBeGreaterThan(0);
        expect(o.rationale.trim().length, `question ${q.id} option ${o.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('questions-v2 content guards', () => {
  it('passes the shared content guards (no lookup-order/PE-hard-stop grading)', () => {
    for (const q of ALL_V2_QUESTIONS) {
      expect(validateQuestionContent(q), `question ${q.id}`).toEqual([]);
    }
  });
});

describe('questions-v2 coverage balance', () => {
  it('has exactly 4 questions per domain per department', () => {
    for (const dept of V2_DEPARTMENTS) {
      for (const domain of DOMAIN_IDS) {
        const n = ALL_V2_QUESTIONS.filter((q) => q.department === dept && q.domainId === domain).length;
        expect(n, `${dept}/${domain}`).toBe(4);
      }
    }
  });
});

describe('questions-v2 works with the existing scoring pipeline', () => {
  it('scorePerDomain and scorePerCompetency accept v2 options unchanged', () => {
    // Answer every peds question with its best option → all domains score 100.
    const answers = {};
    for (const q of V2_QUESTIONS_PEDS) answers[q.id] = q.correctOptionId;
    const domainScores = scorePerDomain(answers, V2_QUESTIONS_PEDS);
    for (const domain of DOMAIN_IDS) {
      expect(domainScores[domain]).toBe(100);
    }
    // A partial-credit answer produces a sub-100 domain score (partial credit works).
    const q = V2_QUESTIONS_PEDS[0];
    const partialOpt = q.options.find((o) => o.points > 0 && o.points < 100);
    const partial = scorePerDomain({ [q.id]: partialOpt.id }, [q]);
    expect(partial[q.domainId]).toBe(partialOpt.points);

    const compScores = scorePerCompetency(answers, V2_QUESTIONS_PEDS);
    for (const c of q.competencies) expect(compScores[c]).toBe(100);
  });
});
