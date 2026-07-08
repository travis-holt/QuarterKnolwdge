import { ASSESSED_DEPTS } from './departments.js';

// Curated Call QA Test scenarios. These are assessment prompts, so keep them
// stable, department-tagged, and free of real names, phone numbers, or PII.
export const CALL_QA_SCENARIOS = [
  {
    id: 'qa-peds-scheduling-001',
    department: 'pediatrics',
    title: 'Parent scheduling a new pediatric visit',
    workflowType: 'new_appointment_scheduling',
    difficulty: 'medium',
    primaryDomainId: 'scheduling',
    domainIds: ['intake', 'classification', 'scheduling', 'documentation'],
    competencyIds: ['sopApplication', 'communication', 'customerHandling', 'problemResolution'],
    callerName: 'Maria',
    openingLine: 'Hi, I need to make an appointment for my son. He has not been seen there before.',
    scenario: `
A parent is calling to schedule a new pediatric appointment. The navigator must identify the child,
clarify whether this is a new patient or return visit, choose the right scheduling path, avoid
overpromising availability, and document the booking details cleanly.
    `.trim(),
    expectedActions: [
      'Identify the correct child and caller relationship before acting.',
      'Clarify whether the child is new to the department or returning.',
      'Use the department-appropriate new-appointment scheduling flow.',
      'Set realistic expectations without promising provider approval or special exceptions.',
      'Document the appointment reason and callback details clearly.',
    ],
    criticalMisses: [
      'Books before confirming the correct patient.',
      'Uses a wrong appointment type after the caller explains the need.',
      'Promises a specific approval or exception outside navigator scope.',
      'Leaves the scheduling reason undocumented.',
    ],
    scoringNotes: [
      'Accept natural phrasing if the navigator verifies identity, classifies the request, and schedules/routs correctly.',
      'Do not require a scripted greeting.',
    ],
  },
  {
    id: 'qa-peds-siblings-001',
    department: 'pediatrics',
    title: 'Parent calling for two siblings',
    workflowType: 'multiple_siblings_family_lookup',
    difficulty: 'hard',
    primaryDomainId: 'intake',
    domainIds: ['intake', 'classification', 'documentation'],
    competencyIds: ['sopApplication', 'criticalThinking', 'riskManagement', 'problemResolution'],
    callerName: 'Nadia',
    openingLine: 'I need help with both of my kids. One needs a sick visit and the other needs a refill.',
    scenario: `
A parent is calling about two children in the same family. One child needs a sick visit and the other
needs a standard medication refill. The navigator must keep each request in the correct child chart,
classify both workflows, and avoid mixing documentation.
    `.trim(),
    expectedActions: [
      'Confirm which request belongs to which child.',
      'Work in each child chart separately.',
      'Classify the sick visit and refill as separate workflows.',
      'Document each request under the correct patient.',
    ],
    criticalMisses: [
      'Documents both requests in one child chart.',
      'Handles only one child and drops the second request.',
      'Books or routes before clarifying which child is which.',
    ],
    scoringNotes: [
      'Credit efficient handling of both requests in one call if chart separation is maintained.',
    ],
  },
  {
    id: 'qa-peds-referral-001',
    department: 'pediatrics',
    title: 'Parent calling about referral status',
    workflowType: 'referral',
    difficulty: 'medium',
    primaryDomainId: 'routing',
    domainIds: ['intake', 'classification', 'routing', 'documentation'],
    competencyIds: ['sopApplication', 'criticalThinking', 'communication', 'escalation', 'problemResolution'],
    callerName: 'Elena',
    openingLine: 'Hi, I am calling about my child\'s referral. I was told someone would call me back but I have not heard anything.',
    scenario: `
A parent is calling about a pediatric referral status. The navigator must identify the patient,
understand whether this is a status update or new referral request, avoid promising approval,
route/document correctly, and set realistic expectations.
    `.trim(),
    expectedActions: [
      'Identify the correct patient using department-appropriate lookup flow.',
      'Clarify whether this is referral status, a new referral request, or records issue.',
      'Avoid promising referral approval or medical outcome.',
      'Create/document the correct telephone encounter with concise details.',
      'Route to the Pediatrics referral coordinator according to department SOP.',
    ],
    criticalMisses: [
      'Promises the referral will be approved.',
      'Routes to the wrong destination after the caller clearly describes a referral issue.',
      'Skips patient identification.',
      'Gives medical advice instead of routing/documenting.',
    ],
    scoringNotes: [
      'Accept natural wording if the navigator correctly classifies and routes the request.',
      'Fail routing only when the final destination or follow-through is clearly wrong.',
    ],
  },
  {
    id: 'qa-peds-refill-001',
    department: 'pediatrics',
    title: 'Standard prescription refill request',
    workflowType: 'prescription_refill',
    difficulty: 'medium',
    primaryDomainId: 'routing',
    domainIds: ['classification', 'routing', 'boundaries', 'documentation'],
    competencyIds: ['sopApplication', 'communication', 'riskManagement', 'problemResolution'],
    callerName: 'Samira',
    openingLine: 'My daughter is out of her allergy medicine and we need a refill sent to the pharmacy.',
    scenario: `
A parent is calling for a standard pediatric medication refill. The navigator must gather medication,
pharmacy, callback, and out-of-medication details, route to the correct clinical queue, and avoid
promising approval or giving dosing advice.
    `.trim(),
    expectedActions: [
      'Clarify medication name and whether the patient is out.',
      'Confirm preferred pharmacy and callback details.',
      'Route the refill request to the correct Pediatrics clinical queue.',
      'Flag urgency appropriately if the patient is out.',
      'Avoid promising the refill will be approved or sent by a specific time.',
    ],
    criticalMisses: [
      'Promises refill approval.',
      'Gives medication or dosing advice.',
      'Fails to collect pharmacy or medication details.',
      'Routes a standard refill to an unrelated destination.',
    ],
    scoringNotes: [
      'Do not require PE-status verification unless the caller makes that the governing issue.',
    ],
  },
  {
    id: 'qa-peds-records-001',
    department: 'pediatrics',
    title: 'School form and immunization record request',
    workflowType: 'records_forms',
    difficulty: 'easy',
    primaryDomainId: 'documentation',
    domainIds: ['intake', 'classification', 'routing', 'documentation'],
    competencyIds: ['sopKnowledge', 'sopApplication', 'communication', 'problemResolution'],
    callerName: 'Tanya',
    openingLine: 'The school needs my child\'s immunization record and a form filled out. Can you send that today?',
    scenario: `
A parent needs pediatric records and a school form. The navigator must identify the child, clarify
which documents are needed, avoid guaranteeing same-day completion, route the form/records request
properly, and document the request.
    `.trim(),
    expectedActions: [
      'Verify the correct child and authorized caller.',
      'Clarify whether the request is records, a form, or both.',
      'Route to the generic records/forms destination for Pediatrics.',
      'Set realistic turnaround expectations.',
      'Document requested items and delivery/callback details.',
    ],
    criticalMisses: [
      'Releases information without verifying authorization.',
      'Promises same-day completion without basis.',
      'Treats a form request as clinical advice.',
    ],
    scoringNotes: [
      'Generic destination wording is acceptable if ownership and documentation are clear.',
    ],
  },
  {
    id: 'qa-peds-urgent-boundary-001',
    department: 'pediatrics',
    title: 'Parent asking whether symptoms are urgent',
    workflowType: 'urgent_symptom_boundary',
    difficulty: 'hard',
    primaryDomainId: 'boundaries',
    domainIds: ['classification', 'routing', 'boundaries', 'documentation'],
    competencyIds: ['criticalThinking', 'riskManagement', 'escalation', 'communication'],
    callerName: 'Rebecca',
    openingLine: 'My child has a fever and is breathing funny. Do you think I should wait for an appointment?',
    scenario: `
A parent describes potentially urgent symptoms and asks the navigator to judge what to do medically.
The navigator must stay inside scope, recognize the safety concern, avoid clinical advice, escalate
or route according to urgent symptom policy, and document what was reported.
    `.trim(),
    expectedActions: [
      'Recognize the caller is asking for clinical judgment.',
      'Avoid advising whether symptoms are serious or safe to wait.',
      'Use the urgent escalation path or direct emergency guidance permitted by SOP.',
      'Document reported symptoms and routing/escalation taken.',
    ],
    criticalMisses: [
      'Tells the caller the child can wait.',
      'Gives medical advice or triage beyond scope.',
      'Treats the call as routine scheduling only.',
      'Fails to document the urgent symptoms.',
    ],
    scoringNotes: [
      'Score for boundary management and escalation, not for medical diagnosis.',
    ],
  },
  {
    id: 'qa-peds-insurance-001',
    department: 'pediatrics',
    title: 'Eligibility confusion during scheduling',
    workflowType: 'insurance_eligibility_confusion',
    difficulty: 'medium',
    primaryDomainId: 'classification',
    domainIds: ['intake', 'classification', 'scheduling', 'boundaries'],
    competencyIds: ['sopKnowledge', 'sopApplication', 'criticalThinking', 'communication'],
    callerName: 'Alyssa',
    openingLine: 'I am trying to book my child\'s physical, but I was told there is some insurance problem.',
    scenario: `
A parent wants to schedule a pediatric physical but reports insurance or PCP eligibility confusion.
The navigator must clarify the eligibility issue, avoid inventing coverage answers, follow the
department scheduling/eligibility workflow, and communicate next steps plainly.
    `.trim(),
    expectedActions: [
      'Verify the correct child and clarify what eligibility issue was seen.',
      'Explain next steps without guaranteeing coverage or payment.',
      'Apply scheduling rules that depend on eligibility/insurance status.',
      'Route or document unresolved eligibility questions appropriately.',
    ],
    criticalMisses: [
      'Guarantees the visit will be covered.',
      'Ignores the eligibility issue and books as usual when policy requires follow-up.',
      'Gives insurance advice outside navigator scope.',
    ],
    scoringNotes: [
      'Accept caller-friendly wording if coverage is not promised.',
    ],
  },
  {
    id: 'qa-peds-unclear-001',
    department: 'pediatrics',
    title: 'Unclear request that may belong elsewhere',
    workflowType: 'wrong_department_unclear_request',
    difficulty: 'medium',
    primaryDomainId: 'classification',
    domainIds: ['intake', 'classification', 'routing', 'documentation'],
    competencyIds: ['criticalThinking', 'problemResolution', 'communication', 'escalation'],
    callerName: 'Jasmine',
    openingLine: 'I am not sure who I need. I have a question about my child, but it might be for another department.',
    scenario: `
A caller has an unclear request that may belong to Pediatrics or another department. The navigator
must gather enough detail to classify the request, avoid dumping the caller, route to the right
destination, and document any follow-through.
    `.trim(),
    expectedActions: [
      'Verify patient/caller enough to proceed safely.',
      'Ask clarifying questions to identify the department and workflow.',
      'Route to the correct destination or department supervisor when unclear.',
      'Document the reason and handoff if a message is created.',
    ],
    criticalMisses: [
      'Transfers blindly without clarifying the request.',
      'Books into Pediatrics when the request clearly belongs elsewhere.',
      'Ends the call without a path forward.',
    ],
    scoringNotes: [
      'Credit escalation to a department supervisor when classification remains unclear after reasonable questions.',
    ],
  },
  {
    id: 'qa-obgyn-new-gyn-001',
    department: 'obgyn',
    title: 'New GYN visit, not pregnant',
    workflowType: 'new_gyn_visit',
    difficulty: 'medium',
    primaryDomainId: 'scheduling',
    domainIds: ['intake', 'classification', 'scheduling', 'documentation'],
    competencyIds: ['sopApplication', 'communication', 'customerHandling', 'problemResolution'],
    callerName: 'Leah',
    openingLine: 'Hi, I need to schedule a new GYN appointment. I am not pregnant.',
    scenario: `
A caller wants a new GYN appointment and clearly states she is not pregnant. The navigator must
classify it as a non-pregnancy GYN scheduling request, use the correct destination, and document
the reason without drifting into pregnancy workflow.
    `.trim(),
    expectedActions: [
      'Confirm caller identity and basic scheduling need.',
      'Classify as a new GYN visit, not pregnancy care.',
      'Use the correct OB/GYN scheduling path.',
      'Document visit reason and callback details.',
    ],
    criticalMisses: [
      'Routes to pregnancy workflow after the caller says she is not pregnant.',
      'Gives clinical advice about symptoms or contraception.',
      'Books before confirming required identity details.',
    ],
    scoringNotes: [
      'Natural scheduling language is fine if the workflow classification is correct.',
    ],
  },
  {
    id: 'qa-obgyn-pregnancy-001',
    department: 'obgyn',
    title: 'Pregnancy-related first visit request',
    workflowType: 'pregnancy_related_visit',
    difficulty: 'medium',
    primaryDomainId: 'scheduling',
    domainIds: ['intake', 'classification', 'scheduling', 'boundaries', 'documentation'],
    competencyIds: ['sopApplication', 'criticalThinking', 'communication', 'riskManagement'],
    callerName: 'Maya',
    openingLine: 'I just found out I am pregnant and need to make my first appointment.',
    scenario: `
A caller reports a positive pregnancy test and wants her first OB appointment. The navigator must
classify the pregnancy-related visit, collect the scheduling details required by workflow, avoid
medical advice, and document the request accurately.
    `.trim(),
    expectedActions: [
      'Classify as pregnancy-related OB scheduling.',
      'Collect required scheduling context without probing beyond role.',
      'Route or schedule through the correct OB/GYN path.',
      'Avoid giving medical advice or interpreting symptoms.',
      'Document the pregnancy-related request and next step.',
    ],
    criticalMisses: [
      'Treats the call as routine GYN after pregnancy is stated.',
      'Gives medical advice about pregnancy symptoms.',
      'Fails to document pregnancy-related context needed for scheduling.',
    ],
    scoringNotes: [
      'Do not require exact scripted intake questions, only the workflow-critical ones.',
    ],
  },
  {
    id: 'qa-obgyn-mfm-001',
    department: 'obgyn',
    title: 'MFM-related scheduling request',
    workflowType: 'mfm_related_request',
    difficulty: 'hard',
    primaryDomainId: 'routing',
    domainIds: ['classification', 'routing', 'scheduling', 'documentation'],
    competencyIds: ['sopKnowledge', 'sopApplication', 'escalation', 'criticalThinking'],
    callerName: 'Arielle',
    openingLine: 'My OB told me I need an MFM appointment, but I am not sure who schedules that.',
    scenario: `
A caller asks about an MFM-related request. The navigator must recognize that this is not ordinary
GYN scheduling, clarify the request, route to the MFM coordinator or correct OB destination, and
document the handoff without promising appointment approval.
    `.trim(),
    expectedActions: [
      'Recognize the request is MFM-related.',
      'Clarify whether this is scheduling, referral status, or records needed for MFM.',
      'Route to the MFM coordinator or correct OB destination.',
      'Avoid promising approval, timing, or clinical outcome.',
      'Document the handoff details.',
    ],
    criticalMisses: [
      'Books as a routine GYN visit after MFM is clearly stated.',
      'Promises the MFM appointment will be approved.',
      'Routes to an unrelated department.',
    ],
    scoringNotes: [
      'Generic MFM coordinator wording is acceptable.',
    ],
  },
  {
    id: 'qa-obgyn-refill-001',
    department: 'obgyn',
    title: 'OB/GYN prescription refill request',
    workflowType: 'prescription_refill',
    difficulty: 'medium',
    primaryDomainId: 'routing',
    domainIds: ['classification', 'routing', 'boundaries', 'documentation'],
    competencyIds: ['sopApplication', 'communication', 'riskManagement', 'problemResolution'],
    callerName: 'Dina',
    openingLine: 'I need a refill on my medication from the OB/GYN office. My pharmacy says they have not heard back.',
    scenario: `
A caller asks for an OB/GYN medication refill. The navigator must gather the medication, pharmacy,
callback, and urgency details, route through the OB/GYN refill path, avoid medication advice, and
document the request.
    `.trim(),
    expectedActions: [
      'Clarify medication name, pharmacy, callback number, and urgency.',
      'Route refill details to the correct OB/GYN destination.',
      'Avoid promising approval or same-day completion.',
      'Avoid dosing or medication advice.',
      'Document the refill request completely.',
    ],
    criticalMisses: [
      'Gives dosing or medication advice.',
      'Promises the refill will be approved.',
      'Routes to Pediatrics or another unrelated queue.',
      'Leaves out pharmacy or medication details.',
    ],
    scoringNotes: [
      'Accept OB Portal or PSS OB routing if consistent with active SOP wording.',
    ],
  },
  {
    id: 'qa-obgyn-results-boundary-001',
    department: 'obgyn',
    title: 'Test result and medical advice boundary',
    workflowType: 'test_result_medical_advice_boundary',
    difficulty: 'hard',
    primaryDomainId: 'boundaries',
    domainIds: ['classification', 'routing', 'boundaries', 'documentation'],
    competencyIds: ['compliance', 'riskManagement', 'communication', 'escalation'],
    callerName: 'Priya',
    openingLine: 'I saw a lab result in the portal and I need you to tell me if it is normal.',
    scenario: `
A caller asks the navigator to interpret an OB/GYN test result. The navigator must protect scope,
avoid reading or interpreting results, route to the clinical team for follow-up, and document the
request clearly.
    `.trim(),
    expectedActions: [
      'Recognize the request is medical interpretation.',
      'Explain that results/medical advice must come from clinical staff.',
      'Route to the clinical team or OB Portal workflow.',
      'Document caller concern and callback details.',
    ],
    criticalMisses: [
      'Interprets the result as normal or abnormal.',
      'Reads protected result details without proper process.',
      'Dismisses the concern without routing.',
    ],
    scoringNotes: [
      'Score for boundary and routing; do not require the navigator to know the clinical meaning.',
    ],
  },
  {
    id: 'qa-obgyn-schedule-change-001',
    department: 'obgyn',
    title: 'Scheduling change request',
    workflowType: 'scheduling_change',
    difficulty: 'easy',
    primaryDomainId: 'scheduling',
    domainIds: ['intake', 'classification', 'scheduling', 'documentation'],
    competencyIds: ['sopApplication', 'communication', 'customerHandling', 'problemResolution'],
    callerName: 'Kara',
    openingLine: 'I need to move my OB/GYN appointment. I cannot come on the day I was given.',
    scenario: `
A caller needs to reschedule an existing OB/GYN appointment. The navigator must identify the
appointment, classify the request as a scheduling change, follow the correct rescheduling path,
and document the outcome.
    `.trim(),
    expectedActions: [
      'Verify caller and appointment details.',
      'Classify as a scheduling change.',
      'Use the correct OB/GYN rescheduling path.',
      'Document new appointment or routing outcome.',
    ],
    criticalMisses: [
      'Cancels or changes the wrong appointment.',
      'Treats the change as a new-patient request without checking existing appointment.',
      'Fails to document the change.',
    ],
    scoringNotes: [
      'Straightforward call; focus on accurate verification and clean close.',
    ],
  },
  {
    id: 'qa-obgyn-records-001',
    department: 'obgyn',
    title: 'OB/GYN records or forms request',
    workflowType: 'records_forms',
    difficulty: 'medium',
    primaryDomainId: 'documentation',
    domainIds: ['intake', 'classification', 'routing', 'documentation', 'boundaries'],
    competencyIds: ['sopApplication', 'compliance', 'communication', 'problemResolution'],
    callerName: 'Selena',
    openingLine: 'I need my OB/GYN records sent to another office, and there is a form they asked me to complete.',
    scenario: `
A caller requests OB/GYN records and mentions a form. The navigator must verify authorization,
clarify records versus forms, route to the correct records/forms destination, avoid sharing
protected information inappropriately, and document the request.
    `.trim(),
    expectedActions: [
      'Verify identity and authorization before discussing records.',
      'Clarify which records and which form are needed.',
      'Route to the OB/GYN records/forms destination.',
      'Set realistic expectations for turnaround.',
      'Document requested items and delivery/callback details.',
    ],
    criticalMisses: [
      'Releases records without authorization process.',
      'Promises immediate completion.',
      'Routes forms to an unrelated clinical/scheduling workflow.',
    ],
    scoringNotes: [
      'Generic records/forms destination wording is acceptable.',
    ],
  },
  {
    id: 'qa-obgyn-unclear-001',
    department: 'obgyn',
    title: 'Wrong department or unclear OB/GYN request',
    workflowType: 'wrong_department_unclear_request',
    difficulty: 'medium',
    primaryDomainId: 'classification',
    domainIds: ['intake', 'classification', 'routing', 'documentation'],
    competencyIds: ['criticalThinking', 'problemResolution', 'communication', 'escalation'],
    callerName: 'Monica',
    openingLine: 'I am not sure if I need OB/GYN or another office. I just need someone to point me in the right direction.',
    scenario: `
A caller has an unclear request that may or may not belong to OB/GYN. The navigator must ask enough
questions to classify the workflow, route or escalate appropriately, avoid abandoning the caller,
and document any message or handoff.
    `.trim(),
    expectedActions: [
      'Clarify what the caller is trying to accomplish.',
      'Determine whether OB/GYN owns the request.',
      'Route to PSS OB, OB Portal, another department, or department supervisor as appropriate.',
      'Document the handoff or message.',
    ],
    criticalMisses: [
      'Transfers without clarifying the request.',
      'Books into OB/GYN after the caller clearly describes another department need.',
      'Ends the call without a next step.',
    ],
    scoringNotes: [
      'Credit supervisor escalation when the request remains ambiguous after reasonable questions.',
    ],
  },
];

export function getCallQaScenarios(department) {
  return CALL_QA_SCENARIOS.filter((scenario) => scenario.department === department);
}

export function getCallQaScenarioById(id) {
  return CALL_QA_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

export function selectCallQaScenario({ department, priorAttempts = [], now = Date.now() } = {}) {
  void now;
  const scenarios = getCallQaScenarios(department);
  if (!scenarios.length) return null;
  const activePriorAttempts = priorAttempts.filter((iv) =>
    iv?.department === department &&
    iv?.qa &&
    !iv?.qaArchived
  );
  const usedIds = new Set(activePriorAttempts.map((iv) => iv.qaScenarioId).filter(Boolean));
  if (scenarios.every((scenario) => usedIds.has(scenario.id))) return scenarios[0];
  const recentIds = new Set(
    activePriorAttempts
      .sort((a, b) => (b.endedAt?.seconds ?? 0) - (a.endedAt?.seconds ?? 0))
      .slice(0, 3)
      .map((iv) => iv.qaScenarioId)
      .filter(Boolean)
  );
  return scenarios.find((scenario) => !recentIds.has(scenario.id)) ?? scenarios[0];
}

export function callQaScenarioCoverage(department) {
  const scenarios = getCallQaScenarios(department);
  const workflowCounts = {};
  for (const scenario of scenarios) {
    workflowCounts[scenario.workflowType] = (workflowCounts[scenario.workflowType] ?? 0) + 1;
  }
  return {
    department,
    assessed: ASSESSED_DEPTS.includes(department),
    count: scenarios.length,
    workflowCounts,
  };
}
