import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ResponseStreamEvent } from 'openai/resources/responses/responses.mjs'
import { randomUUID } from 'crypto'
import { getOpenAIExitToolResponse } from './requestBody.js'

export type OpenAIResponsesStreamDiagnostics = {
  rawEventTypes: string[]
  rawFunctionCallCount: number
  rawFunctionCallNames: string[]
  rawExitToolCallCount: number
  rawCompletedStatus?: string | null
}

export type OpenAIResponsesStreamAdapterOptions = {
  exitToolName?: string
  diagnostics?: OpenAIResponsesStreamDiagnostics
}

type FunctionBlock = {
  contentIndex: number
  id: string
  callId: string
  name: string
  arguments: string
}

function responseUsageToAnthropic(usage: any) {
  return {
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: usage?.input_tokens_details?.cached_tokens ?? 0,
  }
}

function getOutputItem(event: any) {
  return event?.item ?? null
}

function getFunctionCallName(item: any): string {
  return typeof item?.name === 'string' ? item.name : ''
}

function getFunctionCallId(item: any): string {
  return typeof item?.call_id === 'string' && item.call_id
    ? item.call_id
    : typeof item?.id === 'string' && item.id
      ? item.id
      : `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`
}

function getFunctionItemId(item: any, fallback: string): string {
  return typeof item?.id === 'string' && item.id ? item.id : fallback
}

export async function* adaptOpenAIResponsesStreamToAnthropic(
  stream: AsyncIterable<ResponseStreamEvent>,
  model: string,
  options: OpenAIResponsesStreamAdapterOptions = {},
): AsyncGenerator<BetaRawMessageStreamEvent, void> {
  const messageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  const exitToolName = options.exitToolName
  const diagnostics = options.diagnostics

  let started = false
  let currentContentIndex = -1
  let textBlockOpen = false
  let finalUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }

  const openBlockIndices = new Set<number>()
  const functionBlocks = new Map<number, FunctionBlock>()
  const exitToolIndices = new Set<number>()
  const exitToolArguments = new Map<number, string>()
  let sawRealToolCall = false
  let exitToolTextEmitted = false

  const ensureStarted = function* () {
    if (started) return
    started = true
    yield {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: finalUsage,
      },
    } as unknown as BetaRawMessageStreamEvent
  }

  const closeTextBlock = function* () {
    if (!textBlockOpen) return
    yield {
      type: 'content_block_stop',
      index: currentContentIndex,
    } as BetaRawMessageStreamEvent
    openBlockIndices.delete(currentContentIndex)
    textBlockOpen = false
  }

  const closeOpenBlocks = function* () {
    for (const index of Array.from(openBlockIndices).sort((a, b) => a - b)) {
      yield {
        type: 'content_block_stop',
        index,
      } as BetaRawMessageStreamEvent
      openBlockIndices.delete(index)
    }
    textBlockOpen = false
  }

  for await (const event of stream) {
    diagnostics?.rawEventTypes.push((event as any).type)
    for (const startEvent of ensureStarted()) yield startEvent

    switch ((event as any).type) {
      case 'response.output_text.delta': {
        const delta = (event as any).delta
        if (typeof delta !== 'string' || !delta) break
        if (!textBlockOpen) {
          currentContentIndex++
          textBlockOpen = true
          openBlockIndices.add(currentContentIndex)
          yield {
            type: 'content_block_start',
            index: currentContentIndex,
            content_block: {
              type: 'text',
              text: '',
            },
          } as BetaRawMessageStreamEvent
        }
        yield {
          type: 'content_block_delta',
          index: currentContentIndex,
          delta: {
            type: 'text_delta',
            text: delta,
          },
        } as BetaRawMessageStreamEvent
        break
      }
      case 'response.output_item.added': {
        const item = getOutputItem(event)
        if (item?.type !== 'function_call') break

        const outputIndex = (event as any).output_index ?? functionBlocks.size
        const name = getFunctionCallName(item)
        diagnostics && (diagnostics.rawFunctionCallCount += 1)
        if (name) diagnostics?.rawFunctionCallNames.push(name)

        if (exitToolName && name === exitToolName) {
          exitToolIndices.add(outputIndex)
          diagnostics && (diagnostics.rawExitToolCallCount += 1)
          if (typeof item.arguments === 'string' && item.arguments) {
            exitToolArguments.set(outputIndex, item.arguments)
          }
          break
        }

        for (const closeEvent of closeTextBlock()) yield closeEvent
        sawRealToolCall = true
        currentContentIndex++
        const callId = getFunctionCallId(item)
        const id = getFunctionItemId(item, callId)
        functionBlocks.set(outputIndex, {
          contentIndex: currentContentIndex,
          id,
          callId,
          name,
          arguments: '',
        })
        openBlockIndices.add(currentContentIndex)
        yield {
          type: 'content_block_start',
          index: currentContentIndex,
          content_block: {
            type: 'tool_use',
            id,
            name,
            input: {},
          },
        } as BetaRawMessageStreamEvent
        if (typeof item.arguments === 'string' && item.arguments) {
          functionBlocks.get(outputIndex)!.arguments += item.arguments
          yield {
            type: 'content_block_delta',
            index: currentContentIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: item.arguments,
            },
          } as BetaRawMessageStreamEvent
        }
        break
      }
      case 'response.function_call_arguments.delta': {
        const outputIndex = (event as any).output_index
        const delta = (event as any).delta
        if (typeof delta !== 'string' || !delta) break
        if (exitToolIndices.has(outputIndex)) {
          exitToolArguments.set(
            outputIndex,
            (exitToolArguments.get(outputIndex) ?? '') + delta,
          )
          break
        }
        const block = functionBlocks.get(outputIndex)
        if (!block) break
        block.arguments += delta
        yield {
          type: 'content_block_delta',
          index: block.contentIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: delta,
          },
        } as BetaRawMessageStreamEvent
        break
      }
      case 'response.function_call_arguments.done': {
        const outputIndex = (event as any).output_index
        const args = (event as any).arguments
        if (exitToolIndices.has(outputIndex)) {
          exitToolArguments.set(outputIndex, typeof args === 'string' ? args : '')
          break
        }
        const block = functionBlocks.get(outputIndex)
        if (block && typeof args === 'string' && !block.arguments) {
          block.arguments = args
          yield {
            type: 'content_block_delta',
            index: block.contentIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: args,
            },
          } as BetaRawMessageStreamEvent
        }
        break
      }
      case 'response.output_item.done': {
        const item = getOutputItem(event)
        if (item?.type !== 'function_call') break
        const outputIndex = (event as any).output_index
        if (exitToolIndices.has(outputIndex)) {
          if (typeof item.arguments === 'string' && item.arguments) {
            exitToolArguments.set(outputIndex, item.arguments)
          }
          break
        }
        const block = functionBlocks.get(outputIndex)
        if (block && typeof item.arguments === 'string' && !block.arguments) {
          block.arguments = item.arguments
          yield {
            type: 'content_block_delta',
            index: block.contentIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: item.arguments,
            },
          } as BetaRawMessageStreamEvent
        }
        break
      }
      case 'response.completed': {
        const response = (event as any).response
        diagnostics && (diagnostics.rawCompletedStatus = response?.status ?? null)
        finalUsage = responseUsageToAnthropic(response?.usage)
        break
      }
      case 'response.incomplete':
      case 'response.failed': {
        const response = (event as any).response
        diagnostics && (diagnostics.rawCompletedStatus = response?.status ?? null)
        finalUsage = responseUsageToAnthropic(response?.usage)
        break
      }
    }
  }

  for (const startEvent of ensureStarted()) yield startEvent

  if (!sawRealToolCall && !exitToolTextEmitted) {
    const exitResponse = Array.from(exitToolArguments.values())
      .map(args => getOpenAIExitToolResponse(args))
      .find(Boolean)
    if (exitResponse) {
      for (const closeEvent of closeTextBlock()) yield closeEvent
      currentContentIndex++
      textBlockOpen = true
      openBlockIndices.add(currentContentIndex)
      yield {
        type: 'content_block_start',
        index: currentContentIndex,
        content_block: {
          type: 'text',
          text: '',
        },
      } as BetaRawMessageStreamEvent
      yield {
        type: 'content_block_delta',
        index: currentContentIndex,
        delta: {
          type: 'text_delta',
          text: exitResponse,
        },
      } as BetaRawMessageStreamEvent
      exitToolTextEmitted = true
    }
  }

  for (const closeEvent of closeOpenBlocks()) yield closeEvent

  yield {
    type: 'message_delta',
    delta: {
      stop_reason: sawRealToolCall ? 'tool_use' : 'end_turn',
      stop_sequence: null,
    },
    usage: finalUsage,
  } as BetaRawMessageStreamEvent

  yield {
    type: 'message_stop',
  } as BetaRawMessageStreamEvent
}
