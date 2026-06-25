// ─────────────────────────────────────────────────────────────────────────────
// POST /api/coach-audit — Gemini reads the navigator's written reflection on
// a "Spot the Error" exercise and responds as a friendly QA mentor.
//
// Takes the navigator's free-text answer and the model explanation (what the
// agent should have done), and returns a 2–3 sentence coaching reply that
// validates what they got right and adds any missing insight.
//
// Advisory only: never gates completion, never writes to Firestore.
// Same key rotation and passcode gate as other handlers.
// ─────────────────────────────────────────────────────────────────────────────

import { DOMAINS } from '../src/data/questions.js';
import { SUPERVISOR_PASSCODE } from '../src/data/config.js';

const MODEL = 'gemini-2.5-flash';
const ROTATABLE = new Set([429, 403, 503, 500]);

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

async function geminiWithRotation(keys, body) {
  const start = Math.floor(Math.random() * keys.length);
  for (let i = 0; i < keys.length; i++) {
    const idx = (start + i) % keys.length;
    let result;
    try {
      result = await callGemini(keys[idx], body);
    } catch (err) {
      console.error(`coach-audit: fetch threw on key #${idx}:`, err);
      continue;
    }
    if (result.ok) return { ok: true, text: result.text };
    if (ROTATABLE.has(result.status)) {
      if (result.status === 403) console.error(`coach-audit: 403 on key #${idx} — auth/billing issue`);
      else console.warn(`coach-audit: key #${idx} returned ${result.status} — rotating`);
      continue;
    }
    console.error('coach-audit: non-rotatable error', result.status, result.detail);
    return { ok: false, fatal: true, status: result.status };
  }
  return { ok: false, fatal: false };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const keys = getApiKeys();
  if (!keys.length) return res.status(500).json({ error: 'Gemini not configured on the server.' });

  const secret = process.env.GENERATION_SECRET || SUPERVISOR_PASSCODE;
  const { domain: domainId, modelExplanation, navigatorAnswer, name, secret: provided } = req.body ?? {};
  if (provided !== secret) return res.status(401).json({ error: 'Not authorised.' });

  if (!modelExplanation || !navigatorAnswer || !name) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const domain = DOMAINS.find((d) => d.id === domainId);
  const domainLabel = domain?.name ?? domainId ?? 'this domain';

  const systemInstruction = `You are a supportive QA coach at a pediatric contact centre. \
Your job is to validate and encourage navigators who complete training exercises — never to grade \
or penalize. Tone: warm, specific, forward-looking mentor. Address them by first name.`;

  const userMessage = `Navigator: ${name}
Domain practiced: ${domainLabel}

What the agent should have done (the correct SOP answer):
"${modelExplanation}"

What ${name} wrote in their reflection:
"${navigatorAnswer}"

Write a 2–3 sentence coaching reply that:
- Opens by validating the strongest part of their answer
- Adds one specific insight from the model answer they may have missed or could reinforce
- Closes with brief encouragement (keep it natural, not sycophantic)

Return plain JSON: { "reply": "..." }`;

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { reply: { type: 'STRING' } },
        required: ['reply'],
      },
      temperature: 0.4,
    },
  };

  const result = await geminiWithRotation(keys, body);
  if (!result.ok) {
    return result.fatal
      ? res.status(502).json({ error: 'Gemini returned an error generating coaching.' })
      : res.status(429).json({ error: 'All Gemini keys are rate-limited. Try again shortly.' });
  }

  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return res.status(502).json({ error: 'Gemini returned invalid JSON.' });
  }

  const reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
  if (!reply) return res.status(502).json({ error: 'Empty coaching reply from Gemini.' });

  return res.status(200).json({ reply });
}
