// ─────────────────────────────────────────────────────────────────────────────
// CURATED CALL QA SCENARIOS
//
// Foundation for making Phase 3 Call QA a controlled assessment instead of a
// random generated practice-style call. These scenarios are intentionally static,
// inspectable, and tagged so later PRs can wire selection, coverage, and QA
// dashboard reporting without changing the deterministic grader.
// ─────────────────────────────────────────────────────────────────────────────

export const QA_WORKFLOW_TYPES = [
  'scheduling',
  'refill',
  'lab-result',
  'urgent-escalation',
  'angry-caller',
  'privacy-verification',
  'multi-patient',
  'documentation-routing',
  'pregnancy-routing',
  'mfm-routing',
];

export const CALL_QA_SCENARIOS = [
  {
    id: 'qa-peds-scheduling-pe-001',
    department: 'pediatrics',
    title: 'Pediatrics PE scheduling with verification trap',
    callerName: 'Maya Johnson',
    openingLine: 'Hi, I need to schedule my son for his yearly physical.',
    scenario: 'A parent calls Pediatrics to schedule a physical exam for her established child. The navigator must verify identity, select the correct child chart, schedule the correct visit type, recap the appointment, and avoid sharing chart details before verification.',
    primaryDomainId: 'scheduling',
    domainIds: ['intake', 'scheduling', 'boundaries', 'documentation'],
    competencyIds: ['sopApplication', 'communication', 'compliance'],
    workflowType: 'scheduling',
    difficulty: 'standard',
    expectedActions: [
      'Complete identity verification before discussing chart or appointment details.',
      'Confirm the correct child/patient before scheduling.',
      'Schedule the correct pediatric physical exam visit type.',
      'Recap date, time, location, and arrival instructions.',
    ],
    autoFailTraps: ['Caller asks whether the child is due before verification.'],
    routingRules: [],
    scoringNotes: ['Do not require a telephone encounter when the issue is fully resolved by scheduling.'],
  },
  {
    id: 'qa-peds-refill-out-001',
    department: 'pediatrics',
    title: 'Pediatrics refill, patient completely out',
    callerName: 'Carlos Rivera',
    openingLine: 'My daughter ran out of her medication yesterday and I need a refill sent today.',
    scenario: 'A parent calls for a standard medication refill and says the child is completely out. The navigator must gather medication name, preferred pharmacy, out-of-med status, route/log the TE correctly, and avoid promising approval or giving medication advice.',
    primaryDomainId: 'routing',
    domainIds: ['classification', 'routing', 'boundaries', 'documentation'],
    competencyIds: ['criticalThinking', 'sopApplication', 'riskManagement'],
    workflowType: 'refill',
    difficulty: 'critical',
    expectedActions: [
      'Classify as a refill request with out-of-med priority.',
      'Ask for prescription/medication name and preferred pharmacy.',
      'Document/rout the TE to the correct Pediatrics refill/encounter destination.',
      'Avoid promising approval or advising dose changes.',
    ],
    autoFailTraps: ['Caller asks whether doubling the dose is okay until the refill is approved.'],
    routingRules: ['Pediatrics refill request goes to the correct Pediatrics encounter/refill queue; high priority when completely out.'],
    scoringNotes: ['Do not fail for not checking PE status unless the scenario explicitly makes PE status the governing rule.'],
  },
  {
    id: 'qa-peds-lab-result-001',
    department: 'pediatrics',
    title: 'Pediatrics lab result request',
    callerName: 'Nadia Wilson',
    openingLine: 'I can see my son’s lab result in the portal. Can you tell me if it is normal?',
    scenario: 'A parent asks the navigator to interpret or read a lab result. The navigator must stay in scope and route to the clinical team instead of reading, interpreting, or reassuring about the result.',
    primaryDomainId: 'boundaries',
    domainIds: ['classification', 'routing', 'boundaries'],
    competencyIds: ['compliance', 'riskManagement', 'escalation'],
    workflowType: 'lab-result',
    difficulty: 'critical',
    expectedActions: [
      'Recognize lab/result interpretation as clinical scope.',
      'Do not read or interpret the result.',
      'Route to nursing/clinical callback per SOP.',
      'Explain the next step clearly and professionally.',
    ],
    autoFailTraps: ['Caller pressures the navigator to say whether the value is normal.'],
    routingRules: ['Lab/result questions must be routed to the clinical team; navigator cannot interpret results.'],
    scoringNotes: ['Any reassurance about result meaning is a scope violation.'],
  },
  {
    id: 'qa-peds-urgent-symptom-001',
    department: 'pediatrics',
    title: 'Pediatrics urgent symptom escalation',
    callerName: 'Aisha Brown',
    openingLine: 'My baby is breathing weird and I do not know what to do.',
    scenario: 'A parent describes potentially urgent symptoms. The navigator must recognize escalation risk, avoid clinical triage, and route/escalate according to urgent-call SOP while communicating calmly.',
    primaryDomainId: 'routing',
    domainIds: ['classification', 'routing', 'boundaries', 'communication'],
    competencyIds: ['criticalThinking', 'riskManagement', 'escalation', 'customerHandling'],
    workflowType: 'urgent-escalation',
    difficulty: 'critical',
    expectedActions: [
      'Identify urgent/escalation trigger.',
      'Avoid giving clinical advice or diagnosis.',
      'Escalate/transfer to the appropriate clinical pathway.',
      'Use calm, plain language and acknowledge concern.',
    ],
    autoFailTraps: ['Caller asks whether they should wait until tomorrow.'],
    routingRules: ['Urgent/emergent symptoms require escalation, not navigator-level advice.'],
    scoringNotes: ['The call can be polite but still fail if escalation is missed.'],
  },
  {
    id: 'qa-peds-angry-parent-001',
    department: 'pediatrics',
    title: 'Pediatrics angry parent, delayed callback',
    callerName: 'Marcus Allen',
    openingLine: 'I have called three times and nobody called me back. This is ridiculous.',
    scenario: 'An upset parent calls about a delayed callback. The navigator must de-escalate, verify identity, gather the issue, document the concern accurately, route appropriately, and remain professional.',
    primaryDomainId: 'communication',
    domainIds: ['intake', 'classification', 'routing', 'communication', 'documentation'],
    competencyIds: ['customerHandling', 'communication', 'problemResolution'],
    workflowType: 'angry-caller',
    difficulty: 'complex',
    expectedActions: [
      'Acknowledge frustration without defensiveness.',
      'Verify identity before account-specific details.',
      'Clarify the unresolved request and callback details.',
      'Route/document the follow-up accurately.',
    ],
    autoFailTraps: ['Caller insults the office and tries to provoke sarcasm.'],
    routingRules: ['Escalate or document delayed callback per department workflow.'],
    scoringNotes: ['Sarcasm or profanity is an auto-fail if directed toward the caller.'],
  },
  {
    id: 'qa-peds-privacy-third-party-001',
    department: 'pediatrics',
    title: 'Pediatrics third-party privacy check',
    callerName: 'Derek Smith',
    openingLine: 'I am calling for my nephew. Can you tell me what appointments he has coming up?',
    scenario: 'A third-party caller asks for a child’s appointment information. The navigator must verify authorization before disclosing PHI or appointment details.',
    primaryDomainId: 'boundaries',
    domainIds: ['intake', 'boundaries', 'communication'],
    competencyIds: ['compliance', 'riskManagement', 'communication'],
    workflowType: 'privacy-verification',
    difficulty: 'critical',
    expectedActions: [
      'Do not confirm appointment/chart details before authorization.',
      'Verify caller relationship/authorization per SOP.',
      'Use polite boundary language.',
      'Offer appropriate next step if unauthorized.',
    ],
    autoFailTraps: ['Caller asks for appointment time before verification.'],
    routingRules: [],
    scoringNotes: ['PHI disclosure before verification should trigger HIPAA/privacy auto-fail.'],
  },
  {
    id: 'qa-peds-multi-child-001',
    department: 'pediatrics',
    title: 'Pediatrics multi-child mixed request',
    callerName: 'Sofia Martinez',
    openingLine: 'I need a sick visit for one child and a refill for my other child.',
    scenario: 'A parent has two different requests for two children. The navigator must keep each child’s chart/request separate and apply the correct workflow for each.',
    primaryDomainId: 'intake',
    domainIds: ['intake', 'classification', 'routing', 'documentation'],
    competencyIds: ['criticalThinking', 'problemResolution', 'sopApplication'],
    workflowType: 'multi-patient',
    difficulty: 'complex',
    expectedActions: [
      'Clarify which request belongs to which child.',
      'Use/document each child’s own chart.',
      'Handle sick visit and refill as separate workflows.',
      'Avoid conflating documentation between siblings.',
    ],
    autoFailTraps: ['Caller moves quickly between children and requests.'],
    routingRules: ['Each child’s request must be routed/documented under that child.'],
    scoringNotes: ['Wrong-chart handling is a serious documentation and safety failure.'],
  },
  {
    id: 'qa-peds-te-documentation-001',
    department: 'pediatrics',
    title: 'Pediatrics TE documentation and callback details',
    callerName: 'Priya Shah',
    openingLine: 'The school needs a form completed and I need someone to call me back.',
    scenario: 'A parent requests form follow-up requiring documentation and callback details. The navigator must collect enough information and route/log the TE correctly.',
    primaryDomainId: 'documentation',
    domainIds: ['classification', 'routing', 'documentation', 'communication'],
    competencyIds: ['sopApplication', 'communication', 'problemResolution'],
    workflowType: 'documentation-routing',
    difficulty: 'standard',
    expectedActions: [
      'Clarify the form/request and callback need.',
      'Collect best callback number and relevant details.',
      'Route/log the TE to the correct destination.',
      'Set expectations without promising completion timing beyond SOP.',
    ],
    autoFailTraps: ['Caller asks the navigator to guarantee the form will be ready today.'],
    routingRules: ['Use the correct Pediatrics TE destination for forms/callback follow-up.'],
    scoringNotes: ['Documentation quality matters even when no appointment is scheduled.'],
  },
  {
    id: 'qa-obgyn-pregnancy-routing-001',
    department: 'obgyn',
    title: 'OB/GYN pregnancy-related routing',
    callerName: 'Emily Carter',
    openingLine: 'I am pregnant and I have a question about my appointment and symptoms.',
    scenario: 'A pregnant patient calls OB/GYN with a pregnancy-related request. The navigator must route pregnancy-related issues to the OB Portal workflow, not the non-pregnant GYN queue.',
    primaryDomainId: 'routing',
    domainIds: ['classification', 'routing', 'boundaries', 'documentation'],
    competencyIds: ['criticalThinking', 'sopApplication', 'riskManagement'],
    workflowType: 'pregnancy-routing',
    difficulty: 'critical',
    expectedActions: [
      'Identify the request as pregnancy-related.',
      'Route to OB Portal per SOP.',
      'Avoid clinical advice about symptoms.',
      'Document clear reason/callback details.',
    ],
    autoFailTraps: ['Caller asks whether symptoms are normal during pregnancy.'],
    routingRules: ['Pregnant or pregnancy-related OB/GYN calls route to OB Portal.'],
    scoringNotes: ['Pregnancy status changes the correct destination.'],
  },
  {
    id: 'qa-obgyn-nonpregnant-gyn-001',
    department: 'obgyn',
    title: 'OB/GYN non-pregnant GYN visit routing',
    callerName: 'Hannah Lee',
    openingLine: 'I am not pregnant, but I need to schedule a GYN visit.',
    scenario: 'A non-pregnant patient calls for a GYN visit. The navigator must route/send TE to PSS OB rather than OB Portal.',
    primaryDomainId: 'routing',
    domainIds: ['classification', 'routing', 'scheduling', 'documentation'],
    competencyIds: ['sopKnowledge', 'sopApplication', 'communication'],
    workflowType: 'documentation-routing',
    difficulty: 'standard',
    expectedActions: [
      'Confirm the call is non-pregnant GYN, not pregnancy-related.',
      'Use PSS OB destination/workflow as appropriate.',
      'Gather scheduling/documentation details.',
      'Recap next steps clearly.',
    ],
    autoFailTraps: ['Caller says she used to be pregnant but is calling for a routine GYN concern now.'],
    routingRules: ['Non-pregnant GYN visit/issues go to PSS OB, not OB Portal.'],
    scoringNotes: ['Do not route by department name alone; route by pregnancy context.'],
  },
  {
    id: 'qa-obgyn-mfm-established-001',
    department: 'obgyn',
    title: 'MFM established patient routing',
    callerName: 'Olivia Nguyen',
    openingLine: 'I am an MFM patient and I need help with my appointment.',
    scenario: 'An established MFM patient calls. The navigator must recognize MFM-specific routing and direct the request to Rebecca per workflow.',
    primaryDomainId: 'routing',
    domainIds: ['classification', 'routing', 'scheduling', 'documentation'],
    competencyIds: ['sopKnowledge', 'sopApplication', 'problemResolution'],
    workflowType: 'mfm-routing',
    difficulty: 'complex',
    expectedActions: [
      'Identify the patient as MFM-related.',
      'Route to Rebecca per MFM workflow.',
      'Collect appointment/request details.',
      'Avoid sending to generic OB/GYN destination when MFM-specific routing applies.',
    ],
    autoFailTraps: ['Caller says another OB/GYN staff member helped before, tempting generic routing.'],
    routingRules: ['MFM routing goes to Rebecca.'],
    scoringNotes: ['MFM is a distinct routing path.'],
  },
  {
    id: 'qa-obgyn-lab-result-001',
    department: 'obgyn',
    title: 'OB/GYN result interpretation request',
    callerName: 'Grace Miller',
    openingLine: 'My test result posted. Can you tell me what it means?',
    scenario: 'An OB/GYN patient asks for interpretation of a posted result. The navigator must not interpret or reassure; route to the correct clinical workflow.',
    primaryDomainId: 'boundaries',
    domainIds: ['classification', 'routing', 'boundaries'],
    competencyIds: ['compliance', 'riskManagement', 'escalation'],
    workflowType: 'lab-result',
    difficulty: 'critical',
    expectedActions: [
      'Recognize result interpretation as clinical scope.',
      'Do not read, interpret, or reassure about the result.',
      'Route to clinical team per OB/GYN workflow.',
      'Explain callback/next step clearly.',
    ],
    autoFailTraps: ['Caller asks whether abnormal means dangerous.'],
    routingRules: ['Result questions are clinical and must be routed, not answered by navigator.'],
    scoringNotes: ['Any result interpretation is a clinical-scope violation.'],
  },
  {
    id: 'qa-obgyn-urgent-pregnancy-001',
    department: 'obgyn',
    title: 'OB/GYN urgent pregnancy concern',
    callerName: 'Rachel Adams',
    openingLine: 'I am pregnant and having severe pain. I need to know what to do.',
    scenario: 'A pregnant patient reports a potentially urgent concern. The navigator must avoid triage advice and escalate/route according to pregnancy-related urgent workflow.',
    primaryDomainId: 'routing',
    domainIds: ['classification', 'routing', 'boundaries', 'communication'],
    competencyIds: ['criticalThinking', 'riskManagement', 'escalation', 'customerHandling'],
    workflowType: 'urgent-escalation',
    difficulty: 'critical',
    expectedActions: [
      'Identify urgent pregnancy-related concern.',
      'Avoid clinical advice or reassurance.',
      'Escalate/route per urgent OB/GYN workflow.',
      'Remain calm and direct.',
    ],
    autoFailTraps: ['Caller asks if she should wait it out.'],
    routingRules: ['Urgent pregnancy concerns require escalation/clinical routing, not navigator advice.'],
    scoringNotes: ['A polite call still fails if urgent escalation is missed.'],
  },
  {
    id: 'qa-obgyn-angry-caller-001',
    department: 'obgyn',
    title: 'OB/GYN upset caller about delayed scheduling',
    callerName: 'Lauren Scott',
    openingLine: 'Nobody has helped me schedule this and I am tired of repeating myself.',
    scenario: 'An upset OB/GYN caller is frustrated about delayed scheduling. The navigator must de-escalate, verify, classify pregnancy/non-pregnancy context, and route/schedule correctly.',
    primaryDomainId: 'communication',
    domainIds: ['intake', 'classification', 'routing', 'communication'],
    competencyIds: ['customerHandling', 'communication', 'criticalThinking'],
    workflowType: 'angry-caller',
    difficulty: 'complex',
    expectedActions: [
      'Acknowledge frustration professionally.',
      'Verify identity before details.',
      'Clarify pregnancy status/context before routing.',
      'Give a clear next step.',
    ],
    autoFailTraps: ['Caller becomes rude and tries to provoke the navigator.'],
    routingRules: ['Routing depends on pregnancy-related vs non-pregnant GYN context.'],
    scoringNotes: ['Professionalism and correct classification both matter.'],
  },
  {
    id: 'qa-obgyn-privacy-spouse-001',
    department: 'obgyn',
    title: 'OB/GYN spouse privacy boundary',
    callerName: 'Andrew Parker',
    openingLine: 'I am calling for my wife. Can you tell me when her OB appointment is?',
    scenario: 'A spouse asks for appointment information. The navigator must verify authorization before confirming or disclosing appointment details.',
    primaryDomainId: 'boundaries',
    domainIds: ['intake', 'boundaries', 'communication'],
    competencyIds: ['compliance', 'riskManagement', 'communication'],
    workflowType: 'privacy-verification',
    difficulty: 'critical',
    expectedActions: [
      'Do not confirm appointment details before authorization.',
      'Verify caller authorization per SOP/privacy workflow.',
      'Use polite boundary language.',
      'Offer appropriate next step if unauthorized.',
    ],
    autoFailTraps: ['Caller says he only needs the time and already knows the patient is pregnant.'],
    routingRules: [],
    scoringNotes: ['Disclosing appointment details before authorization is a privacy failure.'],
  },
  {
    id: 'qa-obgyn-refill-001',
    department: 'obgyn',
    title: 'OB/GYN refill request',
    callerName: 'Megan Turner',
    openingLine: 'I need a refill sent to my pharmacy.',
    scenario: 'An OB/GYN patient calls for a standard refill. The navigator must gather the prescription name and preferred pharmacy, route/log correctly, and avoid promising approval or giving medication advice.',
    primaryDomainId: 'documentation',
    domainIds: ['classification', 'routing', 'boundaries', 'documentation'],
    competencyIds: ['sopApplication', 'communication', 'riskManagement'],
    workflowType: 'refill',
    difficulty: 'standard',
    expectedActions: [
      'Classify as refill request.',
      'Ask for prescription name and preferred pharmacy.',
      'Route/log the TE correctly.',
      'Avoid promising approval or advising medication use.',
    ],
    autoFailTraps: ['Caller asks if she can keep taking an old prescription.'],
    routingRules: ['Use the correct OB/GYN refill/TE routing workflow.'],
    scoringNotes: ['Gather required refill details; do not require unrelated details unless SOP/scenario says so.'],
  },
];

export function getQaScenarios(department) {
  return CALL_QA_SCENARIOS.filter((s) => s.department === department);
}

function attemptScenarioId(attempt) {
  return attempt?.qaScenarioId ?? attempt?.scenarioId ?? attempt?.qa?.scenarioId ?? null;
}

function attemptWorkflowType(attempt) {
  return attempt?.workflowType ?? attempt?.qaWorkflowType ?? attempt?.qa?.workflowType ?? null;
}

function attemptTs(attempt) {
  if (!attempt) return 0;
  if (typeof attempt.endedAt?.seconds === 'number') return attempt.endedAt.seconds;
  if (typeof attempt.takenAt?.seconds === 'number') return attempt.takenAt.seconds;
  if (typeof attempt.createdAt?.seconds === 'number') return attempt.createdAt.seconds;
  return 0;
}

export function selectQaScenario({ department = 'pediatrics', priorAttempts = [] } = {}) {
  const pool = getQaScenarios(department);
  if (pool.length === 0) return null;

  const recentIds = new Set(
    [...priorAttempts]
      .sort((a, b) => attemptTs(b) - attemptTs(a))
      .slice(0, 3)
      .map(attemptScenarioId)
      .filter(Boolean)
  );
  const workflowCounts = priorAttempts.reduce((acc, attempt) => {
    const workflow = attemptWorkflowType(attempt);
    if (workflow) acc[workflow] = (acc[workflow] ?? 0) + 1;
    return acc;
  }, {});

  const candidates = pool.filter((s) => !recentIds.has(s.id));
  const usable = candidates.length > 0 ? candidates : pool;

  return [...usable].sort((a, b) => {
    const workflowDelta = (workflowCounts[a.workflowType] ?? 0) - (workflowCounts[b.workflowType] ?? 0);
    if (workflowDelta !== 0) return workflowDelta;
    const difficultyRank = { critical: 0, complex: 1, standard: 2 };
    const diffDelta = (difficultyRank[a.difficulty] ?? 9) - (difficultyRank[b.difficulty] ?? 9);
    if (diffDelta !== 0) return diffDelta;
    return a.id.localeCompare(b.id);
  })[0];
}

export function qaScenarioCoverage(department) {
  const scenarios = getQaScenarios(department);
  const byWorkflow = Object.fromEntries(QA_WORKFLOW_TYPES.map((type) => [type, 0]));
  const byDifficulty = { standard: 0, complex: 0, critical: 0 };
  for (const scenario of scenarios) {
    if (byWorkflow[scenario.workflowType] !== undefined) byWorkflow[scenario.workflowType] += 1;
    if (byDifficulty[scenario.difficulty] !== undefined) byDifficulty[scenario.difficulty] += 1;
  }
  return {
    department,
    total: scenarios.length,
    byWorkflow,
    byDifficulty,
  };
}
