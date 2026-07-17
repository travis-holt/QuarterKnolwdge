import { describe, it, expect } from 'vitest';
import { validateAuditResponse, buildPrompt } from './generate-audit.js';
import { DOMAINS } from '../src/data/questions.js';

const makeTranscript = () => Array.from({ length: 10 }, (_, index) => ({
  speaker: index % 2 === 0 ? 'Agent' : 'Patient',
  message: index === 4 ? 'I will send this to the correct team.' : `Turn ${index + 1} has useful content.`,
}));

const validResponse = () => ({
  transcript: makeTranscript(),
  errorIndex: 4,
  hint: 'Pay attention to how the agent handled the request.',
  modelExplanation: 'The agent used the wrong workflow and should use the documented path.',
  workflowType: 'caller_authorization',
  ruleIds: [],
  errorKind: 'wrong_workflow',
  expectedCorrection: 'Use the documented workflow and explain the next step.',
  requiredChartFacts: ['The current chart workflow state'],
  difficulty: 'medium',
});

describe('validateAuditResponse', () => {
  it('accepts, sanitizes, and preserves the full audit contract', () => {
    const input = validResponse();
    input.transcript[0] = { speaker: '  Agent  ', message: '  Hello  ', extra: 'remove' };
    const result = validateAuditResponse(input);
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      errorIndex: 4,
      workflowType: 'caller_authorization',
      errorKind: 'wrong_workflow',
      expectedCorrection: 'Use the documented workflow and explain the next step.',
      requiredChartFacts: ['The current chart workflow state'],
      difficulty: 'medium',
    });
    expect(result.data.transcript).toHaveLength(10);
    expect(result.data.transcript[0]).toEqual({ speaker: 'Agent', message: 'Hello' });
  });

  it('requires exactly 10 alternating turns', () => {
    expect(validateAuditResponse({ ...validResponse(), transcript: makeTranscript().slice(0, 8) }).error).toMatch(/exactly 10/);
    const nonAlternating = makeTranscript();
    nonAlternating[3].speaker = 'Agent';
    expect(validateAuditResponse({ ...validResponse(), transcript: nonAlternating }).error).toMatch(/alternate/);
  });

  it('requires errorIndex to identify an Agent turn without silent repair', () => {
    expect(validateAuditResponse({ ...validResponse(), errorIndex: 1 }).error).toMatch(/indexed error must be on an Agent/);
    expect(validateAuditResponse({ ...validResponse(), errorIndex: 10 }).error).toMatch(/invalid error index/);
    expect(validateAuditResponse({ ...validResponse(), errorIndex: '4' }).error).toMatch(/invalid error index/);
  });

  it('requires explanation, correction, and chart-fact metadata', () => {
    expect(validateAuditResponse({ ...validResponse(), hint: '' }).error).toMatch(/incomplete audit response/);
    expect(validateAuditResponse({ ...validResponse(), modelExplanation: '' }).error).toMatch(/incomplete audit response/);
    expect(validateAuditResponse({ ...validResponse(), expectedCorrection: '' }).error).toMatch(/correction or chart-fact/);
    expect(validateAuditResponse({ ...validResponse(), requiredChartFacts: null }).error).toMatch(/correction or chart-fact/);
  });

  it('uses the server-requested workflow type', () => {
    const result = validateAuditResponse(validResponse(), 'standard_refill_queue');
    expect(result.data.workflowType).toBe('standard_refill_queue');
  });

  it('accepts only selected OB/GYN rule ids', () => {
    const input = { ...validResponse(), ruleIds: ['lab_boundary'], workflowType: 'lab_boundary' };
    const context = { department: 'obgyn', ruleIds: ['lab_boundary'] };
    expect(validateAuditResponse(input, 'lab_boundary', context).data.ruleIds).toEqual(['lab_boundary']);
    expect(validateAuditResponse({ ...input, ruleIds: ['unknown'] }, 'lab_boundary', context).error).toMatch(/unknown or unselected/);
  });

  it('handles null input', () => {
    expect(validateAuditResponse(null).error).toMatch(/exactly 10/);
  });
});

describe('buildPrompt (generate-audit)', () => {
  const domain = DOMAINS[0];

  it('tests safe chart identification and injects the operating model', () => {
    const prompt = buildPrompt(domain, 'pediatrics', 'wf', [], 'SOP');
    expect(prompt).not.toMatch(/correct lookup order/i);
    expect(prompt).toMatch(/correct patient\/chart safely/i);
    expect(prompt).toMatch(/OPERATING MODEL/i);
    expect(prompt).toMatch(/DECISION LOOP/i);
  });
});
