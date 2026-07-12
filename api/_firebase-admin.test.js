import { describe, expect, it } from 'vitest';
import { FirebaseAdminConfigError, isFirebaseAdminConfigured, serviceAccountFromEnv } from './_firebase-admin.js';

describe('Firebase Admin configuration', () => {
  it('parses a JSON service account and restores private-key newlines', () => {
    expect(serviceAccountFromEnv({
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'p',
        client_email: 'svc@example.com',
        private_key: 'a\\nb',
      }),
    })).toEqual({ projectId: 'p', clientEmail: 'svc@example.com', privateKey: 'a\nb' });
  });

  it('supports split Railway variables', () => {
    expect(serviceAccountFromEnv({
      FIREBASE_PROJECT_ID: 'p',
      FIREBASE_CLIENT_EMAIL: 'svc@example.com',
      FIREBASE_PRIVATE_KEY: 'a\\nb',
    })).toEqual({ projectId: 'p', clientEmail: 'svc@example.com', privateKey: 'a\nb' });
  });

  it('rejects malformed service-account JSON without leaking its contents', () => {
    expect(() => serviceAccountFromEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: '{bad' }))
      .toThrow(FirebaseAdminConfigError);
  });

  it('reports whether a supported credential source is present', () => {
    expect(isFirebaseAdminConfigured({})).toBe(false);
    expect(isFirebaseAdminConfigured({ GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' })).toBe(true);
  });
});
