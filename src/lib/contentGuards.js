// Content-quality guards shared by generation, review UIs, and Firestore
// cleanup. These flag content that tests personal workflow preferences instead
// of objective safety/compliance outcomes.

import { getObgynWorkflowRule } from '../data/obgynWorkflowRules.js';

const LOOKUP_TERMS = /\b(phone(?: number)?|date of birth|dob|phone-first|dob-first|lookup)\b/i;
const LOOKUP_ORDER_TERMS = /\b(first|before|start with|asked first|ask for first)\b/i;
const LOOKUP_SAFETY_TERMS = /\b(wrong (?:patient|chart)|correct chart|correct patient|sibling|family account|authorization|authori[sz]ed|privacy|duplicate chart|discuss(?:ing)? before|verify(?:ing|ication)? before)\b/i;

const REFILL_TERMS = /\b(refill|refills|medication|prescription)\b/i;
const REFILL_PE_TERMS = /\b(pe|physical exam)\b/i;
const REFILL_HARD_STOP_TERMS = /\b(cannot|can't|won't|not entitled|must be current|must be up to date|not up to date|not current|verify pe|check pe)\b/i;

function joinText(parts) {
  return parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .filter(Boolean)
    .join('\n');
}

const OBGYN_CONTRADICTION_CHECKS = [
  ['known_lmp_forced_confirmation', ['new_ob_known_lmp'], /(?:known|reliable)\s+lmp[\s\S]{0,120}(?:book|schedule|require|must use)\s+(?:a\s+)?confirmation/i, 'Reliable LMP should use the normal New OB workflow, not forced Confirmation.'],
  ['known_lmp_confirmation_first', ['new_ob_known_lmp'], /(?:schedule|book|use)\s+(?:a\s+)?confirmation\s+first[\s\S]{0,100}new\s+ob/i, 'Reliable LMP should use the normal New OB workflow, not Confirmation first.'],
  ['unknown_lmp_direct_new_ob', ['confirmation_unknown_lmp'], /(?:unknown|unreliable|does not know|doesn['’]t know)\s+(?:the\s+)?lmp[\s\S]{0,140}(?:book|schedule|send)[\s\S]{0,35}new\s+ob/i, 'Unknown or unreliable LMP requires Confirmation first unless clinical approval says otherwise.'],
  ['estimated_date_direct_new_ob', ['confirmation_unknown_lmp'], /(?:app\s+estimate|estimated\s+(?:lmp|date)|callback\s+note)[\s\S]{0,120}(?:book|schedule|send|use)[\s\S]{0,40}new\s+ob|(?:book|schedule|send|use)[\s\S]{0,40}new\s+ob[\s\S]{0,120}(?:app\s+estimate|estimated\s+(?:lmp|date)|callback\s+note)/i, 'An app estimate or callback note without reliable dating does not support direct New OB scheduling.'],
  ['new_ob_pair_split', ['new_ob_pairing'], /new\s+ob[\s\S]{0,180}(?:split|separate days?|different days?|gap between|sonogram only|provider visit only|provider[\s\S]{0,50}(?:tuesday|one day)[\s\S]{0,60}(?:(?:friday|another day)[\s\S]{0,25}sonogram|sonogram[\s\S]{0,35}(?:friday|another day)))|(?:sonogram|ultrasound)[\s\S]{0,80}(?:one day|tuesday|this week)[\s\S]{0,80}(?:provider|doctor)[\s\S]{0,45}(?:another day|friday|next week)/i, 'The New OB sonogram and provider visit must remain a same-day back-to-back pair.'],
  ['new_ob_pair_timed_gap', ['new_ob_pairing'], /(?:nine|9(?::00)?)[\s\S]{0,70}(?:eleven|11(?::00)?)[\s\S]{0,100}(?:reserve|book|keep)[\s\S]{0,30}(?:both|new\s+ob)/i, 'The proposed New OB times contain a waiting gap rather than an immediate pair.'],
  ['new_ob_pair_reversed', ['new_ob_pairing'], /(?:provider|doctor)[\s\S]{0,45}(?:first|before)[\s\S]{0,45}(?:sonogram|ultrasound|scan)/i, 'The New OB sonogram comes before the provider visit.'],
  ['paired_appointment_split', ['paired_appointment_reschedule', 'growth_bpp_plus_md', 'anatomy_plus_md'], /(?:keep|move|cancel|reschedule)[\s\S]{0,45}(?:only|just|one (?:part|half))[\s\S]{0,60}(?:sonogram|ultrasound|scan|provider|md|appointment)/i, 'Required paired appointments cannot be handled independently.'],
  ['urgent_without_approval', ['urgent_high_priority', 'nurse_approved_ob_urgent'], /(?:book|schedule|use)[\s\S]{0,60}(?:ob|gyn)?\s*urgent[\s\S]{0,100}(?:without|no need for|before)[\s\S]{0,35}(?:nurse|provider|clinical)?\s*approval|(?:open|available)\s+urgent\s+slot[\s\S]{0,80}(?:is enough|authori[sz]es|means (?:i|we) can)/i, 'Urgent appointments require written nurse/provider approval; slot availability is not authority.'],
  ['navigator_directs_ld', ['urgent_intermedia_escalation', 'urgent_high_priority'], /(?:(?:i|we|navigator|agent)\s+(?:will|should|must|can)\s+(?:send|direct|transfer|route)|(?:go|head|proceed)\s+(?:straight\s+)?to)[\s\S]{0,45}(?:l\s*&\s*d|labor (?:and|&) delivery)/i, 'Current navigator workflow uses urgent clinical escalation, not independent L&D direction.'],
  ['annual_status_ignored', ['annual_gyn_vs_gyn_ov'], /(?:annual (?:gyn )?status|last annual)[\s\S]{0,70}(?:does not matter|doesn['’]t matter|ignore|skip|need not be checked)/i, 'Annual GYN status controls routine GYN visit selection.'],
  ['invalid_annual_counted_current', ['annual_gyn_vs_gyn_ov'], /(?:pap(?:\s+smear)?\s+(?:alone|only)|outside\s+annual|postpartum\s+visit)[\s\S]{0,90}(?:counts?|qualif(?:y|ies)|means)[\s\S]{0,35}(?:annual\s+gyn\s+)?(?:utd|up[- ]to[- ]date|current)/i, 'Pap-only, outside annual, and postpartum visits do not make Annual GYN current.'],
  ['invalid_annual_used_for_gyn_ov', ['annual_gyn_vs_gyn_ov'], /(?:(?:recent\s+pap|pap(?:\s+only)?\s+(?:visit|date)|outside\s+annual(?:\s+date)?|postpartum\s+visit)[\s\S]{0,120}(?:use|place|book)[\s\S]{0,40}gyn\s+(?:office\s+visit|ov))|(?:(?:use|place|book)[\s\S]{0,80}(?:recent\s+pap|outside\s+annual|postpartum\s+visit)[\s\S]{0,80}gyn\s+(?:office\s+visit|ov))/i, 'Pap-only, outside annual, and postpartum visits cannot be used as the current Annual GYN date for GYN Office Visit selection.'],
  ['duplicate_te_same_issue', ['existing_te_take_action'], /(?:open|existing)[\s\S]{0,100}(?:te|message|request)[\s\S]{0,120}(?:create|open|start)[\s\S]{0,30}(?:new|another|second)|(?:create|open|start)[\s\S]{0,30}(?:new|another|second)[\s\S]{0,60}(?:te|message|request)[\s\S]{0,100}(?:already|existing|open)/i, 'Update an open same-issue request instead of creating a duplicate.'],
  ['mfm_general_ob_routing', ['mfm_routing'], /mfm[\s\S]{0,130}(?:general|regular|standard)\s+ob\s+(?:schedule|scheduling|workflow)|mfm[\s\S]{0,100}(?:pss\s+ob|ob\s+portal)|(?:send|route|transfer)[\s\S]{0,60}(?:general|regular|standard)\s+(?:ob\s+)?schedul/i, 'MFM requests go to the direct MFM team, not general OB scheduling.'],
  ['transfer_booked_before_review', ['transfer_ob'], /(?:book|schedule)[\s\S]{0,80}(?:now|before)[\s\S]{0,80}(?:records|review|approv)|(?:accept|approv)[\s\S]{0,40}(?:without|before)[\s\S]{0,40}(?:records|review)/i, 'Transfer OB requests require records and approval before scheduling.'],
  ['navigator_schedules_lab', ['lab_boundary'], /(?:i|we|navigator|agent)\s+(?:will|can|should)\s+(?:book|schedule|reschedule|order)[\s\S]{0,40}(?:lab|gct|gtt)|(?:i|we)\s+(?:will|can|should)\s+order\s+(?:that|the|your)?\s*lab/i, 'Navigators do not order or schedule OB/GYN lab work.'],
  ['navigator_interprets_lab', ['lab_boundary'], /(?:result|lab)[\s\S]{0,60}(?:looks|is|seems)\s+(?:normal|fine|abnormal|concerning)/i, 'Navigators do not interpret OB/GYN lab results.'],
  ['direct_dr_bank_booking', ['dr_bank_waitlist'], /(?:book|schedule|reserve)[\s\S]{0,35}(?:dr\.?\s+)?bank\b/i, 'Navigators do not directly schedule Dr. Bank GYN or fertility visits.'],
  ['iud_sonogram_wrong_order', ['iud_insertion_plus_sono', 'postpartum_iud'], /(?:gyn\s+)?sono(?:gram)?[\s\S]{0,60}(?:before|first)[\s\S]{0,60}(?:iud|insertion)|(?:ultrasound|sonogram)[\s\S]{0,30}then[\s\S]{0,30}(?:iud|insertion)/i, 'IUD workflow places the provider insertion visit before the GYN sonogram.'],
  ['missing_ob_verified', ['new_ob_pairing', 'iud_insertion_plus_sono'], /(?:second|provider|sonogram)\s+(?:appointment|status)[\s\S]{0,80}(?:does not need|need not|leave|keep)[\s\S]{0,45}(?:ob\s+verified|unchanged)|(?:leave|keep)[\s\S]{0,30}(?:second\s+)?status\s+unchanged|(?:skip|omit|remove)[\s\S]{0,35}ob\s+verified/i, 'The second appointment in the tested pair must be marked OB Verified.'],
  ['missing_order_scheduled', ['rto_documentation', 'missing_sonography_order'], /(?:no|without|cannot find|can['’]t find|missing)\s+(?:documented\s+)?(?:rto|order|note)[\s\S]{0,180}(?:book|schedule)[\s\S]{0,55}(?:bpp|growth|sono|ultrasound|follow[- ]?up)|(?:book|schedule)[\s\S]{0,55}(?:bpp|growth|sono|ultrasound)[\s\S]{0,100}missing[- ]order/i, 'Patient wording cannot replace a missing documented RTO or sonography order.'],
  ['refill_skips_required_detail', ['refill'], /(?:do not|don['’]t|no need to)\s+(?:ask|confirm|check)[\s\S]{0,35}(?:medication|pharmacy|prescribing provider)/i, 'OB/GYN refill handling must confirm medication, pharmacy, and prescribing provider.', true],
  ['refill_keeps_stale_pharmacy', ['refill'], /(?:old|listed|existing)\s+pharmacy[\s\S]{0,90}(?:keep|remain|use)|(?:keep|retain|use)[\s\S]{0,45}(?:old|listed|existing)\s+pharmacy/i, 'A refill request must use the patient’s confirmed current pharmacy.'],
  ['refill_uses_visit_provider', ['refill'], /(?:assign|route|send)[\s\S]{0,55}(?:provider|doctor)[\s\S]{0,45}(?:latest|last|recent)\s+(?:women(?:['’]s|s)\s+health\s+)?visit|(?:latest|last|recent)\s+(?:women(?:['’]s|s)\s+health\s+)?visit[\s\S]{0,55}(?:provider|doctor)/i, 'The prescribing provider must come from the e-prescription history, not the latest visit.'],
  ['refill_promise', ['refill'], /(?:refill|prescription)[\s\S]{0,90}(?:will be approved|guaranteed|definitely (?:sent|ready|approved)|sent today)/i, 'Navigators cannot promise refill approval or timing.'],
  ['urgent_channel_omitted', ['urgent_intermedia_escalation'], /(?:(?:no need|do not need|don['’]t need|skip)[\s\S]{0,45}(?:urgent|intermedia)\s+channel)|(?:no\s+additional\s+intermedia\s+message\s+is\s+needed)/i, 'Serious symptoms require the urgent Intermedia channel in addition to the TE.'],
];

const NEGATED_ACTION = /\b(?:do(?:es|did)? not|don['’]t|doesn['’]t|didn['’]t|will not|won['’]t|should not|shouldn['’]t|could not|couldn['’]t|would not|wouldn['’]t|must not|cannot|can['’]t|no need to|need not|never|avoid)\s+(?:(?:independently|directly|just|simply|ever|go ahead and)\s+){0,2}(?:book|booking|schedule|scheduling|require|requiring|use|using|split|splitting|separate|separating|move|moving|cancel|canceling|reschedule|rescheduling|send|sending|direct|directing|transfer|transferring|route|routing|go|going|head|heading|proceed|proceeding|come|coming|ignore|ignoring|skip|skipping|count|counting|qualify|qualifying|create|creating|open|opening|start|starting|accept|accepting|approve|approving|order|ordering|interpret|interpreting|tell|telling|say|saying|promise|promising|ask|asking|confirm|confirming|check|checking)\b/i;

export function isObgynProhibitedActionNegated(text) {
  return NEGATED_ACTION.test(String(text ?? ''));
}

function contradictionClauses(text) {
  const body = String(text ?? '');
  const clauses = body.replace(/\bdr\./gi, 'Dr')
    .split(/[.;!?]|—|--|,\s*(?:but|however|although|meanwhile)\b|,\s*and\s+(?=(?:i|we)\b)/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
  return [...new Set([body.trim(), ...clauses].filter(Boolean))];
}

export function detectObgynContradictions(text, { ruleIds = [] } = {}) {
  const findings = contradictionClauses(text).flatMap((body) => (
    OBGYN_CONTRADICTION_CHECKS.flatMap(([code, applicableRuleIds, pattern, message, allowNegatedAction = false]) => {
      const match = pattern.exec(body);
      const actionWindow = match
        ? body.slice(Math.max(0, match.index - 80), match.index + match[0].length)
        : '';
      if (!match || (!allowNegatedAction && isObgynProhibitedActionNegated(actionWindow))) return [];
      if (ruleIds.length && !applicableRuleIds.some((id) => ruleIds.includes(id))) return [];
      return [{ severity: 'block', code, message, ruleIds: applicableRuleIds }];
    })
  ));
  return findings.filter((finding, index) => findings.findIndex((item) => item.code === finding.code) === index);
}

export function detectLookupOrderPreference(text) {
  const body = String(text ?? '');
  if (!LOOKUP_TERMS.test(body) || !LOOKUP_ORDER_TERMS.test(body)) return null;
  if (LOOKUP_SAFETY_TERMS.test(body)) return null;
  return {
    severity: 'block',
    code: 'lookup_order_preference',
    message: 'This grades lookup order as right/wrong instead of testing chart safety or caller authorization.',
  };
}

export function detectRefillPeHardStop(text) {
  const body = String(text ?? '');
  if (!REFILL_TERMS.test(body) || !REFILL_PE_TERMS.test(body) || !REFILL_HARD_STOP_TERMS.test(body)) return null;
  return {
    severity: 'block',
    code: 'refill_pe_hard_stop',
    message: 'Standard refill handling should not require PE verification or deny the refill based on PE status alone.',
  };
}

export function detectOverusedWorkflow(items, maxShare = 0.35) {
  const total = items.length;
  if (!total) return [];
  const counts = items.reduce((acc, item) => {
    const key = item.workflowType ?? 'untyped';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .filter(([, count]) => count / total > maxShare)
    .map(([workflowType, count]) => ({
      severity: 'warn',
      code: 'workflow_overrepresented',
      workflowType,
      share: count / total,
      count,
      message: `${workflowType} makes up ${Math.round((count / total) * 100)}% of this bank.`,
    }));
}

export function validateQuestionContent(question) {
  const text = joinText([
    question?.scenario,
    (question?.options ?? []).map((o) => `${o?.text ?? ''}\n${o?.rationale ?? ''}`),
  ]);
  const generic = [detectLookupOrderPreference(text), detectRefillPeHardStop(text)].filter(Boolean);
  if ((question?.department ?? 'pediatrics') !== 'obgyn') return generic;
  const best = question?.options?.find((option) => option?.id === question?.correctOptionId);
  const authoritativeText = joinText([question?.scenario, best?.text, best?.rationale]);
  return [...generic, ...detectObgynContradictions(authoritativeText, { ruleIds: question?.ruleIds ?? [] })];
}

export function validateAuditContent(audit) {
  const text = joinText([
    audit?.hint,
    audit?.modelExplanation,
    (audit?.transcript ?? []).map((t) => `${t?.speaker ?? ''}: ${t?.message ?? ''}`),
  ]);
  const flags = [detectLookupOrderPreference(text), detectRefillPeHardStop(text)].filter(Boolean);
  if ((audit?.department ?? 'pediatrics') !== 'obgyn' || !Array.isArray(audit?.ruleIds) || !audit.ruleIds.length) return flags;

  const unknownRuleIds = audit.ruleIds.filter((id) => !getObgynWorkflowRule(id));
  if (unknownRuleIds.length) {
    flags.push({
      severity: 'block', code: 'unknown_rule_ids', unknownRuleIds,
      message: `Unknown OB/GYN rule ids: ${unknownRuleIds.join(', ')}.`,
    });
    return flags;
  }

  // The INDEXED Agent error is judged in context: the controlling chart facts
  // and the Patient turn immediately before it establish the condition (unknown
  // LMP, an already-open TE, a missing order, …) so the erroneous Agent line
  // does not have to unnaturally restate every fact. The rule set stays the
  // deterministic authority — only the selected rules' patterns can match.
  const precedingPatient = (audit.transcript ?? [])
    .slice(0, audit.errorIndex)
    .filter((turn) => turn?.speaker === 'Patient')
    .at(-1);
  const indexedContext = [
    (audit.requiredChartFacts ?? []).filter(Boolean).join('. '),
    precedingPatient?.message ?? '',
    audit.transcript?.[audit.errorIndex]?.message ?? '',
  ].filter(Boolean).join('\n');
  const indexedViolations = detectObgynContradictions(indexedContext, { ruleIds: audit.ruleIds });
  if (!indexedViolations.length) {
    flags.push({
      severity: 'block', code: 'audit_error_not_deterministic',
      message: 'The indexed Agent error does not deterministically contradict the selected structured rule (even with patient context and required chart facts).',
    });
  }
  // Every OTHER Agent turn must be clean ON ITS OWN — the strict per-turn check
  // is what guarantees exactly one deterministic Agent error per transcript.
  const otherViolations = (audit.transcript ?? []).flatMap((turn, index) => (
    turn?.speaker === 'Agent' && index !== audit.errorIndex
      ? detectObgynContradictions(turn.message, { ruleIds: audit.ruleIds }).map((flag) => ({ ...flag, index }))
      : []
  ));
  if (otherViolations.length) {
    flags.push({
      severity: 'block', code: 'audit_multiple_agent_errors',
      message: 'Another Agent turn also contradicts the selected structured rule; exactly one error is required.',
    });
  }
  return flags;
}

export function hasBlockingFlags(flags = []) {
  return flags.some((flag) => flag.severity === 'block');
}
