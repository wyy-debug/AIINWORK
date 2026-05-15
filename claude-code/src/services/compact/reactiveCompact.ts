import type { AssistantMessage, Message } from '../../types/message.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import {
  isMediaSizeErrorMessage,
  isPromptTooLongMessage,
} from '../api/errors.js'
import { setLastSummarizedMessageId } from '../SessionMemory/sessionMemoryUtils.js'
import {
  compactConversation,
  ERROR_MESSAGE_USER_ABORT,
  type CompactionResult,
} from './compact.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'

export function isReactiveOnlyMode(): boolean {
  return isEnvTruthy(process.env.MTL_CODE_REACTIVE_COMPACT_ONLY)
}

export function isReactiveCompactEnabled(): boolean {
  return (
    !isEnvTruthy(process.env.DISABLE_COMPACT) &&
    !isEnvTruthy(process.env.DISABLE_AUTO_COMPACT) &&
    !isEnvTruthy(process.env.DISABLE_REACTIVE_COMPACT)
  )
}

export function isWithheldPromptTooLong(message: Message): boolean {
  return (
    isReactiveCompactEnabled() &&
    message.type === 'assistant' &&
    isPromptTooLongMessage(message as AssistantMessage)
  )
}

export function isWithheldMediaSizeError(message: Message): boolean {
  return (
    isReactiveCompactEnabled() &&
    message.type === 'assistant' &&
    isMediaSizeErrorMessage(message as AssistantMessage)
  )
}

export async function reactiveCompactOnPromptTooLong(
  messages: Message[],
  cacheSafeParams: CacheSafeParams,
  options: { customInstructions?: string; trigger?: string } = {},
): Promise<{ ok: boolean; reason?: string; result?: CompactionResult }> {
  if (!isReactiveCompactEnabled()) {
    return { ok: false, reason: 'disabled' }
  }
  if (cacheSafeParams.toolUseContext.abortController.signal.aborted) {
    return { ok: false, reason: 'aborted' }
  }

  try {
    const result = await compactConversation(
      messages,
      cacheSafeParams.toolUseContext,
      cacheSafeParams,
      true,
      options.customInstructions,
      true,
      {
        isRecompactionInChain: false,
        turnsSincePreviousCompact: -1,
        autoCompactThreshold: -1,
        querySource: cacheSafeParams.toolUseContext.options.querySource,
      },
    )

    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(cacheSafeParams.toolUseContext.options.querySource)

    return { ok: true, result }
  } catch (error) {
    if (hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT)) {
      return { ok: false, reason: 'aborted' }
    }
    logError(error)
    return { ok: false, reason: 'error' }
  }
}

export async function tryReactiveCompact(params: {
  hasAttempted: boolean
  querySource: string
  aborted: boolean
  messages: Message[]
  cacheSafeParams: CacheSafeParams
}): Promise<CompactionResult | null> {
  if (
    params.hasAttempted ||
    params.aborted ||
    params.querySource === 'compact' ||
    params.querySource === 'session_memory' ||
    !isReactiveCompactEnabled()
  ) {
    return null
  }

  logForDebugging(
    `reactive-compact: starting after provider overflow querySource=${params.querySource} messages=${params.messages.length}`,
  )

  const outcome = await reactiveCompactOnPromptTooLong(
    params.messages,
    params.cacheSafeParams,
    { trigger: 'prompt_too_long' },
  )

  if (!outcome.ok || !outcome.result) {
    logForDebugging(
      `reactive-compact: skipped/failure reason=${outcome.reason ?? 'unknown'}`,
      { level: 'warn' },
    )
    return null
  }

  logForDebugging(
    `reactive-compact: succeeded querySource=${params.querySource} preTokens=${outcome.result.preCompactTokenCount ?? -1} postTokens=${outcome.result.truePostCompactTokenCount ?? outcome.result.postCompactTokenCount ?? -1}`,
  )

  return outcome.result
}
