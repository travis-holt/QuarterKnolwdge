import { COMPETENCIES } from '../data/competencies.js';
import { DOMAINS } from '../data/questions.js';
import {
  QA_RUBRIC_PROFILES, getQaRubricProfile, profileForGradedAttempt, recordsRubricVersion,
} from '../data/qaRubricProfiles.js';

// QA-only domain/competency projections. These MUST be computed against the
// rubric profile that ACTUALLY graded the attempt: an OB/GYN result summarized
// against the Pediatrics rubric would look for a `close-survey` criterion that
// never existed and would drop `close-offer-help` evidence entirely.
//
// Callers pass the resolved profile explicitly. `resolveScoringProfile` is the
// fallback used when rendering a STORED result: it prefers the recorded rubric
// version so a historical attempt is summarized under the rubric it was graded
// with, never reinterpreted under a newer one.
const DEFAULT_PROFILE = QA_RUBRIC_PROFILES.pediatrics;

/**
 * Resolve the profile to summarize a QA result with.
 *  - an explicitly supplied profile always wins;
 *  - a result that RECORDS a rubric version is resolved by that version, and
 *    resolves to `null` when the version is not one we still understand;
 *  - only a result with NO recorded version at all falls back to the historical
 *    shared rubric, because that is the rubric those records were written under.
 *
 * Returning `null` is deliberate and load-bearing: reinterpreting an attempt
 * graded under an unknown rubric would show a supervisor domain scores the
 * navigator never received. "Unavailable" is the honest answer.
 */
export function resolveScoringProfile(qa, profile) {
  if (profile) return profile;
  if (recordsRubricVersion(qa?.gradingMetadata)) {
    // Explicit version present: never fall back to a current department profile.
    return profileForGradedAttempt(qa.gradingMetadata, qa?.rubricDepartment);
  }
  // Genuinely pre-versioning legacy record.
  return getQaRubricProfile(qa?.gradingMetadata?.rubricDepartment ?? qa?.rubricDepartment)
    ?? DEFAULT_PROFILE;
}

/**
 * Why a QA result cannot be projected, or null when it can.
 */
export function scoringUnavailableReason(qa, profile) {
  if (profile) return null;
  if (!recordsRubricVersion(qa?.gradingMetadata)) return null;
  return resolveScoringProfile(qa) ? null : 'unknown-rubric-version';
}

function initBuckets(items) {
  return Object.fromEntries(items.map((item) => [item.id, null]));
}

function roundDetail(value) {
  return Math.round(value * 100) / 100;
}

function scoreQaByTag(qa, tagKey, items, profile) {
  const active = resolveScoringProfile(qa, profile);
  // An attempt graded under a rubric we no longer understand cannot be projected
  // at all. Return null rather than inventing per-domain scores under a rubric
  // that never graded it.
  if (!active) return null;
  const criteria = Array.isArray(qa?.criteria) ? qa.criteria : [];
  const verdicts = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const scores = initBuckets(items);

  for (const def of active.criteria) {
    const verdict = verdicts.get(def.id)?.verdict;
    if (!verdict || verdict === 'NA') continue;
    const tagIds = def[tagKey] ?? [];
    if (!tagIds.length) continue;
    const share = def.points / tagIds.length;
    for (const tagId of tagIds) {
      const current = scores[tagId] ?? { earned: 0, possible: 0, criteria: [] };
      current.possible += share;
      if (verdict === 'MET') current.earned += share;
      current.criteria.push(def.id);
      scores[tagId] = current;
    }
  }

  for (const item of items) {
    const detail = scores[item.id];
    if (!detail || detail.possible === 0) {
      scores[item.id] = null;
      continue;
    }
    scores[item.id] = {
      earned: roundDetail(detail.earned),
      possible: roundDetail(detail.possible),
      score: Math.round((detail.earned / detail.possible) * 100),
      criteria: detail.criteria,
    };
  }

  return applyAutoFails(scores, qa, tagKey, active.autoFails);
}

// Fold VERIFIED auto-fails into the per-tag summary. `qa.autoFails` is already
// the verified-only list produced by scoreQa (evidence-checked server-side); we
// never re-decide whether a fail is verified here. Any domain/competency tagged
// on a verified auto-fail is forced to score 0 with autoFailed:true so a
// supervisor can never see an affected tag as a clean, high, "normal" score.
// The auto-fail DEFINITIONS come from the grading profile, so a department that
// scopes its auto-fails differently tags the correct domains/competencies.
// QA-only — never touches the capability matrix or the pass/fail math.
function applyAutoFails(scores, qa, tagKey, autoFailDefs) {
  const verified = Array.isArray(qa?.autoFails) ? qa.autoFails : [];
  if (!verified.length) return scores;

  const defsById = new Map(autoFailDefs.map((a) => [a.id, a]));

  for (const fail of verified) {
    const def = defsById.get(fail?.id);
    if (!def) continue;
    const tagIds = def[tagKey] ?? [];
    const entry = { id: def.id, text: def.text };
    for (const tagId of tagIds) {
      if (!(tagId in scores)) continue; // unknown tag id — ignore
      const existing = scores[tagId];
      if (existing && existing.autoFailed) {
        existing.autoFails.push(entry);
        continue;
      }
      scores[tagId] = existing
        ? { ...existing, earned: 0, score: 0, autoFailed: true, autoFails: [entry] }
        : { earned: 0, possible: 0, score: 0, criteria: [], autoFailed: true, autoFails: [entry] };
    }
  }

  return scores;
}

export function scoreQaByDomain(qa, profile) {
  return scoreQaByTag(qa, 'domainIds', DOMAINS, profile);
}

export function scoreQaByCompetency(qa, profile) {
  return scoreQaByTag(qa, 'competencyIds', COMPETENCIES, profile);
}

export function qaDomainScoreSummary(qa, profile) {
  const unavailableReason = scoringUnavailableReason(qa, profile);
  if (unavailableReason) {
    // Explicit unavailable state. Consumers render "rubric unavailable" rather
    // than a fabricated set of zeroes, and shadow automation stays ineligible.
    return {
      domainScores: null,
      competencyScores: null,
      scoringUnavailable: true,
      scoringUnavailableReason: unavailableReason,
      recordedRubricVersion: qa?.gradingMetadata?.rubricVersion ?? null,
    };
  }
  return {
    domainScores: scoreQaByDomain(qa, profile),
    competencyScores: scoreQaByCompetency(qa, profile),
  };
}
