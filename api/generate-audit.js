// ─────────────────────────────────────────────────────────────────────────────
// POST /api/generate-audit — Gemini generates a flawed agent transcript for
// the "Spot the Error" QA training exercise.
//
// Returns a realistic ~10-message chat between a patient and a contact-centre
// agent who makes exactly ONE SOP violation. The error index, a subtle hint,
// and the full model explanation are included so the frontend can validate
// navigator clicks and reveal the correct answer after they reflect.
//
// Same key rotation and passcode gate as other handlers. Advisory only.
// ─────────────────────────────────────────────────────────────────────────────

import { DOMAINS } from '../src/data/questions.js';
import { auditRuleIdsFor, workflowOptionsFor } from '../src/data/auditWorkflows.js';
import { validateAuditContent } from '../src/lib/contentGuards.js';
import { sopContextFor, sopGroundingForFresh } from './_sop-context.js';
import {
  OBGYN_RULE_SET_VERSION,
  formatObgynRulesForPrompt,
  obgynRulesFor,
} from '../src/data/obgynWorkflowRules.js';
import { navigatorContextBlock } from './_navigator-operating-model.js';
import { getApiKeys, geminiWithRotation, rotationFailure, MODEL, STABLE_MODEL } from './_gemini-client.js';
import { validateSecret } from './_auth.js';

const AUDIT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          speaker:  { type: 'STRING' },
          message:  { type: 'STRING' },
        },
        required: ['speaker', 'message'],
      },
    },
    errorIndex:       { type: 'INTEGER' },
    hint:             { type: 'STRING' },
    modelExplanation: { type: 'STRING' },
    workflowType:     { type: 'STRING' },
    ruleIds:           { type: 'ARRAY', items: { type: 'STRING' } },
    errorKind:        { type: 'STRING' },
    expectedCorrection: { type: 'STRING' },
    requiredChartFacts: { type: 'ARRAY', items: { type: 'STRING' } },
    difficulty:       { type: 'STRING' },
  },
  required: ['transcript', 'errorIndex', 'hint', 'modelExplanation', 'workflowType', 'ruleIds', 'errorKind', 'expectedCorrection', 'requiredChartFacts', 'difficulty'],
};

export function buildPrompt(domain, department, workflowType, avoidWorkflowTypes = [], sopContext = sopContextFor(department), rules = []) {
  const allowedWorkflows = workflowOptionsFor(domain.id, department);
  const ruleBlock = rules.length ? formatObgynRulesForPrompt(rules) : 'No department-specific structured rules are available.';
  return `You are creating a QA training exercise for contact-centre patient navigators.

Generate a realistic 10-message chat transcript between a patient (or caregiver) and a contact-centre agent. The agent makes exactly ONE critical policy mistake that violates the SOP for the domain below.

${navigatorContextBlock({ department, mode: 'audit-generation' })}

Domain: "${domain.name}" — ${domain.blurb}
Required workflow type: "${workflowType}"
Allowed workflow types for this domain: ${allowedWorkflows.join(', ') || workflowType}
Avoid these overused workflow types in this response: ${avoidWorkflowTypes.join(', ') || 'none'}

SELECTED EXECUTABLE RULES:
${ruleBlock}

TRANSCRIPT RULES:
- Use exactly "Agent" and "Patient" as the speaker labels (exact casing, nothing else)
- The Agent speaks first (with a professional greeting)
- Alternate naturally: Agent, Patient, Agent, Patient… for 10 turns total
- Plant exactly ONE clear SOP violation in ONE Agent message (must be an Agent turn, not Patient)
- The planted error must be an explicit action or statement that deterministically contradicts a selected rule; do not make the sole error an unobservable omission
- All other Agent messages must be correct per SOP
- Everything in English only

REALISM RULES (the transcript must read like a real recorded call, not a training script):
- The call must be a SPECIFIC, ORDINARY request a real caller would have (an appointment for a
  named reason, a refill, a lab result, a referral question) — grounded in the SOP's actual visit
  types, queues, timing rules, and routing rules. Never a generic "I have a question" call.
- The caller talks like a real person on the phone: short sentences, occasional imprecision
  ("sometime this week?", "I think it was last month"), answers only what was asked.
- The Agent follows the real call shape from the SOP: identify the correct patient/chart safely
  for the department context, classify the request, then act/route/schedule/escalate — with
  realistic small confirmations ("one moment while I pull that up") — then document and close.
- The planted error must be PLAUSIBLE — the kind of mistake a rushed but competent agent actually
  makes (wrong queue, skipped verification step, promising something the SOP forbids, wrong
  timing rule), NOT cartoonish rudeness or an obviously absurd statement.
- The error should require careful reading to spot; correct Agent turns should include near-miss
  moments that a careless reader might wrongly suspect.
- Never include markdown, stage directions, or bracketed narration — spoken words only.

VARIETY RULES:
- The transcript MUST match the required workflow type.
- Do not default to medication refills.
- Do not generate another refill scenario unless the required workflow type is explicitly refill-related.
- Do not make lookup order itself the planted error. If phone number or DOB appears, the real
  issue must be correct chart, correct patient, caller authorization, privacy, or sibling safety.

REFILL RULE:
- For standard refill scenarios, the planted error must NOT be "the agent failed to verify PE status."
- Do not say refills cannot be processed when PE is not current.
- Valid refill errors include wrong queue, missing medication name, missing preferred pharmacy,
  not marking high priority when the patient is completely out, promising provider approval,
  or giving clinical / medication advice.

FOR errorIndex: return the 0-based index of the message array where the Agent's error appears (always an even-indexed turn: 0, 2, 4, 6, or 8).

FOR hint: write one sentence that steers the navigator toward the error without giving it away (e.g. "Pay close attention to how the agent handled the insurance verification step.").

FOR modelExplanation: write 2–3 sentences explaining exactly what the agent did wrong and what they should have said instead. Reference the specific SOP rule violated using facts from the SOP reference below.

FOR workflowType: return exactly "${workflowType}".
FOR ruleIds: return the exact selected rule id or ids tested: ${rules.map((rule) => rule.id).join(', ') || 'none'}.
FOR errorKind: return a short snake_case label for the policy miss (examples: wrong_queue, privacy_breach, promise_approval, wrong_child_chart).
FOR expectedCorrection: state the concrete corrected Agent action.
FOR requiredChartFacts: list the chart facts needed to decide this workflow; use an empty array only when no chart fact applies.
FOR difficulty: return one of easy, medium, hard.

SOP REFERENCE:
${sopContext}`;
}

/**
 * Validate and sanitise a raw Gemini audit response.
 * Pure — no I/O. Returns { data } on success, { error } on failure.
 * @param {any} parsed  The result of JSON.parse(gemini response text)
 */
export function validateAuditResponse(parsed, requestedWorkflowType = null, context = {}) {
  const { transcript, errorIndex, hint, modelExplanation, workflowType, ruleIds, errorKind, expectedCorrection, requiredChartFacts, difficulty } = parsed ?? {};
  if (!Array.isArray(transcript) || transcript.length !== 10)
    return { error: 'Gemini must return exactly 10 transcript turns.' };
  if (typeof errorIndex !== 'number' || errorIndex < 0 || errorIndex >= transcript.length)
    return { error: 'Gemini returned an invalid error index.' };

  const cleanTranscript = transcript.map((turn) => ({
    speaker: String(turn?.speaker ?? '').trim(),
    message: String(turn?.message ?? '').trim(),
  }));
  if (cleanTranscript[errorIndex]?.speaker !== 'Agent') return { error: 'The indexed error must be on an Agent turn.' };
  if (cleanTranscript.some((turn, index) => turn.speaker !== (index % 2 === 0 ? 'Agent' : 'Patient'))) {
    return { error: 'Transcript must alternate Agent and Patient turns.' };
  }
  if (!hint || !modelExplanation)
    return { error: 'Gemini returned an incomplete audit response.' };
  if (!expectedCorrection || !Array.isArray(requiredChartFacts))
    return { error: 'Gemini returned incomplete correction or chart-fact metadata.' };

  const cleanRuleIds = [...new Set(Array.isArray(ruleIds) ? ruleIds.map((id) => String(id).trim()).filter(Boolean) : [])];
  if (context.department === 'obgyn') {
    const allowed = new Set(context.ruleIds ?? []);
    if (!cleanRuleIds.length || cleanRuleIds.some((id) => !allowed.has(id))) {
      return { error: 'Gemini returned unknown or unselected OB/GYN rule ids.' };
    }
  }

  return {
    data: {
      transcript: cleanTranscript,
      errorIndex,
      hint:             String(hint).trim(),
      modelExplanation: String(modelExplanation).trim(),
      workflowType:     String(requestedWorkflowType ?? workflowType ?? '').trim(),
      ruleIds:           cleanRuleIds,
      errorKind:        String(errorKind ?? '').trim() || 'workflow_error',
      expectedCorrection: String(expectedCorrection).trim(),
      requiredChartFacts: requiredChartFacts.map((fact) => String(fact ?? '').trim()).filter(Boolean),
      difficulty:       ['easy', 'medium', 'hard'].includes(String(difficulty ?? '').trim().toLowerCase())
        ? String(difficulty).trim().toLowerCase()
        : 'medium',
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (await validateSecret(req, res)) return;

  const keys = getApiKeys();
  if (!keys.length) return res.status(500).json({ error: 'Gemini not configured on the server.' });

  const { domain: domainId, department = 'pediatrics', workflowType, ruleIds = [], avoidWorkflowTypes = [] } = req.body ?? {};

  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) return res.status(400).json({ error: 'Unknown domain.' });
  const requestedWorkflowType = workflowType || workflowOptionsFor(domainId, department)[0] || 'general_workflow';
  const requestedRuleIds = Array.isArray(ruleIds) && ruleIds.length ? ruleIds.map(String) : auditRuleIdsFor(requestedWorkflowType, department);
  const selectedRules = obgynRulesFor({ department, ruleIds: requestedRuleIds });
  if (department === 'obgyn' && (!selectedRules.length || selectedRules.length !== new Set(requestedRuleIds).size)) {
    return res.status(400).json({ error: 'Unknown or missing OB/GYN audit rule id.' });
  }
  const grounding = await sopGroundingForFresh(department);

  const body = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(domain, department, requestedWorkflowType, avoidWorkflowTypes, grounding.context, selectedRules) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: AUDIT_SCHEMA,
      temperature: 0.8,
    },
  };

  const result = await geminiWithRotation(keys, body, { label: 'generate-audit', models: [MODEL, STABLE_MODEL] });
  if (!result.ok) {
    const { status, error } = rotationFailure(result, { fatal: 'Gemini returned an error generating the audit transcript.' });
    return res.status(status).json({ error });
  }

  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return res.status(502).json({ error: 'Gemini returned invalid JSON.' });
  }

  const validation = validateAuditResponse(parsed, requestedWorkflowType, { department, ruleIds: selectedRules.map((rule) => rule.id) });
  if (validation.error) return res.status(502).json({ error: validation.error });
  validation.data.department = department;
  validation.data.sourceSopVersion = grounding.sourceSopVersion;
  validation.data.sourceRuleVersion = department === 'obgyn' ? OBGYN_RULE_SET_VERSION : null;
  validation.data.sourceAuthority = grounding.sourceAuthority;
  const flags = validateAuditContent(validation.data);
  if (flags.length) return res.status(422).json({ error: flags[0].message });

  return res.status(200).json(validation.data);
}
