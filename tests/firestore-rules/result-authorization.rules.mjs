// ─────────────────────────────────────────────────────────────────────────────
// FIRESTORE RULES REGRESSION — /results document-ID + body ownership binding.
//
// Standalone Node script (NOT a Vitest file) so the normal `npm test` run never
// requires a live Firestore emulator. Run via:
//
//   npm run test:rules
//
// which wraps this script in `firebase emulators:exec --only firestore`. The
// emulator sets FIRESTORE_EMULATOR_HOST for the wrapped process; this script
// also honors an explicit host:port if that env var is absent.
//
// This suite proves, against the REAL rules engine (not a string match on
// firestore.rules), that:
//   - a navigator's own supported result IDs read as a normal "not found" when
//     missing, and are fully readable/writable once they own the body;
//   - a navigator can never read, create, update, or delete another
//     navigator's result, by path OR by body;
//   - a document "squatted" at a navigator's own deterministic path by another
//     navigator's body is NOT exposed by the direct-read exception;
//   - arbitrary (non-deterministic) result paths are denied outright, even
//     when the body claims the caller's navigatorId;
//   - a navigator can never change a result's navigatorId on update;
//   - navigators can never list/query the results collection; supervisors can
//     always read/list/create/update/delete.
//
// Every case here must FAIL against the pre-fix rules (get gated by
// `owns(resource.data) || isOwnResultDocId(docId)` as independent ORs) and
// PASS against the fixed rules (path AND body ownership both required).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
} from 'firebase/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, '..', '..', 'firestore.rules');
const PROJECT_ID = 'demo-quarterly-knowledge-check';

function parseEmulatorHost(envValue) {
  if (!envValue) return { host: '127.0.0.1', port: 8080 };
  const [host, portStr] = envValue.split(':');
  return { host, port: Number(portStr) };
}

const { host, port } = parseEmulatorHost(process.env.FIRESTORE_EMULATOR_HOST);

// All seven deterministic result IDs a navigator may own (F26 §6 SCOPE A list).
const SUPPORTED_SUFFIXES = [
  { suffix: '', department: 'pediatrics', assessmentType: 'mcq' }, // legacy plain id
  { suffix: '__pediatrics', department: 'pediatrics', assessmentType: 'mcq' },
  { suffix: '__pediatrics__spot', department: 'pediatrics', assessmentType: 'spot' },
  { suffix: '__pediatrics__qa', department: 'pediatrics', assessmentType: 'qa' },
  { suffix: '__obgyn', department: 'obgyn', assessmentType: 'mcq' },
  { suffix: '__obgyn__spot', department: 'obgyn', assessmentType: 'spot' },
  { suffix: '__obgyn__qa', department: 'obgyn', assessmentType: 'qa' },
];

function resultBody(navigatorId, overrides = {}) {
  return {
    name: 'Test Navigator',
    navigatorId,
    department: 'pediatrics',
    assessmentType: 'mcq',
    scores: { intake: 80 },
    competencyScores: {},
    answers: {},
    submittedAt: Date.now(),
    ...overrides,
  };
}

// ── Minimal standalone test runner (this is NOT a Vitest file) ────────────────
let passCount = 0;
let failCount = 0;
const failures = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${name}`);
}

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
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host, port },
  });

  try {
    const navA = () => testEnv.authenticatedContext('uid-navigator-a', {
      role: 'navigator',
      navigatorId: 'navigator-a',
    }).firestore();
    const navB = () => testEnv.authenticatedContext('uid-navigator-b', {
      role: 'navigator',
      navigatorId: 'navigator-b',
    }).firestore();
    const supervisor = () => testEnv.authenticatedContext('uid-supervisor', {
      role: 'supervisor',
    }).firestore();

    const seed = (db, id, data) => testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'results', id), data);
    });
    const remove = (id) => testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'results', id));
    });

    // ═══════════════════════════════════════════════════════════════════════
    // A. Own supported IDs — full matrix for Navigator A
    // ═══════════════════════════════════════════════════════════════════════
    await testEnv.clearFirestore();
    section('A. Own supported IDs (Navigator A, all 7 deterministic IDs)');
    for (const { suffix, department, assessmentType } of SUPPORTED_SUFFIXES) {
      const id = `navigator-a${suffix}`;

      await check(`${id} — missing read succeeds as not-found`, async () => {
        const snap = await assertSucceeds(getDoc(doc(navA(), 'results', id)));
        if (snap.exists()) throw new Error('expected the document not to exist yet');
      });

      await check(`${id} — create with own navigatorId succeeds`, async () => {
        await assertSucceeds(
          setDoc(doc(navA(), 'results', id), resultBody('navigator-a', { department, assessmentType }))
        );
      });

      await check(`${id} — read after create returns the owned body`, async () => {
        const snap = await assertSucceeds(getDoc(doc(navA(), 'results', id)));
        if (!snap.exists()) throw new Error('expected the document to exist');
        if (snap.data().navigatorId !== 'navigator-a') {
          throw new Error(`expected navigatorId navigator-a, got ${snap.data().navigatorId}`);
        }
      });

      await check(`${id} — update keeping navigatorId succeeds`, async () => {
        await assertSucceeds(
          setDoc(doc(navA(), 'results', id), resultBody('navigator-a', {
            department,
            assessmentType,
            scores: { intake: 95 },
          }))
        );
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // B. Cross-navigator denial
    // ═══════════════════════════════════════════════════════════════════════
    await testEnv.clearFirestore();
    section('B. Cross-navigator denial (Navigator A vs Navigator B)');
    await seed(null, 'navigator-b__pediatrics', resultBody('navigator-b'));
    // navigator-b__pediatrics__spot intentionally left missing.
    // navigator-b__obgyn intentionally left missing (create-target below).

    await check("A cannot read B's existing supported result", async () => {
      await assertFails(getDoc(doc(navA(), 'results', 'navigator-b__pediatrics')));
    });
    await check("A cannot read B's missing supported result", async () => {
      await assertFails(getDoc(doc(navA(), 'results', 'navigator-b__pediatrics__spot')));
    });
    await check('A cannot create at a supported ID belonging to B, even claiming her own navigatorId', async () => {
      await assertFails(
        setDoc(doc(navA(), 'results', 'navigator-b__obgyn'), resultBody('navigator-a', { department: 'obgyn' }))
      );
    });
    await check("A cannot update B's existing result", async () => {
      await assertFails(
        setDoc(doc(navA(), 'results', 'navigator-b__pediatrics'), resultBody('navigator-a'))
      );
    });
    await check("A cannot delete B's existing result", async () => {
      await assertFails(deleteDoc(doc(navA(), 'results', 'navigator-b__pediatrics')));
    });

    // ═══════════════════════════════════════════════════════════════════════
    // C. Squatted / malformed document protection
    // ═══════════════════════════════════════════════════════════════════════
    await testEnv.clearFirestore();
    section('C. Squatted document protection (path=B, body claims navigatorId=A)');
    await seed(null, 'navigator-b__pediatrics', resultBody('navigator-a', {
      name: 'Navigator A',
      department: 'pediatrics',
      assessmentType: 'mcq',
    }));

    await check('B cannot read the squatted document at her own deterministic path', async () => {
      await assertFails(getDoc(doc(navB(), 'results', 'navigator-b__pediatrics')));
    });
    await check('B cannot update (overwrite/fix) the squatted document', async () => {
      await assertFails(
        setDoc(doc(navB(), 'results', 'navigator-b__pediatrics'), resultBody('navigator-b'))
      );
    });
    await check("A cannot read it merely because the body says navigatorId=A (path is not hers)", async () => {
      await assertFails(getDoc(doc(navA(), 'results', 'navigator-b__pediatrics')));
    });
    await check("A cannot update it either (path is not hers)", async () => {
      await assertFails(
        setDoc(doc(navA(), 'results', 'navigator-b__pediatrics'), resultBody('navigator-a'))
      );
    });
    await check('after the malformed fixture is removed, B sees a normal missing document again', async () => {
      await remove('navigator-b__pediatrics');
      const snap = await assertSucceeds(getDoc(doc(navB(), 'results', 'navigator-b__pediatrics')));
      if (snap.exists()) throw new Error('expected the document not to exist after cleanup');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // D. Arbitrary-ID denial
    // ═══════════════════════════════════════════════════════════════════════
    await testEnv.clearFirestore();
    section('D. Arbitrary (non-deterministic) result-ID denial');
    await check('A cannot read an arbitrary doc even if its body claims her navigatorId (missing)', async () => {
      await assertFails(getDoc(doc(navA(), 'results', 'random-result-document')));
    });
    await check('A cannot create an arbitrary-ID document, even with her own navigatorId in the body', async () => {
      await assertFails(
        setDoc(doc(navA(), 'results', 'random-result-document'), resultBody('navigator-a'))
      );
    });
    await seed(null, 'random-result-document', resultBody('navigator-a'));
    await check('A cannot read the (seeded) arbitrary-ID document even though she owns the body', async () => {
      await assertFails(getDoc(doc(navA(), 'results', 'random-result-document')));
    });
    await check('A cannot update the arbitrary-ID document', async () => {
      await assertFails(
        setDoc(doc(navA(), 'results', 'random-result-document'), resultBody('navigator-a', { scores: { intake: 10 } }))
      );
    });
    await check('A cannot delete the arbitrary-ID document', async () => {
      await assertFails(deleteDoc(doc(navA(), 'results', 'random-result-document')));
    });

    // ═══════════════════════════════════════════════════════════════════════
    // E. Ownership mutation denial
    // ═══════════════════════════════════════════════════════════════════════
    await testEnv.clearFirestore();
    section('E. Ownership mutation denial (navigatorId cannot change on update)');
    await seed(null, 'navigator-a__pediatrics', resultBody('navigator-a'));
    await check('A cannot change navigatorId from navigator-a to navigator-b on update', async () => {
      await assertFails(
        setDoc(doc(navA(), 'results', 'navigator-a__pediatrics'), resultBody('navigator-b'))
      );
    });

    // ═══════════════════════════════════════════════════════════════════════
    // F. Collection list/query behavior
    // ═══════════════════════════════════════════════════════════════════════
    await testEnv.clearFirestore();
    section('F. Collection list/query behavior');
    await seed(null, 'navigator-a__pediatrics', resultBody('navigator-a'));
    await check('Navigator A cannot list the results collection', async () => {
      await assertFails(getDocs(collection(navA(), 'results')));
    });
    await check('Navigator A cannot query the results collection (own navigatorId filter included)', async () => {
      await assertFails(
        getDocs(query(collection(navA(), 'results'), where('navigatorId', '==', 'navigator-a')))
      );
    });
    await check('Supervisor can list the results collection', async () => {
      await assertSucceeds(getDocs(collection(supervisor(), 'results')));
    });

    // ═══════════════════════════════════════════════════════════════════════
    // G. Supervisor behavior
    // ═══════════════════════════════════════════════════════════════════════
    await testEnv.clearFirestore();
    section('G. Supervisor full access');
    await seed(null, 'navigator-a__pediatrics', resultBody('navigator-a'));
    await check('Supervisor can read an existing result', async () => {
      await assertSucceeds(getDoc(doc(supervisor(), 'results', 'navigator-a__pediatrics')));
    });
    await check('Supervisor can create a result at any ID', async () => {
      await assertSucceeds(
        setDoc(doc(supervisor(), 'results', 'supervisor-created-doc'), resultBody('navigator-a'))
      );
    });
    await check('Supervisor can update a result at any ID', async () => {
      await assertSucceeds(
        setDoc(doc(supervisor(), 'results', 'supervisor-created-doc'), resultBody('navigator-b'))
      );
    });
    await check('Supervisor can delete a result at any ID', async () => {
      await assertSucceeds(deleteDoc(doc(supervisor(), 'results', 'supervisor-created-doc')));
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
  console.error('Fatal error running Firestore rules regression suite:', err);
  process.exitCode = 1;
});
