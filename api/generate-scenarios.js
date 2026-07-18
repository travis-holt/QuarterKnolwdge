// ─────────────────────────────────────────────────────────────────────────────
// POST /api/generate-scenarios — serverless Gemini proxy (Vercel).
//
// Generates draft scenario MCQs from the SOP for one domain. Gemini API keys live
// ONLY in this server-side function and never reach the browser. Multiple keys may
// be supplied (env GEMINI_API_KEYS, comma-separated; or a single GEMINI_API_KEY);
// the function rotates to the next key whenever one is rate-limited / quota-
// exhausted, maximising the free-tier budget. This is a SUPERVISOR-ONLY authoring
// endpoint: it is gated by `validateSession` (a valid server-issued HttpOnly
// session cookie from /api/supervisor-login), NOT the old public passcode. The
// legacy `body.secret` value is accepted only when ALLOW_LEGACY_API_SECRET=true.
//
// Returns validated drafts: { questions: [...] }. It does NOT touch Firestore —
// the client persists the drafts via db.saveDraftQuestions, keeping db.js the
// single data surface. Output is validated/repaired before returning so a
// malformed model response can't poison the question bank.
// ─────────────────────────────────────────────────────────────────────────────

import { DOMAINS } from '../src/data/questions.js';
import { COMPETENCIES } from '../src/data/competencies.js';
import { validateQuestionContent } from '../src/lib/contentGuards.js';
import { sopContextFor, sopGroundingForFresh } from './_sop-context.js';
import {
  OBGYN_RULE_SET_VERSION,
  formatObgynRulesForPrompt,
  obgynRulesFor,
} from '../src/data/obgynWorkflowRules.js';
import { navigatorContextBlock } from './_navigator-operating-model.js';
import { getApiKeys, geminiWithRotation, rotationFailure, MODEL, STABLE_MODEL } from './_gemini-client.js';
import { validateSession } from './_auth.js';

const COMPETENCY_IDS = new Set(COMPETENCIES.map((c) => c.id));
const LETTERS = ['a', 'b', 'c', 'd', 'e'];

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      scenario: { type: 'STRING' },
      workflowType: { type: 'STRING' },
      ruleIds: { type: 'ARRAY', items: { type: 'STRING' } },
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
    required: ['scenario', 'workflowType', 'ruleIds', 'competencies', 'options', 'correctOptionId'],
  },
};

export function buildPrompt(domain, count, department, sopContext = sopContextFor(department), rules = []) {
  const compList = COMPETENCIES.map((c) => `${c.id} (${c.name})`).join(', ');
  const ruleBlock = rules.length
    ? `\nSELECTED EXECUTABLE RULES (each question must test one or more and return its exact ruleIds/workflowType):\n${formatObgynRulesForPrompt(rules)}\n`
    : '';
  return `You are an instructional designer writing a competency assessment for patient
navigators (contact-centre agents) based ONLY on the SOP reference below. Do not invent
facts that are not supported by it.

${navigatorContextBlock({ department, mode: 'scenario-generation' })}

SOP REFERENCE:
${sopContext}
${ruleBlock}

TASK: Write ${count} scenario-based multiple-choice question(s) for the domain "${domain.name}"
(${domain.blurb}). Mix NORMAL, EDGE-CASE, and FAILURE-STATE situations. Each question must:
- Present a realistic caller situation, then ask what the navigator should do.
- Have 4 options. Exactly ONE option is the best answer with points = 100. The other three
  carry partial credit from 0–60 reflecting how defensible they are (a dangerous or
  compliance-violating choice = 0–10; a plausible-but-suboptimal choice = 30–60).
- Give EVERY option a one-sentence "rationale" explaining why it is right or wrong, grounded
  in the SOP.
- Set "correctOptionId" to the id of the 100-point option.
- Return "workflowType" and "ruleIds" for the exact selected executable rule(s) tested.
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

CONTENT SAFETY RULES:
- Do not create questions where the only tested behavior is whether the navigator asked for
  phone number before date of birth, or date of birth before phone number.
- If a scenario mentions lookup fields, the graded issue must be objective safety: correct
  patient, correct chart, caller authorization, sibling/family-account safety, or no duplicate chart.
- For standard refill scenarios, do NOT require PE verification or say the refill cannot be
  processed because PE is not current. Test the real refill workflow instead: medication name,
  preferred pharmacy, out-of-med priority, correct TE routing, no clinical advice, and no
  promised approval.

Option ids must be "a","b","c","d". Do not include a domain field. Return ONLY the JSON array.`;
}

// Coerce one raw model question into the strict app shape, or return null if it
// cannot be repaired into something valid.
export function sanitize(raw, domainId, metadata = {}) {
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
  const allowedRuleIds = new Set(metadata.allowedRuleIds ?? []);
  const ruleIds = [...new Set(Array.isArray(raw.ruleIds) ? raw.ruleIds.map((id) => String(id).trim()) : [])]
    .filter((id) => !allowedRuleIds.size || allowedRuleIds.has(id));
  if (metadata.department === 'obgyn' && (!ruleIds.length || ruleIds.length !== raw.ruleIds?.length)) return null;
  const workflowType = String(raw.workflowType ?? metadata.workflowType ?? '').trim();
  if (metadata.department === 'obgyn') {
    const rules = obgynRulesFor({ ruleIds });
    if (!rules.length || rules.some((item) => item.workflowType !== workflowType)) return null;
  }
  const question = {
    domainId,
    department: metadata.department ?? raw.department ?? 'pediatrics',
    competencies: [...new Set(competencies)].slice(0, 3),
    scenario: raw.scenario.trim(),
    options,
    correctOptionId: options[bestIdx].id,
    sourceSopVersion: metadata.sourceSopVersion ?? null,
    sourceRuleVersion: metadata.sourceRuleVersion ?? null,
    ruleIds,
    workflowType: workflowType || `general_${domainId}`,
    sourceAuthority: metadata.sourceAuthority ?? 'department-sop',
  };
  return validateQuestionContent(question).length ? null : question;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (await validateSession(req, res)) return; // supervisor-only authoring endpoint

  const keys = getApiKeys();
  if (!keys.length) {
    return res.status(500).json({ error: 'Generation is not configured on the server.' });
  }

  const { domainId, count = 3, department = 'pediatrics', workflowType, ruleIds = [] } = req.body ?? {};

  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) return res.status(400).json({ error: 'Unknown domain.' });
  const n = Math.max(1, Math.min(8, Number(count) || 1));
  const requestedRuleIds = Array.isArray(ruleIds) ? ruleIds.map(String) : [];
  const selectedRules = department === 'obgyn'
    ? obgynRulesFor({ department, domainId, workflowType, ruleIds: requestedRuleIds })
    : [];
  if (department === 'obgyn' && requestedRuleIds.some((id) => !selectedRules.some((rule) => rule.id === id))) {
    return res.status(400).json({ error: 'Unknown or out-of-scope OB/GYN rule id.' });
  }
  if (department === 'obgyn' && !selectedRules.length) {
    return res.status(400).json({ error: 'No OB/GYN workflow rules match this request.' });
  }
  const grounding = await sopGroundingForFresh(department);

  const requestBody = {
    contents: [{ parts: [{ text: buildPrompt(domain, n, department, grounding.context, selectedRules) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.7,
    },
  };

  const result = await geminiWithRotation(keys, requestBody, { label: 'generate-scenarios', models: [MODEL, STABLE_MODEL] });
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
    .map((q) => sanitize(q, domainId, {
      department,
      workflowType,
      allowedRuleIds: selectedRules.map((rule) => rule.id),
      sourceSopVersion: grounding.sourceSopVersion,
      sourceRuleVersion: department === 'obgyn' ? OBGYN_RULE_SET_VERSION : null,
      sourceAuthority: grounding.sourceAuthority,
    }))
    .filter(Boolean);

  if (questions.length === 0) {
    return res.status(422).json({ error: 'No valid scenarios were produced. Try again.' });
  }

  return res.status(200).json({ questions });
}
