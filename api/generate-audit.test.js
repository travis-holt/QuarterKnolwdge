// ─────────────────────────────────────────────────────────────────────────────
// UNIT TESTS for api/generate-audit.js — the pure validateAuditResponse helper.
//
// Tests the Spot-the-Error response validation and errorIndex fallback without
// hitting Gemini or Express. The handler is not imported (it needs env vars and
// an HTTP context); only the exported pure function is tested here.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { validateAuditResponse } from './generate-audit.js';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid 10-turn transcript: Agent opens, then alternates. */
const makeTranscript = (overrides = []) => {
  const base = [
    { speaker: 'Agent',   message: 'Thank you for calling, how can I help?' },
    { speaker: 'Patient', message: 'Hi, I need to schedule an appointment.' },
    { speaker: 'Agent',   message: 'Of course, can I have the patient name?' },
    { speaker: 'Patient', message: 'Yes, it is Maria, she is 3 years old.' },
    { speaker: 'Agent',   message: 'And what insurance plan are you using?' },
    { speaker: 'Patient', message: 'We have Medicaid.' },
    { speaker: 'Agent',   message: 'Great. Let me check availability.' },
    { speaker: 'Patient', message: 'Thank you.' },
    { speaker: 'Agent',   message: 'I have an opening next Tuesday.' },
    { speaker: 'Patient', message: 'That works, thank you so much.' },
  ];
  overrides.forEach(({ index, value }) => { base[index] = value; });
  return base;
};

/** A minimal valid Gemini response object. */
const validResponse = () => ({
  transcript:       makeTranscript(),
  errorIndex:       4, // Agent turn at index 4
  hint:             'Pay attention to how the agent handled the insurance step.',
  modelExplanation: 'The agent should have verified Medicaid eligibility first.',
  workflowType:     'caller_authorization',
  errorKind:        'privacy_breach',
  difficulty:       'medium',
});

// ── validateAuditResponse ────────────────────────────────────────────────────

describe('validateAuditResponse', () => {
  it('accepts a fully valid response and returns sanitised data', () => {
    const result = validateAuditResponse(validResponse());
    expect(result.error).toBeUndefined();
    expect(result.data.errorIndex).toBe(4);
    expect(result.data.hint).toBe('Pay attention to how the agent handled the insurance step.');
    expect(result.data.workflowType).toBe('caller_authorization');
    expect(result.data.errorKind).toBe('privacy_breach');
    expect(result.data.difficulty).toBe('medium');
    expect(result.data.transcript).toHaveLength(10);
  });

  it('returns an error when transcript is missing', () => {
    const { transcript: _, ...rest } = validResponse();
    expect(validateAuditResponse(rest).error).toMatch(/incomplete transcript/);
  });

  it('returns an error when transcript has fewer than 4 turns', () => {
    const input = validResponse();
    input.transcript = input.transcript.slice(0, 3);
    expect(validateAuditResponse(input).error).toMatch(/incomplete transcript/);
  });

  it('returns an error when errorIndex is out of bounds (negative)', () => {
    const input = validResponse();
    input.errorIndex = -1;
    expect(validateAuditResponse(input).error).toMatch(/invalid error index/);
  });

  it('returns an error when errorIndex is out of bounds (≥ length)', () => {
    const input = validResponse();
    input.errorIndex = input.transcript.length;
    expect(validateAuditResponse(input).error).toMatch(/invalid error index/);
  });

  it('returns an error when errorIndex is not a number', () => {
    const input = validResponse();
    input.errorIndex = '4';
    expect(validateAuditResponse(input).error).toMatch(/invalid error index/);
  });

  it('falls back to the nearest Agent turn when errorIndex points at a Patient', () => {
    const input = validResponse();
    input.errorIndex = 1; // Patient turn
    const result = validateAuditResponse(input);
    expect(result.error).toBeUndefined();
    // Fallback logic: findIndex(i !== 0 && speaker === 'Agent') → index 2
    expect(result.data.errorIndex).toBe(2);
    expect(result.data.transcript[result.data.errorIndex].speaker).toBe('Agent');
  });

  it('returns an error when transcript has no Agent turns other than index 0', () => {
    const allPatient = makeTranscript().map((t, i) =>
      i === 0 ? t : { speaker: 'Patient', message: t.message }
    );
    const input = { ...validResponse(), transcript: allPatient, errorIndex: 1 };
    expect(validateAuditResponse(input).error).toMatch(/No Agent turn/);
  });

  it('returns an error when hint is missing', () => {
    const { hint: _, ...rest } = validResponse();
    expect(validateAuditResponse(rest).error).toMatch(/incomplete audit response/);
  });

  it('returns an error when hint is an empty string', () => {
    const input = validResponse();
    input.hint = '';
    expect(validateAuditResponse(input).error).toMatch(/incomplete audit response/);
  });

  it('returns an error when modelExplanation is missing', () => {
    const { modelExplanation: _, ...rest } = validResponse();
    expect(validateAuditResponse(rest).error).toMatch(/incomplete audit response/);
  });

  it('sanitises transcript entries — strips extra fields, trims whitespace', () => {
    const input = validResponse();
    // Inject a stray field and extra whitespace.
    input.transcript[0] = { speaker: '  Agent  ', message: '  Hello  ', extra: 'noise' };
    const result = validateAuditResponse(input);
    expect(result.error).toBeUndefined();
    expect(result.data.transcript[0]).toEqual({ speaker: 'Agent', message: 'Hello' });
    expect(result.data.transcript[0].extra).toBeUndefined();
  });

  it('trims whitespace from hint and modelExplanation', () => {
    const input = validResponse();
    input.hint = '  some hint  ';
    input.modelExplanation = '  explanation  ';
    input.errorKind = '  wrong_queue  ';
    const result = validateAuditResponse(input);
    expect(result.data.hint).toBe('some hint');
    expect(result.data.modelExplanation).toBe('explanation');
    expect(result.data.errorKind).toBe('wrong_queue');
  });

  it('uses the requested workflow type when provided', () => {
    const result = validateAuditResponse(validResponse(), 'standard_refill_queue');
    expect(result.data.workflowType).toBe('standard_refill_queue');
  });

  it('handles a null / undefined input gracefully', () => {
    expect(validateAuditResponse(null).error).toMatch(/incomplete transcript/);
    expect(validateAuditResponse(undefined).error).toMatch(/incomplete transcript/);
  });
});
