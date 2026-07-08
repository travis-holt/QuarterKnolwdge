// Content-quality guards shared by generation, review UIs, and Firestore
// cleanup. These flag content that tests personal workflow preferences instead
// of objective safety/compliance outcomes.

const LOOKUP_TERMS = /\b(phone(?: number)?|date of birth|dob|phone-first|dob-first|lookup)\b/i;
const LOOKUP_ORDER_TERMS = /\b(first|before|start with|asked first|ask for first)\b/i;
const LOOKUP_SAFETY_TERMS = /\b(wrong (?:patient|chart)|correct chart|correct patient|sibling|family account|authorization|authori[sz]ed|privacy|duplicate chart|discuss(?:ing)? before|verify(?:ing|ication)? before)\b/i;

const REFILL_TERMS = /\b(refill|refills|medication|prescription)\b/i;
const REFILL_PE_TERMS = /\b(pe|physical exam)\b/i;
const REFILL_HARD_STOP_TERMS = /\b(cannot|can't|won't|not entitled|must be current|must be up to date|not up to date|not current|verify pe|check pe)\b/i;

function joinText(parts) {
  return parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .filter(Boolean)
    .join('\n');
}

export function detectLookupOrderPreference(text) {
  const body = String(text ?? '');
  if (!LOOKUP_TERMS.test(body) || !LOOKUP_ORDER_TERMS.test(body)) return null;
  if (LOOKUP_SAFETY_TERMS.test(body)) return null;
  return {
    severity: 'block',
    code: 'lookup_order_preference',
    message: 'This grades lookup order as right/wrong instead of testing chart safety or caller authorization.',
  };
}

export function detectRefillPeHardStop(text) {
  const body = String(text ?? '');
  if (!REFILL_TERMS.test(body) || !REFILL_PE_TERMS.test(body) || !REFILL_HARD_STOP_TERMS.test(body)) return null;
  return {
    severity: 'block',
    code: 'refill_pe_hard_stop',
    message: 'Standard refill handling should not require PE verification or deny the refill based on PE status alone.',
  };
}

export function detectOverusedWorkflow(items, maxShare = 0.35) {
  const total = items.length;
  if (!total) return [];
  const counts = items.reduce((acc, item) => {
    const key = item.workflowType ?? 'untyped';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .filter(([, count]) => count / total > maxShare)
    .map(([workflowType, count]) => ({
      severity: 'warn',
      code: 'workflow_overrepresented',
      workflowType,
      share: count / total,
      count,
      message: `${workflowType} makes up ${Math.round((count / total) * 100)}% of this bank.`,
    }));
}

export function validateQuestionContent(question) {
  const text = joinText([
    question?.scenario,
    (question?.options ?? []).map((o) => `${o?.text ?? ''}\n${o?.rationale ?? ''}`),
  ]);
  return [detectLookupOrderPreference(text), detectRefillPeHardStop(text)].filter(Boolean);
}

export function validateAuditContent(audit) {
  const text = joinText([
    audit?.hint,
    audit?.modelExplanation,
    (audit?.transcript ?? []).map((t) => `${t?.speaker ?? ''}: ${t?.message ?? ''}`),
  ]);
  return [detectLookupOrderPreference(text), detectRefillPeHardStop(text)].filter(Boolean);
}

export function hasBlockingFlags(flags = []) {
  return flags.some((flag) => flag.severity === 'block');
}
