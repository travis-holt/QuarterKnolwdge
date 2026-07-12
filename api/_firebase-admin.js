// Lazy Firebase Admin initialization for server-owned identity and protected
// Firestore projections. Nothing in this module is bundled into the browser.

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const APP_NAME = 'knowledge-check-admin';
let services = null;

export class FirebaseAdminConfigError extends Error {
  constructor(message = 'Firebase Admin is not configured on the server.') {
    super(message);
    this.name = 'FirebaseAdminConfigError';
    this.code = 'firebase-admin-not-configured';
  }
}

export function serviceAccountFromEnv(env = process.env) {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      // Google downloads service-account JSON with snake_case keys, while
      // firebase-admin's cert() contract uses camelCase. Normalise both forms so
      // pasting the downloaded JSON works without hand-editing secrets.
      const account = {
        projectId: parsed.projectId ?? parsed.project_id,
        clientEmail: parsed.clientEmail ?? parsed.client_email,
        privateKey: parsed.privateKey ?? parsed.private_key,
      };
      if (!account.projectId || !account.clientEmail || !account.privateKey) {
        throw new Error('project_id, client_email, and private_key are required');
      }
      account.privateKey = account.privateKey.replace(/\\n/g, '\n');
      return account;
    } catch (cause) {
      throw new FirebaseAdminConfigError(`FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON: ${cause.message}`);
    }
  }
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }
  return null;
}

export function isFirebaseAdminConfigured(env = process.env) {
  return Boolean(
    env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) ||
    env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

export function getFirebaseAdmin() {
  if (services) return services;
  const existing = getApps().find((app) => app.name === APP_NAME);
  let app = existing;
  if (!app) {
    const serviceAccount = serviceAccountFromEnv();
    if (!serviceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new FirebaseAdminConfigError();
    }
    app = initializeApp({
      credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
      projectId: serviceAccount?.projectId ?? process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID,
    }, APP_NAME);
  }
  services = { app, auth: getAuth(app), db: getFirestore(app) };
  return services;
}

/** Test hook for dependency-isolated unit tests. */
export function resetFirebaseAdminForTests() {
  services = null;
}
