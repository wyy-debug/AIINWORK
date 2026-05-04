import { describe, expect, test } from 'bun:test'
import {
  appendSubagentContinuationContract,
  createSubagentRuntimeGuard,
  formatBlockedSubagentResult,
  resolveSubagentMaxTurns,
} from '../subagentRuntimeGuard.js'

function assistantTool(id: string, name: string, input: unknown): any {
  return {
    type: 'assistant',
    uuid: `assistant-${id}`,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input }],
    },
  }
}

function assistantTools(...tools: Array<{ id: string; name: string; input: unknown }>): any {
  return {
    type: 'assistant',
    uuid: `assistant-${tools.map(tool => tool.id).join('-')}`,
    message: {
      role: 'assistant',
      content: tools.map(tool => ({
        type: 'tool_use',
        id: tool.id,
        name: tool.name,
        input: tool.input,
      })),
    },
  }
}

function assistantText(text: string): any {
  return {
    type: 'assistant',
    uuid: 'assistant-text',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  }
}

function toolResult(id: string, content: unknown, isError = false): any {
  return {
    type: 'user',
    uuid: `user-${id}`,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }],
    },
  }
}

describe('subagentRuntimeGuard', () => {
  test('caps maxTurns at strict default 15', () => {
    expect(resolveSubagentMaxTurns()).toBe(15)
    expect(resolveSubagentMaxTurns(30)).toBe(15)
    expect(resolveSubagentMaxTurns(undefined, 30)).toBe(15)
    expect(resolveSubagentMaxTurns(3, 30)).toBe(3)
    expect(resolveSubagentMaxTurns(12, 5)).toBe(5)
  })

  test('blocks repeated identical tool calls', () => {
    const guard = createSubagentRuntimeGuard({ objective: 'read file', maxSteps: 15 })
    expect(guard.observeMessage(assistantTool('a', 'Read', { file_path: 'a.ts' })).shouldStop).toBe(false)
    expect(guard.observeMessage(toolResult('a', 'export const a = 1')).shouldStop).toBe(false)
    const pending = guard.observeMessage(assistantTool('b', 'Read', { file_path: 'a.ts' }))
    expect(pending.shouldStop).toBe(false)
    const result = guard.observeMessage(toolResult('b', 'export const a = 1'))
    expect(result.shouldStop).toBe(true)
    expect(result.snapshot.runtimeStatus).toBe('BLOCKED')
    expect(result.snapshot.stopReason).toContain('Repeated')
  })

  test('waits for tool_result before stopping at the hard step budget', () => {
    const guard = createSubagentRuntimeGuard({ objective: 'single step', maxSteps: 1 })
    const pending = guard.observeMessage(assistantTool('a', 'Read', { file_path: 'a.ts' }))
    expect(pending.shouldStop).toBe(false)
    const result = guard.observeMessage(toolResult('a', 'export const a = 1'))
    expect(result.shouldStop).toBe(true)
    expect(result.snapshot.runtimeStatus).toBe('BLOCKED')
    expect(result.snapshot.stopReason).toContain('hard budget')
  })

  test('waits for all parallel tool_results before stopping', () => {
    const guard = createSubagentRuntimeGuard({ objective: 'parallel', maxSteps: 2 })
    const pending = guard.observeMessage(assistantTools(
      { id: 'a', name: 'Read', input: { file_path: 'a.ts' } },
      { id: 'b', name: 'Read', input: { file_path: 'b.ts' } },
    ))
    expect(pending.shouldStop).toBe(false)
    expect(guard.observeMessage(toolResult('a', 'export const a = 1')).shouldStop).toBe(false)
    const result = guard.observeMessage(toolResult('b', 'export const b = 1'))
    expect(result.shouldStop).toBe(true)
    expect(result.snapshot.stopReason).toContain('hard budget')
  })

  test('blocks two empty tool results', () => {
    const guard = createSubagentRuntimeGuard({ objective: 'search', maxSteps: 15 })
    guard.observeMessage(assistantTool('a', 'Grep', { pattern: 'x' }))
    expect(guard.observeMessage(toolResult('a', 'No matches')).shouldStop).toBe(false)
    guard.observeMessage(assistantTool('b', 'Grep', { pattern: 'y' }))
    const result = guard.observeMessage(toolResult('b', '[]'))
    expect(result.shouldStop).toBe(true)
    expect(result.snapshot.runtimeStatus).toBe('BLOCKED')
  })

  test('blocks repeated visits to the same URL without progress', () => {
    const guard = createSubagentRuntimeGuard({ objective: 'fetch crash page', maxSteps: 15 })
    guard.observeMessage(assistantTool('a', 'WebFetch', { url: 'https://example.com/crash?id=1' }))
    expect(guard.observeMessage(toolResult('a', 'login required')).shouldStop).toBe(false)
    const pending = guard.observeMessage(assistantTool('b', 'Browser', { url: 'https://example.com/crash?id=1' }))
    expect(pending.shouldStop).toBe(false)
    const result = guard.observeMessage(toolResult('b', 'login required'))
    expect(result.shouldStop).toBe(true)
    expect(result.snapshot.runtimeStatus).toBe('BLOCKED')
    expect(result.snapshot.stopReason).toContain('same URL')
  })

  test('does not block normal different tool calls with useful results', () => {
    const guard = createSubagentRuntimeGuard({ objective: 'inspect', maxSteps: 15 })
    guard.observeMessage(assistantTool('a', 'Read', { file_path: 'a.ts' }))
    guard.observeMessage(toolResult('a', 'export const a = 1'))
    const result = guard.observeMessage(assistantTool('b', 'Read', { file_path: 'b.ts' }))
    expect(result.shouldStop).toBe(false)
    expect(result.snapshot.runtimeStatus).toBe('RUNNING')
  })

  test('recognizes structured DONE without creating a guard reason', () => {
    const guard = createSubagentRuntimeGuard({ objective: 'finish', maxSteps: 15 })
    const result = guard.observeMessage(assistantText('### STATUS\nDONE\n\n### SUMMARY\nok'))
    expect(result.shouldStop).toBe(true)
    expect(result.snapshot.runtimeStatus).toBe('DONE')
    expect(result.snapshot.stopReason).toBeUndefined()
  })

  test('formats blocked protocol and appends continuation contract', () => {
    const guard = createSubagentRuntimeGuard({ objective: 'budget', maxSteps: 1 })
    const snapshot = guard.markBudgetReached(1)
    expect(formatBlockedSubagentResult(snapshot)).toContain('### STATUS\nBLOCKED')
    const continued = appendSubagentContinuationContract('进度如何')
    expect(continued).toContain('### STATUS')
    expect(continued).toContain('NEED_PARENT_INPUT')
  })
})
