// Executable OB/GYN Patient Navigator rules derived from the owner-confirmed
// current-floor SOP effective 2026-07-17. Keep this table concise: the active
// human-readable SOP remains operational authority; these records make its
// assessment-critical decisions selectable, testable, and versionable.

export const OBGYN_SOP_VERSION = 'obgyn-current-floor-2026-07-17';
export const OBGYN_RULE_SET_VERSION = 'obgyn-workflow-rules-v2';
export const OBGYN_SOURCE_AUTHORITY = 'owner-confirmed-current-floor';

const rule = (id, title, workflowType, domainIds, competencyIds, fields) => Object.freeze({
  id,
  version: OBGYN_RULE_SET_VERSION,
  title,
  workflowType,
  department: 'obgyn',
  domainIds,
  competencyIds,
  sourceAuthority: OBGYN_SOURCE_AUTHORITY,
  ...fields,
});

export const OBGYN_WORKFLOW_RULES = Object.freeze([
  rule('annual_gyn_vs_gyn_ov', 'Annual GYN versus GYN Office Visit', 'annual_vs_gyn_ov', ['classification', 'scheduling'], ['sopKnowledge', 'sopApplication', 'criticalThinking'], {
    triggers: ['Non-emergency GYN concern or IUD request'],
    chartChecks: ['Last completed in-department Annual GYN date', 'Relevant encounters and open TEs'],
    requiredActions: ['Use GYN Office Visit only when an actual in-department Annual GYN is within one year', 'Otherwise use Annual GYN; escalate serious symptoms'],
    prohibitedActions: ['Count Pap-only, outside annual, or postpartum as Annual GYN up to date', 'Clinically triage symptoms'],
    documentationRequirements: ['Concise concern in the appointment reason'],
    escalationPath: 'OB Portal; High Priority plus urgent channel when serious',
    allowedVariants: ['Clinically approved GYN Urgent overrides routine annual-status scheduling'],
  }),
  rule('dr_bank_waitlist', 'Dr. Bank waiting-list workflow', 'dr_bank_waitlist', ['routing', 'scheduling'], ['sopApplication', 'communication', 'problemResolution'], {
    triggers: ['Dr. Bank Annual GYN, fertility, preference, or wait-list status request'],
    chartChecks: ['Existing waiting-list TE or prior request'],
    requiredActions: ['Explain the waiting-list process', 'Send or update the Waiting List Portal TE'],
    prohibitedActions: ['Schedule Dr. Bank directly', 'Promise an opening'],
    documentationRequirements: ['Request type and current wait-list status'],
    escalationPath: 'OB Portal for a clinical concern; High Priority plus urgent channel when serious',
    allowedVariants: ['Offer another provider for a clinical concern'],
  }),
  rule('confirmation_unknown_lmp', 'Confirmation for unknown or unreliable LMP', 'known_vs_unknown_lmp', ['classification', 'scheduling'], ['sopKnowledge', 'sopApplication', 'criticalThinking'], {
    triggers: ['Positive pregnancy test with unknown or unreliable LMP'],
    chartChecks: ['Current and prior pregnancy encounters', 'Existing Confirmation or New OB appointments'],
    requiredActions: ['Schedule a 15-minute provider Confirmation of Pregnancy'],
    prohibitedActions: ['Guess gestational age', 'Book a normal New OB pair without confirmation or approval', 'Add a lab or sonogram without an order'],
    documentationRequirements: ['Positive test and unknown/unreliable LMP'],
    escalationPath: 'OB Portal when timing or documentation remains unclear',
    allowedVariants: ['Dr. Frieda Klein Confirmation template or suitable 15-minute GYN-day provider opening'],
  }),
  rule('new_ob_known_lmp', 'New OB for reliable LMP', 'known_vs_unknown_lmp', ['classification', 'scheduling'], ['sopKnowledge', 'sopApplication', 'criticalThinking'], {
    triggers: ['Positive pregnancy test with reliable LMP'],
    chartChecks: ['Current pregnancy encounters', 'Prior pregnancy history', 'Existing Confirmation or New OB appointments'],
    requiredActions: ['Target the 8-12-week New OB window', 'Build the complete New OB pair'],
    prohibitedActions: ['Force Confirmation solely because the test was done at home'],
    documentationRequirements: ['LMP, pregnancy count including losses, and prior delivery provider when applicable'],
    escalationPath: 'OB Portal when timing falls clearly outside the normal window',
    allowedVariants: ['Any suitable OB provider for the provider visit'],
  }),
  rule('new_ob_pairing', 'New OB paired appointment construction', 'new_ob_pairing', ['scheduling', 'documentation'], ['sopApplication', 'criticalThinking', 'problemResolution'], {
    triggers: ['Documented New OB scheduling'],
    chartChecks: ['30-minute NEW OB sonography block', 'Immediately following 30-minute provider template', 'Provider line booking count'],
    requiredActions: ['Book same day and back-to-back', 'Sonogram first and provider second', 'Mark the second appointment OB Verified'],
    prohibitedActions: ['Split the pair across days', 'Leave a waiting gap', 'Use an improperly triple-booked provider line'],
    documentationRequirements: ['LMP, pregnancy count, prior delivery provider when applicable'],
    escalationPath: 'OB Portal when no valid pair exists',
    allowedVariants: ['Any suitable OB provider may perform the provider visit'],
  }),
  rule('new_ob_outside_window_approval', 'New OB outside usual timing', 'new_ob_outside_window_approval', ['classification', 'routing', 'scheduling'], ['criticalThinking', 'escalation', 'riskManagement'], {
    triggers: ['Documented gestational timing clearly outside the usual New OB window'],
    chartChecks: ['Confirmation note', 'Medical Summary', 'RTO or related TE'],
    requiredActions: ['Obtain OB Portal approval before forcing the standard schedule'],
    prohibitedActions: ['Invent standard timing despite contrary documentation'],
    documentationRequirements: ['Documented gestational timing and requested next step'],
    escalationPath: 'OB Portal',
    allowedVariants: ['Follow the exact clinically approved appointment construction'],
  }),
  rule('rto_documentation', 'Documented RTO controls scheduling', 'missing_rto_order', ['classification', 'scheduling'], ['sopKnowledge', 'sopApplication', 'criticalThinking'], {
    triggers: ['Patient reports a provider follow-up instruction'],
    chartChecks: ['Medical Summary', 'Last provider note', 'Related TE'],
    requiredActions: ['Schedule the documented interval and components'],
    prohibitedActions: ['Use patient recollection as the order', 'Recalculate cadence from memory over a documented RTO'],
    documentationRequirements: ['RTO interval and ordered components'],
    escalationPath: 'OB Portal when the instruction is missing or conflicting',
    allowedVariants: ['Equivalent documented wording such as BPP w/MD or BPP and visit'],
  }),
  rule('missing_sonography_order', 'Missing sonography order', 'missing_rto_order', ['classification', 'routing', 'boundaries'], ['sopApplication', 'riskManagement', 'escalation'], {
    triggers: ['Patient requests or claims a pregnancy sonogram without visible support'],
    chartChecks: ['Medical Summary', 'Last provider note', 'Related TE'],
    requiredActions: ['Explain that no order is visible', 'Send a clarification TE'],
    prohibitedActions: ['Self-order or schedule the scan from patient wording alone'],
    documentationRequirements: ['Requested study and missing documentation'],
    escalationPath: 'OB Portal',
    allowedVariants: ['Schedule once a documented order or clinical approval exists'],
  }),
  rule('anatomy_plus_md', 'Anatomy sonography plus provider visit', 'anatomy_plus_md', ['scheduling', 'documentation'], ['sopKnowledge', 'sopApplication', 'problemResolution'], {
    triggers: ['Documented Anatomy study'],
    chartChecks: ['Anatomy order', 'Required provider visit'],
    requiredActions: ['Book the one-hour Anatomy scan and separate provider visit as a required pair', 'Use Dr. Rosenberg on the scan record'],
    prohibitedActions: ['Treat routine Anatomy as an MFM appointment', 'Book an unsupported scan'],
    documentationRequirements: ['Anatomy plus provider visit'],
    escalationPath: 'OB Portal when the order or pair cannot be built',
    allowedVariants: ['Dr. Rosenberg is the sonography record provider; ordinary OB scheduling still applies'],
  }),
  rule('growth_bpp_plus_md', 'Growth or BPP plus provider visit', 'growth_bpp_plus_md', ['scheduling', 'documentation'], ['sopKnowledge', 'sopApplication', 'criticalThinking'], {
    triggers: ['Documented Growth, BPP, Growth/BPP, or related study'],
    chartChecks: ['Exact study and RTO/order wording', 'Provider-visit requirement'],
    requiredActions: ['Build the ordered scan and provider visit back-to-back when required'],
    prohibitedActions: ['Substitute a different study', 'Keep only one half of the pair'],
    documentationRequirements: ['Exact ordered study and visit'],
    escalationPath: 'OB Portal when the order is incomplete or no valid pair exists',
    allowedVariants: ['Documented redo/repeat-only study may be sonography-only'],
  }),
  rule('paired_appointment_reschedule', 'Paired appointment reschedule or cancellation', 'paired_reschedule', ['scheduling', 'documentation'], ['sopApplication', 'communication', 'problemResolution'], {
    triggers: ['Reschedule or cancellation of New OB, BPP+MD, Growth+MD, Anatomy+MD, or required procedure/sono pair'],
    chartChecks: ['Both linked appointments', 'Alternative valid pairs'],
    requiredActions: ['Move or cancel both together', 'Preserve required sequence', 'Keep OB Verified on the second appointment where applicable'],
    prohibitedActions: ['Keep only one component', 'Split the pair'],
    documentationRequirements: ['Outcome for both appointment records'],
    escalationPath: 'OB Portal when no valid clinically timely pair exists',
    allowedVariants: ['Another sonographer or appropriate OB provider may form the replacement pair'],
  }),
  rule('postpartum', 'Postpartum visit', 'postpartum', ['classification', 'scheduling', 'documentation'], ['sopKnowledge', 'sopApplication', 'communication'], {
    triggers: ['Postpartum appointment request'],
    chartChecks: ['Delivery details', 'Existing postpartum appointment', 'IUD intent'],
    requiredActions: ['Book the correct 15-minute Postpartum template', 'Accept later timing such as about ten weeks'],
    prohibitedActions: ['Reject solely because the visit is later than the ideal window'],
    documentationRequirements: ['Delivery date, baby weight, delivery type, delivering provider, and IUD intent when applicable'],
    escalationPath: 'OB Portal for clinical postpartum concerns',
    allowedVariants: ['Discussion-only IUD request needs no sonogram'],
  }),
  rule('postpartum_iud', 'Postpartum IUD insertion', 'postpartum_iud', ['scheduling', 'documentation'], ['sopApplication', 'criticalThinking', 'problemResolution'], {
    triggers: ['Patient knows which IUD she wants inserted during postpartum'],
    chartChecks: ['Postpartum template', 'IUD intent', 'Provider exception'],
    requiredActions: ['Book postpartum provider visit then immediate GYN Sono', 'Mark the second appointment OB Verified'],
    prohibitedActions: ['Add a sonogram for discussion-only', 'Put sonogram before insertion'],
    documentationRequirements: ['IUD insertion in postpartum reason'],
    escalationPath: 'OB Portal when provider workflow is unclear',
    allowedVariants: ['Dr. Scott Stanislawski does not require the post-insertion sonogram'],
  }),
  rule('iud_insertion_plus_sono', 'IUD insertion plus GYN sonography', 'iud_plus_gyn_sono', ['classification', 'scheduling', 'documentation'], ['sopKnowledge', 'sopApplication', 'criticalThinking'], {
    triggers: ['IUD insertion outside postpartum'],
    chartChecks: ['Relevant encounters', 'Annual GYN status', 'Provider exception'],
    requiredActions: ['Use GYN OV if Annual GYN is current, otherwise Annual GYN', 'Book provider first then GYN Sono immediately after', 'Mark the second appointment OB Verified'],
    prohibitedActions: ['Put the sonogram before insertion', 'Ask unnecessary intercourse/LMP questions', 'Apply one duration to every provider'],
    documentationRequirements: ['Concise IUD insertion/check wording'],
    escalationPath: 'OB Portal when accommodation or provider rules are unclear',
    allowedVariants: ['Dr. Scott Stanislawski needs no post-insertion sonogram', 'Dr. Frieda Klein requires 30 minutes and does not use the OB schedule'],
  }),
  rule('mfm_routing', 'MFM owner routing', 'mfm_owner', ['classification', 'routing', 'boundaries'], ['sopKnowledge', 'sopApplication', 'escalation'], {
    triggers: ['MFM scheduling, cancellation, reschedule, question, referral, or high-risk inquiry'],
    chartChecks: ['Existing MFM appointment', 'Women\'s Health referral/order', 'Relevant notes and TEs'],
    requiredActions: ['Route directly to Rebecca Wood', 'Explain that external/self-referrals are not accepted when applicable'],
    prohibitedActions: ['Schedule MFM independently', 'Route through general OB scheduling'],
    documentationRequirements: ['MFM request and referral/order status'],
    escalationPath: 'Rebecca Wood',
    allowedVariants: ['Routine Anatomy remains ordinary OB scheduling'],
  }),
  rule('transfer_ob', 'Transfer OB review', 'transfer_ob', ['classification', 'routing', 'documentation'], ['criticalThinking', 'escalation', 'communication'], {
    triggers: ['Patient requests transfer of pregnancy care'],
    chartChecks: ['Gestational age', 'Outside records', 'Fax inbox or record-receipt status', 'Existing transfer TE'],
    requiredActions: ['Request pregnancy records', 'Send TE for clinical review', 'Wait for acceptance and documented appointment instructions'],
    prohibitedActions: ['Promise acceptance', 'Schedule before approval'],
    documentationRequirements: ['Gestational age, outside practice, record delivery method, sent time, and receipt status'],
    escalationPath: 'OB Portal; High Priority plus urgent channel for serious symptoms',
    allowedVariants: ['Fax may be checked directly; nursing assistance may confirm emailed records'],
  }),
  rule('urgent_high_priority', 'Serious symptom High Priority TE', 'urgent_requires_approval', ['classification', 'routing', 'boundaries', 'documentation'], ['riskManagement', 'escalation', 'communication'], {
    triggers: ['Serious Women\'s Health symptom'],
    chartChecks: ['Relevant encounters', 'Open TEs', 'Gestational information when applicable'],
    requiredActions: ['Gather relevant reported facts without triage', 'Create or update OB Portal TE', 'Use the High Priority checkbox'],
    prohibitedActions: ['Diagnose', 'Reassure as safe to wait', 'Book an urgent appointment without approval', 'Use the word urgent as a substitute for system priority'],
    documentationRequirements: ['Concise patient-reported symptoms'],
    escalationPath: 'OB Portal and urgent channel',
    allowedVariants: ['Use Take Action when the same issue already has an open TE'],
  }),
  rule('urgent_intermedia_escalation', 'Urgent Intermedia escalation', 'urgent_intermedia_escalation', ['routing', 'documentation'], ['riskManagement', 'escalation', 'communication'], {
    triggers: ['Serious Women\'s Health symptom requiring High Priority'],
    chartChecks: ['Relevant TE and current assignment'],
    requiredActions: ['Message the Women\'s Health OB Urgent Calls Intermedia channel in addition to the TE'],
    prohibitedActions: ['Send only a routine TE for a serious symptom', 'Direct the patient independently to L&D under the current navigator workflow'],
    documentationRequirements: ['Patient account context and serious reported symptom per floor workflow'],
    escalationPath: 'Women\'s Health OB Urgent Calls Intermedia channel',
    allowedVariants: ['Follow any live patient-specific clinical instruction'],
  }),
  rule('nurse_approved_ob_urgent', 'Nurse-approved OB Urgent', 'nurse_approved_ob_urgent', ['scheduling', 'documentation'], ['sopApplication', 'criticalThinking', 'riskManagement'], {
    triggers: ['Written nurse/provider approval for OB Urgent'],
    chartChecks: ['Approval source', 'Specified provider/time', 'Sonography instruction when present'],
    requiredActions: ['Book the approved 15-minute OB Urgent', 'Overbook when specifically approved', 'Pair OB URGENT SONO back-to-back when instructed'],
    prohibitedActions: ['Book from slot availability alone', 'Invent sonogram order or sequence'],
    documentationRequirements: ['Concise complaint; approving nurse name need not appear in the reason'],
    escalationPath: 'Clinical team for incomplete instructions',
    allowedVariants: ['OB URGENT SONO may be before or after the provider as clinically directed'],
  }),
  rule('existing_te_take_action', 'Existing TE Take Action', 'existing_te_take_action', ['classification', 'documentation'], ['sopApplication', 'criticalThinking', 'problemResolution'], {
    triggers: ['Caller follows up on an open TE'],
    chartChecks: ['Open TE topic, assignment, actions, and status'],
    requiredActions: ['Use Take Action for the same issue', 'Create a separate TE for a different issue', 'Raise priority when newly warranted'],
    prohibitedActions: ['Create a duplicate TE for the same issue', 'Mix unrelated issues into one TE'],
    documentationRequirements: ['Callback, new information, or continued waiting status'],
    escalationPath: 'Keep current destination unless the workflow requires a change',
    allowedVariants: ['A different issue always gets its own reason and destination'],
  }),
  rule('refill', 'OB/GYN refill request', 'refill_details', ['classification', 'routing', 'boundaries', 'documentation'], ['sopApplication', 'communication', 'riskManagement'], {
    triggers: ['Medication refill request'],
    chartChecks: ['e-Prescription logs', 'Prescribing provider', 'Existing refill TE'],
    requiredActions: ['Confirm medication and preferred pharmacy', 'Identify prescribing provider', 'Create or update refill TE'],
    prohibitedActions: ['Give medication advice', 'Promise approval or timing', 'Duplicate an open refill TE'],
    documentationRequirements: ['Medication, pharmacy, prescribing provider, and relevant callback/urgency details'],
    escalationPath: 'Current Women\'s Health refill route, OB Portal unless a live update directs otherwise',
    allowedVariants: ['Use Take Action for an existing same-refill TE'],
  }),
  rule('lab_boundary', 'OB/GYN lab boundary', 'lab_boundary', ['classification', 'routing', 'boundaries'], ['compliance', 'riskManagement', 'communication'], {
    triggers: ['Lab order, appointment, missed lab, missing outside order, or result question'],
    chartChecks: ['Relevant chart entry and open lab/result TE'],
    requiredActions: ['Send or update TE to OB Portal', 'Explain that clinical staff must address results'],
    prohibitedActions: ['Schedule lab work', 'Interpret or reassure about results'],
    documentationRequirements: ['Specific lab request or question'],
    escalationPath: 'OB Portal',
    allowedVariants: ['Use Take Action for a repeat callback on the same issue'],
  }),
  rule('late_arrival', 'Late arrival communication', 'late_arrival', ['classification', 'routing', 'documentation'], ['communication', 'problemResolution', 'customerHandling'], {
    triggers: ['Patient reports expected late arrival'],
    chartChecks: ['Appointment type', 'Appointment time', 'Whether the visit is paired'],
    requiredActions: ['Message Intermedia with patient account number, appointment time, and expected lateness', 'Await office response'],
    prohibitedActions: ['Independently decide whether the patient may be seen', 'Break a paired appointment'],
    documentationRequirements: ['Account number, appointment time, and expected lateness'],
    escalationPath: 'Appropriate Intermedia office channel',
    allowedVariants: ['For MFM, follow the MFM owner workflow'],
  }),
  rule('pregnancy_loss', 'Reported pregnancy loss', 'pregnancy_loss', ['classification', 'routing', 'boundaries', 'documentation'], ['riskManagement', 'escalation', 'communication'], {
    triggers: ['Patient reports miscarriage or ended pregnancy'],
    chartChecks: ['Future pregnancy appointments', 'Open TEs', 'Recent clinical documentation'],
    requiredActions: ['Create or update High Priority TE', 'Use urgent-channel escalation', 'Await clinical direction'],
    prohibitedActions: ['Cancel all appointments independently', 'Alter pregnancy status', 'Decide follow-up care'],
    documentationRequirements: ['Concise patient-reported loss details'],
    escalationPath: 'OB Portal and urgent channel',
    allowedVariants: ['Use Take Action when the same issue is already open'],
  }),
]);

const RULE_BY_ID = new Map(OBGYN_WORKFLOW_RULES.map((item) => [item.id, item]));

export const OBGYN_WORKFLOW_TAXONOMY = Object.freeze(
  [...new Set(OBGYN_WORKFLOW_RULES.map((item) => item.workflowType))]
);

export function getObgynWorkflowRule(id) {
  return RULE_BY_ID.get(id) ?? null;
}

export function obgynRulesFor({ department = 'obgyn', domainId, workflowType, ruleIds } = {}) {
  if (department !== 'obgyn') return [];
  if (Array.isArray(ruleIds) && ruleIds.length) {
    return [...new Set(ruleIds)].map(getObgynWorkflowRule).filter((item) => (
      item
      && (!domainId || item.domainIds.includes(domainId))
      && (!workflowType || item.workflowType === workflowType)
    ));
  }
  return OBGYN_WORKFLOW_RULES.filter((item) => (
    (!domainId || item.domainIds.includes(domainId))
    && (!workflowType || item.workflowType === workflowType)
  ));
}

export function obgynRuleVersionMetadata(ruleIds = OBGYN_WORKFLOW_RULES.map((item) => item.id)) {
  const rules = obgynRulesFor({ ruleIds });
  return {
    ruleSetVersion: OBGYN_RULE_SET_VERSION,
    sourceSopVersion: OBGYN_SOP_VERSION,
    sourceAuthority: OBGYN_SOURCE_AUTHORITY,
    rules: rules.map(({ id, version }) => ({ id, version })),
  };
}

export function formatObgynRulesForPrompt(rules) {
  return rules.map((item) => [
    `RULE ${item.id} (${item.workflowType}, ${item.version})`,
    `Triggers: ${item.triggers.join('; ')}`,
    `Chart checks: ${item.chartChecks.join('; ')}`,
    `Required: ${item.requiredActions.join('; ')}`,
    `Prohibited: ${item.prohibitedActions.join('; ')}`,
    `Documentation: ${item.documentationRequirements.join('; ')}`,
    `Escalation: ${item.escalationPath}`,
    `Allowed variants: ${item.allowedVariants.join('; ')}`,
  ].join('\n')).join('\n\n');
}
