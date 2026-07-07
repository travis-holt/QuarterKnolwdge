import { describe, it, expect } from 'vitest';
import {
  detectLookupOrderPreference,
  detectRefillPeHardStop,
  validateQuestionContent,
  validateAuditContent,
} from './contentGuards.js';
import { SEED_QUESTIONS } from '../data/questions.js';
import { SEED_QUESTIONS_OBGYN } from '../data/questions-obgyn.js';

describe('contentGuards', () => {
  it('flags lookup-order preference grading without a safety reason', () => {
    const flag = detectLookupOrderPreference('In Pediatrics the parent phone number must be asked first or the answer is wrong.');
    expect(flag?.code).toBe('lookup_order_preference');
  });

  it('does not flag lookup text when the scenario is about wrong-chart safety', () => {
    expect(
      detectLookupOrderPreference('Verify another identifier before opening the chart so you do not discuss the wrong patient.')
    ).toBeNull();
  });

  it('flags refill content that turns PE into a hard stop', () => {
    const flag = detectRefillPeHardStop('Refills cannot be processed if the PE is not current.');
    expect(flag?.code).toBe('refill_pe_hard_stop');
  });

  it('allows standard refill workflow guidance', () => {
    expect(
      detectRefillPeHardStop('Ask for the medication name, preferred pharmacy, and whether the patient is out, then route the TE.')
    ).toBeNull();
  });

  it('the patched lookup-order seed questions no longer trigger content blocks', () => {
    const lookupSeeds = [...SEED_QUESTIONS, ...SEED_QUESTIONS_OBGYN].filter((q) => (
      q.id === 'q-int-1' || q.id === 'q-obgyn-int-1'
    ));
    for (const question of lookupSeeds) {
      expect(validateQuestionContent(question)).toEqual([]);
    }
  });

  it('blocks audit explanations that deny a refill for missing PE', () => {
    const flags = validateAuditContent({
      transcript: [{ speaker: 'Agent', message: 'I cannot process the refill because the PE is not current.' }],
      hint: 'Look at the refill handling.',
      modelExplanation: 'The agent failed to verify PE before processing the refill.',
    });
    expect(flags.map((f) => f.code)).toContain('refill_pe_hard_stop');
  });
});
