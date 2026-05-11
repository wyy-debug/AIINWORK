import type {
  SubagentChildTool,
  SubagentEventEnvelope,
  SubagentEventV1,
  SubagentRegistryRecord,
} from '../types/types';

const ALLOWED_EVENT_TYPES = new Set<SubagentEventEnvelope['type']>([
  'started',
  'progress',
  'tool_started',
  'tool_completed',
  'message',
  'completed',
  'blocked',
  'failed',
  'cancelled',
  'token_usage',
  'control_requested',
  'control_accepted',
  'control_failed',
]);

type BuildSubagentEventEnvelopeArgs = {
  sessionId?: string;
  parentToolUseId?: string;
  taskId?: string;
  threadId?: string;
  packageId?: string;
  packageVersion?: string;
  dialogInstanceId?: string;
  registryRecord?: SubagentRegistryRecord;
  childTools?: SubagentChildTool[];
  controlEvents?: Array<{
    type?: string;
    timestamp?: number | string | Date;
    payload?: Record<string, unknown>;
    message?: string;
    summary?: string;
    toolName?: string;
    id?: string;
  }>;
};

type SubagentEventEnvelopeDraft = Omit<SubagentEventEnvelope, 'seq'> & { seq?: number };

function normalizeEventType(value: unknown): SubagentEventEnvelope['type'] {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (ALLOWED_EVENT_TYPES.has(type as SubagentEventEnvelope['type'])) {
    return type as SubagentEventEnvelope['type'];
  }
  if (type === 'done') return 'completed';
  if (type === 'error') return 'failed';
  if (type === 'tool_call_started') return 'tool_started';
  if (type === 'tool_call_completed') return 'tool_completed';
  return 'message';
}

function timestampOf(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = value ? new Date(value as string | number | Date).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function eventMessage(event: SubagentEventV1): string {
  return String(event.message || event.summary || event.toolName || '').trim();
}

function payloadText(payload: Record<string, unknown>): string {
  const value = payload.message || payload.error || payload.summary || payload.toolName || '';
  return typeof value === 'string' ? value.trim() : '';
}

function isCollapsibleEvent(type: SubagentEventEnvelope['type']): boolean {
  return type === 'blocked' || type === 'failed' || type === 'cancelled' || type === 'control_failed';
}

function dedupeSubagentEvents(events: SubagentEventEnvelopeDraft[]): SubagentEventEnvelopeDraft[] {
  const bySignature = new Map<string, SubagentEventEnvelopeDraft & { duplicateCount?: number }>();
  const passthrough: Array<SubagentEventEnvelopeDraft & { duplicateCount?: number }> = [];

  for (const event of events) {
    const text = payloadText(event.payload);
    if (!isCollapsibleEvent(event.type) || !text) {
      passthrough.push(event);
      continue;
    }

    const signature = [
      event.type,
      event.taskId,
      event.threadId,
      text,
    ].join('|');
    const current = bySignature.get(signature);
    if (!current) {
      bySignature.set(signature, { ...event, duplicateCount: 1 });
      continue;
    }
    current.timestamp = Math.max(current.timestamp, event.timestamp);
    current.duplicateCount = (current.duplicateCount || 1) + 1;
    current.payload = {
      ...current.payload,
      ...(event.payload || {}),
      duplicateCount: current.duplicateCount,
    };
  }

  return [...passthrough, ...bySignature.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(({ duplicateCount, ...event }) => ({
      ...event,
      payload: duplicateCount && duplicateCount > 1
        ? { ...event.payload, duplicateCount }
        : event.payload,
    }));
}

export function buildSubagentEventEnvelopes({
  sessionId = '',
  parentToolUseId = '',
  taskId = '',
  threadId = '',
  packageId = '',
  packageVersion = '',
  dialogInstanceId = '',
  registryRecord,
  controlEvents = [],
}: BuildSubagentEventEnvelopeArgs): SubagentEventEnvelope[] {
  const events = Array.isArray(registryRecord?.events) ? registryRecord.events : [];
  const normalizedEvents = events.map((event) => {
    const type = normalizeEventType(event.type);
    const message = eventMessage(event);
    return {
      sessionId,
      parentToolUseId,
      taskId: taskId || registryRecord?.taskId || '',
      threadId: threadId || registryRecord?.sessionId || '',
      packageId,
      packageVersion,
      dialogInstanceId,
      type,
      timestamp: timestampOf(event.timestamp, Date.now()),
      payload: {
        ...(message ? { message } : {}),
        ...(event.id ? { sourceEventId: event.id } : {}),
        ...(event.toolName ? { toolName: event.toolName } : {}),
      },
    };
  });
  const normalizedControlEvents = (Array.isArray(controlEvents) ? controlEvents : []).map((event) => ({
    sessionId,
    parentToolUseId,
    taskId: taskId || registryRecord?.taskId || '',
    threadId: threadId || registryRecord?.sessionId || '',
    packageId,
    packageVersion,
    dialogInstanceId,
    type: normalizeEventType(event.type),
    timestamp: timestampOf(event.timestamp, Date.now()),
    payload: event.payload && typeof event.payload === 'object'
      ? event.payload
      : {
          ...(event.message ? { message: event.message } : {}),
          ...(event.summary ? { message: event.summary } : {}),
          ...(event.id ? { sourceEventId: event.id } : {}),
          ...(event.toolName ? { toolName: event.toolName } : {}),
        },
  }));

  return dedupeSubagentEvents([...normalizedEvents, ...normalizedControlEvents])
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((event, index) => ({
      ...event,
      seq: index + 1,
    }));
}
