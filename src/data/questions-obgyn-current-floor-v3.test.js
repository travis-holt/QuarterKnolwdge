import { describe, expect, it } from 'vitest';
import {
  OBGYN_CURRENT_FLOOR_BANK_VERSION,
  OBGYN_CURRENT_FLOOR_QUESTIONS,
} from './questions-obgyn-current-floor-v3.js';
import {
  OBGYN_RULE_SET_VERSION,
  OBGYN_SOP_VERSION,
  OBGYN_SOURCE_AUTHORITY,
  OBGYN_WORKFLOW_RULES,
  getObgynWorkflowRule,
} from './obgynWorkflowRules.js';
import { validateQuestionContent } from '../lib/contentGuards.js';

const DOMAINS = ['intake', 'classification', 'routing', 'scheduling', 'boundaries', 'documentation'];

function correctText(questionId) {
  const question = OBGYN_CURRENT_FLOOR_QUESTIONS.find((item) => item.id === questionId);
  return question?.options.find((option) => option.id === question.correctOptionId)?.text ?? '';
}

describe('OB/GYN current-floor MCQ bank v3', () => {
  it('contains 24 challenging items balanced four per domain', () => {
    expect(OBGYN_CURRENT_FLOOR_QUESTIONS).toHaveLength(24);
    for (const domainId of DOMAINS) {
      expect(OBGYN_CURRENT_FLOOR_QUESTIONS.filter((item) => item.domainId === domainId)).toHaveLength(4);
    }
    expect(new Set(OBGYN_CURRENT_FLOOR_QUESTIONS.map((item) => item.id)).size).toBe(24);
  });

  it('keeps the scoring contract and meaningful near-miss partial credit', () => {
    for (const question of OBGYN_CURRENT_FLOOR_QUESTIONS) {
      expect(question.department).toBe('obgyn');
      expect(question.options).toHaveLength(4);
      expect(question.scenario.length).toBeGreaterThan(90);
      const perfect = question.options.filter((option) => option.points === 100);
      expect(perfect).toHaveLength(1);
      expect(perfect[0].id).toBe(question.correctOptionId);
      expect(question.options.every((option) => option.rationale.trim().length > 20)).toBe(true);
      expect(question.options.some((option) => option.points > 0 && option.points < 100)).toBe(true);
    }
  });

  it('pins exact current-floor provenance and covers all 24 executable rules', () => {
    const covered = new Set();
    for (const question of OBGYN_CURRENT_FLOOR_QUESTIONS) {
      expect(question.sourceSopVersion).toBe(OBGYN_SOP_VERSION);
      expect(question.sourceRuleVersion).toBe(OBGYN_RULE_SET_VERSION);
      expect(question.sourceAuthority).toBe(OBGYN_SOURCE_AUTHORITY);
      expect(question.ruleIds.length).toBeGreaterThan(0);
      for (const ruleId of question.ruleIds) {
        expect(getObgynWorkflowRule(ruleId)).toBeTruthy();
        covered.add(ruleId);
      }
    }
    expect([...covered].sort()).toEqual(OBGYN_WORKFLOW_RULES.map((rule) => rule.id).sort());
    expect(OBGYN_CURRENT_FLOOR_BANK_VERSION).toContain('2026-07-17');
  });

  it('passes shared guards and preserves the highest-risk current-floor outcomes', () => {
    for (const question of OBGYN_CURRENT_FLOOR_QUESTIONS) {
      expect(validateQuestionContent(question)).toEqual([]);
    }
    const authoritative = OBGYN_CURRENT_FLOOR_QUESTIONS
      .map((question) => {
        const best = question.options.find((option) => option.id === question.correctOptionId);
        return `${question.scenario}\n${best.text}\n${best.rationale}`;
      })
      .join('\n');
    expect(authoritative).not.toMatch(/\bPSS OB\b/i);
    expect(authoritative).not.toMatch(/\bPSS Queue\b/i);
    expect(correctText('qv3-obgyn-classification-1')).toMatch(/Annual GYN/i);
    expect(correctText('qv3-obgyn-classification-3')).toMatch(/High Priority TE.*urgent Intermedia channel/i);
    expect(correctText('qv3-obgyn-boundaries-3')).toMatch(/without booking or interpreting/i);
    expect(correctText('qv3-obgyn-scheduling-1')).toMatch(/OB Verified/i);
  });
});
