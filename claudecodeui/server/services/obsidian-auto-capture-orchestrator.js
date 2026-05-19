const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const OBSIDIAN_CAPTURE_EVENT = 'obsidian_auto_capture_result';

const keyFor = (provider = '', sessionId = '') => `${readString(provider) || 'claude'}:${readString(sessionId) || 'no-session'}`;

const projectNameFromPath = (projectPath = '') => {
  const cleanPath = readString(projectPath);
  if (!cleanPath) return '';
  const segments = cleanPath.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] || '';
};

const statusForResult = (result = {}) => {
  if (result.status === 'candidate' || result.reason === 'memory_candidate') return 'candidate';
  if (result.reason === 'duplicate') return 'duplicate';
  if (result.reason === 'in_progress') return 'in_progress';
  if (!result.captured) return 'skipped';
  const targets = Array.isArray(result.obsidianBridge?.targets)
    ? result.obsidianBridge.targets
    : [];
  const destinations = targets.length > 0
    ? targets.map((target) => target.destination)
    : [result.obsidianBridge?.destination];
  if (destinations.includes('error')) return 'failed';
  if (destinations.includes('fallback')) return 'fallback';
  if (destinations.every((destination) => destination === 'obsidian')) return 'synced';
  if (result.captured) return 'synced';
  return result.mode === 'ai-memory' ? 'synced' : 'captured';
};

const buildCaptureBroadcast = (payload = {}, result = {}, extra = {}) => ({
  event: OBSIDIAN_CAPTURE_EVENT,
  provider: payload.provider || '',
  sessionId: payload.sessionId || '',
  messageId: payload.messageKey || '',
  sourceId: payload.sourceId || '',
  status: statusForResult(result),
  captured: Boolean(result.captured),
  reason: result.reason || '',
  mode: result.mode || result.routingMode || '',
  routingMode: result.routingMode || result.mode || '',
  routingModes: result.routingModes || result.artifact?.metadata?.routingModes || result.artifact?.metadata?.obsidianModes || [],
  routingReason: result.routingReason || '',
  routingSignals: result.routingSignals || [],
  confidence: result.confidence ?? result.routingConfidence ?? 0,
  artifactId: result.artifact?.id || result.artifactId || '',
  obsidianPath: result.obsidianBridge?.path || '',
  obsidianTargets: Array.isArray(result.obsidianBridge?.targets) ? result.obsidianBridge.targets : [],
  obsidianPaths: result.artifact?.metadata?.obsidianPaths || {},
  fallbackPath: result.obsidianBridge?.fallbackPath || '',
  error: result.error || result.obsidianBridge?.error || '',
  ...extra,
});

const instructionPathFromResult = (result = {}) => (
  readString(result.obsidianBridge?.path || result.obsidianBridge?.wikiPath || result.wikiPath || result.path)
);

const buildInstructionCaptureBroadcast = (payload = {}, result = {}) => {
  const obsidianPath = instructionPathFromResult(result);
  return buildCaptureBroadcast(payload, {
    ...result,
    mode: 'project-knowledge',
    routingMode: 'project-knowledge',
    routingModes: ['project-knowledge'],
  }, {
    source: 'instruction-file',
    instructionFileResult: true,
    obsidianPath,
    obsidianPaths: obsidianPath ? { projectKnowledge: obsidianPath } : {},
  });
};

const readToolInput = (message = {}) => (
  (() => {
    const input = message.toolInput
      || message.input
      || message.tool_input
      || {};
    if (typeof input !== 'string') return input;
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  })()
);

const readToolFilePath = (message = {}) => {
  const input = readToolInput(message);
  return readString(
    input.file_path
    || input.filePath
    || input.path
  );
};

const isInstructionWriteTool = (toolName = '') => (
  /^(Write|Edit|MultiEdit)$/i.test(readString(toolName))
);

export const createObsidianAutoCaptureOrchestrator = ({
  syncInstructionFile = null,
  syncProjectInstructionFiles = null,
  broadcast = () => undefined,
} = {}) => {
  const contexts = new Map();
  const pendingInstructionWrites = new Map();

  const setContext = (context = {}) => {
    const provider = readString(context.provider) || 'claude';
    const sessionId = readString(context.sessionId || context.currentSessionId);
    const projectPath = readString(context.projectPath);
    if (!sessionId && !context.allowMissingSession) return;
    contexts.set(keyFor(provider, sessionId), {
      provider,
      sessionId,
      projectName: readString(context.projectName) || projectNameFromPath(projectPath),
      projectPath,
      userPrompt: readString(context.userPrompt),
      timestamp: context.timestamp || new Date().toISOString(),
    });
  };

  const resolveContext = (message = {}) => {
    const provider = readString(message.provider) || 'claude';
    const sessionId = readString(message.sessionId);
    return contexts.get(keyFor(provider, sessionId)) || {
      provider,
      sessionId,
      projectName: readString(message.projectName) || projectNameFromPath(message.projectPath),
      projectPath: readString(message.projectPath),
      userPrompt: '',
      timestamp: message.timestamp || new Date().toISOString(),
    };
  };

  const trackInstructionToolUse = (message = {}) => {
    if (typeof syncInstructionFile !== 'function') return null;
    const toolName = readString(message.toolName || message.name);
    const toolId = readString(message.toolId || message.id);
    const filePath = readToolFilePath(message);
    if (!toolId || !filePath || !isInstructionWriteTool(toolName)) return null;

    const context = resolveContext(message);
    const provider = readString(message.provider || context.provider) || 'claude';
    const sessionId = readString(message.sessionId || context.sessionId);
    if (!sessionId) return null;

    pendingInstructionWrites.set(`${keyFor(provider, sessionId)}:${toolId}`, {
      filePath,
      toolName,
      projectName: context.projectName,
      projectPath: context.projectPath,
      sessionId,
      provider,
      messageKey: readString(message.id),
      timestamp: message.timestamp || new Date().toISOString(),
    });
    return null;
  };

  const syncInstructionToolResult = async (message = {}) => {
    if (typeof syncInstructionFile !== 'function') return null;
    const provider = readString(message.provider) || 'claude';
    const sessionId = readString(message.sessionId);
    const toolId = readString(message.toolId || message.id);
    if (!sessionId || !toolId) return null;

    const key = `${keyFor(provider, sessionId)}:${toolId}`;
    const pending = pendingInstructionWrites.get(key);
    if (!pending) return null;
    pendingInstructionWrites.delete(key);

    if (message.isError === true || message.error === true) {
      return null;
    }

    try {
      const result = await syncInstructionFile({
        ...pending,
        toolResult: message.content,
      });
      if (result?.captured || result?.reason === 'disabled' || result?.reason === 'empty_instruction_file') {
        broadcast(buildInstructionCaptureBroadcast({
          provider,
          sessionId,
          messageId: pending.messageKey || toolId,
          sourceId: `instruction:${sessionId}:${pending.filePath}`,
        }, result || {}));
      }
      return result;
    } catch (error) {
      const result = {
        success: false,
        captured: false,
        reason: 'instruction_file_sync_error',
        error: error?.message || String(error || 'Instruction file sync failed.'),
      };
      broadcast(buildInstructionCaptureBroadcast({
        provider,
        sessionId,
        messageId: pending.messageKey || toolId,
        sourceId: `instruction:${sessionId}:${pending.filePath}`,
      }, result));
      console.warn('[Obsidian Wiki] Instruction file sync failed:', result.error);
      return result;
    }
  };

  const broadcastInstructionResults = (message = {}, result = null, sourceIdPrefix = 'instruction') => {
    const provider = readString(message.provider) || 'claude';
    const sessionId = readString(message.sessionId);
    const results = Array.isArray(result?.results) ? result.results : [result];
    for (const item of results) {
      if (!item?.captured && item?.reason !== 'disabled' && item?.reason !== 'empty_instruction_file') {
        continue;
      }
      broadcast(buildInstructionCaptureBroadcast({
        provider,
        sessionId,
        messageId: readString(message.id) || `${sourceIdPrefix}-${Date.now()}`,
        sourceId: `${sourceIdPrefix}:${sessionId || 'no-session'}`,
      }, item || {}));
    }
  };

  const syncProjectInstructionSnapshot = async (message = {}) => {
    if (typeof syncProjectInstructionFiles !== 'function') return null;
    const context = resolveContext(message);
    const provider = readString(message.provider || context.provider) || 'claude';
    const sessionId = readString(message.sessionId || context.sessionId);
    if (!sessionId || !readString(context.projectPath)) return null;

    try {
      const result = await syncProjectInstructionFiles({
        projectPath: context.projectPath,
        projectName: context.projectName,
        sessionId,
        provider,
        trigger: 'turn_complete_scan',
      });
      broadcastInstructionResults({ ...message, provider, sessionId }, result, 'instruction-scan');
      return result;
    } catch (error) {
      const result = {
        success: false,
        captured: false,
        reason: 'instruction_file_scan_error',
        error: error?.message || String(error || 'Instruction file scan failed.'),
      };
      broadcast(buildInstructionCaptureBroadcast({
        provider,
        sessionId,
        messageId: readString(message.id) || `instruction-scan-${Date.now()}`,
        sourceId: `instruction-scan:${sessionId || 'no-session'}`,
      }, result));
      console.warn('[Obsidian Wiki] Instruction file scan failed:', result.error);
      return result;
    }
  };

  const isFailedCompletion = (message = {}) => (
    message.aborted === true
    || message.success === false
    || Number(message.exitCode) > 0
    || readString(message.status).toLowerCase() === 'error'
    || Boolean(message.error)
  );

  const waitForPendingCapture = async () => null;

  const flushPendingCaptures = async () => null;

  const observeMessage = async (message = {}) => {
    if (!message || typeof message !== 'object') return null;
    const kind = message.kind;
    const provider = readString(message.provider) || 'claude';
    const sessionId = readString(message.sessionId);
    if (!sessionId) return null;

    if (kind === 'text' && message.role === 'assistant') {
      return null;
    }

    if (kind === 'stream_delta') {
      return null;
    }

    if (kind === 'stream_end') {
      return null;
    }

    if (kind === 'tool_use') {
      return trackInstructionToolUse(message);
    }

    if (kind === 'tool_result') {
      return syncInstructionToolResult(message);
    }

    if (kind === 'context_compaction') {
      return null;
    }

    if (kind === 'error') {
      return null;
    }

    if (kind === 'complete') {
      if (isFailedCompletion(message)) {
        return null;
      }
      const instructionResult = await syncProjectInstructionSnapshot(message);
      return {
        instructionResult,
      };
    }

    return null;
  };

  return {
    setContext,
    observeMessage,
    waitForPendingCapture,
    flushPendingCaptures,
  };
};

export const createObsidianAutoCaptureStatusMessage = (payload = {}) => ({
  id: payload.id || `obsidian_capture_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  kind: 'status',
  provider: payload.provider || 'claude',
  sessionId: payload.sessionId || '',
  timestamp: payload.timestamp || new Date().toISOString(),
  text: OBSIDIAN_CAPTURE_EVENT,
  event: OBSIDIAN_CAPTURE_EVENT,
  ...payload,
});
