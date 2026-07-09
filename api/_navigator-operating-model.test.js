// Tests for the shared Patient Navigator Operating Model prompt block.
// Assert on STABLE key phrases, not exact long prompt text, so the wording can
// evolve without breaking the suite.
import { describe, it, expect } from 'vitest';
import {
  navigatorContextBlock,
  NAVIGATOR_DECISION_LOOP,
  REALISTIC_CALL_BEHAVIOR,
  SCORING_PRINCIPLES,
  WORKFLOW_MISTAKE_TYPES,
} from './_navigator-operating-model.js';

describe('navigator operating model — exported blocks', () => {
  it('decision loop covers the whole job (identify → document → close)', () => {
    expect(NAVIGATOR_DECISION_LOOP).toMatch(/DECISION LOOP/i);
    expect(NAVIGATOR_DECISION_LOOP).toMatch(/correct patient\/chart|correct patient/i);
    expect(NAVIGATOR_DECISION_LOOP).toMatch(/authorized/i);
    expect(NAVIGATOR_DECISION_LOOP).toMatch(/Classify the request/i);
    expect(NAVIGATOR_DECISION_LOOP).toMatch(/Telephone Encounter|TE/);
  });

  it('scoring principles are strict on safety, flexible on wording', () => {
    expect(SCORING_PRINCIPLES).toMatch(/STRICT on safety/i);
    expect(SCORING_PRINCIPLES).toMatch(/FLEXIBLE on natural wording/i);
    expect(SCORING_PRINCIPLES).toMatch(/scripted phrasing|exact SOP phrase/i);
  });

  it('does not treat lookup order as the scored target', () => {
    expect(REALISTIC_CALL_BEHAVIOR).toMatch(/Lookup sequence adapts/i);
    expect(SCORING_PRINCIPLES).toMatch(/Lookup order itself is never the scored target/i);
  });

  it('does not make PE status a universal refill hard-stop', () => {
    expect(SCORING_PRINCIPLES).toMatch(/PE.*(status|verification)/i);
    expect(SCORING_PRINCIPLES).toMatch(/unless the active SOP or the\s*\n?\s*scenario explicitly/i);
  });

  it('lists realistic mistake types (not strawmen)', () => {
    expect(WORKFLOW_MISTAKE_TYPES).toMatch(/wrong patient\/chart/i);
    expect(WORKFLOW_MISTAKE_TYPES).toMatch(/wrong TE queue/i);
    expect(WORKFLOW_MISTAKE_TYPES).toMatch(/failure to escalate/i);
    expect(WORKFLOW_MISTAKE_TYPES).toMatch(/unnecessary escalation/i);
  });
});

describe('navigatorContextBlock()', () => {
  it('returns the decision loop and core question by default', () => {
    const block = navigatorContextBlock();
    expect(block).toMatch(/PATIENT NAVIGATOR OPERATING MODEL/);
    expect(block).toMatch(/DECISION LOOP/i);
    expect(block).toMatch(/choose the\s+correct workflow/i);
    expect(block).toContain(NAVIGATOR_DECISION_LOOP);
    expect(block).toContain(SCORING_PRINCIPLES);
  });

  it('includes the department label when a department is given', () => {
    expect(navigatorContextBlock({ department: 'obgyn' })).toMatch(/OB\/GYN/);
    expect(navigatorContextBlock({ department: 'behavioral' })).toMatch(/Behavioural Health/);
  });

  it('adds mode-specific guidance for each supported mode', () => {
    expect(navigatorContextBlock({ mode: 'scenario-generation' })).toMatch(/SCENARIO GENERATION/i);
    expect(navigatorContextBlock({ mode: 'roleplay-caller' })).toMatch(/ROLEPLAY AS THE CALLER/i);
    expect(navigatorContextBlock({ mode: 'practice-grading' })).toMatch(/PRACTICE GRADING/i);
    expect(navigatorContextBlock({ mode: 'audit-generation' })).toMatch(/AUDIT .*GENERATION/i);
    expect(navigatorContextBlock({ mode: 'qa-grading' })).toMatch(/QA GRADING/i);
    expect(navigatorContextBlock({ mode: 'coaching' })).toMatch(/FOR COACHING/i);
    expect(navigatorContextBlock({ mode: 'learning-path' })).toMatch(/LEARNING PATHS/i);
  });

  it('audit-generation mode uses "correct patient/chart safely", not lookup order', () => {
    const block = navigatorContextBlock({ mode: 'audit-generation' });
    expect(block).toMatch(/correct patient\/chart safely/i);
    expect(block).not.toMatch(/correct lookup order/i);
  });

  it('ignores an unknown mode gracefully (shared blocks only)', () => {
    const block = navigatorContextBlock({ mode: 'nope' });
    expect(block).toContain(NAVIGATOR_DECISION_LOOP);
    expect(block).not.toMatch(/FOR SCENARIO GENERATION/);
  });
});
