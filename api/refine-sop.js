// POST /api/refine-sop — AI assistance for the F24 SOP manager. Two modes:
//
//   build  — { mode:'build', rawText, department, secret }
//            Structures a raw pasted operational document into a clean SOP
//            organised around the 6 navigator domains.
//            → { sop: { title, body, notes: string[] } }
//
//   refine — { mode:'refine', rawText, currentSop, department, secret }
//            Compares new material (updated guide, Teams announcement, floor
//            rule change) against the CURRENT active SOP and proposes a merged
//            draft, flagging every difference.
//            → { sop: { title, body, changes: [{ type, summary }] } }
//
// ADVISORY ONLY: output is always saved as a DRAFT the supervisor reviews and
// activates — this endpoint never touches Firestore itself.

import { validateSecret } from './_auth.js';
import { geminiWithRotation, getApiKeys } from './_gemini-client.js';

const MODEL = 'gemini-2.5-flash';
const MAX_INPUT_CHARS = 48_000; // bounds the token budget + prompt-injection surface
const CHANGE_TYPES = ['contradiction', 'outdated', 'addition', 'clarification'];

const SECTION_GUIDE = `Organise the SOP body under these section headings (plain text, one blank line
between sections; keep a section even if thin, noting what is missing):
1. CALL OPENING & IDENTIFICATION — lookup order, verification, family accounts
2. CALL CLASSIFICATION — request types and how to recognise each
3. ROUTING & ESCALATION — TE queues/owners, transfers, urgent escalation paths
4. SCHEDULING & APPOINTMENT RULES — visit types, timing windows, templates, approvals
5. SCOPE & PRIVACY — what staff must never do or disclose
6. DOCUMENTATION & FOLLOW-THROUGH — required TE fields, reason fields, entry conventions
7. REFERENCE — contacts, extensions, hours, anything that fits nowhere above`;

/**
 * Pure validation of the Gemini response for both modes.
 * Returns { data } with a normalised sop object, or { error }.
 */
export function validateSopRefineResponse(parsed, mode) {
  const sop = parsed?.sop;
  if (!sop || typeof sop !== 'object') return { error: 'missing sop object' };
  if (typeof sop.title !== 'string' || !sop.title.trim()) return { error: 'missing title' };
  if (typeof sop.body !== 'string' || sop.body.trim().length < 200) {
    return { error: 'body missing or too short' };
  }
  const out = { title: sop.title.trim().slice(0, 200), body: sop.body.trim() };
  if (mode === 'refine') {
    if (!Array.isArray(sop.changes)) return { error: 'missing changes array' };
    out.changes = [];
    for (const c of sop.changes) {
      if (!CHANGE_TYPES.includes(c?.type)) return { error: `invalid change type: ${c?.type}` };
      if (typeof c.summary !== 'string' || c.summary.trim().length < 5) {
        return { error: 'change missing summary' };
      }
      out.changes.push({ type: c.type, summary: c.summary.trim() });
    }
  } else {
    out.notes = Array.isArray(sop.notes)
      ? sop.notes.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim())
      : [];
  }
  return { data: out };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (validateSecret(req, res)) return;

  const { mode, rawText, currentSop = '', department = 'pediatrics' } = req.body ?? {};
  if (mode !== 'build' && mode !== 'refine') {
    return res.status(400).json({ error: "mode must be 'build' or 'refine'" });
  }
  if (typeof rawText !== 'string' || rawText.trim().length < 100) {
    return res.status(400).json({ error: 'rawText required (at least 100 characters)' });
  }
  if (mode === 'refine' && (typeof currentSop !== 'string' || currentSop.trim().length < 100)) {
    return res.status(400).json({ error: 'currentSop required for refine mode' });
  }

  const keys = getApiKeys();
  const material = rawText.slice(0, MAX_INPUT_CHARS);

  const prompt =
    mode === 'build'
      ? `You are an operations documentation specialist for a healthcare contact centre.
Restructure the raw operational document below into a clean, complete SOP for the
"${department}" department's patient navigators (non-clinical inbound call handlers).

Rules:
- Preserve EVERY operational rule, name, extension, timing window, and constraint exactly as
  written — never invent, soften, or drop a rule.
- Plain text only (no markdown syntax). Keep it scannable: short lines, one rule per line.
- If the document is ambiguous or contradicts itself, keep the rule as written and add a note.

${SECTION_GUIDE}

RAW DOCUMENT:
${material}

Respond ONLY with valid JSON matching this schema exactly:
{ "sop": { "title": "<short SOP title incl. department>", "body": "<the full structured SOP text>", "notes": ["<ambiguity or gap worth the supervisor's attention>", ...] } }`
      : `You are an operations documentation specialist for a healthcare contact centre.
Below are (A) the CURRENT active SOP for the "${department}" department's patient navigators
and (B) NEW MATERIAL (an updated guide, announcement, or floor-rule change).

Produce a merged, updated SOP draft:
- Where the new material CONTRADICTS the current SOP, the NEW material wins — and you must
  flag it as a "contradiction" change.
- Where a current rule is explicitly superseded or described as no longer practiced, flag
  "outdated" and remove/replace it.
- New rules absent from the current SOP are "addition"; rewording with no rule change is
  "clarification".
- Preserve every still-valid rule from the current SOP — never silently drop one.
- Plain text only (no markdown). Keep the current SOP's section structure (or, if it has
  none, use this guide):
${SECTION_GUIDE}

(A) CURRENT SOP:
${currentSop.slice(0, MAX_INPUT_CHARS)}

(B) NEW MATERIAL:
${material}

Respond ONLY with valid JSON matching this schema exactly:
{ "sop": { "title": "<short SOP title incl. department>", "body": "<the full merged SOP text>", "changes": [{ "type": "contradiction|outdated|addition|clarification", "summary": "<one sentence describing the change>" }, ...] } }`;

  const body = {
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };

  const result = await geminiWithRotation(keys, body, { label: 'refine-sop' });
  if (!result.ok) {
    return res.status(result.status ?? 502).json({ error: 'AI unavailable — try again shortly' });
  }

  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return res.status(502).json({ error: 'Invalid AI response — try again' });
  }

  const { data, error } = validateSopRefineResponse(parsed, mode);
  if (error) return res.status(502).json({ error: `AI response invalid (${error}) — try again` });

  res.json({ sop: data });
}
