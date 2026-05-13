import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import type {
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  AssistantMessage,
  UserMessage,
} from '../../../types/message.js'
import type { AgentId } from '../../../types/ids.js'
import type { Tools } from '../../../Tool.js'
import type { Stream } from 'openai/streaming.mjs'
import type {
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions/completions.mjs'
import { getOpenAIClient } from './client.js'
import { anthropicMessagesToOpenAI, resolveOpenAIModel, adaptOpenAIStreamToAnthropic, anthropicToolsToOpenAI, anthropicToolChoiceToOpenAI } from '@ant/model-provider'
import { normalizeMessagesForAPI } from '../../../utils/messages.js'
import { toolToAPISchema } from '../../../utils/api.js'
import {
  getEmptyToolPermissionContext,
  toolMatchesName,
} from '../../../Tool.js'
import { logForDebugging } from '../../../utils/debug.js'
import { addToTotalSessionCost } from '../../../cost-tracker.js'
import { calculateUSDCost } from '../../../utils/modelCost.js'
import {
  isOpenAIThinkingEnabled,
  resolveOpenAIMaxTokens,
  buildOpenAIRequestBody,
  buildOpenAIResponsesRequestBody,
  resolveOpenAIReasoningEffort,
  withOpenAIExitTool,
  resolveOpenAIToolChoiceForRequest,
  getOpenAIExitToolResponse,
  OPENAI_EXIT_TOOL_NAME,
  withOpenAIToolModeSystemReminder,
} from './requestBody.js'
import { adaptOpenAIResponsesStreamToAnthropic } from './responsesAdapter.js'
import { recordLLMObservation } from '../../../services/langfuse/tracing.js'
import { convertMessagesToLangfuse, convertOutputToLangfuse, convertToolsToLangfuse } from '../../../services/langfuse/convert.js'
export {
  isOpenAIThinkingEnabled,
  resolveOpenAIMaxTokens,
  buildOpenAIRequestBody,
  buildOpenAIResponsesRequestBody,
  resolveOpenAIReasoningEffort,
  withOpenAIExitTool,
  resolveOpenAIToolChoiceForRequest,
  getOpenAIExitToolResponse,
  OPENAI_EXIT_TOOL_NAME,
  withOpenAIToolModeSystemReminder,
}
import { getModelMaxOutputTokens } from '../../../utils/context.js'
import type { Options } from '../claude.js'
import { randomUUID } from 'crypto'
import {
  createAssistantAPIErrorMessage,
  createUserMessage,
  normalizeContentFromAPI,
} from '../../../utils/messages.js'
import type { SDKAssistantMessageError } from '../../../entrypoints/agentSdkTypes.js'
import {
  isToolSearchEnabled,
  extractDiscoveredToolNames,
  isDeferredToolsDeltaEnabled,
} from '../../../utils/toolSearch.js'
import {
  formatDeferredToolLine,
  isDeferredTool,
  TOOL_SEARCH_TOOL_NAME,
} from '@mtl-code/builtin-tools/tools/ToolSearchTool/prompt.js'

/**
 * Mirrors the Anthropic request path's deferred-tool announcement for OpenAI.
 *
 * OpenAI-compatible endpoints cannot consume Anthropic's `defer_loading` or
 * `tool_reference` beta payloads directly, so the model needs the same textual
 * list of deferred MCP tool names that Anthropic receives before it can ask
 * ToolSearchTool to load their full schemas.
 */
function prependDeferredToolListIfNeeded(
  messages: (AssistantMessage | UserMessage)[],
  tools: Tools,
  deferredToolNames: Set<string>,
  useToolSearch: boolean,
): (AssistantMessage | UserMessage)[] {
  if (!useToolSearch || isDeferredToolsDeltaEnabled()) return messages

  const deferredToolList = tools
    .filter(tool => deferredToolNames.has(tool.name))
    .map(formatDeferredToolLine)
    .sort()
    .join('\n')

  if (!deferredToolList) return messages

  return [
    createUserMessage({
      content: `<available-deferred-tools>\n${deferredToolList}\n</available-deferred-tools>`,
      isMeta: true,
    }),
    ...messages,
  ]
}

function isOpenAIConvertibleMessage(msg: Message): msg is AssistantMessage | UserMessage {
  return msg.type === 'assistant' || msg.type === 'user'
}

function hasNativeToolLoopActivity(messages: Message[]): boolean {
  return messages.some(message => {
    const content = (message as { message?: { content?: unknown } }).message
      ?.content
    if (!Array.isArray(content)) return false

    return content.some(block => {
      if (!block || typeof block !== 'object') return false
      const type = (block as { type?: unknown }).type
      return (
        type === 'tool_use' ||
        type === 'tool_result' ||
        type === 'server_tool_use' ||
        type === 'mcp_tool_use' ||
        type === 'mcp_tool_result'
      )
    })
  })
}

const OPENAI_DEFAULT_CLI_PREFIX =
  `You are MTL-Code, Anthropic's official CLI for Claude.`
const OPENAI_AGENT_SDK_MTL_CODE_PRESET_PREFIX =
  `You are MTL-Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.`
const OPENAI_AGENT_SDK_PREFIX =
  `You are a Claude agent, built on Anthropic's Claude Agent SDK.`
const OPENAI_CLI_PREFIXES = new Set([
  OPENAI_DEFAULT_CLI_PREFIX,
  OPENAI_AGENT_SDK_MTL_CODE_PRESET_PREFIX,
  OPENAI_AGENT_SDK_PREFIX,
])

function getOpenAINativeCliPrefix(options: Options): string {
  if (!options.isNonInteractiveSession) return OPENAI_DEFAULT_CLI_PREFIX
  return options.hasAppendSystemPrompt
    ? OPENAI_AGENT_SDK_MTL_CODE_PRESET_PREFIX
    : OPENAI_AGENT_SDK_PREFIX
}

function withNativeCliSystemPromptPrefix(
  systemPrompt: SystemPrompt,
  options: Options,
): SystemPrompt {
  if (systemPrompt.some(part => OPENAI_CLI_PREFIXES.has(part))) {
    return systemPrompt
  }

  return [
    getOpenAINativeCliPrefix(options),
    ...systemPrompt,
  ].filter(Boolean) as unknown as SystemPrompt
}

function shouldPrintOpenAIToolDiagnostics(): boolean {
  const value =
    process.env.MTL_CODE_OPENAI_TOOL_DEBUG ?? process.env.ARGUS_DEBUG_PACKAGE
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function logOpenAIToolDiagnostics(details: Record<string, unknown>): void {
  const line = `[OpenAI:tools] ${JSON.stringify(details)}`
  logForDebugging(line)
  if (shouldPrintOpenAIToolDiagnostics()) {
    console.error(line)
  }
}

function logOpenAIStreamDiagnostics(details: Record<string, unknown>): void {
  const line = `[OpenAI:stream] ${JSON.stringify(details)}`
  logForDebugging(line)
  if (shouldPrintOpenAIToolDiagnostics()) {
    console.error(line)
  }
}

function resolveOpenAIProtocol(): 'chat-completions' | 'responses' {
  const value = String(process.env.MTL_CODE_OPENAI_PROTOCOL ?? '')
    .trim()
    .toLowerCase()
  return value === 'responses' || value === 'openai-responses'
    ? 'responses'
    : 'chat-completions'
}

/**
 * Assemble the final AssistantMessage (and optional max_tokens error) from
 * accumulated stream state. Extracted to avoid duplication between the
 * `message_stop` handler and the post-loop safety fallback.
 */
function assembleFinalAssistantOutputs(params: {
  partialMessage: any
  contentBlocks: Record<number, any>
  tools: Tools
  agentId: string | undefined
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }
  stopReason: string | null
  maxTokens: number
}): (AssistantMessage | SystemAPIErrorMessage)[] {
  const { partialMessage, contentBlocks, tools, agentId, usage, stopReason, maxTokens } = params
  const outputs: (AssistantMessage | SystemAPIErrorMessage)[] = []

  const allBlocks = Object.keys(contentBlocks)
    .sort((a, b) => Number(a) - Number(b))
    .map(k => contentBlocks[Number(k)])
    .filter(Boolean)

  if (allBlocks.length > 0) {
    outputs.push({
      message: {
        ...partialMessage,
        content: normalizeContentFromAPI(allBlocks, tools, agentId as AgentId | undefined),
        usage,
        stop_reason: stopReason,
        stop_sequence: null,
      },
      requestId: undefined,
      type: 'assistant',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
    } as AssistantMessage)
  }

  if (stopReason === 'max_tokens') {
    outputs.push(createAssistantAPIErrorMessage({
      content: `Output truncated: response exceeded the ${maxTokens} token limit. ` +
        `Set OPENAI_MAX_TOKENS or MTL_CODE_MAX_OUTPUT_TOKENS to override.`,
      apiError: 'max_output_tokens',
      error: 'max_output_tokens',
    }))
  }

  return outputs
}

/**
 * OpenAI-compatible query path. Converts Anthropic-format messages/tools to
 * OpenAI format, calls the OpenAI-compatible endpoint, and converts the
 * SSE stream back to Anthropic BetaRawMessageStreamEvent for consumption
 * by the existing query pipeline.
 */
export async function* queryModelOpenAI(
  messages: Message[],
  systemPrompt: SystemPrompt,
  tools: Tools,
  signal: AbortSignal,
  options: Options,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  try {
    // 1. Resolve model name
    const openaiModel = resolveOpenAIModel(options.model)

    // 2. Normalize messages using shared preprocessing
    const messagesForAPI = normalizeMessagesForAPI(messages, tools)
    const finalSystemPrompt = withNativeCliSystemPromptPrefix(
      systemPrompt,
      options,
    )

    // 3. Check if tool search is enabled (similar to Anthropic path)
    const useToolSearch = await isToolSearchEnabled(
      options.model,
      tools,
      options.getToolPermissionContext ||
        (async () => getEmptyToolPermissionContext()),
      options.agents || [],
      options.querySource,
    )

    // 4. Build deferred tools set (similar to Anthropic path)
    const deferredToolNames = new Set<string>()
    if (useToolSearch) {
      for (const t of tools) {
        if (isDeferredTool(t)) deferredToolNames.add(t.name)
      }
    }

    // 5. Filter tools (similar to Anthropic path)
    let filteredTools = tools
    if (useToolSearch && deferredToolNames.size > 0) {
      const discoveredToolNames = extractDiscoveredToolNames(messages)

      filteredTools = tools.filter(tool => {
        // Always include non-deferred tools
        if (!deferredToolNames.has(tool.name)) return true
        // Always include ToolSearchTool (so it can discover more tools)
        if (toolMatchesName(tool, TOOL_SEARCH_TOOL_NAME)) return true
        // Only include deferred tools that have been discovered
        return discoveredToolNames.has(tool.name)
      })
    }

    // 6. Build tool schemas with deferLoading flag
    const toolSchemas = await Promise.all(
      filteredTools.map(tool =>
        toolToAPISchema(tool, {
          getToolPermissionContext: options.getToolPermissionContext,
          tools,
          agents: options.agents,
          allowedAgentTypes: options.allowedAgentTypes,
          model: options.model,
          deferLoading: useToolSearch && deferredToolNames.has(tool.name),
        }),
      ),
    )

    // 7. Filter out non-standard tools (server tools like advisor)
    const standardTools = toolSchemas.filter(
      (t): t is BetaToolUnion & { type: string } => {
        const anyT = t as unknown as Record<string, unknown>
        return (
          anyT.type !== 'advisor_20260301' && anyT.type !== 'computer_20250124'
        )
      },
    )

    // 8. Convert messages and tools to OpenAI format
    const enableThinking = isOpenAIThinkingEnabled(openaiModel)
    const reasoningEffort = resolveOpenAIReasoningEffort(
      openaiModel,
      options.effortValue,
    )
    const openAIConvertibleMessages = messagesForAPI.filter(isOpenAIConvertibleMessage)
    const messagesWithDeferredToolList = prependDeferredToolListIfNeeded(
      openAIConvertibleMessages,
      tools,
      deferredToolNames,
      useToolSearch,
    )
    const openaiMessages = anthropicMessagesToOpenAI(
      messagesWithDeferredToolList,
      finalSystemPrompt,
      { enableThinking },
    )
    const baseOpenAITools = anthropicToolsToOpenAI(standardTools)
    const requestedOpenAIToolChoice = anthropicToolChoiceToOpenAI(options.toolChoice)
    const nativeToolLoopActivity = hasNativeToolLoopActivity(messagesForAPI)
    const shouldForceRequiredToolChoice =
      baseOpenAITools.length > 0 &&
      !nativeToolLoopActivity &&
      (requestedOpenAIToolChoice === undefined ||
        requestedOpenAIToolChoice === 'auto')
    const shouldAttachExitTool =
      shouldForceRequiredToolChoice || requestedOpenAIToolChoice === 'required'
    const openaiTools = shouldAttachExitTool
      ? withOpenAIExitTool(baseOpenAITools)
      : baseOpenAITools
    const openaiToolChoice = resolveOpenAIToolChoiceForRequest(
      requestedOpenAIToolChoice,
      shouldForceRequiredToolChoice ? openaiTools : [],
    )
    const forcedToolChoice =
      openaiTools.length > 0 &&
      (requestedOpenAIToolChoice === undefined ||
        requestedOpenAIToolChoice === 'auto') &&
      openaiToolChoice === 'required'

    // 9. Prepare tool filtering details for debug logs.
    const includedDeferredTools = filteredTools.filter(t =>
      deferredToolNames.has(t.name),
    ).length

    // 10. Compute max_tokens — required by most OpenAI-compatible endpoints.
    //     Without this the server uses a tiny default, and when
    //     thinking is enabled the thinking phase consumes the entire budget
    //     leaving no tokens for the final response.
    //
    //     Use upperLimit (not the slot-cap default) because the Anthropic path's
    //     slot-reservation cap (CAPPED_DEFAULT_MAX_TOKENS=8k) is paired with an
    //     auto-retry at 64k in query.ts. The OpenAI path has no such retry, so
    //     using the capped 8k default would silently truncate responses in
    //     multi-turn conversations where thinking consumes most of the budget.
    //
    //     Override priority:
    //     1. options.maxOutputTokensOverride (programmatic)
    //     2. OPENAI_MAX_TOKENS env var (OpenAI-specific, useful for local models
    //        with small context windows, e.g. RTX 3060 12GB running 65536-token models)
    //     3. MTL_CODE_MAX_OUTPUT_TOKENS env var (generic override)
    //     4. upperLimit default (64000)
    const { upperLimit } = getModelMaxOutputTokens(openaiModel)
    const maxTokens = resolveOpenAIMaxTokens(upperLimit, options.maxOutputTokensOverride)

    // 11. Get client
    const client = getOpenAIClient({
      maxRetries: 0,
      fetchOverride: options.fetchOverride as unknown as typeof fetch,
      source: options.querySource,
    })

    logForDebugging(
      `[OpenAI] Calling model=${openaiModel}, messages=${openaiMessages.length}, tools=${openaiTools.length}, thinking=${enableThinking}, reasoningEffort=${reasoningEffort ?? 'none'}`,
    )

    // 12. Call OpenAI API with streaming
    const requestMessages = openaiToolChoice === 'required'
      ? withOpenAIToolModeSystemReminder(openaiMessages, openaiTools)
      : openaiMessages
    const openAIProtocol = resolveOpenAIProtocol()
    const chatRequestBody = buildOpenAIRequestBody({
      model: openaiModel,
      messages: requestMessages,
      tools: openaiTools,
      toolChoice: openaiToolChoice,
      enableThinking,
      maxTokens,
      reasoningEffort,
      temperatureOverride: options.temperatureOverride,
    })
    logOpenAIToolDiagnostics({
      apiMode: openAIProtocol,
      model: openaiModel,
      toolSearchEnabled: useToolSearch,
      rawToolCount: tools.length,
      deferredToolCount: deferredToolNames.size,
      includedDeferredToolCount: includedDeferredTools,
      filteredToolCount: filteredTools.length,
      standardToolCount: standardTools.length,
      openaiToolCount: openaiTools.length,
      exitToolEnabled: openaiTools.length > baseOpenAITools.length,
      forcedToolChoice,
      toolChoice: openaiToolChoice ?? 'auto',
      tokenLimitParam: openAIProtocol === 'responses'
        ? 'max_output_tokens'
        : 'max_completion_tokens' in chatRequestBody
        ? 'max_completion_tokens'
        : 'max_tokens',
      reasoningEffort: reasoningEffort ?? null,
      systemPromptParts: finalSystemPrompt.length,
      toolModeSystemReminder: requestMessages.length > openaiMessages.length,
      nativeToolLoopActivity,
      toolNames: openaiTools
        .slice(0, 40)
        .map(tool => (tool as { function?: { name?: string } }).function?.name)
        .filter(Boolean),
    })
    const openaiStreamDiagnostics = {
      rawFinishReasons: [] as string[],
      rawToolCallCount: 0,
      rawToolCallNames: [] as string[],
      rawExitToolCallCount: 0,
    }
    const openaiResponsesStreamDiagnostics = {
      rawEventTypes: [] as string[],
      rawFunctionCallCount: 0,
      rawFunctionCallNames: [] as string[],
      rawExitToolCallCount: 0,
      rawCompletedStatus: undefined as string | null | undefined,
    }
    const adaptedStream = openAIProtocol === 'responses'
      ? adaptOpenAIResponsesStreamToAnthropic(
          await client.responses.create(
            buildOpenAIResponsesRequestBody({
              model: openaiModel,
              messages: requestMessages,
              tools: openaiTools,
              toolChoice: openaiToolChoice,
              maxTokens,
              reasoningEffort,
              temperatureOverride: options.temperatureOverride,
            }),
            { signal },
          ),
          openaiModel,
          {
            exitToolName: OPENAI_EXIT_TOOL_NAME,
            diagnostics: openaiResponsesStreamDiagnostics,
          },
        )
      : adaptOpenAIStreamToAnthropic(
          await client.chat.completions.create(
            chatRequestBody,
            { signal },
          ),
          openaiModel,
          {
            exitToolName: OPENAI_EXIT_TOOL_NAME,
            diagnostics: openaiStreamDiagnostics,
          },
        )

    // 12. Convert OpenAI stream to Anthropic events, then process into
    //     AssistantMessage + StreamEvent (matching the Anthropic path behavior)
    // Accumulate content blocks and usage, same as the Anthropic path in claude.ts
    const contentBlocks: Record<number, any> = {}
    const collectedMessages: AssistantMessage[] = []
    let partialMessage: any
    let stopReason: string | null = null
    let usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    let ttftMs = 0
    const start = Date.now()

    for await (const event of adaptedStream) {
      switch (event.type) {
        case 'message_start': {
          partialMessage = (event as any).message
          ttftMs = Date.now() - start
          if ((event as any).message?.usage) {
            usage = {
              ...usage,
              ...(event as any).message.usage,
            }
          }
          break
        }
        case 'content_block_start': {
          const idx = (event as any).index
          const cb = (event as any).content_block
          if (cb.type === 'tool_use') {
            contentBlocks[idx] = { ...cb, input: '' }
          } else if (cb.type === 'text') {
            contentBlocks[idx] = { ...cb, text: '' }
          } else if (cb.type === 'thinking') {
            contentBlocks[idx] = { ...cb, thinking: '', signature: '' }
          } else {
            contentBlocks[idx] = { ...cb }
          }
          break
        }
        case 'content_block_delta': {
          const idx = (event as any).index
          const delta = (event as any).delta
          const block = contentBlocks[idx]
          if (!block) break
          if (delta.type === 'text_delta') {
            block.text = (block.text || '') + delta.text
          } else if (delta.type === 'input_json_delta') {
            block.input = (block.input || '') + delta.partial_json
          } else if (delta.type === 'thinking_delta') {
            block.thinking = (block.thinking || '') + delta.thinking
          } else if (delta.type === 'signature_delta') {
            block.signature = delta.signature
          }
          break
        }
        case 'content_block_stop': {
          // Block accumulation is complete; assembly happens at message_stop.
          break
        }
        case 'message_delta': {
          const deltaUsage = (event as any).usage
          if (deltaUsage) {
            usage = { ...usage, ...deltaUsage }
          }
          const delta = (event as any).delta
          if (delta?.stop_reason != null) {
            stopReason = delta.stop_reason
          }
          break
        }
        case 'message_stop': {
          // Assemble ONE AssistantMessage with ALL content blocks, matching the
          // Anthropic SDK path. Real usage (input + output tokens) is available
          // here and injected so tokenCountWithEstimation() can read it.
          if (partialMessage) {
            for (const output of assembleFinalAssistantOutputs({
              partialMessage, contentBlocks, tools, agentId: options.agentId,
              usage, stopReason, maxTokens,
            })) {
              if (output.type === 'assistant') {
                collectedMessages.push(output)
              }
              yield output
            }
            // Reset partialMessage so the post-loop safety fallback does not
            // yield a second identical AssistantMessage.
            partialMessage = null
          }
          // Track cost and token usage
          if (usage.input_tokens + usage.output_tokens > 0) {
            const costUSD = calculateUSDCost(openaiModel, usage as any)
            addToTotalSessionCost(costUSD, usage as any, options.model)
          }
          break
        }
      }

      // Also yield as StreamEvent for real-time display (matching Anthropic path)
      yield {
        type: 'stream_event',
        event,
        ...(event.type === 'message_start' ? { ttftMs } : undefined),
      } as StreamEvent
    }

    if (openAIProtocol === 'responses') {
      const requiredIgnored =
        openaiTools.length > 0 &&
        openaiToolChoice === 'required' &&
        openaiResponsesStreamDiagnostics.rawFunctionCallCount === 0
      logOpenAIStreamDiagnostics({
        apiMode: openAIProtocol,
        model: openaiModel,
        forcedToolChoice,
        toolChoice: openaiToolChoice ?? 'auto',
        rawEventTypes: openaiResponsesStreamDiagnostics.rawEventTypes,
        rawCompletedStatus: openaiResponsesStreamDiagnostics.rawCompletedStatus ?? null,
        rawFunctionCallCount: openaiResponsesStreamDiagnostics.rawFunctionCallCount,
        rawFunctionCallNames: openaiResponsesStreamDiagnostics.rawFunctionCallNames,
        rawExitToolCallCount: openaiResponsesStreamDiagnostics.rawExitToolCallCount,
        requiredIgnored,
      })
    } else {
      const rawFinalFinishReason =
        openaiStreamDiagnostics.rawFinishReasons.at(-1) ?? null
      const requiredIgnored =
        openaiTools.length > 0 &&
        openaiToolChoice === 'required' &&
        openaiStreamDiagnostics.rawToolCallCount === 0
      logOpenAIStreamDiagnostics({
        apiMode: openAIProtocol,
        model: openaiModel,
        forcedToolChoice,
        toolChoice: openaiToolChoice ?? 'auto',
        rawFinishReasons: openaiStreamDiagnostics.rawFinishReasons,
        rawFinalFinishReason,
        rawToolCallCount: openaiStreamDiagnostics.rawToolCallCount,
        rawToolCallNames: openaiStreamDiagnostics.rawToolCallNames,
        rawExitToolCallCount: openaiStreamDiagnostics.rawExitToolCallCount,
        requiredIgnored,
      })
    }

    // Record LLM observation in Langfuse (no-op if not configured)
    recordLLMObservation(options.langfuseTrace ?? null, {
      model: openaiModel,
      provider: 'openai',
      input: convertMessagesToLangfuse(openaiMessages),
      output: convertOutputToLangfuse(collectedMessages),
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
      },
      startTime: new Date(start),
      endTime: new Date(),
      completionStartTime: ttftMs > 0 ? new Date(start + ttftMs) : undefined,
      tools: convertToolsToLangfuse(toolSchemas as unknown[]),
    })

    // Safety: if stream ended without message_stop, assemble and yield whatever we have
    if (partialMessage) {
      for (const output of assembleFinalAssistantOutputs({
        partialMessage, contentBlocks, tools, agentId: options.agentId,
        usage, stopReason, maxTokens,
      })) {
        yield output
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logForDebugging(`[OpenAI] Error: ${errorMessage}`, { level: 'error' })
    yield createAssistantAPIErrorMessage({
      content: `API Error: ${errorMessage}`,
      apiError: 'api_error',
      error: (error instanceof Error ? error : new Error(String(error))) as unknown as SDKAssistantMessageError,
    })
  }
}
