// ─────────────────────────────────────────────────────────────────────────────
// POST /api/grade-interview — Gemini supervisor-style grading of a practice call.
//
// Takes the full transcript + scenario + domain and returns a structured grade:
//   { score: 0–100, summary: string, strengths: string[], improvements: string[] }
//
// Grounded in the SOP context — Gemini judges only against documented procedures.
// Advisory only: output is shown to the navigator in-session and stored on the
// interview Firestore doc; it never affects the capability matrix or domain scores.
// ─────────────────────────────────────────────────────────────────────────────

import { sopContextFor, sopContextForFresh } from './_sop-context.js';
import { navigatorContextBlock } from './_navigator-operating-model.js';
import { DOMAINS } from '../src/data/questions.js';
import { departmentName } from '../src/data/departments.js';
import { getApiKeys, geminiWithRotation, rotationFailure, MODEL, LITE_MODEL } from './_gemini-client.js';
import { validateSecret } from './_auth.js';

const FINDING_AREAS = ['intake', 'classification', 'routing', 'scheduling', 'boundaries', 'documentation', 'communication'];
const FINDING_VERDICTS = ['met', 'partial', 'missed'];

// Bound the transcript fed to Gemini: cap the number of turns and the length of
// each message. Keeps the token budget predictable and limits the prompt-injection
// surface from navigator-typed text (output is advisory, but cheap insurance).
const MAX_TURNS = 40;
const MAX_TURN_CHARS = 1500;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score:        { type: 'NUMBER' },
    summary:      { type: 'STRING' },
    strengths:    { type: 'ARRAY', items: { type: 'STRING' } },
    improvements: { type: 'ARRAY', items: { type: 'STRING' } },
    // Optional structured, per-area findings. Old UI ignores this field; it is
    // stored alongside the grade as decision support for supervisors.
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          area:     { type: 'STRING', enum: FINDING_AREAS },
          verdict:  { type: 'STRING', enum: FINDING_VERDICTS },
          evidence: { type: 'STRING' },
          coaching: { type: 'STRING' },
        },
        required: ['area', 'verdict'],
      },
    },
  },
  required: ['score', 'summary', 'strengths', 'improvements'],
};

export function buildMessages(domainId, scenario, transcript, name, department, sopContext = sopContextFor(department)) {
  const domainName = DOMAINS.find((d) => d.id === domainId)?.name ?? domainId;

  const callText = transcript
    .slice(0, MAX_TURNS)
    .map((t) => `${t.role === 'patient' ? 'Patient' : 'Navigator'}: ${String(t.text ?? '').slice(0, MAX_TURN_CHARS)}`)
    .join('\n');

  const deptLabel = departmentName(department);

  const systemInstruction =
`You are an expert supervisor reviewing a patient navigator's practice call at the Aizer Health \
${deptLabel} contact centre. Your job is to grade how well the navigator followed standard \
operating procedures, communicated professionally, gathered the right information, and directed \
the caller appropriately.

${navigatorContextBlock({ department, mode: 'practice-grading' })}

Scoring guide (0–100):
  90–100  Excellent: near-perfect SOP adherence, clear and professional throughout.
  75–89   Good: correct outcome, minor gaps in process or communication.
  60–74   Acceptable: core issue handled but meaningful SOP steps missed.
  40–59   Developing: some correct instincts but significant procedural gaps.
  0–39    Needs support: incorrect routing, missing critical steps, or miscommunication.

Rules:
- Base your assessment ONLY on the SOP context provided — do not invent criteria.
- Be specific: reference actual lines from the transcript when noting strengths or gaps.
- Strengths: 2–4 bullet points on what the navigator did well.
- Improvements: 2–4 specific, actionable bullet points on what to do differently next time.
- Summary: 2–3 sentences overall assessment addressed to the navigator ("you").
- Do not grade lookup order itself as right or wrong; judge whether the navigator confirmed the
  correct patient, caller authorization, and chart before acting.
- For standard refill calls, focus on medication name, preferred pharmacy, out-of-med priority,
  correct routing, no clinical advice, and no promised approval. Do NOT require PE verification
  or say the refill cannot be processed because PE is not current unless the scenario explicitly
  makes PE status the governing rule.
- "findings" (optional): a short array assessing the navigator per area. For each area that the
  call actually exercised, give area (one of ${FINDING_AREAS.join(', ')}), verdict (met/partial/
  missed), a brief "evidence" quote from the transcript, and one line of "coaching". Skip areas
  the call did not exercise. This is supplementary — still fill score/summary/strengths/improvements.

SOP CONTEXT:
${sopContext}`;

  const userMessage =
`Navigator: ${name}
Domain practised: ${domainName}
Scenario: ${scenario}

Full call transcript:
${callText}

Grade this practice call. Return score (integer 0–100), summary, strengths array, improvements array, and (optionally) a findings array of per-area assessments.`;

  return { systemInstruction, userMessage };
}

function buildBody(systemInstruction, userMessage) {
  return {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.3,
    },
  };
}

// Clamp score to 0–100 and coerce required fields to safe strings/arrays.
// Exported pure so the coercion contract is unit-testable like its siblings'.
export function coerceGrade(parsed) {
  const grade = {
    score:        Math.min(100, Math.max(0, Math.round(Number(parsed?.score) || 0))),
    summary:      typeof parsed?.summary === 'string' ? parsed.summary.trim()          : '',
    strengths:    Array.isArray(parsed?.strengths)    ? parsed.strengths.map(String)    : [],
    improvements: Array.isArray(parsed?.improvements) ? parsed.improvements.map(String) : [],
  };
  const findings = coerceFindings(parsed?.findings);
  if (findings.length) grade.findings = findings; // omit when empty so old shape is unchanged
  return grade;
}

// Keep only well-formed findings with a known area + verdict. Exported-adjacent
// helper; validated defensively even though the schema constrains the shape.
export function coerceFindings(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => {
      const area = String(f?.area ?? '').trim();
      const verdict = String(f?.verdict ?? '').trim();
      if (!FINDING_AREAS.includes(area) || !FINDING_VERDICTS.includes(verdict)) return null;
      return {
        area,
        verdict,
        evidence: typeof f?.evidence === 'string' ? f.evidence.trim() : '',
        coaching: typeof f?.coaching === 'string' ? f.coaching.trim() : '',
      };
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (validateSecret(req, res)) return;

  const keys = getApiKeys();
  if (!keys.length) return res.status(500).json({ error: 'Grading is not configured on the server.' });

  const { domain, scenario, transcript, name, department = 'pediatrics' } = req.body ?? {};

  if (!domain || !scenario || !Array.isArray(transcript) || transcript.length === 0 || !name) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const { systemInstruction, userMessage } = buildMessages(domain, scenario, transcript, name, department, await sopContextForFresh(department));
  const body = buildBody(systemInstruction, userMessage);

  const result = await geminiWithRotation(keys, body, { label: 'grade-interview', models: [MODEL, LITE_MODEL] });
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

  return res.status(200).json({ grade: coerceGrade(parsed) });
}
