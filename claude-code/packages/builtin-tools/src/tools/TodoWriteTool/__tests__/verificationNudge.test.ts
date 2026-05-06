import { describe, expect, test } from 'bun:test'
import { TodoWriteTool } from '../TodoWriteTool.js'
import { TaskUpdateTool } from '../../TaskUpdateTool/TaskUpdateTool.js'

function getText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const content = (result as { content?: unknown }).content
  return typeof content === 'string' ? content : JSON.stringify(content)
}

describe('verification nudges do not self-authorize subagents', () => {
  test('TodoWrite verification nudge does not instruct spawn_agent', () => {
    const result = TodoWriteTool.mapToolResultToToolResultBlockParam(
      {
        oldTodos: [],
        newTodos: [],
        verificationNudgeNeeded: true,
      },
      'tool-use-1',
    )

    const text = getText(result)
    expect(text).toContain('verification')
    expect(text).not.toContain('spawn_agent')
    expect(text).not.toContain('agent_type')
  })

  test('TaskUpdate verification nudge does not instruct spawn_agent', () => {
    const result = TaskUpdateTool.mapToolResultToToolResultBlockParam(
      {
        success: true,
        taskId: 'task-1',
        updatedFields: ['status'],
        statusChange: { from: 'in_progress', to: 'completed' },
        verificationNudgeNeeded: true,
      },
      'tool-use-2',
    )

    const text = getText(result)
    expect(text).toContain('verification')
    expect(text).not.toContain('spawn_agent')
    expect(text).not.toContain('agent_type')
  })
})
