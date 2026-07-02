// Unit tests for the pure validation helper of POST /api/refine-sop.
import { describe, it, expect } from 'vitest';
import { validateSopRefineResponse } from './refine-sop.js';

const LONG_BODY = 'CALL OPENING & IDENTIFICATION\n' + 'Rule line. '.repeat(40);

describe('validateSopRefineResponse', () => {
  it('accepts a valid build response and normalises notes', () => {
    const { data, error } = validateSopRefineResponse(
      { sop: { title: '  Peds SOP  ', body: LONG_BODY, notes: ['  gap one  ', '', 42] } },
      'build'
    );
    expect(error).toBeUndefined();
    expect(data.title).toBe('Peds SOP');
    expect(data.notes).toEqual(['gap one']);
    expect(data.changes).toBeUndefined();
  });

  it('defaults notes to [] when absent in build mode', () => {
    const { data } = validateSopRefineResponse(
      { sop: { title: 'T', body: LONG_BODY } },
      'build'
    );
    expect(data.notes).toEqual([]);
  });

  it('accepts a valid refine response with typed changes', () => {
    const { data, error } = validateSopRefineResponse(
      {
        sop: {
          title: 'OB SOP v2',
          body: LONG_BODY,
          changes: [
            { type: 'contradiction', summary: 'Psych nurse routing replaced by provider-direct.' },
            { type: 'addition', summary: 'New MFM coordinator routing rule.' },
          ],
        },
      },
      'refine'
    );
    expect(error).toBeUndefined();
    expect(data.changes).toHaveLength(2);
    expect(data.changes[0].type).toBe('contradiction');
  });

  it('rejects a missing sop object', () => {
    expect(validateSopRefineResponse({}, 'build').error).toMatch(/missing sop/);
    expect(validateSopRefineResponse(null, 'build').error).toMatch(/missing sop/);
  });

  it('rejects a missing or empty title', () => {
    expect(validateSopRefineResponse({ sop: { title: '  ', body: LONG_BODY } }, 'build').error)
      .toMatch(/title/);
  });

  it('rejects a body under 200 characters', () => {
    expect(validateSopRefineResponse({ sop: { title: 'T', body: 'too short' } }, 'build').error)
      .toMatch(/body/);
  });

  it('rejects refine responses without a changes array', () => {
    expect(validateSopRefineResponse({ sop: { title: 'T', body: LONG_BODY } }, 'refine').error)
      .toMatch(/changes/);
  });

  it('rejects an unknown change type', () => {
    const { error } = validateSopRefineResponse(
      { sop: { title: 'T', body: LONG_BODY, changes: [{ type: 'rewrite', summary: 'nope nope' }] } },
      'refine'
    );
    expect(error).toMatch(/invalid change type/);
  });

  it('rejects a change with a missing/short summary', () => {
    const { error } = validateSopRefineResponse(
      { sop: { title: 'T', body: LONG_BODY, changes: [{ type: 'addition', summary: 'x' }] } },
      'refine'
    );
    expect(error).toMatch(/summary/);
  });

  it('caps an over-long title at 200 chars', () => {
    const { data } = validateSopRefineResponse(
      { sop: { title: 'x'.repeat(500), body: LONG_BODY } },
      'build'
    );
    expect(data.title).toHaveLength(200);
  });
});
