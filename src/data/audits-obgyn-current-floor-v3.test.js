import { describe, expect, it } from 'vitest';
import { OBGYN_CURRENT_FLOOR_AUDITS } from './audits-obgyn-current-floor-v3.js';
import { OBGYN_AUDIT_WORKFLOWS, auditRuleIdsFor } from './auditWorkflows.js';
import {
  OBGYN_RULE_SET_VERSION,
  OBGYN_SOP_VERSION,
  OBGYN_SOURCE_AUTHORITY,
  getObgynWorkflowRule,
} from './obgynWorkflowRules.js';
import { hasBlockingFlags, validateAuditContent } from '../lib/contentGuards.js';

const DOMAINS = ['intake', 'classification', 'routing', 'scheduling', 'boundaries', 'documentation'];
const EXPECTED_WORKFLOWS = [...new Set(Object.values(OBGYN_AUDIT_WORKFLOWS).flat())].sort();

describe('OB/GYN current-floor Spot-the-Error bank v3', () => {
  it('contains 30 difficult items balanced five per domain and covers all 14 workflows', () => {
    expect(OBGYN_CURRENT_FLOOR_AUDITS).toHaveLength(30);
    expect(new Set(OBGYN_CURRENT_FLOOR_AUDITS.map((item) => item.id)).size).toBe(30);
    for (const domainId of DOMAINS) {
      expect(OBGYN_CURRENT_FLOOR_AUDITS.filter((item) => item.domainId === domainId)).toHaveLength(5);
    }
    expect([...new Set(OBGYN_CURRENT_FLOOR_AUDITS.map((item) => item.workflowType))].sort())
      .toEqual(EXPECTED_WORKFLOWS);
  });

  it('keeps the strict ten-turn, alternating, exactly-one-indexed-Agent-error contract', () => {
    for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
      expect(audit.transcript).toHaveLength(10);
      audit.transcript.forEach((turn, index) => {
        expect(turn.speaker).toBe(index % 2 === 0 ? 'Agent' : 'Patient');
        expect(turn.message.trim()).not.toBe('');
      });
      expect(audit.errorIndex).toBeGreaterThanOrEqual(0);
      expect(audit.errorIndex).toBeLessThan(10);
      expect(audit.errorIndex % 2).toBe(0);
      expect(audit.transcript[audit.errorIndex].speaker).toBe('Agent');
      expect(audit.expectedCorrection.trim().length).toBeGreaterThan(25);
      expect(audit.requiredChartFacts.length).toBeGreaterThan(0);
      expect(['medium', 'hard']).toContain(audit.difficulty);
    }
  });

  it('pins current provenance and valid workflow-to-rule mappings', () => {
    for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
      expect(audit.department).toBe('obgyn');
      expect(audit.sourceSopVersion).toBe(OBGYN_SOP_VERSION);
      expect(audit.sourceRuleVersion).toBe(OBGYN_RULE_SET_VERSION);
      expect(audit.sourceAuthority).toBe(OBGYN_SOURCE_AUTHORITY);
      const allowed = new Set(auditRuleIdsFor(audit.workflowType, 'obgyn'));
      expect(audit.ruleIds.length).toBeGreaterThan(0);
      for (const ruleId of audit.ruleIds) {
        expect(getObgynWorkflowRule(ruleId)).toBeTruthy();
        expect(allowed.has(ruleId)).toBe(true);
      }
    }
  });

  it('passes deterministic content guards with one contextual error and no second Agent error', () => {
    for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
      const flags = validateAuditContent(audit);
      expect(flags.filter((flag) => flag.code === 'audit_error_not_deterministic')).toEqual([]);
      expect(flags.filter((flag) => flag.code === 'audit_multiple_agent_errors')).toEqual([]);
      expect(hasBlockingFlags(flags)).toBe(false);
    }
  });

  it('contains no stale PSS OB routing or correct-path independent L&D direction', () => {
    const text = JSON.stringify(OBGYN_CURRENT_FLOOR_AUDITS);
    expect(text).not.toMatch(/\bPSS OB\b/i);
    expect(text).not.toMatch(/\bPSS Queue\b/i);
    expect(text).not.toMatch(/agent should (?:send|direct).{0,40}(?:Labor and Delivery|L&D)/i);
  });
});
