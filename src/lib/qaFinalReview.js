export function aiQaPass(qa) {
  if (qa?.pass === true) return true;
  if (qa?.pass === false) return false;
  if (typeof qa?.score === 'number' && typeof qa?.passThreshold === 'number') {
    return qa.score >= qa.passThreshold;
  }
  return false;
}

export function qaFinalReviewStatus(session) {
  return session?.qaFinalReview?.status || 'pending';
}

function aiVerdictLabel(session) {
  if (session?.qa?.review?.recommendation === 'needs_review') return 'AI NEEDS REVIEW';
  return aiQaPass(session?.qa) ? 'AI PASS' : 'AI FAIL';
}

export function qaFinalReviewLabel(session) {
  switch (qaFinalReviewStatus(session)) {
    case 'confirmed_pass':
      return 'FINAL PASS';
    case 'confirmed_fail':
      return 'FINAL FAIL';
    case 'overridden_pass':
      return 'OVERRIDDEN PASS';
    case 'overridden_fail':
      return 'OVERRIDDEN FAIL';
    default:
      return 'Pending';
  }
}

export function qaFinalVerdict(session) {
  const status = qaFinalReviewStatus(session);
  const pending = status === 'pending';
  return {
    aiPass: aiQaPass(session?.qa),
    finalPass: pending ? null : (session?.qaFinalReview?.finalPass ?? null),
    status,
    needsSupervisorReview: pending,
    label: pending
      ? `${aiVerdictLabel(session)} - Pending supervisor review`
      : qaFinalReviewLabel(session),
  };
}

// Whether the AI recommended supervisor review for this attempt.
function aiNeedsReview(session) {
  return session?.qa?.review?.recommendation === 'needs_review';
}

/**
 * The compact history-badge label for a stored QA attempt. A pending (un-reviewed)
 * attempt is ALWAYS marked as an AI recommendation awaiting review — never a bare
 * PASS/FAIL — so a stored attempt is never mistaken for a final verdict. A reviewed
 * attempt shows the supervisor's final/overridden verdict.
 */
export function qaHistoryBadgeLabel(session) {
  if (qaFinalReviewStatus(session) !== 'pending') {
    return `QA TEST · ${qaFinalReviewLabel(session)}`;
  }
  if (aiNeedsReview(session)) return 'QA TEST · NEEDS SUPERVISOR REVIEW';
  return aiQaPass(session?.qa)
    ? 'QA TEST · AI PASS — PENDING REVIEW'
    : 'QA TEST · AI FAIL — PENDING REVIEW';
}

/**
 * Tone keyword ('pass' | 'fail' | 'review') for styling the history badge. A
 * reviewed attempt reflects the FINAL verdict; a pending attempt reflects the AI
 * recommendation (needs_review → 'review').
 */
export function qaBadgeTone(session) {
  const status = qaFinalReviewStatus(session);
  if (status !== 'pending') return status.includes('pass') ? 'pass' : 'fail';
  if (aiNeedsReview(session)) return 'review';
  return aiQaPass(session?.qa) ? 'pass' : 'fail';
}

/**
 * The navigator-facing verdict label for a freshly-graded QA scorecard (no
 * supervisor review has happened yet, so it is always an AI recommendation
 * pending review). `qa` is the raw scorecard, not a stored session.
 */
export function qaAiResultLabel(qa) {
  if (qa?.review?.recommendation === 'needs_review') return 'NEEDS SUPERVISOR REVIEW';
  return aiQaPass(qa)
    ? 'AI PASS — PENDING SUPERVISOR REVIEW'
    : 'AI FAIL — PENDING SUPERVISOR REVIEW';
}

/**
 * A short summary verdict label (no "QA TEST ·" prefix) for a stored QA session,
 * shared by the navigator's phase hub and dashboard cards. A pending (un-reviewed)
 * attempt is always an AI recommendation pending review — never a bare PASS/FAIL;
 * a reviewed attempt shows the supervisor's final/overridden verdict.
 */
export function qaSummaryLabel(session) {
  if (qaFinalReviewStatus(session) !== 'pending') return qaFinalReviewLabel(session);
  return qaAiResultLabel(session?.qa);
}
