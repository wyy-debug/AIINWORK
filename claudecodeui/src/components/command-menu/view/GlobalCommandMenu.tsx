import { useEffect, useMemo, useState } from 'react';
import { FileDiff, FileText, GitBranch, Globe2, Layers3, Network, Play, Search } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

import type { AppTab, Project } from '../../../types/app';
import { apiFetch } from '../../../utils/api';
import { Input } from '../../../shared/view/ui';
import { cn } from '../../../lib/utils';

type CommandItem = {
  name: string;
  description: string;
  tab?: AppTab;
  mode?: string;
};

type GlobalCommandMenuProps = {
  selectedProject: Project | null;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
};

const BUILT_IN: CommandItem[] = [
  { name: '/changes', description: 'Open local changes review', tab: 'review' },
  { name: '/review', description: 'Open local changes review', tab: 'review' },
  { name: '/run', description: 'Open project run actions', tab: 'actions' },
  { name: '/actions', description: 'Open project run actions', tab: 'actions' },
  { name: '/preview', description: 'Open local preview', tab: 'browser' },
  { name: '/browser', description: 'Open local preview', tab: 'browser' },
  { name: '/results', description: 'Open saved results', tab: 'artifacts' },
  { name: '/artifacts', description: 'Open saved results', tab: 'artifacts' },
  { name: '/subagents', description: 'Open Subagent workspace', tab: 'subagents' },
  { name: '/workflows', description: 'Open Agent Workflow Studio', tab: 'workflows' },
  { name: '/worktree', description: 'Open Worktree controls', tab: 'actions', mode: 'worktree' },
  { name: '/status', description: 'Show Argus status', tab: 'chat' },
  { name: '/mcp', description: 'Open MCP settings', tab: 'chat', mode: 'mcp' },
  { name: '/plan-mode', description: 'Insert a plan-mode instruction', tab: 'chat', mode: 'plan-mode' },
];
const VISIBLE_COMMANDS = new Set(BUILT_IN.map((command) => command.name));

const iconFor = (name: string) => {
  if (name.includes('review')) return FileDiff;
  if (name.includes('changes')) return FileDiff;
  if (name.includes('browser')) return Globe2;
  if (name.includes('preview')) return Globe2;
  if (name.includes('artifact') || name.includes('result')) return FileText;
  if (name.includes('subagent')) return Network;
  if (name.includes('workflow')) return GitBranch;
  if (name.includes('action') || name.includes('worktree')) return Play;
  if (name.includes('run')) return Play;
  return Layers3;
};

export default function GlobalCommandMenu({ selectedProject, setActiveTab }: GlobalCommandMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [commands, setCommands] = useState<CommandItem[]>(BUILT_IN);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const loadCommands = async () => {
      try {
        const response = await apiFetch('/api/commands/list', {
          method: 'POST',
          body: JSON.stringify({ projectPath: selectedProject?.fullPath || selectedProject?.path || '' }),
        });
        const data = await response.json();
        const remoteCommands = [
          ...(Array.isArray(data?.builtIn) ? data.builtIn : []),
          ...(Array.isArray(data?.custom) ? data.custom : []),
        ].map((command: any) => ({
          name: String(command.name || ''),
          description: String(command.description || ''),
          tab: command?.metadata?.tab,
          mode: command?.metadata?.mode,
        })).filter((command) => VISIBLE_COMMANDS.has(command.name));
        const merged = [...BUILT_IN, ...remoteCommands].filter((command, index, list) => (
          command.name && list.findIndex((item) => item.name === command.name) === index
        ));
        setCommands(merged);
      } catch {
        setCommands(BUILT_IN);
      }
    };
    void loadCommands();
  }, [open, selectedProject?.fullPath, selectedProject?.path]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) => (
      command.name.toLowerCase().includes(normalized)
      || command.description.toLowerCase().includes(normalized)
    ));
  }, [commands, query]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-background/55 pt-[12vh] backdrop-blur-sm">
      <div className="w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands..."
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-[420px] overflow-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">No commands found.</div>
          ) : filtered.map((command) => {
            const Icon = iconFor(command.name);
            return (
              <button
                key={command.name}
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-accent/60',
                  command.tab ? 'text-foreground' : 'text-muted-foreground',
                )}
	                onClick={() => {
                    if (command.name === '/mcp' || command.mode === 'mcp') {
                      window.openSettings?.('mcp');
                    }
                    if (command.name === '/plan-mode' || command.mode === 'plan-mode') {
                      window.dispatchEvent(new CustomEvent('argus-append-chat-input', {
                        detail: { text: 'Please work in plan mode first.' },
                      }));
                    }
	                  if (command.tab) {
                    setActiveTab(command.tab);
                    window.dispatchEvent(new CustomEvent('argus-open-panel', {
                      detail: { panel: command.tab, mode: command.mode },
                    }));
                    window.dispatchEvent(new CustomEvent('argus-open-tab', {
                      detail: { tab: command.tab, mode: command.mode },
                    }));
                  }
                  setOpen(false);
                  setQuery('');
                }}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{command.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{command.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
