import { ASSESSED_DEPTS } from './departments.js';

// Curated Call QA Test scenarios. These are assessment prompts, so keep them
// stable, department-tagged, and free of real names, phone numbers, or PII.
const SHARED_SCORING_NOTES = [
  'Accept natural, caller-friendly wording when the workflow classification and routing are correct.',
  'Do not require a scripted phrase; grade the decision quality, documentation, and boundaries.',
];

function scenario({
  id,
  department,
  title,
  workflowType,
  difficulty,
  primaryDomainId,
  domainIds,
  competencyIds,
  callerName,
  openingLine,
  scenario: prompt,
  expectedActions,
  criticalMisses,
  scoringNotes = SHARED_SCORING_NOTES,
}) {
  return {
    id,
    department,
    title,
    workflowType,
    difficulty,
    primaryDomainId,
    domainIds,
    competencyIds,
    callerName,
    openingLine,
    scenario: prompt.trim(),
    expectedActions,
    criticalMisses,
    scoringNotes,
  };
}

export const CALL_QA_SCENARIOS = [
  scenario({
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
    scenario: `A parent is calling to schedule a new pediatric appointment. The navigator must identify the child, clarify whether this is a new patient or returning patient request, choose the correct scheduling path, avoid overpromising availability, and document the reason for visit.`,
    expectedActions: [
      'Identify the correct child and caller relationship before acting.',
      'Clarify new versus returning patient status and appointment reason.',
      'Use the department-appropriate scheduling path.',
      'Set realistic expectations without promising special exceptions.',
      'Document appointment reason and callback details clearly.',
    ],
    criticalMisses: [
      'Books before confirming the correct patient.',
      'Uses the wrong appointment type after the caller explains the need.',
      'Promises a specific approval or exception outside navigator scope.',
    ],
  }),
  scenario({
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
    scenario: `A parent is calling about two children in the same family. One child needs a sick visit and the other needs a standard medication refill. The navigator must keep each request in the correct child chart, classify both workflows, and avoid mixing documentation.`,
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
  }),
  scenario({
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
    scenario: `A parent is calling about a pediatric referral status. The navigator must identify the patient, understand whether this is a status update or new referral request, avoid promising approval, route or document correctly, and set realistic expectations.`,
    expectedActions: [
      'Identify the correct patient using the department-appropriate lookup flow.',
      'Clarify whether this is referral status, a new referral request, or records issue.',
      'Avoid promising referral approval or medical outcome.',
      'Route to the Pediatrics referral coordinator or correct referral destination.',
      'Document concise details and callback information.',
    ],
    criticalMisses: [
      'Promises the referral will be approved.',
      'Routes to the wrong destination after the caller clearly describes a referral issue.',
      'Skips patient identification.',
      'Gives medical advice instead of routing or documenting.',
    ],
  }),
  scenario({
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
    scenario: `A parent is calling for a standard pediatric medication refill. The navigator must gather medication name, preferred pharmacy, callback details, and whether the patient is out, route the request correctly, and avoid promising approval or giving dosing advice.`,
    expectedActions: [
      'Clarify medication name and whether the patient is out.',
      'Confirm preferred pharmacy and callback details.',
      'Route the refill request to the correct Pediatrics clinical destination.',
      'Flag urgency appropriately if the patient is out.',
      'Avoid promising approval, timing, or medication guidance.',
    ],
    criticalMisses: [
      'Promises refill approval.',
      'Gives medication or dosing advice.',
      'Fails to collect pharmacy or medication details.',
      'Routes a standard refill to an unrelated destination.',
    ],
    scoringNotes: [
      'Do not require PE-status verification unless the caller makes that the governing issue.',
      ...SHARED_SCORING_NOTES,
    ],
  }),
  scenario({
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
    scenario: `A parent needs pediatric records and a school form. The navigator must identify the child, clarify which documents are needed, avoid guaranteeing same-day completion, route the form or records request properly, and document the request.`,
    expectedActions: [
      'Verify the correct child and authorized caller.',
      'Clarify whether the request is records, a form, or both.',
      'Route to the appropriate records/forms destination.',
      'Set realistic turnaround expectations.',
      'Document requested items and delivery or callback details.',
    ],
    criticalMisses: [
      'Releases information without verifying authorization.',
      'Promises same-day completion without basis.',
      'Treats a form request as clinical advice.',
    ],
  }),
  scenario({
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
    scenario: `A parent describes potentially urgent symptoms and asks the navigator to judge what to do medically. The navigator must stay inside scope, recognize the safety concern, avoid clinical advice, escalate or route according to urgent symptom policy, and document what was reported.`,
    expectedActions: [
      'Recognize the caller is asking for clinical judgment.',
      'Avoid advising whether symptoms are serious or safe to wait.',
      'Use the urgent escalation path or permitted emergency guidance.',
      'Document reported symptoms and the escalation taken.',
    ],
    criticalMisses: [
      'Tells the caller the child can wait.',
      'Gives medical advice or triage beyond scope.',
      'Treats the call as routine scheduling only.',
      'Fails to document the urgent symptoms.',
    ],
    scoringNotes: [
      'Score for boundary management and escalation, not for medical diagnosis.',
      ...SHARED_SCORING_NOTES,
    ],
  }),
  scenario({
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
    scenario: `A parent wants to schedule a pediatric physical but reports insurance or PCP eligibility confusion. The navigator must clarify the issue, avoid inventing coverage answers, follow the scheduling or eligibility workflow, and communicate next steps plainly.`,
    expectedActions: [
      'Verify the correct child and clarify the eligibility issue.',
      'Explain next steps without guaranteeing coverage or payment.',
      'Apply scheduling rules tied to eligibility status.',
      'Route or document unresolved eligibility questions appropriately.',
    ],
    criticalMisses: [
      'Guarantees the visit will be covered.',
      'Ignores the eligibility issue when policy requires follow-up.',
      'Gives insurance advice outside navigator scope.',
    ],
  }),
  scenario({
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
    scenario: `A caller has an unclear request that may belong to Pediatrics or another department. The navigator must gather enough detail to classify the request, avoid dumping the caller, route to the right destination, and document any follow-through.`,
    expectedActions: [
      'Verify patient and caller enough to proceed safely.',
      'Ask clarifying questions to identify department and workflow.',
      'Route to the correct destination or supervisor when unclear.',
      'Document the reason and handoff if a message is created.',
    ],
    criticalMisses: [
      'Transfers blindly without clarifying the request.',
      'Books into Pediatrics when the request clearly belongs elsewhere.',
      'Ends the call without a path forward.',
    ],
  }),
  scenario({
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
    scenario: `A caller wants a new GYN appointment and clearly states she is not pregnant. The navigator must classify it as a non-pregnancy GYN scheduling request, use the correct destination, and document the reason without drifting into pregnancy workflow.`,
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
  }),
  scenario({
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
    scenario: `A caller reports a positive pregnancy test and wants her first OB appointment. The navigator must classify the pregnancy-related visit, collect scheduling details required by workflow, avoid medical advice, and document the request accurately.`,
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
      'Fails to document pregnancy-related scheduling context.',
    ],
  }),
  scenario({
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
    scenario: `A caller asks about an MFM-related request. The navigator must recognize this is not ordinary GYN scheduling, clarify whether this is scheduling, referral status, or records, route to the MFM coordinator or correct OB destination, and document the handoff without promising appointment approval.`,
    expectedActions: [
      'Recognize the request is MFM-related.',
      'Clarify whether this is scheduling, referral status, or records needed for MFM.',
      'Route to the MFM coordinator or correct OB destination.',
      'Avoid promising approval, timing, or clinical outcome.',
      'Document handoff details.',
    ],
    criticalMisses: [
      'Books as a routine GYN visit after MFM is clearly stated.',
      'Promises the MFM appointment will be approved.',
      'Routes to an unrelated department.',
    ],
  }),
  scenario({
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
    scenario: `A caller asks for an OB/GYN medication refill. The navigator must gather medication, pharmacy, callback, and urgency details, route through the OB/GYN refill path, avoid medication advice, and document the request.`,
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
  }),
  scenario({
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
    scenario: `A caller asks the navigator to interpret an OB/GYN test result. The navigator must protect scope, avoid reading or interpreting results, route to the clinical team or OB Portal for follow-up, and document the request clearly.`,
    expectedActions: [
      'Recognize the request is medical interpretation.',
      'Explain that results and medical advice must come from clinical staff.',
      'Route to the clinical team or OB Portal workflow.',
      'Document caller concern and callback details.',
    ],
    criticalMisses: [
      'Interprets the result as normal or abnormal.',
      'Reads protected result details without proper process.',
      'Dismisses the concern without routing.',
    ],
    scoringNotes: [
      'Score for boundary and routing; do not require the navigator to know clinical meaning.',
      ...SHARED_SCORING_NOTES,
    ],
  }),
  scenario({
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
    scenario: `A caller needs to reschedule an existing OB/GYN appointment. The navigator must identify the appointment, classify the request as a scheduling change, follow the correct rescheduling path, and document the outcome.`,
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
  }),
  scenario({
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
    scenario: `A caller requests OB/GYN records and mentions a form. The navigator must verify authorization, clarify records versus forms, route to the correct records/forms destination, avoid sharing protected information inappropriately, and document the request.`,
    expectedActions: [
      'Verify identity and authorization before discussing records.',
      'Clarify which records and which form are needed.',
      'Route to the OB/GYN records/forms destination.',
      'Set realistic expectations for turnaround.',
      'Document requested items and delivery or callback details.',
    ],
    criticalMisses: [
      'Releases records without authorization process.',
      'Promises immediate completion.',
      'Routes forms to an unrelated clinical or scheduling workflow.',
    ],
  }),
  scenario({
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
    scenario: `A caller has an unclear request that may or may not belong to OB/GYN. The navigator must ask enough questions to classify the workflow, route or escalate appropriately, avoid abandoning the caller, and document any message or handoff.`,
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
  }),
];

export function getCallQaScenarios(department) {
  return CALL_QA_SCENARIOS.filter((scenario) => scenario.department === department);
}

export function getCallQaScenarioById(id) {
  return CALL_QA_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

export function selectCallQaScenario({ department, priorAttempts = [] } = {}) {
  const scenarios = getCallQaScenarios(department);
  if (!scenarios.length) return null;

  const recentIds = new Set(
    priorAttempts
      .filter((iv) =>
        (iv.department ?? 'pediatrics') === department &&
        iv?.qa &&
        !iv?.qaArchived
      )
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
  for (const item of scenarios) {
    workflowCounts[item.workflowType] = (workflowCounts[item.workflowType] ?? 0) + 1;
  }
  return {
    department,
    assessed: ASSESSED_DEPTS.includes(department),
    count: scenarios.length,
    workflowCounts,
  };
}
