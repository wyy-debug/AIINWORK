import { describe, expect, test } from 'bun:test'
import { SpawnAgentTool, inputSchema, outputSchema } from '../AgentTool.js'

const schemaText = (value: unknown) => JSON.stringify(value)

describe('spawn_agent Codex schema', () => {
  test('uses the Codex tool name without legacy callable aliases', () => {
    expect(SpawnAgentTool.name).toBe('spawn_agent')
    expect(SpawnAgentTool.aliases ?? []).toEqual([])
  })

  test('does not expose dispatch tickets or old Task/AgentSpawn parameters', () => {
    const text = schemaText(inputSchema())

    expect(text).toContain('message')
    expect(text).toContain('task_name')
    expect(text).toContain('agent_type')
    expect(text).toContain('fork_turns')
    expect(text).not.toContain('dispatch_ticket')
    expect(text).not.toContain('dispatchTicket')
    expect(text).not.toContain('subagent_type')
    expect(text).not.toContain('fork_context')
    expect(text).not.toContain('items')
    expect(text).not.toContain('run_in_background')
    expect(text).not.toContain('prompt')
    expect(text).not.toContain('team_name')
    expect(text).not.toContain('isolation')
    expect(text).not.toContain('cwd')
  })

  test('accepts Codex-style message and agent_type input', () => {
    const parsed = inputSchema().safeParse({
      message: 'Review the runtime permission changes and report risks.',
      task_name: 'runtime-review',
      agent_type: 'reviewer',
      fork_turns: 'all',
      model: 'gpt-5.2',
      reasoning_effort: 'high',
    })

    expect(parsed.success).toBe(true)
  })

  test('rejects fork_context and items from the old protocol', () => {
    expect(
      inputSchema().safeParse({
        message: 'Review the runtime permission changes.',
        task_name: 'runtime-review',
        fork_context: true,
      }).success,
    ).toBe(false)
    expect(
      inputSchema().safeParse({
        items: [{ type: 'text', text: 'Review the runtime permission changes.' }],
        task_name: 'runtime-review',
      }).success,
    ).toBe(false)
  })

  test('spawn output exposes Codex-style task_name and nickname only', () => {
    const text = schemaText(outputSchema())

    expect(text).toContain('task_name')
    expect(text).toContain('nickname')
    expect(text).not.toContain('agent_id')
    expect(text).not.toContain('agentId')
    expect(text).not.toContain('agentId')
    expect(text).not.toContain('outputFile')
    expect(text).not.toContain('target')
  })
})

