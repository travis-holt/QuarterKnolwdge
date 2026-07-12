// POST /api/set-navigator-pin — supervisor-only PIN set/reset. PINs are hashed
// server-side and never written or returned in plaintext.

import { FieldValue } from 'firebase-admin/firestore';
import { validateSession } from './_auth.js';
import { getFirebaseAdmin } from './_firebase-admin.js';
import { hashPin, isValidPin } from './_pin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (await validateSession(req, res)) return;
  const navigatorId = String(req.body?.navigatorId ?? '');
  const pin = String(req.body?.pin ?? '');
  if (!navigatorId || navigatorId.length > 200) return res.status(400).json({ error: 'Navigator id is required.' });
  if (pin && !isValidPin(pin)) return res.status(400).json({ error: 'PIN must be blank or exactly 4 digits.' });
  const ref = getFirebaseAdmin().db.collection('roster').doc(navigatorId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Navigator not found.' });
  await ref.set(pin ? {
    pinHash: await hashPin(pin),
    pinSet: true,
    pin: FieldValue.delete(),
    pinUpdatedAt: FieldValue.serverTimestamp(),
  } : {
    pinHash: FieldValue.delete(),
    pinSet: false,
    pin: FieldValue.delete(),
    pinUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return res.status(200).json({ ok: true, pinSet: Boolean(pin) });
}
