import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import {
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  ServerIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';

import { CLAUDE_MODELS } from '../../../../../shared/modelConstants';
import { cn } from '../../../../lib/utils';
import { apiFetch } from '../../../../utils/api';
import type { LLMProvider } from '../../../../types/app';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type RuntimeModelProfile = {
  id: string;
  name: string;
  model: string;
  baseUrl?: string;
  contextWindowTokens?: number;
  bareMode?: boolean;
  apiKey?: string;
  apiKeyConfigured?: boolean;
};

type RuntimeModelConfig = {
  activeProfileId: string;
  profiles: RuntimeModelProfile[];
};

type RuntimeModelSwitcherProps = {
  selectedProfileId?: string;
  onProfileChange?: (profileId: string) => void | Promise<void>;
  onRequestInputFocus?: () => void;
  hasConversationContext?: boolean;
  disabled?: boolean;
  variant?: 'empty' | 'toolbar';
  className?: string;
};

const MTL_CODE_PROVIDER: LLMProvider = 'claude';
const FALLBACK_MODEL_LABEL = CLAUDE_MODELS.OPTIONS[0]?.label || 'MTLCode';
const MODEL_SETTINGS_EVENT = 'mtlCodeModelSettingsChanged';

function formatContextWindow(tokens?: number) {
  if (!tokens || !Number.isFinite(tokens)) {
    return '';
  }

  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}M`;
  }

  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }

  return String(tokens);
}

function profileLabel(profile?: RuntimeModelProfile | null) {
  if (!profile) {
    return FALLBACK_MODEL_LABEL;
  }

  return profile.name || profile.model || FALLBACK_MODEL_LABEL;
}

function profileModel(profile?: RuntimeModelProfile | null) {
  if (!profile) {
    return FALLBACK_MODEL_LABEL;
  }

  return profile.model || profile.name || FALLBACK_MODEL_LABEL;
}

export default function RuntimeModelSwitcher({
  selectedProfileId,
  onProfileChange,
  onRequestInputFocus,
  hasConversationContext = false,
  disabled = false,
  variant = 'toolbar',
  className,
}: RuntimeModelSwitcherProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const [config, setConfig] = useState<RuntimeModelConfig>({
    activeProfileId: '',
    profiles: [],
  });
  const [activeRuntimeModel, setActiveRuntimeModel] = useState(FALLBACK_MODEL_LABEL);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState('');

  const activeProfile = useMemo(
    () => config.profiles.find((profile) => profile.id === config.activeProfileId) || config.profiles[0] || null,
    [config.activeProfileId, config.profiles],
  );

  const loadRuntimeModel = useCallback(async () => {
    setErrorText('');
    try {
      const response = await apiFetch('/api/settings/mtl-code-model');
      if (!response.ok) {
        throw new Error('Failed to load model settings');
      }

      const payload = await response.json();
      const profiles = Array.isArray(payload?.config?.profiles)
        ? payload.config.profiles as RuntimeModelProfile[]
        : [];
      const defaultActiveProfileId = typeof payload?.config?.activeProfileId === 'string'
        ? payload.config.activeProfileId
        : profiles[0]?.id || '';
      const activeProfileId = selectedProfileId || defaultActiveProfileId;
      const nextActiveProfile = profiles.find((profile) => profile.id === activeProfileId) || profiles[0] || null;
      const model = profileModel(nextActiveProfile);

      setConfig({ activeProfileId, profiles });
      setActiveRuntimeModel(typeof model === 'string' && model.trim() ? model : FALLBACK_MODEL_LABEL);
    } catch (error) {
      console.warn('Failed to load runtime model settings:', error);
      setErrorText('模型配置读取失败');
      setActiveRuntimeModel(FALLBACK_MODEL_LABEL);
    } finally {
      setIsLoading(false);
    }
  }, [selectedProfileId]);

  useEffect(() => {
    void loadRuntimeModel();

    const handleModelSettingsChanged = () => {
      void loadRuntimeModel();
    };

    window.addEventListener(MODEL_SETTINGS_EVENT, handleModelSettingsChanged);
    return () => {
      window.removeEventListener(MODEL_SETTINGS_EVENT, handleModelSettingsChanged);
    };
  }, [loadRuntimeModel]);

  useEffect(() => {
    if (!selectedProfileId) {
      return;
    }

    const selectedProfile = config.profiles.find((profile) => profile.id === selectedProfileId);
    if (selectedProfile) {
      setActiveRuntimeModel(profileModel(selectedProfile));
    }
    setConfig((current) => (
      current.activeProfileId === selectedProfileId
        ? current
        : { ...current, activeProfileId: selectedProfileId }
    ));
  }, [config.profiles, selectedProfileId]);

  const restoreInputFocus = useCallback(() => {
    window.setTimeout(() => {
      onRequestInputFocus?.();
    }, 0);
  }, [onRequestInputFocus]);

  const closePanel = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    setPendingProfileId(null);
    if (restoreFocus) {
      restoreInputFocus();
    }
  }, [restoreInputFocus]);

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel || typeof window === 'undefined') {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const spacing = 8;
    const width = Math.min(window.innerWidth - viewportPadding * 2, variant === 'empty' ? 360 : 300);
    let left = variant === 'empty'
      ? triggerRect.left + triggerRect.width / 2 - width / 2
      : triggerRect.left;
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - width - viewportPadding));

    const measuredHeight = panel.offsetHeight || 360;
    const spaceBelow = window.innerHeight - triggerRect.bottom - spacing - viewportPadding;
    const spaceAbove = triggerRect.top - spacing - viewportPadding;
    const openBelow = spaceBelow >= Math.min(measuredHeight, 360) || spaceBelow >= spaceAbove;
    const availableHeight = Math.min(
      window.innerHeight - viewportPadding * 2,
      Math.max(220, openBelow ? spaceBelow : spaceAbove),
    );
    const panelHeight = Math.min(measuredHeight, availableHeight);
    const top = openBelow
      ? Math.min(triggerRect.bottom + spacing, window.innerHeight - viewportPadding - panelHeight)
      : Math.max(viewportPadding, triggerRect.top - spacing - panelHeight);

    setPanelStyle({
      position: 'fixed',
      top,
      left,
      width,
      maxHeight: availableHeight,
      zIndex: 95,
    });
  }, [variant]);

  useEffect(() => {
    if (!isOpen) {
      setPanelStyle(null);
      return;
    }

    const rafId = window.requestAnimationFrame(updatePanelPosition);
    const handleViewportChange = () => updatePanelPosition();

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isOpen, pendingProfileId, updatePanelPosition]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }

      closePanel();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePanel(true);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closePanel, isOpen]);

  const applyProfileSwitch = async (profileId: string) => {
    if (!profileId || profileId === config.activeProfileId || isSwitching) {
      closePanel(true);
      return;
    }

    const nextProfile = config.profiles.find((profile) => profile.id === profileId);
    if (!nextProfile) {
      return;
    }

    setIsSwitching(true);
    setErrorText('');
    try {
      await onProfileChange?.(profileId);
      setConfig((current) => ({ ...current, activeProfileId: profileId }));
      setActiveRuntimeModel(profileModel(nextProfile));
      closePanel(true);
    } catch (error) {
      console.error(error);
      setErrorText('模型切换失败，请检查模型配置后重试');
    } finally {
      setIsSwitching(false);
    }
  };

  const switchProfile = (profileId: string) => {
    if (!profileId || profileId === config.activeProfileId || isSwitching) {
      closePanel(true);
      return;
    }

    if (hasConversationContext) {
      setErrorText('');
      setPendingProfileId(profileId);
      return;
    }

    void applyProfileSwitch(profileId);
  };

  const contextLabel = formatContextWindow(activeProfile?.contextWindowTokens);
  const triggerDisabled = disabled || isSwitching || (isLoading && config.profiles.length === 0);

  const trigger = variant === 'empty' ? (
    <button
      ref={triggerRef}
      type="button"
      disabled={triggerDisabled}
      onClick={() => setIsOpen((current) => !current)}
      className={cn(
        'group mx-auto flex w-full max-w-[360px] items-center gap-3 rounded-2xl border border-border/70 bg-card/95 px-4 py-3 text-left shadow-sm transition-all',
        'hover:border-primary/35 hover:bg-primary/[0.03] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70',
        isOpen && 'border-primary/40 bg-primary/[0.04] shadow-md',
        className,
      )}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      title="切换当前会话的 MTL-Code 运行模型"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
        <SessionProviderLogo provider={MTL_CODE_PROVIDER} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
          <span className="shrink-0">MTL-Code</span>
          <span className="text-muted-foreground">/</span>
          <span className="truncate">{profileLabel(activeProfile)}</span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{activeRuntimeModel}</span>
          {contextLabel && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{contextLabel}</span>}
        </span>
      </span>
      {isSwitching ? (
        <Loader2Icon className="h-4 w-4 shrink-0 animate-spin text-primary" />
      ) : (
        <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
      )}
    </button>
  ) : (
    <button
      ref={triggerRef}
      type="button"
      disabled={triggerDisabled}
      onClick={() => setIsOpen((current) => !current)}
      className={cn(
        'flex h-9 min-w-[156px] max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        isOpen
          ? 'border-primary/35 bg-primary/10 text-primary'
          : 'border-border/60 bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        className,
      )}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      title="切换当前会话的 MTL-Code 运行模型"
    >
      <ServerIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left font-medium">
        {profileLabel(activeProfile)}
      </span>
      {isSwitching ? (
        <Loader2Icon className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        <ChevronDownIcon className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isOpen && 'rotate-180')} />
      )}
    </button>
  );

  return (
    <>
      {trigger}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={panelStyle || { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
          className={cn(
            'flex flex-col overflow-hidden border border-border/70 bg-card shadow-2xl ring-1 ring-black/5 backdrop-blur-md',
            variant === 'toolbar' ? 'rounded-xl' : 'rounded-2xl',
          )}
          role="dialog"
          aria-modal="false"
        >
          <div className={cn(
            'flex items-start justify-between gap-3 border-b border-border/50',
            variant === 'toolbar' ? 'px-3 py-2.5' : 'px-4 py-3',
          )}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary',
                  variant === 'toolbar' ? 'h-6 w-6' : 'h-7 w-7',
                )}>
                  <SparklesIcon className={variant === 'toolbar' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">切换模型</h3>
                  {variant !== 'toolbar' && (
                    <p className="truncate text-[11px] text-muted-foreground">只应用到当前会话</p>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => closePanel(true)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="关闭模型切换"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>

          {hasConversationContext && variant !== 'toolbar' && (
            <div className="border-b border-amber-200/70 bg-amber-50 px-4 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              当前会话已有上下文，切换模型可能影响后续回复的连贯性。
            </div>
          )}

          {errorText && (
            <div className="mx-3 mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {errorText}
            </div>
          )}

          <div
            className={cn('min-h-0 overflow-y-auto', variant === 'toolbar' ? 'max-h-[270px] p-1.5' : 'p-2')}
            onWheel={(event) => event.stopPropagation()}
          >
            {isLoading && config.profiles.length === 0 && (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2Icon className="h-4 w-4 animate-spin" />
                正在读取模型配置...
              </div>
            )}

            {!isLoading && config.profiles.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                暂无模型配置，请先在设置里添加模型。
              </div>
            )}

            {config.profiles.map((profile) => {
              const selected = profile.id === config.activeProfileId;
              const isPending = profile.id === pendingProfileId;
              const itemContextLabel = formatContextWindow(profile.contextWindowTokens);

              return (
                <div key={profile.id} className={cn(isPending && 'rounded-xl bg-amber-50/70 p-1 dark:bg-amber-950/20')}>
                  <button
                    type="button"
                    disabled={isSwitching}
                    onClick={() => switchProfile(profile.id)}
                    className={cn(
                      'flex w-full items-start text-left transition-colors disabled:cursor-wait disabled:opacity-70',
                      variant === 'toolbar' ? 'gap-2 rounded-lg px-2 py-2' : 'gap-3 rounded-xl px-3 py-2.5',
                      selected
                        ? 'bg-primary/10 text-primary'
                        : isPending
                          ? 'bg-background/80 text-foreground shadow-sm ring-1 ring-amber-200 dark:ring-amber-900/60'
                          : 'text-foreground hover:bg-muted/70',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex shrink-0 items-center justify-center rounded-lg border',
                        variant === 'toolbar' ? 'h-6 w-6' : 'h-7 w-7',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : isPending
                            ? 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
                            : 'border-border bg-background text-muted-foreground',
                      )}
                    >
                      {selected
                        ? <CheckIcon className={variant === 'toolbar' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                        : <ServerIcon className={variant === 'toolbar' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={cn('truncate font-semibold', variant === 'toolbar' ? 'text-xs' : 'text-sm')}>
                          {profileLabel(profile)}
                        </span>
                        {selected && (
                          <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            当前
                          </span>
                        )}
                      </span>
                      <span className={cn('mt-0.5 block truncate text-muted-foreground', variant === 'toolbar' ? 'text-[11px]' : 'text-xs')}>
                        {profileModel(profile)}
                      </span>
                      <span className={cn('mt-1 flex min-w-0 flex-wrap gap-1 text-muted-foreground', variant === 'toolbar' ? 'text-[10px]' : 'text-[11px]')}>
                        {itemContextLabel && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5">
                            上下文 {itemContextLabel}
                          </span>
                        )}
                        {profile.baseUrl && variant !== 'toolbar' && (
                          <span className="max-w-full truncate rounded-full bg-muted px-2 py-0.5">
                            {profile.baseUrl.replace(/^https?:\/\//, '')}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>

                  {isPending && (
                    <div className={cn(
                      'mt-1 rounded-lg border border-amber-200 bg-background/95 p-2 text-amber-900 shadow-sm dark:border-amber-900/60 dark:bg-background dark:text-amber-100',
                      variant === 'toolbar' ? 'mx-1' : 'mx-2',
                    )}>
                      <div className="text-xs font-semibold text-foreground">
                        当前会话已有上下文
                      </div>
                      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                        后续回复将改用 {profileLabel(profile)}，历史内容不会丢失。
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => closePanel(true)}
                          className="h-7 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          disabled={isSwitching}
                          onClick={() => void applyProfileSwitch(profile.id)}
                          className="h-7 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isSwitching ? '切换中...' : '确认切换'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
