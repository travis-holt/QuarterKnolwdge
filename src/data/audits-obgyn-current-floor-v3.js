// Curated OB/GYN "Spot the Error" bank grounded in the owner-confirmed
// Women's Health Patient Navigator SOP v1.0, effective 2026-07-17.
//
// Every item is authored as a complete ten-turn call in its domain file. This
// module adds only shared provenance; it deliberately does not construct or
// interpolate transcript turns.
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
  'obgyn-current-floor-audit-bank-v5-individually-authored-2026-07-19';

const cases = [
  ...intake,
  ...classification,
  ...routing,
  ...scheduling,
  ...boundaries,
  ...documentation,
];

export { OBGYN_CURRENT_FLOOR_BANK_VERSION };
export const OBGYN_CURRENT_FLOOR_AUDITS = Object.freeze(cases.map((item) => Object.freeze({
  ...item,
  hint: 'One Agent decision is a plausible near-miss. Compare each operational choice with the chart facts.',
  errorKind: 'workflow_error',
  bankVersion: OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION,
  department: 'obgyn',
  sourceSopVersion: OBGYN_SOP_VERSION,
  sourceRuleVersion: OBGYN_RULE_SET_VERSION,
  sourceAuthority: OBGYN_SOURCE_AUTHORITY,
})));
