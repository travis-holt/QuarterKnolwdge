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

// ── TIER 1: unmistakable meta breaks (a SINGLE match is conclusive) ───────────
//
// Only language a real patient would never plausibly produce: declaring itself an
// AI/bot/model, or acknowledging the simulation/roleplay. Nothing here overlaps
// with ordinary patient speech, so one hit is enough.
const META_BREAK_PATTERNS = [
  // AI / bot / model / non-human self-identification.
  { category: 'ai-self-identification', re: /\b(?:i am|i['’]m)\s+(?:an?\s+)?(?:ai|a\.?\s*i\.?|artificial intelligence|language model|large language model|chat\s*bot|bot|virtual assistant|computer program)\b/i },
  { category: 'ai-self-identification', re: /\bas an ai\b/i },
  { category: 'ai-self-identification', re: /\bi(?:['’]m| am)\s+not\s+a\s+real\s+(?:person|patient|human|caller)\b/i },
  // Acknowledging the simulation / training / roleplay.
  { category: 'simulation-acknowledgment', re: /\bthis (?:is|was)\s+(?:just\s+)?(?:a\s+)?(?:simulation|role[\s-]?play|training (?:exercise|scenario|call|session)|test scenario|scripted (?:call|scenario))\b/i },
  { category: 'simulation-acknowledgment', re: /\bi(?:['’]m| am)\s+(?:just\s+)?(?:role[\s-]?playing|simulating|a (?:simulated|roleplay(?:ed)?) (?:patient|caller|person))\b/i },
];

// ── TIER 2: disclaimer signals (a single match is NOT conclusive) ─────────────
//
// Each signal below, ON ITS OWN, is something a REAL caller can legitimately say:
//
//   "I'm not a doctor, but I thought Dr. Weinstein said I needed a growth scan."
//   "I'm not a nurse, so I don't know what that order means."
//   "I'm required to tell you my insurance changed."
//   "My doctor told me to see a healthcare professional if the bleeding got worse."
//
// Treating any one of them as a role break would invalidate a perfectly good
// assessment and waste a navigator's real attempt — a far worse outcome than
// missing an occasional malfunction, because a supervisor still reviews every
// pilot call. A break is declared only when a caller turn stacks
// `MIN_DISCLAIMER_SIGNALS` DISTINCT signals, which is the structure of a recited
// AI-policy disclaimer and not of natural patient speech. The reproduced pilot
// line carries all four:
//
//   "I'm required to tell you that I'm not a medical professional, and this isn't
//    medical advice or a diagnosis. You should always see a healthcare
//    professional or seek care."
//
// Keep this list SHORT and high precision. Do not grow it into a regex catalogue.
const DISCLAIMER_SIGNALS = [
  // (a) Meta obligation framing ("I'm required to tell you that …").
  { id: 'obligation-framing', re: /\bi(?:['’]m| am)\s+(?:required|obligated)\s+to\s+(?:tell|inform|remind|let|advise)\s+you\b/i },
  { id: 'obligation-framing', re: /\bi\s+(?:must|have to)\s+(?:tell|inform|remind|advise)\s+you\s+that\s+i(?:['’]m| am)\s+not\b/i },
  // (b) Declaring oneself not a clinician.
  { id: 'not-a-clinician', re: /\bi(?:['’]m| am)\s+not\s+a\s+(?:medical professional|doctor|nurse|physician|clinician|healthcare (?:provider|professional))\b/i },
  // (c) "This is not medical/legal advice" / "not a diagnosis".
  { id: 'not-advice', re: /\b(?:this|that|it)\s+(?:is|isn['’]t|is not|['’]s)\s+(?:not\s+)?(?:medical|legal|professional)\s+advice\b/i },
  { id: 'not-advice', re: /\bnot\s+(?:medical|legal)\s+advice\s+or\s+a\s+diagnosis\b/i },
  { id: 'not-advice', re: /\bi\s+can(?:not|['’]t)\s+(?:provide|give|offer)\s+(?:medical|legal)\s+advice\b/i },
  // (d) A SECOND-PERSON DIRECTIVE to seek professional care. The directive is
  //     REQUIRED: reported speech ("my doctor told me to see a healthcare
  //     professional") is normal patient speech and must not signal anything.
  { id: 'seek-care-directive', re: /\b(?:you should|you need to|you must|please|always)\b[^.?!]{0,40}\b(?:see|consult|contact|seek)\b[^.?!]{0,30}\b(?:healthcare|health care|medical)\s+(?:professional|provider|practitioner)\b/i },
  { id: 'seek-care-directive', re: /\b(?:you should|you need to|you must|please)\b[^.?!]{0,40}\bseek\s+(?:immediate\s+)?(?:care|medical attention)\b/i },
];

// Two distinct signals in ONE caller turn. Fewer would fire on the natural
// sentences above; more would miss the reproduced disclaimer's shorter variants.
const MIN_DISCLAIMER_SIGNALS = 2;

/**
 * Scan the CALLER turns of a transcript for an explicit role break.
 *
 * Tier 1 (AI/simulation meta) fires on a single match. Tier 2 (safety/medical
 * disclaimers) fires only when one caller turn stacks at least
 * `MIN_DISCLAIMER_SIGNALS` DISTINCT disclaimer signals, so ordinary patient
 * speech ("I'm not a doctor, but …") never invalidates an assessment.
 *
 * @param {{role?:string, text?:string}[]} transcript
 * @returns {{ detected: boolean, category: string|null, evidence: string|null,
 *             turnIndex: number|null, signals: string[] }}
 */
export function detectCallerRoleBreak(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    if (!turn || !CALLER_ROLES.has(turn.role)) continue;
    const text = String(turn.text ?? '');
    if (!text.trim()) continue;

    for (const { category, re } of META_BREAK_PATTERNS) {
      if (re.test(text)) {
        return { detected: true, category, evidence: text.slice(0, 400), turnIndex: index, signals: [category] };
      }
    }

    const signals = [...new Set(
      DISCLAIMER_SIGNALS.filter(({ re }) => re.test(text)).map(({ id }) => id),
    )];
    if (signals.length >= MIN_DISCLAIMER_SIGNALS) {
      return {
        detected: true, category: 'policy-disclaimer',
        evidence: text.slice(0, 400), turnIndex: index, signals,
      };
    }
  }
  return { detected: false, category: null, evidence: null, turnIndex: null, signals: [] };
}
