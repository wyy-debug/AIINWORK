import { autoCaptureChatKnowledge as defaultAutoCaptureChatKnowledge } from './chat-knowledge-capture-service.js';

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
  const streamBuffers = new Map();
  const capturedTextKeys = new Set();

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

  const capture = async (message = {}, content = '', messageKey = '') => {
    const cleanContent = readString(content);
    if (!cleanContent) return null;
    const context = resolveContext(message);
    const sessionId = readString(message.sessionId || context.sessionId);
    const provider = readString(message.provider || context.provider) || 'claude';
    const key = `${provider}:${sessionId}:${messageKey}:${cleanContent}`;
    if (capturedTextKeys.has(key)) {
      return null;
    }
    capturedTextKeys.add(key);

    const payload = {
      source: 'chat-auto-capture',
      sourceId: `chat:${sessionId || 'no-session'}:message:${messageKey || readString(message.id) || 'assistant'}`,
      messageKey: messageKey || readString(message.id) || 'assistant',
      projectName: context.projectName,
      projectPath: context.projectPath,
      sessionId,
      provider,
      previousUserPrompt: context.userPrompt,
      content: cleanContent,
      timestamp: message.timestamp || new Date().toISOString(),
    };
    const result = await autoCaptureChatKnowledge(payload);
    broadcast(buildCaptureBroadcast(payload, result));
    return result;
  };

  const observeMessage = async (message = {}) => {
    if (!message || typeof message !== 'object') return null;
    const kind = message.kind;
    const provider = readString(message.provider) || 'claude';
    const sessionId = readString(message.sessionId);
    if (!sessionId) return null;

    if (kind === 'text' && message.role === 'assistant') {
      return capture(message, message.content || '', readString(message.id) || 'assistant');
    }

    const streamKey = keyFor(provider, sessionId);
    if (kind === 'stream_delta') {
      const current = streamBuffers.get(streamKey) || '';
      streamBuffers.set(streamKey, `${current}${message.content || ''}`);
      return null;
    }

    if (kind === 'stream_end' || kind === 'complete') {
      const content = streamBuffers.get(streamKey) || '';
      streamBuffers.delete(streamKey);
      if (!content) return null;
      return capture(message, content, 'stream');
    }

    return null;
  };

  return {
    setContext,
    observeMessage,
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
