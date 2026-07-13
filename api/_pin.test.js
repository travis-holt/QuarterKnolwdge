import { describe, expect, it } from 'vitest';
import { constantTimeTextEqual, hashPin, isValidPin, verifyPin } from './_pin.js';

describe('navigator PIN hashing', () => {
  it('accepts exactly four digits', () => {
    expect(isValidPin('0123')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12a3')).toBe(false);
  });

  it('hashes with salt and verifies without storing plaintext', async () => {
    const hash = await hashPin('0123', Buffer.alloc(16, 7));
    expect(hash).not.toContain('0123');
    expect(await verifyPin('0123', hash)).toBe(true);
    expect(await verifyPin('9999', hash)).toBe(false);
  });

  it('safely rejects malformed hashes and compares legacy text', async () => {
    expect(await verifyPin('0123', 'broken')).toBe(false);
    expect(constantTimeTextEqual('1234', '1234')).toBe(true);
    expect(constantTimeTextEqual('1234', '0000')).toBe(false);
  });
});
