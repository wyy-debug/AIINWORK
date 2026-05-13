/**
 * Pure utility functions for building OpenAI request bodies and detecting
 * thinking mode. Extracted from index.ts so tests can import them without
 * triggering heavy module side-effects (OpenAI client, stream adapter, etc.).
 */
import type {
  ChatCompletionTool,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions/completions.mjs'
import type {
  FunctionTool,
  ResponseCreateParamsStreaming,
  ResponseInputItem,
} from 'openai/resources/responses/responses.mjs'
import { isEnvTruthy, isEnvDefinedFalsy } from '../../../utils/envUtils.js'

export const OPENAI_EXIT_TOOL_NAME = 'ExitTool'
export const OPENAI_TOOL_MODE_SYSTEM_REMINDER =
  'Tool mode is active. Use the available tools proactively when they can help answer the user accurately, especially for repository, file, shell, MCP, or runtime questions. If no available tool is appropriate, call ExitTool and put the final user-facing answer in its response field. Do not answer in plain text instead of making this tool decision.'

export function buildOpenAIExitTool(): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: OPENAI_EXIT_TOOL_NAME,
      description:
        'Exit tool mode when no available tool is useful. Use this only when you can answer directly without repository, file, shell, MCP, or other tool context. Put the final user-facing answer in response.',
      parameters: {
        type: 'object',
        required: ['response'],
        properties: {
          response: {
            type: 'string',
            description:
              'The final answer to show to the user when no tool call is needed.',
          },
          reason: {
            type: 'string',
            description:
              'Brief reason why no available tool is needed for this request.',
          },
        },
        additionalProperties: false,
      },
    },
  }
}

export function withOpenAIExitTool(
  tools: ChatCompletionTool[],
): ChatCompletionTool[] {
  if (tools.length === 0) return tools
  if (
    tools.some(
      tool =>
        tool.type === 'function' &&
        tool.function?.name === OPENAI_EXIT_TOOL_NAME,
    )
  ) {
    return tools
  }
  return [...tools, buildOpenAIExitTool()]
}

export function resolveOpenAIToolChoiceForRequest(
  toolChoice: unknown,
  tools: ChatCompletionTool[],
): unknown {
  if (tools.length === 0) return toolChoice
  return toolChoice === undefined || toolChoice === 'auto'
    ? 'required'
    : toolChoice
}

export function withOpenAIToolModeSystemReminder(
  messages: any[],
  tools: ChatCompletionTool[],
): any[] {
  if (tools.length === 0) return messages
  if (
    messages.some(
      message =>
        message?.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.includes('Tool mode is active'),
    )
  ) {
    return messages
  }
  return [
    ...messages,
    {
      role: 'system',
      content: OPENAI_TOOL_MODE_SYSTEM_REMINDER,
    },
  ]
}

export function getOpenAIExitToolResponse(input: unknown): string | undefined {
  let parsed = input
  if (typeof input === 'string') {
    try {
      parsed = input.trim() ? JSON.parse(input) : {}
    } catch {
      return undefined
    }
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  const response = (parsed as { response?: unknown }).response
  return typeof response === 'string' && response.trim()
    ? response
    : undefined
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content == null ? '' : String(content)
  return content
    .map(item => {
      if (typeof item === 'string') return item
      if (typeof item?.text === 'string') return item.text
      if (typeof item?.content === 'string') return item.content
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function openAIChatMessagesToResponsesInstructions(
  messages: any[],
): string | undefined {
  const instructions = messages
    .filter(message => message?.role === 'system' || message?.role === 'developer')
    .map(message => contentToText(message.content).trim())
    .filter(Boolean)
    .join('\n\n')
  return instructions || undefined
}

export function openAIChatToolsToResponsesTools(
  tools: ChatCompletionTool[],
): FunctionTool[] {
  return tools
    .map(tool => (tool as any).function)
    .filter(fn => fn?.name)
    .map(fn => ({
      type: 'function',
      name: fn.name,
      description: fn.description ?? null,
      parameters: fn.parameters ?? { type: 'object', properties: {} },
      strict: null,
    }))
}

export function openAIChatMessagesToResponsesInput(
  messages: any[],
): ResponseInputItem[] {
  const input: ResponseInputItem[] = []

  for (const message of messages) {
    const role = message?.role
    if (role === 'system' || role === 'developer') {
      continue
    }

    if (role === 'user') {
      input.push({
        type: 'message',
        role,
        content: [
          {
            type: 'input_text',
            text: contentToText(message.content),
          },
        ],
      } as ResponseInputItem)
      continue
    }

    if (role === 'assistant') {
      const text = contentToText(message.content)
      if (text) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: text,
        } as ResponseInputItem)
      }
      if (Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          input.push({
            type: 'function_call',
            call_id: toolCall.id,
            name: toolCall.function?.name ?? '',
            arguments: toolCall.function?.arguments ?? '{}',
          } as ResponseInputItem)
        }
      }
      continue
    }

    if (role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: contentToText(message.content),
      } as ResponseInputItem)
    }
  }

  return input
}

export function buildOpenAIResponsesRequestBody(params: {
  model: string
  messages: any[]
  tools: ChatCompletionTool[]
  toolChoice: any
  maxTokens: number
  reasoningEffort?: OpenAIReasoningEffort
  temperatureOverride?: number
}): ResponseCreateParamsStreaming {
  const {
    model,
    messages,
    tools,
    toolChoice,
    maxTokens,
    reasoningEffort,
    temperatureOverride,
  } = params
  return {
    model,
    input: openAIChatMessagesToResponsesInput(messages),
    ...(openAIChatMessagesToResponsesInstructions(messages) && {
      instructions: openAIChatMessagesToResponsesInstructions(messages),
    }),
    max_output_tokens: maxTokens,
    ...(reasoningEffort && reasoningEffort !== 'none' && {
      reasoning: { effort: reasoningEffort === 'xhigh' ? 'high' : reasoningEffort },
    }),
    ...(tools.length > 0 && {
      tools: openAIChatToolsToResponsesTools(tools),
      tool_choice: toolChoice ?? 'auto',
    }),
    stream: true,
    ...(temperatureOverride !== undefined && {
      temperature: temperatureOverride,
    }),
  } as ResponseCreateParamsStreaming
}

/**
 * Detect whether DeepSeek-style thinking mode should be enabled.
 *
 * Enabled when:
 * 1. OPENAI_ENABLE_THINKING=1 is set (explicit enable), OR
 * 2. Model name contains "deepseek-reasoner" OR "DeepSeek-V3.2" (auto-detect, case-insensitive)
 *
 * Disabled when:
 * - OPENAI_ENABLE_THINKING=0/false/no/off is explicitly set (overrides model detection)
 *
 * @param model - The resolved OpenAI model name
 */
export function isOpenAIThinkingEnabled(model: string): boolean {
  // Explicit disable takes priority (overrides model auto-detect)
  if (isEnvDefinedFalsy(process.env.OPENAI_ENABLE_THINKING)) return false
  // Explicit enable
  if (isEnvTruthy(process.env.OPENAI_ENABLE_THINKING)) return true
  // Auto-detect from model name (all DeepSeek models support thinking mode)
  const modelLower = model.toLowerCase()
  return modelLower.includes('deepseek')
}

/**
 * Resolve max output tokens for the OpenAI-compatible path.
 *
 * Override priority:
 * 1. maxOutputTokensOverride (programmatic, from query pipeline)
 * 2. OPENAI_MAX_TOKENS env var (OpenAI-specific, useful for local models
 *    with small context windows, e.g. RTX 3060 12GB running 65536-token models)
 * 3. MTL_CODE_MAX_OUTPUT_TOKENS env var (generic override)
 * 4. upperLimit default (64000)
 */
export function resolveOpenAIMaxTokens(
  upperLimit: number,
  maxOutputTokensOverride?: number,
): number {
  return maxOutputTokensOverride
    ?? (process.env.OPENAI_MAX_TOKENS ? parseInt(process.env.OPENAI_MAX_TOKENS, 10) || undefined : undefined)
    ?? (process.env.MTL_CODE_MAX_OUTPUT_TOKENS ? parseInt(process.env.MTL_CODE_MAX_OUTPUT_TOKENS, 10) || undefined : undefined)
    ?? upperLimit
}

function shouldUseMaxCompletionTokens(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return /^(gpt-5|o[134](?:-|$))/.test(normalized)
}

type OpenAIReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'

function isOpenAIReasoningChatModel(model: string): boolean {
  return shouldUseMaxCompletionTokens(model)
}

function normalizeOpenAIReasoningEffort(
  value: unknown,
): OpenAIReasoningEffort | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'auto' || normalized === 'unset') return undefined
  if (normalized === 'max') return 'high'
  if (
    normalized === 'none' ||
    normalized === 'minimal' ||
    normalized === 'low' ||
    normalized === 'medium' ||
    normalized === 'high' ||
    normalized === 'xhigh'
  ) {
    return normalized
  }
  return undefined
}

export function resolveOpenAIReasoningEffort(
  model: string,
  effortValue?: unknown,
): OpenAIReasoningEffort | undefined {
  const explicitOpenAI = normalizeOpenAIReasoningEffort(
    process.env.OPENAI_REASONING_EFFORT,
  )
  if (explicitOpenAI) return explicitOpenAI
  if (!isOpenAIReasoningChatModel(model)) return undefined

  return normalizeOpenAIReasoningEffort(
    process.env.MTL_CODE_EFFORT_LEVEL ??
      process.env.CLAUDE_CODE_EFFORT_LEVEL ??
      effortValue,
  ) ?? 'medium'
}

/**
 * Build the request body for OpenAI chat.completions.create().
 * Extracted for testability — the thinking mode params are injected here.
 *
 * DeepSeek thinking mode: inject thinking params via request body.
 * Two formats are added simultaneously to support different deployments:
 * - Official DeepSeek API: `thinking: { type: 'enabled' }`
 * - Self-hosted DeepSeek-V3.2: `enable_thinking: true` + `chat_template_kwargs: { thinking: true }`
 * OpenAI SDK passes unknown keys through to the HTTP body.
 * Each endpoint will use the format it recognizes and ignore the others.
 */
export function buildOpenAIRequestBody(params: {
  model: string
  messages: any[]
  tools: any[]
  toolChoice: any
  enableThinking: boolean
  maxTokens: number
  reasoningEffort?: OpenAIReasoningEffort
  temperatureOverride?: number
}): ChatCompletionCreateParamsStreaming & {
  thinking?: { type: string }
  enable_thinking?: boolean
  chat_template_kwargs?: { thinking: boolean }
  reasoning_effort?: OpenAIReasoningEffort
} {
  const {
    model,
    messages,
    tools,
    toolChoice,
    enableThinking,
    maxTokens,
    reasoningEffort,
    temperatureOverride,
  } = params
  const tokenLimit = shouldUseMaxCompletionTokens(model)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens }
  return {
    model,
    messages,
    ...tokenLimit,
    ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
    ...(tools.length > 0 && {
      tools,
      tool_choice: toolChoice ?? 'auto',
    }),
    stream: true,
    stream_options: { include_usage: true },
    // DeepSeek thinking mode: enable chain-of-thought output.
    // When active, temperature/top_p/presence_penalty/frequency_penalty are ignored by DeepSeek.
    ...(enableThinking && {
      // Official DeepSeek API format
      thinking: { type: 'enabled' },
      // Self-hosted DeepSeek-V3.2 format
      enable_thinking: true,
      chat_template_kwargs: { thinking: true },
    }),
    // Only send temperature when thinking mode is off (DeepSeek ignores it anyway,
    // but other providers may respect it)
    ...(!enableThinking && temperatureOverride !== undefined && {
      temperature: temperatureOverride,
    }),
  }
}
