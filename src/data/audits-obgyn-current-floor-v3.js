// Curated OB/GYN "Spot the Error" bank grounded in the owner-confirmed
// Women's Health Patient Navigator SOP v1.0, effective 2026-07-17.
//
// Every item expands to exactly ten alternating turns with one indexed Agent
// error. Shared call framing is centralized so authors review only the chart
// facts, plausible mistake, and correction that make each item challenging.
import {
  OBGYN_RULE_SET_VERSION,
  OBGYN_SOP_VERSION,
  OBGYN_SOURCE_AUTHORITY,
} from './obgynWorkflowRules.js';
import { OBGYN_CURRENT_FLOOR_BANK_VERSION } from './questions-obgyn-current-floor-v3.js';
import intake from './audits-obgyn-current-floor-v3-intake.js';
import classification from './audits-obgyn-current-floor-v3-classification.js';
import routing from './audits-obgyn-current-floor-v3-routing.js';
import scheduling from './audits-obgyn-current-floor-v3-scheduling.js';
import boundaries from './audits-obgyn-current-floor-v3-boundaries.js';
import documentation from './audits-obgyn-current-floor-v3-documentation.js';

const cases = [
  ...intake,
  ...classification,
  ...routing,
  ...scheduling,
  ...boundaries,
  ...documentation,
];

function buildAudit(item) {
  return Object.freeze({
    id: item.id,
    domainId: item.domainId,
    transcript: [
      { speaker: 'Agent', message: "Thank you for calling Aizer Health Women's Health. How may I help you?" },
      { speaker: 'Patient', message: item.opening },
      { speaker: 'Agent', message: 'I can help with the next step. Please confirm your full name and date of birth.' },
      { speaker: 'Patient', message: 'Yes, I can confirm both.' },
      { speaker: 'Agent', message: 'Thank you. I am reviewing the recent encounters, notes, and open messages now.' },
      { speaker: 'Patient', message: item.detail },
      { speaker: 'Agent', message: item.error },
      { speaker: 'Patient', message: 'Okay, I just want to make sure this is handled correctly.' },
      { speaker: 'Agent', message: 'I will summarize the next step before we finish the call.' },
      { speaker: 'Patient', message: 'All right, thank you.' },
    ],
    errorIndex: 6,
    hint: "Pay attention to the agent's workflow decision after reviewing the chart.",
    modelExplanation: item.modelExplanation,
    workflowType: item.workflowType,
    ruleIds: item.ruleIds,
    errorKind: 'workflow_error',
    expectedCorrection: item.expectedCorrection,
    requiredChartFacts: item.requiredChartFacts,
    difficulty: item.difficulty,
    department: 'obgyn',
    sourceSopVersion: OBGYN_SOP_VERSION,
    sourceRuleVersion: OBGYN_RULE_SET_VERSION,
    sourceAuthority: OBGYN_SOURCE_AUTHORITY,
  });
}

export { OBGYN_CURRENT_FLOOR_BANK_VERSION };
export const OBGYN_CURRENT_FLOOR_AUDITS = Object.freeze(cases.map(buildAudit));
