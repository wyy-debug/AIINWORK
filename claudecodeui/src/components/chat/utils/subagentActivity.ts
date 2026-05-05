import type {
  ChatMessage,
  SubagentActivityItem,
  SubagentActivitySummary,
  SubagentChildTool,
  SubagentRegistryRecord,
} from '../types/types';

function parsePlainObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function basenameOf(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

function truncateMiddle(value: string, maxLength = 56): string {
  if (value.length <= maxLength) return value;
  const headLength = Math.max(12, Math.floor((maxLength - 1) * 0.6));
  const tailLength = Math.max(8, maxLength - headLength - 1);
  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}

function parseSubagentLabel(message: ChatMessage): string {
  const payload = parsePlainObject(message.toolInput);
  const candidates = [
    payload?.description,
    payload?.subagent_type,
    payload?.agent,
    payload?.label,
    message.toolName,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return 'worker';
}

function summarizeSubagentTool(tool: SubagentChildTool): string {
  const input = parsePlainObject(tool.toolInput);
  const toolName = tool.toolName || 'Tool';
  const filePath = firstString(input?.file_path, input?.path, input?.notebook_path);
  if (filePath) {
    return `${toolName} ${basenameOf(filePath)}`;
  }

  const query = firstString(input?.query, input?.pattern, input?.glob, input?.url);
  if (query) {
    return `${toolName} ${truncateMiddle(query)}`;
  }

  const command = firstString(input?.command);
  if (command) {
    return `${toolName} ${truncateMiddle(command)}`;
  }

  const message = firstString(input?.summary, input?.message, input?.content);
  if (message) {
    return `${toolName} ${truncateMiddle(message)}`;
  }

  return toolName;
}

function deriveElapsedMs(
  state: ChatMessage['subagentState'] | undefined,
  registryRecord: SubagentRegistryRecord | undefined,
): number | undefined {
  if (typeof state?.elapsedMs === 'number') {
    return state.elapsedMs;
  }
  if (!registryRecord || typeof registryRecord !== 'object') {
    return undefined;
  }
  const record = registryRecord as { startedAt?: number; updatedAt?: number; endedAt?: number };
  if (typeof record.startedAt !== 'number') {
    return undefined;
  }
  const end = typeof record.endedAt === 'number' ? record.endedAt : record.updatedAt;
  if (typeof end !== 'number' || end < record.startedAt) {
    return undefined;
  }
  return end - record.startedAt;
}

export function summarizeSubagentActivity(messages: ChatMessage[]): SubagentActivitySummary {
  let total = 0;
  let running = 0;
  let completed = 0;
  let outputting = 0;
  let latestLabel = '';
  const runningLabels: string[] = [];
  const outputtingLabels: string[] = [];
  const activeToolLabels: string[] = [];
  const items: SubagentActivityItem[] = [];
  const historyItems: SubagentActivityItem[] = [];
  let latestRuntimeItem: SubagentActivityItem | undefined;

  for (const message of messages) {
    if (!message.isSubagentContainer) continue;

    const state = message.subagentState;
    const label = state?.objective || parseSubagentLabel(message);
    const childTools = state?.childTools || [];
    const currentTool = state && state.currentToolIndex >= 0
      ? childTools[state.currentToolIndex] || null
      : null;
    const registryRecord = state?.registryRecord;
    const isComplete = Boolean(state?.isComplete || message.toolResult);
    const runtimeStatus = state?.runtimeStatus ?? registryRecord?.runtimeStatus;
    const terminal = isComplete
      || runtimeStatus === 'DONE'
      || runtimeStatus === 'BLOCKED'
      || runtimeStatus === 'NEED_PARENT_INPUT'
      || Boolean(registryRecord?.status && registryRecord.status !== 'running');

    const item: SubagentActivityItem = {
      id: typeof message.id === 'string' ? message.id : undefined,
      taskId: state?.taskId || registryRecord?.taskId,
      label,
      status: registryRecord?.status,
      runtimeStatus,
      objective: state?.objective || registryRecord?.objective,
      role: registryRecord?.role,
      currentStep: state?.currentStep ?? registryRecord?.currentStep,
      maxSteps: state?.maxSteps ?? registryRecord?.maxSteps,
      remainingSteps: state?.remainingSteps ?? registryRecord?.remainingSteps,
      startedAt: state?.startedAt ?? registryRecord?.startedAt,
      endedAt: registryRecord?.endedAt,
      elapsedMs: deriveElapsedMs(state, registryRecord),
      lastTool: state?.lastTool || registryRecord?.lastTool,
      lastToolSummary: state?.lastToolSummary || registryRecord?.lastToolSummary,
      stopReason: state?.stopReason || registryRecord?.stopReason,
      resultSummary: registryRecord?.resultSummary,
      evidence: registryRecord?.evidence,
      nextAction: registryRecord?.nextAction,
      blockers: registryRecord?.blockers,
      terminal,
    };

    historyItems.push(item);

    if (terminal) {
      completed += 1;
      continue;
    }

    total += 1;
    running += 1;
    if (runningLabels.length < 3) {
      runningLabels.push(label);
    }
    if (item.runtimeStatus || item.currentStep || item.lastTool || item.stopReason) {
      latestRuntimeItem = item;
    }

    const hasLiveChildOutput = !isComplete && (
      Boolean(currentTool)
      || childTools.some((childTool) => !childTool.toolResult)
    );
    if (hasLiveChildOutput) {
      outputting += 1;
      if (outputtingLabels.length < 3) {
        outputtingLabels.push(label);
      }
    }

    let activeToolLabel = '';
    if (!isComplete) {
      if (currentTool) {
        activeToolLabel = `${label} · ${summarizeSubagentTool(currentTool)}`;
      } else if (state?.lastTool) {
        activeToolLabel = `${label} · ${state.lastTool}`;
      } else if (state?.isAsyncLaunch) {
        activeToolLabel = `${label} · 等待后台结果`;
      }
    }
    if (activeToolLabel && activeToolLabels.length < 3) {
      activeToolLabels.push(activeToolLabel);
    }

    latestLabel = label || latestLabel;
    items.push({
      ...item,
      activeToolLabel,
      outputting: hasLiveChildOutput,
    });
  }

  return {
    total,
    running,
    completed,
    outputting,
    latestLabel: latestLabel || undefined,
    runningLabels,
    outputtingLabels,
    activeToolLabels,
    runtimeStatus: latestRuntimeItem?.runtimeStatus,
    objective: latestRuntimeItem?.objective,
    currentStep: latestRuntimeItem?.currentStep,
    maxSteps: latestRuntimeItem?.maxSteps,
    remainingSteps: latestRuntimeItem?.remainingSteps,
    elapsedMs: latestRuntimeItem?.elapsedMs,
    lastTool: latestRuntimeItem?.lastTool,
    lastToolSummary: latestRuntimeItem?.lastToolSummary,
    stopReason: latestRuntimeItem?.stopReason,
    items,
    historyItems: historyItems.slice(-30).reverse(),
  };
}
