import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertTriangle,
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Command,
  Copy,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  HelpCircle,
  History,
  Home,
  Keyboard,
  LibraryBig,
  Link2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Square,
  Star,
  Trash2,
  Upload,
  Wand2,
  X,
  Zap,
} from 'lucide-react';

import { api } from '../../../utils/api';
import { cn } from '../../../lib/utils';
import type { Project } from '../../../types/app';
import type { AgentConfig } from '../../../types/agent';
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeLog,
  WorkflowNodeRun,
  WorkflowNodeType,
  WorkflowNodeTypeDefinition,
  WorkflowRun,
  WorkflowRunEvent,
} from '../../../types/workflow';

type WorkflowStudioProps = {
  selectedProject: Project;
  sessionId?: string | null;
};

type StudioView = 'Home' | 'Library' | 'Editor' | 'Runs';
type WorkflowInspectorTab = 'Config' | 'Data' | 'Permissions' | 'Runtime';
type WorkflowLibraryFilter = 'All' | 'Built-in' | 'Enterprise' | 'Needs setup' | 'Recently used';

type WorkflowPaletteGroup = {
  id: string;
  label: string;
  types: WorkflowNodeType[];
};

interface WorkflowFlowNodeData extends Record<string, unknown> {
  workflowNode: WorkflowNode;
  runState: WorkflowNodeRun | null;
  permissionPreset: string;
}

type WorkflowFlowNode = Node<WorkflowFlowNodeData, 'workflowNode'>;
type WorkflowFlowEdge = Edge<{ mode?: WorkflowEdge['mode'] }>;

const views: StudioView[] = ['Home', 'Library', 'Editor', 'Runs'];

const baseNodeTypes: Array<{ type: WorkflowNodeType; label: string; icon: typeof Bot; description: string }> = [
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

const paletteGroups: WorkflowPaletteGroup[] = [
  { id: 'agents', label: 'Agents', types: ['agent', 'subagent'] },
  { id: 'integrations', label: 'Integrations', types: ['mcp', 'tool'] },
  { id: 'execution', label: 'Execution', types: ['shell', 'approval'] },
  { id: 'control', label: 'Control Flow', types: ['condition', 'join'] },
  { id: 'outputs', label: 'Outputs', types: ['artifact'] },
];

const inspectorTabs: WorkflowInspectorTab[] = ['Config', 'Data', 'Permissions', 'Runtime'];
const libraryFilters: WorkflowLibraryFilter[] = ['All', 'Built-in', 'Enterprise', 'Needs setup', 'Recently used'];
const favoriteStorageKey = 'workflowStudio.favoriteWorkflowIds';
const recentStorageKey = 'workflowStudio.recentWorkflowIds';

const statusTaxonomy = [
  { status: 'queued', label: 'Queued', description: 'Waiting for a worker lease.' },
  { status: 'running', label: 'Running', description: 'Actively executing nodes.' },
  { status: 'recovering', label: 'Recovering', description: 'Resuming stale or interrupted work.' },
  { status: 'waiting_approval', label: 'Waiting', description: 'Paused for human approval.' },
  { status: 'completed', label: 'Completed', description: 'Finished successfully.' },
  { status: 'failed', label: 'Failed', description: 'Stopped by an error or policy.' },
  { status: 'stale', label: 'Stale', description: 'Worker heartbeat is missing.' },
  { status: 'cancelled', label: 'Cancelled', description: 'Stopped by user action.' },
];

const nodeIconByType: Record<WorkflowNodeType, typeof Bot> = {
  agent: Bot,
  subagent: GitBranch,
  mcp: Zap,
  tool: Braces,
  shell: CircleDot,
  artifact: FileText,
  approval: ClipboardCheck,
  condition: ChevronRight,
  join: Link2,
};

const statusTone: Record<string, string> = {
  queued: 'border-slate-200 bg-slate-50 text-slate-700',
  pending: 'border-slate-200 bg-slate-50 text-slate-700',
  ready: 'border-blue-200 bg-blue-50 text-blue-700',
  running: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  recovering: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  waiting_approval: 'border-amber-200 bg-amber-50 text-amber-700',
  completed: 'border-green-200 bg-green-50 text-green-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
  stale: 'border-orange-200 bg-orange-50 text-orange-700',
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

const riskyNodeTypes = new Set<WorkflowNodeType>(['shell', 'mcp', 'tool']);

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

function getTemplateManifest(workflow: WorkflowDefinition) {
  const manifest = workflow.metadata?.templateManifest;
  return manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? manifest as { version?: string; tags?: string[]; dependencies?: Record<string, unknown>; expectedOutputs?: unknown[] }
    : {};
}

function readStoredIds(key: string) {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeStoredIds(key: string, value: string[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify([...new Set(value)].slice(0, 12)));
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

function describePermissionSource(workflow: WorkflowDefinition, node: WorkflowNode | null) {
  if (!node) return 'No node selected';
  if (node.permission) return `Node override: ${node.permission}`;
  if (workflow.permissionPreset === 'enterprise-safe' && riskyNodeTypes.has(node.type)) return 'Profile baseline: enterprise-safe denies risky nodes';
  if (workflow.permissionPreset === 'suggest' && riskyNodeTypes.has(node.type)) return 'Profile baseline: suggest asks before risky nodes';
  return `Profile baseline: ${workflow.permissionPreset || 'inherit'}`;
}

function WorkflowFlowNodeCard({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const node = data.workflowNode;
  const runState = data.runState;
  const Icon = nodeIconByType[node.type] || Bot;
  const isRisky = riskyNodeTypes.has(node.type);
  return (
    <div
      data-testid="workflow-node"
      data-node-id={node.id}
      className={cn(
        'min-h-[112px] w-[220px] rounded-md border bg-card p-3 shadow-sm transition-all',
        nodeTone[node.type],
        selected && 'ring-2 ring-primary/50',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-background !bg-primary" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 flex-shrink-0" />
            <h3 className="truncate text-sm font-semibold">{node.title}</h3>
          </div>
          <p className="mt-1 truncate text-[11px] opacity-75">{node.type}</p>
        </div>
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', isRisky ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-current/20 bg-white/40')}>
          {isRisky ? 'risk' : 'ready'}
        </span>
      </div>
      <div className="mt-3 text-[10px] opacity-80" data-testid="workflow-node-dependency-status">
        {isRisky
          ? `Permission: ${node.permission || data.permissionPreset}`
          : node.type === 'mcp' && !node.toolName
            ? 'Missing MCP tool'
            : 'Dependencies ready'}
      </div>
      {runState && (
        <span className={cn('mt-3 inline-flex rounded-full border px-2 py-0.5 text-[11px]', statusTone[runState.status] || statusTone.pending)}>
          {runState.status}
        </span>
      )}
      <Handle type="source" position={Position.Right} data-testid="workflow-connect-node" className="!h-3 !w-3 !border-2 !border-background !bg-primary" />
    </div>
  );
}

const reactFlowNodeTypes = { workflowNode: WorkflowFlowNodeCard };

export default function WorkflowStudio({ selectedProject, sessionId = null }: WorkflowStudioProps) {
  const [activeView, setActiveView] = useState<StudioView>('Home');
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [nodeTypeDefinitions, setNodeTypeDefinitions] = useState<WorkflowNodeTypeDefinition[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [draft, setDraft] = useState<WorkflowDefinition>(() => createBlankWorkflow(selectedProject));
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [nodeSearch, setNodeSearch] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<WorkflowLibraryFilter>('All');
  const [inspectorTab, setInspectorTab] = useState<WorkflowInspectorTab>('Config');
  const [isRunSetupOpen, setIsRunSetupOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [favoriteWorkflowIds, setFavoriteWorkflowIds] = useState<string[]>(() => readStoredIds(favoriteStorageKey));
  const [recentWorkflowIds, setRecentWorkflowIds] = useState<string[]>(() => readStoredIds(recentStorageKey));
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const [dryRunMessages, setDryRunMessages] = useState<string[]>([]);
  const [runEvents, setRunEvents] = useState<Record<string, WorkflowRunEvent[]>>({});
  const [nodeLogs, setNodeLogs] = useState<Record<string, WorkflowNodeLog[]>>({});
  const [approvalRequests, setApprovalRequests] = useState<Array<Record<string, unknown>>>([]);
  const [releaseReadiness, setReleaseReadiness] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const selectedRun = runs[0] || null;
  const selectedNode = useMemo(() => draft.nodes.find((node) => node.id === selectedNodeId) || null, [draft.nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => draft.edges.find((edge) => edge.id === selectedEdgeId) || null, [draft.edges, selectedEdgeId]);
  const agentOptions = useMemo(() => agents.filter((agent) => agent.status !== 'paused'), [agents]);
  const paletteNodeTypes = useMemo(() => {
    if (nodeTypeDefinitions.length === 0) return baseNodeTypes;
    return nodeTypeDefinitions.map((definition) => ({
      type: definition.type,
      label: definition.label,
      icon: nodeIconByType[definition.type] || Bot,
      description: definition.description,
    }));
  }, [nodeTypeDefinitions]);
  const selectedNodeDefinition = useMemo(
    () => nodeTypeDefinitions.find((definition) => definition.type === selectedNode?.type) || null,
    [nodeTypeDefinitions, selectedNode?.type],
  );
  const filteredNodeTypes = useMemo(() => {
    const query = nodeSearch.trim().toLowerCase();
    if (!query) return paletteNodeTypes;
    return paletteNodeTypes.filter((item) => [item.type, item.label, item.description].join(' ').toLowerCase().includes(query));
  }, [nodeSearch, paletteNodeTypes]);
  const filteredWorkflows = useMemo(() => workflows.filter((workflow) => {
    const manifest = getTemplateManifest(workflow);
    const tags = Array.isArray(manifest.tags) ? manifest.tags.map((tag) => tag.toLowerCase()) : [];
    if (libraryFilter === 'Built-in') return Boolean(workflow.metadata?.templateManifest);
    if (libraryFilter === 'Enterprise') return tags.includes('enterprise') || tags.includes('redmine') || tags.includes('crashsight');
    if (libraryFilter === 'Needs setup') return Boolean(manifest.dependencies && Object.keys(manifest.dependencies).length > 0);
    if (libraryFilter === 'Recently used') return runs.some((run) => run.workflowId === workflow.id);
    return true;
  }), [libraryFilter, runs, workflows]);
  const availableVariables = useMemo(() => {
    const inputVariables = (draft.inputs || []).map((input) => `inputs.${input.id}`);
    if (!selectedNode) return inputVariables;
    const upstreamIds = draft.edges.filter((edge) => edge.to === selectedNode.id).map((edge) => edge.from);
    const upstreamVariables = upstreamIds.flatMap((nodeId) => {
      const upstreamNode = draft.nodes.find((node) => node.id === nodeId);
      const definition = nodeTypeDefinitions.find((item) => item.type === upstreamNode?.type);
      const fields = definition?.outputSchema?.fields?.map((field) => `nodes.${nodeId}.output.${field.name}`) || [];
      return fields.length > 0 ? fields : [
        `nodes.${nodeId}.output.summary`,
        `nodes.${nodeId}.output.artifactId`,
        `nodes.${nodeId}.output.stdout`,
      ];
    });
    return [...inputVariables, ...upstreamVariables];
  }, [draft.edges, draft.inputs, draft.nodes, nodeTypeDefinitions, selectedNode]);
  const selectedNodeTemplateText = selectedNode?.type === 'shell'
    ? selectedNode.command || ''
    : selectedNode?.type === 'condition'
      ? selectedNode.condition || ''
      : selectedNode?.prompt || '';
  const invalidVariables = useMemo(() => {
    const matches = [...selectedNodeTemplateText.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((match) => match[1]);
    return [...new Set(matches.filter((variable) => !availableVariables.includes(variable)))];
  }, [availableVariables, selectedNodeTemplateText]);
  const permissionSource = useMemo(() => describePermissionSource(draft, selectedNode), [draft, selectedNode]);
  const failedRuns = useMemo(() => runs.filter((run) => run.status === 'failed'), [runs]);
  const pendingApprovalRuns = useMemo(() => runs.filter((run) => run.status === 'waiting_approval' || Object.values(run.nodeRuns || {}).some((nodeRun) => nodeRun.status === 'waiting_approval')), [runs]);
  const favoriteWorkflows = useMemo(() => favoriteWorkflowIds.map((id) => workflows.find((workflow) => workflow.id === id)).filter((workflow): workflow is WorkflowDefinition => Boolean(workflow)), [favoriteWorkflowIds, workflows]);
  const recentWorkflows = useMemo(() => {
    const fromStorage = recentWorkflowIds.map((id) => workflows.find((workflow) => workflow.id === id)).filter((workflow): workflow is WorkflowDefinition => Boolean(workflow));
    const fromRuns = runs.map((run) => workflows.find((workflow) => workflow.id === run.workflowId)).filter((workflow): workflow is WorkflowDefinition => Boolean(workflow));
    return [...new Map([...fromStorage, ...fromRuns].map((workflow) => [workflow.id, workflow])).values()].slice(0, 6);
  }, [recentWorkflowIds, runs, workflows]);

  const loadNodeTypes = useCallback(async () => {
    const response = await api.workflowNodeTypes();
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Failed to load workflow node types');
    setNodeTypeDefinitions(data.nodeTypes || []);
  }, []);

  const loadData = useCallback(async () => {
    setError('');
    const [workflowsResponse, runsResponse, agentsResponse, nodeTypesResponse, approvalsResponse, readinessResponse] = await Promise.all([
      api.workflows(),
      api.workflowRuns({ limit: 25 }),
      api.agents(false, 'all'),
      api.workflowNodeTypes(),
      api.workflowApprovals(),
      api.workflowBenchmarkReadiness(),
    ]);
    const [workflowsData, runsData, agentsData, nodeTypesData, approvalsData, readinessData] = await Promise.all([
      workflowsResponse.json(),
      runsResponse.json(),
      agentsResponse.json(),
      nodeTypesResponse.json(),
      approvalsResponse.json(),
      readinessResponse.json(),
    ]);
    if (!workflowsResponse.ok) throw new Error(workflowsData?.error || 'Failed to load workflows');
    if (!runsResponse.ok) throw new Error(runsData?.error || 'Failed to load workflow runs');
    if (!agentsResponse.ok) throw new Error(agentsData?.error || 'Failed to load agents');
    if (!nodeTypesResponse.ok) throw new Error(nodeTypesData?.error || 'Failed to load workflow node types');
    const loadedWorkflows = workflowsData.workflows || [];
    setWorkflows(loadedWorkflows);
    setRuns(runsData.runs || []);
    setAgents(agentsData.agents || []);
    setNodeTypeDefinitions(nodeTypesData.nodeTypes || []);
    setApprovalRequests(approvalsResponse.ok ? approvalsData.approvals || [] : []);
    setReleaseReadiness(readinessResponse.ok ? readinessData.readiness || null : null);
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

  useEffect(() => {
    if (nodeTypeDefinitions.length === 0) {
      void loadNodeTypes().catch(() => undefined);
    }
  }, [loadNodeTypes, nodeTypeDefinitions.length]);

  useEffect(() => {
    writeStoredIds(favoriteStorageKey, favoriteWorkflowIds);
  }, [favoriteWorkflowIds]);

  useEffect(() => {
    writeStoredIds(recentStorageKey, recentWorkflowIds);
  }, [recentWorkflowIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCommandKey = event.ctrlKey || event.metaKey;
      if (isCommandKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen((current) => !current);
      }
      if (event.key === '?') {
        setIsShortcutsOpen(true);
      }
      if (event.key === 'Escape') {
        setIsCommandPaletteOpen(false);
        setIsHelpOpen(false);
        setIsShortcutsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectWorkflow = useCallback((workflow: WorkflowDefinition) => {
    setSelectedWorkflowId(workflow.id);
    setDraft(workflow);
    setSelectedNodeId(workflow.nodes[0]?.id || '');
    setRunInputs(Object.fromEntries((workflow.inputs || []).map((input) => [input.id, String(input.defaultValue ?? '')])));
    setValidationMessages([]);
    setRecentWorkflowIds((current) => [workflow.id, ...current.filter((id) => id !== workflow.id)].slice(0, 12));
    setActiveView('Editor');
  }, []);

  const openWorkflowDeepLink = useCallback((workflowId: string, view: StudioView = 'Editor') => {
    const workflow = workflows.find((item) => item.id === workflowId);
    if (workflow) {
      selectWorkflow(workflow);
      setActiveView(view);
      setIsCommandPaletteOpen(false);
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `#workflow=${encodeURIComponent(workflow.id)}&view=${encodeURIComponent(view)}`);
      }
    }
  }, [selectWorkflow, workflows]);

  const toggleFavoriteWorkflow = useCallback((workflowId: string) => {
    setFavoriteWorkflowIds((current) => (
      current.includes(workflowId)
        ? current.filter((id) => id !== workflowId)
        : [workflowId, ...current].slice(0, 12)
    ));
  }, []);

  const commandPaletteItems = useMemo(() => {
    const workflowItems = workflows.map((workflow) => ({
      id: `workflow:${workflow.id}`,
      label: workflow.name,
      meta: `Workflow / ${workflow.profileId}`,
      action: () => openWorkflowDeepLink(workflow.id),
    }));
    const runItems = runs.slice(0, 8).map((run) => ({
      id: `run:${run.id}`,
      label: run.workflowName,
      meta: `Run / ${run.status}`,
      action: () => {
        setActiveView('Runs');
        setIsCommandPaletteOpen(false);
      },
    }));
    const actionItems = [
      { id: 'action:new', label: 'Create blank workflow', meta: 'Action', action: () => selectWorkflow(createBlankWorkflow(selectedProject)) },
      { id: 'action:run', label: 'Run current workflow', meta: 'Action', action: () => setIsRunSetupOpen(true) },
      { id: 'action:help', label: 'Open help overlay', meta: 'Action', action: () => setIsHelpOpen(true) },
      { id: 'action:shortcuts', label: 'Open keyboard shortcuts', meta: 'Action', action: () => setIsShortcutsOpen(true) },
    ];
    const query = commandQuery.trim().toLowerCase();
    return [...actionItems, ...workflowItems, ...runItems]
      .filter((item) => !query || `${item.label} ${item.meta}`.toLowerCase().includes(query))
      .slice(0, 12);
  }, [commandQuery, openWorkflowDeepLink, runs, selectWorkflow, selectedProject, workflows]);

  useEffect(() => {
    if (typeof window === 'undefined' || workflows.length === 0) return;
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const workflowId = params.get('workflow');
    const view = params.get('view') as StudioView | null;
    if (workflowId && workflowId !== selectedWorkflowId && views.includes(view || 'Editor')) {
      openWorkflowDeepLink(workflowId, view || 'Editor');
    }
  }, [openWorkflowDeepLink, selectedWorkflowId, workflows.length]);

  const updateDraft = useCallback((patch: Partial<WorkflowDefinition>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const updateNode = useCallback((nodeId: string, patch: Partial<WorkflowNode>) => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    }));
  }, []);

  const updateEdge = useCallback((edgeId: string, patch: Partial<WorkflowEdge>) => {
    setDraft((current) => ({
      ...current,
      edges: current.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)),
    }));
  }, []);

  const addNode = useCallback((type: WorkflowNodeType) => {
    setDraft((current) => {
      const count = current.nodes.filter((node) => node.type === type).length;
      const id = makeId(type, count);
      const node: WorkflowNode = {
        id,
        type,
        title: `${baseNodeTypes.find((item) => item.type === type)?.label || type} ${count + 1}`,
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

  const duplicateNode = useCallback((nodeId: string) => {
    setDraft((current) => {
      const source = current.nodes.find((node) => node.id === nodeId);
      if (!source) return current;
      const copy: WorkflowNode = {
        ...source,
        id: makeId(`${source.type}-copy`, current.nodes.length),
        title: `${source.title} Copy`,
        position: { x: source.position.x + 36, y: source.position.y + 36 },
      };
      setSelectedNodeId(copy.id);
      return { ...current, nodes: [...current.nodes, copy] };
    });
  }, []);

  const autoLayoutNodes = useCallback(() => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node, index) => ({
        ...node,
        position: {
          x: 80 + (index % 4) * 230,
          y: 110 + Math.floor(index / 4) * 150,
        },
      })),
    }));
  }, []);

  const insertVariable = useCallback((variable: string) => {
    if (!selectedNode) return;
    const token = `{{${variable}}}`;
    if (selectedNode.type === 'shell') {
      updateNode(selectedNode.id, { command: `${selectedNode.command || ''}${selectedNode.command ? ' ' : ''}${token}` });
    } else if (selectedNode.type === 'condition') {
      updateNode(selectedNode.id, { condition: `${selectedNode.condition || ''}${selectedNode.condition ? ' ' : ''}${token}` });
    } else {
      updateNode(selectedNode.id, { prompt: `${selectedNode.prompt || ''}${selectedNode.prompt ? ' ' : ''}${token}` });
    }
  }, [selectedNode, updateNode]);

  const removeEdge = useCallback((edgeId: string) => {
    setDraft((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== edgeId) }));
    setSelectedEdgeId((current) => current === edgeId ? '' : current);
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

  const validateRun = useCallback(async () => {
    setIsBusy(true);
    setError('');
    try {
      const response = await api.validateWorkflowRun(draft.id, { inputs: runInputs });
      const data = await response.json();
      const validation = data.validation || {};
      const messages = [
        ...(validation.errors || []).map((item: { message?: string }) => item.message || 'Workflow run validation failed'),
        ...(validation.warnings || []).map((item: { message?: string }) => item.message || 'Workflow run warning'),
      ];
      setDryRunMessages(messages.length > 0 ? messages : ['Dry run passed.']);
      if (!response.ok) throw new Error(data?.error || 'Workflow run validation failed');
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Workflow run validation failed');
    } finally {
      setIsBusy(false);
    }
  }, [draft.id, runInputs]);

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

  const decideApproval = useCallback(async (approvalId: string, decision: string) => {
    setIsBusy(true);
    setError('');
    try {
      const response = await api.decideWorkflowApproval(approvalId, { decision, approver: 'local-user' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to decide workflow approval');
      await loadData();
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Failed to decide workflow approval');
    } finally {
      setIsBusy(false);
    }
  }, [loadData]);

  const smokeTemplate = useCallback(async (workflow: WorkflowDefinition) => {
    setIsBusy(true);
    setError('');
    try {
      const response = await api.smokeWorkflowTemplate(workflow.id, {
        inputs: Object.fromEntries((workflow.inputs || []).map((input) => [input.id, runInputs[input.id] || String(input.defaultValue || `smoke ${input.id}`)])),
        projectPath: selectedProject.path || selectedProject.fullPath,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || data?.smoke?.error || 'Template smoke failed');
      await loadData();
    } catch (smokeError) {
      setError(smokeError instanceof Error ? smokeError.message : 'Template smoke failed');
    } finally {
      setIsBusy(false);
    }
  }, [loadData, runInputs, selectedProject.fullPath, selectedProject.path]);

  const runBenchmarks = useCallback(async () => {
    setIsBusy(true);
    setError('');
    try {
      const response = await api.runWorkflowBenchmarks({ limit: 10 });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Workflow benchmarks failed');
      await loadData();
    } catch (benchmarkError) {
      setError(benchmarkError instanceof Error ? benchmarkError.message : 'Workflow benchmarks failed');
    } finally {
      setIsBusy(false);
    }
  }, [loadData]);

  const loadRunConsole = useCallback(async (run: WorkflowRun) => {
    const eventsResponse = await api.workflowRunEvents(run.id);
    const eventsData = await eventsResponse.json();
    if (eventsResponse.ok) {
      setRunEvents((current) => ({ ...current, [run.id]: eventsData.events || [] }));
    }
    const logPairs = await Promise.all(Object.keys(run.nodeRuns || {}).map(async (nodeId) => {
      const logsResponse = await api.workflowNodeLogs(run.id, nodeId);
      const logsData = await logsResponse.json();
      return [nodeId, logsResponse.ok ? logsData.logs || [] : []] as const;
    }));
    setNodeLogs((current) => ({
      ...current,
      ...Object.fromEntries(logPairs.map(([nodeId, logs]) => [`${run.id}:${nodeId}`, logs])),
    }));
  }, []);

  const retryWorkflowFromNode = useCallback(async (run: WorkflowRun, nodeId: string) => {
    setIsBusy(true);
    setError('');
    try {
      const response = await api.retryWorkflowFromNode(run.id, nodeId);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to retry workflow from node');
      setRuns((current) => [data.run, ...current.filter((item) => item.id !== data.run.id)]);
      await loadRunConsole(data.run);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'Failed to retry workflow from node');
    } finally {
      setIsBusy(false);
    }
  }, [loadRunConsole]);

  const cloneWorkflow = useCallback(async (workflow: WorkflowDefinition) => {
    setIsBusy(true);
    setError('');
    try {
      const response = await api.cloneWorkflow(workflow.id, {
        name: `${workflow.name} Copy`,
        projectPath: selectedProject.path || selectedProject.fullPath,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to clone workflow');
      await loadData();
      selectWorkflow(data.workflow);
    } catch (cloneError) {
      setError(cloneError instanceof Error ? cloneError.message : 'Failed to clone workflow');
    } finally {
      setIsBusy(false);
    }
  }, [loadData, selectWorkflow, selectedProject.fullPath, selectedProject.path]);

  useEffect(() => {
    if (selectedRun) {
      void loadRunConsole(selectedRun).catch(() => undefined);
    }
  }, [loadRunConsole, selectedRun]);

  const openCheckpointDiff = useCallback(async (checkpointId: string) => {
    setError('');
    try {
      const response = await api.checkpointDiff(checkpointId);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load checkpoint diff');
      await navigator.clipboard?.writeText(data.diff || '');
    } catch (diffError) {
      setError(diffError instanceof Error ? diffError.message : 'Failed to load checkpoint diff');
    }
  }, []);

  const rollbackCheckpoint = useCallback(async (checkpointId: string) => {
    setError('');
    try {
      const response = await api.rollbackCheckpoint(checkpointId);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to rollback checkpoint');
      await loadData();
    } catch (rollbackError) {
      setError(rollbackError instanceof Error ? rollbackError.message : 'Failed to rollback checkpoint');
    }
  }, [loadData]);

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

  const toFlowNodes = useCallback((run: WorkflowRun | null): WorkflowFlowNode[] => {
    const nodeRuns = run?.nodeRuns || {};
    return draft.nodes.map((node) => ({
      id: node.id,
      type: 'workflowNode',
      position: node.position,
      data: {
        workflowNode: node,
        runState: nodeRuns[node.id] || null,
        permissionPreset: draft.permissionPreset,
      },
    }));
  }, [draft.nodes, draft.permissionPreset]);

  const toFlowEdges = useCallback((run: WorkflowRun | null): WorkflowFlowEdge[] => draft.edges.map((edge) => {
    const targetRun = run?.nodeRuns?.[edge.to];
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: 'smoothstep',
      label: edge.mode || 'success',
      data: { mode: edge.mode },
      animated: targetRun?.status === 'running' || targetRun?.status === 'waiting_approval',
      markerEnd: { type: MarkerType.ArrowClosed },
      className: selectedEdgeId === edge.id ? 'workflow-edge-selected' : undefined,
    };
  }), [draft.edges, selectedEdgeId]);

  const handleFlowNodesChange = useCallback((changes: NodeChange<WorkflowFlowNode>[]) => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        const positionChange = changes.find((change) => 'id' in change && change.id === node.id && change.type === 'position');
        if (positionChange && 'position' in positionChange && positionChange.position) {
          return { ...node, position: positionChange.position };
        }
        return node;
      }),
    }));
    const selectedChange = changes.find((change) => 'id' in change && change.type === 'select' && change.selected);
    if (selectedChange && 'id' in selectedChange) {
      setSelectedNodeId(selectedChange.id);
      setSelectedEdgeId('');
    }
  }, []);

  const handleFlowEdgesChange = useCallback((changes: EdgeChange<WorkflowFlowEdge>[]) => {
    const removed = new Set(changes.filter((change) => 'id' in change && change.type === 'remove').map((change) => change.id));
    if (removed.size > 0) {
      setDraft((current) => ({ ...current, edges: current.edges.filter((edge) => !removed.has(edge.id)) }));
    }
    const selectedChange = changes.find((change) => 'id' in change && change.type === 'select' && change.selected);
    if (selectedChange && 'id' in selectedChange) {
      setSelectedEdgeId(selectedChange.id);
      setSelectedNodeId('');
    }
  }, []);

  const handleFlowConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    setDraft((current) => {
      const exists = current.edges.some((edge) => edge.from === connection.source && edge.to === connection.target);
      if (exists) return current;
      const edge: WorkflowEdge = {
        id: `${connection.source}-${connection.target}-${Date.now()}`,
        from: connection.source!,
        to: connection.target!,
        mode: 'success',
      };
      return { ...current, edges: [...current.edges, edge] };
    });
  }, []);

  const renderCanvas = (run: WorkflowRun | null = null) => {
    const flowNodes = toFlowNodes(run);
    const flowEdges = toFlowEdges(run);
    return (
      <div className="relative rounded-md border border-border bg-card/60 p-3 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2" data-testid="workflow-canvas-controls">
          <div className="text-xs text-muted-foreground">
            {flowNodes.length} nodes / {flowEdges.length} edges
          </div>
          <button type="button" onClick={autoLayoutNodes} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted" title="Auto layout">
            <GitBranch className="h-3.5 w-3.5" />
            Layout
          </button>
        </div>
        <div className="h-[560px] min-w-[980px] overflow-hidden rounded-md border border-border bg-background" data-testid="workflow-dag-canvas">
          <ReactFlowProvider>
            <div className="h-full w-full" data-testid="workflow-react-flow-canvas">
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={reactFlowNodeTypes}
                onNodesChange={handleFlowNodesChange}
                onEdgesChange={handleFlowEdgesChange}
                onConnect={handleFlowConnect}
                onNodeClick={(_: ReactMouseEvent, node: WorkflowFlowNode) => {
                  setSelectedNodeId(node.id);
                  setSelectedEdgeId('');
                }}
                onEdgeClick={(_: ReactMouseEvent, edge: WorkflowFlowEdge) => {
                  setSelectedEdgeId(edge.id);
                  setSelectedNodeId('');
                }}
                fitView
                minZoom={0.35}
                maxZoom={1.6}
              >
                <Background gap={24} color="#e2e8f0" />
                <Controls />
                <MiniMap data-testid="workflow-minimap" pannable zoomable nodeStrokeWidth={2} />
              </ReactFlow>
            </div>
          </ReactFlowProvider>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="workflow-studio">
      {isCommandPaletteOpen && (
        <div className="fixed inset-0 z-50 bg-black/20 p-4" data-testid="workflow-command-palette" onClick={() => setIsCommandPaletteOpen(false)}>
          <div className="mx-auto mt-24 max-w-2xl rounded-md border border-border bg-background shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Command className="h-4 w-4 text-primary" />
              <input
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="Search workflows, runs, approvals, and actions"
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <div className="max-h-80 overflow-auto p-2">
              {commandPaletteItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.action}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">{item.meta}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
              {commandPaletteItems.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No matching command.</div>}
            </div>
          </div>
        </div>
      )}
      {(isHelpOpen || isShortcutsOpen) && (
        <div className="fixed inset-0 z-50 bg-black/20 p-4" onClick={() => { setIsHelpOpen(false); setIsShortcutsOpen(false); }}>
          <div
            className="ml-auto mt-16 max-w-md rounded-md border border-border bg-background p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{isHelpOpen ? 'Workflow help' : 'Keyboard shortcuts'}</h3>
              <button type="button" onClick={() => { setIsHelpOpen(false); setIsShortcutsOpen(false); }} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">Close</button>
            </div>
            {isHelpOpen ? (
              <div className="mt-3 space-y-2 text-sm text-muted-foreground" data-testid="workflow-help-overlay">
                <p>Home shows active work, Library manages templates, Editor changes the DAG, and Runs diagnoses execution.</p>
                <p>Use favorites and recent objects to keep production workflows close without changing backend runtime behavior.</p>
              </div>
            ) : (
              <div className="mt-3 grid gap-2 text-sm" data-testid="workflow-keyboard-shortcuts">
                {[
                  ['Ctrl/⌘ K', 'Open command palette'],
                  ['?', 'Open shortcuts'],
                  ['Esc', 'Close overlays'],
                  ['Save button', 'Persist current workflow'],
                  ['Run button', 'Open run setup'],
                ].map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between rounded border border-border px-3 py-2">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono text-xs text-foreground">{key}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="border-b border-border bg-gradient-to-r from-background via-card to-background px-5 py-4" data-testid="workflow-command-center">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold text-foreground">Agent Workflow Studio</h1>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="workflow-breadcrumb">
              <button type="button" onClick={() => setActiveView('Home')} className="hover:text-foreground">Workflows</button>
              <ChevronRight className="h-3 w-3" />
              <button type="button" onClick={() => setActiveView(activeView)} className="hover:text-foreground">{activeView}</button>
              <ChevronRight className="h-3 w-3" />
              <button type="button" onClick={() => openWorkflowDeepLink(draft.id, activeView)} className="inline-flex items-center gap-1 hover:text-foreground">
                {draft.name}
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Compose Agent, Subagent, MCP, Tool, Shell, Artifact, Approval, Condition, and Join nodes as a visual DAG.</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-border bg-background px-2 py-1">Workflow: {draft.name}</span>
              <span className="rounded-md border border-border bg-background px-2 py-1">Profile: {draft.profileId}</span>
              <span className="rounded-md border border-border bg-background px-2 py-1">Permission: {draft.permissionPreset}</span>
              <span className="rounded-md border border-border bg-background px-2 py-1">Latest run: {selectedRun?.status || 'none'}</span>
            </div>
          </div>
          <div className="flex max-w-xl flex-col items-start gap-3 sm:items-end">
            {releaseReadiness && (
              <div className="flex flex-wrap justify-start gap-2 text-xs text-muted-foreground sm:justify-end" data-testid="workflow-release-readiness">
                {((releaseReadiness.gates as Array<Record<string, unknown>> | undefined) || []).map((gate) => (
                  <span key={String(gate.id)} className="rounded-md border border-border bg-background px-2 py-1">
                    {String(gate.label)}: {String(gate.status)}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setIsCommandPaletteOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
              <Command className="h-4 w-4" />
              Command
            </button>
            <button type="button" onClick={() => void loadData().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Failed to refresh'))} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button type="button" data-testid="workflow-run-benchmarks" onClick={runBenchmarks} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50">
              <ClipboardCheck className="h-4 w-4" />
              Benchmarks
            </button>
            <button type="button" data-testid="workflow-run" onClick={() => setIsRunSetupOpen(true)} disabled={isBusy || draft.nodes.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
              <Play className="h-4 w-4" />
              Run
            </button>
            <button type="button" data-testid="workflow-mobile-run" onClick={() => setIsRunSetupOpen(true)} disabled={isBusy || draft.nodes.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50 sm:hidden">
              <Play className="h-4 w-4" />
              Mobile run
            </button>
            <button type="button" onClick={() => setIsHelpOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted" title="Workflow help">
              <HelpCircle className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setIsShortcutsOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted" title="Keyboard shortcuts">
              <Keyboard className="h-4 w-4" />
            </button>
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-2" data-testid="workflow-view-tabs">
          {views.map((view) => {
            const Icon = view === 'Home' ? Home : view === 'Library' ? LibraryBig : view === 'Editor' ? GitBranch : History;
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
        {isRunSetupOpen && (
          <div className="mt-4 rounded-md border border-primary/30 bg-background p-3 shadow-sm" data-testid="workflow-run-setup-drawer">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Run setup</h3>
                <p className="text-xs text-muted-foreground">{draft.inputs.length} input field{draft.inputs.length === 1 ? '' : 's'} before execution.</p>
              </div>
              <button type="button" onClick={() => setIsRunSetupOpen(false)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">Close</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="workflow-run-inputs">
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
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setIsRunSetupOpen(false)} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-muted">Cancel</button>
              <button type="button" onClick={() => void startRun().then(() => setIsRunSetupOpen(false))} disabled={isBusy || draft.nodes.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                <Play className="h-4 w-4" />
                Start run
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {activeView === 'Home' && (
        <div className="min-h-0 flex-1 overflow-auto p-5" data-testid="workflow-home-overview">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <main className="space-y-4">
              <section className="grid gap-3 md:grid-cols-4">
                {[
                  ['Workflows', workflows.length],
                  ['Recent runs', runs.length],
                  ['Failed work', failedRuns.length],
                  ['Approvals', pendingApprovalRuns.length],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-border bg-card p-4 shadow-sm">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
                  </div>
                ))}
              </section>

              {workflows.length === 0 && (
                <section className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-4" data-testid="workflow-empty-state-guide">
                  <h2 className="text-sm font-semibold text-foreground">Start your first workflow</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Choose the fastest path for this project: template, blank workflow, or package import.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setActiveView('Library')} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
                      <LibraryBig className="h-4 w-4" />
                      Start from template
                    </button>
                    <button type="button" onClick={() => selectWorkflow(createBlankWorkflow(selectedProject))} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                      <Plus className="h-4 w-4" />
                      New blank
                    </button>
                    <button type="button" onClick={importFromClipboard} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                      <Upload className="h-4 w-4" />
                      Import package
                    </button>
                  </div>
                </section>
              )}

              <section className="rounded-md border border-border bg-card p-4 shadow-sm" data-testid="workflow-first-run-wizard">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">First run wizard</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Pick a workflow, confirm profile and inputs, then run a minimal approval-to-artifact path.</p>
                  </div>
                  <button type="button" onClick={() => setIsRunSetupOpen(true)} disabled={draft.nodes.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                    <Wand2 className="h-4 w-4" />
                    Prepare first run
                  </button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded border border-border bg-background p-3 text-xs">
                    <span className="font-semibold text-foreground">1. Workflow</span>
                    <span className="mt-1 block text-muted-foreground">{draft.name}</span>
                  </div>
                  <div className="rounded border border-border bg-background p-3 text-xs">
                    <span className="font-semibold text-foreground">2. Profile</span>
                    <span className="mt-1 block text-muted-foreground">{draft.profileId} / {draft.permissionPreset}</span>
                  </div>
                  <div className="rounded border border-border bg-background p-3 text-xs">
                    <span className="font-semibold text-foreground">3. Inputs</span>
                    <span className="mt-1 block text-muted-foreground">{draft.inputs.length} field{draft.inputs.length === 1 ? '' : 's'} required before run.</span>
                  </div>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-border bg-card p-4 shadow-sm" data-testid="workflow-recent-objects">
                  <h2 className="text-sm font-semibold text-foreground">Recent objects</h2>
                  <div className="mt-3 space-y-2">
                    {recentWorkflows.map((workflow) => (
                      <button key={workflow.id} type="button" onClick={() => openWorkflowDeepLink(workflow.id)} className="flex w-full items-center justify-between rounded border border-border px-3 py-2 text-left text-sm hover:bg-muted">
                        <span className="truncate">{workflow.name}</span>
                        <span className="text-xs text-muted-foreground">{workflow.nodes.length} nodes</span>
                      </button>
                    ))}
                    {recentWorkflows.length === 0 && <div className="rounded border border-dashed border-border p-4 text-sm text-muted-foreground">Recent workflows appear after you open or run one.</div>}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card p-4 shadow-sm" data-testid="workflow-favorites">
                  <h2 className="text-sm font-semibold text-foreground">Favorites</h2>
                  <div className="mt-3 space-y-2">
                    {favoriteWorkflows.map((workflow) => (
                      <button key={workflow.id} type="button" onClick={() => openWorkflowDeepLink(workflow.id)} className="flex w-full items-center justify-between rounded border border-border px-3 py-2 text-left text-sm hover:bg-muted">
                        <span className="truncate">{workflow.name}</span>
                        <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
                      </button>
                    ))}
                    {favoriteWorkflows.length === 0 && <div className="rounded border border-dashed border-border p-4 text-sm text-muted-foreground">Star workflows in Library to keep them here.</div>}
                  </div>
                </div>
              </section>
            </main>

            <aside className="space-y-4">
              <section className="rounded-md border border-border bg-card p-4 shadow-sm" data-testid="workflow-status-taxonomy">
                <h2 className="text-sm font-semibold text-foreground">Status taxonomy</h2>
                <div className="mt-3 space-y-2">
                  {statusTaxonomy.map((item) => (
                    <div key={item.status} className="rounded border border-border bg-background p-2 text-xs">
                      <span className={cn('inline-flex rounded-full border px-2 py-0.5', statusTone[item.status] || statusTone.pending)}>{item.label}</span>
                      <p className="mt-1 text-muted-foreground">{item.description}</p>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-md border border-border bg-card p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-foreground">Next actions</h2>
                <div className="mt-3 grid gap-2">
                  <button type="button" onClick={() => setIsCommandPaletteOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                    <Command className="h-4 w-4" />
                    Search commands
                  </button>
                  <button type="button" onClick={() => setActiveView('Runs')} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                    <History className="h-4 w-4" />
                    Review failed work
                  </button>
                  <button type="button" onClick={() => setIsHelpOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                    <HelpCircle className="h-4 w-4" />
                    Open help
                  </button>
                </div>
              </section>
            </aside>
          </div>
        </div>
      )}

      {activeView === 'Library' && (
        <div className="min-h-0 flex-1 overflow-auto p-5" data-testid="workflow-library">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Template gallery</h2>
              <p className="text-sm text-muted-foreground">Choose a workflow, inspect dependencies, then run or clone it into this project.</p>
            </div>
            <div className="flex flex-wrap gap-2">
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
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {libraryFilters.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setLibraryFilter(filter)}
                className={cn('rounded-md border px-3 py-1.5 text-xs', libraryFilter === filter ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}
              >
                {filter}
              </button>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" data-testid="workflow-library-gallery">
            {filteredWorkflows.map((workflow) => (
              <div
                role="button"
                tabIndex={0}
                key={workflow.id}
                data-testid="workflow-library-item"
                onClick={() => selectWorkflow(workflow)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') selectWorkflow(workflow);
                }}
                className={cn(
                  'rounded-md border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/40',
                  workflow.id === selectedWorkflowId ? 'border-primary' : 'border-border',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold text-foreground">{workflow.name}</h3>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavoriteWorkflow(workflow.id);
                    }}
                    className="rounded border border-border p-1 hover:bg-muted"
                    title={favoriteWorkflowIds.includes(workflow.id) ? 'Remove favorite' : 'Add favorite'}
                  >
                    <Star className={cn('h-3.5 w-3.5', favoriteWorkflowIds.includes(workflow.id) ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground')} />
                  </button>
                </div>
                <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{workflow.description || 'No description.'}</p>
                <div className="mt-3 rounded border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground" data-testid="workflow-template-manifest">
                  <span className="font-semibold text-foreground">Template</span>
                  <span className="ml-2">{String(getTemplateManifest(workflow).version || workflow.metadata?.version || 'local')}</span>
                  <span className="ml-2">{Array.isArray(getTemplateManifest(workflow).tags) ? (getTemplateManifest(workflow).tags || []).slice(0, 2).join(', ') : 'workflow'}</span>
                  <span className="ml-2" data-testid="workflow-template-smoke-status">
                    smoke: {String(((releaseReadiness?.templateSmoke as Array<Record<string, unknown>> | undefined) || []).find((item) => item.templateId === workflow.id)?.status || 'not run')}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded border border-border px-2 py-1">{workflow.nodes.length} nodes</span>
                  <span className="rounded border border-border px-2 py-1">{workflow.edges.length} edges</span>
                  <span className="rounded border border-border px-2 py-1">{workflow.profileId}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      selectWorkflow(workflow);
                      setIsRunSetupOpen(true);
                    }}
                    className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Run
                  </button>
                  <button
                    type="button"
                    data-testid="workflow-clone-template"
                    onClick={(event) => {
                      event.stopPropagation();
                      void cloneWorkflow(workflow);
                    }}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-xs hover:bg-muted"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Clone
                  </button>
                  <button
                    type="button"
                    data-testid="workflow-smoke-template"
                    onClick={(event) => {
                      event.stopPropagation();
                      void smokeTemplate(workflow);
                    }}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-xs hover:bg-muted"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Smoke
                  </button>
                </div>
              </div>
            ))}
          </div>
          <aside className="rounded-md border border-border bg-card p-4 shadow-sm" data-testid="workflow-template-preview">
            <h3 className="text-sm font-semibold text-foreground">{draft.name}</h3>
            <p className="mt-2 text-xs text-muted-foreground">{draft.description || 'No description.'}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <span className="rounded border border-border px-2 py-1">{draft.nodes.length} nodes</span>
              <span className="rounded border border-border px-2 py-1">{draft.edges.length} edges</span>
              <span className="rounded border border-border px-2 py-1">{draft.permissionPreset}</span>
              <span className="rounded border border-border px-2 py-1">{draft.inputs.length} inputs</span>
            </div>
            <div className="mt-4 rounded border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
              Expected outputs: {(draft.outputs || []).map((output) => output.label || output.id).join(', ') || 'summary'}
            </div>
          </aside>
          </div>
        </div>
      )}

      {activeView === 'Editor' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[260px_minmax(0,1fr)_300px] lg:overflow-hidden" data-testid="workflow-editor">
          <aside className="min-h-0 overflow-auto border-r border-border p-4">
            <h3 className="text-sm font-semibold text-foreground">Node palette</h3>
            <label className="mt-3 flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
              <Search className="h-4 w-4" />
              <input
                data-testid="workflow-node-search"
                value={nodeSearch}
                onChange={(event) => setNodeSearch(event.target.value)}
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
                      {items.map((item) => (
                        <button
                          key={item.type}
                          type="button"
                          data-testid="workflow-add-node"
                          data-node-type={item.type}
                          onClick={() => addNode(item.type)}
                          className="flex items-start gap-3 rounded-md border border-border bg-card p-3 text-left shadow-sm hover:bg-muted"
                        >
                          <item.icon className="mt-0.5 h-4 w-4 text-primary" />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-foreground">{item.label}</span>
                            <span className="block text-xs text-muted-foreground">{item.description}</span>
                            {riskyNodeTypes.has(item.type) && <span className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">permission gate</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
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
              <button type="button" data-testid="workflow-dry-run-debugger" onClick={validateRun} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50">
                <AlertTriangle className="h-4 w-4" />
                Dry run
              </button>
              <button type="button" onClick={exportDraft} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                <Download className="h-4 w-4" />
                Export
              </button>
            </div>
            {validationMessages.length > 0 && (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {validationMessages.map((message) => <div key={message} className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{message}</div>)}
              </div>
            )}
            {dryRunMessages.length > 0 && (
              <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800" data-testid="workflow-dry-run-debugger">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-700">Dry run debugger</h3>
                {dryRunMessages.map((message) => <div key={message} className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{message}</div>)}
              </div>
            )}
            {renderCanvas()}
          </main>

          <aside className="min-h-0 overflow-auto border-l border-border p-4" data-testid="workflow-node-inspector">
            <h3 className="text-sm font-semibold text-foreground">Inspector</h3>
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/20 p-1" data-testid="workflow-inspector-tabs">
              {inspectorTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setInspectorTab(tab)}
                  className={cn('rounded px-2 py-1 text-xs', inspectorTab === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60')}
                >
                  {tab}
                </button>
              ))}
            </div>
            {selectedNode ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{selectedNode.type} / {inspectorTab}</span>
                  <span className="mt-1 block">Configure this node without changing the workflow storage contract.</span>
                </div>
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
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground" data-testid="workflow-permission-source">
                  <span className="block font-semibold text-foreground">Permission source</span>
                  <span className="mt-1 block">{permissionSource}</span>
                  {riskyNodeTypes.has(selectedNode.type) && (
                    <span className="mt-2 block text-amber-700">Risky node: shell, MCP, tool, git/write-style actions may ask or deny before execution.</span>
                  )}
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground" data-testid="workflow-node-dependency-status">
                  <span className="block font-semibold text-foreground">Dependency status</span>
                  <span className="mt-1 block">
                    {selectedNode.type === 'mcp' && !selectedNode.toolName
                      ? 'Blocked: choose an MCP server.tool before running.'
                      : riskyNodeTypes.has(selectedNode.type)
                        ? `Permission gate: ${selectedNode.permission || draft.permissionPreset}`
                        : 'Ready: no external dependency required.'}
                  </span>
                </div>
                {selectedNodeDefinition?.configSchema?.fields?.length ? (
                  <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
                    <span className="block font-semibold text-foreground">Typed config</span>
                    <div className="mt-2 space-y-1">
                      {selectedNodeDefinition.configSchema.fields.map((field) => (
                        <div key={field.name} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                          <span>{field.label || field.name}{field.required ? ' *' : ''}</span>
                          <span className="font-mono text-[10px]">{field.type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => duplicateNode(selectedNode.id)} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                    <Copy className="h-4 w-4" />
                    Duplicate
                  </button>
                  <button type="button" onClick={() => deleteNode(selectedNode.id)} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm text-red-700 hover:bg-red-50">
                    <X className="h-4 w-4" />
                    Delete node
                  </button>
                </div>
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
                      <button
                        key={variable}
                        type="button"
                        data-testid="workflow-insert-variable"
                        onClick={() => insertVariable(variable)}
                        className="block w-full rounded border border-border bg-muted/40 px-2 py-1 text-left text-[11px] text-foreground hover:bg-muted"
                      >
                        <span className="font-mono">{'{{'}{variable}{'}}'}</span>
                        <span className="ml-2 text-muted-foreground">{variable.startsWith('inputs.') ? 'input' : 'upstream output'}</span>
                      </button>
                    ))}
                  </div>
                  {invalidVariables.length > 0 && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700" data-testid="workflow-invalid-variables">
                      Invalid variables: {invalidVariables.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            ) : selectedEdge ? (
              <div className="mt-3 space-y-3" data-testid="workflow-edge-editor">
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <span className="block font-semibold text-foreground">Edge</span>
                  <span className="mt-1 block">{selectedEdge.from} {'->'} {selectedEdge.to}</span>
                </div>
                <label className="block text-xs font-medium text-muted-foreground">
                  Branch mode
                  <select value={selectedEdge.mode || 'success'} onChange={(event) => updateEdge(selectedEdge.id, { mode: event.target.value as WorkflowEdge['mode'] })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground">
                    <option value="success">success</option>
                    <option value="failure">failure</option>
                    <option value="always">always</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  Condition label
                  <input value={selectedEdge.condition || ''} onChange={(event) => updateEdge(selectedEdge.id, { condition: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground" />
                </label>
                <button type="button" onClick={() => removeEdge(selectedEdge.id)} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm text-red-700 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                  Delete edge
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Select a node to edit its runtime contract.</p>
            )}
          </aside>
        </div>
      )}

      {activeView === 'Runs' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[300px_minmax(0,1fr)_400px] lg:overflow-hidden" data-testid="workflow-runs">
          <aside className="min-h-0 overflow-auto border-r border-border p-4">
            <h3 className="text-sm font-semibold text-foreground">Run list</h3>
            <div className="mt-3 space-y-2">
              {runs.map((run) => {
                const failedCount = Object.values(run.nodeRuns || {}).filter((nodeRun) => nodeRun.status === 'failed').length;
                const approvalCount = Object.values(run.nodeRuns || {}).filter((nodeRun) => nodeRun.status === 'waiting_approval').length;
                return (
                  <button key={`run-list-${run.id}`} type="button" className="block w-full rounded-md border border-border bg-card p-3 text-left text-xs hover:bg-muted">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-foreground">{run.workflowName}</span>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', statusTone[run.status] || statusTone.pending)}>{run.status}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                      <span>{Object.keys(run.nodeRuns || {}).length} nodes</span>
                      <span>{failedCount} failed</span>
                      <span>{approvalCount} approvals</span>
                      <span>{run.queue?.workerId || 'no worker'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
          <main className="min-h-0 overflow-auto p-4">
            {selectedRun ? renderCanvas(selectedRun) : (
              <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No workflow run yet.</div>
            )}
          </main>
          <aside className="min-h-0 overflow-auto border-l border-border p-4" data-testid="workflow-run-console">
            {approvalRequests.length > 0 && (
              <section className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3" data-testid="workflow-approval-inbox">
                <div data-testid="workflow-approval-inbox-panel">
                <h3 className="text-sm font-semibold text-amber-900">Approval Inbox</h3>
                <div className="mt-2 space-y-2">
                  {approvalRequests.map((approval) => (
                    <div key={String(approval.id)} className="rounded border border-amber-200 bg-background p-2 text-xs">
                      <div className="font-semibold text-foreground">{String(approval.nodeTitle || approval.nodeId)}</div>
                      <div className="mt-1 text-amber-700">{String(approval.riskLevel || 'medium')} - {String(approval.reason || 'Waiting for approval')}</div>
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => void decideApproval(String(approval.id), 'approve')} className="rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground">Approve</button>
                        <button type="button" onClick={() => void decideApproval(String(approval.id), 'reject')} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted">Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
                </div>
              </section>
            )}
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
                  {run.queue && (
                    <div className="mt-2 rounded border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground" data-testid="workflow-runtime-kernel">
                      <span className="font-semibold text-foreground">Runtime</span>
                      <span className="ml-2">queue: {run.queue.state || run.status}</span>
                      <span className="ml-2">worker: {run.queue.workerId || 'none'}</span>
                      <span className="ml-2">max: {run.queue.maxConcurrency || draft.maxConcurrency}</span>
                    </div>
                  )}
                  <div className="mt-3 space-y-2">
                    <details className="rounded border border-border bg-muted/20 p-2" data-testid="workflow-run-events">
                      <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">Run events</summary>
                      <div className="mt-2 max-h-32 space-y-1 overflow-auto">
                        {(runEvents[run.id] || run.timelineEvents || []).map((event) => (
                          <div key={String(event.id || `${event.type}-${event.createdAt}`)} className="rounded bg-background px-2 py-1 text-[11px] text-foreground">
                            {event.type}
                          </div>
                        ))}
                      </div>
                    </details>
                    {Object.values(run.nodeRuns || {}).map((nodeRun) => (
                      <div key={nodeRun.nodeId} className="rounded border border-border p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-foreground">{nodeRun.title}</span>
                          <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', statusTone[nodeRun.status] || statusTone.pending)}>{nodeRun.status}</span>
                        </div>
                        {nodeRun.waitingReason && <p className="mt-1 text-xs text-amber-700">{nodeRun.waitingReason}</p>}
                        {nodeRun.error && <p className="mt-1 text-xs text-red-700">{nodeRun.error}</p>}
                        {nodeRun.error && (
                          <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-700" data-testid="workflow-failure-diagnosis">
                            <span data-testid="workflow-run-diagnosis-panel" className="block">
                            Failure diagnosis: inspect node input/output, permission decision {nodeRun.permissionDecision || 'n/a'}, then retry from this node or rollback an attached checkpoint.
                            </span>
                          </div>
                        )}
                        {nodeRun.logs?.length ? <p className="mt-1 text-xs text-muted-foreground">{nodeRun.logs.at(-1)}</p> : null}
                        <div className="mt-2 grid gap-2" data-testid="workflow-node-run-details">
                          <details className="rounded border border-border bg-muted/20 p-2" data-testid="workflow-node-logs">
                            <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">Logs</summary>
                            <div className="mt-2 max-h-32 space-y-1 overflow-auto">
                              {(nodeLogs[`${run.id}:${nodeRun.nodeId}`] || []).map((entry, index) => (
                                <div key={`${entry.timestamp || index}-${entry.message}`} className={cn('rounded px-2 py-1 text-[11px]', entry.level === 'error' ? 'bg-red-50 text-red-700' : 'bg-background text-foreground')}>
                                  <span className="font-mono uppercase">{entry.level}</span> {entry.message}
                                </div>
                              ))}
                            </div>
                          </details>
                          <details className="rounded border border-border bg-muted/20 p-2">
                            <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">Input / output</summary>
                            <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[11px] text-foreground">{stringifyValue({ input: nodeRun.input, output: nodeRun.output })}</pre>
                          </details>
                          {nodeRun.checkpoints && Object.keys(nodeRun.checkpoints || {}).length > 0 && (
                            <details className="rounded border border-border bg-muted/20 p-2">
                              <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">Checkpoints</summary>
                              <div className="mt-2 space-y-2" data-testid="workflow-checkpoint-actions">
                                {Object.entries(nodeRun.checkpoints || {}).map(([phase, checkpoint]) => {
                                  const checkpointId = typeof checkpoint?.id === 'string' ? checkpoint.id : '';
                                  return (
                                    <div key={phase} className="rounded border border-border bg-background p-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-[11px] font-semibold text-foreground">{phase}: {checkpointId || 'pending'}</span>
                                        {checkpointId && (
                                          <div className="flex gap-1">
                                            <button type="button" onClick={() => openCheckpointDiff(checkpointId)} className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted">Diff</button>
                                            <button type="button" onClick={() => rollbackCheckpoint(checkpointId)} className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted">Rollback</button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
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
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button type="button" onClick={() => controlNode(run, nodeRun.nodeId, 'retry')} disabled={isBusy} className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-muted">
                              <RefreshCw className="h-3 w-3" />
                              Retry
                            </button>
                            <button type="button" data-testid="workflow-retry-from-node" onClick={() => retryWorkflowFromNode(run, nodeRun.nodeId)} disabled={isBusy} className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-muted">
                              <GitBranch className="h-3 w-3" />
                              Retry from
                            </button>
                          </div>
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
