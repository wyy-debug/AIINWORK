import { afterEach, describe, expect, test } from 'bun:test'
import {
  parseToolPreset,
  filterToolsByDenyRules,
  getAllBaseTools,
  getTools,
} from '../tools'
import { getEmptyToolPermissionContext } from '../Tool'

const CODEX_SUBAGENT_TOOL_NAMES = [
  'spawn_agent',
  'list_agents',
  'wait_agent',
  'close_agent',
  'send_input',
  'resume_agent',
]

const LEGACY_SUBAGENT_TOOL_NAMES = [
  'Agent',
  'AgentSpawn',
  'AgentDispatchPlan',
  'AgentList',
  'AgentWait',
  'AgentResult',
  'AgentCancel',
  'AgentSendInput',
  'AgentResume',
  'Task',
]

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('parseToolPreset', () => {
  test('returns "default" for "default" input', () => {
    expect(parseToolPreset('default')).toBe('default')
  })

  test('returns "default" for "Default" input (case-insensitive)', () => {
    expect(parseToolPreset('Default')).toBe('default')
  })

  test('returns null for unknown preset', () => {
    expect(parseToolPreset('unknown')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(parseToolPreset('')).toBeNull()
  })

  test('returns null for random string', () => {
    expect(parseToolPreset('custom-preset')).toBeNull()
  })
})

// ─── filterToolsByDenyRules ─────────────────────────────────────────────

describe('filterToolsByDenyRules', () => {
  const mockTools = [
    { name: 'Bash', mcpInfo: undefined },
    { name: 'Read', mcpInfo: undefined },
    { name: 'Write', mcpInfo: undefined },
    {
      name: 'mcp__server__tool',
      mcpInfo: { serverName: 'server', toolName: 'tool' },
    },
  ]

  test('returns all tools when no deny rules', () => {
    const ctx = getEmptyToolPermissionContext()
    const result = filterToolsByDenyRules(mockTools, ctx)
    expect(result).toHaveLength(4)
  })

  test('filters out denied tool by name', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        localSettings: ['Bash'],
      },
    }
    const result = filterToolsByDenyRules(mockTools, ctx as any)
    expect(result.find(t => t.name === 'Bash')).toBeUndefined()
    expect(result).toHaveLength(3)
  })

  test('filters out multiple denied tools', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        localSettings: ['Bash', 'Write'],
      },
    }
    const result = filterToolsByDenyRules(mockTools, ctx as any)
    expect(result).toHaveLength(2)
    expect(result.map(t => t.name)).toEqual(['Read', 'mcp__server__tool'])
  })

  test('returns empty array when all tools denied', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        localSettings: mockTools.map(t => t.name),
      },
    }
    const result = filterToolsByDenyRules(mockTools, ctx as any)
    expect(result).toHaveLength(0)
  })

  test('handles empty tools array', () => {
    const ctx = getEmptyToolPermissionContext()
    expect(filterToolsByDenyRules([], ctx)).toEqual([])
  })
})

describe('subagent publishing gate', () => {
  test('does not expose subagent tools by default', () => {
    delete process.env.MTL_CODE_SUBAGENTS_ENABLED

    const baseToolNames = getAllBaseTools().map(tool => tool.name)
    const enabledToolNames = getTools(getEmptyToolPermissionContext()).map(
      tool => tool.name,
    )

    for (const toolName of [...CODEX_SUBAGENT_TOOL_NAMES, ...LEGACY_SUBAGENT_TOOL_NAMES]) {
      expect(baseToolNames).not.toContain(toolName)
      expect(enabledToolNames).not.toContain(toolName)
    }
  })

  test('exposes only Codex-style collaborative agent tools when enabled', () => {
    process.env.MTL_CODE_SUBAGENTS_ENABLED = '1'

    const baseToolNames = getAllBaseTools().map(tool => tool.name)
    const enabledToolNames = getTools(getEmptyToolPermissionContext()).map(
      tool => tool.name,
    )

    for (const toolName of CODEX_SUBAGENT_TOOL_NAMES) {
      expect(baseToolNames).toContain(toolName)
      expect(enabledToolNames).toContain(toolName)
    }

    for (const toolName of LEGACY_SUBAGENT_TOOL_NAMES) {
      expect(baseToolNames).not.toContain(toolName)
      expect(enabledToolNames).not.toContain(toolName)
    }
  })
})
