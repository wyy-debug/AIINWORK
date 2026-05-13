import { describe, expect, test } from 'bun:test'
import { adaptOpenAIResponsesStreamToAnthropic } from '../responsesAdapter.js'

function mockStream(events: any[]): AsyncIterable<any> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        async next() {
          if (i >= events.length) return { done: true, value: undefined }
          return { done: false, value: events[i++] }
        },
      }
    },
  }
}

async function collectEvents(events: any[], options?: any) {
  const output: any[] = []
  for await (const event of adaptOpenAIResponsesStreamToAnthropic(
    mockStream(events),
    'gpt-5.5',
    options,
  )) {
    output.push(event)
  }
  return output
}

describe('adaptOpenAIResponsesStreamToAnthropic', () => {
  test('converts Responses text deltas to Anthropic text blocks', async () => {
    const events = await collectEvents([
      {
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 0,
        item_id: 'msg_1',
        delta: 'hello',
        sequence_number: 1,
      },
      {
        type: 'response.completed',
        sequence_number: 2,
        response: {
          status: 'completed',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            input_tokens_details: { cached_tokens: 2 },
          },
        },
      },
    ])

    expect(events[0].type).toBe('message_start')
    expect(events.some(e => e.type === 'content_block_start' && e.content_block.type === 'text')).toBe(true)
    expect(events.find(e => e.type === 'content_block_delta')?.delta.text).toBe('hello')
    expect(events.find(e => e.type === 'message_delta')?.delta.stop_reason).toBe('end_turn')
    expect(events.find(e => e.type === 'message_delta')?.usage).toMatchObject({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 2,
    })
  })

  test('converts Responses function calls to Anthropic tool_use blocks', async () => {
    const diagnostics = {
      rawEventTypes: [] as string[],
      rawFunctionCallCount: 0,
      rawFunctionCallNames: [] as string[],
      rawExitToolCallCount: 0,
    }
    const events = await collectEvents([
      {
        type: 'response.output_item.added',
        output_index: 0,
        sequence_number: 1,
        item: {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'Read',
          arguments: '',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        item_id: 'fc_1',
        delta: '{"file_path":"',
        sequence_number: 2,
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        item_id: 'fc_1',
        delta: 'README.md"}',
        sequence_number: 3,
      },
      {
        type: 'response.completed',
        sequence_number: 4,
        response: {
          status: 'completed',
          usage: { input_tokens: 1, output_tokens: 2, input_tokens_details: { cached_tokens: 0 } },
        },
      },
    ], { exitToolName: 'ExitTool', diagnostics })

    const blockStart = events.find(e => e.type === 'content_block_start') as any
    expect(blockStart.content_block.type).toBe('tool_use')
    expect(blockStart.content_block.name).toBe('Read')
    expect(events.find(e => e.type === 'message_delta')?.delta.stop_reason).toBe('tool_use')
    expect(diagnostics).toMatchObject({
      rawFunctionCallCount: 1,
      rawFunctionCallNames: ['Read'],
      rawExitToolCallCount: 0,
      rawCompletedStatus: 'completed',
    })
  })

  test('converts ExitTool function call response into text', async () => {
    const diagnostics = {
      rawEventTypes: [] as string[],
      rawFunctionCallCount: 0,
      rawFunctionCallNames: [] as string[],
      rawExitToolCallCount: 0,
    }
    const events = await collectEvents([
      {
        type: 'response.output_item.added',
        output_index: 0,
        sequence_number: 1,
        item: {
          type: 'function_call',
          id: 'fc_exit',
          call_id: 'call_exit',
          name: 'ExitTool',
          arguments: '',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        item_id: 'fc_exit',
        delta: '{"response":"direct answer"}',
        sequence_number: 2,
      },
      {
        type: 'response.completed',
        sequence_number: 3,
        response: {
          status: 'completed',
          usage: { input_tokens: 1, output_tokens: 2, input_tokens_details: { cached_tokens: 0 } },
        },
      },
    ], { exitToolName: 'ExitTool', diagnostics })

    expect(events.some(e => e.type === 'content_block_start' && e.content_block.type === 'tool_use')).toBe(false)
    expect(events.find(e => e.type === 'content_block_delta')?.delta.text).toBe('direct answer')
    expect(events.find(e => e.type === 'message_delta')?.delta.stop_reason).toBe('end_turn')
    expect(diagnostics).toMatchObject({
      rawFunctionCallCount: 1,
      rawFunctionCallNames: ['ExitTool'],
      rawExitToolCallCount: 1,
    })
  })
})
