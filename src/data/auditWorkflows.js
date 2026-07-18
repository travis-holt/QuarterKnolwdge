// Workflow taxonomy for Spot the Error. This keeps the audit bank balanced so
// one call type, especially refills, does not crowd out the rest.

export const AUDIT_WORKFLOWS = {
  intake: [
    'multi_child_chart_selection',
    'caller_authorization',
    'wrong_patient_chart',
    'duplicate_chart_risk',
  ],
  classification: [
    'refill_plus_clinical_question',
    'lab_result_request',
    'urgent_symptom',
    'wrong_department',
    'form_or_referral_request',
  ],
  routing: [
    'standard_refill_queue',
    'controlled_substance_owner',
    'referral_owner',
    'shots_or_imaging_owner',
    'ob_pregnancy_routing',
    'ob_mfm_routing',
  ],
  scheduling: [
    'same_day_rule',
    'physical_timing_rule',
    'newborn_visit_rule',
    'gestational_timing',
    'procedure_approval_required',
  ],
  boundaries: [
    'clinical_advice',
    'lab_results_by_phone',
    'promise_approval',
    'privacy_authorization',
  ],
  documentation: [
    'missing_callback_number',
    'wrong_te_destination',
    'missing_reason_detail',
    'wrong_child_documentation',
    'missing_out_of_med_priority',
  ],
};

export const OBGYN_AUDIT_WORKFLOWS = {
  intake: ['annual_vs_gyn_ov', 'known_vs_unknown_lmp'],
  classification: ['annual_vs_gyn_ov', 'known_vs_unknown_lmp', 'missing_rto_order', 'lab_boundary'],
  routing: ['existing_te_take_action', 'dr_bank_waitlist', 'mfm_owner', 'urgent_requires_approval', 'urgent_intermedia_escalation', 'refill_details', 'lab_boundary'],
  scheduling: ['new_ob_pairing', 'iud_plus_gyn_sono', 'paired_reschedule', 'ob_verified_status'],
  boundaries: ['urgent_requires_approval', 'lab_boundary', 'mfm_owner'],
  documentation: ['existing_te_take_action', 'missing_rto_order', 'ob_verified_status', 'refill_details'],
};

const OBGYN_AUDIT_RULE_IDS = {
  annual_vs_gyn_ov: ['annual_gyn_vs_gyn_ov'],
  known_vs_unknown_lmp: ['confirmation_unknown_lmp', 'new_ob_known_lmp'],
  new_ob_pairing: ['new_ob_pairing'],
  missing_rto_order: ['rto_documentation', 'missing_sonography_order'],
  existing_te_take_action: ['existing_te_take_action'],
  dr_bank_waitlist: ['dr_bank_waitlist'],
  mfm_owner: ['mfm_routing'],
  urgent_requires_approval: ['urgent_high_priority', 'nurse_approved_ob_urgent'],
  urgent_intermedia_escalation: ['urgent_intermedia_escalation'],
  iud_plus_gyn_sono: ['iud_insertion_plus_sono', 'postpartum_iud'],
  paired_reschedule: ['paired_appointment_reschedule'],
  ob_verified_status: ['new_ob_pairing', 'iud_insertion_plus_sono'],
  refill_details: ['refill'],
  lab_boundary: ['lab_boundary'],
};

export function workflowOptionsFor(domainId, department = 'pediatrics') {
  const taxonomy = department === 'obgyn' ? OBGYN_AUDIT_WORKFLOWS : AUDIT_WORKFLOWS;
  return taxonomy[domainId] ?? [];
}

export function auditRuleIdsFor(workflowType, department = 'pediatrics') {
  return department === 'obgyn' ? (OBGYN_AUDIT_RULE_IDS[workflowType] ?? []) : [];
}

export function chooseBalancedWorkflowTypes(existingAudits, domainId, count = 1, department = 'pediatrics') {
  const workflows = workflowOptionsFor(domainId, department);
  if (!workflows.length) return Array.from({ length: count }, () => 'general_workflow');

  const counts = Object.fromEntries(workflows.map((type) => [type, 0]));
  for (const audit of existingAudits) {
    if ((audit.status ?? 'active') === 'archived') continue;
    if (audit.domainId !== domainId) continue;
    const type = audit.workflowType;
    if (type in counts) counts[type] += 1;
  }

  const picks = [];
  for (let i = 0; i < count; i++) {
    const type = workflows.reduce((best, current) => (
      counts[current] < counts[best] ? current : best
    ), workflows[0]);
    picks.push(type);
    counts[type] += 1;
  }
  return picks;
}

export function pickDiverseAudits(audits, count) {
  const groups = new Map();
  for (const audit of audits) {
    const key = audit.workflowType ?? `untyped:${audit.id ?? audit.errorIndex ?? groups.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(audit);
  }

  const picked = [];
  while (picked.length < count && groups.size) {
    for (const [key, group] of groups) {
      const next = group.shift();
      if (next) picked.push(next);
      if (!group.length) groups.delete(key);
      if (picked.length === count) break;
    }
  }
  return picked;
}
