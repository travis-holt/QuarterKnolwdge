// ─────────────────────────────────────────────────────────────────────────────
// The shared score formatter — the single place that decides whether a value is
// measured evidence or a gap. `Math.round(null)` is 0, so every label that could
// receive a null must go through here.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  formatPercent,
  formatSeriesCurrent,
  latestMeasured,
  isMeasured,
  NO_EVIDENCE_LABEL,
} from './formatScore.js';

describe('isMeasured', () => {
  it.each([0, 1, 99.5, 100, -5])('accepts the finite number %p', (v) => {
    expect(isMeasured(v)).toBe(true);
  });

  it.each([null, undefined, NaN, '80', '', {}, [], Infinity, -Infinity])(
    'rejects the non-finite value %p',
    (v) => {
      expect(isMeasured(v)).toBe(false);
    }
  );
});

describe('formatPercent', () => {
  it('renders a genuine numeric zero as 0%', () => {
    expect(formatPercent(0)).toBe('0%');
  });

  it('rounds finite values', () => {
    expect(formatPercent(72)).toBe('72%');
    expect(formatPercent(72.4)).toBe('72%');
    expect(formatPercent(72.6)).toBe('73%');
  });

  it.each([null, undefined, NaN, 'abc'])('renders %p as the empty label', (v) => {
    expect(formatPercent(v)).toBe(NO_EVIDENCE_LABEL);
    expect(formatPercent(v)).not.toBe('0%');
  });

  it('accepts a custom empty label', () => {
    expect(formatPercent(null, { empty: '—' })).toBe('—');
  });
});

describe('latestMeasured', () => {
  it('returns the last finite value, skipping trailing gaps', () => {
    expect(latestMeasured([70, 80, null])).toBe(80);
    expect(latestMeasured([70, null, null])).toBe(70);
  });

  it('returns null when nothing was ever measured', () => {
    expect(latestMeasured([null, null])).toBeNull();
    expect(latestMeasured([])).toBeNull();
    expect(latestMeasured(undefined)).toBeNull();
  });

  it('treats a genuine zero as measured', () => {
    expect(latestMeasured([50, 0])).toBe(0);
  });
});

describe('formatSeriesCurrent', () => {
  it('reports the LATEST snapshot, not the latest measured value', () => {
    // An older reading must never be presented as the current one.
    expect(formatSeriesCurrent([70, 80, null])).toBe(NO_EVIDENCE_LABEL);
    expect(formatSeriesCurrent([70, 80, null])).not.toBe('80%');
  });

  it('renders a measured latest value', () => {
    expect(formatSeriesCurrent([70, 80])).toBe('80%');
  });

  it('renders a genuine latest zero as 0%', () => {
    expect(formatSeriesCurrent([70, 0])).toBe('0%');
  });

  it.each([[[]], [undefined], [null]])('handles the empty series %p', (series) => {
    expect(formatSeriesCurrent(series)).toBe(NO_EVIDENCE_LABEL);
  });

  it('never turns a null into 0% (the Math.round(null) trap)', () => {
    expect(Math.round(null)).toBe(0); // the underlying JS behaviour…
    expect(formatSeriesCurrent([null])).toBe(NO_EVIDENCE_LABEL); // …which we do not inherit
  });
});
