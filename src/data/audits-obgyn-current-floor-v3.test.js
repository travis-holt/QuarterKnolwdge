import { describe, expect, it } from 'vitest';
import {
  OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION,
  OBGYN_CURRENT_FLOOR_AUDITS,
} from './audits-obgyn-current-floor-v3.js';
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
const ALLOWED_GREETINGS = new Set([
  'Hi, thank you for calling Aizer Womens Health Department. How can I help?',
  'Hello, thank you for calling Aizer Womens Health. How can I help you?',
]);

function wordCount(text) {
  return text.trim().split(/\s+/).length;
}

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

  it('does not reveal the error through a longer Agent turn', () => {
    for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
      const errorWords = wordCount(audit.transcript[audit.errorIndex].message);
      const longestOtherAgentTurn = Math.max(
        ...audit.transcript
          .filter((turn, index) => turn.speaker === 'Agent' && index !== audit.errorIndex)
          .map((turn) => wordCount(turn.message)),
      );
      expect(errorWords, audit.id).toBeLessThanOrEqual(longestOtherAgentTurn);
    }
  });

  it('uses the approved greetings and whole-chart language without system-by-system narration', () => {
    for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
      expect(ALLOWED_GREETINGS.has(audit.transcript[0].message), audit.id).toBe(true);
      expect(audit.transcript[4].message).toMatch(/let me open your chart/i);
      const agentSpeech = audit.transcript
        .filter((turn) => turn.speaker === 'Agent')
        .map((turn) => turn.message)
        .join('\n');
      expect(agentSpeech).not.toMatch(
        /\b(?:check(?:ing)?|review(?:ing)?)\b.{0,50}\b(?:encounters|messages|visits|rx logs)\b/i,
      );
    }
    expect(new Set(OBGYN_CURRENT_FLOOR_AUDITS.map((audit) => audit.transcript[0].message)))
      .toEqual(ALLOWED_GREETINGS);
  });

  it('keeps every case hard, multi-fact, and scenario-specific after the shared framing', () => {
    const patientFollowUps = OBGYN_CURRENT_FLOOR_AUDITS.map((audit) => audit.transcript[7].message);
    expect(new Set(patientFollowUps)).toHaveLength(30);
    for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
      expect(audit.difficulty, audit.id).toBe('hard');
      expect(audit.requiredChartFacts.length, audit.id).toBeGreaterThanOrEqual(2);
      expect(wordCount(audit.transcript[1].message), audit.id).toBeGreaterThanOrEqual(12);
      expect(wordCount(audit.transcript[5].message), audit.id).toBeGreaterThanOrEqual(12);
      expect(wordCount(audit.transcript[7].message), audit.id).toBeGreaterThanOrEqual(12);
      expect(audit.bankVersion).toBe(OBGYN_CURRENT_FLOOR_AUDIT_BANK_VERSION);
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
      expect(flags.filter((flag) => flag.code === 'audit_error_not_deterministic'), audit.id).toEqual([]);
      expect(flags.filter((flag) => flag.code === 'audit_multiple_agent_errors'), audit.id).toEqual([]);
      expect(hasBlockingFlags(flags), `${audit.id}: ${JSON.stringify(flags)}`).toBe(false);
    }
  });

  it('contains no stale PSS OB routing or correct-path independent L&D direction', () => {
    const text = JSON.stringify(OBGYN_CURRENT_FLOOR_AUDITS);
    expect(text).not.toMatch(/\bPSS OB\b/i);
    expect(text).not.toMatch(/\bPSS Queue\b/i);
    expect(text).not.toMatch(/agent should (?:send|direct).{0,40}(?:Labor and Delivery|L&D)/i);
  });
});
