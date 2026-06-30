import { describe, it, expect } from 'vitest';
import { validateSequenceResponse } from './sequence-path.js';

const VALID_KINDS = ['coaching', 'practice', 'module', 'minicheck'];

const makeValidPath = (domainId = 'domain-1', kinds = VALID_KINDS) => ({
  domainId,
  steps: kinds.map((kind) => ({ kind, rationale: 'Because it is the best step here.' })),
});

describe('validateSequenceResponse', () => {
  it('accepts a valid response with one path', () => {
    const { data, error } = validateSequenceResponse({ paths: [makeValidPath()] });
    expect(error).toBeUndefined();
    expect(data.paths).toHaveLength(1);
  });

  it('accepts multiple paths', () => {
    const parsed = { paths: [makeValidPath('d1'), makeValidPath('d2', ['coaching', 'practice'])] };
    const { data } = validateSequenceResponse(parsed);
    expect(data.paths).toHaveLength(2);
  });

  it('rejects when paths array is missing', () => {
    const { error } = validateSequenceResponse({});
    expect(error).toMatch(/paths/);
  });

  it('rejects when paths is not an array', () => {
    const { error } = validateSequenceResponse({ paths: 'oops' });
    expect(error).toMatch(/paths/);
  });

  it('rejects when a path is missing domainId', () => {
    const { error } = validateSequenceResponse({ paths: [{ steps: [{ kind: 'coaching', rationale: 'ok' }] }] });
    expect(error).toMatch(/domainId/);
  });

  it('rejects when steps array is empty', () => {
    const { error } = validateSequenceResponse({ paths: [{ domainId: 'd1', steps: [] }] });
    expect(error).toMatch(/steps/);
  });

  it('rejects an invalid step kind', () => {
    const { error } = validateSequenceResponse({
      paths: [{ domainId: 'd1', steps: [{ kind: 'unknown', rationale: 'ok' }] }],
    });
    expect(error).toMatch(/kind/);
  });

  it('rejects a step with a missing or too-short rationale', () => {
    const { error } = validateSequenceResponse({
      paths: [{ domainId: 'd1', steps: [{ kind: 'coaching', rationale: 'hi' }] }],
    });
    expect(error).toMatch(/rationale/);
  });

  it('rejects a step with no rationale field', () => {
    const { error } = validateSequenceResponse({
      paths: [{ domainId: 'd1', steps: [{ kind: 'coaching' }] }],
    });
    expect(error).toMatch(/rationale/);
  });
});
