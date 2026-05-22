import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';

import type { WorkflowNodeType } from '../../../types/workflow';

type WorkflowPaletteGroup = {
  id: string;
  label: string;
  types: WorkflowNodeType[];
};

type WorkflowPaletteNodeType = {
  type: WorkflowNodeType;
  label: string;
  icon: LucideIcon;
  description: string;
};

type WorkflowNodePaletteProps = {
  nodeSearch: string;
  paletteGroups: WorkflowPaletteGroup[];
  filteredNodeTypes: WorkflowPaletteNodeType[];
  riskyNodeTypes: Set<WorkflowNodeType>;
  onNodeSearchChange: (value: string) => void;
  onAddNode: (type: WorkflowNodeType) => void;
};

export function WorkflowNodePalette({
  nodeSearch,
  paletteGroups,
  filteredNodeTypes,
  riskyNodeTypes,
  onNodeSearchChange,
  onAddNode,
}: WorkflowNodePaletteProps) {
  return (
    <aside className="min-h-0 overflow-auto border-r border-border p-4">
      <h3 className="text-sm font-semibold text-foreground">Node palette</h3>
      <label className="mt-3 flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
        <Search className="h-4 w-4" />
        <input
          data-testid="workflow-node-search"
          value={nodeSearch}
          onChange={(event) => onNodeSearchChange(event.target.value)}
          placeholder="Search nodes"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
        />
      </label>
      <div className="mt-3 space-y-4">
        {paletteGroups.map((group) => {
          const items = filteredNodeTypes.filter((item) => group.types.includes(item.type));
          if (items.length === 0) return null;
          return (
            <section key={group.id}>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h4>
              <div className="grid gap-2">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      data-testid="workflow-add-node"
                      data-node-type={item.type}
                      onClick={() => onAddNode(item.type)}
                      className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-2.5 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{item.label}</span>
                        <span className="block text-xs text-muted-foreground">{item.description}</span>
                        {riskyNodeTypes.has(item.type) && <span className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">permission gate</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
