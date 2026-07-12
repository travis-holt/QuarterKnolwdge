// GET /api/navigator-roster — public, rate-limited sign-in projection.
// Returns active names and whether a PIN exists; never returns PIN material.

import { FirebaseAdminConfigError, getFirebaseAdmin } from './_firebase-admin.js';

export async function navigatorRosterProjection(db) {
  const snap = await db.collection('roster').get();
  return snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        pinSet: Boolean(data.pinHash || String(data.pin ?? '').trim()),
        status: data.status ?? 'active',
      };
    })
    .filter((entry) => entry.status !== 'inactive' && typeof entry.name === 'string' && entry.name.trim())
    .map(({ status: _status, ...entry }) => entry)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const roster = await navigatorRosterProjection(getFirebaseAdmin().db);
    return res.status(200).json({ roster });
  } catch (err) {
    if (err instanceof FirebaseAdminConfigError || err?.code === 'firebase-admin-not-configured') {
      return res.status(503).json({ error: 'Server authentication is not configured.' });
    }
    console.error('navigator-roster:', err?.message ?? err);
    return res.status(500).json({ error: 'Could not load the navigator roster.' });
  }
}
