import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const PREFIX = 'scrypt-v1';
const KEY_BYTES = 32;

export function isValidPin(pin) {
  return /^\d{4}$/.test(String(pin ?? ''));
}

export async function hashPin(pin, salt = crypto.randomBytes(16)) {
  if (!isValidPin(pin)) throw new Error('PIN must be exactly 4 digits.');
  const derived = await scrypt(String(pin), salt, KEY_BYTES);
  return `${PREFIX}$${Buffer.from(salt).toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPin(pin, storedHash) {
  if (!isValidPin(pin) || typeof storedHash !== 'string') return false;
  const [prefix, saltText, hashText] = storedHash.split('$');
  if (prefix !== PREFIX || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, 'base64url');
    const actual = Buffer.from(await scrypt(String(pin), Buffer.from(saltText, 'base64url'), expected.length));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function constantTimeTextEqual(left, right) {
  const a = Buffer.from(String(left ?? ''), 'utf8');
  const b = Buffer.from(String(right ?? ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
