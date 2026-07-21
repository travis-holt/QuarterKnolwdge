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
// autoFails, gradingMetadata}, grade: {score, summary, strengths, improvements} }
// — `grade` is the projection stored on the interview doc so the existing
// supervisor panel renders QA tests with zero changes.
//
// Scored output uses ONE pinned, auditable grader model (CALL_QA_GRADER_MODEL,
// default MODEL): it rotates across API keys but NEVER falls back to a different
// model, and a malformed-output retry reuses the same model. Deterministic rubric
// scoring remains the quality gate.
// ─────────────────────────────────────────────────────────────────────────────

import { sopContextFor, sopContextForFresh } from './_sop-context.js';
import { navigatorContextBlock } from './_navigator-operating-model.js';
import { correctTranscriptWithStats, glossaryPromptBlock } from './_qa-glossary.js';
import { getApiKeys, geminiWithRotation, rotationFailure, MODEL } from './_gemini-client.js';
import { validateSecret } from './_auth.js';
import {
  validateQaResponse, repairQaVerdictsForScenario, scoreQa, assessQa, buildGradeProjection,
  evaluateQaDeterministicFindings,
} from './_qa-rubric.js';
import {
  getQaRubricProfile, requireQaRubricProfile, UnsupportedQaDepartmentError,
} from '../src/data/qaRubricProfiles.js';
import { qaDomainScoreSummary } from '../src/lib/qaDomainScoring.js';
import { readFirebaseIdentity } from './_auth.js';
import { FirebaseAdminConfigError, getFirebaseAdmin } from './_firebase-admin.js';
import {
  CALL_QA_ASSESSMENT_TYPE, CALL_QA_CAPTURE_AUTHORITY, CAPTURE_STATUS, GRADING_STATUS,
  claimGradingLease, commitGrade, markGradeFailed, loadAttempt,
} from './_call-qa-attempts.js';
import { randomUUID } from 'node:crypto';
import { CALL_QA_PROMPT_VERSION } from './_qa-grading-versions.js';

const MAX_TURNS = 60;
const MAX_TURN_CHARS = 2000;

// Grader prompt version is shared with offline calibration provenance checks.
// The single source of truth lives in api/_qa-grading-versions.js.
export { CALL_QA_PROMPT_VERSION } from './_qa-grading-versions.js';

/**
 * The single, pinned model used to SCORE a Call QA test. Scored grading must be
 * auditable and calibrated against ONE model — no silent fallback to a
 * lower-quality model. Configurable via CALL_QA_GRADER_MODEL; defaults to the
 * calibrated primary model. Empty/whitespace config falls back to MODEL.
 * Key rotation across API keys still applies; model fallback does not.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function callQaGraderModel(env = process.env) {
  const configured = String(env?.CALL_QA_GRADER_MODEL ?? '').trim();
  return configured || MODEL;
}

export const DEFAULT_CALL_QA_GEMINI_ATTEMPT_TIMEOUT_MS = 40_000;
export const DEFAULT_CALL_QA_GEMINI_MAX_ATTEMPTS = 2;
export const DEFAULT_CALL_QA_GEMINI_TOTAL_DEADLINE_MS = 85_000;

function boundedInteger(value, fallback, min, max) {
  if (value == null || String(value).trim() === '') return fallback;
  const configured = Number(value);
  if (!Number.isFinite(configured)) return fallback;
  return Math.max(min, Math.min(max, Math.round(configured)));
}

export function callQaGeminiAttemptTimeoutMs(env = process.env) {
  return boundedInteger(
    env?.CALL_QA_GEMINI_ATTEMPT_TIMEOUT_MS,
    DEFAULT_CALL_QA_GEMINI_ATTEMPT_TIMEOUT_MS,
    10_000,
    60_000,
  );
}

export function callQaGeminiMaxAttempts(env = process.env) {
  return boundedInteger(
    env?.CALL_QA_GEMINI_MAX_ATTEMPTS,
    DEFAULT_CALL_QA_GEMINI_MAX_ATTEMPTS,
    1,
    3,
  );
}

export function callQaGeminiTotalDeadlineMs(env = process.env) {
  return boundedInteger(
    env?.CALL_QA_GEMINI_TOTAL_DEADLINE_MS,
    DEFAULT_CALL_QA_GEMINI_TOTAL_DEADLINE_MS,
    30_000,
    120_000,
  );
}

export function buildTrustedGradingScenario(scenario) {
  const lines = [
    scenario.gradingContext ?? scenario.scenario,
    '',
    'GRADING CONTEXT (server-authoritative curated scenario):',
    `Scenario: ${scenario.title} · Workflow type: ${scenario.workflowType} · Difficulty: ${scenario.difficulty}`,
    'OBSERVABILITY BOUNDARY: Internal chart clicks, buttons, visit labels, queues, channels, and staff assignments are private implementation details. Never require them to be narrated. Credit a natural caller-facing statement that commits to the equivalent safe outcome. Do not mark an internal action NOT_MET or send the attempt to review solely because the transcript cannot prove a silent action.',
    'Expected navigator behaviors:',
    ...scenario.expectedActions.map((item) => `- ${item}`),
    'Critical misses (fail the relevant criteria if these occur):',
    ...scenario.criticalMisses.map((item) => `- ${item}`),
  ];
  if (scenario.hiddenChartState) {
    lines.push(
      'HIDDEN CHART FACTS (server-authoritative; judge the navigator against these facts):',
      JSON.stringify(scenario.hiddenChartState),
      'Do not require the navigator to narrate silent chart clicks. Grade only observable questions, classifications, explanations, and stated actions; absence of unobservable telemetry alone is neither a miss nor a review reason.',
    );
  }
  if (scenario.scoringNotes?.length) {
    lines.push('Scenario-specific grading notes:', ...scenario.scoringNotes.map((item) => `- ${item}`));
  }
  return lines.join('\n');
}

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
          basis:    { type: 'STRING', enum: ['EVIDENCE', 'ABSENCE'] },
          evidence: { type: 'STRING' },
          note:     { type: 'STRING' },
          // Structured, transcript-grounded identifier evidence. Required in
          // practice only for criteria whose profile declares the identity
          // policy; every other criterion sends an empty array. Optional in the
          // schema so departments without an identity policy are unaffected.
          identityEvidence: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                field:     { type: 'STRING', enum: ['firstName', 'lastName', 'dob'] },
                value:     { type: 'STRING' },
                role:      { type: 'STRING', enum: ['navigator', 'caller'] },
                turnIndex: { type: 'INTEGER' },
                quote:     { type: 'STRING' },
              },
              required: ['field', 'value', 'role', 'turnIndex', 'quote'],
            },
          },
        },
        required: ['id', 'verdict', 'basis', 'evidence', 'note'],
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

/**
 * Render the EVIDENCE ROLE RULES block from the resolved profile.
 *
 * This exists because a single global "never quote a caller line" sentence
 * directly contradicts a department policy that lets a caller volunteer her own
 * identifiers. The rules are therefore derived from the profile: navigator-only
 * is the default for every criterion, and the narrow identity exception is
 * spelled out ONLY when the active profile actually declares it.
 */
export function evidenceRoleRules(profile) {
  const identityIds = profile.identityVerificationCriteria ?? [];
  const lines = [
    'EVIDENCE ROLE RULES (which speaker may be quoted):',
    '- DEFAULT — NAVIGATOR ONLY: for every criterion except those listed below, a MET quote must'
      + ' come from a SINGLE NAVIGATOR turn. A caller line never earns a navigator-performance'
      + ' criterion.',
    '- Every NOT_MET with basis EVIDENCE must quote a NAVIGATOR line. A caller line can never'
      + ' substantiate an accusation that the navigator did something wrong or unsafe.',
    '- Every auto-fail must quote a NAVIGATOR line. Auto-fails accuse the navigator of an explicit'
      + ' unsafe statement, so caller wording is never sufficient.',
  ];

  if (identityIds.length === 0) {
    lines.push('- There is NO identity exception in this rubric: identity criteria also follow the'
      + ' navigator-only default above.');
    return lines.join('\n');
  }

  lines.push(
    `- IDENTITY EXCEPTION — ${identityIds.map((id) => `[${id}]`).join(' and ')} ONLY: identity is`
      + ' frequently established BY THE CALLER ("Hi, this is Maria Alvarez, date of birth March 2nd'
      + ' 1991"). For these criteria you MAY cite caller turns as well as navigator turns, and the'
      + ' navigator loses nothing for not re-asking for something the caller already volunteered.'
      + ' Identifiers may be collected across several turns.',
    '- The identity exception is limited to establishing WHICH identifiers were collected and'
      + ' WHETHER they were collected before protected information was shared. It never allows'
      + ' caller wording to earn any other criterion.',
    '',
    'STRUCTURED IDENTITY EVIDENCE (required for the identity criteria above):',
    `For ${identityIds.map((id) => `[${id}]`).join(' and ')} you MUST also fill the`
      + ' "identityEvidence" array with ONE entry per identifier you claim was collected:',
    '  { "field": "firstName" | "lastName" | "dob", "value": "<the identifier itself>",',
    '    "role": "caller" | "navigator", "turnIndex": <the [n] index of the turn>,',
    '    "quote": "<verbatim contiguous quote from THAT turn containing the value>" }',
    'Rules for this array (the server re-checks every one of them, so a guess will be rejected):',
    '  * "value" must be the identifier ALONE — the actual first name, the actual last name, or the'
      + ' actual date of birth. Not a label, not a question, not a sentence.',
    '  * "quote" must appear verbatim in the turn you name in "turnIndex", and must CONTAIN "value".',
    '  * "turnIndex" is the number shown in square brackets at the start of each transcript line.',
    '  * A question the caller never answered ("What is your date of birth?") proves NOTHING. Only'
      + ' quote a turn where the identifier was actually STATED.',
    '  * A phone number or a home address is NEVER a date of birth. Do not submit one as "dob".',
    '  * The first name and the last name must be DIFFERENT values.',
    '  * If an identifier was never collected, OMIT it from the array — do not invent it.',
    'If the array does not independently prove all three identifiers, the identity criteria lose'
      + ' credit regardless of the verdict you return. Do not claim MET and leave this array empty.',
  );
  return lines.join('\n');
}

/**
 * Build the grader prompt for ONE resolved department rubric profile. The
 * criteria enumerated in the prompt, the auto-fail list, the evidence role
 * rules, the department grading rules, and the criterion-count assertion all
 * come from that same profile, so the model can never be asked about a rubric
 * different from the one that will score its verdicts.
 */
export function buildMessages(
  scenario, transcript, department, sopContext = sopContextFor(department),
  profile = requireQaRubricProfile(department),
) {
  // Both 'patient' and 'caller' are caller-side roles; only 'navigator' is the
  // navigator. Never serialize a caller-side turn as "Navigator".
  // Turn indices are part of the prompt contract: structured identity evidence
  // references them, and the server re-checks the referenced turn. The index is
  // the position in the BOUNDED transcript the server will grade, so a model
  // index always maps to the same turn the server verifies against.
  const callText = transcript
    .slice(0, MAX_TURNS)
    .map((t, index) => `[${index}] ${t.role === 'navigator' ? 'Navigator' : 'Caller'}: ${String(t.text ?? '').slice(0, MAX_TURN_CHARS)}`)
    .join('\n');

  const rubricText = profile.rubric
    .map((cat) => `${cat.name}:\n${cat.criteria.map((c) => `  - [${c.id}] ${c.text}`).join('\n')}`)
    .join('\n');
  const autoFailText = profile.autoFails.map((a) => `  - [${a.id}] ${a.text}`).join('\n');

  const systemInstruction =
`You are a strict QA auditor at a medical contact centre, scoring a patient navigator's call \
against a fixed quality rubric. You do NOT assign scores. For EACH rubric criterion you return \
exactly one verdict AND one basis:

  MET      (basis "EVIDENCE")  — the transcript clearly shows the behavior. You MUST put ONE \
contiguous verbatim quote in "evidence" — copied character-for-character, no role label, no \
ellipses, no stitching lines together. For behaviors shown across the whole call, quote the \
single best example line. WHOSE line may be quoted is governed by the EVIDENCE ROLE RULES below.
  NOT_MET  (basis "EVIDENCE") — the navigator did the WRONG or UNSAFE thing and it is OBSERVABLE. \
Use this whenever the miss is an observed action: wrong routing destination, clinical/medication \
advice, an unsafe promise, sarcasm/profanity, an incorrect scheduling instruction, reading or \
interpreting a result, or sharing information before verification. You MUST quote the offending \
NAVIGATOR line verbatim in "evidence" and name the rule broken in "note".
  NOT_MET  (basis "ABSENCE")  — the navigator simply NEVER did the expected behavior (e.g. never \
stated their own name, never confirmed callback info, never gathered a required detail). Put the \
reason in "note" and leave "evidence" EMPTY — there is nothing to quote.
  NA       (basis "ABSENCE")  — the criterion genuinely cannot apply to this call. Leave \
"evidence" EMPTY. Several criteria in this rubric are explicitly CONDITIONAL and are MEANT to be \
NA when their trigger did not occur — read each criterion's own text and follow it. Do not assume \
a criterion applies to every call unless its text says so.

BASIS RULES (strict — a mismatch is rejected): MET always uses EVIDENCE with a real quote. An \
OBSERVED wrong/unsafe behavior is NOT_MET with basis EVIDENCE and a quoted NAVIGATOR line — never \
call an observed violation an absence. A behavior that never happened is NOT_MET (or NA) with \
basis ABSENCE and empty evidence. Never put substantive evidence on an ABSENCE.

${evidenceRoleRules(profile)}

Grading rules — this is a hard test, apply them strictly:
- Judge only CALLER-OBSERVABLE communication in the transcript. Do not infer that a silent internal action happened, and do not penalize or review solely because an internal click, label, queue, channel, or staff assignment was not spoken.
- Accept natural patient-facing wording that states the same safe classification, outcome, or next step. Exact internal jargon is never required.
- Do not give benefit of the doubt on caller-observable safety, verification, questions, explanations, commitments, or explicit actions: partial or implied compliance is NOT_MET.
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
- A standard refill request is complete when the navigator gathers the medication or prescription \
name, preferred pharmacy, and whether the patient is completely out, routes or logs the TE \
correctly, and avoids promising approval. Do NOT require PE verification or deny the refill \
because PE is not current unless the scenario's active SOP explicitly makes PE status the issue.
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
- System-visible facts: do not penalize a navigator for not asking about facts normally checked in the ECW/system/chart unless the scenario requires caller confirmation. Do not invent a missing caller question as a failure.
- Still strict: these fairness rules never excuse a wrong queue/destination, no next step, missing required caller details, missed urgency, promised approval or unsupported same-day completion, medication/dosing or clinical advice, result interpretation, or privacy/verification failure.
Fairness rules never weaken verification, privacy/scope, routing, scheduling, or real SOP-knowledge failures.

${profile.graderInstructions}

Separately, check the auto-fail conditions. Set "triggered": true ONLY if the transcript \
contains an explicit violation, and quote the offending navigator line verbatim in "evidence". \
When in doubt, triggered is false.

RUBRIC CRITERIA:
${rubricText}

AUTO-FAIL CONDITIONS:
${autoFailText}

${glossaryPromptBlock(department)}

${navigatorContextBlock({ department, mode: 'qa-grading' })}

SOP CONTEXT:
${sopContext}`;

  const userMessage =
`Scenario the caller was given:
${scenario}

Full call transcript:
${callText}

Return a verdict object for ALL ${profile.criteria.length} criteria ids and all ${profile.autoFails.length} auto-fail ids.`;

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

export function finalizeQaResult(scored, transcript, correctedTurns = 0, repairs = [], metadataIntegrity = { verified: true, status: 'verified' }, forcedReviewReasons = [], deterministicFindings = [], gradingMetadata = null, captureIntegrity = { complete: true }, transcriptMetadata = null, profile = undefined) {
  // The profile that scored this attempt also owns its safety-critical set and
  // its domain/competency projections. Prefer an explicit profile; otherwise
  // recover the one `scoreQa` stamped onto the scorecard.
  const activeProfile = profile ?? getQaRubricProfile(scored?.rubricDepartment) ?? undefined;
  const review = assessQa(scored, transcript, {
    correctedTurns, repairs, deterministicFindings, profile: activeProfile,
  });
  // assessQa owns deterministic review flags and recommendation changes. Keep
  // that logic in one place so each finding category is surfaced exactly once.
  if (forcedReviewReasons.includes('routing-policy-review-only')) {
    review.reviewFlags.push({
      id: 'routing-policy-review-only',
      label: 'Routing destination requires supervisor review',
      detail: 'The repository sources do not establish one exact destination for this department/workflow, so deterministic routing repair is disabled.',
    });
    const applicable = scored.categories.reduce((sum, category) => sum + category.applicablePoints, 0);
    const earned = scored.categories.reduce((sum, category) => sum + category.earned, 0);
    const uncertainRoutingPoints = scored.criteria
      .filter((criterion) => ['know-rule', 'doc-te'].includes(criterion.id) && criterion.verdict === 'NOT_MET')
      .reduce((sum, criterion) => sum + criterion.points, 0);
    const bestCaseScore = applicable > 0 ? Math.round(((earned + uncertainRoutingPoints) / applicable) * 100) : 0;
    if (scored.pass || bestCaseScore >= scored.passThreshold) review.recommendation = 'needs_review';
  }
  if (!metadataIntegrity.verified) {
    review.reviewFlags.push({
      id: 'unverified-scenario-metadata',
      label: 'Scenario metadata could not be verified',
      detail: `Server verification status: ${metadataIntegrity.status}. No outcome-improving repair was allowed; a supervisor must review this result.`,
    });
    review.recommendation = 'needs_review';
  }
  // Capture-integrity gate (PR 2): a scored transcript captured by the server
  // relay may still have finalized under uncertainty (drain timeout, unexpected
  // upstream closure). Such an attempt is retained for supervisor inspection but
  // can never be a confident automatic PASS — it is graded with a mandatory
  // supervisor-review flag. A clean capture (or a legacy attempt with no capture
  // metadata) is unaffected.
  if (captureIntegrity && captureIntegrity.complete === false) {
    review.reviewFlags.push({
      id: 'capture-integrity-incomplete',
      label: 'Transcript capture did not finalize cleanly',
      detail: `The call server could not confirm a clean end of the transcript (${captureIntegrity.reason || 'incomplete capture'}). The stored transcript may be missing the final turn(s); a supervisor must review this result.`,
    });
    review.recommendation = 'needs_review';
  }
  const qa = {
    ...scored,
    // Projected with the SAME profile that graded the attempt — never the
    // globally imported rubric.
    ...qaDomainScoreSummary(scored, activeProfile),
    domainScoreVersion: '2026-07-09-v1',
    review,
    correctedTurns,
    repairs,
    repairCount: repairs.length,
    deterministicFindings,
    metadataIntegrity: {
      verified: metadataIntegrity.verified,
      status: metadataIntegrity.status,
      qaScenarioId: metadataIntegrity.qaScenarioId ?? null,
    },
    ...(gradingMetadata ? { gradingMetadata } : {}),
    ...(transcriptMetadata ? { transcriptMetadata } : {}),
  };
  const grade = buildGradeProjection(qa);
  return { qa, grade };
}

/**
 * Rebuild the trusted grading context from a STORED server attempt. Grading uses
 * the attempt's own immutable scenario snapshot + scenario id — never anything
 * the browser sent — so a later scenario-bank revision or code deploy cannot
 * change the context an already-captured attempt was graded against. Snapshot
 * identity fields are cross-checked when present; legacy server snapshots remain
 * valid, while missing/private-shape mismatches fail closed to supervisor review.
 */
function storedScenarioIntegrity(attempt, snapshot) {
  if (attempt?.assessmentType !== CALL_QA_ASSESSMENT_TYPE
    || attempt?.captureAuthority !== CALL_QA_CAPTURE_AUTHORITY) return 'server-authority-mismatch';
  if (!String(attempt?.qaScenarioId ?? '').trim()) return 'missing-scenario-id';
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return 'missing-scenario-snapshot';
  if (snapshot.qaScenarioId && snapshot.qaScenarioId !== attempt.qaScenarioId) return 'snapshot-id-mismatch';
  if (snapshot.department && snapshot.department !== attempt.department) return 'snapshot-department-mismatch';
  if (snapshot.scenarioVersion && attempt.scenarioVersion
    && snapshot.scenarioVersion !== attempt.scenarioVersion) return 'snapshot-version-mismatch';
  if (!String(snapshot.gradingContext ?? snapshot.scenario ?? '').trim()
    || !Array.isArray(snapshot.expectedActions)
    || !Array.isArray(snapshot.criticalMisses)
    || !Array.isArray(snapshot.scoringNotes)) return 'incomplete-scenario-snapshot';
  return 'verified';
}

export function buildScenarioContextFromAttempt(attempt) {
  const snapshot = attempt.scenarioSnapshot ?? {};
  // The department comes ONLY from the server-owned attempt. There is no
  // default: an attempt with no stored department cannot be matched to a rubric
  // profile, and `gradeCallQaTranscript` fails closed rather than guessing one.
  const department = attempt.department ?? null;
  const status = storedScenarioIntegrity(attempt, attempt.scenarioSnapshot);
  const privateContext = snapshot.gradingContext ?? snapshot.scenario ?? '';
  const gradingScenario = buildTrustedGradingScenario({
    gradingContext: privateContext,
    title: attempt.qaScenarioTitle ?? '',
    workflowType: snapshot.workflowType ?? attempt.workflowType ?? '',
    difficulty: snapshot.difficulty ?? attempt.difficulty ?? '',
    expectedActions: snapshot.expectedActions ?? attempt.expectedActions ?? [],
    criticalMisses: snapshot.criticalMisses ?? attempt.criticalMisses ?? [],
    scoringNotes: snapshot.scoringNotes ?? [],
    hiddenChartState: snapshot.hiddenChartState ?? null,
    ruleIds: snapshot.ruleIds ?? attempt.ruleIds ?? [],
    sourceSopVersion: snapshot.sourceSopVersion ?? attempt.sourceSopVersion ?? null,
    sourceRuleVersion: snapshot.sourceRuleVersion ?? attempt.sourceRuleVersion ?? null,
    sourceAuthority: snapshot.sourceAuthority ?? attempt.sourceAuthority ?? null,
  });
  return {
    verified: status === 'verified',
    status,
    qaScenarioId: attempt.qaScenarioId ?? null,
    department,
    scenarioVersion: snapshot.scenarioVersion ?? attempt.scenarioVersion ?? null,
    sourceSopVersion: snapshot.sourceSopVersion ?? attempt.sourceSopVersion ?? null,
    sourceRuleVersion: snapshot.sourceRuleVersion ?? attempt.sourceRuleVersion ?? null,
    sourceAuthority: snapshot.sourceAuthority ?? attempt.sourceAuthority ?? null,
    ruleIds: snapshot.ruleIds ?? attempt.ruleIds ?? [],
    gradingScenario,
    repairContext: {
      scenario: privateContext,
      department,
      metadata: {
        qaScenarioId: attempt.qaScenarioId ?? null,
        workflowType: snapshot.workflowType ?? attempt.workflowType ?? null,
        difficulty: snapshot.difficulty ?? attempt.difficulty ?? null,
        expectedActions: snapshot.expectedActions ?? attempt.expectedActions ?? [],
        criticalMisses: snapshot.criticalMisses ?? attempt.criticalMisses ?? [],
        scoringNotes: snapshot.scoringNotes ?? [],
        ruleIds: snapshot.ruleIds ?? attempt.ruleIds ?? [],
        sourceSopVersion: snapshot.sourceSopVersion ?? attempt.sourceSopVersion ?? null,
        sourceRuleVersion: snapshot.sourceRuleVersion ?? attempt.sourceRuleVersion ?? null,
        sourceAuthority: snapshot.sourceAuthority ?? attempt.sourceAuthority ?? null,
      },
    },
  };
}

class GradingServiceError extends Error {
  constructor(status, error) {
    super(error);
    this.name = 'GradingServiceError';
    this.httpStatus = status;
    this.error = error;
  }
}

/**
 * Reusable Call QA grading service. Given a transcript + a TRUSTED scenario
 * context (both server-owned), it runs the pinned grader, all deterministic
 * trust gates, fairness repairs, and the score/pass math, and returns
 * { qa, grade }. This is the single place that grading happens — the attempt-ID
 * endpoint below and any future caller share it. It preserves every PR #31
 * invariant. Throws GradingServiceError({httpStatus, error}) on model failure.
 *
 * `deps` is injectable for tests: { keys, geminiWithRotation, sopContextForFresh,
 * graderModel, env }.
 */
export async function gradeCallQaTranscript({ transcript: rawTranscript, scenarioContext, captureMetadata = {}, transcriptMetadata = null }, deps = {}) {
  const keys = deps.keys ?? getApiKeys();
  const runGemini = deps.geminiWithRotation ?? geminiWithRotation;
  const sopFresh = deps.sopContextForFresh ?? sopContextForFresh;
  const configEnv = deps.env ?? process.env;
  const graderModel = deps.graderModel ?? callQaGraderModel(configEnv);

  // ── THE department rubric profile resolution point ────────────────────────
  // Resolved ONCE from the server-authoritative department stored on the
  // attempt (never a browser-supplied value), then threaded through prompt
  // construction, validation, repairs, scoring, deterministic findings, review,
  // and the domain/competency projections. An unsupported department FAILS
  // CLOSED here — it must never silently inherit another department's rubric.
  let profile;
  try {
    profile = requireQaRubricProfile(scenarioContext.department);
  } catch (err) {
    if (err instanceof UnsupportedQaDepartmentError) {
      throw new GradingServiceError(
        422,
        'Scored Call QA is not configured for this department. A supervisor must review this attempt manually.',
      );
    }
    throw err;
  }
  const attemptTimeoutMs = callQaGeminiAttemptTimeoutMs(configEnv);
  const maxAttempts = callQaGeminiMaxAttempts(configEnv);
  const totalDeadlineMs = callQaGeminiTotalDeadlineMs(configEnv);

  // Snap mis-transcribed SOP proper nouns/terms to their canonical form BEFORE
  // grading (bounded to the glossary — never invents). The correction count
  // doubles as a transcript-quality signal for the review layer.
  const { transcript, correctedTurns } = correctTranscriptWithStats(rawTranscript, scenarioContext.department);

  const { systemInstruction, userMessage } = buildMessages(
    scenarioContext.gradingScenario,
    transcript,
    scenarioContext.department,
    await sopFresh(scenarioContext.department),
    profile,
  );
  const body = buildBody(systemInstruction, userMessage);

  // Scored Call QA uses ONE pinned, auditable model — key rotation only, NO
  // model fallback. A malformed-output retry reuses the SAME pinned model.
  let validated = null;
  let usedModel = graderModel;
  let attemptsUsed = 0;
  const gradingStartedAt = Date.now();
  for (let responseAttempt = 0; responseAttempt < 2 && !validated && attemptsUsed < maxAttempts; responseAttempt++) {
    const remainingDeadlineMs = totalDeadlineMs - (Date.now() - gradingStartedAt);
    if (remainingDeadlineMs <= 0) break;
    const result = await runGemini(keys, body, {
      label: 'grade-call-qa',
      models: [graderModel],
      timeoutMs: attemptTimeoutMs,
      maxAttempts: maxAttempts - attemptsUsed,
      totalDeadlineMs: remainingDeadlineMs,
    });
    const upstreamAttempts = Number.isInteger(result.attemptCount) && result.attemptCount >= 0
      ? result.attemptCount
      : 1;
    attemptsUsed += upstreamAttempts;
    if (!result.ok) {
      const { status, error } = rotationFailure(result, { exhausted: 'The grader is busy right now. Try again shortly.' });
      throw new GradingServiceError(status, error);
    }
    usedModel = result.model ?? graderModel;
    let parsed;
    try {
      parsed = JSON.parse(result.text ?? '');
    } catch {
      continue;
    }
    const check = validateQaResponse(parsed, profile);
    if (check.data) validated = check.data;
    else console.warn(`grade-call-qa: upstream response invalid model=${usedModel} attempt=${attemptsUsed} elapsedMs=${Date.now() - gradingStartedAt}`);
  }
  if (!validated) {
    throw new GradingServiceError(502, 'The grader returned an unusable review. Try again.');
  }

  const boundedTranscript = transcript
    .slice(0, MAX_TURNS)
    .map((t) => ({ role: t.role, text: String(t.text ?? '').slice(0, MAX_TURN_CHARS) }));
  // One profile object flows into repairs, scoring, and findings, so the prompt
  // rules, the deterministic scoring, and the auto-fail logic cannot diverge.
  const repairContext = { ...scenarioContext.repairContext, profile };
  const repaired = scenarioContext.verified
    ? repairQaVerdictsForScenario(validated, boundedTranscript, repairContext)
    : {
      criteria: validated.criteria, autoFails: validated.autoFails, repairs: [], reviewReasons: [],
      // Even when repairs are disabled the binding must reach scoring intact.
      profileBinding: validated.profileBinding,
    };
  // The binding is re-checked here: validation, repair and scoring must provably
  // be the same rubric profile, not merely the same criterion ids.
  const scored = scoreQa(
    repaired.criteria, repaired.autoFails, boundedTranscript, profile, repaired.profileBinding,
  );
  const deterministicFindings = evaluateQaDeterministicFindings(
    scored.criteria, boundedTranscript, repairContext,
  );
  const gradingMetadata = {
    model: usedModel,
    // Which department rubric graded this attempt, and which version of it.
    // Stored so a historical result is always rendered/calibrated under the
    // rubric it was actually graded with.
    rubricDepartment: profile.department,
    rubricVersion: profile.rubricVersion,
    promptVersion: CALL_QA_PROMPT_VERSION,
    scenarioVersion: scenarioContext.scenarioVersion ?? null,
    sourceSopVersion: scenarioContext.sourceSopVersion ?? null,
    sourceRuleVersion: scenarioContext.sourceRuleVersion ?? null,
    sourceAuthority: scenarioContext.sourceAuthority ?? null,
    ruleIds: scenarioContext.ruleIds ?? [],
    gradedAt: new Date().toISOString(),
  };
  // Capture integrity FAILS CLOSED: a clean capture requires BOTH a 'captured'
  // terminal status AND an explicit captureComplete === true. Missing,
  // contradictory, or malformed metadata (e.g. captureStatus 'captured' with no /
  // false captureComplete, or 'capture_incomplete' with captureComplete true) is
  // treated as incomplete → forces supervisor review. It never defaults to clean.
  const captureIntegrity = {
    complete:
      transcriptMetadata?.captureStatus === CAPTURE_STATUS.CAPTURED &&
      captureMetadata?.captureComplete === true,
    reason: captureMetadata?.drainReason,
  };
  const { qa, grade } = finalizeQaResult(
    scored, boundedTranscript, correctedTurns, repaired.repairs, scenarioContext,
    repaired.reviewReasons, deterministicFindings, gradingMetadata, captureIntegrity, transcriptMetadata,
    profile,
  );
  return { qa, grade };
}

// ── Attempt-ID based scored endpoint (PR 2) ─────────────────────────────────
//
// The browser sends ONLY { attemptId }. It never sends a transcript, scenario,
// department, grader metadata, or scenario metadata for a scored attempt. The
// server loads the durable transcript + trusted scenario snapshot it captured,
// grades that, and persists the result — so a tampered browser cannot alter what
// is scored. Grading is idempotent (a grade already present is returned without
// a second Gemini call) and retryable (a prior failure keeps the transcript).

export function buildTranscriptMetadata(attempt) {
  const meta = attempt.captureMetadata ?? {};
  return {
    authority: 'server',
    captureVersion: attempt.captureVersion ?? null,
    liveModel: attempt.liveModel ?? null,
    attemptId: attempt.id,
    captureStatus: attempt.captureStatus ?? null,
    captureComplete: meta.captureComplete === true,
    drainReason: meta.drainReason ?? null,
    navigatorTurnCount: meta.navigatorTurnCount ?? 0,
    callerTurnCount: meta.callerTurnCount ?? 0,
  };
}

// A Firestore document id: non-empty, bounded, and free of path separators /
// reserved forms. Reject malformed ids with a 400 rather than letting the Admin
// SDK throw a path exception that would surface as a 500.
export function isValidAttemptId(id) {
  return typeof id === 'string'
    && id.length > 0 && id.length <= 200
    && !id.includes('/')
    && id !== '.' && id !== '..'
    && !/^__.*__$/.test(id);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (await validateSecret(req, res)) return;

  const attemptId = String(req.body?.attemptId ?? '').trim();
  if (!attemptId) {
    return res.status(400).json({ error: 'A server attempt id is required.' });
  }
  if (!isValidAttemptId(attemptId)) {
    return res.status(400).json({ error: 'That attempt id is not valid.' });
  }

  let db;
  try {
    db = getFirebaseAdmin().db;
  } catch (err) {
    if (err instanceof FirebaseAdminConfigError || err?.code === 'firebase-admin-not-configured') {
      return res.status(503).json({ error: 'Server authentication is not configured.' });
    }
    throw err;
  }

  const identity = req.identity ?? await readFirebaseIdentity(req);

  const attempt = await loadAttempt(db, attemptId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found.' });

  // Only a server-authoritative Call QA attempt can be graded here.
  if (attempt.assessmentType !== CALL_QA_ASSESSMENT_TYPE || attempt.captureAuthority !== CALL_QA_CAPTURE_AUTHORITY) {
    return res.status(400).json({ error: 'This is not a server-recorded Call QA attempt.' });
  }

  // Ownership: the navigator who owns it, or any supervisor.
  const isSupervisor = identity?.role === 'supervisor';
  const isOwner = identity?.role === 'navigator' && identity.navigatorId === attempt.navigatorId;
  if (!isSupervisor && !isOwner) {
    return res.status(403).json({ error: 'You do not have access to this attempt.' });
  }

  // Idempotency + capture-state gate via a transactional grading lease. NOTE:
  // Gemini keys are intentionally NOT required to reach this point — an
  // already-graded attempt must remain readable during a grader outage.
  const leaseId = randomUUID();
  const claim = await claimGradingLease(db, attemptId, { leaseId });
  if (claim.status === 'already_graded') {
    return res.status(200).json({ qa: claim.attempt.qa, grade: claim.attempt.grade, attemptId });
  }
  if (claim.status === 'capture_active') {
    return res.status(409).json({ error: 'This call is still being recorded. Finish the call before grading.' });
  }
  if (claim.status === 'abandoned') {
    return res.status(409).json({ error: 'This attempt was interrupted and cannot be graded.' });
  }
  if (claim.status === 'busy') {
    return res.status(409).json({ error: 'This attempt is already being graded. Try again shortly.' });
  }
  if (claim.status !== 'claimed') {
    return res.status(409).json({ error: 'This attempt is not ready for grading.' });
  }

  // Gemini keys are required ONLY now that we must actually invoke the grader. If
  // they are missing, release the lease (mark grade_failed keeps the transcript
  // for a later retry) so the attempt never gets stuck in a live lease.
  const keys = getApiKeys();
  if (!keys.length) {
    await markGradeFailed(db, attemptId, { leaseId }).catch(() => {});
    return res.status(500).json({ error: 'Grading is not configured on the server.' });
  }

  const claimed = claim.attempt;
  const transcript = Array.isArray(claimed.transcript) ? claimed.transcript : [];
  if (transcript.length === 0) {
    await markGradeFailed(db, attemptId, { leaseId });
    return res.status(422).json({ error: 'This attempt has no recorded transcript to grade.' });
  }

  const scenarioContext = buildScenarioContextFromAttempt(claimed);
  const transcriptMetadata = buildTranscriptMetadata(claimed);

  let graded;
  try {
    graded = await gradeCallQaTranscript({
      transcript,
      scenarioContext,
      captureMetadata: claimed.captureMetadata ?? {},
      transcriptMetadata,
    }, { keys });
  } catch (err) {
    await markGradeFailed(db, attemptId, { leaseId }).catch(() => {});
    if (err instanceof GradingServiceError) {
      return res.status(err.httpStatus).json({ error: err.error });
    }
    console.error('grade-call-qa:', err?.message ?? err);
    return res.status(500).json({ error: 'Grading failed unexpectedly. Try again.' });
  }

  const commit = await commitGrade(db, attemptId, { leaseId, grade: graded.grade, qa: graded.qa });
  if (commit.status === 'already_graded') {
    return res.status(200).json({ qa: commit.attempt.qa, grade: commit.attempt.grade, attemptId });
  }
  if (commit.status === 'lease_lost') {
    // This request lost its lease to a newer one. We must NEVER return this
    // request's local (unpersisted) grade as success. Only a DURABLY-persisted
    // grade may be returned; otherwise the browser must retry.
    const fresh = await loadAttempt(db, attemptId);
    if (fresh?.gradingStatus === GRADING_STATUS.GRADED && fresh.qa && fresh.grade) {
      return res.status(200).json({ qa: fresh.qa, grade: fresh.grade, attemptId });
    }
    if (fresh?.gradingStatus === GRADING_STATUS.GRADING) {
      return res.status(409).json({ error: 'This attempt is being graded by another request. Try again shortly.' });
    }
    return res.status(503).json({ error: 'Grading could not be saved. Please retry.' });
  }

  return res.status(200).json({ qa: graded.qa, grade: graded.grade, attemptId });
}
