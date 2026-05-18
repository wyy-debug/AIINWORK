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
  BugIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardCheckIcon,
  CompassIcon,
  FileTextIcon,
  HammerIcon,
  ListChecksIcon,
} from 'lucide-react';

import {
  BUILT_IN_AGENT_PROFILES,
  DEFAULT_AGENT_PROFILE_KIND,
  getAgentProfile,
} from '../../../../../shared/agentProfiles.js';
import { cn } from '../../../../lib/utils';

type AgentProfileSwitcherProps = {
  selectedProfileKind?: string;
  onProfileChange?: (profileKind: string) => void;
  disabled?: boolean;
  onRequestInputFocus?: () => void;
};

const PROFILE_ICONS: Record<string, typeof HammerIcon> = {
  plan: ListChecksIcon,
  build: HammerIcon,
  explore: CompassIcon,
  review: ClipboardCheckIcon,
  debug: BugIcon,
  docs: FileTextIcon,
};

export default function AgentProfileSwitcher({
  selectedProfileKind = DEFAULT_AGENT_PROFILE_KIND,
  onProfileChange,
  disabled = false,
  onRequestInputFocus,
}: AgentProfileSwitcherProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const activeProfile = useMemo(
    () => getAgentProfile(selectedProfileKind, DEFAULT_AGENT_PROFILE_KIND) || BUILT_IN_AGENT_PROFILES[0],
    [selectedProfileKind],
  );
  const ActiveIcon = PROFILE_ICONS[activeProfile.kind] || HammerIcon;

  const closePanel = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => onRequestInputFocus?.(), 0);
    }
  }, [onRequestInputFocus]);

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel || typeof window === 'undefined') {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const width = Math.min(320, window.innerWidth - viewportPadding * 2);
    const spacing = 8;
    const measuredHeight = panel.offsetHeight || 360;
    const availableAbove = Math.max(220, triggerRect.top - viewportPadding - spacing);
    const panelHeight = Math.min(measuredHeight, availableAbove);
    const top = Math.max(viewportPadding, triggerRect.top - spacing - panelHeight);
    const left = Math.max(
      viewportPadding,
      Math.min(triggerRect.left, window.innerWidth - width - viewportPadding),
    );

    setPanelStyle({
      position: 'fixed',
      top,
      left,
      width,
      maxHeight: availableAbove,
      zIndex: 96,
    });
  }, []);

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
  }, [isOpen, updatePanelPosition]);

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

  const selectProfile = (profileKind: string) => {
    onProfileChange?.(profileKind);
    closePanel(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          'flex h-9 min-w-[118px] max-w-[168px] items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          isOpen
            ? 'border-primary/35 bg-primary/10 text-primary'
            : 'border-border/60 bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title="Switch Agent Profile"
      >
        <ActiveIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left font-medium">{activeProfile.shortName}</span>
        <ChevronDownIcon className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={panelStyle || { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
          className="flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl ring-1 ring-black/5 backdrop-blur-md"
          role="listbox"
          aria-label="Agent Profile"
        >
          <div className="border-b border-border/50 px-3 py-2.5">
            <div className="text-sm font-semibold text-foreground">Agent Profile</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">@debug / @docs can switch one message</div>
          </div>
          <div className="min-h-0 overflow-y-auto p-1.5" onWheel={(event) => event.stopPropagation()}>
            {BUILT_IN_AGENT_PROFILES.map((profile) => {
              const selected = profile.kind === activeProfile.kind;
              const ProfileIcon = PROFILE_ICONS[profile.kind] || HammerIcon;
              return (
                <button
                  key={profile.kind}
                  type="button"
                  onClick={() => selectProfile(profile.kind)}
                  disabled={disabled}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    selected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/70',
                  )}
                  role="option"
                  aria-selected={selected}
                >
                  <span className={cn(
                    'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border',
                    selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground',
                  )}>
                    {selected ? <CheckIcon className="h-3.5 w-3.5" /> : <ProfileIcon className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{profile.name}</span>
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {profile.permissionPreset}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                      {profile.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
