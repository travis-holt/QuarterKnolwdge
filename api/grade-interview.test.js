// Tests for the practice-call grade coercion — previously inline in the handler
// (and untested); now exported as coerceGrade like its grade-call-qa siblings.
import { describe, it, expect } from 'vitest';
import { coerceGrade, coerceFindings, buildMessages } from './grade-interview.js';

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

  it('stays backward-compatible: omits findings key when there are none', () => {
    const g = coerceGrade({ score: 80, summary: 's', strengths: [], improvements: [] });
    expect(g).not.toHaveProperty('findings');
  });

  it('attaches well-formed findings when present', () => {
    const g = coerceGrade({
      score: 70, summary: 's', strengths: [], improvements: [],
      findings: [{ area: 'routing', verdict: 'missed', evidence: 'sent to wrong queue', coaching: 'use PEDS Encounters' }],
    });
    expect(g.findings).toEqual([
      { area: 'routing', verdict: 'missed', evidence: 'sent to wrong queue', coaching: 'use PEDS Encounters' },
    ]);
  });
});

describe('coerceFindings', () => {
  it('drops findings with unknown area or verdict', () => {
    const out = coerceFindings([
      { area: 'routing', verdict: 'met' },
      { area: 'nonsense', verdict: 'met' },
      { area: 'intake', verdict: 'perfect' },
    ]);
    expect(out).toEqual([{ area: 'routing', verdict: 'met', evidence: '', coaching: '' }]);
  });

  it('returns [] for non-array input', () => {
    expect(coerceFindings(null)).toEqual([]);
    expect(coerceFindings('x')).toEqual([]);
  });
});

describe('buildMessages (grade-interview prompt)', () => {
  const transcript = [{ role: 'patient', text: 'Hi' }, { role: 'navigator', text: 'Hello' }];

  it('uses the department label, not a hardcoded Pediatrics framing', () => {
    const { systemInstruction } = buildMessages('routing', 'A scenario', transcript, 'Sam', 'obgyn', 'SOP');
    expect(systemInstruction).toContain('OB/GYN contact centre');
    expect(systemInstruction).not.toMatch(/pediatric medical contact centre/i);
  });

  it('injects the navigator operating model (decision loop + scoring principles)', () => {
    const { systemInstruction } = buildMessages('routing', 'A scenario', transcript, 'Sam', 'pediatrics', 'SOP');
    expect(systemInstruction).toMatch(/DECISION LOOP/i);
    expect(systemInstruction).toMatch(/Lookup order itself is never the scored target/i);
  });
});
