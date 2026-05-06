import { beforeEach, describe, expect, test } from 'bun:test'
import {
  clearSubagentRegistryForTests,
  closeSubagentSubtree,
  listSubagentRecords,
  registerSubagentRecord,
} from '../subagentRegistry.js'

beforeEach(() => {
  clearSubagentRegistryForTests()
})

describe('subagent thread graph', () => {
  test('records parent-child thread graph metadata at spawn time', () => {
    const record = registerSubagentRecord({
      taskId: 'agent-review',
      agentId: 'agent-review',
      agentPath: '/root/review_migration',
      parentAgentPath: '/root',
      parentThreadId: 'parent-thread',
      sessionId: 'child-thread',
      objective: 'Review the migration',
      role: 'reviewer',
      depth: 1,
      agentNickname: 'migration-review',
    })

    expect(record.agentPath).toBe('/root/review_migration')
    expect(record.parentAgentPath).toBe('/root')
    expect(record.threadId).toBe('child-thread')
    expect(record.parentThreadId).toBe('parent-thread')
    expect(record.depth).toBe(1)
    expect(record.agentNickname).toBe('migration-review')
    expect(record.graphStatus).toBe('open')
    expect(record.source).toBe('thread_spawn')
  })

  test('closeSubagentSubtree closes descendants and releases running slots', () => {
    registerSubagentRecord({
      taskId: 'agent-parent',
      agentId: 'agent-parent',
      agentPath: '/root/a',
      parentAgentPath: '/root',
      parentThreadId: 'root-thread',
      sessionId: 'parent-thread',
      objective: 'Parent agent',
      depth: 1,
    })
    registerSubagentRecord({
      taskId: 'agent-child',
      agentId: 'agent-child',
      agentPath: '/root/a/child',
      parentAgentPath: '/root/a',
      parentThreadId: 'parent-thread',
      sessionId: 'child-thread',
      objective: 'Child agent',
      depth: 2,
    })

    registerSubagentRecord({
      taskId: 'agent-aa',
      agentId: 'agent-aa',
      agentPath: '/root/aa',
      parentAgentPath: '/root',
      parentThreadId: 'root-thread',
      sessionId: 'aa-thread',
      objective: 'Sibling prefix agent',
      depth: 1,
    })

    const closed = closeSubagentSubtree('/root/a', 'Closed by parent.')
    const running = listSubagentRecords({ runningOnly: true })

    expect(closed.map(record => record.taskId).sort()).toEqual([
      'agent-child',
      'agent-parent',
    ])
    expect(closed.every(record => record.graphStatus === 'closed')).toBe(true)
    expect(running.map(record => record.agentPath)).toEqual(['/root/aa'])
  })
})
