import { describe, expect, it } from 'vitest';

import {
  buildSwarmCollaborationView,
  buildSwarmGraph,
  filterSwarmEvents,
  summarizeMessageTrace,
  summarizeSwarmRun,
} from './swarmDashboard';

describe('swarmDashboard utilities', () => {
  it('builds stable graph nodes and edges from a swarm run snapshot', () => {
    const graph = buildSwarmGraph({
      id: 'run-1',
      topology: { type: 'queen', edges: [{ from: 'queen', to: 'reviewer', topic: 'review.assignments' }] },
      agents: [
        { id: 'agent-queen', roleId: 'queen', label: 'Queen', status: 'running' },
        { id: 'agent-reviewer', roleId: 'reviewer', label: 'Reviewer', status: 'running' },
      ],
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(['agent-queen', 'agent-reviewer']);
    expect(graph.edges).toEqual([
      {
        id: 'queen:reviewer:review.assignments',
        fromRoleId: 'queen',
        toRoleId: 'reviewer',
        topic: 'review.assignments',
        fromAgentIds: ['agent-queen'],
        toAgentIds: ['agent-reviewer'],
      },
    ]);
  });

  it('filters events and summarizes active counts without overflowing unknown data', () => {
    const snapshot = {
      id: 'run-1',
      status: 'running',
      runtimeMode: 'coordinator-subagents',
      runtimeStatus: 'degraded',
      coordinatorSessionId: 'coordinator-session',
      agents: [
        { id: 'a', roleId: 'queen', status: 'running' },
        { id: 'b', roleId: 'reviewer', status: 'degraded', runtimeStatus: 'degraded' },
      ],
      messages: [
        { id: 'm1', status: 'retry_scheduled', nextAttemptAt: 3000, deliveryAttempts: 1 },
        { id: 'm2', status: 'dead_lettered', lastDeliveryError: 'network' },
      ],
      events: [
        { id: 'e1', type: 'swarm_agent_started', payload: { roleId: 'queen' } },
        { id: 'e2', type: 'swarm_message_dead_lettered', payload: { error: 'network' } },
        { id: 'e3', type: 'swarm_agent_control_failed', payload: { error: 'inactive' } },
      ],
    };

    expect(summarizeSwarmRun(snapshot)).toMatchObject({
      runtimeMode: 'coordinator-subagents',
      runtimeStatus: 'degraded',
      coordinatorSessionId: 'coordinator-session',
      agentCount: 2,
      runningAgents: 1,
      degradedAgents: 1,
      messageCount: 2,
      pendingMessages: 1,
      retryScheduledMessages: 1,
      deadLetteredMessages: 1,
      controlFailures: 1,
    });
    expect(filterSwarmEvents(snapshot.events, 'network').map((event) => event.id)).toEqual(['e2']);
  });

  it('summarizes message traces for inspector panels', () => {
    const trace = summarizeMessageTrace([
      { status: 'published', createdAt: 1000 },
      { status: 'delivered', agentId: 'agent-1', createdAt: 1100 },
      { status: 'failed', error: 'offline', createdAt: 1200 },
      { status: 'retry_scheduled', createdAt: 3000 },
    ]);

    expect(trace).toEqual({
      attemptCount: 1,
      lastStatus: 'retry_scheduled',
      lastError: 'offline',
      deliveredAgents: ['agent-1'],
      nextAttemptAt: 3000,
    });
  });

  it('projects a run into an orchestrator conversation and child agent cards', () => {
    const view = buildSwarmCollaborationView({
      id: 'run-1',
      objective: '排查支付接口超时问题，并优化系统稳定性。',
      topology: {
        type: 'queen',
        coordinatorRoleId: 'queen',
        edges: [
          { from: 'queen', to: 'code-agent', topic: 'debug.assignments' },
          { from: 'code-agent', to: 'queen', topic: 'debug.findings' },
        ],
      },
      agents: [
        { id: 'agent-queen', roleId: 'queen', label: '主Agent', status: 'running' },
        {
          id: 'agent-code',
          roleId: 'code-agent',
          label: '代码Agent',
          status: 'completed',
          taskId: 'task-code',
          transcriptSummary: '已定位到异常模块：第三方支付网关超时。',
        },
      ],
      messages: [
        {
          id: 'm1',
          runId: 'run-1',
          fromAgentId: 'agent-queen',
          toAgentId: 'agent-code',
          topic: 'debug.assignments',
          type: 'assignment',
          status: 'acknowledged',
          payload: { message: '排查支付接口超时的原因' },
          createdAt: 1000,
        },
      ],
      events: [
        { id: 'e1', runId: 'run-1', agentId: 'agent-code', type: 'swarm_agent_started', createdAt: 2000 },
      ],
    });

    expect(view.orchestrator.label).toBe('主Agent');
    expect(view.orchestrator.timeline.map((item) => item.kind)).toEqual(['user_request', 'dispatch_plan', 'dispatch_started', 'summary']);
    expect(view.agentCards).toHaveLength(1);
    expect(view.agentCards[0]).toMatchObject({
      id: 'agent-code',
      label: '代码Agent',
      taskText: '收到任务：排查支付接口超时的原因',
      resultText: '已定位到异常模块：第三方支付网关超时。',
      lane: {
        dispatchLabel: '任务分发',
        returnLabel: '结果回传',
      },
    });
  });
});
