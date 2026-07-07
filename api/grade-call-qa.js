// ─────────────────────────────────────────────────────────────────────────────
// POST /api/grade-call-qa — hard, rubric-based QA grading of a voice test call.
//
// Unlike /api/grade-interview (holistic advisory 0–100), this endpoint grades
// against the Aizer Health Navigator Quality Guide as a fixed checklist:
// Gemini returns ONLY per-criterion binary verdicts (MET / NOT_MET / NA) with
// verbatim evidence quotes at temperature 0; all trust gates and the score /
// pass-fail math run deterministically in _qa-rubric.js. The model never
// outputs a number.
//
// Returns { qa: {score, rawScore, pass, passThreshold, categories, criteria,
// autoFails}, grade: {score, summary, strengths, improvements} } — `grade` is
// the projection stored on the interview doc so the existing supervisor panel
// renders QA tests with zero changes.
//
// Scored output → NO lite-model fallback (same quality gate as grade-interview).
// ─────────────────────────────────────────────────────────────────────────────

import { sopContextFor, sopContextForFresh } from './_sop-context.js';
import { correctTranscriptWithStats, glossaryPromptBlock } from './_qa-glossary.js';
import { getApiKeys, geminiWithRotation, rotationFailure } from './_gemini-client.js';
import { validateSecret } from './_auth.js';
import {
  QA_RUBRIC, QA_AUTO_FAILS, rubricCriteria,
  validateQaResponse, scoreQa, assessQa, buildGradeProjection,
} from './_qa-rubric.js';

const MAX_TURNS = 60;
const MAX_TURN_CHARS = 2000;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    criteria: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id:       { type: 'STRING' },
          verdict:  { type: 'STRING', enum: ['MET', 'NOT_MET', 'NA'] },
          evidence: { type: 'STRING' },
          note:     { type: 'STRING' },
        },
        required: ['id', 'verdict', 'evidence', 'note'],
      },
    },
    autoFails: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id:        { type: 'STRING' },
          triggered: { type: 'BOOLEAN' },
          evidence:  { type: 'STRING' },
          note:      { type: 'STRING' },
        },
        required: ['id', 'triggered', 'evidence', 'note'],
      },
    },
  },
  required: ['criteria', 'autoFails'],
};

export function buildMessages(scenario, transcript, department, sopContext = sopContextFor(department)) {
  const callText = transcript
    .slice(0, MAX_TURNS)
    .map((t) => `${t.role === 'patient' ? 'Caller' : 'Navigator'}: ${String(t.text ?? '').slice(0, MAX_TURN_CHARS)}`)
    .join('\n');

  const rubricText = QA_RUBRIC
    .map((cat) => `${cat.name}:\n${cat.criteria.map((c) => `  - [${c.id}] ${c.text}`).join('\n')}`)
    .join('\n');
  const autoFailText = QA_AUTO_FAILS.map((a) => `  - [${a.id}] ${a.text}`).join('\n');

  const systemInstruction =
`You are a strict QA auditor at a medical contact centre, scoring a patient navigator's call \
against a fixed quality rubric. You do NOT assign scores. For EACH rubric criterion you return \
exactly one verdict:

  MET      — the transcript clearly shows the behavior. You MUST put ONE contiguous verbatim \
quote from a SINGLE turn in "evidence" — copied character-for-character, no role label, no \
ellipses, no stitching lines together. For behaviors shown across the whole call, quote the \
single best example line.
  NOT_MET  — the behavior is absent, wrong, or only partial. Put a one-sentence reason in \
"note"; "evidence" may quote the offending line or be empty if the failure is an absence.
  NA       — the criterion genuinely cannot apply to this scenario (e.g., no appointment was \
needed, so no recap was possible). Use sparingly; greeting, verification, tone, listening, and \
closing criteria apply to EVERY call.

Grading rules — this is a hard test, apply them strictly:
- Judge ONLY what is in the transcript. If the navigator did not say it, it did not happen.
- Do not give benefit of the doubt: partial or implied compliance is NOT_MET.
- Verdicts must be evidence-based. If you cannot quote a real line for MET, the verdict is NOT_MET.
- For SOP-knowledge criteria, judge correctness against the SOP CONTEXT below — never invent rules.
- In "note", when a criterion is NOT_MET for an SOP-related reason, NAME the specific SOP rule or \
workflow principle involved (e.g., "refill TEs go to the PEDS Encounters queue, HIGH PRIORITY when \
the patient is out") so a supervisor can coach from it. Never leave an SOP-related note vague.

CONTEXT-AWARE JUDGMENT — the correct action depends on the CALL'S CONTEXT, not on keywords. \
Before judging routing, scheduling, escalation, or knowledge criteria, establish from the \
scenario and transcript: who the patient is (pediatric vs adult; new vs established; one child \
vs several), what they are actually asking for (scheduling vs clinical question vs refill vs lab \
result vs urgent issue), and which department's rules govern. The SAME navigator action can be \
correct in one context and a violation in another:
- Routing depends on patient state (e.g., in OB/GYN, a pregnancy-related call routes differently \
from a non-pregnant GYN issue or an established MFM patient — apply the department's routing \
table from the SOP CONTEXT, not a generic rule).
- A refill request is complete only when the required details are gathered per the SOP \
(medication, and whether the patient is out — which changes priority).
- A lab-result call is handled correctly ONLY by routing per the SOP; any interpretation, \
reading, or reassurance about the result content is a violation regardless of phrasing.
- Escalation judgment: if the scenario contains an urgent, emergent, or escalation-matrix \
trigger, failing to escalate is a knowledge failure even if the rest of the call is polite \
and orderly. Conversely, do not demand escalation the SOP does not require.
- Multiple patients on one call (e.g., a parent calling about several children): each child's \
request must be handled per the SOP; verify the navigator did not conflate them.

FAIRNESS RULES — apply these BEFORE marking a criterion NOT_MET. They scope the strictness \
above so a navigator is never failed for something they actually did right:
- Transcription tolerance: this transcript is auto-generated from a phone call and may mis-spell \
proper nouns (organization, locations, provider or queue names) or numbers. Judge whether the \
navigator conveyed the CORRECT entity or rule — never fail a criterion only because a name, \
place, or term looks mis-transcribed or was said as a valid synonym (see the vocabulary below).
- Natural closings count: for the closing pleasantry criteria, a courteous natural wrap-up is \
enough. If the caller has already said thanks or goodbye and the navigator responds in kind, or \
the navigator gives any polite sign-off, treat the closing pleasantry as MET even without the \
exact scripted phrase. Do not require rote wording.
These two carve-outs apply ONLY to closing pleasantries and mis-transcribed / synonymous terms. \
Verification, privacy/scope, routing, scheduling, and SOP-knowledge criteria stay strict.

Separately, check the auto-fail conditions. Set "triggered": true ONLY if the transcript \
contains an explicit violation, and quote the offending navigator line verbatim in "evidence". \
When in doubt, triggered is false.

RUBRIC CRITERIA:
${rubricText}

AUTO-FAIL CONDITIONS:
${autoFailText}

${glossaryPromptBlock(department)}

SOP CONTEXT:
${sopContext}`;

  const userMessage =
`Scenario the caller was given:
${scenario}

Full call transcript:
${callText}

Return a verdict object for ALL ${rubricCriteria().length} criteria ids and all ${QA_AUTO_FAILS.length} auto-fail ids.`;

  return { systemInstruction, userMessage };
}

function buildBody(systemInstruction, userMessage) {
  return {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (validateSecret(req, res)) return;

  const keys = getApiKeys();
  if (!keys.length) return res.status(500).json({ error: 'Grading is not configured on the server.' });

  const { scenario, transcript: rawTranscript, department = 'pediatrics' } = req.body ?? {};

  if (!scenario || !Array.isArray(rawTranscript) || rawTranscript.length === 0) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // Snap mis-transcribed SOP proper nouns/terms to their canonical form BEFORE
  // grading, so both the model's judgment and the evidence-verification gate see
  // what the navigator actually said (bounded to the glossary — never invents).
  // The correction count doubles as a transcript-quality signal for the review layer.
  const { transcript, correctedTurns } = correctTranscriptWithStats(rawTranscript, department);

  const { systemInstruction, userMessage } = buildMessages(scenario, transcript, department, await sopContextForFresh(department));
  const body = buildBody(systemInstruction, userMessage);

  // One retry on malformed output: temp-0 structured JSON is almost always
  // well-formed, but a missing criterion id would otherwise 502 a real test.
  let validated = null;
  for (let attempt = 0; attempt < 2 && !validated; attempt++) {
    const result = await geminiWithRotation(keys, body, { label: 'grade-call-qa' });
    if (!result.ok) {
      const { status, error } = rotationFailure(result, { exhausted: 'The grader is busy right now. Try again shortly.' });
      return res.status(status).json({ error });
    }
    let parsed;
    try {
      parsed = JSON.parse(result.text ?? '');
    } catch {
      continue;
    }
    const check = validateQaResponse(parsed);
    if (check.data) validated = check.data;
    else console.warn(`grade-call-qa: invalid response (attempt ${attempt + 1}): ${check.error}`);
  }
  if (!validated) {
    return res.status(502).json({ error: 'The grader returned an unusable review. Try again.' });
  }

  const boundedTranscript = transcript
    .slice(0, MAX_TURNS)
    .map((t) => ({ role: t.role, text: String(t.text ?? '').slice(0, MAX_TURN_CHARS) }));
  const scored = scoreQa(validated.criteria, validated.autoFails, boundedTranscript);
  // Deterministic confidence / supervisor-review layer: the AI result is
  // decision support — borderline scores, questionable transcripts, and
  // unconfirmed safety reports are flagged instead of silently pass/failed.
  const review = assessQa(scored, boundedTranscript, { correctedTurns });
  const qa = { ...scored, review, correctedTurns };
  const grade = buildGradeProjection(qa);

  return res.status(200).json({ qa, grade });
}
