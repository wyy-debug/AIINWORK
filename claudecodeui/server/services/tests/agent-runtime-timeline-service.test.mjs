import { describe, expect, it } from 'vitest';

import {
  aggregateAgentRuntimeTimeline,
  redactSensitive,
} from '../agent-runtime-timeline-service.js';

describe('agent-runtime-timeline-service', () => {
  it('aggregates tool, permission, token, subagent, checkpoint, and workflow events', () => {
    const timeline = aggregateAgentRuntimeTimeline({
      sessionId: 's-1',
      provider: 'claude',
      messages: [
        { id: 'm1', kind: 'text', role: 'user', content: 'fix the bug', timestamp: '2026-05-18T01:00:00.000Z' },
        { id: 'm2', kind: 'tool_use', toolName: 'Bash', toolId: 't1', toolInput: { command: 'npm test' }, timestamp: '2026-05-18T01:00:01.000Z' },
        { id: 'm3', kind: 'tool_result', toolId: 't1', toolResult: { content: 'failed', isError: true }, timestamp: '2026-05-18T01:00:02.000Z' },
        { id: 'm4', kind: 'permission_request', requestId: 'p1', toolName: 'Edit', input: { file_path: 'a.ts' }, timestamp: '2026-05-18T01:00:03.000Z' },
        { id: 'm5', kind: 'status', status: 'token_budget', tokenBudget: { used: 10 }, timestamp: '2026-05-18T01:00:04.000Z' },
        { id: 'm6', kind: 'status', subagentSnapshot: { active: 1 }, timestamp: '2026-05-18T01:00:05.000Z' },
      ],
      checkpoints: [
        { id: 'c1', sessionId: 's-1', phase: 'after', rollbackAvailable: true, hasChanges: true, createdAt: '2026-05-18T01:00:06.000Z' },
      ],
      workflowEvents: [
        {
          id: 'wf1',
          type: 'workflow_node_waiting_approval',
          title: 'Workflow node waiting approval',
          status: 'blocked',
          severity: 'warning',
          workflowId: 'delivery-review',
          workflowName: 'Delivery Review',
          runId: 'run-1',
          nodeId: 'approval',
          timestamp: '2026-05-18T01:00:07.000Z',
        },
      ],
    });

    expect(timeline.summary).toMatchObject({
      total: 8,
      tools: 2,
      failures: 1,
      permissionBlocks: 2,
      checkpoints: 1,
      subagents: 1,
      workflows: 1,
    });
    expect(timeline.events.map((event) => event.type)).toContain('tool_failed');
    expect(timeline.events.map((event) => event.type)).toContain('permission_blocked');
    expect(timeline.events.map((event) => event.type)).toContain('checkpoint');
    expect(timeline.events.map((event) => event.category)).toContain('workflow');
  });

  it('redacts sensitive fields in event details', () => {
    const timeline = aggregateAgentRuntimeTimeline({
      sessionId: 's-2',
      messages: [
        {
          id: 'm1',
          kind: 'tool_use',
          toolName: 'Redmine',
          toolInput: {
            REDMINE_TOKEN: 'secret-token',
            nested: { authorization: 'Bearer hidden', query: 'BUG-1' },
          },
        },
      ],
    });

    expect(timeline.events[0].details.input.REDMINE_TOKEN).toBe('[REDACTED]');
    expect(timeline.events[0].details.input.nested.authorization).toBe('[REDACTED]');
    expect(timeline.events[0].details.input.nested.query).toBe('BUG-1');
    expect(redactSensitive({ apiKey: 'abc' }).apiKey).toBe('[REDACTED]');
  });
});
