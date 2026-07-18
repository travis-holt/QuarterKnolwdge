// POST /api/my-interviews — navigator-owned interview history.
//
// Navigators cannot read server Call QA documents directly because those docs
// contain the immutable grading snapshot. This endpoint derives ownership from
// the verified token and exposes Call QA through a strict result allowlist.

import { validateAppUser } from './_auth.js';
import { FirebaseAdminConfigError, getFirebaseAdmin } from './_firebase-admin.js';

const CALL_QA_RESULT_FIELDS = [
  'navigatorId', 'name', 'department', 'domainId', 'assessmentType', 'scenarioSource',
  'captureStatus', 'gradingStatus', 'startedAt', 'endedAt', 'grade', 'qa',
  'qaFinalReview', 'qaArchived', 'qaArchivedAt', 'qaArchivedReason', 'qaArchivedBy',
];

function isProtectedCallQa(data) {
  return data?.captureAuthority === 'server'
    || data?.assessmentType === 'call-qa'
    || data?.qaScenarioId != null
    || data?.qa != null;
}

function pick(data, fields) {
  return Object.fromEntries(fields
    .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
    .map((field) => [field, data[field]]));
}

export function navigatorInterviewProjection(doc) {
  const data = typeof doc?.data === 'function' ? doc.data() : (doc ?? {});
  const id = doc?.id ?? data.id;
  if (!isProtectedCallQa(data)) return { id, ...data };
  return {
    id,
    ...pick(data, CALL_QA_RESULT_FIELDS),
    assessmentType: 'call-qa',
    scenarioSource: data.scenarioSource ?? 'curated',
  };
}

export async function loadNavigatorInterviewProjection(db, navigatorId) {
  const snap = await db.collection('interviews').where('navigatorId', '==', navigatorId).get();
  return snap.docs.map(navigatorInterviewProjection);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (await validateAppUser(req, res, ['navigator'])) return;
  try {
    const interviews = await loadNavigatorInterviewProjection(
      getFirebaseAdmin().db,
      req.identity.navigatorId,
    );
    return res.status(200).json({ interviews });
  } catch (err) {
    if (err instanceof FirebaseAdminConfigError || err?.code === 'firebase-admin-not-configured') {
      return res.status(503).json({ error: 'Server authentication is not configured.' });
    }
    console.error('my-interviews:', err?.message ?? err);
    return res.status(500).json({ error: 'Could not load interview history.' });
  }
}
