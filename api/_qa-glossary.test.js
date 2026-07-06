// Tests for the Call-QA transcript glossary (deterministic, no network).
// The correction must fix mis-transcribed SOP terms WITHOUT inventing words.

import { describe, it, expect } from 'vitest';
import {
  glossaryFor, correctText, correctTranscript, correctTranscriptWithStats, glossaryPromptBlock,
} from './_qa-glossary.js';

describe('correctText — explicit aliases', () => {
  const g = glossaryFor('pediatrics');

  it('fixes the organization name (Isr Pediatrics → Aizer Health)', () => {
    expect(correctText('Thank you for calling Isr Pediatrics, this is Dana.', g))
      .toBe('Thank you for calling Aizer Health, this is Dana.');
  });

  it('is case-insensitive on aliases', () => {
    expect(correctText('welcome to IZER HEALTH', g)).toBe('welcome to Aizer Health');
  });

  it('normalizes a queue name', () => {
    expect(correctText("I'll send a TE to the peds encounter queue", g))
      .toContain('PEDS Encounters');
  });

  it('fixes a two-word alias for the hospital', () => {
    expect(correctText('born at Good Samaratin', g)).toBe('born at Good Samaritan');
  });

  it('fixes the standalone org name (Izer → Aizer)', () => {
    expect(correctText("we're part of Izer, ma'am", g)).toBe("we're part of Aizer, ma'am");
    expect(correctText('calling from Iser today', g)).toBe('calling from Aizer today');
  });

  it('still prefers the two-word form when the full phrase was said', () => {
    expect(correctText('thank you for calling Izer Health', g)).toBe('thank you for calling Aizer Health');
  });
});

describe('correctText — single-word fuzzy (proper nouns only)', () => {
  const g = glossaryFor('pediatrics');

  it('snaps a near-spelling of a provider surname', () => {
    expect(correctText('That would be with Dr. Pollinger.', g)).toBe('That would be with Dr. Polinger.');
  });

  it('leaves ordinary conversation untouched', () => {
    const line = 'I need a physical for my son sometime next week please.';
    expect(correctText(line, g)).toBe(line);
  });

  it('does not touch a correctly-spelled term', () => {
    expect(correctText('booked with Faiden at Bakertown', g)).toBe('booked with Faiden at Bakertown');
  });

  it('never emits a word outside the glossary (no hallucination)', () => {
    // "forecast" is not near any canonical term → unchanged.
    expect(correctText('the weather forecast looks fine', g)).toBe('the weather forecast looks fine');
  });
});

describe('correctTranscript', () => {
  it('corrects every turn and preserves roles/shape', () => {
    const out = correctTranscript([
      { role: 'navigator', text: 'Thanks for calling Isr Pediatrics.' },
      { role: 'patient', text: 'Hi there.' },
    ], 'pediatrics');
    expect(out).toEqual([
      { role: 'navigator', text: 'Thanks for calling Aizer Health.' },
      { role: 'patient', text: 'Hi there.' },
    ]);
  });

  it('tolerates missing/blank text and non-arrays', () => {
    expect(correctTranscript([{ role: 'navigator' }])).toEqual([{ role: 'navigator', text: '' }]);
    expect(correctTranscript(null)).toBe(null);
  });
});

describe('correctTranscriptWithStats', () => {
  it('counts only the turns that actually changed', () => {
    const { transcript, correctedTurns } = correctTranscriptWithStats([
      { role: 'navigator', text: 'Thanks for calling Isr Pediatrics.' },
      { role: 'patient', text: 'Hi there.' },
      { role: 'navigator', text: 'Dr. Pollinger can see him at Baker Town.' },
    ], 'pediatrics');
    expect(correctedTurns).toBe(2);
    expect(transcript[1].text).toBe('Hi there.');
  });

  it('reports zero corrections for a clean transcript', () => {
    const { correctedTurns } = correctTranscriptWithStats([
      { role: 'navigator', text: 'Thank you for calling Aizer Health.' },
    ], 'pediatrics');
    expect(correctedTurns).toBe(0);
  });

  it('tolerates non-arrays', () => {
    expect(correctTranscriptWithStats(null)).toEqual({ transcript: null, correctedTurns: 0 });
  });
});

describe('glossaryFor / glossaryPromptBlock', () => {
  it('returns department-specific terms', () => {
    expect(glossaryFor('obgyn').some((e) => e.canonical === 'Labor and Delivery')).toBe(true);
    expect(glossaryFor('pediatrics').some((e) => e.canonical === 'PEDS Encounters')).toBe(true);
  });

  it('prompt block lists canonical terms and abbreviation equivalences', () => {
    const block = glossaryPromptBlock('pediatrics');
    expect(block).toContain('Aizer Health');
    expect(block).toContain('PE = physical exam');
  });

  it('prompt block includes OB/GYN equivalences for obgyn', () => {
    expect(glossaryPromptBlock('obgyn')).toContain('L&D = Labor and Delivery');
  });
});
