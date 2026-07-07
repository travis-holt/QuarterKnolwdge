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

export function workflowOptionsFor(domainId) {
  return AUDIT_WORKFLOWS[domainId] ?? [];
}

export function chooseBalancedWorkflowTypes(existingAudits, domainId, count = 1) {
  const workflows = workflowOptionsFor(domainId);
  if (!workflows.length) return Array.from({ length: count }, () => 'general_workflow');

  const counts = Object.fromEntries(workflows.map((type) => [type, 0]));
  for (const audit of existingAudits) {
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
