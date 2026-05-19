import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Download,
  FileText,
  GitBranch,
  History,
  LibraryBig,
  Link2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Square,
  Upload,
  X,
  Zap,
} from 'lucide-react';

import { api } from '../../../utils/api';
import { cn } from '../../../lib/utils';
import type { Project } from '../../../types/app';
import type { AgentConfig } from '../../../types/agent';
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode, WorkflowNodeType, WorkflowRun } from '../../../types/workflow';

type WorkflowStudioProps = {
  selectedProject: Project;
  sessionId?: string | null;
};

type StudioView = 'Library' | 'Editor' | 'Runs';

const views: StudioView[] = ['Library', 'Editor', 'Runs'];

const nodeTypes: Array<{ type: WorkflowNodeType; label: string; icon: typeof Bot; description: string }> = [
  { type: 'agent', label: 'Agent', icon: Bot, description: 'Primary agent step' },
  { type: 'subagent', label: 'Subagent', icon: GitBranch, description: 'Focused side agent' },
  { type: 'mcp', label: 'MCP', icon: Zap, description: 'MCP server tool' },
  { type: 'tool', label: 'Tool', icon: Braces, description: 'Built-in tool' },
  { type: 'shell', label: 'Shell', icon: CircleDot, description: 'Command gate' },
  { type: 'artifact', label: 'Artifact', icon: FileText, description: 'Collect output' },
  { type: 'approval', label: 'Approval', icon: ClipboardCheck, description: 'Human gate' },
  { type: 'condition', label: 'Condition', icon: ChevronRight, description: 'Branch rule' },
  { type: 'join', label: 'Join', icon: Link2, description: 'Wait for inputs' },
];

const statusTone: Record<string, string> = {
  pending: 'border-slate-200 bg-slate-50 text-slate-700',
  ready: 'border-blue-200 bg-blue-50 text-blue-700',
  running: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  waiting_approval: 'border-amber-200 bg-amber-50 text-amber-700',
  completed: 'border-green-200 bg-green-50 text-green-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
  skipped: 'border-slate-200 bg-slate-50 text-slate-500',
  cancelled: 'border-zinc-200 bg-zinc-50 text-zinc-600',
};

const nodeTone: Record<WorkflowNodeType, string> = {
  agent: 'border-blue-200 bg-blue-50 text-blue-900',
  subagent: 'border-cyan-200 bg-cyan-50 text-cyan-900',
  mcp: 'border-violet-200 bg-violet-50 text-violet-900',
  tool: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  shell: 'border-amber-200 bg-amber-50 text-amber-900',
  artifact: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  approval: 'border-orange-200 bg-orange-50 text-orange-900',
  condition: 'border-pink-200 bg-pink-50 text-pink-900',
  join: 'border-slate-200 bg-slate-50 text-slate-900',
};

function makeId(prefix: string, count: number) {
  return `${prefix}-${count + 1}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function formatTime(value?: number | string | null) {
  if (!value) return 'n/a';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function stringifyValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'None';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function createBlankWorkflow(project: Project): WorkflowDefinition {
  return {
    id: `workflow-${Date.now()}`,
    name: `${project.displayName || project.name} Workflow`,
    description: 'Visual Agent workflow.',
    profileId: 'build',
    permissionPreset: 'auto-edit',
    inputs: [{ id: 'change_request', label: 'Change request', type: 'textarea', required: true }],
    outputs: [{ id: 'summary', label: 'Summary', type: 'markdown' }],
    nodes: [],
    edges: [],
    maxConcurrency: 4,
    metadata: {},
  };
}

function nodeCenter(node: WorkflowNode) {
  return {
    x: node.position.x + 92,
    y: node.position.y + 42,
  };
}

export default function WorkflowStudio({ selectedProject, sessionId = null }: WorkflowStudioProps) {
  const [activeView, setActiveView] = useState<StudioView>('Editor');
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [draft, setDraft] = useState<WorkflowDefinition>(() => createBlankWorkflow(selectedProject));
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [connectFrom, setConnectFrom] = useState('');
  const [draggingNodeId, setDraggingNodeId] = useState('');
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const selectedRun = runs[0] || null;
  const selectedNode = useMemo(() => draft.nodes.find((node) => node.id === selectedNodeId) || null, [draft.nodes, selectedNodeId]);
  const agentOptions = useMemo(() => agents.filter((agent) => agent.status !== 'paused'), [agents]);
  const availableVariables = useMemo(() => {
    const inputVariables = (draft.inputs || []).map((input) => `inputs.${input.id}`);
    if (!selectedNode) return inputVariables;
    const upstreamIds = draft.edges.filter((edge) => edge.to === selectedNode.id).map((edge) => edge.from);
    const upstreamVariables = upstreamIds.flatMap((nodeId) => [
      `nodes.${nodeId}.output.summary`,
      `nodes.${nodeId}.output.artifactId`,
      `nodes.${nodeId}.output.stdout`,
    ]);
    return [...inputVariables, ...upstreamVariables];
  }, [draft.edges, draft.inputs, selectedNode]);

  const loadData = useCallback(async () => {
    setError('');
    const [workflowsResponse, runsResponse, agentsResponse] = await Promise.all([
      api.workflows(),
      api.workflowRuns({ limit: 25 }),
      api.agents(false, 'all'),
    ]);
    const [workflowsData, runsData, agentsData] = await Promise.all([
      workflowsResponse.json(),
      runsResponse.json(),
      agentsResponse.json(),
    ]);
    if (!workflowsResponse.ok) throw new Error(workflowsData?.error || 'Failed to load workflows');
    if (!runsResponse.ok) throw new Error(runsData?.error || 'Failed to load workflow runs');
    if (!agentsResponse.ok) throw new Error(agentsData?.error || 'Failed to load agents');
    const loadedWorkflows = workflowsData.workflows || [];
    setWorkflows(loadedWorkflows);
    setRuns(runsData.runs || []);
    setAgents(agentsData.agents || []);
    if (!selectedWorkflowId && loadedWorkflows[0]) {
      setSelectedWorkflowId(loadedWorkflows[0].id);
      setDraft(loadedWorkflows[0]);
      setSelectedNodeId(loadedWorkflows[0].nodes?.[0]?.id || '');
      setRunInputs(Object.fromEntries((loadedWorkflows[0].inputs || []).map((input: { id: string; defaultValue?: unknown }) => [input.id, String(input.defaultValue ?? '')])));
    }
  }, [selectedWorkflowId]);

  useEffect(() => {
    void loadData().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Workflow Studio');
    });
  }, [loadData]);

  const selectWorkflow = useCallback((workflow: WorkflowDefinition) => {
    setSelectedWorkflowId(workflow.id);
    setDraft(workflow);
    setSelectedNodeId(workflow.nodes[0]?.id || '');
    setRunInputs(Object.fromEntries((workflow.inputs || []).map((input) => [input.id, String(input.defaultValue ?? '')])));
    setValidationMessages([]);
    setActiveView('Editor');
  }, []);

  const updateDraft = useCallback((patch: Partial<WorkflowDefinition>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const updateNode = useCallback((nodeId: string, patch: Partial<WorkflowNode>) => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    }));
  }, []);

  const addNode = useCallback((type: WorkflowNodeType) => {
    setDraft((current) => {
      const count = current.nodes.filter((node) => node.type === type).length;
      const id = makeId(type, count);
      const node: WorkflowNode = {
        id,
        type,
        title: `${nodeTypes.find((item) => item.type === type)?.label || type} ${count + 1}`,
        description: '',
        agentId: type === 'subagent' ? 'subagent-general' : type === 'agent' ? current.profileId : '',
        toolName: type === 'tool' ? 'git-native-review' : '',
        command: type === 'shell' ? 'npm test' : '',
        prompt: '',
        condition: '',
        permission: type === 'shell' || type === 'mcp' || type === 'tool' ? 'ask' : '',
        retryLimit: 0,
        timeoutMs: 120000,
        config: {},
        position: { x: 80 + current.nodes.length * 220, y: 120 + (current.nodes.length % 2) * 140 },
      };
      setSelectedNodeId(node.id);
      return { ...current, nodes: [...current.nodes, node] };
    });
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
    }));
    setSelectedNodeId('');
  }, []);

  const connectNode = useCallback((nodeId: string) => {
    if (!connectFrom) {
      setConnectFrom(nodeId);
      return;
    }
    if (connectFrom === nodeId) {
      setConnectFrom('');
      return;
    }
    setDraft((current) => {
      const exists = current.edges.some((edge) => edge.from === connectFrom && edge.to === nodeId);
      if (exists) return current;
      const edge: WorkflowEdge = {
        id: `${connectFrom}-${nodeId}`,
        from: connectFrom,
        to: nodeId,
        mode: 'success',
      };
      return { ...current, edges: [...current.edges, edge] };
    });
    setConnectFrom('');
  }, [connectFrom]);

  const removeEdge = useCallback((edgeId: string) => {
    setDraft((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== edgeId) }));
  }, []);

  const saveWorkflow = useCallback(async () => {
    setIsBusy(true);
    setError('');
    setValidationMessages([]);
    try {
      const validationResponse = await api.validateWorkflow(draft);
      const validationData = await validationResponse.json();
      if (!validationResponse.ok) {
        setValidationMessages((validationData?.validation?.errors || []).map((item: { message?: string }) => item.message || 'Invalid workflow'));
        throw new Error(validationData?.error || 'Workflow validation failed');
      }
      const response = await api.saveWorkflow(draft);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to save workflow');
      setDraft(data.workflow);
      setSelectedWorkflowId(data.workflow.id);
      setRunInputs(Object.fromEntries((data.workflow.inputs || []).map((input: { id: string; defaultValue?: unknown }) => [input.id, runInputs[input.id] ?? String(input.defaultValue ?? '')])));
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save workflow');
    } finally {
      setIsBusy(false);
    }
  }, [draft, loadData, runInputs]);

  const startRun = useCallback(async () => {
    setIsBusy(true);
    setError('');
    try {
      const response = await api.startWorkflowRun(draft.id, {
        projectPath: selectedProject.path || selectedProject.fullPath,
        sessionId: sessionId || '',
        inputs: runInputs,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to run workflow');
      await loadData();
      setActiveView('Runs');
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Failed to run workflow');
    } finally {
      setIsBusy(false);
    }
  }, [draft.id, loadData, runInputs, selectedProject.fullPath, selectedProject.path, sessionId]);

  const controlNode = useCallback(async (run: WorkflowRun, nodeId: string, action: string) => {
    setIsBusy(true);
    setError('');
    try {
      const response = await api.controlWorkflowNode(run.id, nodeId, { action });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to control workflow node');
      setRuns((current) => [data.run, ...current.filter((item) => item.id !== data.run.id)]);
    } catch (controlError) {
      setError(controlError instanceof Error ? controlError.message : 'Failed to control workflow node');
    } finally {
      setIsBusy(false);
    }
  }, []);

  const exportDraft = useCallback(async () => {
    const response = await api.exportWorkflow(draft.id, 'json');
    const data = await response.json();
    if (!response.ok) {
      setError(data?.error || 'Failed to export workflow');
      return;
    }
    await navigator.clipboard?.writeText(data.content);
  }, [draft.id]);

  const importFromClipboard = useCallback(async () => {
    setIsBusy(true);
    setError('');
    try {
      const content = await navigator.clipboard.readText();
      const response = await api.importWorkflow(content);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to import workflow');
      await loadData();
      selectWorkflow(data.workflow);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Failed to import workflow');
    } finally {
      setIsBusy(false);
    }
  }, [loadData, selectWorkflow]);

  const duplicateWorkflow = useCallback(() => {
    const copy = {
      ...draft,
      id: `workflow-${Date.now()}`,
      name: `${draft.name} Copy`,
    };
    setDraft(copy);
    setSelectedWorkflowId(copy.id);
    setActiveView('Editor');
  }, [draft]);

  const handleDragStart = useCallback((nodeId: string) => {
    setDraggingNodeId(nodeId);
  }, []);

  const handleCanvasMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!draggingNodeId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    updateNode(draggingNodeId, {
      position: {
        x: Math.max(20, event.clientX - rect.left - 90),
        y: Math.max(20, event.clientY - rect.top - 35),
      },
    });
  }, [draggingNodeId, updateNode]);

  const renderCanvas = (run: WorkflowRun | null = null) => {
    const nodeRuns = run?.nodeRuns || {};
    return (
      <div
        className="relative h-[520px] min-w-[980px] overflow-hidden rounded-md border border-border bg-[linear-gradient(#eef2f7_1px,transparent_1px),linear-gradient(90deg,#eef2f7_1px,transparent_1px)] bg-[size:24px_24px]"
        data-testid="workflow-dag-canvas"
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={() => setDraggingNodeId('')}
        onMouseLeave={() => setDraggingNodeId('')}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {draft.edges.map((edge) => {
            const from = draft.nodes.find((node) => node.id === edge.from);
            const to = draft.nodes.find((node) => node.id === edge.to);
            if (!from || !to) return null;
            const start = nodeCenter(from);
            const end = nodeCenter(to);
            const midX = (start.x + end.x) / 2;
            return (
              <path
                key={edge.id}
                d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`}
                fill="none"
                stroke="#94a3b8"
                strokeWidth="2"
                markerEnd="url(#workflow-arrow)"
              />
            );
          })}
          <defs>
            <marker id="workflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#94a3b8" />
            </marker>
          </defs>
        </svg>

        {draft.nodes.map((node) => {
          const Icon = nodeTypes.find((item) => item.type === node.type)?.icon || Bot;
          const runState = nodeRuns[node.id];
          const isSelected = selectedNodeId === node.id;
          return (
            <div
              key={node.id}
              data-testid="workflow-node"
              data-node-id={node.id}
              className={cn(
                'absolute w-[184px] cursor-default rounded-md border bg-card p-3 shadow-sm transition-shadow',
                nodeTone[node.type],
                isSelected && 'ring-2 ring-primary/40',
              )}
              style={{ left: node.position.x, top: node.position.y }}
              onMouseDown={(event) => {
                if ((event.target as HTMLElement).closest('button')) return;
                setSelectedNodeId(node.id);
                handleDragStart(node.id);
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <h3 className="truncate text-sm font-semibold">{node.title}</h3>
                  </div>
                  <p className="mt-1 truncate text-[11px] opacity-75">{node.type}</p>
                </div>
                <button
                  type="button"
                  aria-label="Connect node"
                  data-testid="workflow-connect-node"
                  onClick={() => connectNode(node.id)}
                  className={cn(
                    'rounded border border-current/20 p-1 hover:bg-white/60',
                    connectFrom === node.id && 'bg-primary text-primary-foreground',
                  )}
                >
                  <Link2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {runState && (
                <span className={cn('mt-3 inline-flex rounded-full border px-2 py-0.5 text-[11px]', statusTone[runState.status] || statusTone.pending)}>
                  {runState.status}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="workflow-studio">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">Agent Workflow Studio</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Compose Agent, Subagent, MCP, Tool, Shell, Artifact, Approval, Condition, and Join nodes as a visual DAG.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void loadData().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Failed to refresh'))} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button type="button" data-testid="workflow-run" onClick={startRun} disabled={isBusy || draft.nodes.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
              <Play className="h-4 w-4" />
              Run
            </button>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          {views.map((view) => {
            const Icon = view === 'Library' ? LibraryBig : view === 'Editor' ? GitBranch : History;
            return (
              <button
                key={view}
                type="button"
                onClick={() => setActiveView(view)}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors',
                  activeView === view ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="h-4 w-4" />
                {view}
              </button>
            );
          })}
        </div>
        {draft.inputs?.length > 0 && (
          <div className="mt-4 rounded-md border border-border bg-card p-3" data-testid="workflow-run-inputs">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">Run inputs</h3>
              <span className="text-xs text-muted-foreground">{draft.inputs.length} field{draft.inputs.length === 1 ? '' : 's'}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {draft.inputs.map((input) => (
                <label key={input.id} className="text-xs font-medium text-muted-foreground">
                  {input.label || input.id}{input.required ? ' *' : ''}
                  {input.type === 'textarea' ? (
                    <textarea
                      data-testid="workflow-run-input"
                      value={runInputs[input.id] ?? ''}
                      onChange={(event) => setRunInputs((current) => ({ ...current, [input.id]: event.target.value }))}
                      className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                    />
                  ) : (
                    <input
                      data-testid="workflow-run-input"
                      value={runInputs[input.id] ?? ''}
                      onChange={(event) => setRunInputs((current) => ({ ...current, [input.id]: event.target.value }))}
                      className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {activeView === 'Library' && (
        <div className="min-h-0 flex-1 overflow-auto p-5" data-testid="workflow-library">
          <div className="mb-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => selectWorkflow(createBlankWorkflow(selectedProject))} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
              <Plus className="h-4 w-4" />
              New workflow
            </button>
            <button type="button" onClick={duplicateWorkflow} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
              <ClipboardCheck className="h-4 w-4" />
              Duplicate
            </button>
            <button type="button" onClick={importFromClipboard} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
              <Upload className="h-4 w-4" />
              Import
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {workflows.map((workflow) => (
              <button
                type="button"
                key={workflow.id}
                data-testid="workflow-library-item"
                onClick={() => selectWorkflow(workflow)}
                className={cn(
                  'rounded-md border bg-card p-4 text-left transition-colors hover:bg-muted/40',
                  workflow.id === selectedWorkflowId ? 'border-primary' : 'border-border',
                )}
              >
                <h3 className="truncate text-sm font-semibold text-foreground">{workflow.name}</h3>
                <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{workflow.description || 'No description.'}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded border border-border px-2 py-1">{workflow.nodes.length} nodes</span>
                  <span className="rounded border border-border px-2 py-1">{workflow.edges.length} edges</span>
                  <span className="rounded border border-border px-2 py-1">{workflow.profileId}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeView === 'Editor' && (
        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_300px] overflow-hidden" data-testid="workflow-editor">
          <aside className="min-h-0 overflow-auto border-r border-border p-4">
            <h3 className="text-sm font-semibold text-foreground">Node palette</h3>
            <div className="mt-3 grid gap-2">
              {nodeTypes.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  data-testid="workflow-add-node"
                  data-node-type={item.type}
                  onClick={() => addNode(item.type)}
                  className="flex items-start gap-3 rounded-md border border-border p-3 text-left hover:bg-muted"
                >
                  <item.icon className="mt-0.5 h-4 w-4 text-primary" />
                  <span>
                    <span className="block text-sm font-medium text-foreground">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">{item.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <main className="min-h-0 overflow-auto p-4">
            <div className="mb-3 grid gap-3 md:grid-cols-3">
              <label className="text-xs font-medium text-muted-foreground">
                Name
                <input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground" />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Agent Profile
                <select value={draft.profileId} onChange={(event) => updateDraft({ profileId: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground">
                  <option value="build">build</option>
                  <option value="plan">plan</option>
                  {agentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Permission preset
                <select value={draft.permissionPreset} onChange={(event) => updateDraft({ permissionPreset: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground">
                  <option value="suggest">Suggest</option>
                  <option value="auto-edit">Auto Edit</option>
                  <option value="full-auto">Full Auto</option>
                  <option value="enterprise-safe">Enterprise Safe</option>
                </select>
              </label>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <button type="button" data-testid="workflow-save" onClick={saveWorkflow} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                <Save className="h-4 w-4" />
                Save
              </button>
              <button type="button" onClick={exportDraft} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                <Download className="h-4 w-4" />
                Export
              </button>
              {connectFrom && <span className="inline-flex h-9 items-center rounded-md border border-primary/30 bg-primary/10 px-3 text-sm text-primary">Connect from {connectFrom}</span>}
            </div>
            {validationMessages.length > 0 && (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {validationMessages.map((message) => <div key={message} className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{message}</div>)}
              </div>
            )}
            {renderCanvas()}
          </main>

          <aside className="min-h-0 overflow-auto border-l border-border p-4" data-testid="workflow-node-inspector">
            <h3 className="text-sm font-semibold text-foreground">Inspector</h3>
            {selectedNode ? (
              <div className="mt-3 space-y-3">
                <label className="block text-xs font-medium text-muted-foreground">
                  Title
                  <input value={selectedNode.title} onChange={(event) => updateNode(selectedNode.id, { title: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground" />
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  Agent / tool
                  <input value={selectedNode.agentId || selectedNode.toolName || ''} onChange={(event) => updateNode(selectedNode.id, selectedNode.type === 'tool' || selectedNode.type === 'mcp' ? { toolName: event.target.value } : { agentId: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground" />
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  Prompt / command / condition
                  <textarea value={selectedNode.prompt || selectedNode.command || selectedNode.condition || ''} onChange={(event) => {
                    const value = event.target.value;
                    if (selectedNode.type === 'shell') updateNode(selectedNode.id, { command: value });
                    else if (selectedNode.type === 'condition') updateNode(selectedNode.id, { condition: value });
                    else updateNode(selectedNode.id, { prompt: value });
                  }} className="mt-1 min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm text-foreground" />
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  Node permission
                  <select value={selectedNode.permission || ''} onChange={(event) => updateNode(selectedNode.id, { permission: event.target.value as WorkflowNode['permission'] })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground">
                    <option value="">inherit profile</option>
                    <option value="ask">ask</option>
                    <option value="deny">deny</option>
                    <option value="allow">allow only if profile permits</option>
                  </select>
                </label>
                <button type="button" onClick={() => deleteNode(selectedNode.id)} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm text-red-700 hover:bg-red-50">
                  <X className="h-4 w-4" />
                  Delete node
                </button>
                <div>
                  <h4 className="mb-2 text-xs font-semibold text-muted-foreground">Edges</h4>
                  {draft.edges.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id).map((edge) => (
                    <button key={edge.id} type="button" onClick={() => removeEdge(edge.id)} className="mb-2 block w-full rounded border border-border px-2 py-1 text-left text-xs hover:bg-muted">
                      {edge.from} {'->'} {edge.to}
                    </button>
                  ))}
                </div>
                <div data-testid="workflow-node-variables">
                  <h4 className="mb-2 text-xs font-semibold text-muted-foreground">Available variables</h4>
                  <div className="space-y-1">
                    {availableVariables.map((variable) => (
                      <code key={variable} className="block rounded border border-border bg-muted/40 px-2 py-1 text-[11px] text-foreground">
                        {'{{'}{variable}{'}}'}
                      </code>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Select a node to edit its runtime contract.</p>
            )}
          </aside>
        </div>
      )}

      {activeView === 'Runs' && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] overflow-hidden" data-testid="workflow-runs">
          <main className="min-h-0 overflow-auto p-4">
            {selectedRun ? renderCanvas(selectedRun) : (
              <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No workflow run yet.</div>
            )}
          </main>
          <aside className="min-h-0 overflow-auto border-l border-border p-4">
            <h3 className="text-sm font-semibold text-foreground">Run history</h3>
            <div className="mt-3 space-y-3">
              {runs.map((run) => (
                <div key={run.id} data-testid="workflow-run-card" className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-semibold text-foreground">{run.workflowName}</h4>
                      <p className="text-xs text-muted-foreground">{formatTime(run.createdAt)}</p>
                    </div>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[11px]', statusTone[run.status] || statusTone.pending)}>{run.status}</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {Object.values(run.nodeRuns || {}).map((nodeRun) => (
                      <div key={nodeRun.nodeId} className="rounded border border-border p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-foreground">{nodeRun.title}</span>
                          <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', statusTone[nodeRun.status] || statusTone.pending)}>{nodeRun.status}</span>
                        </div>
                        {nodeRun.waitingReason && <p className="mt-1 text-xs text-amber-700">{nodeRun.waitingReason}</p>}
                        {nodeRun.error && <p className="mt-1 text-xs text-red-700">{nodeRun.error}</p>}
                        {nodeRun.logs?.length ? <p className="mt-1 text-xs text-muted-foreground">{nodeRun.logs.at(-1)}</p> : null}
                        <div className="mt-2 grid gap-2" data-testid="workflow-node-run-details">
                          <details className="rounded border border-border bg-muted/20 p-2">
                            <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">Input / output</summary>
                            <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[11px] text-foreground">{stringifyValue({ input: nodeRun.input, output: nodeRun.output })}</pre>
                          </details>
                          {(nodeRun as { checkpoints?: Record<string, unknown> }).checkpoints && Object.keys((nodeRun as { checkpoints?: Record<string, unknown> }).checkpoints || {}).length > 0 && (
                            <details className="rounded border border-border bg-muted/20 p-2">
                              <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">Checkpoints</summary>
                              <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-[11px] text-foreground">{stringifyValue((nodeRun as { checkpoints?: Record<string, unknown> }).checkpoints)}</pre>
                            </details>
                          )}
                        </div>
                        {nodeRun.status === 'waiting_approval' && (
                          <div className="mt-2 flex gap-2">
                            <button type="button" data-testid="workflow-approve-node" onClick={() => controlNode(run, nodeRun.nodeId, 'continue')} disabled={isBusy} className="inline-flex h-7 items-center gap-1 rounded bg-primary px-2 text-xs text-primary-foreground">
                              <Check className="h-3 w-3" />
                              Continue
                            </button>
                            <button type="button" onClick={() => controlNode(run, nodeRun.nodeId, 'reject')} disabled={isBusy} className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-muted">
                              <Square className="h-3 w-3" />
                              Reject
                            </button>
                          </div>
                        )}
                        {nodeRun.status === 'failed' && (
                          <button type="button" onClick={() => controlNode(run, nodeRun.nodeId, 'retry')} disabled={isBusy} className="mt-2 inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-muted">
                            <RefreshCw className="h-3 w-3" />
                            Retry
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
