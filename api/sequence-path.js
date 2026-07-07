// POST /api/sequence-path
// Input:  { weakDomains:[{domainId,level,currentScore}], department, name, secret }
// Output: { paths:[{domainId,steps:[{kind,rationale}]}] }
// Advisory: if Gemini fails or output is invalid, callers fall back to the deterministic order.

import { validateSecret } from './_auth.js';
import { geminiWithRotation, getApiKeys, rotationFailure } from './_gemini-client.js';
import { sopContextForFresh } from './_sop-context.js';

const VALID_KINDS = ['coaching', 'practice', 'interview', 'module', 'minicheck'];

export function validateSequenceResponse(parsed) {
  if (!Array.isArray(parsed?.paths)) return { error: 'missing paths array' };
  for (const path of parsed.paths) {
    if (typeof path.domainId !== 'string') return { error: 'path missing domainId' };
    if (!Array.isArray(path.steps) || path.steps.length === 0) return { error: 'path missing steps' };
    for (const step of path.steps) {
      if (!VALID_KINDS.includes(step.kind)) return { error: `invalid step kind: ${step.kind}` };
      if (typeof step.rationale !== 'string' || step.rationale.length < 5) {
        return { error: 'step missing rationale' };
      }
    }
  }
  return { data: parsed };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (validateSecret(req, res)) return;

  const { weakDomains = [], department = 'pediatrics', name = 'the navigator', completions = [], interviews = [] } = req.body ?? {};
  if (!weakDomains.length) return res.status(400).json({ error: 'weakDomains required' });

  const keys = getApiKeys();
  if (!keys.length) return res.status(500).json({ error: 'AI sequencing is not configured on the server.' });

  const sopContext = await sopContextForFresh(department);

  const domainList = weakDomains
    .map((d) => `• domainId="${d.domainId}", level=${d.level}, score=${d.currentScore}%`)
    .join('\n');
  const learningEvidence = [
    completions.length > 0 ? `Completed steps: ${completions.slice(0, 10).map((c) => `${c.domainId}:${c.kind ?? 'practice'}`).join(', ')}` : '',
    interviews.length > 0 ? `Practice calls: ${interviews.slice(0, 8).map((iv) => `${iv.domainId}:${iv.grade?.score ?? 'ungraded'}/100`).join(', ')}` : '',
  ].filter(Boolean).join('\n') || 'No completion or practice-call evidence provided.';

  const prompt = `You are a clinical learning advisor for a contact-centre patient navigator team.

Navigator: ${name}
Domains needing development:
${domainList}

Stored learning evidence:
${learningEvidence}

SOP reference (for grounding):
${sopContext.slice(0, 3000)}

Your task: for each domain, sequence the five development steps in the most effective order:
- coaching: reflect on the scoring feedback (always beneficial, often first)
- practice: "Spot the Error" QA audit (active learning, reinforces rules)
- interview: practice handling a patient call in text or voice
- module: read the training module content (knowledge building)
- minicheck: a 4-question re-validation quiz (confirm mastery before advancing)

Adapt the order based on the navigator's current score and level. For example:
- Very low score (Learning, < 50%): coaching → practice → module → interview → minicheck
- Mid Learning (50–59%): practice → module → interview → coaching → minicheck (active first)
- Solid: module → interview → minicheck → coaching → practice (stretch approach)

Also adapt based on stored learning evidence: do not put an already completed step first unless repetition is clearly useful, and explain when a weak interview score should move call practice earlier.

Respond ONLY with valid JSON matching this schema exactly:
{
  "paths": [
    {
      "domainId": "<same string as input>",
      "steps": [
        { "kind": "coaching|practice|interview|module|minicheck", "rationale": "<one sentence why this step is best here>" },
        ...
      ]
    }
  ]
}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
    },
  };

  const result = await geminiWithRotation(keys, body, { label: 'sequence-path' });
  if (!result.ok) {
    // fatal → 502, auth → 500, exhausted → 429 (previously every non-fatal
    // failure fell to 502 because auth/exhausted results carry no `.status`).
    const { status, error } = rotationFailure(result, { fatal: 'AI unavailable — use default path order' });
    return res.status(status).json({ error });
  }

  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return res.status(502).json({ error: 'Invalid AI response — use default path order' });
  }

  const { data, error } = validateSequenceResponse(parsed);
  if (error) return res.status(502).json({ error: `AI response invalid (${error}) — use default path order` });

  res.json(data);
}
