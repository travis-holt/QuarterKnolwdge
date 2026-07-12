// POST /api/mentor-scores — authenticated, minimized floor projection.
// Firestore rules prevent navigators from querying peers directly; this endpoint
// returns only the fields the mentor matcher needs.

import { validateAppUser } from './_auth.js';
import { getFirebaseAdmin } from './_firebase-admin.js';
import { compareTimestampValues } from '../src/lib/time.js';

export function latestMentorProjection(docs, department) {
  const latest = new Map();
  for (const doc of docs) {
    const data = typeof doc.data === 'function' ? doc.data() : doc;
    if ((data.department ?? 'pediatrics') !== department || !data.navigatorId) continue;
    const previous = latest.get(data.navigatorId);
    if (!previous || compareTimestampValues(data.submittedAt, previous.submittedAt) > 0) {
      latest.set(data.navigatorId, {
        navigatorId: data.navigatorId,
        name: data.name,
        scores: data.scores ?? {},
        assessmentType: data.assessmentType ?? 'mcq',
        submittedAt: data.submittedAt ?? null,
      });
    }
  }
  return [...latest.values()];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (await validateAppUser(req, res)) return;
  const department = String(req.body?.department ?? 'pediatrics');
  if (!['pediatrics', 'obgyn'].includes(department)) return res.status(400).json({ error: 'Unknown department.' });
  const snap = await getFirebaseAdmin().db.collection('results').get();
  return res.status(200).json({ results: latestMentorProjection(snap.docs, department) });
}
