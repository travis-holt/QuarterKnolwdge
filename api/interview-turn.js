// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interview-turn — Gemini roleplay endpoint.
//
// Two modes, controlled by whether `scenario` is present in the request body:
//
//   INIT  (no scenario):  generates a caller scenario for the chosen domain +
//                         returns the patient's opening line.
//                         Response: { scenario, callerName, reply }
//
//   TURN  (has scenario): continues the conversation as the patient caller,
//                         using the full history to maintain context.
//                         Response: { reply }
//
// The patient's voice is shaped by a system_instruction so it stays in character
// without leaking SOP details the navigator hasn't asked for yet. History is
// converted to Gemini's alternating user/model format (BEGIN_CALL seeds the
// first patient turn so the conversation starts on the model side).
//
// Key rotation and secret-gate follow the same pattern as generate-scenarios.js.
// Advisory only — never writes to Firestore.
// ─────────────────────────────────────────────────────────────────────────────

import { DOMAINS } from '../src/data/questions.js';
import { departmentName } from '../src/data/departments.js';
import { sopContextFor } from './_sop-context.js';
import { getApiKeys, geminiWithRotation, rotationFailure, MODEL, LITE_MODEL } from './_gemini-client.js';

// Roleplay is conversational, not scored — a lighter model beats a 429 for the
// navigator mid-call, so overflow to flash-lite's separate quota bucket when
// every key is rate-limited on the primary model.
const CHAT_MODELS = [MODEL, LITE_MODEL];
import { validateSecret } from './_auth.js';

// ── Schema for the init call ──────────────────────────────────────────────────

const INIT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    scenario:    { type: 'STRING' },
    callerName:  { type: 'STRING' },
    openingLine: { type: 'STRING' },
  },
  required: ['scenario', 'callerName', 'openingLine'],
};

// ── Prompts ───────────────────────────────────────────────────────────────────

function buildInitPrompt(domain, department) {
  return `You are creating a realistic patient caller scenario for a contact-centre roleplay training exercise.

Domain: "${domain.name}" — ${domain.blurb}

Using ONLY facts grounded in the SOP reference below, generate:
- "scenario": 2 sentences the NAVIGATOR reads before the call. Be specific: reference actual
  visit types, timing rules, routing queues, or insurance rules from the SOP. This tells the
  navigator what outcome they need to reach.
- "callerName": a realistic first name for the caller (patient or caregiver).
- "openingLine": the caller's natural first sentence when the navigator picks up. Keep it brief
  (1-2 sentences) — callers don't over-explain upfront.

Vary the difficulty. Mix normal situations, edge cases, insurance nuances, and routing exceptions
drawn from the SOP. Write everything in English.

SOP REFERENCE:
${sopContextFor(department)}`;
}

export function buildSystemInstruction(callerName, scenario, options = {}) {
  const department = options.department ?? 'pediatrics';
  const deptName = departmentName(department);
  const openingLine = options.openingLine?.trim();

  return `You are ${callerName}, a patient, parent/guardian, or caregiver calling the Aizer Health ${deptName} contact centre.

Your situation: ${scenario}
Department: ${deptName}
${openingLine ? `Opening line: when the call begins, your first spoken turn must be this line or a natural very close variation: "${openingLine}"` : ''}

Rules:
- Stay in character as the caller throughout. Never break character or acknowledge this is training.
- Keep responses short and realistic (1-3 sentences) — this is a phone call.
- Sound current and unscripted: vary your phrasing, include small realistic details when asked, and do not repeat the scenario back verbatim.
- Reveal information only when the navigator asks for it. Don't volunteer everything at once.
- React naturally: if the navigator is helpful and accurate, be cooperative and appreciative. If
  they give wrong information, skip a required step, or seem confused, react as a real caller
  would — ask a clarifying question or express mild confusion.
- When the call is fully resolved (appointment confirmed, question answered, transfer completed),
  wrap up naturally ("Great, thank you so much!" / "Perfect, see you then!").
- You are the CALLER only. Never speak as the navigator.
- CRITICAL: Speak English ONLY, for the entire call. Never switch to Hindi, Spanish, or any other
  language — even if the navigator's message is in another language, contains typos, or looks
  garbled, always reply in natural English.
- CRITICAL: Be strictly consistent with every fact you have already stated in this conversation
  (names, dates, ages, insurance plan, provider, reason for calling, etc.). Never contradict
  yourself. Before answering a question, mentally check your prior turns.`;
}

// ── Conversation reconstruction ───────────────────────────────────────────────

// Converts client-side history [{role:'patient'|'navigator', text}] into Gemini's
// alternating user/model format, prepending a synthetic BEGIN_CALL user turn so
// the conversation can open with a model (patient) line.
export function buildContents(history, navigatorMessage) {
  const contents = [{ role: 'user', parts: [{ text: 'BEGIN_CALL' }] }];
  for (const turn of history) {
    contents.push({
      role: turn.role === 'patient' ? 'model' : 'user',
      parts: [{ text: turn.text }],
    });
  }
  contents.push({ role: 'user', parts: [{ text: navigatorMessage }] });
  return contents;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (validateSecret(req, res)) return;

  const keys = getApiKeys();
  if (!keys.length) return res.status(500).json({ error: 'Gemini not configured on the server.' });

  const {
    domain: domainId,
    scenario,
    callerName,
    history = [],
    navigatorMessage,
    department = 'pediatrics',
  } = req.body ?? {};

  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) return res.status(400).json({ error: 'Unknown domain.' });

  // ── INIT: generate scenario + opening line ─────────────────────────────────
  if (!scenario) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: buildInitPrompt(domain, department) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: INIT_SCHEMA,
        temperature: 0.9,
      },
    };

    const result = await geminiWithRotation(keys, body, { label: 'interview-turn', models: CHAT_MODELS });
    if (!result.ok) {
      const { status, error } = rotationFailure(result, { fatal: 'Gemini returned an error generating the scenario.' });
      return res.status(status).json({ error });
    }

    let parsed;
    try { parsed = JSON.parse(result.text); } catch {
      return res.status(502).json({ error: 'Gemini returned invalid JSON for the scenario.' });
    }
    if (!parsed?.scenario || !parsed?.callerName || !parsed?.openingLine) {
      return res.status(502).json({ error: 'Gemini returned an incomplete scenario.' });
    }

    return res.status(200).json({
      scenario:    parsed.scenario.trim(),
      callerName:  parsed.callerName.trim(),
      reply:       parsed.openingLine.trim(),
    });
  }

  // ── TURN: continue conversation as the patient ─────────────────────────────
  if (!navigatorMessage?.trim()) {
    return res.status(400).json({ error: 'navigatorMessage is required for a conversation turn.' });
  }

  const body = {
    system_instruction: { parts: [{ text: buildSystemInstruction(callerName, scenario, { department }) }] },
    contents: buildContents(history, navigatorMessage.trim()),
    generationConfig: { temperature: 0.5 },
  };

  const result = await geminiWithRotation(keys, body, { label: 'interview-turn', models: CHAT_MODELS });
  if (!result.ok) {
    const { status, error } = rotationFailure(result, { fatal: 'Gemini returned an error.' });
    return res.status(status).json({ error });
  }

  const reply = result.text?.trim();
  if (!reply) return res.status(502).json({ error: 'Empty response from Gemini.' });

  return res.status(200).json({ reply });
}
