import { useEffect, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Home,
  MoreHorizontal,
  Pin,
  PinOff,
  Trash2,
  Edit2,
} from 'lucide-react';

import { cn } from '../../../../lib/utils';

type MenuPosition = {
  x: number;
  y: number;
};

export type SessionContextMenuProps = {
  position: MenuPosition;
  isPinned?: boolean;
  isArchived?: boolean;
  isUnread?: boolean;
  canOpenWorkdir?: boolean;
  canDispatchLocal?: boolean;
  canDispatchWorktree?: boolean;
  onClose: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onToggleUnread: () => void;
  onOpenWorkdir?: () => void;
  onCopyWorkdir?: () => void;
  onCopySessionId: () => void;
  onCopyDeepLink: () => void;
  onDispatchLocal?: () => void;
  onDispatchWorktree?: () => void;
  onOpenMiniWindow: () => void;
  onDelete: () => void;
};

type MenuItemProps = {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
};

function clampMenuPosition(position: MenuPosition) {
  if (typeof window === 'undefined') {
    return position;
  }
  return {
    x: Math.min(position.x, Math.max(12, window.innerWidth - 236)),
    y: Math.min(position.y, Math.max(12, window.innerHeight - 360)),
  };
}

function MenuItem({ icon, label, destructive = false, disabled = false, onSelect }: MenuItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition',
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-accent',
        disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent',
      )}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) {
          onSelect?.();
        }
      }}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export default function SessionContextMenu({
  position,
  isPinned = false,
  isArchived = false,
  isUnread = false,
  canOpenWorkdir = false,
  canDispatchLocal = false,
  canDispatchWorktree = false,
  onClose,
  onRename,
  onTogglePin,
  onToggleArchive,
  onToggleUnread,
  onOpenWorkdir,
  onCopyWorkdir,
  onCopySessionId,
  onCopyDeepLink,
  onDispatchLocal,
  onDispatchWorktree,
  onOpenMiniWindow,
  onDelete,
}: SessionContextMenuProps) {
  const menuPosition = clampMenuPosition(position);

  useEffect(() => {
    const handleDismiss = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('resize', handleDismiss);
    document.addEventListener('mousedown', handleDismiss);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', handleDismiss);
      document.removeEventListener('mousedown', handleDismiss);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const select = (handler?: () => void) => () => {
    handler?.();
    onClose();
  };

  return (
    <div
      className="fixed z-[90] w-56 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
      style={{ left: menuPosition.x, top: menuPosition.y }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      role="menu"
    >
      <MenuItem icon={<Edit2 className="h-4 w-4" />} label="重命名对话" onSelect={select(onRename)} />
      <MenuItem
        icon={isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        label={isPinned ? '取消置顶' : '置顶对话'}
        onSelect={select(onTogglePin)}
      />
      <MenuItem
        icon={isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
        label={isArchived ? '恢复会话' : '归档对话'}
        onSelect={select(onToggleArchive)}
      />
      <MenuItem
        icon={<CheckCircle2 className="h-4 w-4" />}
        label={isUnread ? '标记为已读' : '标记为未读'}
        onSelect={select(onToggleUnread)}
      />

      <div className="my-1 border-t border-border" />

      <MenuItem
        icon={<FolderOpen className="h-4 w-4" />}
        label="在资源管理器中打开"
        disabled={!canOpenWorkdir}
        onSelect={select(onOpenWorkdir)}
      />
      <MenuItem
        icon={<Copy className="h-4 w-4" />}
        label="复制工作目录"
        disabled={!canOpenWorkdir}
        onSelect={select(onCopyWorkdir)}
      />
      <MenuItem icon={<Copy className="h-4 w-4" />} label="复制会话 ID" onSelect={select(onCopySessionId)} />
      <MenuItem icon={<ExternalLink className="h-4 w-4" />} label="复制深度链接" onSelect={select(onCopyDeepLink)} />

      <div className="my-1 border-t border-border" />

      <MenuItem
        icon={<Home className="h-4 w-4" />}
        label="派生到本地"
        disabled={!canDispatchLocal}
        onSelect={select(onDispatchLocal)}
      />
      <MenuItem
        icon={<GitBranch className="h-4 w-4" />}
        label="派生到新工作树"
        disabled={!canDispatchWorktree}
        onSelect={select(onDispatchWorktree)}
      />

      <div className="my-1 border-t border-border" />

      <MenuItem icon={<MoreHorizontal className="h-4 w-4" />} label="在迷你窗口中打开" onSelect={select(onOpenMiniWindow)} />
      <MenuItem icon={<Trash2 className="h-4 w-4" />} label="删除对话" destructive onSelect={select(onDelete)} />
    </div>
  );
}
