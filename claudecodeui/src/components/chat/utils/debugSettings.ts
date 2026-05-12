import { safeLocalStorage } from './chatStorage';

export const ARGUS_DEBUG_SETTINGS_KEY = 'argus-debug-settings';
export const ARGUS_DEBUG_SETTINGS_CHANGED_EVENT = 'argusDebugSettingsChanged';
export const ARGUS_PROMPT_INJECTION_DEBUG_EVENT = 'argusPromptInjectionDebug';
export const ARGUS_WEBSOCKET_MESSAGE_EVENT = 'argusWebSocketMessage';

export type ArgusDebugSettings = {
  showPromptInjectionPanel: boolean;
};

export const DEFAULT_ARGUS_DEBUG_SETTINGS: ArgusDebugSettings = {
  showPromptInjectionPanel: false,
};

export function normalizeArgusDebugSettings(value: unknown): ArgusDebugSettings {
  const parsed = value && typeof value === 'object' ? value as Partial<ArgusDebugSettings> : {};
  return {
    showPromptInjectionPanel: parsed.showPromptInjectionPanel === true,
  };
}

export function getArgusDebugSettings(): ArgusDebugSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_ARGUS_DEBUG_SETTINGS;
  }

  const raw = safeLocalStorage.getItem(ARGUS_DEBUG_SETTINGS_KEY);
  if (!raw) {
    return DEFAULT_ARGUS_DEBUG_SETTINGS;
  }

  try {
    return normalizeArgusDebugSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_ARGUS_DEBUG_SETTINGS;
  }
}

export function saveArgusDebugSettings(settings: ArgusDebugSettings) {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = normalizeArgusDebugSettings(settings);
  safeLocalStorage.setItem(ARGUS_DEBUG_SETTINGS_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event(ARGUS_DEBUG_SETTINGS_CHANGED_EVENT));
}
