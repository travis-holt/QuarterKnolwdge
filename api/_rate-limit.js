import { isIP } from 'node:net';

const windows = new Map();

export function clientIp(req) {
  // Railway overwrites X-Real-IP with the connecting client. Express req.ip and
  // socket.remoteAddress otherwise identify the Railway proxy hop, collapsing
  // every navigator into one global quota bucket.
  const real = String(req?.headers?.['x-real-ip'] ?? '').split(',')[0].trim();
  if (isIP(real)) return real;
  const expressIp = String(req?.ip ?? '').trim();
  if (isIP(expressIp)) return expressIp;
  const remote = String(req?.socket?.remoteAddress ?? '').trim();
  return isIP(remote) ? remote : 'unknown';
}

function keyFor(req, label, key) {
  return `${label}:${key ?? clientIp(req)}`;
}

export function rateLimit({ label, windowMs = 60_000, max = 20, keyBy }) {
  return (req, res, next) => {
    const apply = (identityKey) => {
      const key = keyFor(req, label, identityKey);
      const now = Date.now();
      // Bound the process map during long-lived Railway deployments.
      if (windows.size > 2_000) {
        for (const [candidate, value] of windows) {
          if (now >= value.resetAt) windows.delete(candidate);
        }
      }
      const entry = windows.get(key);
      if (!entry || now >= entry.resetAt) {
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return next();
      }
      entry.count += 1;
      if (entry.count > max) {
        res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
        return;
      }
      next();
    };
    if (!keyBy) return apply();
    return Promise.resolve(keyBy(req)).then(apply, () => apply());
  };
}

export function resetRateLimits() {
  windows.clear();
}
