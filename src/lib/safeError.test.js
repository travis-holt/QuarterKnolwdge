// ─────────────────────────────────────────────────────────────────────────────
// Rejection values must never carry assessment content into the logs.
// `err?.message ?? err` falls through to the raw value when `message` is absent,
// so a plain object could be serialized wholesale by console.error.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { safeErrorMessage, UNKNOWN_ERROR_LABEL, MAX_ERROR_CHARS } from './safeError.js';

describe('safeErrorMessage', () => {
  it('logs only the message of an Error', () => {
    expect(safeErrorMessage(new Error('permission denied'))).toBe('permission denied');
  });

  it('does not include an Error stack trace', () => {
    const err = new Error('boom');
    const out = safeErrorMessage(err);
    expect(out).toBe('boom');
    expect(out).not.toContain('at ');
    expect(out).not.toContain(err.stack);
  });

  it('handles a string rejection safely', () => {
    expect(safeErrorMessage('network down')).toBe('network down');
  });

  it('truncates an overlong string', () => {
    const long = 'x'.repeat(MAX_ERROR_CHARS + 500);
    const out = safeErrorMessage(long);
    expect(out.length).toBeLessThanOrEqual(MAX_ERROR_CHARS + 1); // + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  it('never exposes the fields of an object rejection', () => {
    const payload = {
      questions: [{ id: 'q1', scenario: 'A parent calls about a refill', options: ['a', 'b'] }],
      correctOptionId: 'a',
      answers: { q1: 'b' },
      snapshot: { docs: ['secret'] },
    };
    const out = safeErrorMessage(payload);
    expect(out).toBe(UNKNOWN_ERROR_LABEL);
    for (const leak of ['questions', 'scenario', 'refill', 'correctOptionId', 'answers', 'snapshot', 'secret', 'q1']) {
      expect(out).not.toContain(leak);
    }
  });

  it('does not trust a `message` field on a NON-Error object', () => {
    // Duck-typing on .message would leak an attacker/payload-controlled string.
    const fake = { message: 'scenario: patient DOB 1990-01-01, pharmacy CVS Main St' };
    const out = safeErrorMessage(fake);
    expect(out).toBe(UNKNOWN_ERROR_LABEL);
    expect(out).not.toContain('DOB');
    expect(out).not.toContain('pharmacy');
  });

  it.each([null, undefined, 42, true, [], {}, Symbol('x')])(
    'returns the generic label for the non-string, non-Error value %p',
    (value) => {
      expect(safeErrorMessage(value)).toBe(UNKNOWN_ERROR_LABEL);
    }
  );

  it('accepts a caller-supplied fallback label', () => {
    expect(safeErrorMessage({}, 'Unknown question-bank read error'))
      .toBe('Unknown question-bank read error');
  });

  it('falls back when an Error carries an empty message', () => {
    expect(safeErrorMessage(new Error(''))).toBe(UNKNOWN_ERROR_LABEL);
    expect(safeErrorMessage('   ')).toBe(UNKNOWN_ERROR_LABEL);
  });

  it('never serializes an object even when it stringifies to something readable', () => {
    const sneaky = { toString: () => 'answers={"q1":"a"}' };
    expect(safeErrorMessage(sneaky)).toBe(UNKNOWN_ERROR_LABEL);
  });
});
