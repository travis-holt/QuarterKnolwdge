import { describe, it, expect } from 'vitest';
import {
  detectLookupOrderPreference,
  detectRefillPeHardStop,
  validateQuestionContent,
  validateAuditContent,
  detectObgynContradictions,
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

  it.each([
    ['known_lmp_forced_confirmation', 'The patient has a known LMP, so we must use a Confirmation visit.', ['new_ob_known_lmp']],
    ['unknown_lmp_direct_new_ob', 'She does not know the LMP, so schedule a New OB appointment.', ['confirmation_unknown_lmp']],
    ['new_ob_pair_split', 'Split the New OB ultrasound and provider visit onto different days.', ['new_ob_pairing']],
    ['paired_appointment_split', 'Move only one half of the ultrasound and provider appointment.', ['paired_appointment_reschedule']],
    ['urgent_without_approval', 'Book an OB Urgent slot without nurse approval.', ['urgent_high_priority']],
    ['navigator_directs_ld', 'The navigator will direct her to Labor and Delivery.', ['urgent_intermedia_escalation']],
    ['invalid_annual_counted_current', 'A Pap only counts as Annual GYN current.', ['annual_gyn_vs_gyn_ov']],
    ['duplicate_te_same_issue', 'There is an existing TE for the same issue, so create another new TE.', ['existing_te_take_action']],
    ['mfm_general_ob_routing', 'Route the MFM request through general OB scheduling.', ['mfm_routing']],
    ['navigator_schedules_lab', 'I will schedule the lab appointment.', ['lab_boundary']],
    ['navigator_interprets_lab', 'The lab result looks normal.', ['lab_boundary']],
    ['direct_dr_bank_booking', 'Schedule Dr. Bank directly.', ['dr_bank_waitlist']],
    ['iud_sonogram_wrong_order', 'Book the sonogram first before the IUD insertion.', ['iud_insertion_plus_sono']],
    ['missing_ob_verified', 'The second appointment does not need OB Verified.', ['new_ob_pairing']],
    ['missing_order_scheduled', 'There is no documented order, but schedule the growth ultrasound.', ['missing_sonography_order']],
    ['refill_skips_required_detail', 'Do not ask for the medication or pharmacy.', ['refill']],
    ['refill_promise', 'The refill will be approved today.', ['refill']],
    ['urgent_channel_omitted', 'Skip the Intermedia urgent channel.', ['urgent_intermedia_escalation']],
  ])('blocks %s', (code, text, ruleIds) => {
    expect(detectObgynContradictions(text, { ruleIds }).map((flag) => flag.code)).toContain(code);
  });

  it('requires exactly one deterministic Agent error at errorIndex', () => {
    const audit = {
      department: 'obgyn', ruleIds: ['lab_boundary'], errorIndex: 2,
      transcript: [
        { speaker: 'Agent', message: 'I will send the question to the OB Portal.' },
        { speaker: 'Patient', message: 'Thank you.' },
        { speaker: 'Agent', message: 'The lab result looks normal.' },
      ],
    };
    expect(validateAuditContent(audit)).toEqual([]);
    audit.transcript[0].message = 'I will schedule the lab appointment.';
    expect(validateAuditContent(audit).map((flag) => flag.code)).toContain('audit_multiple_agent_errors');
  });
});
