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
