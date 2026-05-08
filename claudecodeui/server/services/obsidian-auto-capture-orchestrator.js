import crypto from 'crypto';

import { autoCaptureChatKnowledge as defaultAutoCaptureChatKnowledge } from './chat-knowledge-capture-service.js';

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const OBSIDIAN_CAPTURE_EVENT = 'obsidian_auto_capture_result';

const keyFor = (provider = '', sessionId = '') => `${readString(provider) || 'claude'}:${readString(sessionId) || 'no-session'}`;

const hashText = (value = '') => crypto
  .createHash('sha256')
  .update(String(value || ''), 'utf8')
  .digest('hex')
  .slice(0, 16);

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

const buildCaptureBroadcast = (payload = {}, result = {}) => ({
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
});

export const createObsidianAutoCaptureOrchestrator = ({
  autoCaptureChatKnowledge = defaultAutoCaptureChatKnowledge,
  broadcast = () => undefined,
} = {}) => {
  const contexts = new Map();
  const capturedTextKeys = new Set();
  const turnBuffers = new Map();
  const turnSequences = new Map();
  const pendingCaptures = new Map();

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

  const getTurnBuffer = (provider, sessionId) => {
    const key = keyFor(provider, sessionId);
    let buffer = turnBuffers.get(key);
    if (!buffer) {
      const sequence = (turnSequences.get(key) || 0) + 1;
      turnSequences.set(key, sequence);
      buffer = {
        provider,
        sessionId,
        sequence,
        chunks: [],
        streamContent: '',
        lastAssistantMessageId: '',
        timestamp: new Date().toISOString(),
      };
      turnBuffers.set(key, buffer);
    }
    return buffer;
  };

  const appendAssistantContent = (message = {}, content = '') => {
    const cleanContent = readString(content);
    if (!cleanContent) return;
    const provider = readString(message.provider) || 'claude';
    const sessionId = readString(message.sessionId);
    if (!sessionId) return;
    const buffer = getTurnBuffer(provider, sessionId);
    buffer.chunks.push(cleanContent);
    buffer.lastAssistantMessageId = readString(message.id) || buffer.lastAssistantMessageId;
    buffer.timestamp = message.timestamp || buffer.timestamp;
  };

  const appendStreamDelta = (message = {}) => {
    const content = typeof message.content === 'string' ? message.content : '';
    if (!content) return;
    const provider = readString(message.provider) || 'claude';
    const sessionId = readString(message.sessionId);
    if (!sessionId) return;
    const buffer = getTurnBuffer(provider, sessionId);
    buffer.streamContent += content;
    buffer.timestamp = message.timestamp || buffer.timestamp;
  };

  const flushStreamContent = (buffer) => {
    const cleanContent = readString(buffer?.streamContent);
    if (!cleanContent) return;
    buffer.chunks.push(cleanContent);
    buffer.streamContent = '';
  };

  const readTurnContent = (buffer) => {
    flushStreamContent(buffer);
    return (buffer?.chunks || [])
      .map((chunk) => readString(chunk))
      .filter(Boolean)
      .join('\n\n');
  };

  const clearTurnBuffer = (provider, sessionId) => {
    turnBuffers.delete(keyFor(provider, sessionId));
  };

  const isFailedCompletion = (message = {}) => (
    message.aborted === true
    || message.success === false
    || Number(message.exitCode) > 0
    || readString(message.status).toLowerCase() === 'error'
    || Boolean(message.error)
  );

  const capture = async (message = {}, content = '', messageKey = '', options = {}) => {
    const cleanContent = readString(content);
    if (!cleanContent) return null;
    const context = resolveContext(message);
    const sessionId = readString(message.sessionId || context.sessionId);
    const provider = readString(message.provider || context.provider) || 'claude';
    const sourceType = readString(options.sourceType) || 'message';
    const key = `${provider}:${sessionId}:${sourceType}:${messageKey}:${cleanContent}`;
    if (capturedTextKeys.has(key)) {
      return null;
    }
    const payload = {
      source: 'chat-auto-capture',
      sourceId: `chat:${sessionId || 'no-session'}:${sourceType}:${messageKey || readString(message.id) || 'assistant'}`,
      messageKey: messageKey || readString(message.id) || 'assistant',
      projectName: context.projectName,
      projectPath: context.projectPath,
      sessionId,
      provider,
      previousUserPrompt: context.userPrompt,
      autoCaptureReason: readString(options.autoCaptureReason),
      turnKey: sourceType === 'turn' ? messageKey : '',
      content: cleanContent,
      timestamp: message.timestamp || new Date().toISOString(),
    };
    const result = await autoCaptureChatKnowledge(payload);
    capturedTextKeys.add(key);
    broadcast(buildCaptureBroadcast(payload, result));
    return result;
  };

  const captureTurn = async (message = {}, options = {}) => {
    const provider = readString(message.provider) || 'claude';
    const sessionId = readString(message.sessionId);
    if (!sessionId) return null;

    const buffer = turnBuffers.get(keyFor(provider, sessionId));
    if (!buffer) return null;

    const bufferKey = keyFor(provider, sessionId);
    if (pendingCaptures.has(bufferKey)) {
      return pendingCaptures.get(bufferKey);
    }

    const content = readTurnContent(buffer);
    if (!content) return null;

    const completeMessageId = readString(message.id);
    const turnKey = buffer.lastAssistantMessageId
      || `hash-${hashText(content)}`
      || completeMessageId
      || `turn-${buffer.sequence}`;

    const capturePromise = capture(
      {
        ...message,
        provider,
        sessionId,
        timestamp: message.timestamp || buffer.timestamp,
      },
      content,
      turnKey,
      {
        sourceType: 'turn',
        autoCaptureReason: options.autoCaptureReason,
      },
    ).then((result) => {
      clearTurnBuffer(provider, sessionId);
      return result;
    }).finally(() => {
      pendingCaptures.delete(bufferKey);
    });
    pendingCaptures.set(bufferKey, capturePromise);
    return capturePromise;
  };

  const waitForPendingCapture = async ({ provider = 'claude', sessionId = '', timeoutMs = 1500 } = {}) => {
    const key = keyFor(provider, sessionId);
    const pending = pendingCaptures.get(key);
    if (!pending) return null;
    const waitMs = Math.max(1, Number(timeoutMs) || 1500);
    let timeout;
    try {
      return await Promise.race([
        pending.catch((error) => ({ success: false, error: error?.message || String(error) })),
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve({ success: false, reason: 'timeout' }), waitMs);
          timeout.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };

  const flushPendingCaptures = async ({ provider = 'claude', sessionId = '', reason = 'manual_flush' } = {}) => {
    const normalizedProvider = readString(provider) || 'claude';
    const normalizedSessionId = readString(sessionId);
    if (!normalizedSessionId) return null;
    return captureTurn({
      kind: 'complete',
      provider: normalizedProvider,
      sessionId: normalizedSessionId,
      id: `flush-${Date.now()}`,
    }, {
      autoCaptureReason: reason,
      preferLastAssistantId: true,
    });
  };

  const observeMessage = async (message = {}) => {
    if (!message || typeof message !== 'object') return null;
    const kind = message.kind;
    const provider = readString(message.provider) || 'claude';
    const sessionId = readString(message.sessionId);
    if (!sessionId) return null;

    if (kind === 'text' && message.role === 'assistant') {
      appendAssistantContent(message, message.content || '');
      return null;
    }

    if (kind === 'stream_delta') {
      appendStreamDelta(message);
      return null;
    }

    if (kind === 'stream_end') {
      const buffer = turnBuffers.get(keyFor(provider, sessionId));
      flushStreamContent(buffer);
      return null;
    }

    if (kind === 'context_compaction') {
      return captureTurn(message, {
        autoCaptureReason: 'pre_compact_flush',
        preferLastAssistantId: true,
      });
    }

    if (kind === 'error') {
      clearTurnBuffer(provider, sessionId);
      return null;
    }

    if (kind === 'complete') {
      if (isFailedCompletion(message)) {
        clearTurnBuffer(provider, sessionId);
        return null;
      }
      return captureTurn(message);
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
