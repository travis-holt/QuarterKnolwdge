// POST /api/supervisor-login — exchanges the supervisor passcode for a signed,
// HttpOnly session cookie. Replaces the old client-side-only passcode check.
//
// Body: { passcode }
//   200 → { ok: true } + Set-Cookie: kc_supervisor_session=...
//   401 → { error: 'Incorrect passcode.' }
//   500 → { error: ... } when no server passcode is configured
//
// The passcode is never logged; the token is never returned in the body.
import {
  checkSupervisorPasscode,
  isSupervisorConfigured,
  createSessionToken,
  serializeSessionCookie,
  isSecureRequest,
  DEFAULT_TTL_MS,
} from './_auth.js';

export default function handler(req, res) {
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
  const token = createSessionToken({ role: 'supervisor' }, { ttlMs: DEFAULT_TTL_MS });
  res.setHeader(
    'Set-Cookie',
    serializeSessionCookie(token, { ttlMs: DEFAULT_TTL_MS, secure: isSecureRequest(req) })
  );
  res.status(200).json({ ok: true });
}
