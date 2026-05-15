import { describe, expect, test } from 'bun:test'
import {
  classifyAPIError,
  getAssistantMessageFromError,
  isPromptTooLongMessage,
} from '../errors.js'

describe('API prompt-too-long classification', () => {
  test('recognizes OpenAI-compatible context-window overflow wording', () => {
    const error = new Error(
      'Your input exceeds the context window of this model. Please adjust your input and try again.',
    )

    expect(classifyAPIError(error)).toBe('prompt_too_long')

    const message = getAssistantMessageFromError(error, 'gpt-5.5')
    expect(isPromptTooLongMessage(message)).toBe(true)
    expect(message.errorDetails).toContain('context window')
  })
})
