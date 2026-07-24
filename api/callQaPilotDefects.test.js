// ─────────────────────────────────────────────────────────────────────────────
// Regression tests for the first real post-PR-41 Call QA pilot defects
// (2026-07-24). Reproduced pattern: an OB/GYN caller says her provider told her
// she needs a Growth ultrasound, but there is NO visible order and no future
// appointment, so the correct workflow is clarification/TE — not scheduling.
//
// Covers:
//   A. Navigator-visible chart reaches the browser ready payload; grader-only
//      fields never do; fail-closed when a chart-dependent scenario has no chart.
//   C. Grading: sched-flow can be NOT_MET when the navigator wrongly books; the
//      correct no-booking workflow leaves sched-recap NA (never a second penalty);
//      listen-gather is not failed for internal chart facts.
//   D. Caller: caller system instruction is caller-only + no-disclaimer; a caller
//      role-break forces needs_review without turning the rubric into an auto-fail.
//   E. Existing invariants (rubric total / pass / closing / Pediatrics unchanged).
//
// Pure — no Gemini, no Firestore, no network.

import { describe, it, expect, vi } from 'vitest';
import {
  handleConnection, navigatorVisibleChartProjection,
} from './live-relay.js';
import {
  validatePrivateScenario, privateScenarioDocumentId,
} from './_call-qa-scenario-store.js';
import { buildAttemptDoc } from './_call-qa-attempts.js';
import {
  buildTrustedGradingScenario, buildScenarioContextFromAttempt, buildMessages,
  gradeCallQaTranscript, renderNavigatorChartLines, CALL_QA_PROMPT_VERSION,
} from './grade-call-qa.js';
import { detectCallerRoleBreak } from './_qa-caller-integrity.js';
import { buildSystemInstruction } from './interview-turn.js';
import { QA_RUBRIC_PROFILES } from '../src/data/qaRubricProfiles.js';
import {
  OBGYN_RULE_SET_VERSION, OBGYN_SOP_VERSION, OBGYN_SOURCE_AUTHORITY,
} from '../src/data/obgynWorkflowRules.js';

const OBGYN = QA_RUBRIC_PROFILES.obgyn;

// ── The reproduced Growth-ultrasound scenario (code-owned fixture) ────────────
const NAV_CHART = {
  summary: 'Established OB patient — routine prenatal care.',
  planRto: 'RTO 4 weeks (routine prenatal follow-up).',
  activeOrders: [],
  openEncounters: [],
  futureAppointments: [],
  otherFacts: [
    'No sonography or ultrasound order on file.',
    'No Growth ultrasound order on file.',
    'No upcoming Growth ultrasound appointment scheduled.',
    'No open Telephone Encounter related to imaging.',
  ],
};

const GROWTH_SCENARIO = {
  id: 'qa-obgyn-growth-ultrasound-pilot',
  version: 'pilot-fixture-v1',
  department: 'obgyn',
  title: 'Caller believes she needs a Growth ultrasound',
  workflowType: 'missing_rto_order',
  difficulty: 'medium',
  primaryDomainId: 'classification',
  domainIds: ['classification', 'scheduling'],
  competencyIds: ['sopKnowledge', 'sopApplication', 'criticalThinking'],
  callerName: 'Maria',
  openingLine: 'Hi, my doctor said I need a growth ultrasound and I want to schedule it.',
  publicBriefing: 'A pregnant caller says her provider told her she needs a Growth ultrasound and wants to schedule it.',
  gradingContext: 'The caller wants to schedule a Growth ultrasound. Judge chart-dependent decisions against the navigator-visible chart only.',
  expectedActions: [
    'Verify the patient with first name, last name, and DOB before discussing the chart.',
    'Explain that no sonography/ultrasound order is on file.',
    'Do NOT schedule a Growth ultrasound without an order.',
    'Route a clarification/message to the OB clinical team to confirm the order.',
  ],
  criticalMisses: [
    'Scheduling a Growth ultrasound with no order on file.',
    'Telling the caller the ultrasound is booked.',
  ],
  scoringNotes: [
    'The correct outcome is NO booking on this call; sched-recap is NA.',
  ],
  hiddenChartState: { sonographyOrder: null, futureGrowthUltrasound: null, rto: '4 weeks' },
  navigatorChartState: NAV_CHART,
  requiresNavigatorChartContext: true,
  callerCaseFile: {
    callerGoal: 'Get the Growth ultrasound her provider mentioned scheduled.',
    knownFacts: ['My provider said I need a growth ultrasound.', 'I am about 30 weeks.'],
  },
  ruleIds: ['rto_documentation'],
  sourceSopVersion: OBGYN_SOP_VERSION,
  sourceRuleVersion: OBGYN_RULE_SET_VERSION,
  sourceAuthority: OBGYN_SOURCE_AUTHORITY,
};

// Reproduced transcript: identity is properly collected; the LAST navigator turn
// WRONGLY books a Growth ultrasound that has no order on file.
const WRONG_BOOKING_TRANSCRIPT = [
  { role: 'navigator', text: "Thank you for calling Aizer Women's Health, this is Dana. How can I help you today?" },
  { role: 'patient', text: 'Hi, my doctor said I need a growth ultrasound and I want to schedule it.' },
  { role: 'navigator', text: 'I can help. Can I have your first name, last name, and date of birth please?' },
  { role: 'patient', text: 'Sure, Maria Alvarez, March 2nd 1991.' },
  { role: 'navigator', text: 'Thank you Maria. Let me open your chart so I can help you get that scheduled.' },
  { role: 'navigator', text: 'You are all set for your growth ultrasound Tuesday at 9. Is there anything else I can help you with?' },
];

const IDENTITY_EVIDENCE = [
  { field: 'firstName', value: 'Maria', role: 'caller', turnIndex: 3, quote: 'Sure, Maria Alvarez, March 2nd 1991.' },
  { field: 'lastName', value: 'Alvarez', role: 'caller', turnIndex: 3, quote: 'Sure, Maria Alvarez, March 2nd 1991.' },
  { field: 'dob', value: 'March 2nd 1991', role: 'caller', turnIndex: 3, quote: 'Sure, Maria Alvarez, March 2nd 1991.' },
];

// Build a full, valid OB/GYN model response for WRONG_BOOKING_TRANSCRIPT with
// sensible defaults, applying per-criterion overrides.
function obgynResponse(overrides = {}) {
  const defaults = {
    'open-greet': { verdict: 'MET', evidence: 'Thank you for calling' },
    'open-name': { verdict: 'MET', evidence: 'this is Dana' },
    'open-org': { verdict: 'MET', evidence: "Aizer Women's Health" },
    'verify-three': { verdict: 'MET', evidence: 'Sure, Maria Alvarez, March 2nd 1991.', identity: true },
    'verify-before-access': { verdict: 'MET', evidence: 'Sure, Maria Alvarez, March 2nd 1991.', identity: true },
    'control-narrate': { verdict: 'NA' },
    'control-guide': { verdict: 'MET', evidence: 'How can I help you today' },
    'doc-reason': { verdict: 'NA' },
    'doc-te': { verdict: 'NA' },
    'comm-plain': { verdict: 'MET', evidence: 'I can help' },
    'comm-professional': { verdict: 'MET', evidence: 'Thank you Maria' },
    'comm-empathy': { verdict: 'NA' },
    'listen-ack': { verdict: 'MET', evidence: 'I can help' },
    'listen-gather': { verdict: 'MET', evidence: 'Can I have your first name, last name, and date of birth' },
    'know-rule': { verdict: 'NOT_MET', basis: 'EVIDENCE', evidence: 'You are all set for your growth ultrasound', note: 'Booked a Growth ultrasound with no order on file.' },
    'know-details': { verdict: 'NA' },
    'sched-flow': { verdict: 'NOT_MET', basis: 'EVIDENCE', evidence: 'You are all set for your growth ultrasound Tuesday at 9', note: 'Wrongly booked a scan with no order.' },
    'sched-recap': { verdict: 'NA' },
    'close-offer-help': { verdict: 'MET', evidence: 'anything else I can help you with' },
  };
  const merged = { ...defaults };
  for (const [id, patch] of Object.entries(overrides)) merged[id] = { ...defaults[id], ...patch };

  const criteria = OBGYN.criteria.map((c) => {
    const d = merged[c.id] ?? { verdict: 'NA' };
    const verdict = d.verdict;
    // Derive basis/evidence from the FINAL verdict so an override to NA/ABSENCE
    // never inherits a stale EVIDENCE basis from the default it replaced.
    let basis; let evidence; let note = d.note ?? '';
    if (verdict === 'MET') { basis = 'EVIDENCE'; evidence = d.evidence ?? ''; }
    else if (verdict === 'NOT_MET' && (d.basis === 'EVIDENCE' || d.evidence)) { basis = 'EVIDENCE'; evidence = d.evidence ?? ''; }
    else { basis = 'ABSENCE'; evidence = ''; if (verdict === 'NA') note = ''; }
    return {
      id: c.id, verdict, basis, evidence, note,
      identityEvidence: d.identity ? IDENTITY_EVIDENCE : [],
    };
  });
  const autoFails = OBGYN.autoFails.map((a) => ({ id: a.id, triggered: false, evidence: '', note: '' }));
  return { criteria, autoFails };
}

function scenarioContextFor(scenario = GROWTH_SCENARIO) {
  const attempt = { id: 'att-1', ...buildAttemptDoc({ navigatorId: 'n', name: 'N', department: 'obgyn', scenario, liveModel: 'm' }) };
  return buildScenarioContextFromAttempt(attempt);
}

async function grade(transcript, modelResponse, scenarioContext = scenarioContextFor()) {
  return gradeCallQaTranscript(
    { transcript, scenarioContext, captureMetadata: { captureComplete: true }, transcriptMetadata: { captureStatus: 'captured' } },
    {
      keys: ['fixture-key'], graderModel: 'fixture-model',
      sopContextForFresh: async () => 'Synthetic OB/GYN SOP context.',
      geminiWithRotation: async () => ({ ok: true, text: JSON.stringify(modelResponse), model: 'fixture-model' }),
    },
  );
}

// ── A. Navigator-visible chart projection + fail-closed ───────────────────────

describe('navigatorVisibleChartProjection', () => {
  it('projects only navigator-visible chart fields', () => {
    const projected = navigatorVisibleChartProjection({
      ...NAV_CHART,
      gradingContext: 'LEAK', expectedActions: ['LEAK'], hiddenChartState: { leak: true },
    });
    expect(projected).toMatchObject({ summary: NAV_CHART.summary, planRto: NAV_CHART.planRto, otherFacts: NAV_CHART.otherFacts });
    expect(projected).not.toHaveProperty('gradingContext');
    expect(projected).not.toHaveProperty('expectedActions');
    expect(projected).not.toHaveProperty('hiddenChartState');
    // Empty list fields are omitted (the panel renders "None on file" for them).
    expect(projected).not.toHaveProperty('activeOrders');
  });

  it('returns null when there is no navigator-visible chart', () => {
    expect(navigatorVisibleChartProjection(null)).toBeNull();
    expect(navigatorVisibleChartProjection({ activeOrders: [] })).toBeNull();
  });
});

describe('validatePrivateScenario navigator chart requirement (OB/GYN)', () => {
  const base = () => structuredClone(GROWTH_SCENARIO);
  const validate = (data) => validatePrivateScenario({ ...data, active: true }, {
    documentId: privateScenarioDocumentId(data), department: 'obgyn',
  });

  it('accepts a chart-dependent OB/GYN scenario with a non-empty navigator chart', () => {
    const result = validate(base());
    expect(result.requiresNavigatorChartContext).toBe(true);
    expect(result.navigatorChartState).toMatchObject({ planRto: NAV_CHART.planRto });
  });

  it('fails closed when a chart-dependent scenario has no navigator chart', () => {
    expect(() => validate({ ...base(), navigatorChartState: null }))
      .toThrow(/requires a non-empty navigatorChartState/i);
    expect(() => validate({ ...base(), navigatorChartState: { activeOrders: [] } }))
      .toThrow(/requires a non-empty navigatorChartState/i);
  });

  it('requires an explicit requiresNavigatorChartContext boolean on OB/GYN scenarios', () => {
    const data = base();
    delete data.requiresNavigatorChartContext;
    expect(() => validate(data)).toThrow(/must declare requiresNavigatorChartContext/i);
  });

  it('allows an OB/GYN scenario that does not depend on chart facts', () => {
    const result = validate({ ...base(), requiresNavigatorChartContext: false, navigatorChartState: null });
    expect(result.requiresNavigatorChartContext).toBe(false);
    expect(result.navigatorChartState).toBeNull();
  });
});

// Compact relay harness (mirrors liveRelay.test.js).
let ipCounter = 0;
function relayHarness(scenario) {
  const store = new Map();
  const client = { readyState: 1, sent: [], _h: {}, on(e, fn) { this._h[e] = fn; },
    async emit(e, a) { return this._h[e]?.(a); }, send(s) { this.sent.push(JSON.parse(s)); },
    close() { this.readyState = 3; }, last(type) { return [...this.sent].reverse().find((m) => m.type === type); } };
  const upstreamRef = {};
  const deps = {
    verifyToken: vi.fn(async () => ({ role: 'navigator', navigatorId: 'nav-a' })),
    getApiKeys: () => ['k1'],
    buildSystemInstruction: () => 'persona',
    selectScenario: vi.fn(async () => scenario),
    loadPriorQaAttempts: vi.fn(async () => []),
    loadRosterMember: vi.fn(async () => ({ id: 'nav-a', name: 'Ada', status: 'active' })),
    db: () => ({ collection: () => ({ doc: () => ({ id: 'att-x', async set(v) { store.set('att-x', v); } }) }) }),
    now: () => 1000, setTimer: () => ({ unref() {} }), clearTimer: () => {},
    clientIp: () => `pilot-ip-${++ipCounter}`, liveModel: 'live-m',
    createUpstream: (_k, h) => { upstreamRef.h = h; return { send() {}, close() {} }; },
  };
  return { client, deps, upstreamRef, store };
}

async function startRelay(h) {
  handleConnection(h.client, {}, h.deps);
  await h.client.emit('message', JSON.stringify({ type: 'start', idToken: 't', mode: 'test', department: 'obgyn' }));
  await new Promise((r) => setTimeout(r, 0));
  if (h.upstreamRef.h) { h.upstreamRef.h.onOpen?.(); h.upstreamRef.h.onMessage?.({ setupComplete: true }); }
  await new Promise((r) => setTimeout(r, 0));
}

describe('relay ready projection — navigator chart reaches browser, grader-only never does', () => {
  it('sends the navigator-visible chart in ready.scenario and NO grader-only fields', async () => {
    const h = relayHarness(GROWTH_SCENARIO);
    await startRelay(h);
    const ready = h.client.last('ready');
    expect(ready).toBeTruthy();
    expect(ready.scenario.navigatorChartState).toMatchObject({ planRto: NAV_CHART.planRto, otherFacts: NAV_CHART.otherFacts });
    // No grader-only / answer material anywhere in the browser payload.
    const json = JSON.stringify(ready);
    for (const token of ['gradingContext', 'expectedActions', 'criticalMisses', 'scoringNotes', 'hiddenChartState', 'callerCaseFile', 'ruleIds']) {
      expect(json).not.toContain(token);
    }
    expect(ready.scenario).not.toHaveProperty('gradingContext');
    expect(ready.scenario).not.toHaveProperty('hiddenChartState');
  });

  it('fails closed (no ready) when a chart-dependent scenario has no navigator chart', async () => {
    const broken = { ...GROWTH_SCENARIO, navigatorChartState: null };
    const h = relayHarness(broken);
    await startRelay(h);
    expect(h.client.last('ready')).toBeUndefined();
    expect(h.client.last('error')).toBeTruthy();
    expect(h.store.size).toBe(0); // no server attempt created
  });
});

// ── B/grader-context. Navigator-visible chart threads into the grader prompt ──

describe('grader context threads the navigator-visible chart', () => {
  it('renders navigator chart lines with explicit "None on file" for empty sections', () => {
    const lines = renderNavigatorChartLines(NAV_CHART).join('\n');
    expect(lines).toMatch(/Active orders: None on file/);
    expect(lines).toMatch(/Future appointments: None on file/);
    expect(lines).toMatch(/No sonography or ultrasound order on file\./);
  });

  it('includes a NAVIGATOR-VISIBLE CHART block and reframes hidden chart as grader-only', () => {
    const text = buildTrustedGradingScenario({
      gradingContext: 'ctx', title: 't', workflowType: 'w', difficulty: 'medium',
      expectedActions: ['a'], criticalMisses: ['m'], scoringNotes: [],
      hiddenChartState: { rto: '4 weeks' }, navigatorChartState: NAV_CHART,
    });
    expect(text).toMatch(/NAVIGATOR-VISIBLE CHART/);
    expect(text).toMatch(/ONLY against these navigator-visible facts/i);
    expect(text).toMatch(/grader ground-truth context ONLY/i);
    expect(text).toMatch(/never penalize the navigator for not acting on a hidden fact/i);
  });

  it('grader instructions carry the sched-recap NA and listen-gather caller-observable rules; prompt is v9', () => {
    const { systemInstruction } = buildMessages('grading scenario', WRONG_BOOKING_TRANSCRIPT, 'obgyn', 'sop', OBGYN);
    expect(systemInstruction).toMatch(/SCHEDULING RECAP: \[sched-recap\] is CONDITIONAL/);
    expect(systemInstruction).toMatch(/CALLER-OBSERVABLE information gathering/);
    expect(systemInstruction).toMatch(/NAVIGATOR-VISIBLE CHART: when the scenario provides/);
    expect(CALL_QA_PROMPT_VERSION).toBe('call-qa-grader-v9');
  });
});

// ── C. Grading — sched-flow / sched-recap / listen-gather applicability ───────

describe('grading applicability (reproduced no-order Growth ultrasound)', () => {
  it('keeps sched-recap NA and sched-flow NOT_MET when the navigator wrongly books', async () => {
    const { qa } = await grade(WRONG_BOOKING_TRANSCRIPT, obgynResponse());
    const schedFlow = qa.criteria.find((c) => c.id === 'sched-flow');
    const schedRecap = qa.criteria.find((c) => c.id === 'sched-recap');
    expect(schedFlow.verdict).toBe('NOT_MET');   // the wrong booking is captured here
    expect(schedRecap.verdict).toBe('NA');       // no appointment should exist → NA, not a 2nd penalty
    // The scheduling category excludes the NA sched-recap from applicable points.
    const scheduling = qa.categories.find((c) => c.id === 'scheduling');
    expect(scheduling.applicablePoints).toBe(8); // sched-flow (8) only; sched-recap (7) is NA
  });

  it('does not fail listen-gather for internal chart facts the navigator could not see', async () => {
    const { qa } = await grade(WRONG_BOOKING_TRANSCRIPT, obgynResponse());
    const listenGather = qa.criteria.find((c) => c.id === 'listen-gather');
    expect(listenGather.verdict).toBe('MET'); // gathered caller-provided info; not failed for chart state
  });

  it('still fails listen-gather when the navigator genuinely omits a required caller question', async () => {
    const response = obgynResponse({
      'listen-gather': { verdict: 'NOT_MET', basis: 'ABSENCE', note: 'Never asked what the caller was actually calling about.' },
    });
    const { qa } = await grade(WRONG_BOOKING_TRANSCRIPT, response);
    expect(qa.criteria.find((c) => c.id === 'listen-gather').verdict).toBe('NOT_MET');
  });
});

// ── D. Caller architecture + role-break fail-safe ─────────────────────────────

describe('caller system instruction is caller-only with explicit no-disclaimer rules', () => {
  const persona = buildSystemInstruction('Maria', 'A pregnant caller wants a growth ultrasound.', { department: 'obgyn' });

  it('does NOT feed the caller the navigator scoring/decision/mistake material', () => {
    expect(persona).not.toMatch(/SCORING PRINCIPLES/);
    expect(persona).not.toMatch(/DECISION LOOP/);
    expect(persona).not.toMatch(/NAVIGATOR MISTAKE TYPES/);
    expect(persona).not.toMatch(/STRICT on safety/);
  });

  it('explicitly forbids AI/meta/safety-disclaimer role breaks and preserves patient speech', () => {
    expect(persona).toMatch(/NEVER say or imply you are an AI/i);
    expect(persona).toMatch(/NEVER acknowledge that this is a simulation/i);
    expect(persona).toMatch(/not a medical professional/i);
    expect(persona).toMatch(/this isn't medical advice/i);
    expect(persona).toMatch(/repeat what a clinician previously told you/i);
    expect(persona).toMatch(/CALLER ROLEPLAY/);
  });
});

describe('detectCallerRoleBreak', () => {
  it('flags the reproduced AI/safety-disclaimer statement', () => {
    const transcript = [
      { role: 'navigator', text: 'How can I help?' },
      { role: 'patient', text: "I'm required to tell you that I'm not a medical professional, and this isn't medical advice or a diagnosis. You should always see a healthcare professional or seek care." },
    ];
    const result = detectCallerRoleBreak(transcript);
    expect(result.detected).toBe(true);
    expect(result.turnIndex).toBe(1);
  });

  it('flags an explicit AI self-identification', () => {
    expect(detectCallerRoleBreak([{ role: 'patient', text: 'As an AI language model, I cannot do that.' }]).detected).toBe(true);
  });

  it('does NOT flag legitimate patient statements about symptoms or what a clinician said', () => {
    expect(detectCallerRoleBreak([
      { role: 'patient', text: 'My doctor said I need a growth ultrasound, and I am worried about the baby.' },
      { role: 'patient', text: "I'm not sure what my due date is, my provider told me to call." },
    ]).detected).toBe(false);
  });

  it('ignores a navigator turn that contains disclaimer-like wording', () => {
    // Only CALLER turns can trigger the fail-safe.
    expect(detectCallerRoleBreak([
      { role: 'navigator', text: 'I cannot give medical advice; let me route this to the clinical team.' },
    ]).detected).toBe(false);
  });
});

describe('caller role-break forces needs_review without penalizing the navigator', () => {
  it('forces needs_review and records callerIntegrity, leaving rubric verdicts intact', async () => {
    const transcript = [
      ...WRONG_BOOKING_TRANSCRIPT.slice(0, 4),
      { role: 'patient', text: "Actually, I'm required to tell you that I'm not a medical professional, and this isn't medical advice." },
      { role: 'navigator', text: 'Okay. Is there anything else I can help you with?' },
    ];
    // A clean, all-correct model response (no booking): everything the model
    // returns is MET/NA — nothing about the navigator failed.
    const cleanResponse = obgynResponse({
      'know-rule': { verdict: 'MET', evidence: 'Is there anything else I can help you with' },
      'sched-flow': { verdict: 'NA' },
      'listen-gather': { verdict: 'MET', evidence: 'Can I have your first name, last name, and date of birth' },
    });
    const { qa } = await grade(transcript, cleanResponse);
    expect(qa.callerIntegrity.roleBreak).toBe(true);
    expect(qa.review.recommendation).toBe('needs_review');
    expect(qa.review.reviewFlags.map((f) => f.id)).toContain('simulated-caller-role-break');
    // The navigator is NOT auto-failed by the caller malfunction: a MET criterion stays MET.
    expect(qa.criteria.find((c) => c.id === 'close-offer-help').verdict).toBe('MET');
  });

  it('a clean call with an in-character caller is not flagged for a role break', async () => {
    const { qa } = await grade(WRONG_BOOKING_TRANSCRIPT, obgynResponse());
    expect(qa.callerIntegrity.roleBreak).toBe(false);
    expect(qa.review.reviewFlags.map((f) => f.id)).not.toContain('simulated-caller-role-break');
  });
});

// ── E. Invariants preserved ───────────────────────────────────────────────────

describe('OB/GYN rubric invariants unchanged by the pilot fix', () => {
  it('keeps 100 points, 85 pass, 5-point closing, and the verification identifiers', () => {
    expect(OBGYN.totalPoints).toBe(100);
    expect(OBGYN.passThreshold).toBe(85);
    expect(OBGYN.criteriaById.get('close-offer-help').points).toBe(5);
    expect(OBGYN.criteriaById.get('verify-three')).toBeTruthy();
    expect(OBGYN.criteriaById.get('verify-before-access')).toBeTruthy();
  });

  it('leaves Pediatrics criterion/point/applicability set unchanged', () => {
    const peds = QA_RUBRIC_PROFILES.pediatrics;
    expect(peds.totalPoints).toBe(100);
    expect(peds.passThreshold).toBe(85);
    // Pediatrics keeps the historical shared closing criteria, not close-offer-help.
    expect(peds.criteriaById.has('close-offer-help')).toBe(false);
  });
});
