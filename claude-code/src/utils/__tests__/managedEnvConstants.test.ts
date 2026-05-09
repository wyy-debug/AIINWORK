import { describe, expect, test } from 'bun:test'

import { isProviderManagedEnvVar } from '../managedEnvConstants.js'

describe('isProviderManagedEnvVar', () => {
  test('treats OpenAI provider selection as host-managed routing', () => {
    expect(isProviderManagedEnvVar('MTL_CODE_USE_OPENAI')).toBe(true)
  })
})
