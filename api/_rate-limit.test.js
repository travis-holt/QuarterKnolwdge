import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clientIp, rateLimit, resetRateLimits } from './_rate-limit.js';

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

beforeEach(resetRateLimits);

describe('Railway-aware rate limiting', () => {
  it('uses Railway X-Real-IP instead of the shared proxy socket', () => {
    expect(clientIp({
      headers: { 'x-real-ip': '203.0.113.8' },
      ip: '10.0.0.2',
      socket: { remoteAddress: '10.0.0.3' },
    })).toBe('203.0.113.8');
  });

  it('keeps two clients behind the same Railway hop in separate buckets', () => {
    const middleware = rateLimit({ label: 'test', max: 1 });
    const nextA = vi.fn();
    const nextB = vi.fn();
    middleware({ headers: { 'x-real-ip': '203.0.113.1' }, socket: { remoteAddress: '10.0.0.2' } }, response(), nextA);
    middleware({ headers: { 'x-real-ip': '203.0.113.2' }, socket: { remoteAddress: '10.0.0.2' } }, response(), nextB);
    expect(nextA).toHaveBeenCalledOnce();
    expect(nextB).toHaveBeenCalledOnce();
  });

  it('rejects a second request from the same client inside the window', () => {
    const middleware = rateLimit({ label: 'test', max: 1 });
    const req = { headers: { 'x-real-ip': '203.0.113.1' }, socket: {} };
    middleware(req, response(), vi.fn());
    const res = response();
    middleware(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
