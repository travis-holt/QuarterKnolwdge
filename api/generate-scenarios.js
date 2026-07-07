// ─────────────────────────────────────────────────────────────────────────────
// POST /api/generate-scenarios — serverless Gemini proxy (Vercel).
//
// Generates draft scenario MCQs from the SOP for one domain. Gemini API keys live
// ONLY in this server-side function and never reach the browser. Multiple keys may
// be supplied (env GEMINI_API_KEYS, comma-separated; or a single GEMINI_API_KEY);
// the function rotates to the next key whenever one is rate-limited / quota-
// exhausted, maximising the free-tier budget. The endpoint is gated by a shared
// secret (env GENERATION_SECRET) to deter anonymous abuse — pilot-grade.
//
// Returns validated drafts: { questions: [...] }. It does NOT touch Firestore —
// the client persists the drafts via db.saveDraftQuestions, keeping db.js the
// single data surface. Output is validated/repaired before returning so a
// malformed model response can't poison the question bank.
// ─────────────────────────────────────────────────────────────────────────────

import { DOMAINS } from '../src/data/questions.js';
import { COMPETENCIES } from '../src/data/competencies.js';
import { sopContextFor, sopContextForFresh } from './_sop-context.js';
import { getApiKeys, geminiWithRotation, rotationFailure } from './_gemini-client.js';
import { validateSecret } from './_auth.js';

const COMPETENCY_IDS = new Set(COMPETENCIES.map((c) => c.id));
const LETTERS = ['a', 'b', 'c', 'd', 'e'];

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      scenario: { type: 'STRING' },
      competencies: { type: 'ARRAY', items: { type: 'STRING' } },
      correctOptionId: { type: 'STRING' },
      options: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' },
            text: { type: 'STRING' },
            points: { type: 'INTEGER' },
            rationale: { type: 'STRING' },
          },
          required: ['id', 'text', 'points', 'rationale'],
        },
      },
    },
    required: ['scenario', 'competencies', 'options', 'correctOptionId'],
  },
};

function buildPrompt(domain, count, department, sopContext = sopContextFor(department)) {
  const compList = COMPETENCIES.map((c) => `${c.id} (${c.name})`).join(', ');
  return `You are an instructional designer writing a competency assessment for patient
navigators (contact-centre agents) based ONLY on the SOP reference below. Do not invent
facts that are not supported by it.

SOP REFERENCE:
${sopContext}

TASK: Write ${count} scenario-based multiple-choice question(s) for the domain "${domain.name}"
(${domain.blurb}). Mix NORMAL, EDGE-CASE, and FAILURE-STATE situations. Each question must:
- Present a realistic caller situation, then ask what the navigator should do.
- Have 4 options. Exactly ONE option is the best answer with points = 100. The other three
  carry partial credit from 0–60 reflecting how defensible they are (a dangerous or
  compliance-violating choice = 0–10; a plausible-but-suboptimal choice = 30–60).
- Give EVERY option a one-sentence "rationale" explaining why it is right or wrong, grounded
  in the SOP.
- Set "correctOptionId" to the id of the 100-point option.
- Tag 1–3 "competencies" from EXACTLY this allowed list (use the id, not the name): ${compList}.

DISTRACTOR QUALITY — this is the most important requirement. The question is worthless if the
best answer is guessable without knowing the SOP:
- Every wrong option must be something a real, well-meaning navigator might actually do — a
  near-miss that only fails on a specific SOP detail (wrong queue, wrong order of steps, right
  action for a DIFFERENT caller type, outdated rule, plausible overreach). Never a strawman,
  never obviously rude, lazy, or absurd.
- All 4 options must be roughly the SAME LENGTH and the same tone. Do not make the best answer
  the longest, most detailed, or most hedged option — that pattern gives it away.
- Do not reuse giveaway wording from the scenario in only the correct option.
- At least one distractor should be MORE cautious/thorough-sounding than the best answer but
  wrong per the SOP (e.g. escalating something the SOP says to handle directly).
- A navigator who has NOT read the SOP should find at least two options equally tempting.

Option ids must be "a","b","c","d". Do not include a domain field. Return ONLY the JSON array.`;
}

// Coerce one raw model question into the strict app shape, or return null if it
// cannot be repaired into something valid.
export function sanitize(raw, domainId) {
  if (!raw || typeof raw.scenario !== 'string' || !raw.scenario.trim()) return null;
  if (!Array.isArray(raw.options) || raw.options.length < 2) return null;

  const options = raw.options.slice(0, 4).map((o, i) => ({
    id: LETTERS[i],
    text: String(o?.text ?? '').trim(),
    points: Math.max(0, Math.min(100, Math.round(Number(o?.points)) || 0)),
    rationale: String(o?.rationale ?? '').trim(),
  }));
  if (options.some((o) => !o.text || !o.rationale)) return null;

  // Resolve the best option: trust correctOptionId if it maps to an option,
  // else fall back to the highest-points option. Force it to exactly 100.
  const rawIdx = options.findIndex((o, i) => raw.correctOptionId === o.id || raw.correctOptionId === LETTERS[i]);
  const bestIdx = rawIdx >= 0 ? rawIdx : options.reduce((b, o, i, a) => (o.points > a[b].points ? i : b), 0);
  options.forEach((o, i) => { o.points = i === bestIdx ? 100 : Math.min(o.points, 95); });

  const competencies = (Array.isArray(raw.competencies) ? raw.competencies : [])
    .map((c) => String(c).trim())
    .filter((c) => COMPETENCY_IDS.has(c));
  if (competencies.length === 0) return null;

  return {
    domainId,
    competencies: [...new Set(competencies)].slice(0, 3),
    scenario: raw.scenario.trim(),
    options,
    correctOptionId: options[bestIdx].id,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (validateSecret(req, res)) return;

  const keys = getApiKeys();
  if (!keys.length) {
    return res.status(500).json({ error: 'Generation is not configured on the server.' });
  }

  const { domainId, count = 3, department = 'pediatrics' } = req.body ?? {};

  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) return res.status(400).json({ error: 'Unknown domain.' });
  const n = Math.max(1, Math.min(8, Number(count) || 1));

  const requestBody = {
    contents: [{ parts: [{ text: buildPrompt(domain, n, department, await sopContextForFresh(department)) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.7,
    },
  };

  const result = await geminiWithRotation(keys, requestBody, { label: 'generate-scenarios' });
  if (!result.ok) {
    const { status, error } = rotationFailure(result);
    return res.status(status).json({ error });
  }

  const text = result.text;
  if (text == null) {
    return res.status(502).json({ error: 'Empty response from Gemini.' });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return res.status(502).json({ error: 'Gemini returned invalid JSON.' });
  }

  const questions = (Array.isArray(parsed) ? parsed : [])
    .map((q) => sanitize(q, domainId))
    .filter(Boolean);

  if (questions.length === 0) {
    return res.status(422).json({ error: 'No valid scenarios were produced. Try again.' });
  }

  return res.status(200).json({ questions });
}
