// POST /api/refine-sop — AI assistance for the F24 SOP manager. Two modes:
//
//   build  — { mode:'build', rawText | file, department, secret }
//            Structures a raw operational document into a clean SOP organised
//            around the 6 navigator domains.
//            → { sop: { title, body, notes: string[], audit } }
//
//   refine — { mode:'refine', rawText | file, currentSop, department, secret }
//            Compares new material (updated guide, Teams announcement, floor
//            rule change) against the CURRENT active SOP and proposes a merged
//            draft, flagging every difference.
//            → { sop: { title, body, changes: [{ type, summary }], audit } }
//
// SOURCE INPUT: either `rawText` (pasted) or `file` — { data: <base64>,
// mimeType: 'application/pdf' }. PDFs are passed to Gemini natively as a
// document part (handles scanned/complex PDFs better than text extraction).
//
// FIDELITY AUDIT: after a valid draft is produced, a second Gemini pass
// compares the draft against the source and reports `audit = { omissions,
// inventions }` — source rules missing from the draft, and draft statements
// not traceable to the source. Best-effort: audit failure returns null and
// never blocks the draft. This is the trust layer for "Build with AI".
//
// ADVISORY ONLY: output is always saved as a DRAFT the supervisor reviews and
// activates — this endpoint never touches Firestore itself.

import { validateSecret } from './_auth.js';
import { geminiWithRotation, getApiKeys } from './_gemini-client.js';

const MODEL = 'gemini-2.5-flash';
const MAX_INPUT_CHARS = 48_000; // bounds the token budget + prompt-injection surface
const MAX_FILE_BASE64 = 14_000_000; // ~10 MB binary
const FILE_MIME_TYPES = new Set(['application/pdf']);
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

/** Pure validation of an uploaded source file. Returns an error string or null. */
export function validateSopFile(file) {
  if (!file || typeof file !== 'object') return 'file missing';
  if (!FILE_MIME_TYPES.has(file.mimeType)) return 'unsupported file type — PDF only';
  if (typeof file.data !== 'string' || file.data.length < 100) return 'file data missing';
  if (file.data.length > MAX_FILE_BASE64) return 'file too large (max ~10 MB)';
  return null;
}

/**
 * Pure normalisation of the fidelity-audit response.
 * Returns { omissions, inventions } (each ≤ 20 trimmed strings) or null when
 * the response is unusable — callers treat null as "audit unavailable".
 */
export function validateSopAudit(parsed) {
  const a = parsed?.audit ?? parsed;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  if (!Array.isArray(a.omissions) || !Array.isArray(a.inventions)) return null;
  const clean = (arr) =>
    arr.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 300)).slice(0, 20);
  return { omissions: clean(a.omissions), inventions: clean(a.inventions) };
}

/**
 * Pure validation of the Gemini draft response for both modes.
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

/** One Gemini JSON call with the shared rotation. Returns { parsed } or { failed }. */
async function geminiJson(keys, parts, { label, temperature }) {
  const body = {
    model: MODEL,
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, responseMimeType: 'application/json' },
  };
  const result = await geminiWithRotation(keys, body, { label });
  if (!result.ok) return { failed: result };
  try {
    return { parsed: JSON.parse(result.text) };
  } catch {
    return { failed: { ok: false, reason: 'fatal', status: 502 } };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (validateSecret(req, res)) return;

  const { mode, rawText = '', currentSop = '', department = 'pediatrics', file = null } = req.body ?? {};
  if (mode !== 'build' && mode !== 'refine') {
    return res.status(400).json({ error: "mode must be 'build' or 'refine'" });
  }

  // Source material: an uploaded PDF (native Gemini document part) or pasted text.
  let sourceParts;
  if (file) {
    const fileErr = validateSopFile(file);
    if (fileErr) return res.status(400).json({ error: fileErr });
    sourceParts = [{ inlineData: { mimeType: file.mimeType, data: file.data } }];
  } else {
    if (typeof rawText !== 'string' || rawText.trim().length < 100) {
      return res.status(400).json({ error: 'rawText or file required (at least a few paragraphs)' });
    }
    sourceParts = [{ text: `SOURCE DOCUMENT:\n${rawText.slice(0, MAX_INPUT_CHARS)}` }];
  }
  if (mode === 'refine' && (typeof currentSop !== 'string' || currentSop.trim().length < 100)) {
    return res.status(400).json({ error: 'currentSop required for refine mode' });
  }

  const keys = getApiKeys();

  const instruction =
    mode === 'build'
      ? `You are an operations documentation specialist for a healthcare contact centre.
Restructure the source document above into a clean, complete SOP for the
"${department}" department's patient navigators (non-clinical inbound call handlers).

Rules:
- Preserve EVERY operational rule, name, extension, timing window, and constraint exactly as
  written — never invent, soften, or drop a rule.
- Plain text only (no markdown syntax). Keep it scannable: short lines, one rule per line.
- If the document is ambiguous or contradicts itself, keep the rule as written and add a note.

${SECTION_GUIDE}

Respond ONLY with valid JSON matching this schema exactly:
{ "sop": { "title": "<short SOP title incl. department>", "body": "<the full structured SOP text>", "notes": ["<ambiguity or gap worth the supervisor's attention>", ...] } }`
      : `You are an operations documentation specialist for a healthcare contact centre.
Above is NEW MATERIAL (an updated guide, announcement, or floor-rule change). Below is the
CURRENT active SOP for the "${department}" department's patient navigators.

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

CURRENT SOP:
${currentSop.slice(0, MAX_INPUT_CHARS)}

Respond ONLY with valid JSON matching this schema exactly:
{ "sop": { "title": "<short SOP title incl. department>", "body": "<the full merged SOP text>", "changes": [{ "type": "contradiction|outdated|addition|clarification", "summary": "<one sentence describing the change>" }, ...] } }`;

  const draftCall = await geminiJson(keys, [...sourceParts, { text: instruction }], {
    label: `refine-sop:${mode}`,
    temperature: 0.2,
  });
  if (draftCall.failed) {
    return res.status(draftCall.failed.status ?? 502).json({ error: 'AI unavailable — try again shortly' });
  }

  const { data, error } = validateSopRefineResponse(draftCall.parsed, mode);
  if (error) return res.status(502).json({ error: `AI response invalid (${error}) — try again` });

  // Fidelity audit (best-effort second pass): compare the draft against the
  // source and surface omissions/inventions. Never blocks the draft.
  let audit = null;
  try {
    const auditInstruction = `You are auditing an AI-restructured SOP draft for FIDELITY against its source
material above${mode === 'refine' ? ' (the new material) and the current SOP below' : ''}.

Compare the DRAFT with the source. Report:
- "omissions": substantive operational rules present in the source but MISSING from the draft
  (briefly quote or paraphrase each).
- "inventions": statements in the draft NOT supported by the source.
Ignore formatting, re-ordering, section headings, and wording changes — only substantive rules
matter. Empty arrays mean full fidelity.
${mode === 'refine' ? `\nCURRENT SOP (also a valid source for draft content):\n${currentSop.slice(0, MAX_INPUT_CHARS)}\n` : ''}
DRAFT:
${data.body.slice(0, 40_000)}

Respond ONLY with valid JSON: { "omissions": ["..."], "inventions": ["..."] }`;
    const auditCall = await geminiJson(keys, [...sourceParts, { text: auditInstruction }], {
      label: 'refine-sop:audit',
      temperature: 0.1,
    });
    if (!auditCall.failed) audit = validateSopAudit(auditCall.parsed);
  } catch (err) {
    console.warn('refine-sop: fidelity audit failed (non-blocking):', err.message);
  }

  res.json({ sop: { ...data, audit } });
}