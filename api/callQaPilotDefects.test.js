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
  validateNavigatorChartState, navigatorChartStateHasContent,
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
    // An EXPLICITLY empty section survives — "no active orders on file" is real
    // information the navigator saw, not an absence of information.
    expect(projected.activeOrders).toEqual([]);
  });

  it('returns null only when the chart supplies no sections at all', () => {
    expect(navigatorVisibleChartProjection(null)).toBeNull();
    expect(navigatorVisibleChartProjection({})).toBeNull();
    // An explicit [] IS a supplied section, so this is NOT an empty chart.
    expect(navigatorVisibleChartProjection({ activeOrders: [] })).toEqual({ activeOrders: [] });
  });
});

// ── BLOCKER 1: missing vs explicit-empty vs populated chart sections ──────────
//
// Three distinct states that must never collapse into one another:
//   missing/null → the section is NOT part of this scenario (say nothing)
//   []           → the navigator checked and there is NOTHING ON FILE
//   [items]      → exactly these items are visible
describe('navigator chart presence semantics (missing vs explicit empty)', () => {
  const validateChart = (raw) => validateNavigatorChartState(raw, 'fixture');

  it('keeps a MISSING list section null — never coerced to an empty section', () => {
    const chart = validateChart({ planRto: 'RTO 4 weeks' });
    expect(chart.planRto).toBe('RTO 4 weeks');
    for (const field of ['activeOrders', 'openEncounters', 'futureAppointments', 'otherFacts']) {
      expect(chart[field]).toBeNull();
    }
  });

  it('preserves an EXPLICIT empty section distinctly from a missing one', () => {
    const chart = validateChart({ activeOrders: [], futureAppointments: ['Prenatal visit 08/14'] });
    expect(chart.activeOrders).toEqual([]);              // explicitly nothing on file
    expect(chart.futureAppointments).toEqual(['Prenatal visit 08/14']);
    expect(chart.openEncounters).toBeNull();             // never supplied
  });

  it('treats an explicit [] as meaningful chart content but a supply-nothing chart as absent', () => {
    // "No active orders on file" can itself be the decisive chart fact.
    expect(navigatorChartStateHasContent(validateChart({ activeOrders: [] }))).toBe(true);
    expect(navigatorChartStateHasContent(validateChart({}))).toBe(false);
    expect(navigatorChartStateHasContent(null)).toBe(false);
  });

  it('a scenario providing ONLY planRto tells neither the UI nor the grader "None on file"', () => {
    const chart = validateChart({ planRto: 'RTO 4 weeks' });
    const grader = renderNavigatorChartLines(chart).join('\n');
    expect(grader).toMatch(/Plan \/ RTO: RTO 4 weeks/);
    expect(grader).not.toMatch(/None on file/);
    expect(grader).not.toMatch(/Active orders/);
    expect(grader).not.toMatch(/Future appointments/);
    // The browser projection must not invent the sections either.
    const projected = navigatorVisibleChartProjection(chart);
    expect(projected).toEqual({ planRto: 'RTO 4 weeks' });
  });

  it('renders "None on file" ONLY for a section the scenario explicitly emptied', () => {
    const grader = renderNavigatorChartLines(validateChart({ activeOrders: [] })).join('\n');
    expect(grader).toMatch(/Active orders: None on file/);
    expect(grader).not.toMatch(/Open Telephone Encounters/);
    expect(grader).not.toMatch(/Future appointments/);
  });

  it('a missing activeOrders section is never interpreted as "no active orders"', () => {
    const grader = renderNavigatorChartLines(validateChart({ summary: 'Established OB patient.' })).join('\n');
    expect(grader).not.toMatch(/Active orders/);
    expect(grader).not.toMatch(/None on file/);
  });

  it('an explicit [] survives validation -> snapshot -> relay projection -> UI/grader', () => {
    // 1. validation
    const validated = validatePrivateScenario(
      { ...structuredClone(GROWTH_SCENARIO), active: true },
      { documentId: privateScenarioDocumentId(GROWTH_SCENARIO), department: 'obgyn' },
    );
    expect(validated.navigatorChartState.activeOrders).toEqual([]);
    expect(validated.navigatorChartState.openEncounters).toEqual([]);

    // 2. immutable attempt snapshot
    const attempt = buildAttemptDoc({ navigatorId: 'n', name: 'N', department: 'obgyn', scenario: validated, liveModel: 'm' });
    expect(attempt.scenarioSnapshot.navigatorChartState.activeOrders).toEqual([]);

    // 3. relay projection (what the browser receives)
    const projected = navigatorVisibleChartProjection(attempt.scenarioSnapshot.navigatorChartState);
    expect(projected.activeOrders).toEqual([]);

    // 4. UI + grader both read the SAME projection and render "None on file"
    const grader = renderNavigatorChartLines(attempt.scenarioSnapshot.navigatorChartState).join('\n');
    expect(grader).toMatch(/Active orders: None on file/);
    expect(grader).toMatch(/Future appointments: None on file/);
  });

  it('accepts a chart-dependent scenario whose ONLY chart content is explicit negatives', () => {
    // The reproduced pilot case: the decisive fact is that nothing is on file.
    const data = {
      ...structuredClone(GROWTH_SCENARIO),
      navigatorChartState: { activeOrders: [], futureAppointments: [] },
      active: true,
    };
    const result = validatePrivateScenario(data, {
      documentId: privateScenarioDocumentId(data), department: 'obgyn',
    });
    expect(result.navigatorChartState.activeOrders).toEqual([]);
    expect(result.requiresNavigatorChartContext).toBe(true);
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

  it('fails closed when a chart-dependent scenario supplies NO chart sections at all', () => {
    expect(() => validate({ ...base(), navigatorChartState: null }))
      .toThrow(/requires a non-empty navigatorChartState/i);
    // `{}` supplies nothing — not even an explicit negative — so it is absent.
    expect(() => validate({ ...base(), navigatorChartState: {} }))
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

  it('includes a NAVIGATOR-VISIBLE CHART block', () => {
    const text = buildTrustedGradingScenario({
      gradingContext: 'ctx', title: 't', workflowType: 'w', difficulty: 'medium',
      expectedActions: ['a'], criticalMisses: ['m'], scoringNotes: [],
      navigatorChartState: NAV_CHART,
    });
    expect(text).toMatch(/NAVIGATOR-VISIBLE CHART/);
    expect(text).toMatch(/ONLY against these navigator-visible facts/i);
    expect(text).toMatch(/never assume what it contains/i);
    // The silent-chart-clicks fairness rule applies with or without hidden state.
    expect(text).toMatch(/Do not require the navigator to narrate silent chart clicks/i);
  });

  it('keeps the silent-chart-click fairness rule even with no navigator chart', () => {
    const text = buildTrustedGradingScenario({
      gradingContext: 'ctx', title: 't', workflowType: 'w', difficulty: 'medium',
      expectedActions: ['a'], criticalMisses: ['m'], scoringNotes: [],
      navigatorChartState: null,
    });
    expect(text).not.toMatch(/NAVIGATOR-VISIBLE CHART/);
    expect(text).toMatch(/Do not require the navigator to narrate silent chart clicks/i);
  });
});

// ── BLOCKER 2: hiddenChartState must never reach the Gemini grader ────────────
//
// The reproduced defect was that THE MODEL HELD CHART INFORMATION THE NAVIGATOR
// DID NOT. That is enforced structurally — the facts are never handed over — not
// by asking the model to ignore facts it has already been given.
describe('hiddenChartState never reaches the model-visible grader context', () => {
  const SECRET = 'SECRET_HIDDEN_CHART_TOKEN_9F31';
  const scenarioWithSecret = () => ({
    ...structuredClone(GROWTH_SCENARIO),
    hiddenChartState: { sonographyOrder: null, auditToken: SECRET },
  });

  it('retains the hidden state in the trusted server-side attempt snapshot', () => {
    const attempt = buildAttemptDoc({
      navigatorId: 'n', name: 'N', department: 'obgyn', scenario: scenarioWithSecret(), liveModel: 'm',
    });
    // Server-side audit provenance is preserved …
    expect(JSON.stringify(attempt.scenarioSnapshot.hiddenChartState)).toContain(SECRET);
  });

  it('excludes it from the navigator-visible chart and the browser payload', () => {
    const projected = navigatorVisibleChartProjection(scenarioWithSecret().navigatorChartState);
    expect(JSON.stringify(projected)).not.toContain(SECRET);
  });

  it('excludes it from buildTrustedGradingScenario even when passed directly', () => {
    const text = buildTrustedGradingScenario({
      gradingContext: 'ctx', title: 't', workflowType: 'w', difficulty: 'medium',
      expectedActions: ['a'], criticalMisses: ['m'], scoringNotes: [],
      hiddenChartState: { auditToken: SECRET },
      navigatorChartState: NAV_CHART,
    });
    expect(text).not.toContain(SECRET);
    expect(text).not.toMatch(/HIDDEN CHART FACTS/);
  });

  it('excludes it from the scenario context built from a stored attempt', () => {
    const attempt = { id: 'att-1', ...buildAttemptDoc({ navigatorId: 'n', name: 'N', department: 'obgyn', scenario: scenarioWithSecret(), liveModel: 'm' }) };
    const context = buildScenarioContextFromAttempt(attempt);
    expect(context.gradingScenario).not.toContain(SECRET);
  });

  it('excludes it from EVERY Gemini message while the navigator-visible chart IS present', async () => {
    const attempt = { id: 'att-1', ...buildAttemptDoc({ navigatorId: 'n', name: 'N', department: 'obgyn', scenario: scenarioWithSecret(), liveModel: 'm' }) };
    const context = buildScenarioContextFromAttempt(attempt);
    let captured = null;
    await gradeCallQaTranscript(
      { transcript: WRONG_BOOKING_TRANSCRIPT, scenarioContext: context, captureMetadata: { captureComplete: true }, transcriptMetadata: { captureStatus: 'captured' } },
      {
        keys: ['fixture-key'], graderModel: 'fixture-model',
        sopContextForFresh: async () => 'Synthetic OB/GYN SOP context.',
        // Capture EVERY argument the grader hands to Gemini, so nothing can slip
        // through in a parameter this assertion did not inspect.
        geminiWithRotation: async (...args) => {
          captured = args;
          return { ok: true, text: JSON.stringify(obgynResponse()), model: 'fixture-model' };
        },
      },
    );
    const everythingSentToGemini = JSON.stringify(captured);
    expect(everythingSentToGemini).not.toContain(SECRET);
    expect(everythingSentToGemini).not.toContain('HIDDEN CHART FACTS');
    // …and the navigator-visible chart IS in the grader context.
    expect(everythingSentToGemini).toContain('NAVIGATOR-VISIBLE CHART');
    expect(everythingSentToGemini).toContain('Active orders: None on file');
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
  const said = (text) => detectCallerRoleBreak([{ role: 'patient', text }]);

  // ── POSITIVE: unmistakable role breaks that MUST fire ──────────────────────
  it('flags the reproduced AI/safety-disclaimer statement', () => {
    const transcript = [
      { role: 'navigator', text: 'How can I help?' },
      { role: 'patient', text: "I'm required to tell you that I'm not a medical professional, and this isn't medical advice or a diagnosis. You should always see a healthcare professional or seek care." },
    ];
    const result = detectCallerRoleBreak(transcript);
    expect(result.detected).toBe(true);
    expect(result.turnIndex).toBe(1);
    expect(result.category).toBe('policy-disclaimer');
    // The reproduced line stacks several independent disclaimer signals.
    expect(result.signals.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['AI self-identification', 'As an AI language model, I cannot do that.'],
    ['first-person AI claim', "Actually, I'm an AI assistant and cannot book that."],
    ['chatbot claim', 'I am a chatbot, so I do not have a real chart.'],
    ['simulation acknowledgment', 'Just so you know, this is a simulation.'],
    ['training-scenario acknowledgment', 'This is a training scenario, correct?'],
    ['roleplay acknowledgment', "I'm roleplaying a patient for this exercise."],
    ['not-a-real-person claim', "I'm not a real person, I should mention."],
  ])('flags a single unmistakable meta break: %s', (_label, text) => {
    expect(said(text).detected).toBe(true);
  });

  it('flags a shorter recited disclaimer that still stacks two signals', () => {
    const result = said("I'm not a medical professional and this is not medical advice.");
    expect(result.detected).toBe(true);
    expect(result.category).toBe('policy-disclaimer');
  });

  // ── NEGATIVE: normal patient speech that must NEVER invalidate an attempt ──
  // Each of these carries at most ONE disclaimer signal, which is exactly how a
  // real caller talks. Firing here would throw away a valid navigator attempt.
  it.each([
    ['not-a-doctor aside', "I'm not a doctor, but I thought Dr. Weinstein said I needed a growth scan."],
    ['not-a-nurse aside', "I'm not a nurse, so I don't know what that order means."],
    ['required-to-tell about insurance', "I'm required to tell you my insurance changed."],
    ['reported clinician instruction', 'My doctor told me to see a healthcare professional if the bleeding got worse.'],
    ['prior-provider instruction', 'My provider said I need a growth ultrasound and told me to call and schedule it.'],
    ['symptom description', 'I have been having cramping since yesterday and some spotting.'],
    ['uncertainty', "I'm not sure what my due date is, my provider told me to call."],
    ['worry', 'I am really worried about the baby, I have not felt her move much today.'],
    ['not-a-doctor plus reported advice', "I'm not a doctor, but my midwife told me to see a healthcare professional if it got worse."],
    ['habitual care statement', 'I always see a healthcare professional for this kind of thing.'],
  ])('does NOT flag normal patient speech: %s', (_label, text) => {
    expect(said(text).detected).toBe(false);
  });

  it('does NOT flag a caller repeating several legitimate statements across turns', () => {
    expect(detectCallerRoleBreak([
      { role: 'patient', text: 'My doctor said I need a growth ultrasound, and I am worried about the baby.' },
      { role: 'patient', text: "I'm not a doctor so I don't really understand the order." },
      { role: 'patient', text: 'She told me to see a healthcare professional if anything changed.' },
    ]).detected).toBe(false);
  });

  it('ignores a navigator turn that contains disclaimer-like wording', () => {
    // Only CALLER turns can trigger the fail-safe.
    expect(detectCallerRoleBreak([
      { role: 'navigator', text: 'I cannot give medical advice; let me route this to the clinical team.' },
      { role: 'navigator', text: "I'm not a medical professional and this is not medical advice, so I will route this." },
    ]).detected).toBe(false);
  });

  it('is safe on malformed input', () => {
    expect(detectCallerRoleBreak(null).detected).toBe(false);
    expect(detectCallerRoleBreak([null, { role: 'patient' }, { role: 'patient', text: '  ' }]).detected).toBe(false);
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
// (v9 live-contract-smoke case coverage lives in api/liveContractSmoke.test.js.)

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
