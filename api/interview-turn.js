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
import { sopContextFor, sopContextForFresh } from './_sop-context.js';
import { navigatorContextBlock } from './_navigator-operating-model.js';
import { getApiKeys, geminiWithRotation, rotationFailure, MODEL, LITE_MODEL } from './_gemini-client.js';

// Roleplay is conversational, not scored — a lighter model beats a 429 for the
// navigator mid-call, so overflow to flash-lite's separate quota bucket when
// every key is rate-limited on the primary model.
const CHAT_MODELS = [MODEL, LITE_MODEL];
import { validateSecret } from './_auth.js';

// ── Schema for the init call ──────────────────────────────────────────────────

// The init call also returns a hidden `caseFile`: a small structured record of
// the scenario's facts and expectations so the roleplay caller stays consistent
// and the client can (optionally) carry it internally. It is NOT an answer key
// shown to the navigator — the caller reveals facts only when asked and never
// volunteers the correct SOP action.
const CASE_FILE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    workflowType:            { type: 'STRING' },
    patientType:             { type: 'STRING' },
    callerRelationship:      { type: 'STRING' },
    requestSummary:          { type: 'STRING' },
    requiredActions:         { type: 'ARRAY', items: { type: 'STRING' } },
    acceptableNavigatorPaths:{ type: 'ARRAY', items: { type: 'STRING' } },
    criticalMistakes:        { type: 'ARRAY', items: { type: 'STRING' } },
    factsToReveal:           { type: 'ARRAY', items: { type: 'STRING' } },
    emotionalTone:           { type: 'STRING' },
    difficulty:              { type: 'STRING' },
  },
};

const INIT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    scenario:    { type: 'STRING' },
    callerName:  { type: 'STRING' },
    openingLine: { type: 'STRING' },
    caseFile:    CASE_FILE_SCHEMA,
  },
  required: ['scenario', 'callerName', 'openingLine'],
};

// Coerce a raw caseFile into a safe shape, or null if absent/unusable. Kept pure
// and exported so the contract is unit-testable.
export function coerceCaseFile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const arr = (v) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);
  const cf = {
    workflowType:             str(raw.workflowType),
    patientType:              str(raw.patientType),
    callerRelationship:       str(raw.callerRelationship),
    requestSummary:           str(raw.requestSummary),
    requiredActions:          arr(raw.requiredActions),
    acceptableNavigatorPaths: arr(raw.acceptableNavigatorPaths),
    criticalMistakes:         arr(raw.criticalMistakes),
    factsToReveal:            arr(raw.factsToReveal),
    emotionalTone:            str(raw.emotionalTone),
    difficulty:               str(raw.difficulty),
  };
  // Require at least a request summary or workflow type to be meaningful.
  return cf.requestSummary || cf.workflowType ? cf : null;
}

// ── Prompts ───────────────────────────────────────────────────────────────────

function buildInitPrompt(domain, department, sopContext = sopContextFor(department)) {
  return `You are creating a realistic patient caller scenario for a contact-centre roleplay training exercise.

Domain: "${domain.name}" — ${domain.blurb}

${navigatorContextBlock({ department, mode: 'roleplay-init' })}

Using ONLY facts grounded in the SOP reference below, generate:
- "scenario": 2 sentences the NAVIGATOR reads before the call. Be specific: reference actual
  visit types, timing rules, routing queues, or insurance rules from the SOP. This tells the
  navigator what outcome they need to reach.
- "callerName": a realistic first name for the caller (patient or caregiver).
- "openingLine": the caller's natural first sentence when the navigator picks up. Keep it brief
  (1-2 sentences) — callers don't over-explain upfront.
- "caseFile": a HIDDEN structured record of this call so the caller stays consistent (the
  navigator never sees it — do not put the correct SOP answer in the scenario or opening line):
    - "workflowType": short label for the request type (e.g. "prescription_refill", "new_ob_visit").
    - "patientType": e.g. "established pediatric patient", "new OB patient", "non-pregnant GYN".
    - "callerRelationship": who is calling relative to the patient (self, parent, caregiver).
    - "requestSummary": one plain sentence describing what the caller actually needs.
    - "requiredActions": the navigator behaviors that make this call correct per the SOP.
    - "acceptableNavigatorPaths": reasonable variations that still reach a safe, correct outcome.
    - "criticalMistakes": handling that would make this call wrong or unsafe.
    - "factsToReveal": concrete facts (name, DOB, medication, pharmacy, symptoms/onset, gestational
      age, insurance) the caller knows and will share ONLY when asked.
    - "emotionalTone": e.g. "calm", "worried", "rushed", "frustrated".
    - "difficulty": one of easy, medium, hard.

Vary the difficulty. Mix normal situations, edge cases, insurance nuances, and routing exceptions
drawn from the SOP. Write everything in English.

CONTENT SAFETY RULES:
- Do not build a scenario whose only right/wrong issue is whether the navigator asked for phone
  number before DOB, or DOB before phone number.
- If the scenario involves patient lookup, the real issue must be chart accuracy, authorization,
  privacy, sibling safety, or duplicate-chart prevention.
- For standard refill scenarios, do not make PE verification the key issue and do not imply the
  refill cannot be processed because PE is not current. Use real refill workflow issues instead.

SOP REFERENCE:
${sopContext}`;
}

// Render the hidden case file into private caller notes. These stay in the system
// instruction only — the caller uses them to answer consistently and react
// naturally; they are never spoken verbatim and never reveal the correct SOP action.
function renderCaseFileNotes(caseFile) {
  const cf = coerceCaseFile(caseFile);
  if (!cf) return '';
  const lines = [];
  if (cf.patientType) lines.push(`- Patient: ${cf.patientType}`);
  if (cf.callerRelationship) lines.push(`- You are calling as: ${cf.callerRelationship}`);
  if (cf.requestSummary) lines.push(`- What you actually need: ${cf.requestSummary}`);
  if (cf.factsToReveal.length) lines.push(`- Facts you know (share ONLY when asked): ${cf.factsToReveal.join('; ')}`);
  if (cf.emotionalTone) lines.push(`- Your mood: ${cf.emotionalTone}`);
  if (!lines.length) return '';
  return `

YOUR PRIVATE CASE NOTES (never read these aloud; use them to stay consistent):
${lines.join('\n')}
Stay strictly consistent with these facts. Reveal a fact only when the navigator asks for it.
Never tell the navigator what the "correct" procedure is — you are the caller, not their coach.`;
}

export function buildSystemInstruction(callerName, scenario, options = {}) {
  const department = options.department ?? 'pediatrics';
  const deptName = departmentName(department);
  const openingLine = options.openingLine?.trim();
  const caseNotes = renderCaseFileNotes(options.caseFile);

  return `You are ${callerName}, a patient, parent/guardian, or caregiver calling the Aizer Health ${deptName} contact centre.

Your situation: ${scenario}
Department: ${deptName}
${openingLine ? `Opening line: when the call begins, your first spoken turn must be this line or a natural very close variation: "${openingLine}"` : ''}${caseNotes}

${navigatorContextBlock({ department, mode: 'roleplay-caller' })}

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
    caseFile,
  } = req.body ?? {};

  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) return res.status(400).json({ error: 'Unknown domain.' });

  // ── INIT: generate scenario + opening line ─────────────────────────────────
  if (!scenario) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: buildInitPrompt(domain, department, await sopContextForFresh(department)) }] }],
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
      caseFile:    coerceCaseFile(parsed.caseFile), // hidden; client may carry it back on turns
    });
  }

  // ── TURN: continue conversation as the patient ─────────────────────────────
  if (!navigatorMessage?.trim()) {
    return res.status(400).json({ error: 'navigatorMessage is required for a conversation turn.' });
  }

  const body = {
    system_instruction: { parts: [{ text: buildSystemInstruction(callerName, scenario, { department, caseFile }) }] },
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
