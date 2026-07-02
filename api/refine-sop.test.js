// Unit tests for the pure validation helpers of POST /api/refine-sop.
import { describe, it, expect } from 'vitest';
import { validateSopRefineResponse, validateSopFile, validateSopAudit } from './refine-sop.js';

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

describe('validateSopFile', () => {
  const pdf = { mimeType: 'application/pdf', data: 'A'.repeat(500) };

  it('accepts a valid PDF payload', () => {
    expect(validateSopFile(pdf)).toBeNull();
  });

  it('rejects missing / non-object files', () => {
    expect(validateSopFile(null)).toMatch(/missing/);
    expect(validateSopFile('nope')).toMatch(/missing/);
  });

  it('rejects non-PDF mime types', () => {
    expect(validateSopFile({ ...pdf, mimeType: 'application/msword' })).toMatch(/PDF only/);
    expect(validateSopFile({ ...pdf, mimeType: 'image/png' })).toMatch(/PDF only/);
  });

  it('rejects empty or absent data', () => {
    expect(validateSopFile({ mimeType: 'application/pdf', data: '' })).toMatch(/data missing/);
    expect(validateSopFile({ mimeType: 'application/pdf' })).toMatch(/data missing/);
  });

  it('rejects oversized data', () => {
    expect(validateSopFile({ mimeType: 'application/pdf', data: 'A'.repeat(14_000_001) })).toMatch(/too large/);
  });
});

describe('validateSopAudit', () => {
  it('normalises a valid audit (trims, drops non-strings)', () => {
    const audit = validateSopAudit({ omissions: ['  rule one  ', 42, ''], inventions: [] });
    expect(audit).toEqual({ omissions: ['rule one'], inventions: [] });
  });

  it('accepts an { audit: {...} } wrapper', () => {
    const audit = validateSopAudit({ audit: { omissions: [], inventions: ['made-up rule'] } });
    expect(audit).toEqual({ omissions: [], inventions: ['made-up rule'] });
  });

  it('returns null for unusable shapes', () => {
    expect(validateSopAudit(null)).toBeNull();
    expect(validateSopAudit([])).toBeNull();
    expect(validateSopAudit({ omissions: 'not-an-array', inventions: [] })).toBeNull();
    expect(validateSopAudit({})).toBeNull();
  });

  it('caps each list at 20 entries and 300 chars per entry', () => {
    const audit = validateSopAudit({
      omissions: Array.from({ length: 30 }, () => 'y'.repeat(400)),
      inventions: [],
    });
    expect(audit.omissions).toHaveLength(20);
    expect(audit.omissions[0]).toHaveLength(300);
  });
});
