/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import {
  getAnthropicApiKeyWithSource,
  getAuthTokenSource,
  isUsing3PServices,
} from '../../utils/auth.js'
import { isRunningOnHomespace } from '../../utils/envUtils.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const DISABLED_LOGIN_MESSAGE =
  'Native Claude login is disabled. Configure the custom model credentials in Argus settings.'
const DISABLED_LOGOUT_MESSAGE =
  'Native Claude logout is disabled. Custom model credentials are managed in Argus settings.'

export async function installOAuthTokens(_tokens: unknown): Promise<void> {
  throw new Error(DISABLED_LOGIN_MESSAGE)
}

export async function authLogin(_options: {
  email?: string
  sso?: boolean
  console?: boolean
  claudeai?: boolean
}): Promise<void> {
  process.stderr.write(`${DISABLED_LOGIN_MESSAGE}\n`)
  process.exit(1)
}

function getCustomModelAuthState(): {
  loggedIn: boolean
  authMethod: string
  apiProvider: string
  apiKeySource: string | null
} {
  const apiProvider = getAPIProvider()
  const { source: authTokenSource, hasToken } = getAuthTokenSource()
  const { source: apiKeySource } = getAnthropicApiKeyWithSource()
  const hasAnthropicApiKeyEnvVar =
    !!process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace()
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY
  const hasGeminiKey = !!process.env.GEMINI_API_KEY
  const hasGrokKey = !!(process.env.GROK_API_KEY || process.env.XAI_API_KEY)
  const hasAnthropicCompatibleToken =
    (hasToken && authTokenSource !== 'claude.ai') ||
    (apiKeySource !== 'none' && apiKeySource !== '/login managed key') ||
    hasAnthropicApiKeyEnvVar
  const using3P = isUsing3PServices()

  if (apiProvider === 'openai') {
    return {
      loggedIn: hasOpenAIKey,
      authMethod: hasOpenAIKey ? 'openai_compatible' : 'missing_openai_key',
      apiProvider,
      apiKeySource: hasOpenAIKey ? 'OPENAI_API_KEY' : null,
    }
  }

  if (apiProvider === 'gemini') {
    return {
      loggedIn: hasGeminiKey,
      authMethod: hasGeminiKey ? 'gemini_api_key' : 'missing_gemini_key',
      apiProvider,
      apiKeySource: hasGeminiKey ? 'GEMINI_API_KEY' : null,
    }
  }

  if (apiProvider === 'grok') {
    return {
      loggedIn: hasGrokKey,
      authMethod: hasGrokKey ? 'grok_api_key' : 'missing_grok_key',
      apiProvider,
      apiKeySource: hasGrokKey
        ? process.env.GROK_API_KEY
          ? 'GROK_API_KEY'
          : 'XAI_API_KEY'
        : null,
    }
  }

  if (using3P) {
    return {
      loggedIn: true,
      authMethod: 'third_party',
      apiProvider,
      apiKeySource: null,
    }
  }

  return {
    loggedIn: hasAnthropicCompatibleToken,
    authMethod: hasAnthropicCompatibleToken
      ? 'anthropic_compatible'
      : 'missing_custom_model_credentials',
    apiProvider,
    apiKeySource:
      apiKeySource !== 'none'
        ? apiKeySource
        : hasAnthropicApiKeyEnvVar
          ? 'ANTHROPIC_API_KEY'
          : null,
  }
}

export async function authStatus(opts: {
  json?: boolean
  text?: boolean
}): Promise<void> {
  const state = getCustomModelAuthState()

  if (opts.text) {
    process.stdout.write(`Provider: ${state.apiProvider}\n`)
    process.stdout.write(`Auth method: ${state.authMethod}\n`)
    if (state.apiKeySource) {
      process.stdout.write(`Credential source: ${state.apiKeySource}\n`)
    }
    if (!state.loggedIn) {
      process.stdout.write(`${DISABLED_LOGIN_MESSAGE}\n`)
    }
  } else {
    process.stdout.write(
      jsonStringify(
        {
          loggedIn: state.loggedIn,
          nativeClaudeLoginEnabled: false,
          authMethod: state.authMethod,
          apiProvider: state.apiProvider,
          apiKeySource: state.apiKeySource,
        },
        null,
        2,
      ) + '\n',
    )
  }

  process.exit(state.loggedIn ? 0 : 1)
}

export async function authLogout(): Promise<void> {
  process.stdout.write(`${DISABLED_LOGOUT_MESSAGE}\n`)
  process.exit(0)
}
