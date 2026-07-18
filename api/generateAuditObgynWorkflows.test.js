// Generation smoke tests across ALL 14 OB/GYN audit workflows. Model output is
// MOCKED (no paid API calls): each case is a realistic 10-turn transcript with
// exactly one planted Agent error that deterministically contradicts the
// workflow's selected structured rule. The suite proves that for every
// workflow: validateAuditResponse accepts the shape + rule ids, and the
// deterministic content guards (validateAuditContent) confirm exactly one
// contextual Agent error — without forcing the erroneous Agent sentence to
// restate every controlling chart fact.
import { describe, expect, it } from 'vitest';
import { validateAuditResponse } from './generate-audit.js';
import { validateAuditContent, hasBlockingFlags } from '../src/lib/contentGuards.js';
import { OBGYN_AUDIT_WORKFLOWS, auditRuleIdsFor } from '../src/data/auditWorkflows.js';

const ALL_OBGYN_WORKFLOWS = [...new Set(Object.values(OBGYN_AUDIT_WORKFLOWS).flat())];

// Per-workflow: the planted Agent error line (with optional patient-context
// line and required chart facts), plus the rule id the error contradicts.
const CASES = {
  annual_vs_gyn_ov: {
    ruleIds: ['annual_gyn_vs_gyn_ov'],
    patientLine: 'I would like to come in about some cramping, nothing urgent.',
    errorLine: 'Your last annual doesn\'t matter for this; I\'ll book the visit type you prefer.',
    facts: ['Last in-department Annual GYN was 20 months ago.'],
  },
  known_vs_unknown_lmp: {
    ruleIds: ['confirmation_unknown_lmp'],
    patientLine: 'I took a home test yesterday and it was positive.',
    errorLine: 'Great, let me schedule your New OB visit right away.',
    facts: ['Unknown LMP; no reliable date documented in the chart.'],
  },
  new_ob_pairing: {
    ruleIds: ['new_ob_pairing'],
    patientLine: 'So how does the first pregnancy visit work?',
    errorLine: 'We\'ll have you see the provider first, before the sonogram, on separate mornings.',
    facts: ['Reliable LMP documented; New OB workflow applies.'],
  },
  missing_rto_order: {
    ruleIds: ['rto_documentation'],
    patientLine: 'The doctor told me to come back for a growth scan.',
    errorLine: 'There is no documented order here, but I\'ll schedule the growth sono anyway.',
    facts: ['No documented RTO or sonography order in the chart.'],
  },
  existing_te_take_action: {
    ruleIds: ['existing_te_take_action'],
    patientLine: 'I called about this same refill two days ago and never heard back.',
    errorLine: 'I see there is already an open TE for this, so I\'ll create a new TE as well.',
    facts: ['An open TE exists for this same issue.'],
  },
  dr_bank_waitlist: {
    ruleIds: ['dr_bank_waitlist'],
    patientLine: 'I only want to see Dr. Bank for my annual.',
    errorLine: 'Sure, I\'ll book Dr. Bank for your annual right away.',
    facts: ['Dr. Bank annuals run on the waiting-list workflow.'],
  },
  mfm_owner: {
    ruleIds: ['mfm_routing'],
    patientLine: 'My provider referred me for a maternal-fetal medicine consult.',
    errorLine: 'For the MFM consult I\'ll just use the regular OB scheduling workflow.',
    facts: ['MFM requests route to the designated MFM owner.'],
  },
  urgent_requires_approval: {
    ruleIds: ['urgent_high_priority'],
    patientLine: 'I\'m having some spotting and I\'m worried.',
    errorLine: 'I can book you an OB urgent slot right now without any nurse approval.',
    facts: ['Urgent slots require written clinical approval.'],
  },
  urgent_intermedia_escalation: {
    ruleIds: ['urgent_intermedia_escalation'],
    patientLine: 'The bleeding got heavier this morning.',
    errorLine: 'I\'ll send the TE, but there is no need for the urgent channel.',
    facts: ['Serious symptoms require High Priority TE plus the urgent channel.'],
  },
  iud_plus_gyn_sono: {
    ruleIds: ['iud_insertion_plus_sono'],
    patientLine: 'I\'d like to get my IUD placed and I think I need a scan too.',
    errorLine: 'We\'ll do the sonogram first, before the IUD insertion visit.',
    facts: ['Provider insertion visit precedes the GYN sonogram in this pairing.'],
  },
  paired_reschedule: {
    ruleIds: ['paired_appointment_reschedule'],
    patientLine: 'Can I move my scan but keep the doctor visit where it is?',
    errorLine: 'Of course — I can move just the sonogram and leave the provider visit alone.',
    facts: ['These appointments are a required pair and move together.'],
  },
  ob_verified_status: {
    ruleIds: ['new_ob_pairing'],
    patientLine: 'Is there anything special about the second appointment?',
    errorLine: 'You can skip the OB Verified status on the second appointment; it books fine without it.',
    facts: ['The second appointment in the pair must be marked OB Verified.'],
  },
  refill_details: {
    ruleIds: ['refill'],
    patientLine: 'I need a refill on my prenatal medication.',
    errorLine: 'No need to ask which pharmacy you use; I\'ll just send the request through.',
    facts: ['Refill requests must capture medication, pharmacy, and prescriber.'],
  },
  lab_boundary: {
    ruleIds: ['lab_boundary'],
    patientLine: 'When do I do the glucose test?',
    errorLine: 'I will schedule your GTT lab right now myself.',
    facts: ['Navigators do not schedule or interpret OB/GYN labs.'],
  },
};

function mockedModelOutput(workflowType, testCase) {
  return {
    transcript: [
      { speaker: 'Agent', message: 'Thank you for calling Aizer Health OB/GYN, how can I help you today?' },
      { speaker: 'Patient', message: testCase.patientLine },
      { speaker: 'Agent', message: 'Of course. Can you verify the patient\'s full name and birth date on the chart for me?' },
      { speaker: 'Patient', message: 'Sure, it\'s under my name, and I can confirm the birth date.' },
      { speaker: 'Agent', message: 'One moment while I pull that up.' },
      { speaker: 'Patient', message: 'Take your time.' },
      { speaker: 'Agent', message: testCase.errorLine },
      { speaker: 'Patient', message: 'Okay, if you say so.' },
      { speaker: 'Agent', message: 'Is there anything else I can help you with today?' },
      { speaker: 'Patient', message: 'No, that\'s everything. Thank you.' },
    ],
    errorIndex: 6,
    hint: 'Look closely at how the agent handled the workflow decision.',
    modelExplanation: 'The agent contradicted the selected structured workflow rule at the indexed turn.',
    workflowType,
    ruleIds: testCase.ruleIds,
    errorKind: 'workflow_error',
    expectedCorrection: 'Follow the selected structured rule\'s required action for this workflow.',
    requiredChartFacts: testCase.facts,
    difficulty: 'medium',
  };
}

describe('OB/GYN audit generation smoke — all 14 workflows', () => {
  it('covers the complete OB/GYN audit workflow taxonomy', () => {
    expect(ALL_OBGYN_WORKFLOWS.sort()).toEqual(Object.keys(CASES).sort());
    expect(ALL_OBGYN_WORKFLOWS).toHaveLength(14);
  });

  it.each(Object.entries(CASES))('%s: validates shape, rules, and exactly one contextual Agent error', (workflowType, testCase) => {
    // Every case uses rule ids the request layer would have selected.
    const allowed = auditRuleIdsFor(workflowType, 'obgyn');
    testCase.ruleIds.forEach((id) => expect(allowed).toContain(id));

    const validation = validateAuditResponse(mockedModelOutput(workflowType, testCase), workflowType, {
      department: 'obgyn',
      ruleIds: testCase.ruleIds,
    });
    expect(validation.error).toBeUndefined();
    expect(validation.data.workflowType).toBe(workflowType);
    expect(validation.data.ruleIds).toEqual(testCase.ruleIds);
    expect(validation.data.expectedCorrection).toBeTruthy();
    expect(validation.data.requiredChartFacts).toEqual(testCase.facts);

    const audit = { ...validation.data, department: 'obgyn' };
    const flags = validateAuditContent(audit);
    expect(flags.filter((flag) => flag.code === 'audit_error_not_deterministic')).toEqual([]);
    expect(flags.filter((flag) => flag.code === 'audit_multiple_agent_errors')).toEqual([]);
    expect(hasBlockingFlags(flags)).toBe(false);
  });

  it('still blocks when the indexed Agent line does not contradict the rule even with context', () => {
    const testCase = CASES.known_vs_unknown_lmp;
    const output = mockedModelOutput('known_vs_unknown_lmp', testCase);
    output.transcript[6] = { speaker: 'Agent', message: 'Let me set up a Confirmation of Pregnancy visit first.' };
    const validation = validateAuditResponse(output, 'known_vs_unknown_lmp', { department: 'obgyn', ruleIds: testCase.ruleIds });
    const flags = validateAuditContent({ ...validation.data, department: 'obgyn' });
    expect(flags.some((flag) => flag.code === 'audit_error_not_deterministic')).toBe(true);
  });

  it('still blocks a second self-contained Agent violation on another turn', () => {
    const testCase = CASES.lab_boundary;
    const output = mockedModelOutput('lab_boundary', testCase);
    output.transcript[8] = { speaker: 'Agent', message: 'Also, I will order that lab for you before you go.' };
    const validation = validateAuditResponse(output, 'lab_boundary', { department: 'obgyn', ruleIds: testCase.ruleIds });
    const flags = validateAuditContent({ ...validation.data, department: 'obgyn' });
    expect(flags.some((flag) => flag.code === 'audit_multiple_agent_errors')).toBe(true);
  });

  it('accepts a contextual error that never restates the controlling chart fact', () => {
    // The unknown-LMP condition lives ONLY in requiredChartFacts; the Agent
    // line is natural speech. Per-turn-only validation would wrongly block this.
    const testCase = CASES.known_vs_unknown_lmp;
    const output = mockedModelOutput('known_vs_unknown_lmp', testCase);
    expect(output.transcript[6].message).not.toMatch(/lmp/i);
    const validation = validateAuditResponse(output, 'known_vs_unknown_lmp', { department: 'obgyn', ruleIds: testCase.ruleIds });
    const flags = validateAuditContent({ ...validation.data, department: 'obgyn' });
    expect(hasBlockingFlags(flags)).toBe(false);
  });
});
