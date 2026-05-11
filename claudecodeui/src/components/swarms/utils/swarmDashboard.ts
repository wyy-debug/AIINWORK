type SwarmTopologyEdgeLike = {
  from?: string;
  to?: string;
  topic?: string;
};

type SwarmTopologyLike = {
  type?: string;
  coordinatorRoleId?: string;
  edges?: SwarmTopologyEdgeLike[];
};

type SwarmAgentLike = {
  id?: string;
  roleId?: string;
  label?: string;
  status?: string;
  runtimeStatus?: string;
  taskId?: string;
  threadId?: string;
  transcriptSummary?: string;
  lastControl?: Record<string, unknown> | null;
  lastWaitResult?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

type SwarmMessageLike = {
  id?: string;
  runId?: string;
  fromAgentId?: string;
  toAgentId?: string;
  topic?: string;
  type?: string;
  payload?: Record<string, unknown>;
  status?: string;
  createdAt?: number;
  nextAttemptAt?: number | null;
  deliveryAttempts?: number;
  lastDeliveryError?: string;
};

type SwarmEventLike = {
  id?: string;
  runId?: string;
  agentId?: string;
  messageId?: string;
  type?: string;
  payload?: unknown;
  createdAt?: number;
};

type SwarmDeliveryTraceLike = {
  id?: string;
  agentId?: string;
  status?: string;
  error?: string;
  payload?: unknown;
  createdAt?: number;
};

type SwarmSnapshotLike = {
  id?: string;
  objective?: string;
  status?: string;
  runtimeMode?: string;
  runtimeStatus?: string;
  coordinatorSessionId?: string;
  topology?: SwarmTopologyLike | null;
  agents?: SwarmAgentLike[];
  messages?: SwarmMessageLike[];
  events?: SwarmEventLike[];
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function payloadMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  return normalizeText(record.message)
    || normalizeText(record.content)
    || normalizeText(record.objective)
    || normalizeText(record.summary);
}

function compactRoleLabel(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function timestampForAgent(agentId: string, events: SwarmEventLike[], fallback?: number): number | undefined {
  const matched = events.find((event) => normalizeText(event.agentId) === agentId && Number(event.createdAt));
  return matched?.createdAt || fallback;
}

function controlSummary(control?: Record<string, unknown> | null): string {
  if (!control) return '';
  return normalizeText(control.resultSummary)
    || normalizeText(control.summary)
    || normalizeText(control.error);
}

function resultTextForAgent(agent: SwarmAgentLike): string {
  const status = normalizeText(agent.status);
  return normalizeText(agent.transcriptSummary)
    || controlSummary(agent.lastWaitResult)
    || controlSummary(agent.lastControl)
    || (status === 'failed' || status === 'control_failed'
      ? '执行遇到阻塞，请查看事件日志。'
      : status === 'completed'
        ? '任务执行完成，结果已回传。'
        : '正在执行任务，等待结果回传。');
}

export function buildSwarmGraph(snapshot: SwarmSnapshotLike = {}) {
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
  const nodes = agents
    .map((agent) => ({
      id: normalizeText(agent.id),
      roleId: normalizeText(agent.roleId),
      label: normalizeText(agent.label) || normalizeText(agent.roleId) || normalizeText(agent.id),
      status: normalizeText(agent.status) || 'unknown',
    }))
    .filter((agent) => agent.id);
  const agentsByRole = new Map<string, string[]>();
  for (const node of nodes) {
    const current = agentsByRole.get(node.roleId) || [];
    agentsByRole.set(node.roleId, [...current, node.id]);
  }
  const edges = (Array.isArray(snapshot.topology?.edges) ? snapshot.topology!.edges! : [])
    .map((edge) => {
      const fromRoleId = normalizeText(edge.from);
      const toRoleId = normalizeText(edge.to);
      const topic = normalizeText(edge.topic) || `${fromRoleId}.${toRoleId}`;
      if (!fromRoleId || !toRoleId) return null;
      return {
        id: `${fromRoleId}:${toRoleId}:${topic}`,
        fromRoleId,
        toRoleId,
        topic,
        fromAgentIds: agentsByRole.get(fromRoleId) || [],
        toAgentIds: agentsByRole.get(toRoleId) || [],
      };
    })
    .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));
  return { nodes, edges };
}

export function buildSwarmCollaborationView(snapshot: SwarmSnapshotLike = {}) {
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const coordinatorRoleId = normalizeText(snapshot.topology?.coordinatorRoleId) || 'queen';
  const orchestratorAgent = agents.find((agent) => normalizeText(agent.roleId) === coordinatorRoleId) || agents[0] || {};
  const childAgents = agents.filter((agent) => normalizeText(agent.id) && normalizeText(agent.id) !== normalizeText(orchestratorAgent.id));
  const objective = normalizeText(snapshot.objective) || '等待用户发起多 Agent 协作任务。';

  const messageByTarget = new Map<string, SwarmMessageLike>();
  for (const message of messages) {
    const target = normalizeText(message.toAgentId);
    if (target && !messageByTarget.has(target)) {
      messageByTarget.set(target, message);
    }
  }

  const agentCards = childAgents.map((agent, index) => {
    const message = messageByTarget.get(normalizeText(agent.id));
    const label = normalizeText(agent.label) || compactRoleLabel(normalizeText(agent.roleId) || normalizeText(agent.id));
    const assigned = payloadMessage(message?.payload) || `执行 ${label} 的角色任务`;
    const status = normalizeText(agent.runtimeStatus) || normalizeText(agent.status) || 'queued';
    return {
      id: normalizeText(agent.id),
      roleId: normalizeText(agent.roleId),
      label,
      status,
      taskId: normalizeText(agent.taskId),
      threadId: normalizeText(agent.threadId),
      taskText: `收到任务：${assigned}`,
      resultTitle: status === 'failed' || status === 'control_failed'
        ? '执行需要处理'
        : status === 'running' || status === 'queued'
          ? '执行中'
          : '结果输出',
      resultText: resultTextForAgent(agent),
      receivedAt: message?.createdAt || timestampForAgent(normalizeText(agent.id), events),
      resultAt: timestampForAgent(normalizeText(agent.id), events, message?.createdAt),
      lane: {
        index,
        dispatchLabel: '任务分发',
        returnLabel: '结果回传',
      },
    };
  });

  const dispatchLines = agentCards.map((agent, index) => `${index + 1}. ${agent.label}: ${agent.taskText.replace(/^收到任务：/, '')}`);
  const completedCount = agentCards.filter((agent) => ['completed', 'acknowledged'].includes(agent.status)).length;
  const failedCount = agentCards.filter((agent) => ['failed', 'control_failed', 'degraded'].includes(agent.status)).length;
  const runningCount = agentCards.filter((agent) => ['running', 'queued'].includes(agent.status)).length;

  return {
    orchestrator: {
      id: normalizeText(orchestratorAgent.id) || 'orchestrator',
      roleId: normalizeText(orchestratorAgent.roleId) || coordinatorRoleId,
      label: normalizeText(orchestratorAgent.label) || '主Agent',
      status: normalizeText(orchestratorAgent.runtimeStatus) || normalizeText(orchestratorAgent.status) || normalizeText(snapshot.runtimeStatus) || 'idle',
      timeline: [
        { kind: 'user_request', title: '用户请求', content: objective },
        {
          kind: 'dispatch_plan',
          title: '主Agent',
          content: dispatchLines.length
            ? `我将分解任务并分发给各子Agent处理：\n${dispatchLines.join('\n')}`
            : '等待可调度的子Agent。',
        },
        {
          kind: 'dispatch_started',
          title: '主Agent',
          content: agentCards.length ? '任务已分发给各子Agent，请开始执行。' : '暂无子Agent可执行。',
        },
        {
          kind: 'summary',
          title: '主Agent',
          content: failedCount
            ? `已有 ${failedCount} 个子Agent需要处理，${completedCount} 个已完成，${runningCount} 个仍在执行。`
            : completedCount
              ? `已汇总子Agent执行结果：${completedCount} 个任务完成，系统稳定性提升。`
              : '正在等待子Agent结果回传。',
        },
      ],
    },
    agentCards,
  };
}

export function summarizeSwarmRun(snapshot: SwarmSnapshotLike = {}) {
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  return {
    runId: normalizeText(snapshot.id),
    status: normalizeText(snapshot.status) || 'unknown',
    runtimeMode: normalizeText(snapshot.runtimeMode) || 'local-control-plane',
    runtimeStatus: normalizeText(snapshot.runtimeStatus) || normalizeText(snapshot.status) || 'unknown',
    coordinatorSessionId: normalizeText(snapshot.coordinatorSessionId),
    agentCount: agents.length,
    runningAgents: agents.filter((agent) => normalizeText(agent.status) === 'running').length,
    degradedAgents: agents.filter((agent) => normalizeText(agent.status) === 'degraded' || normalizeText(agent.runtimeStatus) === 'degraded').length,
    completedAgents: agents.filter((agent) => normalizeText(agent.status) === 'completed').length,
    messageCount: messages.length,
    pendingMessages: messages.filter((message) => ['published', 'retry_scheduled', 'delivered'].includes(normalizeText(message.status))).length,
    retryScheduledMessages: messages.filter((message) => normalizeText(message.status) === 'retry_scheduled').length,
    deadLetteredMessages: messages.filter((message) => normalizeText(message.status) === 'dead_lettered').length,
    deliveryFailures: messages.filter((message) => normalizeText(message.lastDeliveryError)).length,
    controlFailures: (Array.isArray(snapshot.events) ? snapshot.events : [])
      .filter((event) => normalizeText(event.type) === 'swarm_agent_control_failed').length,
  };
}

export function filterSwarmEvents(events: SwarmEventLike[] = [], query = '') {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return events;
  return events.filter((event) => JSON.stringify(event).toLowerCase().includes(normalizedQuery));
}

export function summarizeMessageTrace(trace: SwarmDeliveryTraceLike[] = []) {
  const entries = Array.isArray(trace) ? trace : [];
  const deliveredAgents = Array.from(new Set(entries
    .filter((entry) => normalizeText(entry.status) === 'delivered')
    .map((entry) => normalizeText(entry.agentId))
    .filter(Boolean)));
  const last = entries[entries.length - 1] || {};
  const lastFailure = [...entries].reverse().find((entry) => normalizeText(entry.error));
  const retry = [...entries].reverse().find((entry) => normalizeText(entry.status) === 'retry_scheduled');
  return {
    attemptCount: entries.filter((entry) => normalizeText(entry.status) === 'failed').length,
    lastStatus: normalizeText(last.status) || 'unknown',
    lastError: normalizeText(lastFailure?.error),
    deliveredAgents,
    nextAttemptAt: retry?.createdAt ?? null,
  };
}
