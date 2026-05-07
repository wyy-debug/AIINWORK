import { sessionsService as defaultSessionsService } from '../modules/providers/services/sessions.service.js';

import { autoCaptureChatKnowledge as defaultAutoCaptureChatKnowledge } from './chat-knowledge-capture-service.js';

const PROVIDERS = new Set(['claude', 'codex', 'cursor', 'gemini']);

const state = {
  running: false,
  lastStartedAt: '',
  lastFinishedAt: '',
  total: 0,
  processed: 0,
  captured: 0,
  skipped: 0,
  errors: [],
};

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeProvider = (value) => {
  const provider = readString(value).toLowerCase();
  return PROVIDERS.has(provider) ? provider : 'claude';
};

const collectProjectSessions = (project = {}) => {
  const candidates = [
    ...(Array.isArray(project.sessions) ? project.sessions : []),
    ...(Array.isArray(project.conversations) ? project.conversations : []),
  ];
  return candidates
    .map((session) => ({
      id: readString(session.id || session.sessionId),
      provider: normalizeProvider(session.__provider || session.provider),
      projectName: readString(project.name || session.projectName),
      projectPath: readString(project.fullPath || project.path || session.projectPath),
    }))
    .filter((session) => session.id);
};

const previousUserPromptFor = (messages, index) => {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message?.kind === 'text' && message.role === 'user' && typeof message.content === 'string') {
      return message.content;
    }
  }
  return '';
};

export const getObsidianAutoCaptureBackfillStatus = () => ({
  success: true,
  ...state,
});

export const runObsidianAutoCaptureBackfill = async ({
  getProjects,
  sessionsService = defaultSessionsService,
  autoCaptureChatKnowledge = defaultAutoCaptureChatKnowledge,
  limitSessions = 0,
} = {}) => {
  if (state.running) {
    return getObsidianAutoCaptureBackfillStatus();
  }
  if (typeof getProjects !== 'function') {
    throw new Error('getProjects is required for Obsidian auto-capture backfill.');
  }

  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  state.lastFinishedAt = '';
  state.total = 0;
  state.processed = 0;
  state.captured = 0;
  state.skipped = 0;
  state.errors = [];

  try {
    const projects = await getProjects(() => undefined);
    const sessions = projects.flatMap(collectProjectSessions);
    const selectedSessions = limitSessions > 0 ? sessions.slice(0, limitSessions) : sessions;
    state.total = selectedSessions.length;

    for (const session of selectedSessions) {
      try {
        const history = await sessionsService.fetchHistory(session.provider, session.id, {
          projectName: session.projectName,
          projectPath: session.projectPath,
          limit: null,
          offset: 0,
        });
        const messages = Array.isArray(history?.messages) ? history.messages : [];
        for (let index = 0; index < messages.length; index += 1) {
          const message = messages[index];
          if (message?.kind !== 'text' || message.role !== 'assistant' || !readString(message.content)) {
            continue;
          }
          const result = await autoCaptureChatKnowledge({
            source: 'chat-auto-capture',
            sourceId: `chat:${session.id}:message:${message.id || index}`,
            messageKey: message.id || `history-${index}`,
            projectName: session.projectName,
            sessionId: session.id,
            provider: session.provider,
            previousUserPrompt: previousUserPromptFor(messages, index),
            content: message.content,
            timestamp: message.timestamp,
          });
          if (result.captured) state.captured += 1;
          else state.skipped += 1;
        }
      } catch (error) {
        state.errors.push({
          sessionId: session.id,
          provider: session.provider,
          message: error?.message || 'Backfill failed for session.',
        });
      } finally {
        state.processed += 1;
      }
    }
  } finally {
    state.running = false;
    state.lastFinishedAt = new Date().toISOString();
  }

  return getObsidianAutoCaptureBackfillStatus();
};
