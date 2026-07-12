import { describe, expect, it } from 'vitest';
import { clientTimestamp, compareTimestampAsc, compareTimestampDesc, compareTimestampValues, timestampMillis } from './time.js';

describe('timestampMillis', () => {
  it('preserves Firestore nanosecond precision', () => {
    expect(timestampMillis({ seconds: 10, nanoseconds: 900_000_000 })).toBe(10_900);
    expect(timestampMillis({ seconds: 10, nanoseconds: 100_000_000 })).toBe(10_100);
  });

  it('accepts toMillis, toDate, Date, epoch seconds, and epoch millis', () => {
    expect(timestampMillis({ toMillis: () => 1234 })).toBe(1234);
    expect(timestampMillis({ toDate: () => new Date(2345) })).toBe(2345);
    expect(timestampMillis(new Date(3456))).toBe(3456);
    expect(timestampMillis(123)).toBe(123_000);
    expect(timestampMillis(1_700_000_000_123)).toBe(1_700_000_000_123);
  });

  it('orders events that occur within the same second deterministically', () => {
    const rows = [
      { at: { seconds: 7, nanoseconds: 100_000_000 }, id: 'old' },
      { at: { seconds: 7, nanoseconds: 900_000_000 }, id: 'new' },
    ];
    expect([...rows].sort((a, b) => compareTimestampAsc(a, b, 'at')).map((r) => r.id))
      .toEqual(['old', 'new']);
    expect([...rows].sort((a, b) => compareTimestampDesc(a, b, 'at')).map((r) => r.id))
      .toEqual(['new', 'old']);
  });

  it('distinguishes timestamps inside the same millisecond', () => {
    expect(compareTimestampValues(
      { seconds: 7, nanoseconds: 100_000_001 },
      { seconds: 7, nanoseconds: 100_000_002 },
    )).toBeLessThan(0);
  });
});

describe('clientTimestamp', () => {
  it('retains the millisecond portion as nanoseconds', () => {
    expect(clientTimestamp(12_345)).toEqual({ seconds: 12, nanoseconds: 345_000_000 });
  });
});
