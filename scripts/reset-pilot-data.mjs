// ─────────────────────────────────────────────────────────────────────────────
// PILOT DATA RESET — one-off script for the 2026-07-02 domain redesign.
//
// Deletes every doc in the collections keyed by the OLD domain IDs so the app
// starts clean on the new 6-domain model:
//   results, resultHistory, completions, pairings, questions
//
// KEEPS: roster (people are still valid), interviews, supervisorFeedback,
// learningProposals. The new question bank re-seeds automatically from
// ALL_SEED_QUESTIONS on the next app load (seedQuestionsIfEmpty).
//
// Run:  node scripts/reset-pilot-data.mjs            (dry run — counts only)
//       node scripts/reset-pilot-data.mjs --delete   (actually delete)
//
// Uses the web SDK + .env.local (same client config as the app). Tries
// anonymous sign-in first (required once the hardened rules are deployed);
// proceeds without it if anonymous auth isn't enabled yet (open-rules pilot).
// ─────────────────────────────────────────────────────────────────────────────
import process from 'node:process';

process.loadEnvFile('.env.local');

const { initializeApp } = await import('firebase/app');
const { getAuth, signInAnonymously } = await import('firebase/auth');
const { getFirestore, collection, getDocs, deleteDoc, doc } = await import('firebase/firestore');

const COLLECTIONS = ['results', 'resultHistory', 'completions', 'pairings', 'questions'];
const DELETE = process.argv.includes('--delete');

const app = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
});

try {
  await signInAnonymously(getAuth(app));
  console.log('signed in anonymously');
} catch (e) {
  console.log(`anonymous sign-in unavailable (${e.code ?? e.message}) — proceeding unauthenticated`);
}

const db = getFirestore(app);

let blocked = 0;
for (const name of COLLECTIONS) {
  try {
    const snap = await getDocs(collection(db, name));
    if (!DELETE) {
      console.log(`${name}: ${snap.size} doc(s) (dry run — pass --delete to remove)`);
      continue;
    }
    let deleted = 0;
    for (const d of snap.docs) {
      await deleteDoc(doc(db, name, d.id));
      deleted += 1;
    }
    console.log(`${name}: deleted ${deleted}/${snap.size}`);
  } catch (e) {
    blocked += 1;
    console.log(`${name}: BLOCKED by deployed security rules (${e.code ?? e.message})`);
  }
}

if (blocked > 0) {
  console.log(
    `\n${blocked} collection(s) blocked. Enable Anonymous auth in the Firebase console and ` +
    'deploy the current rules (firebase deploy --only firestore:rules), then re-run this script.',
  );
}

console.log(DELETE ? 'reset complete' : 'dry run complete');
process.exit(0);
