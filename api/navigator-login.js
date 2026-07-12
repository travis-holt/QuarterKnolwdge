// POST /api/navigator-login — server-side PIN verification + Firebase identity.
// Existing plaintext pilot PINs are migrated to scrypt on successful login.

import { FieldValue } from 'firebase-admin/firestore';
import { FirebaseAdminConfigError, getFirebaseAdmin } from './_firebase-admin.js';
import { constantTimeTextEqual, hashPin, isValidPin, verifyPin } from './_pin.js';

export class NavigatorLoginError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'NavigatorLoginError';
    this.status = status;
  }
}

export async function authenticateNavigator({ navigatorId, pin }, { db, auth }) {
  if (typeof navigatorId !== 'string' || !navigatorId || navigatorId.length > 128 || !isValidPin(pin)) {
    throw new NavigatorLoginError('Choose your name and enter a 4-digit PIN.', 400);
  }
  const ref = db.collection('roster').doc(navigatorId);
  let member = null;
  let createdPin = false;
  // PIN creation/migration is transactional. Two simultaneous first logins can
  // no longer choose different PINs and both receive valid identities.
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new NavigatorLoginError('That name or PIN is not valid.');
    member = snap.data();
    if (member.status === 'inactive') throw new NavigatorLoginError('This navigator account is inactive.', 403);

    let accepted = false;
    if (member.pinHash) {
      accepted = await verifyPin(pin, member.pinHash);
    } else if (String(member.pin ?? '').trim()) {
      accepted = constantTimeTextEqual(String(member.pin).trim(), pin);
    } else {
      accepted = true;
      createdPin = true;
    }
    if (!accepted) throw new NavigatorLoginError('That name or PIN is not valid.');

    // Migrate/create before issuing the token. The client never receives the hash.
    if (!member.pinHash) {
      transaction.set(ref, {
        pinHash: await hashPin(pin),
        pinSet: true,
        pin: FieldValue.delete(),
        pinUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  const customToken = await auth.createCustomToken(`navigator:${navigatorId}`, {
    role: 'navigator',
    navigatorId,
  });
  return {
    customToken,
    navigator: { id: navigatorId, name: String(member.name ?? '').trim() },
    createdPin,
  };
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const result = await authenticateNavigator(req.body ?? {}, getFirebaseAdmin());
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof NavigatorLoginError) return res.status(err.status).json({ error: err.message });
    if (err instanceof FirebaseAdminConfigError || err?.code === 'firebase-admin-not-configured') {
      return res.status(503).json({ error: 'Server authentication is not configured.' });
    }
    console.error('navigator-login:', err?.message ?? err);
    return res.status(500).json({ error: 'Navigator sign-in failed.' });
  }
}
