// ─────────────────────────────────────────────────────────────────────────────
// Caller role-break fail-safe (Call QA).
//
// The scored Call QA caller is an AI roleplaying a patient/caregiver. When it
// malfunctions and steps out of character — declaring it is an AI, acknowledging
// the simulation, or reciting an AI-policy medical/safety DISCLAIMER a real
// patient would never volunteer ("I'm required to tell you that I'm not a medical
// professional, and this isn't medical advice or a diagnosis. You should always
// see a healthcare professional…") — the transcript is no longer a valid basis
// for a CONFIDENT automatic verdict. The navigator did nothing wrong; the
// simulated patient did.
//
// This detector is DELIBERATELY NARROW. It is NOT a broad content classifier: it
// matches only explicit meta / AI / policy-disclaimer role-break language, and it
// runs ONLY on CALLER turns. It never fails the navigator — the caller behaving
// as a real patient (stating symptoms, worries, or what a clinician previously
// told them) is preserved. When it fires, the grading pipeline forces
// `needs_review` with a clear supervisor flag; it never changes a rubric verdict
// or a score.
//
// The leading `_` keeps Express from turning this module into an HTTP route.
// ─────────────────────────────────────────────────────────────────────────────

const CALLER_ROLES = new Set(['patient', 'caller']);

// High-precision role-break signatures. Each is anchored tightly enough that a
// legitimate patient statement does not match. Add a pattern only when it is an
// UNMISTAKABLE meta / AI / policy-disclaimer break.
const ROLE_BREAK_PATTERNS = [
  // AI / bot / model / non-human self-identification.
  { category: 'ai-self-identification', re: /\b(?:i am|i['’]m)\s+(?:an?\s+)?(?:ai|a\.?\s*i\.?|artificial intelligence|language model|large language model|chat\s*bot|bot|virtual assistant|computer program)\b/i },
  { category: 'ai-self-identification', re: /\bas an ai\b/i },
  { category: 'ai-self-identification', re: /\bi(?:['’]m| am)\s+not\s+a\s+real\s+(?:person|patient|human|caller)\b/i },
  // Acknowledging the simulation / training / roleplay.
  { category: 'simulation-acknowledgment', re: /\bthis (?:is|was)\s+(?:just\s+)?(?:a\s+)?(?:simulation|role[\s-]?play|training (?:exercise|scenario|call|session)|test scenario|scripted (?:call|scenario))\b/i },
  { category: 'simulation-acknowledgment', re: /\bi(?:['’]m| am)\s+(?:just\s+)?(?:role[\s-]?playing|simulating|a (?:simulated|roleplay(?:ed)?) (?:patient|caller|person))\b/i },
  // AI-policy meta framing a real patient never volunteers.
  { category: 'policy-disclaimer', re: /\bi(?:['’]m| am)\s+required to (?:tell|inform|remind|let)\s+you\b/i },
  // Medical/legal safety disclaimers.
  { category: 'safety-disclaimer', re: /\b(?:this|that|it)\s+(?:is|isn['’]t|is not|['’]s)\s+(?:not\s+)?(?:medical|legal|professional)\s+advice\b/i },
  { category: 'safety-disclaimer', re: /\bnot\s+(?:medical|legal)\s+advice\s+or\s+a\s+diagnosis\b/i },
  { category: 'safety-disclaimer', re: /\bi\s+can(?:not|['’]t)\s+(?:provide|give|offer)\s+(?:medical|legal)\s+advice\b/i },
  { category: 'safety-disclaimer', re: /\bi(?:['’]m| am)\s+not\s+a\s+(?:medical professional|doctor|nurse|physician|clinician|healthcare (?:provider|professional))\b/i },
  // Telling the listener to seek professional care (patient-as-safety-assistant).
  { category: 'safety-disclaimer', re: /\b(?:you should|please|always)\b[^.?!]{0,40}\b(?:see|consult|contact|seek(?:\s+care\s+from)?)\b[^.?!]{0,30}\b(?:healthcare|health care|medical)\s+(?:professional|provider|practitioner)\b/i },
  { category: 'safety-disclaimer', re: /\b(?:always\s+)?(?:see|consult|contact|talk to)\s+a\s+(?:qualified\s+)?(?:healthcare|health care|medical)\s+(?:professional|provider|practitioner)\b/i },
];

/**
 * Scan the CALLER turns of a transcript for an explicit role break.
 *
 * @param {{role?:string, text?:string}[]} transcript
 * @returns {{ detected: boolean, category: string|null, evidence: string|null, turnIndex: number|null }}
 */
export function detectCallerRoleBreak(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    if (!turn || !CALLER_ROLES.has(turn.role)) continue;
    const text = String(turn.text ?? '');
    if (!text.trim()) continue;
    for (const { category, re } of ROLE_BREAK_PATTERNS) {
      if (re.test(text)) {
        return { detected: true, category, evidence: text.slice(0, 400), turnIndex: index };
      }
    }
  }
  return { detected: false, category: null, evidence: null, turnIndex: null };
}
