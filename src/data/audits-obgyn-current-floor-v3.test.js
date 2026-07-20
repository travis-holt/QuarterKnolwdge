import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

const GENERIC_WRAP_UP = /\b(?:document everything|record all|finish documenting|note every detail|before we finish|explain the next step|tell you what to expect)\b/i;
const ANSWER_REVEAL = /\b(?:I thought|I was told|I assumed|supposed to|required|shouldn['’]t|doesn['’]t that|isn['’]t that)\b/i;
const SUBSTANTIVE_ACTION = /\b(?:open your chart|schedule|book|route|send|update|take action|mark|confirm|move|keep|offer|document|message|hold|cancel|attach|check|search|compare|reserve|request|escalate|verify receipt|waiting list)\b/i;
const REJECTED_V4_POST_ERROR_LINES = new Set([
  'That Pap visit was only for the test; the provider did not perform my annual.',
  'I was not sure because that appointment focused only on recovery after delivery.',
  'Will that guessed date decide which ultrasound and provider times you choose for me?',
  'I thought knowing the exact date might let us plan the first full pregnancy visit.',
  'The nurse never told me how far along I might be or which visit I needed.',
  'The outside office sent the note, but I have not had an annual with your team recently.',
  'The app is only estimating; I cannot say which bleeding episode was a real period.',
  'I may have misunderstood whether the provider said it was definite or only a possibility.',
  'I can come tomorrow, but nobody from the clinical team has given me a new time.',
  'There is no uncertainty about the date; I was calling to plan the first complete visit.',
  'I only need the pharmacy corrected; the medication request itself is exactly the same.',
  'I was previously told his annual and fertility appointments might use a separate request process.',
  'I only need the MFM visit changed; my regular OB appointments should stay where they are.',
  'That nurse note was for my earlier visit, not for the pain I am reporting today.',
  'Both visits would still happen this week, which is why I wondered whether splitting them was allowed.',
  'I can attend both times, but I was unsure whether the scan or insertion should happen first.',
  'The chart lists them together, but keeping the provider time would be much easier for me.',
  'I can wait if necessary, but I thought the two appointments were supposed to connect directly.',
  'The old note told me to call; it did not say I could choose an urgent appointment myself.',
  'The previous approval was for a different episode, though the pain feels similar today.',
  'I assumed the active order might be enough, but nobody has offered another lab time yet.',
  'It is the same pain, just worse; I do not want the new details separated from the first message.',
  'The note only says the provider may consider it; it does not give me an appointment timeframe.',
  'The sequence looks right, but I cannot tell whether the second record is marked as part of the pair.',
  'The old pharmacy closed, so the request would need to go somewhere different this time.',
  'I do not want the request routed to the wrong person just because I cannot remember the name.',
]);

describe('OB/GYN current-floor Spot-the-Error bank v5', () => {
  it('keeps complete transcripts in the domain files with no shared transcript builder', () => {
    const rootSource = readFileSync(new URL('./audits-obgyn-current-floor-v3.js', import.meta.url), 'utf8');
    expect(rootSource).not.toMatch(/\bbuildAudit\b|const\s+(?:GREETINGS|VERIFICATION_PROMPTS|WRAP_UPS)\b/);
    for (const domainId of DOMAINS) {
      const domainSource = readFileSync(
        new URL(`./audits-obgyn-current-floor-v3-${domainId}.js`, import.meta.url),
        'utf8',
      );
      expect(domainSource.match(/\btranscript:\s*\[/g), domainId).toHaveLength(5);
    }
  });
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

  it('distributes errors across realistic decision points instead of one fixed turn', () => {
    const counts = new Map();
    for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
      expect([2, 4, 6, 8], audit.id).toContain(audit.errorIndex);
      counts.set(audit.errorIndex, (counts.get(audit.errorIndex) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThanOrEqual(3);
    for (const count of counts.values()) expect(count).toBeLessThanOrEqual(12);
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

  it('uses the approved greetings and varied whole-chart language without system-by-system narration', () => {
    const chartOpeningIndices = new Set();
    for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
      expect(ALLOWED_GREETINGS.has(audit.transcript[0].message), audit.id).toBe(true);
      const chartIndex = audit.transcript.findIndex((turn) => /let me open your chart/i.test(turn.message));
      expect(chartIndex, audit.id).toBeGreaterThan(0);
      chartOpeningIndices.add(chartIndex);
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
    expect(chartOpeningIndices.size).toBeGreaterThanOrEqual(3);
  });

  it('has no repeated non-greeting Agent script or generic closing skeleton', () => {
    const nonGreetingAgentMessages = OBGYN_CURRENT_FLOOR_AUDITS.flatMap((audit) => (
      audit.transcript.filter((turn, index) => turn.speaker === 'Agent' && index > 0).map((turn) => turn.message)
    ));
    expect(new Set(nonGreetingAgentMessages)).toHaveLength(nonGreetingAgentMessages.length);
    const finalAgentMessages = OBGYN_CURRENT_FLOOR_AUDITS.map((audit) => audit.transcript[8].message);
    expect(new Set(finalAgentMessages)).toHaveLength(30);
    finalAgentMessages.forEach((message) => expect(message).not.toMatch(GENERIC_WRAP_UP));
  });

  it('requires human-reviewed subtle traps whose next Patient turn does not reveal the answer', () => {
    for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
      expect(audit.contentReview?.manuallyReviewedWithoutHighlight, audit.id).toBe(true);
      expect(audit.contentReview?.patientDoesNotReveal, audit.id).toBe(true);
      expect(audit.contentReview?.subtleTrap?.trim().length, audit.id).toBeGreaterThan(15);
      expect(audit.contentReview?.correctDistractorDecisions, audit.id).toHaveLength(2);
      const nextPatientTurn = audit.transcript[audit.errorIndex + 1];
      expect(nextPatientTurn?.speaker, audit.id).toBe('Patient');
      expect(nextPatientTurn?.message, audit.id).not.toMatch(ANSWER_REVEAL);
      expect(REJECTED_V4_POST_ERROR_LINES.has(nextPatientTurn?.message), audit.id).toBe(false);
    }
  });

  it('makes at least three post-greeting Agent turns plausible operational decisions', () => {
    for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
      const substantiveTurns = audit.transcript.filter((turn, index) => (
        turn.speaker === 'Agent' && index > 0 && SUBSTANTIVE_ACTION.test(turn.message)
      ));
      expect(substantiveTurns.length, audit.id).toBeGreaterThanOrEqual(3);
      expect(audit.contentReview?.correctDistractorDecisions.every(({ index }) => (
        [2, 4, 6, 8].includes(index) && index !== audit.errorIndex
      )), audit.id).toBe(true);
    }
  });

  it('keeps every case multi-fact and scenario-specific without using a difficulty label as proof', () => {
    for (const audit of OBGYN_CURRENT_FLOOR_AUDITS) {
      expect(audit.requiredChartFacts.length, audit.id).toBeGreaterThanOrEqual(2);
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
