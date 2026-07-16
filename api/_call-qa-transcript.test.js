import { describe, it, expect } from 'vitest';
import {
  TranscriptCapture, normalizeTranscriptRole, appendTranscriptFragment, boundedAppend,
  MAX_QA_TURNS,
} from './_call-qa-transcript.js';

describe('boundedAppend (shared truncation)', () => {
  it('appends within the cap without capping', () => {
    expect(boundedAppend('Hi', 'there', 100)).toEqual({ text: 'Hi there', capped: false });
  });
  it('caps at maxChars and flags capped', () => {
    const r = boundedAppend('ab', 'cdefghij', 5);
    expect(r.capped).toBe(true);
    expect(r.text.length).toBe(5);
  });
  it('caps a single oversized fragment appended to empty', () => {
    const r = boundedAppend('', 'x'.repeat(20), 8);
    expect(r.text).toBe('x'.repeat(8));
    expect(r.capped).toBe(true);
  });
});

describe('normalizeTranscriptRole', () => {
  it('maps navigator to navigator and everything else to patient', () => {
    expect(normalizeTranscriptRole('navigator')).toBe('navigator');
    expect(normalizeTranscriptRole('patient')).toBe('patient');
    expect(normalizeTranscriptRole('caller')).toBe('patient');
    expect(normalizeTranscriptRole('anything')).toBe('patient');
    expect(normalizeTranscriptRole(undefined)).toBe('patient');
  });
});

describe('appendTranscriptFragment', () => {
  it('joins fragments with a single space and collapses whitespace', () => {
    expect(appendTranscriptFragment('Hello', 'there')).toBe('Hello there');
    // Leading whitespace on a fragment is trimmed; the existing string's trailing
    // space is preserved (final trim happens at toArray()).
    expect(appendTranscriptFragment('Hello ', '  world')).toBe('Hello world');
    expect(appendTranscriptFragment('', ' start')).toBe('start');
  });
  it('does not add a space before punctuation', () => {
    expect(appendTranscriptFragment('Hello', '.')).toBe('Hello.');
    expect(appendTranscriptFragment('Hello', ', there')).toBe('Hello, there');
  });
  it('ignores empty fragments', () => {
    expect(appendTranscriptFragment('Hello', '   ')).toBe('Hello');
  });
});

describe('TranscriptCapture', () => {
  it('coalesces consecutive same-role fragments into one turn', () => {
    const cap = new TranscriptCapture();
    cap.add('navigator', 'Good morning,');
    cap.add('navigator', 'this is Dana.');
    cap.add('patient', 'Hi,');
    cap.add('patient', 'I need help.');
    expect(cap.toArray()).toEqual([
      { role: 'navigator', text: 'Good morning, this is Dana.' },
      { role: 'patient', text: 'Hi, I need help.' },
    ]);
  });

  it('keeps caller and navigator roles distinct and preserves order', () => {
    const cap = new TranscriptCapture();
    cap.add('patient', 'A');
    cap.add('navigator', 'B');
    cap.add('patient', 'C');
    expect(cap.toArray().map((t) => t.role)).toEqual(['patient', 'navigator', 'patient']);
    expect(cap.navigatorTurnCount).toBe(1);
    expect(cap.callerTurnCount).toBe(2);
  });

  it('normalizes caller role to patient', () => {
    const cap = new TranscriptCapture();
    cap.add('caller', 'hello');
    expect(cap.toArray()[0].role).toBe('patient');
  });

  it('ignores empty fragments', () => {
    const cap = new TranscriptCapture();
    expect(cap.add('navigator', '   ')).toBe(false);
    expect(cap.add('navigator', '')).toBe(false);
    expect(cap.toArray()).toEqual([]);
  });

  it('bounds turn length and records a warning', () => {
    const cap = new TranscriptCapture({ maxTurnChars: 10 });
    cap.add('navigator', 'abcdefghij'); // exactly 10
    cap.add('navigator', 'klmnop');     // would exceed → dropped
    expect(cap.toArray()[0].text.length).toBe(10);
    expect(cap.warnings).toContain('turn-length-capped');
  });

  it('records turn-length-capped when APPENDING crosses the cap (not silently truncated)', () => {
    const cap = new TranscriptCapture({ maxTurnChars: 10 });
    cap.add('navigator', 'abcde');  // 5 chars, under cap
    expect(cap.warnings).not.toContain('turn-length-capped');
    cap.add('navigator', 'fghijklmn'); // append → 5 + 1 space + 9 = 15 > 10 → truncated
    expect(cap.toArray()[0].text.length).toBe(10);
    expect(cap.warnings).toContain('turn-length-capped');
  });

  it('records turn-length-capped when a SINGLE fragment exceeds the cap', () => {
    const cap = new TranscriptCapture({ maxTurnChars: 5 });
    cap.add('navigator', 'abcdefghij'); // 10 > 5 → truncated on first insert
    expect(cap.toArray()[0].text.length).toBe(5);
    expect(cap.warnings).toContain('turn-length-capped');
  });

  it('bounds total turn count and records a warning', () => {
    const cap = new TranscriptCapture({ maxTurns: 2 });
    cap.add('navigator', 'one');
    cap.add('patient', 'two');
    cap.add('navigator', 'three'); // 3rd distinct turn → dropped
    expect(cap.toArray().length).toBe(2);
    expect(cap.warnings).toContain('turn-count-capped');
  });

  it('reports whether any navigator turn exists', () => {
    const cap = new TranscriptCapture();
    expect(cap.hasNavigatorTurn).toBe(false);
    cap.add('patient', 'only the caller');
    expect(cap.hasNavigatorTurn).toBe(false);
    cap.add('navigator', 'now the navigator');
    expect(cap.hasNavigatorTurn).toBe(true);
  });

  it('exposes a sane default turn cap', () => {
    expect(MAX_QA_TURNS).toBeGreaterThan(0);
  });
});
