// POST /api/logout — clears the supervisor session cookie. Always 200 (idempotent).
import { clearSessionCookie, isSecureRequest } from './_auth.js';

export default function handler(req, res) {
  res.setHeader('Set-Cookie', clearSessionCookie({ secure: isSecureRequest(req) }));
  res.status(200).json({ ok: true });
}
