// ─────────────────────────────────────────────────────────────────────────────
// Deterministic regression-corpus harness: every corpus case × simulated grader
// profile × paraphrase
// variant runs through the REAL deterministic grading pipeline (glossary
// correction → validation → fairness repairs → trust-gated scoring → review
// assessment), and the aggregate is measured for FALSE PASSES and FALSE FAILS
// against authored expectations — not merely "the functions execute".
//
// Outcome definitions (see docs/GRADING_INVARIANTS.md):
//   false pass — expected 'fail' but the pipeline passed with a confident
//                'pass' recommendation (a pass flagged needs_review is escalated
//                to a supervisor and is NOT a false pass).
//   false fail — expected 'pass' but the pipeline failed with a confident
//                'fail' recommendation (a fail flagged needs_review escalates).
//   review miss — expected 'review' but the pipeline returned a confident
//                verdict instead of needs_review.
// All three must be zero, permanently.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { QA_GRADING_CORPUS, simulateGrader, applyVariant } from './_qa-grading-corpus.js';
import { correctTranscriptWithStats } from './_qa-glossary.js';
import { validateQaResponse, repairQaVerdictsForScenario, scoreQa } from './_qa-rubric.js';
import { finalizeQaResult, resolveQaScenarioContext } from './grade-call-qa.js';

function runPipeline(caseDef, profileName, transcriptOverride) {
  const raw = transcriptOverride ?? caseDef.transcript;
  const { transcript, correctedTurns } = correctTranscriptWithStats(raw, caseDef.department);
  const parsed = simulateGrader(transcript, caseDef.graders[profileName]);
  const check = validateQaResponse(parsed);
  if (!check.data) throw new Error(`corpus ${caseDef.id}/${profileName}: invalid simulated grader output: ${check.error}`);
  const repaired = repairQaVerdictsForScenario(check.data, transcript, {
    scenario: caseDef.scenario,
    department: caseDef.department,
    metadata: caseDef.metadata,
  });
  const scored = scoreQa(repaired.criteria, repaired.autoFails, transcript);
  const { qa, grade } = finalizeQaResult(
    scored, transcript, correctedTurns, repaired.repairs, { verified: true, status: 'verified' }, repaired.reviewReasons,
  );
  return { qa, grade, correctedTurns };
}

// Every (case, profile[, variant]) run in the corpus.
function allRuns() {
  const runs = [];
  for (const caseDef of QA_GRADING_CORPUS) {
    for (const profileName of Object.keys(caseDef.graders)) {
      runs.push({ caseDef, profileName, variantId: null, result: runPipeline(caseDef, profileName) });
      for (const variant of caseDef.variants ?? []) {
        runs.push({
          caseDef, profileName, variantId: variant.id,
          result: runPipeline(caseDef, profileName, applyVariant(caseDef.transcript, variant)),
        });
      }
    }
  }
  return runs;
}

function assertExpectation(result, expected, label) {
  const { qa } = result;
  expect(qa.pass, `${label}: pass`).toBe(expected.pass);
  if (expected.recommendation) {
    expect(qa.review.recommendation, `${label}: recommendation`).toBe(expected.recommendation);
  }
  if (expected.repairRules) {
    expect([...qa.repairs.map((r) => r.rule)].sort(), `${label}: repair rules`)
      .toEqual([...expected.repairRules].sort());
  }
  if ('autoFailed' in expected) {
    expect(qa.autoFails.length > 0, `${label}: autoFailed`).toBe(expected.autoFailed);
  }
  if ('score' in expected) {
    expect(qa.score, `${label}: score`).toBe(expected.score);
  }
  if ('unverifiedAutoFails' in expected) {
    expect(qa.unverifiedAutoFails, `${label}: unverifiedAutoFails`).toHaveLength(expected.unverifiedAutoFails);
  }
  if ('safetyRisk' in expected) {
    expect(qa.review.safetyRisk, `${label}: safetyRisk`).toBe(expected.safetyRisk);
  }
  if (expected.flags) {
    const flagIds = qa.review.reviewFlags.map((f) => f.id);
    for (const flag of expected.flags) {
      expect(flagIds, `${label}: expected review flag ${flag}`).toContain(flag);
    }
  }
  if ('minCorrectedTurns' in expected) {
    expect(result.correctedTurns, `${label}: correctedTurns`).toBeGreaterThanOrEqual(expected.minCorrectedTurns);
  }
  if ('unverified' in expected) {
    expect(qa.criteria.filter((c) => c.unverified), `${label}: unverified MET evidence`).toHaveLength(expected.unverified);
  }
}

// ── Per-case expectations ────────────────────────────────────────────────────

describe('QA grading corpus — per-case outcomes', () => {
  for (const caseDef of QA_GRADING_CORPUS) {
    for (const [profileName, expected] of Object.entries(caseDef.expect)) {
      it(`${caseDef.id} [${profileName}] → ${caseDef.truth}`, () => {
        expect(caseDef.graders[profileName], `${caseDef.id}: grader profile ${profileName} missing`).toBeDefined();
        assertExpectation(runPipeline(caseDef, profileName), expected, `${caseDef.id}/${profileName}`);
      });

      for (const variant of caseDef.variants ?? []) {
        it(`${caseDef.id} [${profileName}] paraphrase variant "${variant.id}" grades identically`, () => {
          const varied = applyVariant(caseDef.transcript, variant);
          expect(varied, `${caseDef.id}: variant ${variant.id} did not change the transcript`).not.toEqual(caseDef.transcript);
          assertExpectation(runPipeline(caseDef, profileName, varied), expected, `${caseDef.id}/${profileName}/${variant.id}`);
        });
      }
    }
  }
});

// ── Aggregate false-pass / false-fail measurement ────────────────────────────

describe('QA grading corpus — aggregate error rates', () => {
  const runs = allRuns();

  it('covers every category and both grader temperaments', () => {
    const categories = new Set(QA_GRADING_CORPUS.map((c) => c.category));
    for (const required of ['good', 'borderline', 'unsafe', 'incomplete', 'natural', 'commitment', 'ambiguous']) {
      expect([...categories], 'corpus category coverage').toContain(required);
    }
    expect(runs.length).toBeGreaterThanOrEqual(QA_GRADING_CORPUS.length);
    expect(QA_GRADING_CORPUS.some((c) => c.graders.literalist)).toBe(true);
  });

  it('has ZERO false passes (truth=fail graded as a confident pass)', () => {
    const falsePasses = runs
      .filter(({ caseDef, result }) =>
        caseDef.truth === 'fail' && result.qa.pass && result.qa.review.recommendation === 'pass')
      .map(({ caseDef, profileName, variantId }) => `${caseDef.id}/${profileName}${variantId ? `/${variantId}` : ''}`);
    expect(falsePasses).toEqual([]);
  });

  it('has ZERO false fails (truth=pass graded as a confident fail)', () => {
    const falseFails = runs
      .filter(({ caseDef, result }) =>
        caseDef.truth === 'pass' && !result.qa.pass && result.qa.review.recommendation === 'fail')
      .map(({ caseDef, profileName, variantId }) => `${caseDef.id}/${profileName}${variantId ? `/${variantId}` : ''}`);
    expect(falseFails).toEqual([]);
  });

  it('sends every genuinely borderline call to supervisor review', () => {
    const reviewMisses = runs
      .filter(({ caseDef, result }) => caseDef.truth === 'review' && result.qa.review.recommendation !== 'needs_review')
      .map(({ caseDef, profileName, variantId }) => `${caseDef.id}/${profileName}${variantId ? `/${variantId}` : ''}`);
    expect(reviewMisses).toEqual([]);
  });

  it('never lets a truth=fail call pass without at least a supervisor-review flag', () => {
    const silentPasses = runs
      .filter(({ caseDef, result }) => caseDef.truth === 'fail' && result.qa.pass && result.qa.review.recommendation !== 'needs_review')
      .map(({ caseDef, profileName }) => `${caseDef.id}/${profileName}`);
    expect(silentPasses).toEqual([]);
  });

  it('records every repair transparently with the original grader verdict', () => {
    for (const { caseDef, profileName, result } of runs) {
      for (const repair of result.qa.repairs) {
        const label = `${caseDef.id}/${profileName}`;
        expect(repair.originalVerdict, `${label}: repair originalVerdict`).toBe('NOT_MET');
        expect(typeof repair.originalNote, `${label}: repair originalNote`).toBe('string');
        expect(repair.evidence, `${label}: repair evidence quote`).toBeTruthy();
        expect(['know-rule', 'doc-te'], `${label}: repairable criteria only`).toContain(repair.criterionId);
      }
      expect(result.qa.repairCount).toBe(result.qa.repairs.length);
    }
  });

  it('is fully deterministic: same call + verdicts → identical result', () => {
    const caseDef = QA_GRADING_CORPUS.find((c) => c.id === 'good-refill-natural');
    const a = runPipeline(caseDef, 'literalist');
    const b = runPipeline(caseDef, 'literalist');
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
  });
});

describe('captured grader-response fixture format', () => {
  it('replays a stored raw response through validation, repairs, scoring, and review without a live API call', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/qa-model-capture.example.json', import.meta.url), 'utf8'));
    expect(fixture).toMatchObject({ formatVersion: 1, captureType: 'simulated-example' });

    const context = resolveQaScenarioContext({
      scenario: fixture.request.scenario,
      department: fixture.request.department,
      qaScenarioId: fixture.scenarioId,
    });
    expect(context.verified).toBe(true);
    const { transcript, correctedTurns } = correctTranscriptWithStats(fixture.transcript, context.department);
    const validated = validateQaResponse(fixture.rawModelResponse);
    expect(validated.data).toBeDefined();
    const repaired = repairQaVerdictsForScenario(validated.data, transcript, context.repairContext);
    const scored = scoreQa(repaired.criteria, repaired.autoFails, transcript);
    const { qa } = finalizeQaResult(scored, transcript, correctedTurns, repaired.repairs, context);

    expect(qa.pass).toBe(fixture.expected.pass);
    expect(qa.review.recommendation).toBe(fixture.expected.recommendation);
  });
});
