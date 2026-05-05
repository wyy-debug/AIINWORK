import type { Provider, SubagentActivitySummary } from '../types/types';

export interface SubagentStopRequestInput {
  taskIds?: string[];
  activity: SubagentActivitySummary;
  sessionId?: string | null;
  provider: Provider | string;
}

export interface SubagentStopRequest {
  type: 'claude-stop-tasks';
  sessionId: string;
  provider: Provider | string;
  taskIds: string[];
}

function uniqueTaskIds(taskIds: Array<string | undefined>): string[] {
  return Array.from(new Set(
    taskIds
      .map((taskId) => taskId?.trim())
      .filter((taskId): taskId is string => Boolean(taskId)),
  ));
}

export function buildSubagentStopRequest(input: SubagentStopRequestInput): SubagentStopRequest | null {
  const sessionId = input.sessionId?.trim();
  if (!sessionId) return null;

  const taskIds = input.taskIds && input.taskIds.length > 0
    ? uniqueTaskIds(input.taskIds)
    : uniqueTaskIds(input.activity.items.map((item) => item.taskId));

  if (taskIds.length === 0) return null;

  return {
    type: 'claude-stop-tasks',
    sessionId,
    provider: input.provider,
    taskIds,
  };
}
