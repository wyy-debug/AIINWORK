import { useCallback, useEffect, useRef, useState } from 'react';
import { CLAUDE_MODELS } from '../../../../shared/modelConstants';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';
import type { ProjectSession, LLMProvider } from '../../../types/app';

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
}

const MTL_CODE_PROVIDER: LLMProvider = 'claude';
const MTL_CODE_MODEL = CLAUDE_MODELS.DEFAULT;

const readStoredMtlCodeModel = () => {
  const stored = localStorage.getItem('claude-model');
  return CLAUDE_MODELS.OPTIONS.some((option: { value: string }) => option.value === stored)
    ? stored || MTL_CODE_MODEL
    : MTL_CODE_MODEL;
};

export function useChatProviderState({ selectedSession }: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
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
    if (!selectedSession?.id) {
      return;
    }

    const savedMode = localStorage.getItem(`permissionMode-${selectedSession.id}`);
    setPermissionMode((savedMode as PermissionMode) || 'default');
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

  const cyclePermissionMode = useCallback(() => {
    const modes: PermissionMode[] =
      provider === 'codex'
        ? ['default', 'acceptEdits', 'bypassPermissions']
        : ['default', 'acceptEdits', 'bypassPermissions', 'plan'];

    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];
    setPermissionMode(nextMode);

    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    }
  }, [permissionMode, provider, selectedSession?.id]);

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
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  };
}
