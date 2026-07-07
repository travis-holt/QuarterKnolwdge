const windows = new Map();

function keyFor(req, label) {
  return `${label}:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

export function rateLimit({ label, windowMs = 60_000, max = 20 }) {
  return (req, res, next) => {
    const key = keyFor(req, label);
    const now = Date.now();
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
}
