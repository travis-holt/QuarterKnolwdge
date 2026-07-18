// ─────────────────────────────────────────────────────────────────────────────
// FIRESTORE RULES REGRESSION — interviews collection, server-authoritative Call
// QA attempts (PR 2).
//
// Standalone Node script (NOT a Vitest file). Run via `npm run test:rules`, which
// wraps it in `firebase emulators:exec --only firestore` alongside the results
// suite.
//
// Proves, against the REAL rules engine, that:
//   - a navigator may create + read their own PRACTICE interview and attach only
//     the advisory grade (never a forged Call QA payload);
//   - a navigator may NOT create a server-authoritative Call QA attempt (claiming
//     captureAuthority:'server', assessmentType:'call-qa', or a curated QA
//     scenario id) — those are created only by Firebase Admin (which bypasses
//     rules);
//   - a navigator may NOT add a curated QA scenario id onto a practice document;
//   - a navigator may NOT read a server-created QA attempt; the app receives an
//     allowlisted result projection through the authenticated API instead;
//   - another navigator cannot read someone else's QA attempt;
//   - supervisors retain full read access.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, '..', '..', 'firestore.rules');
const PROJECT_ID = 'demo-quarterly-knowledge-check';

function parseEmulatorHost(envValue) {
  if (!envValue) return { host: '127.0.0.1', port: 8080 };
  const [host, portStr] = envValue.split(':');
  return { host, port: Number(portStr) };
}
const { host, port } = parseEmulatorHost(process.env.FIRESTORE_EMULATOR_HOST);

// A practice interview a navigator legitimately creates from the browser.
function practiceInterview(navigatorId, overrides = {}) {
  return {
    navigatorId,
    name: 'Test Navigator',
    department: 'pediatrics',
    domainId: 'routing',
    scenario: 'Practice scenario',
    callerName: 'Caller',
    transcript: [{ role: 'navigator', text: 'hi' }],
    endedAt: Date.now(),
    scenarioSource: 'generated',
    qaScenarioId: null,
    grade: null,
    ...overrides,
  };
}

// A server-authoritative Call QA attempt, as Firebase Admin would create it.
function serverQaAttempt(navigatorId, overrides = {}) {
  return {
    navigatorId,
    name: 'Test Navigator',
    department: 'pediatrics',
    domainId: 'routing',
    assessmentType: 'call-qa',
    captureAuthority: 'server',
    captureVersion: 'call-qa-live-transcript-v1',
    qaScenarioId: 'qa-test-call-001',
    scenarioSnapshot: { publicBriefing: 'Fictional fixture' },
    transcript: [{ role: 'navigator', text: 'server captured' }],
    captureStatus: 'captured',
    gradingStatus: 'graded',
    grade: { score: 90 },
    qa: { score: 90, pass: true },
    endedAt: Date.now(),
    ...overrides,
  };
}

let passCount = 0;
let failCount = 0;
const failures = [];
let currentSection = '';
function section(name) { currentSection = name; console.log(`\n${name}`); }
async function check(name, fn) {
  const label = `${currentSection} — ${name}`;
  try {
    await fn();
    passCount += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failCount += 1;
    failures.push({ label, message: err?.message ?? String(err) });
    console.log(`  FAIL ${name}`);
    console.log(`       ${err?.message ?? err}`);
  }
}

async function main() {
  const rules = readFileSync(RULES_PATH, 'utf8');
  const testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules, host, port } });
  try {
    const navA = () => testEnv.authenticatedContext('uid-a', { role: 'navigator', navigatorId: 'nav-a' }).firestore();
    const navB = () => testEnv.authenticatedContext('uid-b', { role: 'navigator', navigatorId: 'nav-b' }).firestore();
    const supervisor = () => testEnv.authenticatedContext('uid-s', { role: 'supervisor' }).firestore();
    const seed = (id, data, collectionName = 'interviews') => testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), collectionName, id), data);
    });

    // ── Practice interview: navigator create/read/grade ──────────────────────
    await testEnv.clearFirestore();
    section('A. Practice interviews (navigator create/read/grade)');
    await check('navigator can create their own practice interview', async () => {
      await assertSucceeds(setDoc(doc(navA(), 'interviews', 'p1'), practiceInterview('nav-a')));
    });
    await check('navigator can read their own practice interview', async () => {
      await assertSucceeds(getDoc(doc(navA(), 'interviews', 'p1')));
    });
    await check('navigator can attach the advisory practice grade', async () => {
      await assertSucceeds(updateDoc(doc(navA(), 'interviews', 'p1'), { grade: { score: 80 } }));
    });
    await check('navigator cannot attach a forged qa payload to practice', async () => {
      await assertFails(updateDoc(doc(navA(), 'interviews', 'p1'), { qa: { score: 100, pass: true } }));
    });

    // ── Navigator cannot forge a server-authoritative QA attempt ─────────────
    await testEnv.clearFirestore();
    section('B. Navigator cannot create a server-authoritative Call QA attempt');
    await check('cannot create with captureAuthority:server', async () => {
      await assertFails(setDoc(doc(navA(), 'interviews', 'q1'),
        practiceInterview('nav-a', { captureAuthority: 'server' })));
    });
    await check('cannot create with assessmentType:call-qa', async () => {
      await assertFails(setDoc(doc(navA(), 'interviews', 'q2'),
        practiceInterview('nav-a', { assessmentType: 'call-qa' })));
    });
    await check('cannot create claiming a curated QA scenario id', async () => {
      await assertFails(setDoc(doc(navA(), 'interviews', 'q3'),
        practiceInterview('nav-a', { qaScenarioId: 'qa-test-call-001' })));
    });
    await check('cannot add a curated QA scenario id onto a practice document (update)', async () => {
      await assertSucceeds(setDoc(doc(navA(), 'interviews', 'q4'), practiceInterview('nav-a')));
      await assertFails(updateDoc(doc(navA(), 'interviews', 'q4'), { qaScenarioId: 'qa-test-call-001' }));
    });

    // ── Server-created QA attempt: server/supervisor only ────────────────────
    await testEnv.clearFirestore();
    section('C. Server-created QA attempt (server/supervisor only)');
    await seed('qa-a', serverQaAttempt('nav-a'));
    await check('navigator cannot read their own server QA attempt', async () => {
      await assertFails(getDoc(doc(navA(), 'interviews', 'qa-a')));
    });
    await check('another navigator cannot read it', async () => {
      await assertFails(getDoc(doc(navB(), 'interviews', 'qa-a')));
    });
    await check('navigator cannot alter its transcript', async () => {
      await assertFails(updateDoc(doc(navA(), 'interviews', 'qa-a'), { transcript: [{ role: 'navigator', text: 'forged' }] }));
    });
    await check('navigator cannot alter its capture state', async () => {
      await assertFails(updateDoc(doc(navA(), 'interviews', 'qa-a'), { captureStatus: 'captured' }));
    });
    await check('navigator cannot alter its scenario snapshot', async () => {
      await assertFails(updateDoc(doc(navA(), 'interviews', 'qa-a'), { scenarioSnapshot: { scenario: 'forged' } }));
    });
    await check('navigator cannot attach or replace grade', async () => {
      await assertFails(updateDoc(doc(navA(), 'interviews', 'qa-a'), { grade: { score: 100 } }));
    });
    await check('navigator cannot attach or replace qa', async () => {
      await assertFails(updateDoc(doc(navA(), 'interviews', 'qa-a'), { qa: { score: 100, pass: true } }));
    });
    await check('supervisor can read the server QA attempt', async () => {
      await assertSucceeds(getDoc(doc(supervisor(), 'interviews', 'qa-a')));
    });
    await check('cannot create with a forged qa payload', async () => {
      await assertFails(setDoc(doc(navA(), 'interviews', 'q-qa'),
        practiceInterview('nav-a', { qa: { score: 100, pass: true } })));
    });

    await check('navigator query cannot download a mixed practice + server QA history', async () => {
      await seed('practice-a', practiceInterview('nav-a'));
      await assertFails(getDocs(query(
        collection(navA(), 'interviews'),
        where('navigatorId', '==', 'nav-a'),
      )));
    });

    await check('supervisor can query the complete interview collection', async () => {
      await assertSucceeds(getDocs(collection(supervisor(), 'interviews')));
    });

    // ── Even an ungraded server attempt is immutable to the navigator ────────
    await testEnv.clearFirestore();
    section('D. Ungraded server QA attempt still immutable to the navigator');
    await seed('qa-b', serverQaAttempt('nav-a', { gradingStatus: 'not_started', captureStatus: 'active', grade: null, qa: null }));
    await check('navigator cannot read an active server QA attempt', async () => {
      await assertFails(getDoc(doc(navA(), 'interviews', 'qa-b')));
    });
    await check('navigator cannot attach a grade to their own ungraded server attempt', async () => {
      await assertFails(updateDoc(doc(navA(), 'interviews', 'qa-b'), { grade: { score: 88 }, qa: { score: 88 } }));
    });

    // â”€â”€ Private scenario bank: Admin only â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    await testEnv.clearFirestore();
    section('E. Private Call QA scenario bank (Admin only)');
    const privateId = 'qa-test-call-001__test-v1';
    await seed(privateId, { active: true, department: 'pediatrics' }, 'callQaScenariosPrivate');
    await check('navigator cannot read private scenario material', async () => {
      await assertFails(getDoc(doc(navA(), 'callQaScenariosPrivate', privateId)));
    });
    await check('supervisor cannot read private scenario material', async () => {
      await assertFails(getDoc(doc(supervisor(), 'callQaScenariosPrivate', privateId)));
    });
    await check('navigator cannot write private scenario material', async () => {
      await assertFails(setDoc(doc(navA(), 'callQaScenariosPrivate', 'forged'), { active: true }));
    });
    await check('supervisor cannot write private scenario material', async () => {
      await assertFails(setDoc(doc(supervisor(), 'callQaScenariosPrivate', 'forged'), { active: true }));
    });

    console.log(`\n${passCount} passed, ${failCount} failed`);
    if (failCount > 0) {
      console.log('\nFailures:');
      for (const f of failures) console.log(`  - ${f.label}: ${f.message}`);
      process.exitCode = 1;
    }
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((err) => {
  console.error('Fatal error running Call QA interviews rules regression suite:', err);
  process.exitCode = 1;
});
