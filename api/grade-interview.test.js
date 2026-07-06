// Tests for the practice-call grade coercion — previously inline in the handler
// (and untested); now exported as coerceGrade like its grade-call-qa siblings.
import { describe, it, expect } from 'vitest';
import { coerceGrade } from './grade-interview.js';

describe('coerceGrade', () => {
  it('passes through a well-formed grade (rounded score)', () => {
    const g = coerceGrade({ score: 87.6, summary: ' good call ', strengths: ['a'], improvements: ['b'] });
    expect(g).toEqual({ score: 88, summary: 'good call', strengths: ['a'], improvements: ['b'] });
  });

  it('clamps the score to 0–100', () => {
    expect(coerceGrade({ score: 250 }).score).toBe(100);
    expect(coerceGrade({ score: -5 }).score).toBe(0);
  });

  it('coerces a non-numeric score to 0', () => {
    expect(coerceGrade({ score: 'great' }).score).toBe(0);
  });

  it('defaults missing/mistyped fields to safe empties', () => {
    expect(coerceGrade({})).toEqual({ score: 0, summary: '', strengths: [], improvements: [] });
    expect(coerceGrade({ summary: 42, strengths: 'x', improvements: null })).toEqual({
      score: 0, summary: '', strengths: [], improvements: [],
    });
  });

  it('stringifies array items and tolerates null/undefined input', () => {
    expect(coerceGrade({ strengths: [1, 'two'] }).strengths).toEqual(['1', 'two']);
    expect(coerceGrade(null)).toEqual({ score: 0, summary: '', strengths: [], improvements: [] });
    expect(coerceGrade(undefined)).toEqual({ score: 0, summary: '', strengths: [], improvements: [] });
  });
});
