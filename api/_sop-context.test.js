import { describe, expect, it } from 'vitest';
import { composeSopGrounding, SOP_CONTEXTS } from './_sop-context.js';

describe('OB/GYN SOP authority composition', () => {
  it('places owner-confirmed rules before active SOP and the generic model', () => {
    const grounding = composeSopGrounding('obgyn', { body: 'ACTIVE FLOOR SOP BODY', version: 9 });
    expect(grounding).toMatchObject({
      department: 'obgyn',
      sourceSopVersion: 'active-sop:obgyn:v9',
      sourceAuthority: 'owner-confirmed-current-floor',
      departmentAuthority: 'active-supervisor-managed-sop',
    });
    expect(grounding.context.indexOf('SOURCE AUTHORITY')).toBeLessThan(grounding.context.indexOf('ACTIVE FLOOR SOP BODY'));
    expect(grounding.context.indexOf('ACTIVE FLOOR SOP BODY')).toBeLessThan(grounding.context.indexOf('GENERIC NAVIGATOR OPERATING MODEL'));
  });

  it('uses the corrected current-floor hardcoded OB/GYN fallback', () => {
    const grounding = composeSopGrounding('obgyn');
    expect(grounding.sourceSopVersion).toBe('obgyn-current-floor-2026-07-17');
    expect(SOP_CONTEXTS.obgyn).toMatch(/Rebecca Wood/);
    expect(SOP_CONTEXTS.obgyn).toMatch(/Do not independently direct the patient to L&D/);
    expect(SOP_CONTEXTS.obgyn).not.toMatch(/Prevention Coordinator/);
    expect(SOP_CONTEXTS.obgyn).not.toMatch(/route to PSS OB/i);
  });
});
