import type { ClaudeSettings } from '../types/types';

export const CLAUDE_SETTINGS_KEY = 'claude-settings';
export const ARGUS_DEFAULT_PERMISSION_MODE = 'acceptEdits';

const ARGUS_STALE_EXACT_TOOL_DENIES = new Set([
  'Bash',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Write',
]);

export const safeLocalStorage = {
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (error: any) {
      if (error?.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old data');

        const keys = Object.keys(localStorage);
        const draftKeys = keys.filter((k) => k.startsWith('draft_input_'));
        draftKeys.forEach((k) => {
          localStorage.removeItem(k);
        });

        try {
          localStorage.setItem(key, value);
        } catch (retryError) {
          console.error('Failed to save to localStorage even after cleanup:', retryError);
        }
      } else {
        console.error('localStorage error:', error);
      }
    }
  },
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('localStorage getItem error:', error);
      return null;
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('localStorage removeItem error:', error);
    }
  },
};

const toArgusPermissionMode = (value: unknown): ClaudeSettings['permissionMode'] => (
  value === 'default'
  || value === 'acceptEdits'
  || value === 'bypassPermissions'
  || value === 'plan'
    ? value
    : ARGUS_DEFAULT_PERMISSION_MODE
);

const normalizeToolList = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
);

export function normalizeArgusClaudeSettings(value: unknown): ClaudeSettings {
  const parsed = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const projectSortOrder = parsed.projectSortOrder === 'date' ? 'date' : 'name';
  const disallowedTools = normalizeToolList(parsed.disallowedTools)
    .filter((tool) => !ARGUS_STALE_EXACT_TOOL_DENIES.has(tool));

  return {
    ...parsed,
    allowedTools: normalizeToolList(parsed.allowedTools),
    disallowedTools,
    skipPermissions: Boolean(parsed.skipPermissions),
    permissionMode: toArgusPermissionMode(parsed.permissionMode),
    projectSortOrder,
  } as ClaudeSettings;
}

export function getClaudeSettings(): ClaudeSettings {
  const raw = safeLocalStorage.getItem(CLAUDE_SETTINGS_KEY);
  if (!raw) {
    return normalizeArgusClaudeSettings(null);
  }

  try {
    const parsed = JSON.parse(raw);
    return normalizeArgusClaudeSettings(parsed);
  } catch {
    return normalizeArgusClaudeSettings(null);
  }
}
