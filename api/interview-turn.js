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
import { SOP_CONTEXT } from './_sop-context.js';
import { SUPERVISOR_PASSCODE } from '../src/data/config.js';

const MODEL = 'gemini-2.5-flash';

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

function buildInitPrompt(domain) {
  return `You are creating a realistic patient caller scenario for a contact-centre roleplay training exercise.

Domain: "${domain.name}" — ${domain.blurb}

Using ONLY facts grounded in the SOP reference below, generate:
- "scenario": 2 sentences the NAVIGATOR reads before the call. Be specific: name actual providers,
  visit types, insurance plans, or routing rules from the SOP. This tells the navigator what
  outcome they need to reach.
- "callerName": a realistic first name for the caller (patient or caregiver).
- "openingLine": the caller's natural first sentence when the navigator picks up. Keep it brief
  (1-2 sentences) — callers don't over-explain upfront.

Vary the difficulty. Mix normal situations, edge cases, insurance nuances, and routing exceptions
drawn from the SOP.

SOP REFERENCE:
${SOP_CONTEXT}`;
}

function buildSystemInstruction(callerName, scenario) {
  return `You are ${callerName}, a patient or caregiver calling Aizer Health Pediatric Department's contact centre.

Your situation: ${scenario}

Rules:
- Stay in character as the caller throughout. Never break character or acknowledge this is training.
- Keep responses short and realistic (1-3 sentences) — this is a phone call.
- Reveal information only when the navigator asks for it. Don't volunteer everything at once.
- React naturally: if the navigator is helpful and accurate, be cooperative and appreciative. If
  they give wrong information, skip a required step, or seem confused, react as a real caller
  would — ask a clarifying question or express mild confusion.
- When the call is fully resolved (appointment confirmed, question answered, transfer completed),
  wrap up naturally ("Great, thank you so much!" / "Perfect, see you then!").
- You are the CALLER only. Never speak as the navigator.
- CRITICAL: Be strictly consistent with every fact you have already stated in this conversation
  (names, dates, ages, insurance plan, provider, reason for calling, etc.). Never contradict
  yourself. Before answering a question, mentally check your prior turns.`;
}

// ── Conversation reconstruction ───────────────────────────────────────────────

// Converts client-side history [{role:'patient'|'navigator', text}] into Gemini's
// alternating user/model format, prepending a synthetic BEGIN_CALL user turn so
// the conversation can open with a model (patient) line.
function buildContents(history, navigatorMessage) {
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

// ── Gemini helpers ────────────────────────────────────────────────────────────

function getApiKeys() {
  const multi = (process.env.GEMINI_API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean);
  const single = (process.env.GEMINI_API_KEY || '').trim();
  return [...new Set(multi.length ? multi : single ? [single] : [])];
}

async function callGemini(apiKey, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return { ok: false, status: resp.status, detail: await resp.text().catch(() => '') };
  const data = await resp.json();
  return { ok: true, text: data?.candidates?.[0]?.content?.parts?.[0]?.text };
}

const ROTATABLE = new Set([429, 403, 503, 500]);

async function geminiWithRotation(keys, body) {
  const start = Math.floor(Math.random() * keys.length);
  for (let i = 0; i < keys.length; i++) {
    const idx = (start + i) % keys.length;
    let result;
    try {
      result = await callGemini(keys[idx], body);
    } catch (err) {
      console.error(`interview-turn: fetch threw on key #${idx}:`, err);
      continue;
    }
    if (result.ok) return { ok: true, text: result.text };
    if (ROTATABLE.has(result.status)) {
      if (result.status === 403) console.error(`interview-turn: 403 on key #${idx} — auth/billing issue`);
      else console.warn(`interview-turn: key #${idx} returned ${result.status} — rotating`);
      continue;
    }
    console.error('interview-turn: non-rotatable error', result.status, result.detail);
    return { ok: false, fatal: true, status: result.status };
  }
  return { ok: false, fatal: false };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const keys = getApiKeys();
  if (!keys.length) return res.status(500).json({ error: 'Gemini not configured on the server.' });

  const secret = process.env.GENERATION_SECRET || SUPERVISOR_PASSCODE;
  const {
    domain: domainId,
    scenario,
    callerName,
    history = [],
    navigatorMessage,
    secret: provided,
  } = req.body ?? {};

  if (provided !== secret) return res.status(401).json({ error: 'Not authorised.' });

  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) return res.status(400).json({ error: 'Unknown domain.' });

  // ── INIT: generate scenario + opening line ─────────────────────────────────
  if (!scenario) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: buildInitPrompt(domain) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: INIT_SCHEMA,
        temperature: 0.9,
      },
    };

    const result = await geminiWithRotation(keys, body);
    if (!result.ok) {
      return result.fatal
        ? res.status(502).json({ error: 'Gemini returned an error generating the scenario.' })
        : res.status(429).json({ error: 'All Gemini keys are rate-limited. Try again shortly.' });
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
    system_instruction: { parts: [{ text: buildSystemInstruction(callerName, scenario) }] },
    contents: buildContents(history, navigatorMessage.trim()),
    generationConfig: { temperature: 0.5 },
  };

  const result = await geminiWithRotation(keys, body);
  if (!result.ok) {
    return result.fatal
      ? res.status(502).json({ error: 'Gemini returned an error.' })
      : res.status(429).json({ error: 'All Gemini keys are rate-limited. Try again shortly.' });
  }

  const reply = result.text?.trim();
  if (!reply) return res.status(502).json({ error: 'Empty response from Gemini.' });

  return res.status(200).json({ reply });
}
