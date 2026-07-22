// ─────────────────────────────────────────────────────────────────────────────
// END-TO-END adversarial fixtures for the verification-integrity correction pass.
//
// Everything here runs through the REAL pipeline — `gradeCallQaTranscript` with
// a stubbed Gemini transport, so prompt construction, raw validation, the
// malformed-response retry, repairs, scoring, the review layer, the grade
// projection and the QA domain/competency projections all execute for real. No
// mocked booleans stand in for a decision the server is supposed to make.
//
// Every identity is synthetic. Nothing here is calibration evidence and nothing
// here has readiness or automation authority.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { gradeCallQaTranscript, buildMessages } from './grade-call-qa.js';
import { QA_RUBRIC_PROFILES } from '../src/data/qaRubricProfiles.js';
import { CALL_QA_PROMPT_VERSION } from './_qa-grading-versions.js';
import { qaDomainScoreSummary, resolveQaScoringState } from '../src/lib/qaDomainScoring.js';
import { QA_RUBRIC_VERSION } from '../src/data/qaRubric.js';

const OBGYN = QA_RUBRIC_PROFILES.obgyn;

const nav = (text) => ({ role: 'navigator', text });
const caller = (text) => ({ role: 'patient', text });

// A complete, safe OB/GYN call. Individual fixtures below vary one thing.
const BASE_TRANSCRIPT = [
  nav('Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?'),
  caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991. I need to schedule my annual.'),
  nav('Happy to help with that. I can get your annual GYN visit scheduled.'),
  caller('That would be great.'),
  nav('You are all set for Tuesday the 14th at 9:00 at our Main Street office. Please arrive fifteen minutes early. Is there anything else I can help you with?'),
  caller('No, that is everything. Thank you.'),
];

const VALID_IDENTITY = [
  { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 1, quote: 'this is Maria Alvarez' },
  { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 1, quote: 'this is Maria Alvarez' },
  { field: 'dob', value: 'March 2nd 1991', role: 'caller', turnIndex: 1, quote: 'date of birth March 2nd 1991' },
];

const NA_CRITERIA = new Set(['comm-empathy', 'control-narrate']);

/** A raw all-MET model response for the OB/GYN profile. */
function modelResponse({
  identityEvidence = VALID_IDENTITY,
  identityEvidenceText = 'this is Maria Alvarez, date of birth March 2nd 1991',
  overrides = {},
  autoFails,
} = {}) {
  const identityIds = new Set(OBGYN.identityVerificationCriteria);
  const criteria = OBGYN.criteria.map((c) => {
    if (overrides[c.id]) return { id: c.id, ...overrides[c.id] };
    if (NA_CRITERIA.has(c.id)) {
      return { id: c.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: 'No cue on this call.', identityEvidence: [] };
    }
    if (identityIds.has(c.id)) {
      return {
        id: c.id, verdict: 'MET', basis: 'EVIDENCE', evidence: identityEvidenceText, note: '',
        identityEvidence,
      };
    }
    return {
      id: c.id, verdict: 'MET', basis: 'EVIDENCE',
      evidence: 'You are all set for Tuesday the 14th at 9:00 at our Main Street office',
      note: '', identityEvidence: [],
    };
  });
  return {
    criteria,
    autoFails: autoFails ?? OBGYN.autoFails.map((a) => ({ id: a.id, triggered: false, evidence: '', note: '' })),
  };
}

const SCENARIO_CONTEXT = {
  verified: true,
  status: 'verified',
  qaScenarioId: 'synthetic-obgyn-verification',
  department: 'obgyn',
  scenarioVersion: 'synthetic-v1',
  gradingScenario: 'Synthetic OB/GYN annual-GYN scheduling call.',
  ruleIds: [],
};

/** Run the real grading pipeline against a scripted sequence of raw responses. */
async function runPipeline(transcript, responses) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls = [];
  const result = await gradeCallQaTranscript({
    transcript,
    scenarioContext: SCENARIO_CONTEXT,
    captureMetadata: { captureComplete: true },
    transcriptMetadata: { captureStatus: 'captured' },
  }, {
    keys: ['synthetic-key'],
    graderModel: 'synthetic-model',
    sopContextForFresh: async () => 'Synthetic OB/GYN SOP context.',
    geminiWithRotation: async (_keys, _body, opts) => {
      calls.push(opts);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return {
        ok: true,
        text: typeof next === 'string' ? next : JSON.stringify(next),
        model: 'synthetic-model',
      };
    },
  });
  return { ...result, upstreamCalls: calls.length };
}

const criterion = (qa, id) => qa.criteria.find((c) => c.id === id);

// ─────────────────────────────────────────────────────────────────────────────

describe('E2E · safe opener followed by a protected disclosure in the SAME turn', () => {
  it('withholds verify-before-access and routes the attempt to supervisor review', async () => {
    const transcript = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?'),
      // Safe first clause, real disclosure in the second.
      nav('Let me open your chart. I can see Dr. Smith ordered an ultrasound.'),
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991.'),
      nav('Thank you. Is there anything else I can help you with?'),
    ];
    const identity = [
      { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 2, quote: 'this is Maria Alvarez' },
      { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 2, quote: 'this is Maria Alvarez' },
      { field: 'dob', value: 'March 2nd 1991', role: 'caller', turnIndex: 2, quote: 'date of birth March 2nd 1991' },
    ];
    const { qa } = await runPipeline(transcript, modelResponse({ identityEvidence: identity }));

    expect(criterion(qa, 'verify-three').verdict).toBe('MET');
    const order = criterion(qa, 'verify-before-access');
    expect(order.verdict).toBe('NOT_MET');
    expect(order.identityVerification.disclosureCategory).toBe('order');
    expect(order.identityVerification.orderReason).toBe('identifiers-collected-after-disclosure');
    // The disclosure costs a safety-critical criterion, so the attempt cannot be
    // a confident pass. Here it lands below the pass mark outright — a confident
    // FAIL is the correct outcome, and `needs_review` is reserved for a PASS that
    // would otherwise be granted over a safety miss (covered separately below).
    expect(qa.pass).toBe(false);
    expect(qa.review.recommendation).not.toBe('pass');
    expect(qa.review.safetyRisk).not.toBe('none');
  });

  it('will not grant a confident PASS when the order failure is the only miss', async () => {
    // Same defect, but every other criterion earns its points, so the numeric
    // score stays above the pass mark. The review layer must refuse to call that
    // a confident pass, because a safety-critical criterion was missed.
    const transcript = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?'),
      nav('Let me open your chart. I can see Dr. Smith ordered an ultrasound.'),
      caller('Hi, this is Maria Alvarez, date of birth March 2nd 1991.'),
      nav('You are all set for Tuesday the 14th at 9:00 at our Main Street office. Is there anything else I can help you with?'),
    ];
    const identity = [
      { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 2, quote: 'this is Maria Alvarez' },
      { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 2, quote: 'this is Maria Alvarez' },
      { field: 'dob', value: 'March 2nd 1991', role: 'caller', turnIndex: 2, quote: 'date of birth March 2nd 1991' },
    ];
    const { qa } = await runPipeline(transcript, modelResponse({ identityEvidence: identity }));
    expect(criterion(qa, 'verify-before-access').verdict).toBe('NOT_MET');
    expect(qa.review.recommendation).not.toBe('pass');
  });
});

describe('E2E · a name that is not the patient\'s never verifies identity', () => {
  const transcript = [
    nav('Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?'),
    caller('I need to reach Dr. Reyes, and Dr. Chen referred me. My date of birth is March 2nd 1991.'),
    nav('Is there anything else I can help you with?'),
  ];

  it('a navigator-role identity claim is a malformed response (caller-only, v6)', async () => {
    // v6 forbids a navigator-sourced identifier at the schema/validation level, so
    // it can never even reach scoring — it trips the malformed-response retry, and
    // with no valid alternative the grader is reported unusable.
    await expect(runPipeline(transcript, modelResponse({
      identityEvidence: [
        { field: 'firstName', value: 'Dana', role: 'navigator', turnIndex: 0, quote: 'this is Dana' },
        { field: 'lastName', value: 'Reyes', role: 'caller', turnIndex: 1, quote: 'Dr. Reyes' },
        { field: 'dob', value: 'March 2nd 1991', role: 'caller', turnIndex: 1, quote: 'date of birth is March 2nd 1991' },
      ],
    }))).rejects.toThrow();
  });

  it('rejects provider names submitted as the patient identity', async () => {
    const { qa } = await runPipeline(transcript, modelResponse({
      identityEvidence: [
        { field: 'firstName', value: 'Reyes', role: 'caller', turnIndex: 1, quote: 'I need to reach Dr. Reyes' },
        { field: 'lastName', value: 'Chen', role: 'caller', turnIndex: 1, quote: 'Dr. Chen referred me' },
        { field: 'dob', value: 'March 2nd 1991', role: 'caller', turnIndex: 1, quote: 'date of birth is March 2nd 1991' },
      ],
    }));
    const verify = criterion(qa, 'verify-three');
    expect(verify.verdict).toBe('NOT_MET');
    const reasons = verify.identityVerification.rejectedClaims.map((r) => `${r.field}:${r.reason}`);
    expect(reasons).toContain('firstName:not-a-patient-identity-context');
    expect(reasons).toContain('lastName:not-a-patient-identity-context');
    expect(qa.review.recommendation).toBe('needs_review');
  });

  it('accepts an authorized third-party caller naming the patient', async () => {
    const thirdParty = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?'),
      caller('I\'m calling for my daughter, Maria Alvarez. Her date of birth is March 2nd 1991.'),
      nav('You are all set for Tuesday the 14th at 9:00 at our Main Street office. Is there anything else I can help you with?'),
    ];
    const { qa } = await runPipeline(thirdParty, modelResponse({
      identityEvidence: [
        { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 1, quote: 'calling for my daughter, Maria Alvarez' },
        { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 1, quote: 'calling for my daughter, Maria Alvarez' },
        { field: 'dob', value: 'March 2nd 1991', role: 'caller', turnIndex: 1, quote: 'date of birth is March 2nd 1991' },
      ],
    }));
    expect(criterion(qa, 'verify-three').verdict).toBe('MET');
  });

  it('ignores an unrelated full name the caller merely mentioned', async () => {
    const mention = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?'),
      caller('I spoke with Maria Alvarez yesterday. My date of birth is March 2nd 1991.'),
      nav('Is there anything else I can help you with?'),
    ];
    const { qa } = await runPipeline(mention, modelResponse({
      identityEvidence: [
        { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 1, quote: 'I spoke with Maria Alvarez yesterday' },
        { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 1, quote: 'I spoke with Maria Alvarez yesterday' },
        { field: 'dob', value: 'March 2nd 1991', role: 'caller', turnIndex: 1, quote: 'date of birth is March 2nd 1991' },
      ],
    }));
    expect(criterion(qa, 'verify-three').verdict).toBe('NOT_MET');
  });
});

describe('E2E · fabricated free-text evidence never reaches a supervisor', () => {
  it('replaces a fabricated identity quote with a server-derived summary', async () => {
    const { qa, grade } = await runPipeline(BASE_TRANSCRIPT, modelResponse({
      identityEvidenceText: 'The patient was fully verified against the chart.',
    }));
    const verify = criterion(qa, 'verify-three');
    expect(verify.verdict).toBe('MET');
    expect(verify.evidence).not.toContain('fully verified against the chart');
    expect(verify.evidenceSource).toBe('server-derived');
    // The raw model claim is preserved for audit, but never as observed evidence.
    expect(verify.modelJudgment.evidence).toContain('fully verified against the chart');

    const rendered = [grade.summary, ...grade.strengths, ...grade.improvements].join(' ');
    expect(rendered).not.toContain('fully verified against the chart');
    // And no patient identifier is repeated back into the feedback prose.
    expect(rendered).not.toContain('Alvarez');
    expect(rendered).not.toContain('March 2nd 1991');
  });
});

describe('E2E · spoken and impossible dates of birth', () => {
  it('verifies a spoken-word date of birth', async () => {
    const spoken = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?'),
      caller('This is Maria Alvarez, born March second nineteen ninety-one.'),
      nav('You are all set for Tuesday the 14th at 9:00. Is there anything else I can help you with?'),
    ];
    const { qa } = await runPipeline(spoken, modelResponse({
      identityEvidence: [
        { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 1, quote: 'This is Maria Alvarez' },
        { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 1, quote: 'This is Maria Alvarez' },
        { field: 'dob', value: 'March second nineteen ninety-one', role: 'caller', turnIndex: 1, quote: 'born March second nineteen ninety-one' },
      ],
    }));
    expect(criterion(qa, 'verify-three').verdict).toBe('MET');
  });

  it('refuses an impossible calendar date', async () => {
    const impossible = [
      nav('Thank you for calling Aizer Women\'s Health, this is Dana. How can I help you today?'),
      caller('This is Maria Alvarez, date of birth February 31st 1991.'),
      nav('Is there anything else I can help you with?'),
    ];
    const { qa } = await runPipeline(impossible, modelResponse({
      identityEvidence: [
        { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 1, quote: 'This is Maria Alvarez' },
        { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 1, quote: 'This is Maria Alvarez' },
        { field: 'dob', value: 'February 31st 1991', role: 'caller', turnIndex: 1, quote: 'date of birth February 31st 1991' },
      ],
    }));
    const verify = criterion(qa, 'verify-three');
    expect(verify.verdict).toBe('NOT_MET');
    expect(verify.identityVerification.rejectedClaims.map((r) => r.reason))
      .toContain('value-is-not-a-date-of-birth');
  });
});

describe('E2E · malformed first response triggers the retry, second response scores', () => {
  it('retries after duplicate criterion ids', async () => {
    const good = modelResponse();
    const duplicated = { ...good, criteria: [...good.criteria, good.criteria[0]] };
    const { qa, upstreamCalls } = await runPipeline(BASE_TRANSCRIPT, [duplicated, good]);
    expect(upstreamCalls).toBe(2);
    expect(qa.score).toBeGreaterThan(0);
  });

  it('retries after an unknown auto-fail id', async () => {
    const good = modelResponse();
    const invented = modelResponse({
      autoFails: [
        ...OBGYN.autoFails.map((a) => ({ id: a.id, triggered: false, evidence: '', note: '' })),
        { id: 'af-invented', triggered: true, evidence: 'some line', note: '' },
      ],
    });
    const { qa, upstreamCalls } = await runPipeline(BASE_TRANSCRIPT, [invented, good]);
    expect(upstreamCalls).toBe(2);
    expect(qa.autoFails).toHaveLength(0);
  });

  // B5 — a MET identity criterion with no structured payload is a MODEL contract
  // failure, not a navigator failure. It must trip the retry, not silently become
  // a navigator deduction.
  it('retries after a MET identity criterion with an EMPTY payload, then scores the good response', async () => {
    const malformed = modelResponse({ identityEvidence: [] }); // verify-three MET, empty array
    const good = modelResponse();
    const { qa, upstreamCalls } = await runPipeline(BASE_TRANSCRIPT, [malformed, good]);
    expect(upstreamCalls).toBe(2);
    // The FIRST (malformed) response never deducted the navigator's verification.
    expect(criterion(qa, 'verify-three').verdict).toBe('MET');
    expect(qa.score).toBeGreaterThan(0);
  });

  it('retries after a MET identity criterion missing the DOB claim', async () => {
    const malformed = modelResponse({
      identityEvidence: [
        { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 1, quote: 'this is Maria Alvarez' },
        { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 1, quote: 'this is Maria Alvarez' },
      ],
    });
    const good = modelResponse();
    const { qa, upstreamCalls } = await runPipeline(BASE_TRANSCRIPT, [malformed, good]);
    expect(upstreamCalls).toBe(2);
    expect(criterion(qa, 'verify-three').verdict).toBe('MET');
  });

  it('two malformed identity responses fail as an unusable grader, never a false navigator failure', async () => {
    const malformed = modelResponse({ identityEvidence: [] });
    await expect(runPipeline(BASE_TRANSCRIPT, [malformed, malformed])).rejects.toThrow(/unusable/i);
  });
});

describe('E2E · historical rendering', () => {
  it('projects a metadata-less OB/GYN record with the OLD closing ids under the shared rubric', () => {
    const stored = {
      rubricDepartment: 'obgyn',
      criteria: [
        { id: 'close-survey', verdict: 'MET' },
        { id: 'close-anything-thanks', verdict: 'MET' },
        { id: 'open-greet', verdict: 'MET' },
      ],
      autoFails: [],
    };
    const state = resolveQaScoringState(stored);
    expect(state.scoringUnavailable).toBe(false);
    expect(state.profile.rubricVersion).toBe(QA_RUBRIC_VERSION);

    const { domainScores } = qaDomainScoreSummary(stored);
    // The old closing criteria are recognised; `close-offer-help` never appears.
    expect(domainScores.documentation.criteria).toContain('close-survey');
    expect(domainScores.intake.criteria).toContain('close-anything-thanks');
    expect(JSON.stringify(domainScores)).not.toContain('close-offer-help');
  });

  it('withholds projections for an unknown future rubric carrying stale domain scores', () => {
    const stored = {
      gradingMetadata: { rubricVersion: 'qa-rubric-obgyn-v99', rubricDepartment: 'obgyn' },
      // A future build's projections, which this build must not present as its own.
      domainScores: { intake: { score: 95, possible: 10, earned: 9.5, criteria: ['unknown-criterion'] } },
      scoringUnavailable: false,
      criteria: [{ id: 'unknown-criterion', verdict: 'MET' }],
      autoFails: [],
    };
    const state = resolveQaScoringState(stored);
    expect(state.scoringUnavailable).toBe(true);
    expect(state.profile).toBeNull();
    expect(state.recordedRubricVersion).toBe('qa-rubric-obgyn-v99');

    const summary = qaDomainScoreSummary(stored);
    expect(summary.domainScores).toBeNull();
    expect(summary.competencyScores).toBeNull();
    expect(summary.scoringUnavailableReason).toBe('unknown-rubric-version');
  });
});

describe('E2E · prompt contract matches what the server enforces', () => {
  const { systemInstruction } = buildMessages(
    'Synthetic scenario.', BASE_TRANSCRIPT, 'obgyn', 'Synthetic SOP context.', OBGYN,
  );

  it('is stamped with the current prompt version', () => {
    expect(CALL_QA_PROMPT_VERSION).toBe('call-qa-grader-v6');
  });

  it('tells the model the navigator\'s own name is not the patient\'s', () => {
    expect(systemInstruction).toMatch(/NAVIGATOR'S OWN NAME is never the patient/i);
  });

  it('tells the model a provider or staff name is not the patient\'s', () => {
    expect(systemInstruction).toMatch(/PROVIDER or STAFF name is never the patient/i);
  });

  it('tells the model spoken dates of birth are acceptable', () => {
    expect(systemInstruction).toMatch(/March second nineteen ninety-one/);
  });

  it('tells the model every auto-fail id must be returned', () => {
    expect(systemInstruction).toMatch(/entry for EVERY auto-fail id/i);
  });

  it('tells the model a triggered auto-fail needs a quote', () => {
    expect(systemInstruction).toMatch(/triggered auto-fail with no quote is[\s\S]{0,20}rejected/i);
  });

  it('tells the model its free-text identity evidence is discarded', () => {
    expect(systemInstruction).toMatch(/server\s+derives their evidence from this array/i);
  });

  it('still describes identity as caller-eligible for the two verification criteria only', () => {
    expect(systemInstruction).toMatch(/\[verify-three\] and \[verify-before-access\]/);
  });
});
