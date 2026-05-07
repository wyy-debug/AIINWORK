import { describe, expect, it } from 'vitest';

import { extractProposedPlanBlocks } from './proposedPlan';

describe('extractProposedPlanBlocks', () => {
  it('strips proposed_plan blocks from assistant text and returns plan payloads', () => {
    const result = extractProposedPlanBlocks([
      'I checked the repo.',
      '<proposed_plan>',
      '# Ship it',
      '',
      '- Add the button',
      '- Parse plans',
      '</proposed_plan>',
      'Trailing note.',
    ].join('\n'));

    expect(result.text).toBe('I checked the repo.\n\nTrailing note.');
    expect(result.plans).toEqual([
      '# Ship it\n\n- Add the button\n- Parse plans',
    ]);
  });

  it('leaves normal assistant text unchanged when no plan block exists', () => {
    const result = extractProposedPlanBlocks('No plan yet.');

    expect(result.text).toBe('No plan yet.');
    expect(result.plans).toEqual([]);
  });
});
