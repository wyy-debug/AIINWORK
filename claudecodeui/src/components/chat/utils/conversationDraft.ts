import type { Project, ProjectSession } from '../../../types/app';

export type ConversationDraftMode = 'replace' | 'append';

export type ConversationDraftPayload = {
  id: string;
  scope: 'conversations';
  mode: ConversationDraftMode;
  text: string;
  targetSessionId?: string | null;
  sourceSessionId?: string;
  sourceProjectName?: string;
  sourceTitle?: string;
  createdAt: number;
};

export const CONVERSATION_DRAFT_STORAGE_KEY = 'mtl-code:conversation-draft';
export const CONVERSATION_DRAFT_EVENT = 'mtl-code:conversation-draft';

type DraftTarget = {
  isConversationSpace: boolean;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
};

function isConversationDraftPayload(value: unknown): value is ConversationDraftPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Partial<ConversationDraftPayload>;
  return payload.scope === 'conversations'
    && (payload.mode === 'replace' || payload.mode === 'append')
    && typeof payload.text === 'string'
    && payload.text.trim().length > 0
    && typeof payload.id === 'string';
}

export function saveConversationDraft(payload: ConversationDraftPayload) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(CONVERSATION_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent(CONVERSATION_DRAFT_EVENT, { detail: payload }));
}

export function readStoredConversationDraft(): ConversationDraftPayload | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.sessionStorage.getItem(CONVERSATION_DRAFT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return isConversationDraftPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearStoredConversationDraft(payloadId?: string) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!payloadId) {
    window.sessionStorage.removeItem(CONVERSATION_DRAFT_STORAGE_KEY);
    return;
  }

  const current = readStoredConversationDraft();
  if (!current || current.id === payloadId) {
    window.sessionStorage.removeItem(CONVERSATION_DRAFT_STORAGE_KEY);
  }
}

export function shouldApplyConversationDraft(payload: ConversationDraftPayload, target: DraftTarget) {
  if (!target.isConversationSpace || !target.selectedProject) {
    return false;
  }

  const activeSessionId = target.selectedSession?.id || target.currentSessionId || null;
  if (payload.targetSessionId) {
    return activeSessionId === payload.targetSessionId;
  }

  return !activeSessionId;
}

export function getConversationDraftFromEvent(event: Event): ConversationDraftPayload | null {
  const detail = event instanceof CustomEvent ? event.detail : null;
  return isConversationDraftPayload(detail) ? detail : null;
}
