import { brainStore as defaultBrainStore } from './brain-store-service.js';

const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|api[_-]?key|auth[_-]?token|credential)/i;
const MAX_TEXT_CAPTURE_CHARS = 8000;

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const truncateText = (value = '', max = MAX_TEXT_CAPTURE_CHARS) => {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? `${text.slice(0, max)}\n[brain raw ref truncated]` : text;
};

export function redactBrainPayload(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[redacted]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactBrainPayload(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactBrainPayload(entryValue, entryKey),
      ]),
    );
  }
  if (typeof value === 'string') {
    return SENSITIVE_KEY_PATTERN.test(value) ? '[redacted]' : truncateText(value, 2000);
  }
  return value;
}

export function getBrainCommandContext(data = {}, provider = 'claude') {
  const options = data?.options && typeof data.options === 'object' ? data.options : {};
  const sessionId = readString(options.sessionId)
    || readString(data.sessionId)
    || readString(options.clientSessionId)
    || readString(data.clientSessionId);
  const projectPath = readString(options.projectPath) || readString(options.cwd);
  const projectName = readString(options.projectName)
    || readString(data.projectName)
    || (projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : '');
  return {
    sessionId,
    provider,
    projectName,
    projectPath,
    modelProfileId: readString(options.modelProfileId),
    model: readString(options.model),
    permissionMode: readString(options.permissionMode),
    permissionPreset: readString(options.permissionPreset || options.permissionPresetSnapshot?.id),
    agentProfileKind: readString(options.agentProfileKind || options.agentProfile?.profileKind),
  };
}

export function createBrainCaptureService({ store = defaultBrainStore, logger = console } = {}) {
  const captureCommand = (data = {}, provider = 'claude', config = {}) => {
    if (config?.enabled === false) {
      return null;
    }
    try {
      const context = getBrainCommandContext(data, provider);
      if (!context.sessionId) {
        return null;
      }
      const command = readString(data.command);
      const refs = config.captureRawRefs === false || !command
        ? []
        : [{
          refType: 'raw_text',
          refId: data?.options?.clientMessageId || '',
          label: 'User command',
          content: truncateText(command),
          metadata: { role: 'user' },
        }];
      return store.addEvent({
        ...context,
        eventType: 'command',
        role: 'user',
        title: command ? command.slice(0, 180) : 'User command',
        content: command,
        payload: redactBrainPayload({
          provider,
          model: context.model,
          modelProfileId: context.modelProfileId,
          permissionMode: context.permissionMode,
          permissionPreset: context.permissionPreset,
          agentProfileKind: context.agentProfileKind,
          clientMessageId: data?.options?.clientMessageId || data?.clientMessageId || '',
        }),
        refs,
      });
    } catch (error) {
      logger.warn?.('[Argus Brain] command capture failed:', error?.message || error);
      return null;
    }
  };

  const captureRuntimeEvents = ({ data = {}, provider = 'claude', events = [], checkpoint = null, config = {} } = {}) => {
    if (config?.enabled === false) {
      return [];
    }
    const context = getBrainCommandContext(data, provider);
    const sessionId = readString(checkpoint?.sessionId) || context.sessionId;
    if (!sessionId) {
      return [];
    }
    const captured = [];
    for (const event of Array.isArray(events) ? events : []) {
      try {
        const kind = readString(event.kind || event.type) || 'runtime';
        const toolName = readString(event.toolName || event.name);
        const status = readString(event.status);
        const title = toolName
          ? `${kind}: ${toolName}`
          : status
            ? `${kind}: ${status}`
            : kind;
        const refs = config.captureRawRefs === false || !event.content
          ? []
          : [{
            refType: 'raw_text',
            refId: event.id || event.toolId || '',
            label: title,
            content: truncateText(event.content),
            metadata: { runtimeEvent: true },
          }];
        const capturedEvent = store.addEvent({
          ...context,
          sessionId,
          provider,
          checkpointId: checkpoint?.id || event.checkpointId || '',
          artifactId: event.artifactId || '',
          eventType: kind,
          role: kind === 'assistant_summary' ? 'assistant' : '',
          title,
          content: readString(event.content),
          payload: redactBrainPayload(event),
          refs,
          createdAtMs: event.createdAtMs || Date.parse(event.timestamp || '') || Date.now(),
        });
        if (capturedEvent) {
          captured.push(capturedEvent);
        }
      } catch (error) {
        logger.warn?.('[Argus Brain] runtime event capture failed:', error?.message || error);
      }
    }
    return captured;
  };

  const captureCheckpoint = ({ data = {}, provider = 'claude', checkpoint = null, config = {} } = {}) => {
    if (config?.enabled === false || !checkpoint?.id) {
      return null;
    }
    try {
      const context = getBrainCommandContext(data, provider);
      const files = Array.isArray(checkpoint.files) ? checkpoint.files : [];
      const refs = [];
      if (config.captureRawRefs !== false && checkpoint.patch) {
        refs.push({
          refType: 'diff',
          refId: checkpoint.id,
          label: `Checkpoint ${checkpoint.id}`,
          content: truncateText(checkpoint.patch),
          metadata: {
            files: files.map((file) => file.path).filter(Boolean),
            rollbackStatus: checkpoint.rollbackStatus,
          },
        });
      }
      return store.addEvent({
        ...context,
        sessionId: checkpoint.sessionId || context.sessionId,
        provider,
        checkpointId: checkpoint.id,
        eventType: 'checkpoint',
        title: files.length > 0
          ? `Checkpoint captured ${files.length} changed file(s)`
          : 'Checkpoint captured',
        content: files.map((file) => `${file.status || ''} ${file.path || ''}`.trim()).filter(Boolean).join('\n'),
        payload: redactBrainPayload({
          checkpointId: checkpoint.id,
          rollbackStatus: checkpoint.rollbackStatus,
          files,
        }),
        refs,
      });
    } catch (error) {
      logger.warn?.('[Argus Brain] checkpoint capture failed:', error?.message || error);
      return null;
    }
  };

  return {
    captureCommand,
    captureCheckpoint,
    captureRuntimeEvents,
  };
}

export const brainCaptureService = createBrainCaptureService();
