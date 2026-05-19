const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|cookie|credential|password|secret|token)/i;
const MAX_TEXT_LENGTH = 320;
const MAX_DETAIL_DEPTH = 5;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeTimestamp(value, fallbackDate = new Date(0)) {
  const date = value ? new Date(value) : fallbackDate;
  if (Number.isNaN(date.getTime())) return fallbackDate.toISOString();
  return date.toISOString();
}

function truncateText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function redactSensitive(value, depth = 0) {
  if (depth > MAX_DETAIL_DEPTH) return '[MaxDepth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (/-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(value)) return '[REDACTED]';
    return truncateText(value, 1200);
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 60).map((item) => redactSensitive(item, depth + 1));
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactSensitive(entry, depth + 1);
    }
  }
  return result;
}

function messageTimestamp(message, index) {
  return normalizeTimestamp(
    message.timestamp || message.createdAt || message.time,
    new Date(index),
  );
}

function toolResultText(message) {
  if (typeof message.toolResult?.content === 'string') return message.toolResult.content;
  if (typeof message.output === 'string') return message.output;
  if (typeof message.content === 'string') return message.content;
  return '';
}

function isPermissionBlockedMessage(message) {
  const text = [
    message.status,
    message.text,
    message.content,
    message.reason,
    message.error,
  ].filter(Boolean).join(' ');
  return /permission|blocked|denied|required/i.test(text);
}

function createMessageEvent(message, index, context) {
  const kind = normalizeString(message.kind || message.type, 'status');
  const timestamp = messageTimestamp(message, index);
  const base = {
    id: `${kind}:${message.id || message.toolId || message.toolCallId || message.requestId || index}`,
    sessionId: context.sessionId,
    provider: message.provider || context.provider,
    timestamp,
    sourceMessageId: message.id || null,
  };

  if ((kind === 'text' || kind === 'user') && message.role === 'user') {
    return {
      ...base,
      type: 'user_request',
      category: 'request',
      status: 'info',
      severity: 'info',
      title: 'User request',
      summary: truncateText(message.content || message.message?.content || ''),
      details: {},
    };
  }

  if (kind === 'thinking') {
    return {
      ...base,
      type: 'model_thinking',
      category: 'model',
      status: 'running',
      severity: 'info',
      title: 'Model thinking',
      summary: truncateText(message.content || ''),
      details: {},
    };
  }

  if (kind === 'tool_use') {
    return {
      ...base,
      type: 'tool_started',
      category: 'tool',
      status: 'running',
      severity: 'info',
      title: `Tool started: ${message.toolName || 'unknown'}`,
      summary: message.toolName || 'Tool call',
      details: redactSensitive({
        toolName: message.toolName,
        toolId: message.toolId || message.toolCallId,
        input: message.toolInput,
      }),
    };
  }

  if (kind === 'tool_result') {
    const isError = Boolean(message.isError || message.toolResult?.isError);
    return {
      ...base,
      type: isError ? 'tool_failed' : 'tool_completed',
      category: 'tool',
      status: isError ? 'error' : 'success',
      severity: isError ? 'error' : 'info',
      title: isError ? 'Tool failed' : 'Tool completed',
      summary: truncateText(toolResultText(message)),
      details: redactSensitive({
        toolId: message.toolId || message.toolCallId,
        result: toolResultText(message),
      }),
    };
  }

  if (kind === 'permission_request') {
    return {
      ...base,
      type: 'permission_blocked',
      category: 'permission',
      status: 'blocked',
      severity: 'warning',
      title: `Permission required: ${message.toolName || 'tool'}`,
      summary: truncateText(message.reason || message.content || 'Waiting for permission decision'),
      details: redactSensitive({
        requestId: message.requestId,
        toolName: message.toolName,
        input: message.input,
      }),
    };
  }

  if (kind === 'permission_cancelled') {
    return {
      ...base,
      type: 'permission_cancelled',
      category: 'permission',
      status: 'warning',
      severity: 'warning',
      title: 'Permission cancelled',
      summary: truncateText(message.reason || 'Permission request was cancelled'),
      details: redactSensitive({ requestId: message.requestId, reason: message.reason }),
    };
  }

  if (kind === 'error' || message.isError || isPermissionBlockedMessage(message)) {
    return {
      ...base,
      type: isPermissionBlockedMessage(message) ? 'permission_blocked' : 'runtime_error',
      category: isPermissionBlockedMessage(message) ? 'permission' : 'runtime',
      status: isPermissionBlockedMessage(message) ? 'blocked' : 'error',
      severity: isPermissionBlockedMessage(message) ? 'warning' : 'error',
      title: isPermissionBlockedMessage(message) ? 'Permission blocked' : 'Runtime error',
      summary: truncateText(message.content || message.text || message.error || ''),
      details: redactSensitive(asObject(message)),
    };
  }

  if (kind === 'status' && (message.status || message.text) === 'token_budget') {
    return {
      ...base,
      type: 'token_budget',
      category: 'model',
      status: 'info',
      severity: 'info',
      title: 'Token budget updated',
      summary: 'Context and token budget refreshed',
      details: redactSensitive({
        contextBudget: message.contextBudget,
        tokenBudget: message.tokenBudget,
      }),
    };
  }

  if (kind === 'status' && /^checkpoint_/.test(String(message.status || ''))) {
    return {
      ...base,
      type: 'checkpoint',
      category: 'checkpoint',
      status: String(message.status).includes('failed') ? 'error' : 'success',
      severity: String(message.status).includes('failed') ? 'error' : 'info',
      title: 'Checkpoint event',
      summary: truncateText(message.content || message.text || message.status),
      details: redactSensitive({ checkpoint: message.checkpoint }),
      refs: message.checkpoint?.id ? { checkpointId: message.checkpoint.id } : {},
    };
  }

  if (message.subagentRuntime || message.subagentSnapshot || message.subagentEvents || message.subagentRecord) {
    return {
      ...base,
      type: 'subagent_status',
      category: 'subagent',
      status: 'info',
      severity: 'info',
      title: 'Subagent update',
      summary: truncateText(message.summary || message.content || message.text || 'Subagent runtime changed'),
      details: redactSensitive({
        runtime: message.subagentRuntime,
        snapshot: message.subagentSnapshot,
        events: message.subagentEvents,
        record: message.subagentRecord,
      }),
    };
  }

  if (kind === 'complete' || message.isFinal) {
    return {
      ...base,
      type: 'agent_completed',
      category: 'runtime',
      status: 'success',
      severity: 'info',
      title: 'Agent completed',
      summary: truncateText(message.summary || message.content || 'Run completed'),
      details: redactSensitive({ exitCode: message.exitCode, usage: message.usage }),
    };
  }

  return null;
}

function createCheckpointEvent(checkpoint, index, context) {
  const phase = checkpoint.phase || 'checkpoint';
  return {
    id: `checkpoint:${checkpoint.id || index}`,
    sessionId: checkpoint.sessionId || context.sessionId,
    provider: checkpoint.provider || context.provider,
    timestamp: normalizeTimestamp(checkpoint.createdAt, new Date(index)),
    type: 'checkpoint',
    category: 'checkpoint',
    status: checkpoint.rollbackAvailable ? 'success' : 'warning',
    severity: checkpoint.rollbackAvailable ? 'info' : 'warning',
    title: `${phase === 'after' ? 'After' : 'Before'} checkpoint`,
    summary: `${checkpoint.hasChanges ? 'Workspace changes captured' : 'Workspace clean'}${checkpoint.branch ? ` on ${checkpoint.branch}` : ''}`,
    details: redactSensitive({
      id: checkpoint.id,
      phase: checkpoint.phase,
      beforeCheckpointId: checkpoint.beforeCheckpointId,
      profileKind: checkpoint.profileKind,
      permissionPreset: checkpoint.permissionPreset,
      branch: checkpoint.branch,
      headSha: checkpoint.headSha,
      rollbackAvailable: checkpoint.rollbackAvailable,
      hasChanges: checkpoint.hasChanges,
      status: checkpoint.status,
    }),
    refs: { checkpointId: checkpoint.id },
  };
}

function buildSummary(events) {
  return {
    total: events.length,
    tools: events.filter((event) => event.category === 'tool').length,
    failures: events.filter((event) => event.status === 'error').length,
    permissionBlocks: events.filter((event) => event.category === 'permission').length,
    checkpoints: events.filter((event) => event.category === 'checkpoint').length,
    subagents: events.filter((event) => event.category === 'subagent').length,
  };
}

export function aggregateAgentRuntimeTimeline({
  sessionId,
  provider = 'claude',
  messages = [],
  checkpoints = [],
} = {}) {
  const context = {
    sessionId: normalizeString(sessionId),
    provider: normalizeString(provider, 'claude'),
  };
  const messageEvents = messages
    .map((message, index) => createMessageEvent(asObject(message), index, context))
    .filter(Boolean);
  const checkpointEvents = checkpoints.map((checkpoint, index) => createCheckpointEvent(asObject(checkpoint), index, context));
  const events = [...messageEvents, ...checkpointEvents]
    .sort((left, right) => {
      const diff = new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
      return diff || String(left.id).localeCompare(String(right.id));
    });

  return {
    schemaVersion: 1,
    sessionId: context.sessionId,
    provider: context.provider,
    summary: buildSummary(events),
    events,
  };
}

export { redactSensitive };
