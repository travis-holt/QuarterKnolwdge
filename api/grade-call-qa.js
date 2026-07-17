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
  QA_RUBRIC, QA_AUTO_FAILS, QA_RUBRIC_VERSION, rubricCriteria,
  validateQaResponse, repairQaVerdictsForScenario, scoreQa, assessQa, buildGradeProjection,
  evaluateQaDeterministicFindings,
} from './_qa-rubric.js';
import { qaDomainScoreSummary } from '../src/lib/qaDomainScoring.js';
import { getCallQaScenarioById } from '../src/data/callQaScenarios.js';
import { readFirebaseIdentity } from './_auth.js';
import { FirebaseAdminConfigError, getFirebaseAdmin } from './_firebase-admin.js';
import {
  CALL_QA_ASSESSMENT_TYPE, CALL_QA_CAPTURE_AUTHORITY, CAPTURE_STATUS, GRADING_STATUS,
  claimGradingLease, commitGrade, markGradeFailed, loadAttempt,
} from './_call-qa-attempts.js';
import { randomUUID } from 'node:crypto';

const MAX_TURNS = 60;
const MAX_TURN_CHARS = 2000;

// Grader prompt version — bump whenever the grading INSTRUCTIONS materially
// change. Recorded on qa.gradingMetadata.promptVersion. This version reflects the
// judgment-basis (EVIDENCE / ABSENCE) grader contract introduced in this PR.
export const CALL_QA_PROMPT_VERSION = 'call-qa-grader-v2';

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

function trustedScenarioMetadata(scenario) {
  return {
    qaScenarioId: scenario.id,
    workflowType: scenario.workflowType,
    difficulty: scenario.difficulty,
    expectedActions: scenario.expectedActions,
    criticalMisses: scenario.criticalMisses,
    scoringNotes: scenario.scoringNotes ?? [],
    ruleIds: scenario.ruleIds ?? [],
    sourceSopVersion: scenario.sourceSopVersion ?? null,
    sourceRuleVersion: scenario.sourceRuleVersion ?? null,
    sourceAuthority: scenario.sourceAuthority ?? null,
  };
}

export function buildTrustedGradingScenario(scenario) {
  const lines = [
    scenario.scenario,
    '',
    'GRADING CONTEXT (server-authoritative curated scenario):',
    `Scenario: ${scenario.title} · Workflow type: ${scenario.workflowType} · Difficulty: ${scenario.difficulty}`,
    'Expected navigator behaviors:',
    ...scenario.expectedActions.map((item) => `- ${item}`),
    'Critical misses (fail the relevant criteria if these occur):',
    ...scenario.criticalMisses.map((item) => `- ${item}`),
  ];
  if (scenario.hiddenChartState) {
    lines.push(
      'HIDDEN CHART FACTS (server-authoritative; judge the navigator against these facts):',
      JSON.stringify(scenario.hiddenChartState),
      'Do not require the navigator to narrate silent chart clicks. Grade only observable questions, classifications, explanations, and stated actions; use supervisor review when a silent action is outcome-determinative.',
    );
  }
  if (scenario.scoringNotes?.length) {
    lines.push('Scenario-specific grading notes:', ...scenario.scoringNotes.map((item) => `- ${item}`));
  }
  return lines.join('\n');
}

export function resolveQaScenarioContext({ scenario = '', department = 'pediatrics', qaScenarioId, metadata = {} } = {}) {
  const requestedId = String(qaScenarioId ?? metadata?.qaScenarioId ?? '').trim();
  const trusted = requestedId ? getCallQaScenarioById(requestedId) : null;
  let status = 'verified';
  if (!requestedId) status = 'missing-scenario-id';
  else if (!trusted) status = 'unknown-scenario-id';
  else if (trusted.department !== department) status = 'department-mismatch';
  else if (normalizeScenario(scenario) !== normalizeScenario(trusted.scenario)) status = 'scenario-mismatch';

  return {
    verified: status === 'verified',
    status,
    qaScenarioId: requestedId || null,
    department: trusted?.department ?? department,
    // Server-trusted scenario version; never a browser-supplied value.
    scenarioVersion: trusted?.version ?? null,
    sourceSopVersion: trusted?.sourceSopVersion ?? null,
    sourceRuleVersion: trusted?.sourceRuleVersion ?? null,
    sourceAuthority: trusted?.sourceAuthority ?? null,
    ruleIds: trusted?.ruleIds ?? [],
    gradingScenario: trusted ? buildTrustedGradingScenario(trusted) : String(scenario),
    repairContext: {
      scenario: trusted?.scenario ?? String(scenario),
      department: trusted?.department ?? department,
      metadata: trusted ? trustedScenarioMetadata(trusted) : {},
    },
  };
}

function normalizeScenario(value) {
  return String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
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

export function buildMessages(scenario, transcript, department, sopContext = sopContextFor(department)) {
  // Both 'patient' and 'caller' are caller-side roles; only 'navigator' is the
  // navigator. Never serialize a caller-side turn as "Navigator".
  const callText = transcript
    .slice(0, MAX_TURNS)
    .map((t) => `${t.role === 'navigator' ? 'Navigator' : 'Caller'}: ${String(t.text ?? '').slice(0, MAX_TURN_CHARS)}`)
    .join('\n');

  const rubricText = QA_RUBRIC
    .map((cat) => `${cat.name}:\n${cat.criteria.map((c) => `  - [${c.id}] ${c.text}`).join('\n')}`)
    .join('\n');
  const autoFailText = QA_AUTO_FAILS.map((a) => `  - [${a.id}] ${a.text}`).join('\n');

  const systemInstruction =
`You are a strict QA auditor at a medical contact centre, scoring a patient navigator's call \
against a fixed quality rubric. You do NOT assign scores. For EACH rubric criterion you return \
exactly one verdict AND one basis:

  MET      (basis "EVIDENCE")  — the transcript clearly shows the NAVIGATOR doing the behavior. \
You MUST put ONE contiguous verbatim quote from a SINGLE NAVIGATOR turn in "evidence" — copied \
character-for-character, no role label, no ellipses, no stitching lines together, never a caller \
line. For behaviors shown across the whole call, quote the single best navigator example line.
  NOT_MET  (basis "EVIDENCE") — the navigator did the WRONG or UNSAFE thing and it is OBSERVABLE. \
Use this whenever the miss is an observed action: wrong routing destination, clinical/medication \
advice, an unsafe promise, sarcasm/profanity, an incorrect scheduling instruction, reading or \
interpreting a result, or sharing information before verification. You MUST quote the offending \
NAVIGATOR line verbatim in "evidence" and name the rule broken in "note".
  NOT_MET  (basis "ABSENCE")  — the navigator simply NEVER did the expected behavior (e.g. never \
stated their name, never offered the survey, never confirmed callback info, never gathered a \
required detail). Put the reason in "note" and leave "evidence" EMPTY — there is nothing to quote.
  NA       (basis "ABSENCE")  — the criterion genuinely cannot apply to this scenario (e.g., no \
appointment was needed, so no recap was possible). Leave "evidence" EMPTY. Use sparingly; \
greeting, verification, tone, listening, and closing criteria apply to EVERY call.

BASIS RULES (strict — a mismatch is rejected): MET always uses EVIDENCE with a real navigator \
quote. An OBSERVED wrong/unsafe behavior is NOT_MET with basis EVIDENCE and a quoted navigator \
line — never call an observed violation an absence. A behavior that never happened is NOT_MET (or \
NA) with basis ABSENCE and empty evidence. Never put substantive evidence on an ABSENCE.

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
- Natural closings count: for the closing pleasantry criteria, a courteous natural wrap-up is \
enough. If the caller has already said thanks or goodbye and the navigator responds in kind, or \
the navigator gives any polite sign-off, treat the closing pleasantry as MET even without the \
exact scripted phrase. Do not require rote wording.
- WORKFLOW FAIRNESS RULES: For a standard medication refill, do not require PE / Physical Exam / physical status verification unless the scenario makes it the governing issue. Require medication name, preferred pharmacy, callback details when needed, out-of-medication urgency, a correct message/routing step, no promised approval, and no medication advice. Do not fail Knowledge solely because PE was not asked.
- System-visible facts: do not penalize a navigator for not asking about facts normally checked in the ECW/system/chart unless the scenario requires caller confirmation. Do not invent a missing caller question as a failure.
- Natural routing wording: exact TE or Telephone Encounter wording is not required. "send the request," "send a message," "send this over," "route this," "put in a note," or sending it to the nurse, provider, refill team, or clinical team counts when the workflow and destination are correct.
- Still strict: these fairness rules never excuse a wrong queue/destination, no next step, missing medication/pharmacy/callback details when required, missed urgency, promised approval or unsupported same-day completion, medication/dosing or clinical advice, result interpretation, or privacy/verification failure.
Fairness rules never weaken verification, privacy/scope, routing, scheduling, or real SOP-knowledge failures.

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

export function finalizeQaResult(scored, transcript, correctedTurns = 0, repairs = [], metadataIntegrity = { verified: true, status: 'verified' }, forcedReviewReasons = [], deterministicFindings = [], gradingMetadata = null, captureIntegrity = { complete: true }, transcriptMetadata = null) {
  const review = assessQa(scored, transcript, { correctedTurns, repairs, deterministicFindings });
  // Deterministic conflict layer (NOT repairs): a model-positive verdict that
  // contradicts the authoritative routing policy, or a deterministic unsafe-
  // language signal, must never become a confident unreviewed PASS. Findings
  // never change verdicts or scores — they are persisted for supervisors and
  // force review only when the result would otherwise pass confidently.
  if (deterministicFindings.length > 0) {
    if (deterministicFindings.some((finding) => finding.type === 'routing')) {
      review.reviewFlags.push({
        id: 'model-routing-conflict',
        label: 'Grader verdict conflicts with deterministic routing policy',
        detail: 'The grader marked routing/knowledge criteria MET, but the deterministic routing policy found the committed route wrong, contradictory, ambiguous, or missing. A supervisor must review this result.',
      });
    }
    if (deterministicFindings.some((finding) => finding.type === 'safety')) {
      review.reviewFlags.push({
        id: 'deterministic-safety-conflict',
        label: 'Deterministic unsafe-language signal detected',
        detail: `Deterministic checks detected ${deterministicFindings.filter((f) => f.type === 'safety').map((f) => f.reason).join(', ')} in the navigator's wording. The result cannot pass without supervisor review.`,
      });
    }
    if (review.recommendation === 'pass') review.recommendation = 'needs_review';
  }
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
    ...qaDomainScoreSummary(scored),
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
 * change the context an already-captured attempt was graded against. The curated
 * scenario id is still the metadata authority for repairs; if it is unknown
 * (e.g. a scenario retired after capture), repairs are disabled and the result
 * is forced to supervisor review.
 */
export function buildScenarioContextFromAttempt(attempt) {
  const snapshot = attempt.scenarioSnapshot ?? {};
  const department = attempt.department ?? 'pediatrics';
  const trusted = attempt.qaScenarioId ? getCallQaScenarioById(attempt.qaScenarioId) : null;
  const gradingScenario = buildTrustedGradingScenario({
    scenario: snapshot.scenario ?? attempt.scenario ?? '',
    title: attempt.qaScenarioTitle ?? '',
    workflowType: attempt.workflowType ?? '',
    difficulty: attempt.difficulty ?? '',
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
    verified: Boolean(trusted),
    status: trusted ? 'verified' : 'unknown-scenario-id',
    qaScenarioId: attempt.qaScenarioId ?? null,
    department,
    scenarioVersion: attempt.scenarioVersion ?? trusted?.version ?? null,
    sourceSopVersion: snapshot.sourceSopVersion ?? attempt.sourceSopVersion ?? null,
    sourceRuleVersion: snapshot.sourceRuleVersion ?? attempt.sourceRuleVersion ?? null,
    sourceAuthority: snapshot.sourceAuthority ?? attempt.sourceAuthority ?? null,
    ruleIds: snapshot.ruleIds ?? attempt.ruleIds ?? [],
    gradingScenario,
    repairContext: {
      scenario: snapshot.scenario ?? attempt.scenario ?? '',
      department,
      metadata: {
        qaScenarioId: attempt.qaScenarioId ?? null,
        workflowType: attempt.workflowType ?? null,
        difficulty: attempt.difficulty ?? null,
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
 * graderModel }.
 */
export async function gradeCallQaTranscript({ transcript: rawTranscript, scenarioContext, captureMetadata = {}, transcriptMetadata = null }, deps = {}) {
  const keys = deps.keys ?? getApiKeys();
  const runGemini = deps.geminiWithRotation ?? geminiWithRotation;
  const sopFresh = deps.sopContextForFresh ?? sopContextForFresh;
  const graderModel = deps.graderModel ?? callQaGraderModel();

  // Snap mis-transcribed SOP proper nouns/terms to their canonical form BEFORE
  // grading (bounded to the glossary — never invents). The correction count
  // doubles as a transcript-quality signal for the review layer.
  const { transcript, correctedTurns } = correctTranscriptWithStats(rawTranscript, scenarioContext.department);

  const { systemInstruction, userMessage } = buildMessages(
    scenarioContext.gradingScenario,
    transcript,
    scenarioContext.department,
    await sopFresh(scenarioContext.department),
  );
  const body = buildBody(systemInstruction, userMessage);

  // Scored Call QA uses ONE pinned, auditable model — key rotation only, NO
  // model fallback. A malformed-output retry reuses the SAME pinned model.
  let validated = null;
  let usedModel = graderModel;
  for (let attempt = 0; attempt < 2 && !validated; attempt++) {
    const result = await runGemini(keys, body, { label: 'grade-call-qa', models: [graderModel] });
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
    const check = validateQaResponse(parsed);
    if (check.data) validated = check.data;
    else console.warn(`grade-call-qa: invalid response (attempt ${attempt + 1}): ${check.error}`);
  }
  if (!validated) {
    throw new GradingServiceError(502, 'The grader returned an unusable review. Try again.');
  }

  const boundedTranscript = transcript
    .slice(0, MAX_TURNS)
    .map((t) => ({ role: t.role, text: String(t.text ?? '').slice(0, MAX_TURN_CHARS) }));
  const repaired = scenarioContext.verified
    ? repairQaVerdictsForScenario(validated, boundedTranscript, scenarioContext.repairContext)
    : { criteria: validated.criteria, autoFails: validated.autoFails, repairs: [], reviewReasons: [] };
  const scored = scoreQa(repaired.criteria, repaired.autoFails, boundedTranscript);
  const deterministicFindings = evaluateQaDeterministicFindings(
    scored.criteria, boundedTranscript, scenarioContext.repairContext,
  );
  const gradingMetadata = {
    model: usedModel,
    rubricVersion: QA_RUBRIC_VERSION,
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
