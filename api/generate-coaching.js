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
import { domainName } from '../src/data/questions.js';
import { optionPoints } from '../src/lib/scoring.js';
import { THRESHOLDS } from '../src/data/config.js';
import { getApiKeys, geminiWithRotation, rotationFailure, MODEL, LITE_MODEL } from './_gemini-client.js';
import { navigatorContextBlock } from './_navigator-operating-model.js';
import { validateSecret } from './_auth.js';

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
export function buildDigest(questions, answers) {
  return questions
    .map((q) => {
      const chosenId = answers?.[q.id];
      const chosen = q.options?.find((o) => o.id === chosenId);
      const best = q.options?.find((o) => o.id === q.correctOptionId);
      const earned = optionPoints(q, chosenId);
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
function buildEvidenceContext({ completions = [], interviews = [], priorResults = [], feedbackSummary = null } = {}) {
  const parts = [];
  if (priorResults.length > 0) {
    parts.push(`Prior attempts/departments: ${priorResults.slice(0, 5).map((r) => {
      const scores = Object.entries(r.scores ?? {}).map(([k, v]) => `${k} ${v}%`).join(', ');
      return `${r.department ?? 'unknown'} (${scores})`;
    }).join(' | ')}`);
  }
  if (completions.length > 0) {
    parts.push(`Training/practice completed: ${completions.slice(0, 8).map((c) => `${c.domainId}:${c.kind ?? 'practice'}`).join(', ')}`);
  }
  if (interviews.length > 0) {
    parts.push(`Practice call scores: ${interviews.slice(0, 5).map((iv) => `${iv.domainId}:${iv.grade?.score ?? 'ungraded'}/100`).join(', ')}`);
  }
  if (feedbackSummary) {
    parts.push(`Supervisor feedback summary: ${JSON.stringify(feedbackSummary).slice(0, 1200)}`);
  }
  return parts.join('\n');
}

function buildMessages(name, weakComps, competencyScores, digest) {
  const compList = weakComps
    .map((c) => `  ${c.id} (${competencyName(c.id)}): ${Math.round(competencyScores[c.id])}%`)
    .join('\n');

  const systemInstruction = `You are a supportive development coach for patient navigators \
at a medical contact centre. Write personalized coaching notes that are specific, \
forward-looking, and grounded only in the rationale text provided — never invent SOP facts \
not present in the provided data. Address the navigator as "you" (second person). \
Tone: supportive colleague building capability, not grading.

${navigatorContextBlock({ mode: 'coaching' })}`;

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

// Build the Gemini request body from the static system instruction + dynamic
// user message and the per-request response schema.
function buildBody(systemInstruction, userMessage, responseSchema) {
  return {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.4,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (validateSecret(req, res)) return;

  const keys = getApiKeys();
  if (!keys.length) return res.status(500).json({ error: 'Coaching is not configured on the server.' });

  const { answers, questions, competencyScores, name, completions, interviews, priorResults, feedbackSummary } = req.body ?? {};

  if (!answers || !questions || !competencyScores || !name) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const weakComps = COMPETENCIES.filter((c) => {
    const pct = competencyScores?.[c.id];
    return typeof pct === 'number' && pct < THRESHOLDS.canTeach;
  });

  const digest = buildDigest(questions, answers);
  const evidenceContext = buildEvidenceContext({ completions, interviews, priorResults, feedbackSummary });
  const digestForPrompt = evidenceContext
    ? [...digest, `Stored learning evidence:\n${evidenceContext}\nUse this to make the coaching more specific over time, but do not change scores or invent facts.`]
    : digest;

  if (weakComps.length === 0 || digest.length === 0) {
    // Nothing to coach — all competencies at canTeach, or no missed questions.
    return res.status(200).json({ coaching: {} });
  }

  const responseSchema = buildResponseSchema(weakComps);
  const { systemInstruction, userMessage } = buildMessages(name, weakComps, competencyScores, digestForPrompt);
  const body = buildBody(systemInstruction, userMessage, responseSchema);

  // Coaching notes are advisory prose — overflow to flash-lite's separate quota
  // bucket rather than falling back to rule-based when the primary model is
  // rate-limited (the client silently drops this section on 429 anyway).
  const result = await geminiWithRotation(keys, body, { label: 'generate-coaching', models: [MODEL, LITE_MODEL] });
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
