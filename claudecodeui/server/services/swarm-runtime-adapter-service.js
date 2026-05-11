import { dispatchSubagentTaskControl } from './subagent-task-control-service.js';

const RUNTIME_MODE = 'coordinator-subagents';
const DEFAULT_TIMEOUT_MS = 120000;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringifyCompact(value) {
  return JSON.stringify(value ?? {});
}

function sanitizeTaskNamePart(value, fallback = 'value') {
  const safe = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || fallback;
}

function assignmentName(runId, roleId, roleIndex) {
  return `swarm_${sanitizeTaskNamePart(runId, 'run')}__${sanitizeTaskNamePart(roleId, 'role')}__${roleIndex}`;
}

function basenameTaskName(value) {
  const text = normalizeText(value);
  if (!text) return '';
  return text.split(/[\\/]+/).filter(Boolean).pop() || text;
}

function parseAssignmentName(value) {
  const text = basenameTaskName(value);
  const safeMatch = /^swarm_([a-z0-9_]+)__([a-z0-9_]+)__(\d+)$/.exec(text);
  if (safeMatch) {
    return {
      runId: safeMatch[1],
      roleId: safeMatch[2],
      safeRoleId: safeMatch[2],
      roleIndex: Number(safeMatch[3]),
      taskName: text,
    };
  }

  const match = /^swarm:([^:]+):([^:]+):(\d+)$/.exec(text);
  if (!match) return null;
  return {
    runId: match[1],
    roleId: match[2],
    safeRoleId: sanitizeTaskNamePart(match[2], 'role'),
    roleIndex: Number(match[3]),
    taskName: text,
  };
}

function roleAssignments({ run, template }) {
  const runId = normalizeText(run?.id);
  return (Array.isArray(template?.roles) ? template.roles : []).flatMap((role) => {
    const count = Number.isFinite(Number(role.count)) ? Math.max(1, Number(role.count)) : 1;
    return Array.from({ length: count }, (_unused, roleIndex) => ({
      taskName: assignmentName(runId, role.id, roleIndex),
      roleId: role.id,
      safeRoleId: sanitizeTaskNamePart(role.id, 'role'),
      roleIndex,
      label: role.label || role.id,
      agentTemplateId: role.agentTemplateId || '',
      runtime: role.runtime || {},
      topics: Array.isArray(role.topics) ? role.topics : [],
    }));
  });
}

export function buildSwarmCoordinatorPrompt({
  run,
  template,
  objective = '',
  launchAnswers = {},
} = {}) {
  const assignments = roleAssignments({ run, template });
  return [
    'You are the hidden Argus Swarm coordinator for this run.',
    'Spawn every listed role exactly once by calling spawn_agent. Use the provided task_name values exactly.',
    'After spawning, stop. Do not complete the delegated role work in the coordinator.',
    '',
    `Run ID: ${normalizeText(run?.id)}`,
    `Template ID: ${normalizeText(template?.id)}`,
    `Objective: ${normalizeText(objective)}`,
    `Launch answers: ${stringifyCompact(launchAnswers)}`,
    `Topology: ${stringifyCompact(template?.topology || {})}`,
    `Assignments: ${stringifyCompact(assignments)}`,
  ].join('\n');
}

function toRecord(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function getToolInput(message = {}) {
  return toRecord(message.toolInput || message.input || message.args || message.parameters);
}

function getToolResult(message = {}) {
  return toRecord(message.toolUseResult || message.result || message.output || message.content);
}

function getTaskIdFromResult(result = {}, fallback = '') {
  return normalizeText(
    result.taskId
    || result.task_id
    || result.agentId
    || result.agent_id
    || result.task?.id
    || fallback,
  );
}

function getThreadIdFromResult(result = {}) {
  return normalizeText(
    result.threadId
    || result.thread_id
    || result.sessionId
    || result.session_id
    || result.thread?.id
    || result.task_name
    || result.taskName,
  );
}

function mappingKeys(assignment = {}) {
  const keys = new Set();
  const roleIndex = Number.isFinite(Number(assignment.roleIndex)) ? Number(assignment.roleIndex) : 0;
  if (assignment.roleId) keys.add(`${assignment.roleId}:${roleIndex}`);
  if (assignment.safeRoleId) keys.add(`${assignment.safeRoleId}:${roleIndex}`);
  return Array.from(keys);
}

function setMapping(mappings, assignment) {
  for (const key of mappingKeys(assignment)) {
    mappings.set(key, assignment);
  }
}

export function extractSpawnAgentMappings(messages = []) {
  const byToolId = new Map();
  const mappings = new Map();

  for (const message of Array.isArray(messages) ? messages : []) {
    const kind = normalizeText(message?.kind || message?.type);
    if (kind === 'tool_use' && normalizeText(message.toolName || message.name) === 'spawn_agent') {
      const input = getToolInput(message);
      const assignment = parseAssignmentName(input.task_name || input.taskName || input.name);
      if (!assignment) continue;
      const toolId = normalizeText(message.toolId || message.id || message.tool_use_id);
      const partial = {
        ...assignment,
        taskName: input.task_name || input.taskName || input.name,
        taskId: normalizeText(message.taskId || message.task_id),
        threadId: normalizeText(message.threadId || message.thread_id),
      };
      if (toolId) byToolId.set(toolId, partial);
      setMapping(mappings, partial);
      continue;
    }

    if (kind === 'tool_result') {
      const toolId = normalizeText(message.toolId || message.tool_use_id || message.id);
      const partial = byToolId.get(toolId);
      if (!partial) continue;
      const result = getToolResult(message);
      const mapped = {
        ...partial,
        taskId: getTaskIdFromResult(result, partial.taskId),
        threadId: getThreadIdFromResult(result) || partial.threadId,
      };
      if (toolId) byToolId.set(toolId, mapped);
      setMapping(mappings, mapped);
      continue;
    }

    if (kind === 'task_notification') {
      const toolId = normalizeText(message.toolId || message.tool_use_id || message.id);
      const partial = byToolId.get(toolId);
      if (!partial) continue;
      const mapped = {
        ...partial,
        taskId: normalizeText(message.taskId || message.task_id) || partial.taskId,
        threadId: normalizeText(message.threadId || message.thread_id) || partial.threadId,
        status: normalizeText(message.status) || partial.status,
        summary: normalizeText(message.summary) || partial.summary,
      };
      byToolId.set(toolId, mapped);
      setMapping(mappings, mapped);
    }
  }

  return mappings;
}

function createHeadlessWriter() {
  const messages = [];
  let sessionId = '';
  return {
    userId: null,
    ipAddress: 'swarm-runtime',
    messages,
    setSessionId(nextSessionId) {
      sessionId = normalizeText(nextSessionId);
    },
    getSessionId() {
      return sessionId;
    },
    send(message) {
      messages.push(message);
      const nextSessionId = normalizeText(message?.newSessionId || message?.sessionId || message?.session_id);
      if (nextSessionId) sessionId = nextSessionId;
    },
  };
}

function withTimeout(promise, timeoutMs, label) {
  const ms = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function buildCoordinatorOptions({ run = {}, projectPath = '', sessionId = '' } = {}) {
  const resolvedProjectPath = normalizeText(projectPath || run.projectPath);
  const resolvedSessionId = normalizeText(sessionId || run.coordinatorSessionId);
  const permissionMode = normalizeText(run.permissionMode || run.runtimePermissionMode);
  const toolsSettings = run.toolsSettings && typeof run.toolsSettings === 'object'
    ? run.toolsSettings
    : null;
  return {
    ...(resolvedProjectPath ? { projectPath: resolvedProjectPath, cwd: resolvedProjectPath } : {}),
    ...(resolvedSessionId ? { sessionId: resolvedSessionId, resume: true } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(toolsSettings ? { toolsSettings } : {}),
    ...(Object.prototype.hasOwnProperty.call(run, 'skipPermissions') ? { skipPermissions: Boolean(run.skipPermissions) } : {}),
    coordinatorMode: true,
    subagentDispatch: true,
    appendSystemPrompt: [
      'Argus Swarm coordinator mode is active.',
      'The user explicitly requested multi-agent swarm dispatch. You may use spawn_agent, wait_agent, send_message, followup_task, close_agent, and list_agents for this swarm run.',
    ].join('\n'),
  };
}

function payloadText(message = {}) {
  const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.content === 'string') return payload.content;
  if (typeof payload.objective === 'string') return payload.objective;
  return stringifyCompact(payload);
}

export function buildSwarmMessageControlPrompt({ action = 'send', taskId = '', content = '' } = {}) {
  if (action === 'followup') {
    return [
      `Call followup_task for background task ${taskId}.`,
      'Use this objective exactly:',
      content,
    ].filter(Boolean).join('\n\n');
  }
  if (action === 'wait') {
    return `Call wait_agent for background task ${taskId} and summarize status, blockers, result, and next action.`;
  }
  if (action === 'stop') {
    return `Stop or close background task ${taskId}. If close_agent is available, use it for that task.`;
  }
  return [
    `Call send_message for background task ${taskId}.`,
    'Queue this message exactly:',
    content,
  ].filter(Boolean).join('\n\n');
}

export function createSwarmRuntimeAdapter({
  queryClaudeSDK,
  sendClaudeSDKTaskControl,
  sendClaudeSDKGuidance,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof queryClaudeSDK !== 'function') {
    throw new Error('createSwarmRuntimeAdapter requires queryClaudeSDK');
  }

  const coordinatorRuns = new Map();

  async function ensureCoordinatorRun({ run, template, objective, projectPath, launchAnswers }) {
    const runId = normalizeText(run?.id);
    if (!runId) throw new Error('swarm runtime requires run.id');
    if (coordinatorRuns.has(runId)) {
      return coordinatorRuns.get(runId);
    }

    const writer = createHeadlessWriter();
    const prompt = buildSwarmCoordinatorPrompt({ run, template, objective, launchAnswers });
    const promise = withTimeout(
      queryClaudeSDK(prompt, buildCoordinatorOptions({ run, projectPath }), writer)
        .then(() => {
          const coordinatorSessionId = writer.getSessionId() || normalizeText(run.coordinatorSessionId);
          return {
            runId,
            coordinatorSessionId,
            messages: writer.messages,
            mappings: extractSpawnAgentMappings(writer.messages),
          };
        }),
      timeoutMs,
      'Swarm coordinator session',
    );
    coordinatorRuns.set(runId, promise);
    return promise;
  }

  async function resumeCoordinator({ run, command }) {
    const writer = createHeadlessWriter();
    if (run?.coordinatorSessionId) writer.setSessionId(run.coordinatorSessionId);
    await withTimeout(
      queryClaudeSDK(command, buildCoordinatorOptions({ run }), writer),
      timeoutMs,
      'Swarm coordinator resume',
    );
    return {
      success: true,
      mode: 'fallback-resume',
      sessionId: writer.getSessionId() || normalizeText(run?.coordinatorSessionId),
      messages: writer.messages,
    };
  }

  return {
    async spawnAgent({ run, template, role, roleIndex = 0, objective = '', projectPath = '', launchAnswers = {} } = {}) {
      const coordinator = await ensureCoordinatorRun({ run, template, objective, projectPath, launchAnswers });
      const mapping = coordinator.mappings.get(`${role.id}:${roleIndex}`)
        || coordinator.mappings.get(`${sanitizeTaskNamePart(role.id, 'role')}:${roleIndex}`);
      if (!mapping?.taskId) {
        return {
          status: 'failed',
          mode: RUNTIME_MODE,
          coordinatorSessionId: coordinator.coordinatorSessionId,
          error: `Coordinator did not return a task id for role ${role.id}:${roleIndex}`,
        };
      }
      return {
        status: 'running',
        mode: RUNTIME_MODE,
        coordinatorSessionId: coordinator.coordinatorSessionId,
        taskId: mapping.taskId,
        threadId: mapping.threadId,
      };
    },

    async controlAgent({ run, runId, agentId, action, taskId, threadId, content = '', objective = '' } = {}) {
      const normalizedAction = normalizeText(action).replace(/-agent$/, '');
      const controlAction = normalizedAction === 'stop' ? 'stop' : normalizedAction;
      const resolvedRun = run || { id: runId };
      const resolvedContent = normalizeText(content || objective);
      const events = [];
      let resumeFallbackUsed = false;
      const result = await dispatchSubagentTaskControl({
        action: controlAction,
        sessionId: resolvedRun.coordinatorSessionId,
        taskId,
        content: resolvedContent,
        sendDirectControl: (control) => (typeof sendClaudeSDKTaskControl === 'function'
          ? sendClaudeSDKTaskControl(control.sessionId, control)
          : { success: false, unsupported: true }),
        sendGuidance: (guidance, control) => {
          if (typeof sendClaudeSDKGuidance === 'function') {
            const guidanceResult = sendClaudeSDKGuidance(control.sessionId, guidance, `swarm-${agentId}-${control.action}`);
            if (guidanceResult?.success) return guidanceResult;
          }
          resumeFallbackUsed = true;
          return resumeCoordinator({ run: resolvedRun, command: guidance });
        },
        emitEvent: (event) => events.push(event),
      });
      return {
        ...result,
        ...(resumeFallbackUsed && result.success ? { mode: 'fallback-resume' } : {}),
        events,
        agentId,
        threadId,
      };
    },

    async deliverMessage({ run, agent, message } = {}) {
      if (!agent?.taskId) {
        return { success: false, mode: RUNTIME_MODE, error: 'Target swarm agent has no task id.' };
      }
      const content = payloadText(message);
      const action = message?.type === 'followup' ? 'followup' : 'send';
      const directResult = await this.controlAgent({
        run,
        agentId: agent.id,
        action,
        taskId: agent.taskId,
        threadId: agent.threadId,
        content,
      });
      if (directResult.success) {
        return directResult;
      }
      const command = buildSwarmMessageControlPrompt({ action, taskId: agent.taskId, content });
      return resumeCoordinator({ run, command });
    },

    async stopCoordinator({ run } = {}) {
      const sessionId = normalizeText(run?.coordinatorSessionId);
      if (!sessionId) {
        return { success: false, mode: 'direct', error: 'Coordinator session id is unavailable.' };
      }
      if (typeof sendClaudeSDKTaskControl === 'function') {
        const result = await sendClaudeSDKTaskControl(sessionId, {
          type: 'control_request',
          request_id: `swarm-stop-coordinator-${normalizeText(run?.id) || Date.now()}`,
          request: {
            subtype: 'stop_session',
            session_id: sessionId,
          },
        });
        if (result?.success) {
          return { success: true, mode: 'direct', sessionId };
        }
      }
      if (typeof sendClaudeSDKGuidance === 'function') {
        const result = await sendClaudeSDKGuidance(
          sessionId,
          'Stop coordinator activity for this Argus Swarm run. Do not spawn additional agents.',
          `swarm-stop-coordinator-${normalizeText(run?.id) || 'run'}`,
        );
        if (result?.success) {
          return { success: true, mode: 'fallback-guidance', sessionId };
        }
      }
      return { success: false, mode: 'direct', sessionId, error: 'Coordinator stop control is unavailable.' };
    },

    async reconcileRun({ run, template, agents = [] } = {}) {
      const runId = normalizeText(run?.id);
      let coordinator = coordinatorRuns.has(runId) ? await coordinatorRuns.get(runId) : null;
      if (!coordinator && run?.coordinatorSessionId) {
        try {
          const resumed = await resumeCoordinator({
            run,
            command: [
              'Reconcile this Argus Swarm run.',
              'If list_agents is available, list current background subagents and their task/thread ids.',
              'Do not start new work.',
            ].join('\n'),
          });
          coordinator = {
            runId,
            coordinatorSessionId: resumed.sessionId,
            messages: resumed.messages,
            mappings: extractSpawnAgentMappings(resumed.messages),
          };
        } catch {
          coordinator = null;
        }
      }
      const mappings = coordinator?.mappings instanceof Map ? coordinator.mappings : new Map();
      for (const agent of Array.isArray(agents) ? agents : []) {
        if (agent?.taskId && !mappings.has(`${agent.roleId}:${agent.roleIndex || 0}`)) {
          mappings.set(`${agent.roleId}:${agent.roleIndex || 0}`, {
            roleId: agent.roleId,
            roleIndex: agent.roleIndex || 0,
            taskId: agent.taskId,
            threadId: agent.threadId,
          });
        }
      }
      if (mappings.size === 0 && template) {
        for (const assignment of roleAssignments({ run, template })) {
          const match = (Array.isArray(agents) ? agents : []).find((agent) => (
            agent.roleId === assignment.roleId && Number(agent.roleIndex || 0) === assignment.roleIndex && agent.taskId
          ));
          if (match) {
            mappings.set(`${assignment.roleId}:${assignment.roleIndex}`, {
              roleId: assignment.roleId,
              roleIndex: assignment.roleIndex,
              taskId: match.taskId,
              threadId: match.threadId,
            });
          }
        }
      }
      return {
        success: true,
        mode: RUNTIME_MODE,
        coordinatorSessionId: coordinator?.coordinatorSessionId || normalizeText(run?.coordinatorSessionId),
        mappings,
      };
    },
  };
}
