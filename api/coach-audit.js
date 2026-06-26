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
import { getApiKeys, geminiWithRotation } from './_gemini-client.js';
import { validateSecret } from './_auth.js';

// Cap free-text inputs interpolated into the prompt to keep the token budget
// bounded and limit the prompt-injection surface (advisory output, but cheap insurance).
const MAX_ANSWER_CHARS = 2000;
const MAX_EXPLANATION_CHARS = 2000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const keys = getApiKeys();
  if (!keys.length) return res.status(500).json({ error: 'Gemini not configured on the server.' });

  if (validateSecret(req, res)) return;
  const { domain: domainId, modelExplanation, navigatorAnswer, name } = req.body ?? {};

  if (!modelExplanation || !navigatorAnswer || !name) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const domain = DOMAINS.find((d) => d.id === domainId);
  const domainLabel = domain?.name ?? domainId ?? 'this domain';
  const answer = String(navigatorAnswer).slice(0, MAX_ANSWER_CHARS);
  const explanation = String(modelExplanation).slice(0, MAX_EXPLANATION_CHARS);

  const systemInstruction = `You are a supportive QA coach at a pediatric contact centre. \
Your job is to validate and encourage navigators who complete training exercises — never to grade \
or penalize. Tone: warm, specific, forward-looking mentor. Address them by first name.`;

  const userMessage = `Navigator: ${name}
Domain practiced: ${domainLabel}

What the agent should have done (the correct SOP answer):
"${explanation}"

What ${name} wrote in their reflection:
"${answer}"

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

  const result = await geminiWithRotation(keys, body, { label: 'coach-audit' });
  if (!result.ok) {
    return result.reason === 'fatal'
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
