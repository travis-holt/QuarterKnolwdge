import { describe, expect, it } from 'vitest';
import { DOMAINS } from '../data/questions.js';
import { selectPracticeDomain } from './practiceDomain.js';

describe('selectPracticeDomain', () => {
  it('honors the domain selected by a development path', () => {
    expect(selectPracticeDomain('routing', () => 0.99)).toBe('routing');
  });

  it('falls back to a valid random domain for ordinary practice', () => {
    expect(selectPracticeDomain(null, () => 0)).toBe(DOMAINS[0].id);
    expect(selectPracticeDomain('not-a-domain', () => 0.999)).toBe(DOMAINS.at(-1).id);
  });
});
