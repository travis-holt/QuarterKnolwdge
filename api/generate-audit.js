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
import { workflowOptionsFor } from '../src/data/auditWorkflows.js';
import { validateAuditContent } from '../src/lib/contentGuards.js';
import { sopContextFor, sopContextForFresh } from './_sop-context.js';
import { getApiKeys, geminiWithRotation, rotationFailure } from './_gemini-client.js';
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
    errorKind:        { type: 'STRING' },
    difficulty:       { type: 'STRING' },
  },
  required: ['transcript', 'errorIndex', 'hint', 'modelExplanation', 'workflowType', 'errorKind', 'difficulty'],
};

function buildPrompt(domain, department, workflowType, avoidWorkflowTypes = [], sopContext = sopContextFor(department)) {
  const allowedWorkflows = workflowOptionsFor(domain.id);
  return `You are creating a QA training exercise for contact-centre patient navigators.

Generate a realistic 10-message chat transcript between a patient (or caregiver) and a contact-centre agent. The agent makes exactly ONE critical policy mistake that violates the SOP for the domain below.

Domain: "${domain.name}" — ${domain.blurb}
Required workflow type: "${workflowType}"
Allowed workflow types for this domain: ${allowedWorkflows.join(', ') || workflowType}
Avoid these overused workflow types in this response: ${avoidWorkflowTypes.join(', ') || 'none'}

TRANSCRIPT RULES:
- Use exactly "Agent" and "Patient" as the speaker labels (exact casing, nothing else)
- The Agent speaks first (with a professional greeting)
- Alternate naturally: Agent, Patient, Agent, Patient… for 10 turns total
- Plant exactly ONE clear SOP violation in ONE Agent message (must be an Agent turn, not Patient)
- All other Agent messages must be correct per SOP
- Everything in English only

REALISM RULES (the transcript must read like a real recorded call, not a training script):
- The call must be a SPECIFIC, ORDINARY request a real caller would have (an appointment for a
  named reason, a refill, a lab result, a referral question) — grounded in the SOP's actual visit
  types, queues, timing rules, and routing rules. Never a generic "I have a question" call.
- The caller talks like a real person on the phone: short sentences, occasional imprecision
  ("sometime this week?", "I think it was last month"), answers only what was asked.
- The Agent follows the real call shape from the SOP: identify the patient (correct lookup order
  for the department), classify the request, then act — with realistic small confirmations
  ("one moment while I pull that up").
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
FOR errorKind: return a short snake_case label for the policy miss (examples: wrong_queue, privacy_breach, promise_approval, wrong_child_chart).
FOR difficulty: return one of easy, medium, hard.

SOP REFERENCE:
${sopContext}`;
}

/**
 * Validate and sanitise a raw Gemini audit response.
 * Pure — no I/O. Returns { data } on success, { error } on failure.
 * @param {any} parsed  The result of JSON.parse(gemini response text)
 */
export function validateAuditResponse(parsed, requestedWorkflowType = null) {
  const { transcript, errorIndex, hint, modelExplanation, workflowType, errorKind, difficulty } = parsed ?? {};
  if (!Array.isArray(transcript) || transcript.length < 4)
    return { error: 'Gemini returned an incomplete transcript.' };
  if (typeof errorIndex !== 'number' || errorIndex < 0 || errorIndex >= transcript.length)
    return { error: 'Gemini returned an invalid error index.' };

  let resolvedIndex = errorIndex;
  if (transcript[resolvedIndex]?.speaker !== 'Agent') {
    // Shift to the nearest Agent turn so we never expose a Patient error index.
    const fallback = transcript.findIndex((t, i) => i !== 0 && t.speaker === 'Agent');
    if (fallback === -1) return { error: 'No Agent turn found in transcript.' };
    resolvedIndex = fallback;
  }
  if (!hint || !modelExplanation)
    return { error: 'Gemini returned an incomplete audit response.' };

  return {
    data: {
      transcript: transcript.map((t) => ({
        speaker: String(t.speaker ?? '').trim(),
        message: String(t.message ?? '').trim(),
      })),
      errorIndex:       resolvedIndex,
      hint:             String(hint).trim(),
      modelExplanation: String(modelExplanation).trim(),
      workflowType:     String(requestedWorkflowType ?? workflowType ?? '').trim(),
      errorKind:        String(errorKind ?? '').trim() || 'workflow_error',
      difficulty:       ['easy', 'medium', 'hard'].includes(String(difficulty ?? '').trim().toLowerCase())
        ? String(difficulty).trim().toLowerCase()
        : 'medium',
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (validateSecret(req, res)) return;

  const keys = getApiKeys();
  if (!keys.length) return res.status(500).json({ error: 'Gemini not configured on the server.' });

  const { domain: domainId, department = 'pediatrics', workflowType, avoidWorkflowTypes = [] } = req.body ?? {};

  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) return res.status(400).json({ error: 'Unknown domain.' });
  const requestedWorkflowType = workflowType || workflowOptionsFor(domainId)[0] || 'general_workflow';

  const body = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(domain, department, requestedWorkflowType, avoidWorkflowTypes, await sopContextForFresh(department)) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: AUDIT_SCHEMA,
      temperature: 0.8,
    },
  };

  const result = await geminiWithRotation(keys, body, { label: 'generate-audit' });
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

  const validation = validateAuditResponse(parsed, requestedWorkflowType);
  if (validation.error) return res.status(502).json({ error: validation.error });
  const flags = validateAuditContent(validation.data);
  if (flags.length) return res.status(422).json({ error: flags[0].message });

  return res.status(200).json(validation.data);
}
