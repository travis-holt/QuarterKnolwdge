// Curated OB/GYN "Spot the Error" bank grounded in the owner-confirmed
// Women's Health Patient Navigator SOP v1.0, effective 2026-07-17.
//
// Every item expands to exactly ten alternating turns with one indexed Agent
// error. The greeting and safe call-handling language vary within a controlled
// set, while each case supplies its own patient context, plausible mistake,
// and scenario-specific follow-up.
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

export const OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION =
  'obgyn-current-floor-audit-bank-v4-challenging-calls-2026-07-19';

const cases = [
  ...intake,
  ...classification,
  ...routing,
  ...scheduling,
  ...boundaries,
  ...documentation,
];

const GREETINGS = Object.freeze([
  'Hi, thank you for calling Aizer Womens Health Department. How can I help?',
  'Hello, thank you for calling Aizer Womens Health. How can I help you?',
]);

const VERIFICATION_PROMPTS = Object.freeze([
  'May I verify the account details with you?',
  'Please confirm the account details with me.',
  'Can we verify the account details together?',
  'May I confirm the account details with you?',
  'Please verify the account information with me.',
]);

const VERIFICATION_REPLIES = Object.freeze([
  'Yes, I can verify both.',
  'Sure, I have those ready.',
  'Yes, the information matches my account.',
  'Of course, I can confirm that.',
  'Yes, I can give you both now.',
]);

const CHART_OPENERS = Object.freeze([
  'Thank you. Let me open your chart so I can review the full picture.',
  'Thanks. Let me open your chart and look at this with you.',
  'Thank you. Let me open your chart before we decide the next step.',
  'All right. Let me open your chart so I can review this accurately.',
  'Thanks for confirming. Let me open your chart and review the details.',
]);

const WRAP_UPS = Object.freeze([
  'I will document everything we discussed and explain the next step clearly before we finish.',
  'I will record all the request details and tell you what to expect after this call.',
  'Let me finish documenting all these details, then I will review the next step with you.',
  'I will note every detail we discussed and confirm what should happen after this call.',
  'Before we finish, I will document the full request and explain the expected follow-up.',
]);

const CLOSING_REPLIES = Object.freeze([
  'Okay, I appreciate you explaining it.',
  'That is fine; I just want the correct next step.',
  'All right, please let me know what happens next.',
  'Thank you; I want to make sure nothing gets missed.',
  'Okay, I will listen for the next step.',
]);

function buildAudit(item, index) {
  return Object.freeze({
    id: item.id,
    domainId: item.domainId,
    transcript: [
      { speaker: 'Agent', message: GREETINGS[index % GREETINGS.length] },
      { speaker: 'Patient', message: item.opening },
      { speaker: 'Agent', message: VERIFICATION_PROMPTS[index % VERIFICATION_PROMPTS.length] },
      { speaker: 'Patient', message: VERIFICATION_REPLIES[index % VERIFICATION_REPLIES.length] },
      { speaker: 'Agent', message: CHART_OPENERS[index % CHART_OPENERS.length] },
      { speaker: 'Patient', message: item.detail },
      { speaker: 'Agent', message: item.error },
      { speaker: 'Patient', message: item.followUp },
      { speaker: 'Agent', message: WRAP_UPS[index % WRAP_UPS.length] },
      { speaker: 'Patient', message: CLOSING_REPLIES[index % CLOSING_REPLIES.length] },
    ],
    errorIndex: 6,
    hint: 'One Agent line takes a plausible but incorrect next step. Compare each decision with the chart facts.',
    modelExplanation: item.modelExplanation,
    workflowType: item.workflowType,
    ruleIds: item.ruleIds,
    errorKind: 'workflow_error',
    expectedCorrection: item.expectedCorrection,
    requiredChartFacts: item.requiredChartFacts,
    difficulty: item.difficulty,
    bankVersion: OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION,
    department: 'obgyn',
    sourceSopVersion: OBGYN_SOP_VERSION,
    sourceRuleVersion: OBGYN_RULE_SET_VERSION,
    sourceAuthority: OBGYN_SOURCE_AUTHORITY,
  });
}

export { OBGYN_CURRENT_FLOOR_BANK_VERSION };
export const OBGYN_CURRENT_FLOOR_AUDITS = Object.freeze(cases.map(buildAudit));
