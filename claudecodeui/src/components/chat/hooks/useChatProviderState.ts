import { useCallback, useEffect, useRef, useState } from 'react';

import { CLAUDE_MODELS } from '../../../../shared/modelConstants';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';
import type { ProjectSession, LLMProvider } from '../../../types/app';
import {
  ARGUS_DEFAULT_PERMISSION_MODE,
  CLAUDE_SETTINGS_KEY,
  getClaudeSettings,
  normalizeArgusClaudeSettings,
} from '../utils/chatStorage';

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
}

const MTL_CODE_PROVIDER: LLMProvider = 'claude';
const MTL_CODE_MODEL = CLAUDE_MODELS.DEFAULT;

const toPermissionMode = (value: unknown): PermissionMode => (
  value === 'default'
  || value === 'acceptEdits'
  || value === 'bypassPermissions'
  || value === 'plan'
    ? value
    : ARGUS_DEFAULT_PERMISSION_MODE
);

const readStoredPermissionMode = (): PermissionMode => {
  return getClaudeSettings().permissionMode || ARGUS_DEFAULT_PERMISSION_MODE;
};

const writeStoredPermissionMode = (permissionMode: PermissionMode) => {
  try {
    const rawSettings = localStorage.getItem(CLAUDE_SETTINGS_KEY);
    const settings = rawSettings
      ? normalizeArgusClaudeSettings(JSON.parse(rawSettings))
      : normalizeArgusClaudeSettings(null);
    localStorage.setItem(CLAUDE_SETTINGS_KEY, JSON.stringify({
      ...settings,
      permissionMode,
      lastUpdated: new Date().toISOString(),
    }));
  } catch {
    localStorage.setItem(CLAUDE_SETTINGS_KEY, JSON.stringify({
      permissionMode,
      lastUpdated: new Date().toISOString(),
    }));
  }

  window.dispatchEvent(new Event('claudeSettingsChanged'));
};

const readStoredMtlCodeModel = () => {
  const stored = localStorage.getItem('claude-model');
  return CLAUDE_MODELS.OPTIONS.some((option: { value: string }) => option.value === stored)
    ? stored || MTL_CODE_MODEL
    : MTL_CODE_MODEL;
};

export function useChatProviderState({ selectedSession }: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => readStoredPermissionMode());
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [provider, setProvider] = useState<LLMProvider>(MTL_CODE_PROVIDER);
  const [cursorModel, setCursorModel] = useState<string>(() => {
    return MTL_CODE_MODEL;
  });
  const [claudeModel, setClaudeModel] = useState<string>(() => {
    return readStoredMtlCodeModel();
  });
  const [codexModel, setCodexModel] = useState<string>(() => {
    return MTL_CODE_MODEL;
  });
  const [geminiModel, setGeminiModel] = useState<string>(() => {
    return MTL_CODE_MODEL;
  });

  const lastProviderRef = useRef(provider);

  useEffect(() => {
    if (provider !== MTL_CODE_PROVIDER) {
      setProvider(MTL_CODE_PROVIDER);
    }

    if (claudeModel !== MTL_CODE_MODEL) {
      setClaudeModel(MTL_CODE_MODEL);
    }

    localStorage.setItem('selected-provider', MTL_CODE_PROVIDER);
    localStorage.setItem('claude-model', MTL_CODE_MODEL);
  }, [claudeModel, provider]);

  useEffect(() => {
    const syncPermissionMode = () => {
      setPermissionMode(readStoredPermissionMode());
    };

    syncPermissionMode();
    window.addEventListener('storage', syncPermissionMode);
    window.addEventListener('claudeSettingsChanged', syncPermissionMode);

    return () => {
      window.removeEventListener('storage', syncPermissionMode);
      window.removeEventListener('claudeSettingsChanged', syncPermissionMode);
    };
  }, [selectedSession?.id]);

  useEffect(() => {
    if (lastProviderRef.current === provider) {
      return;
    }
    setPendingPermissionRequests([]);
    lastProviderRef.current = provider;
  }, [provider]);

  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  const updatePermissionMode = useCallback((nextMode: PermissionMode) => {
    const normalizedMode = toPermissionMode(nextMode);
    setPermissionMode(normalizedMode);
    writeStoredPermissionMode(normalizedMode);
  }, []);

  const cyclePermissionMode = useCallback(() => {
    const modes: PermissionMode[] =
      provider === 'codex'
        ? ['default', 'acceptEdits', 'bypassPermissions']
        : ['default', 'acceptEdits', 'bypassPermissions', 'plan'];

    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];
    updatePermissionMode(nextMode);
  }, [permissionMode, provider, updatePermissionMode]);

  return {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    geminiModel,
    setGeminiModel,
    permissionMode,
    setPermissionMode: updatePermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  };
}
