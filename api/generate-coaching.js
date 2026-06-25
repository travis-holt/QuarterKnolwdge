// ─────────────────────────────────────────────────────────────────────────────
// POST /api/generate-coaching — Gemini-powered personalized coaching narratives.
//
// Takes the navigator's answers (with authored per-option rationales) and their
// competency scores, and returns a 2–3 sentence coaching note per weak
// competency (scored < canTeach threshold). Gemini writes prose from the
// authored rationale data — it never invents SOP facts.
//
// Advisory only: output never touches a score or a Firestore document.
// Falls back gracefully if all keys are exhausted or the call fails.
// ─────────────────────────────────────────────────────────────────────────────

import { COMPETENCIES, competencyName } from '../src/data/competencies.js';
import { DOMAINS } from '../src/data/questions.js';
import { SUPERVISOR_PASSCODE, THRESHOLDS } from '../src/data/config.js';

const MODEL = 'gemini-2.5-flash';

// 403 means invalid/revoked key or billing — still rotate (try every key once)
// but log separately so broken keys are diagnosable. 429/5xx are transient.
const ROTATABLE = new Set([429, 403, 503, 500]);
const AUTH_ERRORS = new Set([403]);

function getApiKeys() {
  const multi = (process.env.GEMINI_API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean);
  const single = (process.env.GEMINI_API_KEY || '').trim();
  return [...new Set(multi.length ? multi : single ? [single] : [])];
}

const domainName = (id) => DOMAINS.find((d) => d.id === id)?.name ?? id;

// Dynamic Gemini responseSchema — built per-request from the actual weak
// competency IDs for this navigator so the API enforces the exact output shape.
function buildResponseSchema(weakComps) {
  const properties = {};
  for (const c of weakComps) {
    properties[c.id] = { type: 'STRING' };
  }
  return {
    type: 'OBJECT',
    properties,
    required: weakComps.map((c) => c.id),
  };
}

// Digest of only the questions the navigator answered below 100 pts — these
// are the learning moments that ground the coaching. Capped at 10 to stay
// within the token budget.
function buildDigest(questions, answers) {
  return questions
    .map((q) => {
      const chosenId = answers?.[q.id];
      const chosen = q.options?.find((o) => o.id === chosenId);
      const best = q.options?.find((o) => o.id === q.correctOptionId);
      const earned = typeof chosen?.points === 'number' ? chosen.points : (chosenId === q.correctOptionId ? 100 : 0);
      if (earned >= 100) return null;
      return [
        `[${domainName(q.domainId)} | ${(q.competencies || []).join(', ')}]`,
        `Scenario: ${q.scenario}`,
        `Navigator chose (${earned} pts): "${chosen?.text ?? '(no answer)'}" — ${chosen?.rationale ?? ''}`,
        `Best answer (100 pts): "${best?.text ?? ''}" — ${best?.rationale ?? ''}`,
      ].join('\n');
    })
    .filter(Boolean)
    .slice(0, 10);
}

// Builds the two separate parts of the Gemini request: system instruction
// (static persona/rules) and user message (dynamic navigator data).
function buildMessages(name, weakComps, competencyScores, digest) {
  const compList = weakComps
    .map((c) => `  ${c.id} (${competencyName(c.id)}): ${Math.round(competencyScores[c.id])}%`)
    .join('\n');

  const systemInstruction = `You are a supportive development coach for patient navigators \
at a pediatric contact centre. Write personalized coaching notes that are specific, \
forward-looking, and grounded only in the rationale text provided — never invent SOP facts \
not present in the provided data. Address the navigator as "you" (second person). \
Tone: supportive colleague building capability, not grading.`;

  const userMessage = `Navigator: ${name}
Competencies needing development (below ${THRESHOLDS.canTeach}%):
${compList}

Questions they answered below best (with SOP rationale for each):
${digest.join('\n\n')}

Write a 2–3 sentence coaching note for each competency listed above. \
Reference the specific scenarios from the check using the rationale language provided. \
Return one key per competency ID exactly as listed.`;

  return { systemInstruction, userMessage };
}

async function callGemini(apiKey, systemInstruction, userMessage, responseSchema) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.4,
      },
    }),
  });
  if (!resp.ok) return { ok: false, status: resp.status, detail: await resp.text().catch(() => '') };
  const data = await resp.json();
  return { ok: true, text: data?.candidates?.[0]?.content?.parts?.[0]?.text };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const keys = getApiKeys();
  if (keys.length === 0) return res.status(500).json({ error: 'Coaching is not configured on the server.' });

  const secret = process.env.GENERATION_SECRET || SUPERVISOR_PASSCODE;
  const { answers, questions, competencyScores, name, secret: provided } = req.body ?? {};
  if (provided !== secret) return res.status(401).json({ error: 'Not authorised.' });

  if (!answers || !questions || !competencyScores || !name) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const weakComps = COMPETENCIES.filter((c) => {
    const pct = competencyScores?.[c.id];
    return typeof pct === 'number' && pct < THRESHOLDS.canTeach;
  });

  const digest = buildDigest(questions, answers);

  if (weakComps.length === 0 || digest.length === 0) {
    // Nothing to coach — all competencies at canTeach, or no missed questions.
    return res.status(200).json({ coaching: {} });
  }

  const responseSchema = buildResponseSchema(weakComps);
  const { systemInstruction, userMessage } = buildMessages(name, weakComps, competencyScores, digest);

  // Rotate keys starting from a random offset to spread load.
  const start = Math.floor(Math.random() * keys.length);
  let text = null;
  let rotated = 0;
  let authFailures = 0;

  for (let i = 0; i < keys.length; i++) {
    const keyIdx = (start + i) % keys.length;
    let result;
    try {
      result = await callGemini(keys[keyIdx], systemInstruction, userMessage, responseSchema);
    } catch (err) {
      console.error(`Coaching Gemini fetch threw on key #${keyIdx}:`, err);
      rotated++;
      continue;
    }
    if (result.ok) { text = result.text; break; }
    if (ROTATABLE.has(result.status)) {
      if (AUTH_ERRORS.has(result.status)) {
        authFailures++;
        console.error(`Coaching: key #${keyIdx} returned ${result.status} (auth/billing failure) — rotating.`);
      } else {
        console.warn(`Coaching: key #${keyIdx} returned ${result.status} — rotating.`);
      }
      rotated++;
      continue;
    }
    // Non-rotatable error (e.g. 400 = our bug) — surface immediately.
    console.error('Coaching Gemini error (not rotatable):', result.status, result.detail);
    return res.status(502).json({ error: `Gemini request failed (${result.status}).` });
  }

  if (text == null) {
    if (authFailures > 0 && authFailures === rotated) {
      console.error(`Coaching: all ${keys.length} key(s) returned auth/billing errors.`);
      return res.status(500).json({ error: 'All Gemini keys have auth or billing failures — check Railway Variables.' });
    }
    if (rotated >= keys.length) {
      return res.status(429).json({ error: 'All Gemini keys are rate-limited right now. Try again shortly.' });
    }
    return res.status(502).json({ error: 'Empty response from Gemini.' });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return res.status(502).json({ error: 'Gemini returned invalid JSON.' });
  }

  // Defense-in-depth: only keep string values for known competency IDs,
  // even though the schema already constrained the shape.
  const validIds = new Set(weakComps.map((c) => c.id));
  const coaching = {};
  for (const [id, note] of Object.entries(parsed ?? {})) {
    if (validIds.has(id) && typeof note === 'string' && note.trim()) {
      coaching[id] = note.trim();
    }
  }

  return res.status(200).json({ coaching });
}
