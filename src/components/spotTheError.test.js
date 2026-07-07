import { describe, it, expect } from 'vitest';
import { selectAuditItems } from './SpotTheError.jsx';

describe('selectAuditItems', () => {
  it('avoids repeated workflow types in single-domain mode when alternatives exist', () => {
    const { fromBank, toGenerate } = selectAuditItems(
      ['routing', 'routing', 'routing'],
      {
        routing: [
          { workflowType: 'standard_refill_queue', transcript: [], errorIndex: 0, modelExplanation: 'a' },
          { workflowType: 'standard_refill_queue', transcript: [], errorIndex: 0, modelExplanation: 'b' },
          { workflowType: 'referral_owner', transcript: [], errorIndex: 0, modelExplanation: 'c' },
          { workflowType: 'shots_or_imaging_owner', transcript: [], errorIndex: 0, modelExplanation: 'd' },
        ],
      }
    );

    expect(toGenerate).toEqual([]);
    expect(fromBank.map((a) => a.modelExplanation)).toEqual(['a', 'c', 'd']);
  });
});
