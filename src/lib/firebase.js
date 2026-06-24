// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE INIT
//
// Initialises the Firebase app and exports the Firestore instance used by db.js.
// Config is read from Vite env vars (VITE_FIREBASE_*), populated from
// `.env.local` (gitignored). See `.env.local.example` for setup steps.
//
// If the env vars are missing (e.g. a build before the owner has created the
// Firebase project), the app still builds — Firestore calls will simply fail at
// runtime, which db.js handles defensively. This keeps the build green and lets
// all UI work be completed before the project exists.
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// True only when the core config is present. Components check this and show a
// "not configured yet" message instead of attempting a Firestore call. Every
// db.js helper is gated on this, so when it is false the exported `db` below is
// never actually used.
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId
);

// Initialise defensively: if config is absent/invalid (e.g. before the owner has
// created the Firebase project), never let a top-level throw take down the whole
// app — the gate and empty states must still render.
let db = null;
if (isFirebaseConfigured) {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  } catch (err) {
    console.error('Firebase init failed:', err);
  }
}

export { db };
