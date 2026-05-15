import { describe, expect, mock, test } from 'bun:test'
import { DEFAULT_BUILD_FEATURES } from '../../../../scripts/defines'

mock.module('bun:bundle', () => ({ feature: () => false }))

describe('reactive compaction', () => {
  test('is included in the default Argus build', () => {
    expect(DEFAULT_BUILD_FEATURES).toContain('REACTIVE_COMPACT')
  })

  test('withholds prompt-too-long API errors for recovery', async () => {
    const { isWithheldPromptTooLong } = await import('../reactiveCompact.js')

    expect(
      isWithheldPromptTooLong({
        type: 'assistant',
        isApiErrorMessage: true,
        message: {
          content: [{ type: 'text', text: 'Prompt is too long' }],
        },
      } as never),
    ).toBe(true)
  })
})
