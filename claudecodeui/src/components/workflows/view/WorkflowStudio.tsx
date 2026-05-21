import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  MoreHorizontal,
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
import {
  analyzeWorkflowGraphCompatibility,
  buildWorkflowFlowReferenceCatalog,
  flowGramDocumentToWorkflowDefinition,
  validateWorkflowFlowReferences,
  workflowDefinitionToFlowGramDocument,
} from '../model/workflowGraphAdapter';
import {
  createWorkflowNodeRegistry,
  defaultWorkflowPaletteGroups,
} from '../model/workflowNodeRegistry';
import { buildWorkflowMigrationDoctorReport } from '../model/workflowMigrationDoctor';
import { buildFlowGramRuntimeVisualState } from './flowgram/FlowGramRuntimeVisualBridge';
import type { WorkflowFlowGramEditorHandle } from './WorkflowFlowGramEditor';

const WorkflowFlowGramEditor = lazy(() => import('./WorkflowFlowGramEditor'));

type WorkflowStudioProps = {
  selectedProject: Project;
  sessionId?: string | null;
};

type StudioView = 'Home' | 'Library' | 'Editor' | 'Runs';
type WorkflowInspectorTab = 'Config' | 'Data' | 'Permissions' | 'Runtime';
type WorkflowLibraryFilter = 'All' | 'Built-in' | 'Enterprise' | 'Needs setup' | 'Recently used';
type WorkflowLayoutMode = 'left-to-right' | 'top-down' | 'compact';
type WorkflowEdgeRouteStyle = NonNullable<WorkflowEdge['routeStyle']>;
type WorkflowMinimapFilter = 'all' | 'status' | 'type' | 'risk';
type WorkflowUiMode = 'simple' | 'advanced';
type WorkflowHumanHint = {
  title: string;
  body: string;
  actionLabel: string;
};

type WorkflowPythonNodeManifest = {
  id?: string;
  type?: string;
  label?: string;
  description?: string;
  manifestVersion?: string;
  language?: string;
  dependencies?: string[];
  permissions?: Record<string, unknown>;
  configSchema?: {
    properties?: Record<string, { type?: string; title?: string; enum?: string[]; default?: unknown }>;
    required?: string[];
  };
  codeFiles?: Record<string, string>;
  testCases?: Array<{ id?: string; name?: string; input?: Record<string, unknown>; config?: Record<string, unknown>; expectedOutput?: Record<string, unknown>; expectedStatus?: string }>;
};

type WorkflowPythonNodeDraft = {
  status?: string;
  prompt?: string;
  manifest?: WorkflowPythonNodeManifest;
};

type WorkflowPythonNodeTestResult = {
  ok?: boolean;
  error?: { code?: string; category?: string; message?: string } | null;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number;
  parsedOutput?: Record<string, unknown>;
  testCaseId?: string;
  testCaseName?: string;
  assertionFailures?: Array<{ code?: string; path?: string; expected?: unknown; actual?: unknown; message?: string }>;
  cases?: WorkflowPythonNodeTestResult[];
};

type WorkflowNodePackageRecord = {
  id?: string;
  enabled?: boolean;
  status?: string;
  lifecycleState?: string;
  state?: string;
  updatedAt?: string;
  manifest?: Record<string, any>;
  definition?: {
    type?: string;
    label?: string;
    description?: string;
  };
  dependencies?: Record<string, unknown>;
  missingDependencies?: Array<Record<string, unknown>>;
};

type WorkflowNodePackageImpactReport = {
  packageId?: string;
  exists?: boolean;
  destructiveActionRisk?: string;
  totals?: {
    workflows?: number;
    templates?: number;
    recentRuns?: number;
  };
  affected?: {
    workflows?: Array<Record<string, any>>;
    templates?: Array<Record<string, any>>;
    recentRuns?: Array<Record<string, any>>;
  };
};

type WorkflowNodePackageCompatibility = {
  compatible?: boolean;
  reasons?: Array<{ code?: string; field?: string; from?: string; to?: string; message?: string }>;
  warnings?: Array<{ code?: string; message?: string }>;
};

type WorkflowDryRunPreview = {
  workflowId?: string;
  nodeCount?: number;
  blockedCount?: number;
  nodes?: Array<{
    nodeId?: string;
    type?: string;
    title?: string;
    resolvedInput?: Record<string, unknown>;
    permissionDecision?: string;
    upstream?: Array<{ nodeId?: string; mode?: string }>;
    blocked?: boolean;
    errors?: Array<{ code?: string; message?: string }>;
  }>;
};

type WorkflowPaletteGroup = {
  id: string;
  label: string;
  types: WorkflowNodeType[];
};

const views: StudioView[] = ['Home', 'Library', 'Editor', 'Runs'];

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

const workflowNodeRegistry = createWorkflowNodeRegistry();
const baseNodeTypes: Array<{ type: WorkflowNodeType; label: string; icon: typeof Bot; description: string }> = workflowNodeRegistry.definitions.map((definition) => ({
  type: definition.type,
  label: definition.label,
  icon: nodeIconByType[definition.type] || Bot,
  description: definition.description,
}));

const inspectorTabs: WorkflowInspectorTab[] = ['Config', 'Data', 'Permissions', 'Runtime'];
const libraryFilters: WorkflowLibraryFilter[] = ['All', 'Built-in', 'Enterprise', 'Needs setup', 'Recently used'];
const layoutModes: WorkflowLayoutMode[] = ['left-to-right', 'top-down', 'compact'];
const edgeRouteStyles: WorkflowEdgeRouteStyle[] = ['smoothstep', 'straight', 'step'];
const minimapFilters: WorkflowMinimapFilter[] = ['all', 'status', 'type', 'risk'];
const favoriteStorageKey = 'workflowStudio.favoriteWorkflowIds';
const recentStorageKey = 'workflowStudio.recentWorkflowIds';
const workflowUiModeStorageKey = 'workflowStudio.uiMode';
const nodePresetStorageKey = 'workflowStudio.nodeConfigPresets';
const pinnedRunStorageKey = 'workflowStudio.pinnedRunIds';
const archivedRunStorageKey = 'workflowStudio.archivedRunIds';
const transformFunctions = ['default(value)', 'join(list, ", ")', 'pick(object, "field")', 'truncate(text, 400)'];
const workflowNodeTopLevelConfigFields = new Set(['agentId', 'toolName', 'command', 'prompt', 'condition', 'permission', 'retryLimit', 'timeoutMs']);

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

const riskyNodeTypes = new Set<WorkflowNodeType>(['shell', 'mcp', 'tool']);

function makeId(prefix: string, count: number) {
  return `${prefix}-${count + 1}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function makeUniqueNodeId(nodes: WorkflowNode[], type: WorkflowNodeType) {
  let count = nodes.filter((node) => node.type === type).length;
  let id = makeId(type, count);
  while (nodes.some((node) => node.id === id)) {
    count += 1;
    id = makeId(type, count);
  }
  return { id, count };
}

function buildWorkflowNode(type: WorkflowNodeType, current: WorkflowDefinition, position: { x: number; y: number }, definition?: WorkflowNodeTypeDefinition | null) {
  const { id, count } = makeUniqueNodeId(current.nodes, type);
  const label = definition?.label || baseNodeTypes.find((item) => item.type === type)?.label || type;
  const configDefaults = Object.fromEntries((definition?.configSchema?.fields || [])
    .filter((field) => field.defaultValue !== undefined)
    .map((field) => [field.name, field.defaultValue]));
  return {
    id,
    type,
    title: `${label} ${count + 1}`,
    description: definition?.description || '',
    agentId: type === 'subagent' ? 'subagent-general' : type === 'agent' ? current.profileId : '',
    toolName: type === 'tool' ? 'git-native-review' : '',
    command: type === 'shell' ? 'npm test' : '',
    prompt: '',
    condition: '',
    permission: type === 'shell' || type === 'mcp' || type === 'tool' ? 'ask' : '',
    retryLimit: 0,
    timeoutMs: 120000,
    config: configDefaults,
    position,
  } satisfies WorkflowNode;
}

function getManifestConfigFields(manifest?: WorkflowPythonNodeManifest | null) {
  const schema = manifest?.configSchema || {};
  const required = new Set(schema.required || []);
  return Object.entries(schema.properties || {}).map(([name, property]) => ({
    name,
    label: property.title || name,
    type: property.type || 'string',
    options: Array.isArray(property.enum) ? property.enum : [],
    required: required.has(name),
    defaultValue: property.default,
  }));
}

function firstManifestCodeFile(manifest?: WorkflowPythonNodeManifest | null) {
  const entries = Object.entries(manifest?.codeFiles || {});
  return entries[0] || ['main.py', ''];
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

function readWorkflowUiMode(): WorkflowUiMode {
  if (typeof window === 'undefined') return 'simple';
  return window.localStorage.getItem(workflowUiModeStorageKey) === 'advanced' ? 'advanced' : 'simple';
}

function writeWorkflowUiMode(value: WorkflowUiMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(workflowUiModeStorageKey, value);
}

function writeStoredIds(key: string, value: string[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify([...new Set(value)].slice(0, 12)));
}

function readNodeConfigPresets() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(nodePresetStorageKey) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is { id: string; label: string; type: WorkflowNodeType; config: Partial<WorkflowNode> } => Boolean(item?.id && item?.type)) : [];
  } catch {
    return [];
  }
}

function writeNodeConfigPresets(value: Array<{ id: string; label: string; type: WorkflowNodeType; config: Partial<WorkflowNode> }>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(nodePresetStorageKey, JSON.stringify(value.slice(0, 24)));
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

function secretFieldDisplay(value: unknown) {
  const text = String(value || '');
  return text ? '••••••••' : 'No secret selected';
}

function validateOutputContract(nodeRun: WorkflowNodeRun | undefined, definition: WorkflowNodeTypeDefinition | null) {
  const fields = definition?.outputSchema?.fields || [];
  if (!nodeRun || fields.length === 0) return [];
  const output = nodeRun.output || {};
  return fields
    .filter((field) => !(field.name in output))
    .map((field) => `Missing output field: ${field.name}`);
}

function getNodeValidationBadges(workflow: WorkflowDefinition, node: WorkflowNode, lockedNodeIds: string[]) {
  const badges: string[] = [];
  if (lockedNodeIds.includes(node.id)) badges.push('locked');
  if (node.type === 'mcp' && !node.toolName) badges.push('missing mcp tool');
  if (node.type === 'shell' && !node.command?.trim()) badges.push('missing command');
  if ((node.type === 'agent' || node.type === 'subagent') && !node.agentId?.trim()) badges.push('missing agent');
  if (node.type === 'condition' && !node.condition?.trim()) badges.push('missing condition');
  if (riskyNodeTypes.has(node.type)) badges.push(`permission ${node.permission || workflow.permissionPreset}`);
  if (!workflow.edges.some((edge) => edge.from === node.id || edge.to === node.id) && workflow.nodes.length > 1) badges.push('unconnected');
  return badges.slice(0, 3);
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}

export default function WorkflowStudio({ selectedProject, sessionId = null }: WorkflowStudioProps) {
  const flowGramEditorRef = useRef<WorkflowFlowGramEditorHandle | null>(null);
  const [activeView, setActiveView] = useState<StudioView>('Home');
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [nodeTypeDefinitions, setNodeTypeDefinitions] = useState<WorkflowNodeTypeDefinition[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [draft, setDraft] = useState<WorkflowDefinition>(() => createBlankWorkflow(selectedProject));
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [nodeSearch, setNodeSearch] = useState('');
  const [copiedNodes, setCopiedNodes] = useState<WorkflowNode[]>([]);
  const [copiedEdges, setCopiedEdges] = useState<WorkflowEdge[]>([]);
  const [externalDraftUndo, setExternalDraftUndo] = useState<{ past: WorkflowDefinition | null; future: WorkflowDefinition | null }>({ past: null, future: null });
  const [layoutMode, setLayoutMode] = useState<WorkflowLayoutMode>('left-to-right');
  const [lockedNodeIds, setLockedNodeIds] = useState<string[]>([]);
  const [minimapFilter, setMinimapFilter] = useState<WorkflowMinimapFilter>('all');
  const [nodeConfigPresets, setNodeConfigPresets] = useState(() => readNodeConfigPresets());
  const [jsonConfigText, setJsonConfigText] = useState('{}');
  const [jsonConfigError, setJsonConfigError] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<WorkflowLibraryFilter>('All');
  const [inspectorTab, setInspectorTab] = useState<WorkflowInspectorTab>('Config');
  const [isRunSetupOpen, setIsRunSetupOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [workflowUiMode, setWorkflowUiMode] = useState<WorkflowUiMode>(() => readWorkflowUiMode());
  const [isCommandCenterMoreOpen, setIsCommandCenterMoreOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isInspectorAdvancedOpen, setIsInspectorAdvancedOpen] = useState(false);
  const [isRunAdvancedOpen, setIsRunAdvancedOpen] = useState(false);
  const [favoriteWorkflowIds, setFavoriteWorkflowIds] = useState<string[]>(() => readStoredIds(favoriteStorageKey));
  const [recentWorkflowIds, setRecentWorkflowIds] = useState<string[]>(() => readStoredIds(recentStorageKey));
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const [dryRunMessages, setDryRunMessages] = useState<string[]>([]);
  const [dryRunPreview, setDryRunPreview] = useState<WorkflowDryRunPreview | null>(null);
  const [runEvents, setRunEvents] = useState<Record<string, WorkflowRunEvent[]>>({});
  const [nodeLogs, setNodeLogs] = useState<Record<string, WorkflowNodeLog[]>>({});
  const [approvalRequests, setApprovalRequests] = useState<Array<Record<string, unknown>>>([]);
  const [workflowSecurity, setWorkflowSecurity] = useState<Record<string, any> | null>(null);
  const [agentBridgeState, setAgentBridgeState] = useState<Record<string, any> | null>(null);
  const [workflowToolRegistry, setWorkflowToolRegistry] = useState<Array<Record<string, any>>>([]);
  const [workflowMcpCatalog, setWorkflowMcpCatalog] = useState<Array<Record<string, any>>>([]);
  const [templateProductState, setTemplateProductState] = useState<Record<string, any> | null>(null);
  const [observabilityState, setObservabilityState] = useState<Record<string, any> | null>(null);
  const [governanceState, setGovernanceState] = useState<Record<string, any> | null>(null);
  const [readinessState, setReadinessState] = useState<Record<string, any> | null>(null);
  const [approvalAudit, setApprovalAudit] = useState<Record<string, any> | null>(null);
  const [releaseReadiness, setReleaseReadiness] = useState<Record<string, unknown> | null>(null);
  const [runLogQuery, setRunLogQuery] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [edgeInsertType, setEdgeInsertType] = useState<WorkflowNodeType>('tool');
  const [pinnedRunIds, setPinnedRunIds] = useState<string[]>(() => readStoredIds(pinnedRunStorageKey));
  const [archivedRunIds, setArchivedRunIds] = useState<string[]>(() => readStoredIds(archivedRunStorageKey));
  const [cancelConfirmation, setCancelConfirmation] = useState<WorkflowRun | null>(null);
  const [retryFromNodePreview, setRetryFromNodePreview] = useState<{ runId: string; nodeId: string; affected: string[] } | null>(null);
  const [approvalDelegationTarget, setApprovalDelegationTarget] = useState('local-owner');
  const [permissionOverrideRequest, setPermissionOverrideRequest] = useState('');
  const [secretVaultRefs, setSecretVaultRefs] = useState<string[]>([]);
  const [mcpAllowlistRows, setMcpAllowlistRows] = useState<string[]>([]);
  const [isCustomNodeReviewOpen, setIsCustomNodeReviewOpen] = useState(false);
  const [customNodePrompt, setCustomNodePrompt] = useState('Create a formatter node that uppercases text safely.');
  const [customNodeDraft, setCustomNodeDraft] = useState<WorkflowPythonNodeDraft | null>(null);
  const [customNodeValidation, setCustomNodeValidation] = useState<{ valid?: boolean; errors?: Array<{ code?: string; message?: string }>; warnings?: Array<{ code?: string; message?: string }> } | null>(null);
  const [customNodeTestResult, setCustomNodeTestResult] = useState<WorkflowPythonNodeTestResult | null>(null);
  const [customNodeInstallMessage, setCustomNodeInstallMessage] = useState('');
  const [customNodeUpgradeCompatibility, setCustomNodeUpgradeCompatibility] = useState<WorkflowNodePackageCompatibility | null>(null);
  const [workflowNodePackages, setWorkflowNodePackages] = useState<WorkflowNodePackageRecord[]>([]);
  const [nodePackageImpactReports, setNodePackageImpactReports] = useState<Record<string, WorkflowNodePackageImpactReport>>({});
  const [nodePackageActionMessage, setNodePackageActionMessage] = useState('');
  const [error, setError] = useState('');
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const isSimpleMode = workflowUiMode === 'simple';

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) || runs[0] || null,
    [runs, selectedRunId],
  );

  useEffect(() => {
    writeWorkflowUiMode(workflowUiMode);
  }, [workflowUiMode]);

  const effectiveSelectedNodeId = useMemo(() => {
    if (draft.nodes.some((node) => node.id === selectedNodeId)) return selectedNodeId;
    return selectedNodeIds.find((id) => draft.nodes.some((node) => node.id === id)) || '';
  }, [draft.nodes, selectedNodeId, selectedNodeIds]);
  const selectedNode = useMemo(() => draft.nodes.find((node) => node.id === effectiveSelectedNodeId) || null, [draft.nodes, effectiveSelectedNodeId]);
  const selectedEdge = useMemo(() => draft.edges.find((edge) => edge.id === selectedEdgeId) || null, [draft.edges, selectedEdgeId]);
  const agentOptions = useMemo(() => agents.filter((agent) => agent.status !== 'paused'), [agents]);
  const activeNodeRegistry = useMemo(() => createWorkflowNodeRegistry(nodeTypeDefinitions), [nodeTypeDefinitions]);
  const paletteNodeTypes = useMemo(() => {
    return activeNodeRegistry.definitions.map((definition) => ({
      type: definition.type,
      label: definition.label,
      icon: nodeIconByType[definition.type] || Bot,
      description: definition.description,
    }));
  }, [activeNodeRegistry]);
  const paletteGroups = useMemo<WorkflowPaletteGroup[]>(() => {
    const groupedTypes = new Set(defaultWorkflowPaletteGroups.flatMap((group) => group.types));
    const customTypes = activeNodeRegistry.definitions
      .filter((definition) => String(definition.ui?.materialGroup || '').toLowerCase() === 'custom' || !groupedTypes.has(definition.type))
      .map((definition) => definition.type);
    return customTypes.length > 0
      ? [...defaultWorkflowPaletteGroups, { id: 'custom', label: 'Custom', types: customTypes }]
      : defaultWorkflowPaletteGroups;
  }, [activeNodeRegistry]);
  const selectedNodeDefinition = useMemo(
    () => selectedNode ? activeNodeRegistry.byType.get(selectedNode.type) || null : null,
    [activeNodeRegistry, selectedNode],
  );
  const workGraphDocument = useMemo(() => workflowDefinitionToFlowGramDocument(draft), [draft]);
  const workGraphRoundtrip = useMemo(() => flowGramDocumentToWorkflowDefinition(workGraphDocument, draft), [draft, workGraphDocument]);
  const workGraphCompatibility = useMemo(() => analyzeWorkflowGraphCompatibility(draft, nodeTypeDefinitions), [draft, nodeTypeDefinitions]);
  const localMigrationDoctor = useMemo(() => buildWorkflowMigrationDoctorReport(workflows.length > 0 ? workflows : [draft], nodeTypeDefinitions), [draft, nodeTypeDefinitions, workflows]);
  const selectedWorkGraphRuntimeState = useMemo(() => buildFlowGramRuntimeVisualState(draft, selectedRun), [draft, selectedRun]);
  const shouldLoadExtendedWorkflowState = activeView === 'Library' || activeView === 'Runs';
  const schemaVersion = selectedNodeDefinition?.ui?.schemaVersion || selectedNode?.config?.schemaVersion || '1.0';
  const requiredFieldErrors = useMemo(() => {
    if (!selectedNode) return [];
    const errors: string[] = [];
    if (!selectedNode.title.trim()) errors.push('Title is required');
    if ((selectedNode.type === 'agent' || selectedNode.type === 'subagent') && !selectedNode.agentId?.trim()) errors.push('Agent is required');
    if ((selectedNode.type === 'mcp' || selectedNode.type === 'tool') && !selectedNode.toolName?.trim()) errors.push('Tool is required');
    if (selectedNode.type === 'shell' && !selectedNode.command?.trim()) errors.push('Command is required');
    if (selectedNode.type === 'condition' && !selectedNode.condition?.trim()) errors.push('Condition is required');
    (selectedNodeDefinition?.configSchema?.fields || []).forEach((field) => {
      if (field.required && !selectedNode.config?.[field.name]) errors.push(`${field.label || field.name} is required`);
    });
    return errors;
  }, [selectedNode, selectedNodeDefinition]);
  const typedVariablePicker = useMemo(() => {
    if (!selectedNode) return [];
    return buildWorkflowFlowReferenceCatalog(draft, selectedNode.id, nodeTypeDefinitions, runInputs).map((variable) => ({
      token: `{{${variable.path}}}`,
      path: variable.path,
      source: variable.source === 'workflow-input' ? 'workflow input' : 'upstream node output',
      type: variable.valueType,
      label: variable.label,
      example: variable.example,
    }));
  }, [draft, nodeTypeDefinitions, runInputs, selectedNode]);
  const mappingPreview = useMemo(() => draft.nodes.map((node) => ({
    node,
    input: {
      prompt: node.prompt || '',
      command: node.command || '',
      condition: node.condition || '',
      variables: [...(node.prompt || '').matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((match) => match[1]),
    },
  })), [draft.nodes]);
  const dataLineageRows = useMemo(() => {
    if (!selectedNode) return [];
    const incoming = draft.edges.filter((edge) => edge.to === selectedNode.id).map((edge) => `${edge.from} -> ${selectedNode.id}`);
    const outgoing = draft.edges.filter((edge) => edge.from === selectedNode.id).map((edge) => `${selectedNode.id} -> ${edge.to}`);
    return [...incoming, ...outgoing, ...typedVariablePicker.map((variable) => `${variable.source}: ${variable.token}`)];
  }, [draft.edges, selectedNode, typedVariablePicker]);
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
  const availableVariables = useMemo(() => typedVariablePicker.map((variable) => variable.path), [typedVariablePicker]);
  const selectedNodeTemplateText = selectedNode?.type === 'shell'
    ? selectedNode.command || ''
    : selectedNode?.type === 'condition'
      ? selectedNode.condition || ''
      : selectedNode?.prompt || '';
  const invalidVariables = useMemo(() => {
    const matches = [...selectedNodeTemplateText.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((match) => match[1]);
    return [...new Set(matches.filter((variable) => !availableVariables.includes(variable)))];
  }, [availableVariables, selectedNodeTemplateText]);
  const flowReferenceValidation = useMemo(() => selectedNode
    ? validateWorkflowFlowReferences(draft, selectedNode.id, nodeTypeDefinitions)
    : { valid: true, missing: [] }, [draft, nodeTypeDefinitions, selectedNode]);
  const permissionSource = useMemo(() => describePermissionSource(draft, selectedNode), [draft, selectedNode]);
  const failedRuns = useMemo(() => runs.filter((run) => run.status === 'failed'), [runs]);
  const pendingApprovalRuns = useMemo(() => runs.filter((run) => run.status === 'waiting_approval' || Object.values(run.nodeRuns || {}).some((nodeRun) => nodeRun.status === 'waiting_approval')), [runs]);
  const pollingStrategy = selectedRun?.status === 'running' || selectedRun?.status === 'waiting_approval'
    ? 'live polling every 2s with focused run refresh'
    : 'idle polling paused until manual refresh';
  const resumeBannerRuns = useMemo(() => runs.filter((run) => ['waiting_approval', 'recovering', 'queued'].includes(run.status)), [runs]);
  const visibleRuns = useMemo(() => [...runs]
    .filter((run) => !archivedRunIds.includes(run.id))
    .sort((a, b) => Number(pinnedRunIds.includes(b.id)) - Number(pinnedRunIds.includes(a.id))), [archivedRunIds, pinnedRunIds, runs]);
  const humanNextAction = useMemo<WorkflowHumanHint>(() => {
    if (draft.nodes.length === 0) {
      return {
        title: 'Start with one step',
        body: 'Add an Agent or Subagent step, then connect approval or artifact only when you need it.',
        actionLabel: 'Add step',
      };
    }
    if (!selectedNode) {
      return {
        title: 'Choose a step to configure',
        body: 'Select a node on the canvas, or run this workflow if the path already looks right.',
        actionLabel: 'Select node',
      };
    }
    if (selectedNode.type === 'shell' || selectedNode.type === 'mcp' || selectedNode.type === 'tool') {
      return {
        title: 'Check risk before running',
        body: 'This step may need permission approval. Run a dry check before starting the workflow.',
        actionLabel: 'Dry check',
      };
    }
    if (selectedNode.type === 'approval') {
      return {
        title: 'Approval step is ready',
        body: 'Use this step to pause risky work and keep a human in control.',
        actionLabel: 'Review approvals',
      };
    }
    return {
      title: `Configure ${selectedNode.title || selectedNode.type}`,
      body: 'Set the minimum fields, then run the workflow or add the next step.',
      actionLabel: 'Configure',
    };
  }, [draft.nodes.length, selectedNode]);
  const runStory = useMemo<WorkflowHumanHint>(() => {
    if (!selectedRun) {
      return {
        title: 'No run yet',
        body: 'Start a run from the current workflow to see live progress, approvals, and outputs here.',
        actionLabel: 'Start run',
      };
    }
    const waitingNode = Object.values(selectedRun.nodeRuns || {}).find((nodeRun) => nodeRun.status === 'waiting_approval');
    const failedNode = Object.values(selectedRun.nodeRuns || {}).find((nodeRun) => nodeRun.status === 'failed');
    if (waitingNode) {
      return {
        title: `Waiting for approval: ${waitingNode.title}`,
        body: waitingNode.waitingReason || 'Review the context and continue or reject this node.',
        actionLabel: 'Continue or reject',
      };
    }
    if (failedNode) {
      return {
        title: `Stopped at ${failedNode.title}`,
        body: failedNode.error || 'Inspect the failed node, then retry this node or retry from here.',
        actionLabel: 'Diagnose failure',
      };
    }
    if (selectedRun.status === 'completed') {
      return {
        title: 'Run completed',
        body: `${selectedRun.workflowName} finished. Review artifacts and evidence before closing work.`,
        actionLabel: 'Review outputs',
      };
    }
    return {
      title: `Run is ${selectedRun.status}`,
      body: `${Object.keys(selectedRun.nodeRuns || {}).length} nodes are tracked in this run story.`,
      actionLabel: 'Watch progress',
    };
  }, [selectedRun]);
  const previewConsistency = useMemo<WorkflowHumanHint>(() => {
    if (!selectedRun) {
      return {
        title: 'Preview not checked',
        body: 'Start a run after dry check to compare the reviewed preview with execution inputs.',
        actionLabel: 'No run',
      };
    }
    if (selectedRun.previewChanged || selectedRun.previewDiff?.changed) {
      const reasons = selectedRun.previewDiff?.reasons?.join(', ') || 'execution inputs changed after preview';
      return {
        title: 'Preview changed before execution',
        body: reasons,
        actionLabel: 'Review diff',
      };
    }
    return {
      title: 'Preview matched execution',
      body: 'The reviewed dry-run snapshot matches the inputs used to create this run.',
      actionLabel: 'Matched',
    };
  }, [selectedRun]);
  const previewChangedNodes = useMemo(() => (
    selectedRun?.previewDiff?.changedNodes || []
  ), [selectedRun]);
  const activeApprovalNode = useMemo(() => (
    selectedRun
      ? Object.values(selectedRun.nodeRuns || {}).find((nodeRun) => nodeRun.status === 'waiting_approval') || null
      : null
  ), [selectedRun]);
  const streamingLogRows = useMemo(() => {
    const rows = runs.flatMap((run) => Object.values(run.nodeRuns || {}).flatMap((nodeRun) => {
      const storedLogs = nodeLogs[`${run.id}:${nodeRun.nodeId}`]?.map((entry) => entry.message) || [];
      return [...(nodeRun.logs || []), ...storedLogs].map((message) => ({ run, nodeRun, message }));
    }));
    const query = runLogQuery.trim().toLowerCase();
    return query ? rows.filter((row) => `${row.run.workflowName} ${row.nodeRun.title} ${row.message}`.toLowerCase().includes(query)) : rows;
  }, [nodeLogs, runLogQuery, runs]);
  const compareRunAttempts = useMemo(() => {
    const attempts = Object.values(selectedRun?.nodeRuns || {}).filter((nodeRun) => nodeRun.attempt > 0);
    return attempts.map((nodeRun) => `${nodeRun.title}: attempt ${nodeRun.attempt} / ${nodeRun.status}`);
  }, [selectedRun]);
  const approvalRiskExplanation = useMemo(() => {
    const approval = approvalRequests[0] as any;
    if (approval?.riskExplanation?.reason) {
      return `${approval.riskExplanation.riskLevel}: ${approval.riskExplanation.reason}`;
    }
    const riskyNodes = draft.nodes.filter((node) => riskyNodeTypes.has(node.type));
    return riskyNodes.length > 0
      ? riskyNodes.map((node) => `${node.title}: ${node.type} uses ${node.permission || draft.permissionPreset}`).join('; ')
      : 'No high-risk nodes in this workflow.';
  }, [approvalRequests, draft.nodes, draft.permissionPreset]);
  const approvalDiffSummary = useMemo(() => {
    const approval = approvalRequests[0] as any;
    if (approval?.diffSummary?.summary) return approval.diffSummary.summary;
    const changedFiles = selectedRun?.artifacts?.map((artifact) => String(artifact.path || artifact.title || artifact.id)).filter(Boolean) || [];
    return changedFiles.length > 0 ? changedFiles.slice(0, 3).join(', ') : 'No file diff attached yet; checkpoint diff will appear when a write node runs.';
  }, [approvalRequests, selectedRun]);
  const approvalTimeoutPolicy = 'Timeout policy: fail after 30 minutes, escalate after 10 minutes idle.';
  const effectiveApprovalTimeoutPolicy = workflowSecurity?.timeoutPolicy
    ? `Timeout policy: ${workflowSecurity.timeoutPolicy.action} after ${workflowSecurity.timeoutPolicy.timeoutMinutes} minutes, escalate after ${workflowSecurity.timeoutPolicy.escalateAfterMinutes} minutes idle.`
    : approvalTimeoutPolicy;
  const effectiveApprovalDelegationTargets = Array.isArray(workflowSecurity?.delegation?.allowedTargets)
    ? workflowSecurity.delegation.allowedTargets
    : ['local-owner', 'project-maintainer', 'security-reviewer'];
  const approvalAuditExport = useMemo(() => ({
    runId: selectedRun?.id || 'no-run',
    decisions: Array.isArray(approvalAudit?.records) ? approvalAudit.records.length : approvalRequests.length,
    exportedFields: ['decision', 'actor', 'time', 'reason', 'run', 'node'],
  }), [approvalAudit, approvalRequests.length, selectedRun?.id]);
  const permissionDryRunRows = useMemo<Array<{ node: Partial<WorkflowNode> & { id: string; title: string; type: string }; decision: string; reason: string }>>(() => Array.isArray(workflowSecurity?.permissionDryRun?.rows)
    ? workflowSecurity.permissionDryRun.rows.map((row: any) => ({
      node: draft.nodes.find((node) => node.id === row.nodeId) || { id: row.nodeId, title: row.title, type: row.type },
      decision: row.decision,
      reason: row.reason,
    }))
    : draft.nodes.map((node) => {
    const risky = riskyNodeTypes.has(node.type);
    const decision = draft.permissionPreset === 'enterprise-safe' && risky ? 'deny' : risky ? node.permission || 'ask' : 'allow';
    return { node, decision, reason: risky ? `${node.type} requires explicit permission` : 'read-only/control node' };
  }), [draft.nodes, draft.permissionPreset, workflowSecurity]);
  const dangerousCommandPolicy = useMemo(() => {
    const backendRow = workflowSecurity?.permissionDryRun?.rows?.find((row: any) => row.dangerousCommand);
    if (backendRow) return backendRow.reason;
    const dangerous = draft.nodes
      .filter((node) => node.type === 'shell')
      .filter((node) => /\b(rm|del|Remove-Item|curl|wget|Invoke-WebRequest|git\s+reset)\b/i.test(node.command || ''));
    return dangerous.length > 0
      ? dangerous.map((node) => `${node.title}: force approval for ${node.command}`).join('; ')
      : 'No dangerous shell pattern detected; destructive/download/reset commands force approval.';
  }, [draft.nodes, workflowSecurity]);
  const agentSessionLinks = useMemo(() => (Array.isArray(agentBridgeState?.sessionLinks) && agentBridgeState.sessionLinks.length > 0
    ? agentBridgeState.sessionLinks.map((link: any) => `${link.nodeId}: ${link.sessionLink || link.sessionId || link.status}`)
    : runs.flatMap((run) => Object.values(run.nodeRuns || {})
    .filter((nodeRun) => nodeRun.type === 'agent' || nodeRun.type === 'subagent')
    .map((nodeRun) => `${run.workflowName} / ${nodeRun.title}: ${nodeRun.status}`))).slice(0, 4), [agentBridgeState, runs]);
  const agentPromptPreview = useMemo(() => {
    const backendNode = agentBridgeState?.agentNodes?.find((node: any) => node.nodeId === selectedNode?.id);
    return backendNode?.promptPreview || (selectedNode ? `${selectedNode.title}: ${selectedNode.prompt || selectedNode.command || selectedNode.condition || 'No prompt configured.'}` : 'Select an agent node to preview final prompt/context.');
  }, [agentBridgeState, selectedNode]);
  const agentResultContract = useMemo(() => (agentBridgeState?.agentNodes?.[0]?.resultContract || ['summary', 'artifacts', 'diffRefs', 'status', 'sessionId', 'sessionLink']).join(', '), [agentBridgeState]);
  const subagentPoolLimit = useMemo(() => agentBridgeState?.subagentPoolLimit || Math.max(1, Math.min(4, draft.maxConcurrency || 1)), [agentBridgeState, draft.maxConcurrency]);
  const subagentCancellationBridge = selectedRun ? `${selectedRun.workflowName}: cancel cascades to child subagent runs` : 'No active run selected.';
  const mcpToolCatalogSync = useMemo(() => workflowMcpCatalog.some((tool) => tool.enabled) ? workflowMcpCatalog.filter((tool) => tool.enabled).map((tool) => tool.toolName).join(', ') : nodeTypeDefinitions.filter((definition) => definition.type === 'mcp').length > 0 ? 'MCP catalog loaded; configure workflow allowlist to enable tools.' : 'MCP catalog waits for enabled server/tool definitions.', [nodeTypeDefinitions, workflowMcpCatalog]);
  const mcpArgumentBuilder = useMemo(() => selectedNode?.type === 'mcp' ? workflowMcpCatalog.find((tool) => tool.toolName === selectedNode.toolName)?.argumentSchema?.fields?.map((field: any) => field.name).join(', ') || Object.keys(selectedNode.config || {}).join(', ') || 'schema-driven fields pending' : 'Pick an MCP node to render arguments from tool schema.', [selectedNode, workflowMcpCatalog]);
  const mcpErrorNormalization = 'server not found / tool not found / schema invalid / timeout';
  const toolNodeRegistry = useMemo(() => workflowToolRegistry.map((tool) => tool.id || tool.label).join(', ') || nodeTypeDefinitions.filter((definition) => definition.type === 'tool').map((definition) => definition.label).join(', ') || 'Built-in tools registered through node definitions.', [nodeTypeDefinitions, workflowToolRegistry]);
  const browserScreenshotNode = workflowToolRegistry.some((tool) => tool.id === 'browser-screenshot')
    ? 'Browser Screenshot node is registered and outputs screenshotPath plus artifactId.'
    : 'Browser Screenshot node outputs screenshot artifact path and evidence reference.';
  const templateDetailPage = useMemo(() => templateProductState?.detail
    ? `${templateProductState.detail.manifest?.name}: ${templateProductState.detail.dag?.nodes?.length || 0} nodes, ${templateProductState.detail.manifest?.inputs?.length || 0} inputs`
    : filteredWorkflows[0] ? `${filteredWorkflows[0].name}: DAG, inputs, dependencies, screenshots` : 'No template selected.', [filteredWorkflows, templateProductState]);
  const templateDependencyCheck = templateProductState?.detail?.dependencyReport
    ? `${templateProductState.detail.dependencyReport.ready ? 'ready' : 'missing'}: ${(templateProductState.detail.dependencyReport.missing || []).map((item: any) => item.name).join(', ') || 'all dependencies satisfied'}`
    : 'Checks Agent/Profile/MCP/Skill/Secret dependencies before clone or run.';
  const templateSmokeBadge = useMemo(() => templateProductState?.detail?.smokeStatus
    ? `${templateProductState.detail.smokeStatus.status}: ${templateProductState.detail.smokeStatus.error || 'last smoke passed'}`
    : releaseReadiness ? stringifyValue(releaseReadiness).slice(0, 120) : 'Smoke status waits for benchmark readiness.', [releaseReadiness, templateProductState]);
  const templateVersionUpgrade = templateProductState?.upgrade
    ? `${templateProductState.upgrade.currentVersion} -> ${templateProductState.upgrade.latestVersion} (${templateProductState.upgrade.updateAvailable ? 'upgrade available' : 'current'})`
    : 'Installed templates show available version upgrades and compatibility warnings.';
  const templateMigrationNotes = Array.isArray(templateProductState?.upgrade?.migrationNotes) && templateProductState.upgrade.migrationNotes.length > 0
    ? templateProductState.upgrade.migrationNotes.join('; ')
    : 'No breaking migration notes for the selected template.';
  const templateFork = templateProductState?.detail?.trust ? `Fork creates project-private copy from ${templateProductState.detail.trust} template.` : 'Built-in templates can be forked into project-private workflows.';
  const packageExportWizard = templateProductState?.exportPreview
    ? `Export preview: ${templateProductState.exportPreview.workflowCount} workflow(s), ${templateProductState.exportPreview.packageSizeEstimateBytes} bytes.`
    : 'Export wizard collects workflow, dependencies, sample inputs, screenshots.';
  const packageImportPreview = 'Import preview API lists added/overwritten workflows, packages, templates before writing.';
  const marketplaceTrustBadge = templateProductState?.detail?.trust ? `Trust: ${templateProductState.detail.trust}` : 'Trust: built-in / local enterprise / community / unsigned.';
  const enterpriseTemplatePack = workflows.filter((workflow) => ['recipe-crashsight-analysis', 'recipe-redmine-review', 'recipe-code-impact-analysis', 'recipe-pr-description'].includes(workflow.id)).map((workflow) => workflow.name).join(', ') || 'CrashSight Analysis, Redmine Review, Code Impact Analysis, Publish PR.';
  const eventTimelineCorrelation = useMemo(() => selectedRun ? `${selectedRun.id}: timeline events link back to run nodes` : 'No run selected.', [selectedRun]);
  const replayVisualizer = useMemo(() => selectedRun ? `${observabilityState?.evidenceBundle?.replay?.events?.length ?? (runEvents[selectedRun.id] || selectedRun.timelineEvents || []).length} events available for replay` : 'No replay events.', [observabilityState, runEvents, selectedRun]);
  const failureClassifier = useMemo(() => observabilityState?.failures?.failures?.length
    ? observabilityState.failures.failures.map((failure: any) => `${failure.nodeId}:${failure.category}`).join(', ')
    : Object.values(selectedRun?.nodeRuns || {}).some((nodeRun) => nodeRun.error) ? 'classified: permission / dependency / timeout / agent / mcp / shell / schema' : 'No failures to classify.', [observabilityState, selectedRun]);
  const recommendedRecoveryAction = useMemo(() => observabilityState?.recovery?.actions?.length
    ? observabilityState.recovery.actions.flatMap((item: any) => item.recommendations || []).slice(0, 3).join(', ')
    : failedRuns.length > 0 ? 'Retry node, retry from node, rollback checkpoint, or edit config.' : 'No recovery action needed.', [failedRuns.length, observabilityState]);
  const artifactGallery = useMemo(() => (observabilityState?.artifacts?.artifacts || selectedRun?.artifacts || []).map((artifact: any) => String(artifact.title || artifact.path || artifact.id)).slice(0, 4), [observabilityState, selectedRun]);
  const screenshotEvidenceViewer = observabilityState?.evidence?.screenshots?.length
    ? `${observabilityState.evidence.screenshots.length} screenshot evidence file(s) available.`
    : 'Run screenshots are available from output/playwright/screenshots with issue-linked filenames.';
  const benchmarkTrend = observabilityState?.trend?.results?.length
    ? `${observabilityState.trend.results.length} benchmark trend point(s), latest ${observabilityState.trend.results.at(-1)?.status || 'unknown'}.`
    : 'Benchmark trend tracks latest result, duration, and failure reason per smoke workflow.';
  const releaseReadinessDetail = useMemo(() => observabilityState?.evidenceBundle?.releaseReadiness
    ? stringifyValue(observabilityState.evidenceBundle.releaseReadiness).slice(0, 120)
    : releaseReadiness ? stringifyValue(releaseReadiness).slice(0, 120) : 'Readiness detail is waiting for the next gate run.', [observabilityState, releaseReadiness]);
  const testCoverageMap = observabilityState?.coverageMap?.coverage?.length
    ? observabilityState.coverageMap.coverage.map((item: any) => item.file).join(', ')
    : 'Maps workflow features to unit, source contract, e2e, and screenshot gates.';
  const evidenceExport = selectedRun ? `${selectedRun.id}: ${observabilityState?.evidenceBundle ? 'bundle ready' : 'commands, screenshots, run id, commit sha'}` : 'Select a run to export evidence.';
  const workflowChangeHistory = useMemo(() => {
    const revisions = governanceState?.history?.revisions || governanceState?.governance?.revisions || [];
    return revisions.length > 0
      ? `${revisions.length} saved revision(s), latest ${revisions[0]?.currentDigest || governanceState?.history?.latestDigest || 'unknown'}`
      : 'Canvas undo/redo is handled by FlowGram HistoryService; backend history not loaded yet';
  }, [governanceState]);
  const draftPublishFlow = useMemo(() => {
    const governance = governanceState?.governance;
    return governance
      ? `${governance.status}; published revision ${governance.publishedRevisionId || 'none'} at ${governance.publishedAt || 'not published'}`
      : 'Draft and published definitions are separated; runs prefer published revisions.';
  }, [governanceState]);
  const reviewRequest = useMemo(() => {
    const requests = governanceState?.governance?.reviewRequests || [];
    return requests.length > 0
      ? `${requests.length} review request(s), latest ${requests.at(-1)?.status || 'requested'} for ${requests.at(-1)?.reviewer || 'reviewer'}`
      : 'Review request API returns DAG diff and risk changes before publish.';
  }, [governanceState]);
  const ownershipMetadata = useMemo(() => {
    const owner = governanceState?.governance?.ownership;
    return owner ? `Owner: ${owner.owner}; team: ${owner.team}; maintainer: ${owner.maintainer}; support: ${owner.supportContact}` : 'Owner: project team; maintainer: workflow owner; support: local enterprise contact.';
  }, [governanceState]);
  const deprecationFlow = useMemo(() => {
    const deprecated = governanceState?.governance?.deprecated;
    return deprecated?.enabled
      ? `Deprecated: ${deprecated.reason}; replacement ${deprecated.replacementWorkflowId || 'not set'}; impact ${deprecated.impact || 'review required'}`
      : 'Active workflow; deprecation API can record replacement template and affected recent runs.';
  }, [governanceState]);
  const usageAnalytics = useMemo(() => {
    const analytics = governanceState?.analytics?.[0];
    return analytics
      ? `${analytics.runCount} runs, ${(analytics.successRate * 100).toFixed(0)}% success, ${analytics.failureCount} failed`
      : `${runs.length} runs, ${failedRuns.length} failed, ${pendingApprovalRuns.length} waiting approvals`;
  }, [failedRuns.length, governanceState, pendingApprovalRuns.length, runs.length]);
  const roleBasedVisibility = useMemo(() => {
    const visibility = governanceState?.governance?.visibility;
    return visibility ? `Visible roles: ${(visibility.roles || []).join(', ') || 'none'}; default ${visibility.defaultRole}` : 'Visibility can be scoped by role for workflow, template, and node package.';
  }, [governanceState]);
  const complianceLabels = useMemo(() => {
    const labels = governanceState?.governance?.complianceLabels || [];
    return labels.length > 0 ? `Labels: ${labels.join(', ')}` : 'No compliance labels yet; supported labels include data-sensitive, external-network, code-write.';
  }, [governanceState]);
  const auditLogSearch = useMemo(() => {
    const records = governanceState?.audit || [];
    return records.length > 0 ? `${records.length} audit record(s), latest ${records[0]?.type || records[0]?.summary}` : 'Audit search filters workflow, run, approval, actor, and time.';
  }, [governanceState]);
  const policyReport = useMemo(() => {
    const report = governanceState?.policy?.workflows?.[0];
    return report ? `${report.status}; ${report.riskyNodes?.length || 0} risky node(s); MCP allowlist ${(report.mcpAllowlist || []).length}; approvals ${report.approvalCount || 0}` : 'Policy report summarizes security labels, dependencies, approvals, and MCP allowlist.';
  }, [governanceState]);
  const largeGraphPerformance = useMemo(() => readinessState?.performance
    ? `${readinessState.performance.nodeCount}/100 nodes, ${readinessState.performance.edgeCount} edges, ${readinessState.performance.status}`
    : `${draft.nodes.length}/100 nodes visible; FlowGram keeps canvas interaction stable.`, [draft.nodes.length, readinessState]);
  const virtualizedRunLogs = useMemo(() => readinessState?.virtualizedLogs
    ? `${readinessState.virtualizedLogs.rows?.length || 0}/${readinessState.virtualizedLogs.total || 0} virtualized log rows loaded`
    : `${streamingLogRows.length} log rows ready for virtualized rendering.`, [readinessState, streamingLogRows.length]);
  const offlineReadMode = readinessState?.offline
    ? `${readinessState.offline.mode}: ${readinessState.offline.workflows?.length || 0} workflows, ${readinessState.offline.runs?.length || 0} runs`
    : 'Cached workflow and run summaries remain readable when backend is unavailable.';
  const importValidationSandbox = templateProductState?.exportPreview?.sizeGuard
    ? `Import/export sandbox ready; package ${templateProductState.exportPreview.sizeGuard.status}, ${templateProductState.exportPreview.sizeGuard.estimatedBytes} bytes`
    : 'Package imports validate in an isolated preview before writing project data.';
  const storageBackupRestore = readinessState?.production
    ? `Backup includes ${readinessState.production.performance?.length || 0} workflow performance records plus definitions, runs, packages.`
    : 'Backup covers definitions, templates, node packages, run summaries.';
  const dataRetentionPolicy = readinessState?.retention
    ? `Retention: ${readinessState.retention.maxRuns} runs, ${readinessState.retention.maxLogEntriesPerNode} logs/node, ${readinessState.retention.artifactRetentionDays} artifact days`
    : 'Retention controls run logs, artifacts, checkpoints, and evidence expiry.';
  const packageSizeGuard = readinessState?.sizeGuard
    ? `${readinessState.sizeGuard.status}: ${readinessState.sizeGuard.estimatedBytes}/${readinessState.sizeGuard.maxRecommendedBytes} bytes`
    : 'Export/import warns on oversized screenshots, logs, and artifacts.';
  const releaseSmokeMatrix = readinessState?.smokeMatrix
    ? `${readinessState.smokeMatrix.passed}/${readinessState.smokeMatrix.total} release smoke gates passed`
    : 'Release matrix covers templates, permissions, approvals, screenshots, mobile.';
  const migrationDoctor = readinessState?.migrationDoctor
    ? `${readinessState.migrationDoctor.status}: ${readinessState.migrationDoctor.findings?.length || 0} finding(s)`
    : 'Upgrade doctor checks workflow schema, node packages, templates, and compatibility.';
  const productionReadinessDashboard = readinessState?.production
    ? `${readinessState.production.status}: ${readinessState.production.recentFailures?.length || 0} recent failure(s), ${readinessState.production.security?.length || 0} security report(s)`
    : 'Production readiness combines performance, quality, dependencies, security, template smoke, recent failures.';
  const favoriteWorkflows = useMemo(() => favoriteWorkflowIds.map((id) => workflows.find((workflow) => workflow.id === id)).filter((workflow): workflow is WorkflowDefinition => Boolean(workflow)), [favoriteWorkflowIds, workflows]);
  const recentWorkflows = useMemo(() => {
    const fromStorage = recentWorkflowIds.map((id) => workflows.find((workflow) => workflow.id === id)).filter((workflow): workflow is WorkflowDefinition => Boolean(workflow));
    const fromRuns = runs.map((run) => workflows.find((workflow) => workflow.id === run.workflowId)).filter((workflow): workflow is WorkflowDefinition => Boolean(workflow));
    return [...new Map([...fromStorage, ...fromRuns].map((workflow) => [workflow.id, workflow])).values()].slice(0, 6);
  }, [recentWorkflowIds, runs, workflows]);
  const customNodeConfigFields = useMemo(() => getManifestConfigFields(customNodeDraft?.manifest), [customNodeDraft]);
  const customNodeCodeFile = useMemo(() => firstManifestCodeFile(customNodeDraft?.manifest), [customNodeDraft]);
  const customNodeDependencyIssues = useMemo(() => {
    const dependencyErrors = (customNodeValidation?.errors || []).filter((item) => /dependency|import|standard library/i.test(`${item.code || ''} ${item.message || ''}`));
    const dependencyWarnings = (customNodeValidation?.warnings || []).filter((item) => /dependency|import|standard library/i.test(`${item.code || ''} ${item.message || ''}`));
    const declaredDependencies = customNodeDraft?.manifest?.dependencies || [];
    return [
      ...declaredDependencies.map((dependency) => `Dependency declared: ${dependency}`),
      ...dependencyErrors.map((item) => item.message || item.code || 'Dependency validation failed'),
      ...dependencyWarnings.map((item) => item.message || item.code || 'Dependency warning'),
    ];
  }, [customNodeDraft, customNodeValidation]);
  const installedWorkflowNodePackages = useMemo(() => workflowNodePackages.filter((item) => item?.id), [workflowNodePackages]);
  const workflowNodePackageSummary = useMemo(() => {
    const enabled = installedWorkflowNodePackages.filter((item) => item.enabled !== false && (item.lifecycleState || item.state) !== 'disabled').length;
    const disabled = installedWorkflowNodePackages.length - enabled;
    return `${enabled} enabled / ${disabled} disabled`;
  }, [installedWorkflowNodePackages]);

  const loadWorkflowNodePackages = useCallback(async () => {
    const response = await api.workflowNodePackages();
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Failed to load workflow node packages');
    setWorkflowNodePackages(data.packages || []);
    return data.packages || [];
  }, []);

  const loadNodeTypes = useCallback(async () => {
    const response = await api.workflowNodeTypes();
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Failed to load workflow node types');
    setNodeTypeDefinitions(data.nodeTypes || []);
  }, []);

  const loadData = useCallback(async () => {
    setError('');
    const [workflowsResponse, runsResponse, agentsResponse, nodeTypesResponse, approvalsResponse, nodePackagesResponse] = await Promise.all([
      api.workflows(),
      api.workflowRuns({ limit: 25 }),
      api.agents(false, 'all'),
      api.workflowNodeTypes(),
      api.workflowApprovals(),
      api.workflowNodePackages(),
    ]);
    const [workflowsData, runsData, agentsData, nodeTypesData, approvalsData, nodePackagesData] = await Promise.all([
      workflowsResponse.json(),
      runsResponse.json(),
      agentsResponse.json(),
      nodeTypesResponse.json(),
      approvalsResponse.json(),
      nodePackagesResponse.json(),
    ]);
    if (!workflowsResponse.ok) throw new Error(workflowsData?.error || 'Failed to load workflows');
    if (!runsResponse.ok) throw new Error(runsData?.error || 'Failed to load workflow runs');
    if (!agentsResponse.ok) throw new Error(agentsData?.error || 'Failed to load agents');
    if (!nodeTypesResponse.ok) throw new Error(nodeTypesData?.error || 'Failed to load workflow node types');
    if (!nodePackagesResponse.ok) throw new Error(nodePackagesData?.error || 'Failed to load workflow node packages');
    const loadedWorkflows = workflowsData.workflows || [];
    setWorkflows(loadedWorkflows);
    setRuns(runsData.runs || []);
    setAgents(agentsData.agents || []);
    setNodeTypeDefinitions(nodeTypesData.nodeTypes || []);
    setWorkflowNodePackages(nodePackagesData.packages || []);
    setApprovalRequests(approvalsResponse.ok ? approvalsData.approvals || [] : []);
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
    if (!draft.id || !shouldLoadExtendedWorkflowState) return;
    let cancelled = false;
    const loadSecurity = async () => {
      const [securityResponse, auditResponse, bridgeResponse, toolsResponse, mcpResponse, templateResponse, upgradeResponse, exportPreviewResponse, historyResponse, governanceResponse, analyticsResponse, auditSearchResponse, policyResponse, performanceResponse, offlineResponse, retentionResponse, sizeGuardResponse, smokeMatrixResponse, doctorResponse, productionResponse] = await Promise.all([
        api.workflowSecurity(draft.id),
        api.exportWorkflowApprovalAudit(draft.id, selectedRun?.id || ''),
        api.workflowAgentBridge(draft.id),
        api.workflowToolRegistry(),
        api.workflowMcpToolCatalog(draft.id),
        api.workflowTemplateDetail(draft.id),
        api.workflowTemplateUpgradeStatus(draft.id),
        api.previewWorkflowPackageExport([draft.id]),
        api.workflowHistory(draft.id),
        api.workflowGovernance(draft.id),
        api.workflowUsageAnalytics(draft.id),
        api.workflowAuditSearch({ workflowId: draft.id, limit: 25 }),
        api.workflowPolicyReport(draft.id),
        api.workflowGraphPerformance(draft.id),
        api.workflowOfflineSnapshot(),
        api.workflowRetentionPolicy(),
        api.workflowPackageSizeGuard([draft.id]),
        api.workflowReleaseSmokeMatrix(),
        api.workflowMigrationDoctor(),
        api.workflowProductionReadiness(),
      ]);
      const [securityData, auditData, bridgeData, toolsData, mcpData, templateData, upgradeData, exportPreviewData, historyData, governanceData, analyticsData, auditSearchData, policyData, performanceData, offlineData, retentionData, sizeGuardData, smokeMatrixData, doctorData, productionData] = await Promise.all([
        securityResponse.json(),
        auditResponse.json(),
        bridgeResponse.json(),
        toolsResponse.json(),
        mcpResponse.json(),
        templateResponse.json(),
        upgradeResponse.json(),
        exportPreviewResponse.json(),
        historyResponse.json(),
        governanceResponse.json(),
        analyticsResponse.json(),
        auditSearchResponse.json(),
        policyResponse.json(),
        performanceResponse.json(),
        offlineResponse.json(),
        retentionResponse.json(),
        sizeGuardResponse.json(),
        smokeMatrixResponse.json(),
        doctorResponse.json(),
        productionResponse.json(),
      ]);
      if (cancelled) return;
      const readinessResponse = await api.workflowBenchmarkReadiness();
      const readinessData = await readinessResponse.json();
      if (cancelled) return;
      if (readinessResponse.ok) setReleaseReadiness(readinessData.readiness || null);
      if (securityResponse.ok) {
        setWorkflowSecurity(securityData.security || null);
        setSecretVaultRefs(Array.isArray(securityData.security?.secretRefs) ? securityData.security.secretRefs : []);
        setMcpAllowlistRows(Array.isArray(securityData.security?.mcpAllowlist) ? securityData.security.mcpAllowlist : []);
        setApprovalDelegationTarget(securityData.security?.delegation?.target || 'local-owner');
      }
      if (auditResponse.ok) setApprovalAudit(auditData.audit || null);
      if (bridgeResponse.ok) setAgentBridgeState(bridgeData.bridge || null);
      if (toolsResponse.ok) setWorkflowToolRegistry(Array.isArray(toolsData.tools) ? toolsData.tools : []);
      if (mcpResponse.ok) setWorkflowMcpCatalog(Array.isArray(mcpData.tools) ? mcpData.tools : []);
      setTemplateProductState({
        detail: templateResponse.ok ? templateData.detail : null,
        upgrade: upgradeResponse.ok ? upgradeData.status : null,
        exportPreview: exportPreviewResponse.ok ? exportPreviewData.preview : null,
      });
      setGovernanceState({
        history: historyResponse.ok ? historyData.history : null,
        governance: governanceResponse.ok ? governanceData.governance : null,
        analytics: analyticsResponse.ok ? analyticsData.analytics : null,
        audit: auditSearchResponse.ok ? auditSearchData.records : null,
        policy: policyResponse.ok ? policyData.report : null,
      });
      setReadinessState({
        performance: performanceResponse.ok ? performanceData.report : null,
        offline: offlineResponse.ok ? offlineData.snapshot : null,
        retention: retentionResponse.ok ? retentionData.policy : null,
        sizeGuard: sizeGuardResponse.ok ? sizeGuardData.guard : null,
        smokeMatrix: smokeMatrixResponse.ok ? smokeMatrixData.matrix : null,
        migrationDoctor: doctorResponse.ok ? doctorData.doctor : null,
        production: productionResponse.ok ? productionData.dashboard : null,
      });
      if (selectedRun?.id) {
        const [failuresResponse, recoveryResponse, artifactsResponse, evidenceResponse, trendResponse, coverageResponse, bundleResponse] = await Promise.all([
          api.workflowRunFailures(selectedRun.id),
          api.workflowRecoveryActions(selectedRun.id),
          api.workflowRunArtifacts(selectedRun.id),
          api.workflowRunEvidence(selectedRun.id),
          api.workflowBenchmarkTrend(),
          api.workflowCoverageMap(),
          api.exportWorkflowRunEvidence(selectedRun.id),
        ]);
        const [failuresData, recoveryData, artifactsData, evidenceData, trendData, coverageData, bundleData] = await Promise.all([
          failuresResponse.json(),
          recoveryResponse.json(),
          artifactsResponse.json(),
          evidenceResponse.json(),
          trendResponse.json(),
          coverageResponse.json(),
          bundleResponse.json(),
        ]);
        if (!cancelled) {
          setObservabilityState({
            failures: failuresResponse.ok ? failuresData.failures : null,
            recovery: recoveryResponse.ok ? recoveryData.recovery : null,
            artifacts: artifactsResponse.ok ? artifactsData.artifacts : null,
            evidence: evidenceResponse.ok ? evidenceData.evidence : null,
            trend: trendResponse.ok ? trendData.trend : null,
            coverageMap: coverageResponse.ok ? coverageData.coverageMap : null,
            evidenceBundle: bundleResponse.ok ? bundleData.bundle : null,
          });
        }
      }
    };
    void loadSecurity().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [draft.id, selectedRun?.id, shouldLoadExtendedWorkflowState]);

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

  const commitDraft = useCallback((updater: (current: WorkflowDefinition) => WorkflowDefinition) => {
    setDraft((current) => {
      return updater(current);
    });
  }, []);

  const updateDraft = useCallback((patch: Partial<WorkflowDefinition>) => {
    commitDraft((current) => ({ ...current, ...patch }));
  }, [commitDraft]);

  const undoWorkflowEdit = useCallback(async () => {
    if (await flowGramEditorRef.current?.undo()) return;
    if (!externalDraftUndo.past) return;
    setDraft(externalDraftUndo.past);
    setExternalDraftUndo({ past: null, future: draft });
  }, [draft, externalDraftUndo.past]);

  const redoWorkflowEdit = useCallback(async () => {
    if (await flowGramEditorRef.current?.redo()) return;
    if (!externalDraftUndo.future) return;
    setDraft(externalDraftUndo.future);
    setExternalDraftUndo({ past: draft, future: null });
  }, [draft, externalDraftUndo.future]);

  const updateNode = useCallback((nodeId: string, patch: Partial<WorkflowNode>) => {
    commitDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    }));
  }, [commitDraft]);

  const getNodeFormMetaValue = useCallback((node: WorkflowNode, fieldName: string) => {
    if (workflowNodeTopLevelConfigFields.has(fieldName)) {
      return node[fieldName as keyof WorkflowNode] ?? '';
    }
    return node.config?.[fieldName] ?? '';
  }, []);

  const updateNodeFormMetaValue = useCallback((node: WorkflowNode, fieldName: string, value: unknown) => {
    if (workflowNodeTopLevelConfigFields.has(fieldName)) {
      updateNode(node.id, { [fieldName]: value } as Partial<WorkflowNode>);
      return;
    }
    updateNode(node.id, {
      config: {
        ...(node.config || {}),
        [fieldName]: value,
      },
    });
  }, [updateNode]);

  const updateEdge = useCallback((edgeId: string, patch: Partial<WorkflowEdge>) => {
    commitDraft((current) => ({
      ...current,
      edges: current.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)),
    }));
  }, [commitDraft]);

  useEffect(() => {
    setJsonConfigText(JSON.stringify(selectedNode?.config || {}, null, 2));
    setJsonConfigError('');
  }, [selectedNode?.id, selectedNode?.config]);

  const saveNodeConfigPreset = useCallback(() => {
    if (!selectedNode) return;
    const preset = {
      id: `preset-${selectedNode.type}-${Date.now()}`,
      label: `${selectedNode.title || selectedNode.type} preset`,
      type: selectedNode.type,
      config: {
        agentId: selectedNode.agentId,
        toolName: selectedNode.toolName,
        command: selectedNode.command,
        prompt: selectedNode.prompt,
        condition: selectedNode.condition,
        permission: selectedNode.permission,
        retryLimit: selectedNode.retryLimit,
        timeoutMs: selectedNode.timeoutMs,
        config: selectedNode.config,
      },
    };
    setNodeConfigPresets((current) => {
      const next = [preset, ...current].slice(0, 24);
      writeNodeConfigPresets(next);
      return next;
    });
  }, [selectedNode]);

  const applyNodeConfigPreset = useCallback((presetId: string) => {
    if (!selectedNode) return;
    const preset = nodeConfigPresets.find((item) => item.id === presetId);
    if (!preset) return;
    updateNode(selectedNode.id, preset.config);
  }, [nodeConfigPresets, selectedNode, updateNode]);

  const applyJsonConfig = useCallback(() => {
    if (!selectedNode) return;
    try {
      const parsed = JSON.parse(jsonConfigText || '{}');
      setJsonConfigError('');
      updateNode(selectedNode.id, { config: parsed });
    } catch (parseError) {
      setJsonConfigError(parseError instanceof Error ? parseError.message : 'Invalid JSON config');
    }
  }, [jsonConfigText, selectedNode, updateNode]);

  const addNode = useCallback((type: WorkflowNodeType) => {
    commitDraft((current) => {
      const nodeDefinition = activeNodeRegistry.byType.get(type) || null;
      const node = buildWorkflowNode(type, current, { x: 80 + current.nodes.length * 220, y: 120 + (current.nodes.length % 2) * 140 }, nodeDefinition);
      setSelectedNodeId(node.id);
      setSelectedNodeIds([node.id]);
      return { ...current, nodes: [...current.nodes, node] };
    });
  }, [activeNodeRegistry, commitDraft]);

  const deleteNode = useCallback((nodeId: string) => {
    commitDraft((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
    }));
    setSelectedNodeId('');
    setSelectedNodeIds((current) => current.filter((id) => id !== nodeId));
  }, [commitDraft]);

  const duplicateNode = useCallback((nodeId: string) => {
    commitDraft((current) => {
      const source = current.nodes.find((node) => node.id === nodeId);
      if (!source) return current;
      const copy: WorkflowNode = {
        ...source,
        id: makeId(`${source.type}-copy`, current.nodes.length),
        title: `${source.title} Copy`,
        position: { x: source.position.x + 36, y: source.position.y + 36 },
      };
      setSelectedNodeId(copy.id);
      setSelectedNodeIds([copy.id]);
      return { ...current, nodes: [...current.nodes, copy] };
    });
  }, [commitDraft]);

  const autoLayoutNodes = useCallback(() => {
    commitDraft((current) => {
      const unlockedNodes = current.nodes.filter((node) => !lockedNodeIds.includes(node.id));
      const positioned = new Map(unlockedNodes.map((node, index) => {
        const compactColumns = 3;
        const position = layoutMode === 'top-down'
          ? { x: 140 + (index % compactColumns) * 260, y: 100 + Math.floor(index / compactColumns) * 170 }
          : layoutMode === 'compact'
            ? { x: 100 + (index % 4) * 210, y: 100 + Math.floor(index / 4) * 135 }
            : { x: 90 + index * 250, y: 140 + (index % 2) * 70 };
        return [node.id, position] as const;
      }));
      return {
        ...current,
        nodes: current.nodes.map((node) => positioned.has(node.id) ? { ...node, position: positioned.get(node.id)! } : node),
      };
    });
  }, [commitDraft, layoutMode, lockedNodeIds]);

  const copySelectedNodes = useCallback(() => {
    const ids = selectedNodeIds.length > 0 ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : [];
    if (ids.length === 0) return;
    const selected = draft.nodes.filter((node) => ids.includes(node.id));
    setCopiedNodes(selected);
    setCopiedEdges(draft.edges.filter((edge) => ids.includes(edge.from) && ids.includes(edge.to)));
  }, [draft.edges, draft.nodes, selectedNodeId, selectedNodeIds]);

  const pasteCopiedNodes = useCallback(() => {
    if (copiedNodes.length === 0) return;
    commitDraft((current) => {
      const idMap = new Map<string, string>();
      const copies = copiedNodes.map((node, index) => {
        const nextId = makeId(`${node.id}-copy`, current.nodes.length + index);
        idMap.set(node.id, nextId);
        return {
          ...node,
          id: nextId,
          title: `${node.title} Copy`,
          position: { x: node.position.x + 64, y: node.position.y + 64 },
        };
      });
      const edgeCopies = copiedEdges
        .filter((edge) => idMap.has(edge.from) && idMap.has(edge.to))
        .map((edge, index) => ({
          ...edge,
          id: makeId(`${edge.id}-copy`, current.edges.length + index),
          from: idMap.get(edge.from)!,
          to: idMap.get(edge.to)!,
        }));
      const copyIds = copies.map((node) => node.id);
      setSelectedNodeId(copyIds[0] || '');
      setSelectedNodeIds(copyIds);
      return { ...current, nodes: [...current.nodes, ...copies], edges: [...current.edges, ...edgeCopies] };
    });
  }, [commitDraft, copiedEdges, copiedNodes]);

  const duplicateSelectedSubgraph = useCallback(() => {
    copySelectedNodes();
    const ids = selectedNodeIds.length > 0 ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : [];
    if (ids.length === 0) return;
    const nodesToCopy = draft.nodes.filter((node) => ids.includes(node.id));
    const edgesToCopy = draft.edges.filter((edge) => ids.includes(edge.from) && ids.includes(edge.to));
    if (nodesToCopy.length === 0) return;
    setExternalDraftUndo({ past: draft, future: null });
    commitDraft((current) => {
      const idMap = new Map<string, string>();
      const copies = nodesToCopy.map((node, index) => {
        const nextId = makeId(`${node.id}-branch`, current.nodes.length + index);
        idMap.set(node.id, nextId);
        return {
          ...node,
          id: nextId,
          title: `${node.title} Branch`,
          position: { x: node.position.x + 96, y: node.position.y + 96 },
        };
      });
      const edgeCopies = edgesToCopy.map((edge, index) => ({
        ...edge,
        id: makeId(`${edge.id}-branch`, current.edges.length + index),
        from: idMap.get(edge.from)!,
        to: idMap.get(edge.to)!,
      }));
      const copyIds = copies.map((node) => node.id);
      setSelectedNodeId(copyIds[0] || '');
      setSelectedNodeIds(copyIds);
      return { ...current, nodes: [...current.nodes, ...copies], edges: [...current.edges, ...edgeCopies] };
    });
  }, [commitDraft, copySelectedNodes, draft, selectedNodeId, selectedNodeIds]);

  const toggleLayoutLock = useCallback(() => {
    const ids = selectedNodeIds.length > 0 ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : [];
    if (ids.length === 0) return;
    setLockedNodeIds((current) => {
      const allLocked = ids.every((id) => current.includes(id));
      return allLocked ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])];
    });
  }, [selectedNodeId, selectedNodeIds]);

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
    commitDraft((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== edgeId) }));
    setSelectedEdgeId((current) => current === edgeId ? '' : current);
  }, [commitDraft]);

  const deleteSelectedGraphItems = useCallback(() => {
    if (selectedEdgeId) {
      removeEdge(selectedEdgeId);
      return;
    }
    const ids = selectedNodeIds.length > 0 ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : [];
    ids.forEach((id) => deleteNode(id));
  }, [deleteNode, removeEdge, selectedEdgeId, selectedNodeId, selectedNodeIds]);

  const requestFlowGramEdgeInsert = useCallback((edgeId: string, type: WorkflowNodeType) => {
    void flowGramEditorRef.current?.insertNodeOnEdge(edgeId, type);
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
    setDryRunPreview(null);
    try {
      const response = await api.validateWorkflowRun(draft.id, { inputs: runInputs });
      const data = await response.json();
      const validation = data.validation || {};
      setDryRunPreview(validation.preview || null);
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
        previewSnapshot: dryRunPreview || undefined,
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
  }, [draft.id, dryRunPreview, loadData, runInputs, selectedProject.fullPath, selectedProject.path, sessionId]);

  useEffect(() => {
    const onWorkflowEditorShortcut = (event: KeyboardEvent) => {
      const isCommandKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const editableTarget = isEditableShortcutTarget(event.target);
      if (editableTarget && !(isCommandKey && ['s', 'enter'].includes(key))) return;
      if (isCommandKey && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoWorkflowEdit();
      } else if ((isCommandKey && key === 'y') || (isCommandKey && event.shiftKey && key === 'z')) {
        event.preventDefault();
        redoWorkflowEdit();
      } else if (isCommandKey && key === 'c' && activeView === 'Editor') {
        event.preventDefault();
        copySelectedNodes();
      } else if (isCommandKey && key === 'v' && activeView === 'Editor') {
        event.preventDefault();
        pasteCopiedNodes();
      } else if (isCommandKey && key === 'd' && activeView === 'Editor') {
        event.preventDefault();
        duplicateSelectedSubgraph();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && activeView === 'Editor') {
        event.preventDefault();
        deleteSelectedGraphItems();
      } else if (isCommandKey && key === 's') {
        event.preventDefault();
        void saveWorkflow();
      } else if (isCommandKey && key === 'enter') {
        event.preventDefault();
        setIsRunSetupOpen(true);
      }
    };
    window.addEventListener('keydown', onWorkflowEditorShortcut);
    return () => window.removeEventListener('keydown', onWorkflowEditorShortcut);
  }, [
    activeView,
    copySelectedNodes,
    deleteSelectedGraphItems,
    duplicateSelectedSubgraph,
    pasteCopiedNodes,
    redoWorkflowEdit,
    saveWorkflow,
    undoWorkflowEdit,
  ]);

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
      const response = await api.decideWorkflowApproval(approvalId, { decision, approver: 'local-user', delegatedTo: approvalDelegationTarget });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to decide workflow approval');
      await loadData();
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Failed to decide workflow approval');
    } finally {
      setIsBusy(false);
    }
  }, [approvalDelegationTarget, loadData]);

  const saveWorkflowSecurity = useCallback(async (patch: Record<string, unknown>) => {
    setIsBusy(true);
    setError('');
    try {
      const response = await api.updateWorkflowSecurity(draft.id, {
        timeoutPolicy: workflowSecurity?.timeoutPolicy,
        delegation: workflowSecurity?.delegation,
        secretRefs: secretVaultRefs,
        mcpAllowlist: mcpAllowlistRows,
        ...patch,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update workflow security');
      setWorkflowSecurity(data.security || null);
      setSecretVaultRefs(Array.isArray(data.security?.secretRefs) ? data.security.secretRefs : []);
      setMcpAllowlistRows(Array.isArray(data.security?.mcpAllowlist) ? data.security.mcpAllowlist : []);
      setApprovalDelegationTarget(data.security?.delegation?.target || approvalDelegationTarget);
    } catch (securityError) {
      setError(securityError instanceof Error ? securityError.message : 'Failed to update workflow security');
    } finally {
      setIsBusy(false);
    }
  }, [approvalDelegationTarget, draft.id, mcpAllowlistRows, secretVaultRefs, workflowSecurity]);

  const createPermissionOverride = useCallback(async () => {
    if (!permissionOverrideRequest.trim()) return;
    setIsBusy(true);
    setError('');
    try {
      const response = await api.createWorkflowPermissionOverride(draft.id, {
        nodeId: selectedNodeId || draft.nodes.find((node) => riskyNodeTypes.has(node.type))?.id || '',
        requestedDecision: 'allow',
        reason: permissionOverrideRequest,
        requester: 'local-user',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to create permission override request');
      setPermissionOverrideRequest('');
      const securityResponse = await api.workflowSecurity(draft.id);
      const securityData = await securityResponse.json();
      if (securityResponse.ok) setWorkflowSecurity(securityData.security || null);
    } catch (overrideError) {
      setError(overrideError instanceof Error ? overrideError.message : 'Failed to create permission override request');
    } finally {
      setIsBusy(false);
    }
  }, [draft.id, draft.nodes, permissionOverrideRequest, selectedNodeId]);

  const refreshGovernance = useCallback(async () => {
    const [historyResponse, governanceResponse, analyticsResponse, auditResponse, policyResponse] = await Promise.all([
      api.workflowHistory(draft.id),
      api.workflowGovernance(draft.id),
      api.workflowUsageAnalytics(draft.id),
      api.workflowAuditSearch({ workflowId: draft.id, limit: 25 }),
      api.workflowPolicyReport(draft.id),
    ]);
    const [historyData, governanceData, analyticsData, auditData, policyData] = await Promise.all([
      historyResponse.json(),
      governanceResponse.json(),
      analyticsResponse.json(),
      auditResponse.json(),
      policyResponse.json(),
    ]);
    setGovernanceState({
      history: historyResponse.ok ? historyData.history : null,
      governance: governanceResponse.ok ? governanceData.governance : null,
      analytics: analyticsResponse.ok ? analyticsData.analytics : null,
      audit: auditResponse.ok ? auditData.records : null,
      policy: policyResponse.ok ? policyData.report : null,
    });
  }, [draft.id]);

  const workflowGovernanceAction = useCallback(async (action: 'publish' | 'review' | 'deprecate' | 'govern') => {
    setIsBusy(true);
    setError('');
    try {
      let response: Response;
      if (action === 'publish') {
        response = await api.publishWorkflow(draft.id, { actor: 'local-user' });
      } else if (action === 'review') {
        response = await api.requestWorkflowReview(draft.id, { requester: 'local-user', reviewer: 'workflow-owner', reason: 'Review DAG and risk changes before publishing.' });
      } else if (action === 'deprecate') {
        response = await api.deprecateWorkflow(draft.id, { actor: 'local-user', reason: 'Superseded by a safer workflow.', impact: 'New runs should choose a replacement workflow.' });
      } else {
        response = await api.updateWorkflowGovernance(draft.id, {
          actor: 'local-user',
          ownership: { owner: 'project-team', team: selectedProject.name || 'local', maintainer: 'workflow-owner', supportContact: 'local-enterprise-contact' },
          visibility: { roles: ['owner', 'maintainer', 'viewer'], defaultRole: 'viewer' },
          complianceLabels: ['data-sensitive', 'code-write'],
        });
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Failed to ${action} workflow`);
      await refreshGovernance();
    } catch (governanceError) {
      setError(governanceError instanceof Error ? governanceError.message : 'Failed to update workflow governance');
    } finally {
      setIsBusy(false);
    }
  }, [draft.id, refreshGovernance, selectedProject.name]);

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

  const generateCustomNodeDraft = useCallback(async () => {
    setIsBusy(true);
    setError('');
    setCustomNodeInstallMessage('');
    setCustomNodeUpgradeCompatibility(null);
    setCustomNodeTestResult(null);
    try {
      const response = await api.generateWorkflowNodePackageDraft({
        prompt: customNodePrompt,
        sampleInput: { text: 'hello workflow' },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to generate custom node draft');
      setCustomNodeDraft(data.draft || null);
      setCustomNodeValidation(null);
      setIsCustomNodeReviewOpen(true);
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : 'Failed to generate custom node draft');
    } finally {
      setIsBusy(false);
    }
  }, [customNodePrompt]);

  const validateCustomNodeDraft = useCallback(async () => {
    if (!customNodeDraft?.manifest) return;
    setIsBusy(true);
    setError('');
    try {
      const response = await api.validateWorkflowNodePackageDraft(customNodeDraft.manifest);
      const data = await response.json();
      setCustomNodeValidation({
        valid: Boolean(data.valid || data.validation?.valid || response.ok),
        errors: data.errors || data.validation?.errors || [],
        warnings: data.warnings || data.validation?.warnings || [],
      });
      if (!response.ok) throw new Error(data?.error || data?.errors?.[0]?.message || 'Custom node draft is not ready');
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Custom node draft is not ready');
    } finally {
      setIsBusy(false);
    }
  }, [customNodeDraft]);

  const testCustomNodeDraft = useCallback(async () => {
    if (!customNodeDraft?.manifest) return;
    setIsBusy(true);
    setError('');
    try {
      const response = await api.testWorkflowNodePackageDraft({
        manifest: customNodeDraft.manifest,
      });
      const data = await response.json();
      setCustomNodeTestResult(data.result || data);
      if (!response.ok || data?.ok === false || data?.result?.ok === false) {
        throw new Error(data?.error || data?.result?.error?.message || 'Custom node test failed');
      }
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Custom node test failed');
    } finally {
      setIsBusy(false);
    }
  }, [customNodeDraft]);

  const installCustomNodeDraft = useCallback(async () => {
    if (!customNodeDraft?.manifest) return;
    setIsBusy(true);
    setError('');
    setCustomNodeInstallMessage('');
    setCustomNodeUpgradeCompatibility(null);
    try {
      const response = await api.installWorkflowNodePackage(customNodeDraft.manifest);
      const data = await response.json();
      if (!response.ok) {
        setCustomNodeUpgradeCompatibility(data?.compatibility || null);
        throw new Error(data?.error || 'Failed to install custom node');
      }
      setCustomNodeInstallMessage(`${data.package?.definition?.label || customNodeDraft.manifest.label || 'Custom node'} installed`);
      await loadNodeTypes();
      await loadWorkflowNodePackages();
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : 'Failed to install custom node');
    } finally {
      setIsBusy(false);
    }
  }, [customNodeDraft, loadNodeTypes, loadWorkflowNodePackages]);

  const loadNodePackageImpact = useCallback(async (packageId: string) => {
    if (!packageId) return null;
    setIsBusy(true);
    setError('');
    try {
      const response = await api.workflowNodePackageImpact(packageId);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load node package impact');
      setNodePackageImpactReports((current) => ({ ...current, [packageId]: data.report || {} }));
      return data.report || null;
    } catch (impactError) {
      setError(impactError instanceof Error ? impactError.message : 'Failed to load node package impact');
      return null;
    } finally {
      setIsBusy(false);
    }
  }, []);

  const runNodePackageLifecycleAction = useCallback(async (packageId: string, action: 'enable' | 'disable' | 'uninstall') => {
    if (!packageId) return;
    setIsBusy(true);
    setError('');
    setNodePackageActionMessage('');
    try {
      if (action !== 'enable') {
        const impactResponse = await api.workflowNodePackageImpact(packageId);
        const impactData = await impactResponse.json();
        if (impactResponse.ok) {
          setNodePackageImpactReports((current) => ({ ...current, [packageId]: impactData.report || {} }));
        }
      }
      const response = action === 'enable'
        ? await api.enableWorkflowNodePackage(packageId)
        : action === 'disable'
          ? await api.disableWorkflowNodePackage(packageId)
          : await api.uninstallWorkflowNodePackage(packageId);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Failed to ${action} node package`);
      setNodePackageActionMessage(action === 'uninstall' ? `${packageId} uninstalled` : `${data.package?.definition?.label || packageId} ${action}d`);
      await Promise.all([loadNodeTypes(), loadWorkflowNodePackages()]);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Failed to ${action} node package`);
    } finally {
      setIsBusy(false);
    }
  }, [loadNodeTypes, loadWorkflowNodePackages]);

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
    const virtualLogsResponse = await api.workflowVirtualizedRunLogs(run.id, { limit: 200, query: runLogQuery });
    const virtualLogsData = await virtualLogsResponse.json();
    if (virtualLogsResponse.ok) {
      setReadinessState((current) => ({
        ...(current || {}),
        virtualizedLogs: virtualLogsData.logs,
      }));
    }
  }, [runLogQuery]);

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

  const retryNodeOnly = useCallback((run: WorkflowRun, nodeId: string) => {
    void controlNode(run, nodeId, 'retry');
  }, [controlNode]);

  const previewRetryFromNode = useCallback((run: WorkflowRun, nodeId: string) => {
    const nodeIds = draft.nodes.map((node) => node.id);
    const start = Math.max(0, nodeIds.indexOf(nodeId));
    setRetryFromNodePreview({ runId: run.id, nodeId, affected: nodeIds.slice(start) });
  }, [draft.nodes]);

  const toggleRunPin = useCallback((runId: string) => {
    setPinnedRunIds((current) => {
      const next = current.includes(runId) ? current.filter((id) => id !== runId) : [runId, ...current];
      writeStoredIds(pinnedRunStorageKey, next);
      return next;
    });
  }, []);

  const toggleRunArchive = useCallback((runId: string) => {
    setArchivedRunIds((current) => {
      const next = current.includes(runId) ? current.filter((id) => id !== runId) : [runId, ...current];
      writeStoredIds(archivedRunStorageKey, next);
      return next;
    });
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

  const renderCanvas = (run: WorkflowRun | null = null) => {
    const selectedCount = selectedNodeIds.length;
    const canUndoWorkflow = Boolean(flowGramEditorRef.current?.canUndo()) || Boolean(externalDraftUndo.past);
    const canRedoWorkflow = Boolean(flowGramEditorRef.current?.canRedo()) || Boolean(externalDraftUndo.future);
    return (
      <div className="relative rounded-md border border-border bg-card/60 p-3 shadow-sm">
        {!isSimpleMode && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2" data-testid="workflow-canvas-controls">
          <div className="text-xs text-muted-foreground" data-testid="workflow-multi-select">
            {draft.nodes.length} nodes / {draft.edges.length} edges
            <span className="ml-2 rounded border border-border bg-background px-2 py-1">{selectedCount} selected</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background p-1" data-testid="workflow-copy-paste">
              <button type="button" onClick={copySelectedNodes} disabled={selectedCount === 0} className="h-7 rounded px-2 text-xs hover:bg-muted disabled:opacity-40">Copy</button>
              <button type="button" onClick={pasteCopiedNodes} disabled={copiedNodes.length === 0} className="h-7 rounded px-2 text-xs hover:bg-muted disabled:opacity-40">Paste</button>
            </div>
            <button type="button" data-testid="workflow-duplicate-subgraph" onClick={duplicateSelectedSubgraph} disabled={selectedCount === 0} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted disabled:opacity-40">
              <Copy className="h-3.5 w-3.5" />
              Subgraph
            </button>
            <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background p-1" data-testid="workflow-undo-redo">
              <button type="button" onClick={() => void undoWorkflowEdit()} disabled={!canUndoWorkflow} className="h-7 rounded px-2 text-xs hover:bg-muted disabled:opacity-40">Undo</button>
              <button type="button" onClick={() => void redoWorkflowEdit()} disabled={!canRedoWorkflow} className="h-7 rounded px-2 text-xs hover:bg-muted disabled:opacity-40">Redo</button>
            </div>
            <label className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs" data-testid="workflow-layout-mode">
              Layout
              <select value={layoutMode} onChange={(event) => setLayoutMode(event.target.value as WorkflowLayoutMode)} className="bg-transparent text-xs outline-none">
                {layoutModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
              </select>
            </label>
            <button type="button" data-testid="workflow-layout-lock" onClick={toggleLayoutLock} disabled={selectedCount === 0} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted disabled:opacity-40">
              {selectedNodeIds.every((id) => lockedNodeIds.includes(id)) && selectedCount > 0 ? 'Unlock layout' : 'Lock layout'}
            </button>
            <label className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs" data-testid="workflow-minimap-filters">
              MiniMap
              <select value={minimapFilter} onChange={(event) => setMinimapFilter(event.target.value as WorkflowMinimapFilter)} className="bg-transparent text-xs outline-none">
                {minimapFilters.map((filter) => <option key={filter} value={filter}>{filter}</option>)}
              </select>
            </label>
            <button type="button" onClick={autoLayoutNodes} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted" title="Auto layout">
              <GitBranch className="h-3.5 w-3.5" />
              Apply
            </button>
          </div>
        </div>
        )}
        {!isSimpleMode && (
        <div className="mb-3 grid gap-2 md:grid-cols-4" data-testid="workflow-flowing-lines">
          {[
            ['Running', selectedWorkGraphRuntimeState?.summary.running || 0],
            ['Waiting', selectedWorkGraphRuntimeState?.summary.waiting || 0],
            ['Failed', selectedWorkGraphRuntimeState?.summary.failed || 0],
            ['Artifacts', selectedWorkGraphRuntimeState?.summary.artifacts || 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border bg-background px-3 py-2 text-xs">
              <span className="block text-muted-foreground">{label}</span>
              <span className="mt-1 block text-base font-semibold text-foreground">{value}</span>
            </div>
          ))}
        </div>
        )}
        {!isSimpleMode && (
        <div className="mb-3 flex flex-wrap gap-1 text-[10px] text-muted-foreground" data-testid="workflow-graph-validation-badges">
          {(selectedNode ? getNodeValidationBadges(draft, selectedNode, lockedNodeIds) : ['FlowGram validation ready']).map((badge) => (
            <span key={badge} className="rounded border border-border bg-background px-2 py-1">{badge}</span>
          ))}
        </div>
        )}
        <Suspense fallback={(
          <div className="flex h-[560px] min-w-0 items-center justify-center rounded-md border border-border bg-background text-sm text-muted-foreground" data-testid="workflow-flowgram-loading">
            Loading FlowGram editor...
          </div>
        )}
        >
          <WorkflowFlowGramEditor
            ref={flowGramEditorRef}
            workflow={draft}
            selectedRun={selectedRun}
            runtimeVisualState={selectedWorkGraphRuntimeState}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onWorkflowChange={(next) => commitDraft(() => next)}
            onSelectNode={(nodeId) => {
              setSelectedNodeId(nodeId);
              setSelectedNodeIds((current) => current.includes(nodeId) && current.length > 1 ? current : [nodeId]);
              setSelectedEdgeId('');
            }}
            onSelectEdge={(edgeId) => {
              setSelectedEdgeId(edgeId);
              setSelectedNodeId('');
            }}
            onAddNode={addNode}
            onCopySelection={copySelectedNodes}
            onDuplicateSelection={duplicateSelectedSubgraph}
            onDeleteSelection={deleteSelectedGraphItems}
            showDiagnostics={!isSimpleMode || isDiagnosticsOpen}
          />
        </Suspense>
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
      {isCustomNodeReviewOpen && (
        <div className="fixed inset-0 z-50 bg-black/20 p-4" data-testid="workflow-ai-node-draft-review" onClick={() => setIsCustomNodeReviewOpen(false)}>
          <aside
            className="ml-auto flex h-full max-h-[calc(100vh-2rem)] w-[760px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-violet-50 text-violet-700">
                    <Wand2 className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Generate Python workflow node</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Draft first, review the manifest and code, run tests, then install into the Custom palette.</p>
                  </div>
                </div>
              </div>
              <button type="button" aria-label="Close custom node review" onClick={() => setIsCustomNodeReviewOpen(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-5">
              <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <label className="block text-xs font-semibold text-slate-700">
                  What should this node do?
                  <textarea
                    value={customNodePrompt}
                    onChange={(event) => setCustomNodePrompt(event.target.value)}
                    className="mt-2 min-h-20 w-full rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-950 outline-none focus:border-violet-300"
                    placeholder="Example: Create a formatter node that normalizes a release note."
                  />
                </label>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={generateCustomNodeDraft} disabled={isBusy || !customNodePrompt.trim()} className="inline-flex h-9 items-center gap-2 rounded-md bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                    <Wand2 className="h-4 w-4" />
                    Generate draft
                  </button>
                  <span className="text-xs text-slate-500">Python only. Standard library only. No generated React UI code.</span>
                </div>
              </section>

              <section className="mt-4 rounded-md border border-slate-200 bg-white p-3" data-testid="workflow-node-package-manager">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-950">Installed node packages</h4>
                    <p className="mt-1 text-xs text-slate-500">Manage custom nodes before they appear in the Custom palette.</p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">{workflowNodePackageSummary}</span>
                </div>
                {nodePackageActionMessage && (
                  <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{nodePackageActionMessage}</div>
                )}
                <div className="mt-3 space-y-2">
                  {installedWorkflowNodePackages.map((nodePackage) => {
                    const packageId = String(nodePackage.id || nodePackage.manifest?.id || '');
                    const lifecycleState = String(nodePackage.lifecycleState || nodePackage.state || (nodePackage.enabled === false ? 'disabled' : 'enabled'));
                    const impactReport = nodePackageImpactReports[packageId];
                    const usedByCount = (impactReport?.totals?.workflows || 0) + (impactReport?.totals?.templates || 0) + (impactReport?.totals?.recentRuns || 0);
                    const dependencyCount = Object.values(nodePackage.dependencies || nodePackage.manifest?.dependencies || {}).flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).length;
                    return (
                      <div key={packageId} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h5 className="truncate text-sm font-semibold text-slate-950">{nodePackage.definition?.label || nodePackage.manifest?.label || packageId}</h5>
                            <p className="mt-1 truncate text-xs text-slate-500">{nodePackage.definition?.description || nodePackage.manifest?.description || nodePackage.definition?.type || 'Custom workflow node package'}</p>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 rounded-full border px-2 py-0.5 text-[11px]',
                              lifecycleState === 'disabled'
                                ? 'border-slate-200 bg-white text-slate-600'
                                : nodePackage.status === 'broken' || lifecycleState === 'broken'
                                  ? 'border-red-200 bg-red-50 text-red-700'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                            )}
                            data-testid="workflow-node-package-state"
                          >
                            {lifecycleState} / {nodePackage.status || 'ready'}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
                          <div className="rounded border border-slate-200 bg-white px-2 py-1">Type: {nodePackage.definition?.type || nodePackage.manifest?.type || 'custom'}</div>
                          <div className="rounded border border-slate-200 bg-white px-2 py-1">Version: {String(nodePackage.manifest?.version || '1.0.0')}</div>
                          <div className="rounded border border-slate-200 bg-white px-2 py-1">Deps: {dependencyCount}</div>
                          <div className="rounded border border-slate-200 bg-white px-2 py-1">Used by: {impactReport ? usedByCount : 'check'}</div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => void loadNodePackageImpact(packageId)} disabled={isBusy} className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-xs hover:bg-slate-100 disabled:opacity-50">
                            Impact
                          </button>
                          {lifecycleState === 'disabled' ? (
                            <button type="button" data-testid="workflow-node-package-enable" onClick={() => void runNodePackageLifecycleAction(packageId, 'enable')} disabled={isBusy} className="inline-flex h-8 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                              Enable
                            </button>
                          ) : (
                            <button type="button" data-testid="workflow-node-package-disable" onClick={() => void runNodePackageLifecycleAction(packageId, 'disable')} disabled={isBusy} className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-xs hover:bg-slate-100 disabled:opacity-50">
                              Disable
                            </button>
                          )}
                          <button type="button" data-testid="workflow-node-package-uninstall" onClick={() => void runNodePackageLifecycleAction(packageId, 'uninstall')} disabled={isBusy} className="inline-flex h-8 items-center rounded-md border border-red-200 bg-red-50 px-2 text-xs text-red-700 hover:bg-red-100 disabled:opacity-50">
                            Uninstall
                          </button>
                        </div>
                        {impactReport && (
                          <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800" data-testid="workflow-node-package-impact-report">
                            <div className="font-semibold">Impact report: {impactReport.destructiveActionRisk || 'none'}</div>
                            <div className="mt-1">Workflows {impactReport.totals?.workflows || 0} · Templates {impactReport.totals?.templates || 0} · Recent runs {impactReport.totals?.recentRuns || 0}</div>
                            {[
                              ...(impactReport.affected?.workflows || []),
                              ...(impactReport.affected?.templates || []),
                              ...(impactReport.affected?.recentRuns || []),
                            ].slice(0, 3).map((entry) => (
                              <div key={`${entry.objectType}-${entry.id}`} className="mt-1 rounded border border-amber-200 bg-white px-2 py-1">
                                {String(entry.objectType)} · {String(entry.title || entry.id)} · nodes {(entry.nodeIds || []).join(', ') || 'declared dependency'}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {installedWorkflowNodePackages.length === 0 && (
                    <div className="rounded border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">No custom node packages installed yet.</div>
                  )}
                </div>
              </section>

              {customNodeDraft?.manifest ? (
                <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                  <section className="space-y-3">
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="truncate text-sm font-semibold text-slate-950">{customNodeDraft.manifest.label || customNodeDraft.manifest.id}</h4>
                          <p className="mt-1 text-xs text-slate-500">{customNodeDraft.manifest.description || 'Generated Python workflow node draft.'}</p>
                        </div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{customNodeDraft.status || 'draft'}</span>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                          <span className="block text-slate-500">Manifest</span>
                          <span className="font-medium text-slate-900">{customNodeDraft.manifest.manifestVersion || '1'}</span>
                        </div>
                        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                          <span className="block text-slate-500">Language</span>
                          <span className="font-medium text-slate-900">{customNodeDraft.manifest.language || 'python'}</span>
                        </div>
                        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                          <span className="block text-slate-500">Dependencies</span>
                          <span className="font-medium text-slate-900">{customNodeDraft.manifest.dependencies?.length || 0}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-white p-3" data-testid="workflow-custom-schema-node-form">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-slate-950">Schema-rendered config</h4>
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">No TSX injection</span>
                      </div>
                      <div className="mt-3 grid gap-2">
                        {customNodeConfigFields.map((field) => (
                          <label key={field.name} className="block text-xs font-medium text-slate-600">
                            {field.label}{field.required ? ' *' : ''}
                            {field.options.length > 0 ? (
                              <select className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900" defaultValue={String(field.defaultValue || field.options[0] || '')}>
                                {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                              </select>
                            ) : (
                              <input className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900" defaultValue={field.defaultValue === undefined ? '' : String(field.defaultValue)} />
                            )}
                          </label>
                        ))}
                        {customNodeConfigFields.length === 0 && (
                          <div className="rounded border border-dashed border-slate-200 p-3 text-xs text-slate-500">No configurable fields in this manifest.</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-slate-950 p-3 text-slate-100">
                      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold">{customNodeCodeFile[0]}</span>
                        <span className="text-slate-400">JSON stdin / JSON stdout</span>
                      </div>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-[11px] leading-5">{customNodeCodeFile[1]}</pre>
                    </div>
                  </section>

                  <aside className="space-y-3">
                    <div className={cn('rounded-md border p-3 text-xs', customNodeDependencyIssues.length > 0 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800')} data-testid="workflow-python-node-dependency-warning">
                      <span className="block text-sm font-semibold">{customNodeDependencyIssues.length > 0 ? 'Dependency review needed' : 'Standard library only'}</span>
                      <div className="mt-2 space-y-1">
                        {(customNodeDependencyIssues.length > 0 ? customNodeDependencyIssues : ['No third-party dependencies declared.']).map((item) => (
                          <div key={item}>{item}</div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <h4 className="text-sm font-semibold text-slate-950">Review gates</h4>
                      <div className="mt-3 grid gap-2">
                        <button type="button" onClick={validateCustomNodeDraft} disabled={isBusy} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm hover:bg-slate-50 disabled:opacity-50">
                          <Check className="h-4 w-4" />
                          Validate manifest
                        </button>
                        <button type="button" onClick={testCustomNodeDraft} disabled={isBusy} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm hover:bg-slate-50 disabled:opacity-50">
                          <Play className="h-4 w-4" />
                          Run tests
                        </button>
                        <button type="button" onClick={installCustomNodeDraft} disabled={isBusy || !customNodeTestResult?.ok} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                          <Plus className="h-4 w-4" />
                          Install node
                        </button>
                      </div>
                      {customNodeValidation && (
                        <div className={cn('mt-3 rounded border px-2 py-1 text-xs', customNodeValidation.valid ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700')}>
                          {customNodeValidation.valid ? 'Manifest contract is valid.' : (customNodeValidation.errors || []).map((item) => item.message || item.code).join(', ')}
                        </div>
                      )}
                      {customNodeUpgradeCompatibility && customNodeUpgradeCompatibility.compatible === false && (
                        <div className="mt-3 rounded border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-700" data-testid="workflow-node-package-upgrade-warning">
                          <span className="block font-semibold">Incompatible package upgrade</span>
                          <div className="mt-1 space-y-1">
                            {(customNodeUpgradeCompatibility.reasons || []).slice(0, 4).map((reason, index) => (
                              <div key={`${reason.code || 'reason'}-${reason.field || index}`}>
                                {reason.message || `${reason.code || 'schema_changed'}${reason.field ? `: ${reason.field}` : ''}`}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {customNodeInstallMessage && (
                        <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700" data-testid="workflow-custom-node-installed">
                          {customNodeInstallMessage}
                        </div>
                      )}
                    </div>

                    <div className="rounded-md border border-slate-200 bg-white p-3" data-testid="workflow-python-node-test-result">
                      <h4 className="text-sm font-semibold text-slate-950">Test result</h4>
                      {customNodeTestResult ? (
                        <div className="mt-2 space-y-2 text-xs">
                          <div className={cn('rounded border px-2 py-1', customNodeTestResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700')}>
                            {customNodeTestResult.ok ? 'Passed' : customNodeTestResult.error?.code || 'Failed'} / exit {String(customNodeTestResult.exitCode ?? 0)} / {String(customNodeTestResult.durationMs || 0)}ms
                          </div>
                          {(customNodeTestResult.cases || []).length > 0 && (
                            <div className="space-y-2" data-testid="workflow-python-node-test-matrix">
                              {(customNodeTestResult.cases || []).map((testCase, index) => (
                                <details key={`${testCase.testCaseId || 'case'}-${index}`} open={Boolean(!testCase.ok)} className="rounded border border-slate-200 bg-slate-50 p-2" data-testid="workflow-python-node-test-case">
                                  <summary className="cursor-pointer text-xs font-semibold text-slate-800">
                                    {testCase.ok ? 'Passed' : testCase.error?.category || testCase.error?.code || 'Failed'} · {testCase.testCaseName || testCase.testCaseId || `Case ${index + 1}`}
                                  </summary>
                                  {(testCase.assertionFailures || []).length > 0 && (
                                    <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-red-700" data-testid="workflow-python-node-assertion-failures">
                                      <span className="font-semibold">Assertion failures</span>
                                      <div className="mt-1 space-y-1">
                                        {(testCase.assertionFailures || []).map((failure, failureIndex) => (
                                          <div key={`${failure.path || 'path'}-${failureIndex}`}>
                                            {failure.path || 'output'}: {failure.message || `${stringifyValue(failure.expected)} != ${stringifyValue(failure.actual)}`}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <div className="mt-2 grid gap-2">
                                    <div>
                                      <span className="font-semibold text-slate-700">stdout</span>
                                      <pre className="mt-1 max-h-20 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-100">{testCase.stdout || 'empty'}</pre>
                                    </div>
                                    <div>
                                      <span className="font-semibold text-slate-700">stderr</span>
                                      <pre className="mt-1 max-h-20 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-100">{testCase.stderr || 'empty'}</pre>
                                    </div>
                                    <div>
                                      <span className="font-semibold text-slate-700">parsed output</span>
                                      <pre className="mt-1 max-h-20 overflow-auto rounded bg-white p-2 text-[10px] text-slate-700">{stringifyValue(testCase.parsedOutput || {})}</pre>
                                    </div>
                                  </div>
                                </details>
                              ))}
                            </div>
                          )}
                          <div>
                            <span className="font-semibold text-slate-700">stdout</span>
                            <pre className="mt-1 max-h-24 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-100">{customNodeTestResult.stdout || 'empty'}</pre>
                          </div>
                          <div>
                            <span className="font-semibold text-slate-700">stderr</span>
                            <pre className="mt-1 max-h-24 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-100">{customNodeTestResult.stderr || 'empty'}</pre>
                          </div>
                          <div>
                            <span className="font-semibold text-slate-700">parsed output</span>
                            <pre className="mt-1 max-h-24 overflow-auto rounded bg-slate-50 p-2 text-[10px] text-slate-700">{stringifyValue(customNodeTestResult.parsedOutput || {})}</pre>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">Run tests to capture stdout, stderr, parsed output, exit code, and duration.</p>
                      )}
                    </div>
                  </aside>
                </div>
              ) : (
                <div className="mt-4 rounded-md border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                  No draft yet. Generate a draft to review the manifest, Python code, schemas, dependencies, and test cases.
                </div>
              )}
            </div>
          </aside>
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
                  ['Ctrl/Cmd K', 'Open command palette'],
                  ['Ctrl/Cmd Z', 'Undo'],
                  ['Ctrl/Cmd Y', 'Redo'],
                  ['Ctrl/Cmd C', 'Copy selected nodes'],
                  ['Ctrl/Cmd V', 'Paste copied nodes'],
                  ['Ctrl/Cmd D', 'Duplicate selected subgraph'],
                  ['Delete', 'Delete selected node or edge'],
                  ['Ctrl/Cmd S', 'Save workflow'],
                  ['Ctrl/Cmd Enter', 'Open run setup'],
                  ['?', 'Open shortcuts'],
                  ['Esc', 'Close overlays'],
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
      <div className="border-b border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-2.5 sm:px-5" data-testid="workflow-command-center">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" data-testid="workflow-modern-desktop-shell">
          <div className="min-w-0 flex-1" data-testid="workflow-quiet-default-header">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white shadow-sm">
                <GitBranch className="h-4 w-4 text-primary" />
              </span>
              <h1 className="text-base font-semibold leading-tight text-foreground sm:truncate">Agent Workflow Studio</h1>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                  isSimpleMode ? 'border-slate-200 bg-white text-slate-600' : 'border-slate-300 bg-slate-100 text-slate-700',
                )}
                data-testid="workflow-simple-mode"
                data-mode={workflowUiMode}
              >
                {isSimpleMode ? 'Simple Mode' : 'Advanced Mode'}
              </span>
              <span className="min-w-0 truncate text-xs text-slate-500" data-testid="workflow-quiet-meta">
                {draft.name} · {draft.profileId} · {draft.permissionPreset} · {selectedRun?.status || 'draft'}
              </span>
            </div>
            <div className="sr-only" data-testid="workflow-breadcrumb">
              <button type="button" onClick={() => setActiveView('Home')} className="hover:text-foreground">Workflows</button>
              <ChevronRight className="h-3 w-3" />
              <button type="button" onClick={() => setActiveView(activeView)} className="hover:text-foreground">{activeView}</button>
              <ChevronRight className="h-3 w-3" />
              <button type="button" onClick={() => openWorkflowDeepLink(draft.id, activeView)} className="inline-flex min-w-0 items-center gap-1 hover:text-foreground">
                <span className="truncate">{draft.name}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </button>
            </div>
            <p className="sr-only">Build and run an agent workflow for this project.</p>
          </div>
          <div className="relative flex w-full flex-col items-stretch gap-2 sm:w-auto sm:max-w-xl sm:items-end" data-testid="workflow-command-rail">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 sm:flex sm:flex-wrap sm:justify-end">
              {activeView === 'Editor' && (
                <button type="button" data-testid="workflow-add-step-primary" onClick={() => addNode('agent')} className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm hover:bg-slate-50 sm:inline-flex">
                  <Plus className="h-4 w-4" />
                  Add step
                </button>
              )}
              {activeView === 'Editor' && (
                <button type="button" data-testid="workflow-save" onClick={saveWorkflow} disabled={isBusy} className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm hover:bg-slate-50 disabled:opacity-50 sm:inline-flex">
                  <Save className="h-4 w-4" />
                  Save
                </button>
              )}
              <button type="button" data-testid="workflow-run" onClick={() => setIsRunSetupOpen(true)} disabled={isBusy || draft.nodes.length === 0} className="hidden h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:inline-flex">
                <Play className="h-4 w-4" />
                Run
              </button>
              <button type="button" data-testid="workflow-mobile-run" onClick={() => setIsRunSetupOpen(true)} disabled={isBusy || draft.nodes.length === 0} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:hidden">
                <Play className="h-4 w-4" />
                Run
              </button>
              <button
                type="button"
                data-testid="workflow-advanced-toggle"
                onClick={() => setWorkflowUiMode((current) => current === 'simple' ? 'advanced' : 'simple')}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm hover:bg-slate-50"
              >
                {isSimpleMode ? 'Advanced' : 'Simple'}
              </button>
              <button
                type="button"
                onClick={() => setIsCommandCenterMoreOpen((current) => !current)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
                title="More workflow actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>
            {isCommandCenterMoreOpen && (
              <div className="absolute right-0 top-11 z-40 w-56 rounded-md border border-border bg-background p-2 text-sm shadow-xl">
                <button type="button" onClick={() => setIsCommandPaletteOpen(true)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted">
                  <Command className="h-4 w-4" />
                  Command palette
                </button>
                <button type="button" onClick={() => void loadData().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Failed to refresh'))} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted">
                  <RefreshCw className="h-4 w-4" />
                  Refresh data
                </button>
                <button type="button" data-testid="workflow-run-benchmarks" onClick={runBenchmarks} disabled={isBusy} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted disabled:opacity-50">
                  <ClipboardCheck className="h-4 w-4" />
                  Benchmarks
                </button>
                <button type="button" onClick={() => setIsHelpOpen(true)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted">
                  <HelpCircle className="h-4 w-4" />
                  Help
                </button>
                <button type="button" onClick={() => setIsShortcutsOpen(true)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted">
                  <Keyboard className="h-4 w-4" />
                  Shortcuts
                </button>
                <button type="button" onClick={() => setIsDiagnosticsOpen((current) => !current)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted">
                  <AlertTriangle className="h-4 w-4" />
                  {isDiagnosticsOpen ? 'Hide diagnostics' : 'Show diagnostics'}
                </button>
              </div>
            )}
          </div>
        </div>
        {isDiagnosticsOpen && (
          <div className="mt-4 rounded-md border border-border bg-card p-3" data-testid="workflow-diagnostics-drawer">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-border bg-background px-2 py-1">Workflow: {draft.name}</span>
              <span className="rounded-md border border-border bg-background px-2 py-1" data-testid="workflow-flowgram-adapter">
                WorkGraph: {workGraphDocument.schemaVersion} / {workGraphRoundtrip.nodes.length} nodes / {workGraphDocument.edges.length} edges
              </span>
              <span className={cn('rounded-md border px-2 py-1', workGraphCompatibility.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')} data-testid="workflow-migration-compatibility">
                Compatibility: {workGraphCompatibility.ok ? 'ready' : 'needs review'} ({workGraphCompatibility.warnings.length})
              </span>
              <span className={cn('rounded-md border px-2 py-1', localMigrationDoctor.status === 'pass' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : localMigrationDoctor.status === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-red-200 bg-red-50 text-red-700')} data-testid="workflow-migration-doctor-local">
                Migration doctor: {localMigrationDoctor.status} / {localMigrationDoctor.checked} checked / {localMigrationDoctor.findings.length} findings
              </span>
              <span className="rounded-md border border-border bg-background px-2 py-1" data-testid="workflow-runtime-state-bridge">
                Runtime: {selectedWorkGraphRuntimeState ? `${selectedWorkGraphRuntimeState.summary.running} running / ${selectedWorkGraphRuntimeState.summary.waiting} waiting / ${selectedWorkGraphRuntimeState.summary.failed} failed` : 'no run state'}
              </span>
              {releaseReadiness && ((releaseReadiness.gates as Array<Record<string, unknown>> | undefined) || []).map((gate) => (
                <span key={String(gate.id)} className="rounded-md border border-border bg-background px-2 py-1" data-testid="workflow-release-readiness">
                  {String(gate.label)}: {String(gate.status)}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 inline-flex rounded-md border border-slate-200 bg-white p-1 shadow-sm" data-testid="workflow-view-tabs">
          {views.map((view) => {
            const Icon = view === 'Home' ? Home : view === 'Library' ? LibraryBig : view === 'Editor' ? GitBranch : History;
            return (
              <button
                key={view}
                type="button"
                onClick={() => setActiveView(view)}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded px-3 text-sm transition-colors',
                  activeView === view ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
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
        <>
        <div className="min-h-0 flex-1 overflow-auto p-4 md:hidden" data-testid="workflow-editor-mobile">
          <section className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" data-testid="workflow-guided-builder">
            <div className="font-semibold">{humanNextAction.title}</div>
            <div className="mt-1 text-blue-700">{humanNextAction.body}</div>
          </section>
          <section className="rounded-md border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-foreground">{draft.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {draft.nodes.length} nodes / {draft.edges.length} edges
                </p>
              </div>
              <span className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">{draft.permissionPreset}</span>
            </div>
            <div className="mt-4 grid gap-2 text-sm text-muted-foreground">
              {draft.nodes.slice(0, 6).map((node) => (
                <div key={node.id} className="flex items-center justify-between gap-3 rounded border border-border bg-background px-3 py-2">
                  <span className="min-w-0 truncate font-medium text-foreground">{node.title}</span>
                  <span className="shrink-0 text-xs">{node.type}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setIsRunSetupOpen(true)} disabled={isBusy || draft.nodes.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                <Play className="h-4 w-4" />
                Run workflow
              </button>
              <button type="button" onClick={() => setActiveView('Runs')} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                <History className="h-4 w-4" />
                View runs
              </button>
            </div>
          </section>
        </div>
        <div className={cn('hidden min-h-0 flex-1 grid-cols-1 overflow-auto md:grid lg:overflow-hidden', isSimpleMode ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : 'lg:grid-cols-[260px_minmax(0,1fr)_300px]')} data-testid="workflow-editor">
          {!isSimpleMode && (
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
                          className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-2.5 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                            <item.icon className="h-3.5 w-3.5" />
                          </span>
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
          )}

          <main className="min-h-0 overflow-auto p-3" data-testid="workflow-desktop-focus-layout">
            {isSimpleMode ? (
              <section className="mb-2 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm" data-testid="workflow-guided-builder">
                <div className="flex min-h-12 items-center justify-between gap-3 border-l-4 border-slate-900 px-3 py-2" data-testid="workflow-editor-setup-strip" data-density="compact">
                  <div className="min-w-0" data-testid="workflow-canvas-first-rail">
                    <div data-testid="workflow-editor-quick-path">
                      <div data-testid="workflow-human-next-action" className="flex min-w-0 items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">Next</span>
                        <h2 className="truncate text-sm font-semibold text-foreground">{humanNextAction.title}</h2>
                        <span className="hidden truncate text-sm text-muted-foreground xl:inline">{humanNextAction.body}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                      <button type="button" onClick={() => addNode('agent')} className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
                        <Plus className="h-3.5 w-3.5" />
                        Add step
                      </button>
                      <button type="button" data-testid="workflow-generate-custom-node" onClick={() => setIsCustomNodeReviewOpen(true)} className="inline-flex h-8 items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 text-xs font-medium text-violet-700 hover:bg-violet-100">
                        <Wand2 className="h-3.5 w-3.5" />
                        Generate node
                      </button>
                      <button type="button" onClick={() => setActiveView('Library')} className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs hover:bg-muted">
                        <LibraryBig className="h-3.5 w-3.5" />
                        Templates
                      </button>
                  </div>
                </div>
                <details className="border-t border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600" data-testid="workflow-editor-metadata-details">
                  <summary className="cursor-pointer font-medium text-slate-700">Workflow settings · {draft.profileId} · {draft.permissionPreset}</summary>
                  <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1.35fr)_140px_160px]">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Workflow name
                      <input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground" />
                    </label>
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Profile
                      <select value={draft.profileId} onChange={(event) => updateDraft({ profileId: event.target.value })} className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground">
                        <option value="build">build</option>
                        <option value="plan">plan</option>
                        {agentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}
                      </select>
                    </label>
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Permission preset
                      <select value={draft.permissionPreset} onChange={(event) => updateDraft({ permissionPreset: event.target.value })} className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground">
                        <option value="suggest">Suggest</option>
                        <option value="auto-edit">Auto Edit</option>
                        <option value="full-auto">Full Auto</option>
                        <option value="enterprise-safe">Enterprise Safe</option>
                      </select>
                    </label>
                  </div>
                </details>
              </section>
            ) : (
              <>
              <section className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3" data-testid="workflow-guided-builder">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-blue-950">{humanNextAction.title}</div>
                    <p className="mt-1 text-sm text-blue-700">{humanNextAction.body}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => addNode('agent')} className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
                      <Plus className="h-3.5 w-3.5" />
                      Add step
                    </button>
                    <button type="button" data-testid="workflow-generate-custom-node" onClick={() => setIsCustomNodeReviewOpen(true)} className="inline-flex h-8 items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 text-xs font-medium text-violet-700 hover:bg-violet-100">
                      <Wand2 className="h-3.5 w-3.5" />
                      Generate node
                    </button>
                    <button type="button" onClick={() => setActiveView('Library')} className="inline-flex h-8 items-center gap-2 rounded-md border border-blue-200 bg-background px-3 text-xs hover:bg-blue-100">
                      <LibraryBig className="h-3.5 w-3.5" />
                      Templates
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-blue-800 sm:grid-cols-4">
                  {['Choose', 'Configure', 'Run', 'Review'].map((step, index) => (
                    <div key={step} className={cn('rounded-md border px-2 py-1', index === 1 ? 'border-blue-300 bg-background text-blue-900' : 'border-blue-200 bg-blue-100/60')}>
                      {index + 1}. {step}
                    </div>
                  ))}
                </div>
              </section>
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
              </>
            )}
            <div className="mb-3 flex flex-wrap gap-2">
              {!isSimpleMode && (
              <button type="button" data-testid="workflow-save" onClick={saveWorkflow} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                <Save className="h-4 w-4" />
                Save
              </button>
              )}
              {(!isSimpleMode || isDiagnosticsOpen) && (
              <button type="button" data-testid="workflow-dry-run-debugger" onClick={validateRun} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50">
                <AlertTriangle className="h-4 w-4" />
                Dry run
              </button>
              )}
              {!isSimpleMode && (
              <button type="button" onClick={exportDraft} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                <Download className="h-4 w-4" />
                Export
              </button>
              )}
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
            {dryRunPreview?.nodes && dryRunPreview.nodes.length > 0 && (
              <div className="mb-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700" data-testid="workflow-dry-run-preview">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-slate-950">Dry run preview</h3>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                    {dryRunPreview.blockedCount || 0} blocked / {dryRunPreview.nodeCount || dryRunPreview.nodes.length} nodes
                  </span>
                </div>
                <div className="grid gap-2">
                  {dryRunPreview.nodes.slice(0, 6).map((node) => (
                    <div key={node.nodeId || node.title} className={cn('rounded-md border p-2', node.blocked ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50')}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">{node.title || node.nodeId}</span>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">{node.permissionDecision || 'allow'}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {node.type} / upstream {(node.upstream || []).map((edge) => `${edge.nodeId}:${edge.mode}`).join(', ') || 'entry'}
                      </div>
                      {node.errors && node.errors.length > 0 && (
                        <div className="mt-1 text-[11px] text-amber-700">{node.errors.map((item) => item.message || item.code).join('; ')}</div>
                      )}
                      {node.resolvedInput && (
                        <pre className="mt-2 max-h-20 overflow-auto rounded bg-white/80 p-2 text-[10px] text-slate-600">{stringifyValue(node.resolvedInput)}</pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {renderCanvas()}
          </main>

          <aside className="min-h-0 overflow-auto border-l border-slate-200 bg-slate-50/70" data-testid="workflow-node-inspector">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-4 backdrop-blur" data-testid="workflow-properties-panel">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-950">Properties</h3>
                  <p className="mt-1 truncate text-xs text-slate-500">{selectedNode ? `${selectedNode.title || selectedNode.id} / ${selectedNode.type}` : selectedEdge ? 'Connection selected' : 'Select a step to configure'}</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">{isSimpleMode ? 'Simple' : 'Advanced'}</span>
              </div>
            </div>
            <div className="p-4">
            {!isSimpleMode && (
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
            )}
            {selectedNode ? (
              isSimpleMode ? (
              <div className="mt-3 space-y-2" data-testid="workflow-inspector-essential-fields">
                <div className="space-y-2" data-testid="workflow-inspector-low-noise-defaults">
                <div className="rounded-md border border-slate-200 bg-white p-2.5 shadow-sm" data-testid="workflow-inspector-node-summary">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-950">{selectedNode.title || selectedNode.id}</span>
                      <span className="mt-1 block text-[11px] uppercase tracking-wide text-slate-500">{selectedNode.type}</span>
                    </div>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', riskyNodeTypes.has(selectedNode.type) ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
                      {riskyNodeTypes.has(selectedNode.type) ? 'needs review' : 'ready'}
                    </span>
                  </div>
                  <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-900">{humanNextAction.title}</span>
                    <span className="ml-2 hidden 2xl:inline">{humanNextAction.body}</span>
                  </div>
                </div>
                <label className="block text-xs font-medium text-muted-foreground">
                  Title
                  <input value={selectedNode.title} onChange={(event) => updateNode(selectedNode.id, { title: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground" />
                </label>
                {(selectedNode.type === 'agent' || selectedNode.type === 'subagent') && (
                  <label className="block text-xs font-medium text-muted-foreground">
                    Agent
                    <select value={selectedNode.agentId || ''} onChange={(event) => updateNode(selectedNode.id, { agentId: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground">
                      <option value="">Choose agent...</option>
                      <option value="build">build</option>
                      <option value="subagent-general">subagent-general</option>
                      {agentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}
                    </select>
                  </label>
                )}
                {(selectedNode.type === 'tool' || selectedNode.type === 'mcp') && (
                  <label className="block text-xs font-medium text-muted-foreground">
                    Tool
                    <input value={selectedNode.toolName || ''} onChange={(event) => updateNode(selectedNode.id, { toolName: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground" />
                  </label>
                )}
                {selectedNode.type === 'shell' && (
                  <label className="block text-xs font-medium text-muted-foreground">
                    Command
                    <textarea value={selectedNode.command || ''} onChange={(event) => updateNode(selectedNode.id, { command: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" />
                  </label>
                )}
                {selectedNode.type !== 'shell' && selectedNode.type !== 'condition' && (
                  <label className="block text-xs font-medium text-muted-foreground">
                    Prompt
                    <textarea value={selectedNode.prompt || ''} onChange={(event) => updateNode(selectedNode.id, { prompt: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" />
                  </label>
                )}
                {selectedNode.type === 'condition' && (
                  <label className="block text-xs font-medium text-muted-foreground">
                    Condition
                    <textarea value={selectedNode.condition || ''} onChange={(event) => updateNode(selectedNode.id, { condition: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" />
                  </label>
                )}
                <label className="block text-xs font-medium text-muted-foreground">
                  Permission
                  <select value={selectedNode.permission || ''} onChange={(event) => updateNode(selectedNode.id, { permission: event.target.value as WorkflowNode['permission'] })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground">
                    <option value="">inherit profile</option>
                    <option value="ask">ask</option>
                    <option value="deny">deny</option>
                    <option value="allow">allow only if profile permits</option>
                  </select>
                </label>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm">
                  <span className="font-medium text-slate-900">Permission source</span>
                  <span className="ml-2">{permissionSource}</span>
                </div>
                <details className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm" data-testid="workflow-inspector-advanced-sections">
                  <summary className="cursor-pointer font-semibold text-slate-900">Advanced</summary>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>Data, Runtime, JSON, Schema, Presets, and Output contract.</span>
                    <button type="button" onClick={() => setWorkflowUiMode('advanced')} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                      Open
                    </button>
                  </div>
                </details>
                <details className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm" data-testid="workflow-inspector-more-actions">
                  <summary className="cursor-pointer font-semibold text-slate-900">More actions</summary>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => duplicateNode(selectedNode.id)} className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-2 text-xs hover:bg-slate-50">
                      <Copy className="h-3.5 w-3.5" />
                      Duplicate
                    </button>
                    <button type="button" onClick={() => deleteNode(selectedNode.id)} className="inline-flex h-8 items-center gap-2 rounded-md border border-red-200 px-2 text-xs text-red-700 hover:bg-red-50">
                      <X className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </details>
                </div>
              </div>
              ) : (
              <div className="mt-3 space-y-3">
                <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{selectedNode.type} / {inspectorTab}</span>
                  <span className="mt-1 block">Configure this node without changing the workflow storage contract.</span>
                </div>
                <label className="block text-xs font-medium text-muted-foreground">
                  Title
                  <input value={selectedNode.title} onChange={(event) => updateNode(selectedNode.id, { title: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground" />
                </label>
                <div className="rounded-md border border-border bg-card p-3" data-testid="workflow-form-meta-inspector">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">FormMeta config</span>
                    <span className="rounded border border-border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {String(selectedNodeDefinition?.ui?.materialGroup || selectedNode.type)}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(selectedNodeDefinition?.configSchema?.fields || []).map((field) => {
                      const fieldValue = getNodeFormMetaValue(selectedNode, field.name);
                      const commonClassName = 'mt-1 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground';
                      return (
                        <label key={field.name} className="block text-xs font-medium text-muted-foreground">
                          {field.label || field.name}{field.required ? ' *' : ''}
                          {field.type === 'template' || field.type === 'expression' || field.type === 'json' ? (
                            <textarea
                              value={typeof fieldValue === 'string' ? fieldValue : stringifyValue(fieldValue)}
                              onChange={(event) => updateNodeFormMetaValue(selectedNode, field.name, event.target.value)}
                              className={cn(commonClassName, 'min-h-20 py-2')}
                              data-testid="workflow-form-meta-field"
                              data-field-name={field.name}
                            />
                          ) : field.type === 'select' ? (
                            <select
                              value={typeof fieldValue === 'string' ? fieldValue : ''}
                              onChange={(event) => updateNodeFormMetaValue(selectedNode, field.name, event.target.value)}
                              className={cn(commonClassName, 'h-9')}
                              data-testid="workflow-form-meta-field"
                              data-field-name={field.name}
                            >
                              <option value="">Choose...</option>
                              {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          ) : (
                            <input
                              type={field.type === 'number' ? 'number' : 'text'}
                              value={typeof fieldValue === 'string' || typeof fieldValue === 'number' ? fieldValue : ''}
                              onChange={(event) => updateNodeFormMetaValue(selectedNode, field.name, field.type === 'number' ? Number(event.target.value) : event.target.value)}
                              className={cn(commonClassName, 'h-9')}
                              data-testid="workflow-form-meta-field"
                              data-field-name={field.name}
                            />
                          )}
                        </label>
                      );
                    })}
                    {(selectedNodeDefinition?.configSchema?.fields || []).length === 0 && (
                      <div className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground">
                        This node type has no FormMeta fields.
                      </div>
                    )}
                  </div>
                </div>
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
                <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-node-schema-versioning">
                  <span className="block font-semibold text-foreground">Schema version</span>
                  <span className="mt-1 block">Node schema {String(schemaVersion)} / workflow contract compatible</span>
                </div>
                <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-required-field-guard">
                  <span className="block font-semibold text-foreground">Required fields</span>
                  {requiredFieldErrors.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-red-700">
                      {requiredFieldErrors.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : (
                    <span className="mt-1 block text-emerald-700">All required fields are ready.</span>
                  )}
                </div>
                <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-node-config-presets">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">Config presets</span>
                    <button type="button" onClick={saveNodeConfigPreset} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted">Save preset</button>
                  </div>
                  <select
                    className="mt-2 h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground"
                    onChange={(event) => event.target.value && applyNodeConfigPreset(event.target.value)}
                    defaultValue=""
                  >
                    <option value="">Apply preset...</option>
                    {nodeConfigPresets.filter((preset) => preset.type === selectedNode.type).map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </select>
                </div>
                <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-secret-field-type">
                  <span className="block font-semibold text-foreground">Secret fields</span>
                  <span className="mt-1 block">Secret token: {secretFieldDisplay(selectedNode.config?.secretKey)}</span>
                  <span className="mt-1 block">Exports keep secret references only.</span>
                </div>
                <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-json-config-editor">
                  <span className="block font-semibold text-foreground">JSON config</span>
                  <textarea value={jsonConfigText} onChange={(event) => setJsonConfigText(event.target.value)} className="mt-2 min-h-24 w-full rounded border border-border bg-background p-2 font-mono text-[11px] text-foreground" />
                  {jsonConfigError && <span className="mt-1 block text-red-700">{jsonConfigError}</span>}
                  <button type="button" onClick={applyJsonConfig} className="mt-2 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted">Apply JSON</button>
                </div>
                <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-mapping-preview">
                  <span className="block font-semibold text-foreground">Mapping preview</span>
                  <div className="mt-2 max-h-28 space-y-1 overflow-auto">
                    {mappingPreview.map((item) => (
                      <div key={item.node.id} className="rounded border border-border px-2 py-1">
                        <span className="font-medium text-foreground">{item.node.title}</span>
                        <span className="ml-2 font-mono text-[10px]">{item.input.variables.join(', ') || 'no variables'}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-transform-functions">
                  <span className="block font-semibold text-foreground">Transform functions</span>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {transformFunctions.map((fn) => (
                      <button key={fn} type="button" onClick={() => insertVariable(fn)} className="rounded border border-border px-2 py-1 font-mono text-[10px] hover:bg-muted">{fn}</button>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-output-contract-test">
                  <span className="block font-semibold text-foreground">Output contract</span>
                  {validateOutputContract(selectedRun?.nodeRuns?.[selectedNode.id], selectedNodeDefinition).length > 0 ? (
                    <span className="mt-1 block text-red-700">{validateOutputContract(selectedRun?.nodeRuns?.[selectedNode.id], selectedNodeDefinition).join(', ')}</span>
                  ) : (
                    <span className="mt-1 block text-emerald-700">Output schema is satisfied or not required.</span>
                  )}
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
                    <button
                      key={edge.id}
                      type="button"
                      data-testid="workflow-select-edge"
                      onClick={() => {
                        setSelectedEdgeId(edge.id);
                        setSelectedNodeId('');
                        setSelectedNodeIds([]);
                      }}
                      className="mb-2 block w-full rounded border border-border px-2 py-1 text-left text-xs hover:bg-muted"
                    >
                      {edge.from} {'->'} {edge.to}
                    </button>
                  ))}
                </div>
                <div data-testid="workflow-node-variables">
                  <h4 className="mb-2 text-xs font-semibold text-muted-foreground">Available variables</h4>
                  <div className="mb-3 space-y-1 rounded-md border border-border bg-card p-2" data-testid="workflow-typed-variable-picker">
                    {typedVariablePicker.map((variable) => (
                      <button
                        key={variable.token}
                        type="button"
                        onClick={() => insertVariable(variable.token.replace(/^\{\{|\}\}$/g, ''))}
                        className="block w-full rounded border border-border bg-muted/30 px-2 py-1 text-left text-[11px] hover:bg-muted"
                      >
                        <span className="font-mono text-foreground">{variable.token}</span>
                        <span className="ml-2 text-muted-foreground">{variable.type} / {variable.source} / {variable.label} / {String(variable.example).slice(0, 32)}</span>
                      </button>
                    ))}
                  </div>
                  <div className={cn('mb-3 rounded-md border p-2 text-xs', flowReferenceValidation.valid ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700')} data-testid="workflow-flow-reference-validation">
                    {flowReferenceValidation.valid
                      ? 'Typed references valid for this node.'
                      : `Missing refs: ${flowReferenceValidation.missing.map((item) => `${item.field}:${item.path}`).join(', ')}`}
                  </div>
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
                  <div className="mt-3 rounded-md border border-border bg-card p-2" data-testid="workflow-data-lineage-view">
                    <span className="block text-xs font-semibold text-foreground">Data lineage</span>
                    <div className="mt-2 max-h-28 space-y-1 overflow-auto">
                      {dataLineageRows.length > 0 ? dataLineageRows.map((row) => (
                        <div key={row} className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground">{row}</div>
                      )) : (
                        <div className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground">No upstream lineage yet.</div>
                      )}
                    </div>
                  </div>
                  {invalidVariables.length > 0 && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700" data-testid="workflow-invalid-variables">
                      Invalid variables: {invalidVariables.join(', ')}
                    </div>
                  )}
                </div>
              </div>
              )
            ) : selectedEdge ? (
              <div className="mt-3 space-y-3" data-testid="workflow-edge-editor">
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <span className="block font-semibold text-foreground">Edge</span>
                  <span className="mt-1 block">{selectedEdge.from} {'->'} {selectedEdge.to}</span>
                </div>
                <label className="block text-xs font-medium text-muted-foreground" data-testid="workflow-edge-branch-labels">
                  Branch mode
                  <select value={selectedEdge.mode || 'success'} onChange={(event) => updateEdge(selectedEdge.id, { mode: event.target.value as WorkflowEdge['mode'] })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground">
                    <option value="success">success</option>
                    <option value="failure">failure</option>
                    <option value="always">always</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-muted-foreground" data-testid="workflow-edge-route-style">
                  Route style
                  <select value={selectedEdge.routeStyle || 'smoothstep'} onChange={(event) => updateEdge(selectedEdge.id, { routeStyle: event.target.value as WorkflowEdgeRouteStyle })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground">
                    {edgeRouteStyles.map((edgeRouteStyle) => (
                      <option key={edgeRouteStyle} value={edgeRouteStyle}>{edgeRouteStyle}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  Condition label
                  <input value={selectedEdge.condition || ''} onChange={(event) => updateEdge(selectedEdge.id, { condition: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground" />
                </label>
                <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-edge-insert-node">
                  <span className="block font-semibold text-foreground">Insert node on edge</span>
                  <span className="mt-1 block">Borrowed from FlowGram's line-add pattern: split this edge and place a new step between both endpoints.</span>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      value={edgeInsertType}
                      onChange={(event) => setEdgeInsertType(event.target.value as WorkflowNodeType)}
                      className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                      data-testid="workflow-edge-insert-node-type"
                    >
                      {paletteNodeTypes.map((nodeType) => (
                        <option key={nodeType.type} value={nodeType.type}>{nodeType.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => requestFlowGramEdgeInsert(selectedEdge.id, edgeInsertType)}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted"
                    >
                      <Plus className="h-4 w-4" />
                      Insert
                    </button>
                  </div>
                </div>
                <button type="button" onClick={() => removeEdge(selectedEdge.id)} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm text-red-700 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                  Delete edge
                </button>
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-border bg-card p-3 text-sm text-muted-foreground" data-testid="workflow-inspector-essential-fields">
                <span className="block font-semibold text-foreground">Choose a step to configure</span>
                <span className="mt-1 block">Select a node on the canvas, add a step, or open templates to start from a known workflow.</span>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => addNode('agent')} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Add step</button>
                  <button type="button" onClick={() => setActiveView('Library')} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">Open Library</button>
                  <button type="button" onClick={() => setIsRunSetupOpen(true)} disabled={draft.nodes.length === 0} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40">Run</button>
                </div>
              </div>
            )}
            </div>
          </aside>
        </div>
        </>
      )}

      {activeView === 'Runs' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[300px_minmax(0,1fr)_400px] lg:overflow-hidden" data-testid="workflow-runs">
          <aside className="min-h-0 overflow-auto border-r border-border p-4">
            <h3 className="text-sm font-semibold text-foreground">Run list</h3>
            {resumeBannerRuns.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" data-testid="workflow-resume-banner">
                {resumeBannerRuns.length} run{resumeBannerRuns.length === 1 ? '' : 's'} can be resumed or need attention.
              </div>
            )}
            <div className="mt-3 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-run-live-polling-strategy">
              <span className="font-semibold text-foreground">Refresh strategy</span>
              <span className="mt-1 block">{pollingStrategy}</span>
            </div>
            <div className="mt-3 space-y-2">
              {visibleRuns.map((run) => {
                const failedCount = Object.values(run.nodeRuns || {}).filter((nodeRun) => nodeRun.status === 'failed').length;
                const approvalCount = Object.values(run.nodeRuns || {}).filter((nodeRun) => nodeRun.status === 'waiting_approval').length;
                return (
                  <button
                    key={`run-list-${run.id}`}
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    aria-pressed={selectedRun?.id === run.id}
                    className={cn(
                      'block w-full rounded-md border bg-card p-3 text-left text-xs hover:bg-muted',
                      selectedRun?.id === run.id ? 'border-primary ring-1 ring-primary/30' : 'border-border',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-foreground">{run.workflowName}</span>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', statusTone[run.status] || statusTone.pending)}>{run.status}</span>
                    </div>
                     <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                       <span>{Object.keys(run.nodeRuns || {}).length} nodes</span>
                       <span>{failedCount} failed</span>
                       <span>{approvalCount} approvals</span>
                       <span>{run.queue?.workerId || 'no worker'}</span>
                       {pinnedRunIds.includes(run.id) && <span>pinned</span>}
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
            <section className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3" data-testid="workflow-run-story">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-blue-950">{runStory.title}</h3>
                  <p className="mt-1 text-sm text-blue-800">{runStory.body}</p>
                </div>
                <span className="shrink-0 rounded-full border border-blue-200 bg-background px-2 py-0.5 text-[11px] text-blue-700">{runStory.actionLabel}</span>
              </div>
              {selectedRun && (
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-blue-800">
                  <div className="rounded border border-blue-200 bg-background px-2 py-1">{Object.keys(selectedRun.nodeRuns || {}).length} nodes</div>
                  <div className="rounded border border-blue-200 bg-background px-2 py-1">{selectedRun.artifacts?.length || 0} artifacts</div>
                  <div className="rounded border border-blue-200 bg-background px-2 py-1">{selectedRun.status}</div>
                </div>
              )}
            </section>
            {selectedRun && (
              <section
                className={cn(
                  'mb-4 rounded-md border p-3 text-xs',
                  selectedRun.previewChanged || selectedRun.previewDiff?.changed
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800',
                )}
                data-testid="workflow-preview-diff-panel"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">Preview consistency</h3>
                    <p className="mt-1">{previewConsistency.body}</p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full border bg-background px-2 py-0.5 text-[11px]',
                      selectedRun.previewChanged || selectedRun.previewDiff?.changed
                        ? 'border-amber-300 text-amber-800'
                        : 'border-emerald-300 text-emerald-800',
                    )}
                    data-testid="workflow-preview-consistency-chip"
                  >
                    {previewConsistency.actionLabel}
                  </span>
                </div>
                {previewChangedNodes.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {previewChangedNodes.slice(0, 4).map((node) => (
                      <div key={node.nodeId} className="rounded border border-amber-200 bg-background px-2 py-1">
                        <span className="font-medium text-foreground">{node.nodeId}</span>
                        <span className="ml-2">{(node.fields || []).join(', ') || 'node'} changed</span>
                        {(node.reasons || []).length > 0 && (
                          <span className="ml-2 text-muted-foreground">({node.reasons?.join(', ')})</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
            {selectedRun && activeApprovalNode && (
              <section className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4 shadow-sm" data-testid="workflow-runs-approval-focus">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className="rounded-full border border-amber-200 bg-background px-2 py-0.5 text-[11px] font-medium text-amber-700">Action needed</span>
                    <h3 className="mt-2 text-base font-semibold text-amber-950">{activeApprovalNode.title}</h3>
                    <p className="mt-1 text-sm text-amber-800">{activeApprovalNode.waitingReason || 'Review the node context and decide whether this workflow can continue.'}</p>
                  </div>
                  <span className="shrink-0 rounded-md border border-amber-200 bg-background px-2 py-1 text-xs text-amber-700">{selectedRun.status}</span>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-amber-800 sm:grid-cols-3">
                  <div className="rounded border border-amber-200 bg-background px-2 py-1">Permission: {activeApprovalNode.permissionDecision || 'ask'}</div>
                  <div className="rounded border border-amber-200 bg-background px-2 py-1">Node: {activeApprovalNode.nodeId}</div>
                  <div className="rounded border border-amber-200 bg-background px-2 py-1">Artifacts: {selectedRun.artifacts?.length || 0}</div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => controlNode(selectedRun, activeApprovalNode.nodeId, 'continue')} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                    <Check className="h-4 w-4" />
                    Continue
                  </button>
                  <button type="button" onClick={() => controlNode(selectedRun, activeApprovalNode.nodeId, 'reject')} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300 bg-background px-3 text-sm text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                    <Square className="h-4 w-4" />
                    Reject
                  </button>
                </div>
              </section>
            )}
            {approvalRequests.length > 0 && (
              <section className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3" data-testid="workflow-approval-inbox">
               <div data-testid="workflow-approval-inbox-panel">
                <h3 className="text-sm font-semibold text-amber-900">Approval Inbox</h3>
                <div className="mt-2 grid gap-2">
                  <div className="rounded border border-amber-200 bg-background p-2 text-xs" data-testid="workflow-approval-risk-explanation">
                    <span className="block font-semibold text-foreground">Risk explanation</span>
                    <span className="mt-1 block text-amber-800">{approvalRiskExplanation}</span>
                  </div>
                  <div className="rounded border border-amber-200 bg-background p-2 text-xs" data-testid="workflow-approval-diff-summary">
                    <span className="block font-semibold text-foreground">Diff summary</span>
                    <span className="mt-1 block text-amber-800">{approvalDiffSummary}</span>
                  </div>
                  <div className="rounded border border-amber-200 bg-background p-2 text-xs" data-testid="workflow-approval-timeout-policy">
                    <span className="block font-semibold text-foreground">Timeout policy</span>
                    <span className="mt-1 block text-amber-800">{effectiveApprovalTimeoutPolicy}</span>
                  </div>
                  <label className="rounded border border-amber-200 bg-background p-2 text-xs" data-testid="workflow-approval-delegation">
                    <span className="block font-semibold text-foreground">Delegation</span>
                    <select value={approvalDelegationTarget} onChange={(event) => setApprovalDelegationTarget(event.target.value)} className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground">
                      {effectiveApprovalDelegationTargets.map((target: string) => (
                        <option key={target} value={target}>{target}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => void saveWorkflowSecurity({ delegation: { ...(workflowSecurity?.delegation || {}), target: approvalDelegationTarget } })} className="mt-2 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted">Save delegation</button>
                  </label>
                  <div className="rounded border border-amber-200 bg-background p-2 text-xs" data-testid="workflow-approval-audit-export">
                    <span className="block font-semibold text-foreground">Audit export</span>
                    <span className="mt-1 block text-amber-800">{stringifyValue(approvalAuditExport)}</span>
                  </div>
                </div>
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
            <details className="mb-4 rounded-md border border-border bg-card p-3" data-testid="workflow-run-advanced-tabs" open={!isSimpleMode || isRunAdvancedOpen}>
              <summary className="cursor-pointer text-sm font-semibold text-foreground" onClick={(event) => {
                if (isSimpleMode) {
                  event.preventDefault();
                  setIsRunAdvancedOpen((current) => !current);
                }
              }}>
                Advanced run details
              </summary>
              <section className="mt-3 rounded-md border border-border bg-background p-3" data-testid="workflow-run-streaming-logs">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Streaming logs</h3>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">tailing</span>
              </div>
              <label className="mt-2 block text-xs text-muted-foreground" data-testid="workflow-run-log-search">
                Search logs
                <input value={runLogQuery} onChange={(event) => setRunLogQuery(event.target.value)} placeholder="node, status, error" className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground" />
              </label>
              <div className="mt-2 max-h-28 space-y-1 overflow-auto">
                {streamingLogRows.slice(0, 8).map((row, index) => (
                  <div key={`${row.run.id}-${row.nodeRun.nodeId}-${index}`} className="rounded border border-border bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{row.nodeRun.title}</span>: {row.message}
                  </div>
                ))}
              </div>
              </section>
            </details>
            {(!isSimpleMode || isRunAdvancedOpen) && (
            <>
            <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-run-compare-attempts">
              <span className="block font-semibold text-foreground">Attempt comparison</span>
              <div className="mt-2 space-y-1">
                {compareRunAttempts.length > 0 ? compareRunAttempts.map((attempt) => (
                  <div key={attempt} className="rounded border border-border px-2 py-1">{attempt}</div>
                )) : <div className="rounded border border-border px-2 py-1">No attempts yet.</div>}
              </div>
            </section>
            {retryFromNodePreview && (
              <section className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" data-testid="workflow-retry-from-node-preview">
                Retry from {retryFromNodePreview.nodeId} will invalidate: {retryFromNodePreview.affected.join(', ')}
              </section>
            )}
            {cancelConfirmation && (
              <section className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700" data-testid="workflow-cancel-confirmation">
                Cancelling {cancelConfirmation.workflowName} may leave artifacts and checkpoints. Confirm from the workflow controls before stopping long tasks.
              </section>
            )}
            <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-permission-dry-run">
              <span className="block font-semibold text-foreground">Permission dry run</span>
              <div className="mt-2 max-h-32 space-y-1 overflow-auto">
                {permissionDryRunRows.map((row) => (
                  <div key={row.node.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                    <span className="truncate">{row.node.title}</span>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', row.decision === 'deny' ? 'border-red-200 bg-red-50 text-red-700' : row.decision === 'ask' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{row.decision}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-permission-override-request">
              <span className="block font-semibold text-foreground">Permission override request</span>
              <textarea value={permissionOverrideRequest} onChange={(event) => setPermissionOverrideRequest(event.target.value)} placeholder="Explain why this denied node needs elevation" className="mt-2 min-h-16 w-full rounded border border-border bg-background p-2 text-xs text-foreground" />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span>Requests are recorded, never auto-approved.</span>
                <button type="button" onClick={() => void createPermissionOverride()} disabled={!permissionOverrideRequest.trim() || isBusy} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50">Create request</button>
              </div>
              {Array.isArray(workflowSecurity?.overrideRequests) && workflowSecurity.overrideRequests.length > 0 && (
                <div className="mt-2 space-y-1">
                  {workflowSecurity.overrideRequests.slice(-3).map((request: any) => (
                    <div key={request.id || request.reason} className="rounded border border-border px-2 py-1">{request.nodeId}: {request.status} - {request.reason}</div>
                  ))}
                </div>
              )}
            </section>
            <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-secret-vault-integration">
              <span className="block font-semibold text-foreground">Secret vault</span>
              <div className="mt-2 space-y-1">
                {secretVaultRefs.map((secret) => (
                  <div key={secret} className="rounded border border-border px-2 py-1 font-mono text-[11px]">{secret.replace(/[^/]+$/, '********')}</div>
                ))}
                {secretVaultRefs.length === 0 && <div className="rounded border border-border px-2 py-1">No secret refs configured.</div>}
              </div>
            </section>
            <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-mcp-allowlist-ui">
              <span className="block font-semibold text-foreground">MCP allowlist</span>
              <div className="mt-2 space-y-1">
                {mcpAllowlistRows.map((tool) => (
                  <label key={tool} className="flex items-center gap-2 rounded border border-border px-2 py-1">
                    <input type="checkbox" checked readOnly />
                    <span className="font-mono text-[11px]">{tool}</span>
                  </label>
                ))}
                {mcpAllowlistRows.length === 0 && <div className="rounded border border-border px-2 py-1">No MCP allowlist configured; workflow dry-run will surface missing policy.</div>}
              </div>
            </section>
            <section className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700" data-testid="workflow-dangerous-command-policy">
              <span className="block font-semibold">Dangerous command policy</span>
              <span className="mt-1 block">{dangerousCommandPolicy}</span>
            </section>
            <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
              <h3 className="text-sm font-semibold text-foreground">Agent and MCP depth</h3>
              <div className="mt-2 grid gap-2">
                <div className="rounded border border-border p-2" data-testid="workflow-agent-session-link">
                  <span className="block font-semibold text-foreground">Agent session links</span>
                  <span>{agentSessionLinks.join(' | ') || 'No agent sessions yet.'}</span>
                </div>
                <div className="rounded border border-border p-2" data-testid="workflow-agent-prompt-preview">
                  <span className="block font-semibold text-foreground">Agent prompt preview</span>
                  <span>{agentPromptPreview}</span>
                </div>
                <div className="rounded border border-border p-2" data-testid="workflow-agent-result-contract">
                  <span className="block font-semibold text-foreground">Agent result contract</span>
                  <span>{agentResultContract}</span>
                </div>
                <div className="rounded border border-border p-2" data-testid="workflow-subagent-pool-limit">
                  <span className="block font-semibold text-foreground">Subagent pool limit</span>
                  <span>{subagentPoolLimit} concurrent subagent nodes</span>
                </div>
                <div className="rounded border border-border p-2" data-testid="workflow-subagent-cancellation-bridge">
                  <span className="block font-semibold text-foreground">Subagent cancellation bridge</span>
                  <span>{subagentCancellationBridge}</span>
                </div>
                <div className="rounded border border-border p-2" data-testid="workflow-mcp-tool-catalog-sync">
                  <span className="block font-semibold text-foreground">MCP tool catalog sync</span>
                  <span>{mcpToolCatalogSync}</span>
                </div>
                <div className="rounded border border-border p-2" data-testid="workflow-mcp-argument-builder">
                  <span className="block font-semibold text-foreground">MCP argument builder</span>
                  <span>{mcpArgumentBuilder}</span>
                </div>
                <div className="rounded border border-border p-2" data-testid="workflow-mcp-error-normalization">
                  <span className="block font-semibold text-foreground">MCP error normalization</span>
                  <span>{mcpErrorNormalization}</span>
                </div>
                <div className="rounded border border-border p-2" data-testid="workflow-tool-node-registry">
                  <span className="block font-semibold text-foreground">Tool node registry</span>
                  <span>{toolNodeRegistry}</span>
                </div>
                <div className="rounded border border-border p-2" data-testid="workflow-browser-screenshot-node">
                  <span className="block font-semibold text-foreground">Browser screenshot node</span>
                  <span>{browserScreenshotNode}</span>
                </div>
              </div>
            </section>
            <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
              <h3 className="text-sm font-semibold text-foreground">Template productization</h3>
              <div className="mt-2 grid gap-2">
                <div className="rounded border border-border p-2" data-testid="workflow-template-detail-page">{templateDetailPage}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-template-dependency-check">{templateDependencyCheck}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-template-smoke-badge">{templateSmokeBadge}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-template-version-upgrade">{templateVersionUpgrade}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-template-migration-notes">{templateMigrationNotes}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-template-fork">{templateFork}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-package-export-wizard">{packageExportWizard}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-package-import-preview">{packageImportPreview}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-marketplace-trust-badge">{marketplaceTrustBadge}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-enterprise-template-pack">{enterpriseTemplatePack}</div>
              </div>
            </section>
            <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
              <h3 className="text-sm font-semibold text-foreground">Observability evidence</h3>
              <div className="mt-2 grid gap-2">
                <div className="rounded border border-border p-2" data-testid="workflow-event-timeline-correlation">{eventTimelineCorrelation}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-replay-visualizer">{replayVisualizer}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-failure-classifier">{failureClassifier}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-recommended-recovery-action">{recommendedRecoveryAction}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-artifact-gallery">{artifactGallery.join(' | ') || 'No artifacts yet.'}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-screenshot-evidence-viewer">{screenshotEvidenceViewer}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-benchmark-trend">{benchmarkTrend}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-release-readiness-detail">{releaseReadinessDetail}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-test-coverage-map">{testCoverageMap}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-evidence-export">{evidenceExport}</div>
              </div>
            </section>
            <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
              <h3 className="text-sm font-semibold text-foreground">Governance and audit</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void workflowGovernanceAction('govern')} disabled={isBusy} className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-muted disabled:opacity-50">
                  Save governance
                </button>
                <button type="button" onClick={() => void workflowGovernanceAction('review')} disabled={isBusy} className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-muted disabled:opacity-50">
                  Request review
                </button>
                <button type="button" onClick={() => void workflowGovernanceAction('publish')} disabled={isBusy} className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-muted disabled:opacity-50">
                  Publish
                </button>
                <button type="button" onClick={() => void workflowGovernanceAction('deprecate')} disabled={isBusy} className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-muted disabled:opacity-50">
                  Deprecate
                </button>
              </div>
              <div className="mt-2 grid gap-2">
                <div className="rounded border border-border p-2" data-testid="workflow-change-history">{workflowChangeHistory}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-draft-publish-flow">{draftPublishFlow}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-review-request">{reviewRequest}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-ownership-metadata">{ownershipMetadata}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-deprecation-flow">{deprecationFlow}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-usage-analytics">{usageAnalytics}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-role-based-visibility">{roleBasedVisibility}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-compliance-labels">{complianceLabels}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-audit-log-search">{auditLogSearch}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-policy-report">{policyReport}</div>
              </div>
            </section>
            <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
              <h3 className="text-sm font-semibold text-foreground">Production readiness</h3>
              <div className="mt-2 grid gap-2">
                <div className="rounded border border-border p-2" data-testid="workflow-large-graph-performance">{largeGraphPerformance}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-virtualized-run-logs">{virtualizedRunLogs}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-offline-read-mode">{offlineReadMode}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-import-validation-sandbox">{importValidationSandbox}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-storage-backup-restore">{storageBackupRestore}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-data-retention-policy">{dataRetentionPolicy}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-package-size-guard">{packageSizeGuard}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-release-smoke-matrix">{releaseSmokeMatrix}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-migration-doctor">{migrationDoctor}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-production-readiness-dashboard">{productionReadinessDashboard}</div>
              </div>
            </section>
            </>
            )}
             <h3 className="text-sm font-semibold text-foreground">Run history</h3>
             <div className="mt-3 space-y-3">
              {visibleRuns.map((run) => (
                <div key={run.id} data-testid="workflow-run-card" className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-semibold text-foreground">{run.workflowName}</h4>
                      <p className="text-xs text-muted-foreground">{formatTime(run.createdAt)}</p>
                    </div>
                   <span className={cn('rounded-full border px-2 py-0.5 text-[11px]', statusTone[run.status] || statusTone.pending)}>{run.status}</span>
                 </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" data-testid="workflow-run-pinning" onClick={() => toggleRunPin(run.id)} className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted">
                      {pinnedRunIds.includes(run.id) ? 'Unpin' : 'Pin'}
                    </button>
                    <button type="button" data-testid="workflow-run-archive" onClick={() => toggleRunArchive(run.id)} className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted">
                      Archive
                    </button>
                    <button type="button" onClick={() => setCancelConfirmation(run)} className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted">
                      Cancel impact
                    </button>
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
                            <button type="button" data-testid="workflow-retry-node-only" onClick={() => retryNodeOnly(run, nodeRun.nodeId)} disabled={isBusy} className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-muted">
                               <RefreshCw className="h-3 w-3" />
                               Retry
                             </button>
                            <button type="button" onClick={() => previewRetryFromNode(run, nodeRun.nodeId)} disabled={isBusy} className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-muted">
                              Preview retry from
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
