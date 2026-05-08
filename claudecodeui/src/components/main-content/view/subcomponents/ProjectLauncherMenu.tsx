import {
  Box,
  ChevronDown,
  Code2,
  FolderOpen,
  MonitorCog,
  SquareCode,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '../../../../lib/utils';
import { Button, Tooltip } from '../../../../shared/view/ui';
import type { Project } from '../../../../types/app';
import { api } from '../../../../utils/api';

type ProjectLauncherMenuProps = {
  selectedProject: Project;
};

type LauncherAction = {
  id: 'vscode' | 'visualstudio' | 'cursor' | 'antigravity' | 'explorer' | 'git-bash';
  label: string;
  kind: 'editor' | 'path' | 'terminal';
  icon: LucideIcon;
  iconClassName: string;
};

type LocalToolStatus = {
  id: string;
  label?: string;
  available?: boolean;
  source?: string | null;
};

const PROJECT_LAUNCH_ACTIONS: LauncherAction[] = [
  { id: 'vscode', label: 'VS Code', kind: 'editor', icon: Code2, iconClassName: 'text-sky-500' },
  { id: 'visualstudio', label: 'Visual Studio', kind: 'editor', icon: SquareCode, iconClassName: 'text-violet-500' },
  { id: 'cursor', label: 'Cursor', kind: 'editor', icon: Box, iconClassName: 'text-foreground' },
  { id: 'antigravity', label: 'Antigravity', kind: 'editor', icon: MonitorCog, iconClassName: 'text-muted-foreground' },
  { id: 'explorer', label: 'File Explorer', kind: 'path', icon: FolderOpen, iconClassName: 'text-amber-500' },
  { id: 'git-bash', label: 'Git Bash', kind: 'terminal', icon: Terminal, iconClassName: 'text-emerald-500' },
];

const PRIMARY_ACTION_ID = 'vscode';

async function readErrorMessage(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return typeof data?.error === 'string' && data.error.trim() ? data.error : fallback;
}

export default function ProjectLauncherMenu({ selectedProject }: ProjectLauncherMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [toolStatuses, setToolStatuses] = useState<Record<string, LocalToolStatus>>({});
  const projectPath = selectedProject.fullPath || selectedProject.path || '';

  useEffect(() => {
    let cancelled = false;

    const loadTools = async () => {
      try {
        const response = await api.localTools();
        if (!response.ok) {
          return;
        }
        const data = await response.json().catch(() => ({}));
        if (cancelled || !Array.isArray(data?.tools)) {
          return;
        }
        setToolStatuses(Object.fromEntries(
          data.tools.map((tool: LocalToolStatus) => [tool.id, tool]),
        ));
      } catch {
        if (!cancelled) {
          setToolStatuses({});
        }
      }
    };

    void loadTools();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const statusById = useMemo(() => toolStatuses, [toolStatuses]);

  const isActionAvailable = (action: LauncherAction) => {
    if (!projectPath) {
      return false;
    }
    const status = statusById[action.id];
    return action.kind === 'path' || status?.available !== false;
  };

  const openAction = async (action: LauncherAction) => {
    if (!isActionAvailable(action)) {
      return;
    }

    setOpeningId(action.id);
    try {
      const payload = { filePath: projectPath, projectName: selectedProject.name };
      const response = action.kind === 'path'
        ? await api.openLocalPath(payload)
        : action.kind === 'terminal'
          ? await api.openLocalTerminal({ ...payload, tool: action.id })
          : await api.openLocalToolFile({ ...payload, tool: action.id });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, `Failed to open ${action.label}`));
      }
      setIsOpen(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : `Failed to open ${action.label}`);
    } finally {
      setOpeningId(null);
    }
  };

  const primaryAction = PROJECT_LAUNCH_ACTIONS.find((action) => action.id === PRIMARY_ACTION_ID) || PROJECT_LAUNCH_ACTIONS[0];
  const PrimaryIcon = primaryAction.icon;

  return (
    <div ref={rootRef} className="relative hidden items-center sm:flex">
      <Tooltip content="Open project in local tool" position="bottom">
        <div className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-border bg-background shadow-sm">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-none px-2"
            disabled={Boolean(openingId) || !isActionAvailable(primaryAction)}
            onClick={() => void openAction(primaryAction)}
            aria-label={`Open in ${primaryAction.label}`}
          >
            <PrimaryIcon className={cn('h-4 w-4', primaryAction.iconClassName)} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-none border-l border-border px-1.5"
            disabled={Boolean(openingId) || !projectPath}
            onClick={() => setIsOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-label="Choose local launch tool"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
          </Button>
        </div>
      </Tooltip>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-border bg-popover p-1.5 shadow-xl"
        >
          {PROJECT_LAUNCH_ACTIONS.map((action) => {
            const Icon = action.icon;
            const available = isActionAvailable(action);
            const status = statusById[action.id];
            const subtitle = status?.source ? `Detected via ${status.source}` : available ? 'Ready' : 'Not detected';

            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                disabled={!available || Boolean(openingId)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                  available
                    ? 'text-foreground hover:bg-accent hover:text-accent-foreground'
                    : 'cursor-not-allowed text-muted-foreground/55',
                )}
                title={subtitle}
                onClick={() => void openAction(action)}
              >
                <Icon className={cn('h-4 w-4 shrink-0', action.iconClassName)} />
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                {openingId === action.id && (
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
