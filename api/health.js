// Minimal Vercel serverless function — confirms the /api runtime is deployed and
// reachable. Returns 200 with a small JSON body. No secrets, no external calls.
export default function handler(req, res) {
  res.status(200).json({ ok: true, service: 'quarterly-knowledge-check', ts: Date.now() });
}
