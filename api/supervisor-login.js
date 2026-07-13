// POST /api/supervisor-login — exchanges the supervisor passcode for a signed,
// HttpOnly session cookie. Replaces the old client-side-only passcode check.
//
// Body: { passcode }
//   200 → { ok: true } + Set-Cookie: kc_supervisor_session=...
//   401 → { error: 'Incorrect passcode.' }
//   500 → { error: ... } when no server passcode is configured
//
// The passcode is never logged. A short-lived Firebase custom token is returned
// once so the browser can establish the claimed Firestore/API identity.
import {
  checkSupervisorPasscode,
  isSupervisorConfigured,
  createSessionToken,
  serializeSessionCookie,
  isSecureRequest,
  DEFAULT_TTL_MS,
} from './_auth.js';
import { FirebaseAdminConfigError, getFirebaseAdmin } from './_firebase-admin.js';

export default async function handler(req, res) {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  if (!isSupervisorConfigured()) {
    res.status(500).json({ error: 'Supervisor login is not configured on the server.' });
    return;
  }
  const passcode = req.body?.passcode;
  if (!checkSupervisorPasscode(passcode)) {
    res.status(401).json({ error: 'Incorrect passcode.' });
    return;
  }
  try {
    const customToken = await getFirebaseAdmin().auth.createCustomToken('knowledge-check-supervisor', {
      role: 'supervisor',
    });
    const sessionToken = createSessionToken({ role: 'supervisor' }, { ttlMs: DEFAULT_TTL_MS });
    res.setHeader(
      'Set-Cookie',
      serializeSessionCookie(sessionToken, { ttlMs: DEFAULT_TTL_MS, secure: isSecureRequest(req) })
    );
    return res.status(200).json({ ok: true, customToken });
  } catch (err) {
    if (err instanceof FirebaseAdminConfigError || err?.code === 'firebase-admin-not-configured') {
      return res.status(503).json({ error: 'Server authentication is not configured.' });
    }
    console.error('supervisor-login:', err?.message ?? err);
    return res.status(500).json({ error: 'Supervisor login failed.' });
  }
}
