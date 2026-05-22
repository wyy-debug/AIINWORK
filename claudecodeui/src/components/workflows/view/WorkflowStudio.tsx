import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Command,
  Copy,
  FileText,
  GitBranch,
  History,
  Home,
  Link2,
  Play,
  Plus,
  RefreshCw,
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
import {
  buildWorkflowHumanNextAction,
  buildWorkflowPreviewConsistency,
  buildWorkflowReadinessSummaries,
  buildWorkflowRunStory,
} from './WorkflowStudioViewModel';
import type { WorkflowHumanHint } from './WorkflowStudioViewModel';
import { WorkflowRunConsole } from './WorkflowRunConsole';
import { WorkflowArtifactGallery } from './WorkflowArtifactGallery';
import { WorkflowPermissionPanels } from './WorkflowPermissionPanels';
import { WorkflowCommandCenter } from './WorkflowCommandCenter';
import { WorkflowHomeView } from './WorkflowHomeView';
import { WorkflowLibraryView } from './WorkflowLibraryView';
import { WorkflowNodePalette } from './WorkflowNodePalette';
import { WorkflowEditorSetupStrip } from './WorkflowEditorSetupStrip';
import { WorkflowEditorCanvasShell } from './WorkflowEditorCanvasShell';

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
    resolvedInputLineage?: Record<string, unknown>;
    permissionDecision?: string;
    upstream?: Array<{ nodeId?: string; mode?: string }>;
    blocked?: boolean;
    errors?: Array<{
      code?: string;
      category?: string;
      message?: string;
      nodeId?: string;
      field?: string;
      variable?: string;
      diagnostic?: Record<string, unknown>;
    }>;
  }>;
};

type WorkflowLineageSegment = {
  type?: string;
  kind?: string;
  text?: string;
  sourceExpression?: string;
  sourcePath?: string;
  valuePreview?: unknown;
  error?: { code?: string; message?: string; variable?: string };
};

type WorkflowLineageTrace = {
  field?: string;
  status?: string;
  sourceExpression?: string;
  sourcePath?: string;
  valuePreview?: unknown;
  segments?: WorkflowLineageSegment[];
  error?: { code?: string; message?: string; variable?: string };
};

type WorkflowLineageRow = {
  field: string;
  status: string;
  sourceExpression: string;
  sourcePath: string;
  valuePreview: string;
  errorMessage: string;
  segmentCount: number;
};

type WorkflowMissingVariableDiagnostic = {
  nodeId: string;
  nodeTitle: string;
  field: string;
  variable: string;
  code: string;
  message: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function compactPreview(value: unknown) {
  const text = stringifyValue(value);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function buildLineageFieldRows(lineage?: Record<string, unknown> | null): WorkflowLineageRow[] {
  if (!lineage) return [];
  return Object.entries(lineage).map(([field, rawTrace]) => {
    const trace = isRecord(rawTrace) ? rawTrace as WorkflowLineageTrace : { valuePreview: rawTrace };
    const segments = Array.isArray(trace.segments) ? trace.segments : [];
    const firstReferenceSegment = segments.find((segment) => segment?.sourcePath || segment?.valuePreview !== undefined);
    const error = trace.error || segments.find((segment) => segment?.error)?.error;
    return {
      field: trace.field || field,
      status: trace.status || (error ? 'missing' : trace.sourceExpression ? 'resolved' : 'literal'),
      sourceExpression: trace.sourceExpression || firstReferenceSegment?.sourceExpression || firstReferenceSegment?.text || '',
      sourcePath: trace.sourcePath || firstReferenceSegment?.sourcePath || '',
      valuePreview: compactPreview(trace.valuePreview ?? firstReferenceSegment?.valuePreview),
      errorMessage: error?.message || error?.code || '',
      segmentCount: segments.length,
    };
  });
}

function isMissingVariableError(error: { code?: string; category?: string }) {
  const code = String(error.code || '');
  return error.category === 'missing_variable'
    || code === 'missing_input_variable'
    || code === 'missing_node_variable'
    || code === 'missing_output_field'
    || code === 'missing_variable';
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

  useEffect(() => {
    if (activeView !== 'Editor' || !draft.id) return;
    let cancelled = false;
    const loadEditorMcpCatalog = async () => {
      const [mcpResponse, securityResponse] = await Promise.all([
        api.workflowMcpToolCatalog(draft.id),
        api.workflowSecurity(draft.id),
      ]);
      const [mcpData, securityData] = await Promise.all([
        mcpResponse.json(),
        securityResponse.json(),
      ]);
      if (cancelled) return;
      if (mcpResponse.ok) setWorkflowMcpCatalog(Array.isArray(mcpData.tools) ? mcpData.tools : []);
      if (securityResponse.ok) {
        setWorkflowSecurity(securityData.security || null);
        setMcpAllowlistRows(Array.isArray(securityData.security?.mcpAllowlist) ? securityData.security.mcpAllowlist : []);
      }
    };
    void loadEditorMcpCatalog().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeView, draft.id]);

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
  const commandCenterDiagnostics = useMemo(() => ({
    workflowName: draft.name,
    workGraphSchemaVersion: workGraphDocument.schemaVersion,
    workGraphNodeCount: workGraphRoundtrip.nodes.length,
    workGraphEdgeCount: workGraphDocument.edges.length,
    compatibilityOk: workGraphCompatibility.ok,
    compatibilityWarningCount: workGraphCompatibility.warnings.length,
    migrationDoctorStatus: localMigrationDoctor.status,
    migrationDoctorChecked: localMigrationDoctor.checked,
    migrationDoctorFindingCount: localMigrationDoctor.findings.length,
    runtimeLabel: selectedWorkGraphRuntimeState
      ? `${selectedWorkGraphRuntimeState.summary.running} running / ${selectedWorkGraphRuntimeState.summary.waiting} waiting / ${selectedWorkGraphRuntimeState.summary.failed} failed`
      : 'no run state',
    releaseGates: ((releaseReadiness?.gates as Array<Record<string, unknown>> | undefined) || []).map((gate) => ({
      id: String(gate.id),
      label: String(gate.label),
      status: String(gate.status),
    })),
  }), [
    draft.name,
    localMigrationDoctor.checked,
    localMigrationDoctor.findings.length,
    localMigrationDoctor.status,
    releaseReadiness,
    selectedWorkGraphRuntimeState,
    workGraphCompatibility.ok,
    workGraphCompatibility.warnings.length,
    workGraphDocument.edges.length,
    workGraphDocument.schemaVersion,
    workGraphRoundtrip.nodes.length,
  ]);
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
  const selectedPreviewNode = useMemo(() => {
    if (!selectedNode) return null;
    return dryRunPreview?.nodes?.find((node) => node.nodeId === selectedNode.id) || null;
  }, [dryRunPreview, selectedNode]);
  const lineageFieldRows = useMemo(() => {
    const runLineage = selectedNode ? selectedRun?.nodeRuns?.[selectedNode.id]?.inputLineage : null;
    const lineage = selectedPreviewNode?.resolvedInputLineage || runLineage;
    return buildLineageFieldRows(lineage || null);
  }, [selectedNode, selectedPreviewNode, selectedRun]);
  const missingVariableDiagnostics = useMemo<WorkflowMissingVariableDiagnostic[]>(() => {
    return (dryRunPreview?.nodes || []).flatMap((previewNode) => {
      const nodeId = String(previewNode.nodeId || '');
      const nodeTitle = draft.nodes.find((node) => node.id === nodeId)?.title || previewNode.title || nodeId;
      return (previewNode.errors || [])
        .filter(isMissingVariableError)
        .map((error) => {
          const diagnostic = isRecord(error.diagnostic) ? error.diagnostic : {};
          return {
            nodeId: String(diagnostic.nodeId || error.nodeId || nodeId),
            nodeTitle,
            field: String(diagnostic.field || error.field || 'field'),
            variable: String(diagnostic.sourceExpression || diagnostic.variable || error.variable || ''),
            code: String(error.code || 'missing_variable'),
            message: error.message || `Missing variable ${String(diagnostic.sourceExpression || diagnostic.variable || error.variable || '')}`,
          };
        });
    });
  }, [draft.nodes, dryRunPreview]);
  const getNodeRunLineageRows = useCallback((nodeRun: WorkflowNodeRun) => {
    if (nodeRun.inputLineage && Object.keys(nodeRun.inputLineage).length > 0) {
      return buildLineageFieldRows(nodeRun.inputLineage);
    }
    const findSnapshotLineage = (snapshot: unknown) => {
      const nodes = isRecord(snapshot) && Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
      const snapshotNode = nodes.find((item) => isRecord(item) && item.nodeId === nodeRun.nodeId);
      return isRecord(snapshotNode) && isRecord(snapshotNode.resolvedInputLineage)
        ? snapshotNode.resolvedInputLineage
        : null;
    };
    return buildLineageFieldRows(findSnapshotLineage(selectedRun?.executionInputSnapshot) || findSnapshotLineage(selectedRun?.previewSnapshot));
  }, [selectedRun]);
  const selectMissingVariableDiagnostic = useCallback((diagnostic: WorkflowMissingVariableDiagnostic) => {
    if (!diagnostic.nodeId) return;
    setActiveView('Editor');
    setWorkflowUiMode('advanced');
    setInspectorTab('Data');
    setSelectedNodeId(diagnostic.nodeId);
    setSelectedNodeIds([diagnostic.nodeId]);
    setSelectedEdgeId('');
    setIsDiagnosticsOpen(true);
  }, []);
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
  const templateSmokeStatusById = useMemo(() => Object.fromEntries(
    ((releaseReadiness?.templateSmoke as Array<Record<string, unknown>> | undefined) || [])
      .map((item) => [String(item.templateId), String(item.status || 'not run')]),
  ), [releaseReadiness]);
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
  const humanNextAction = useMemo<WorkflowHumanHint>(
    () => buildWorkflowHumanNextAction({ nodes: draft.nodes }, selectedNode),
    [draft.nodes, selectedNode],
  );
  const runStory = useMemo<WorkflowHumanHint>(
    () => buildWorkflowRunStory(selectedRun),
    [selectedRun],
  );
  const previewConsistency = useMemo<WorkflowHumanHint>(
    () => buildWorkflowPreviewConsistency(selectedRun),
    [selectedRun],
  );
  const previewChangedNodes = useMemo(() => (
    selectedRun?.previewDiff?.changedNodes || []
  ), [selectedRun]);
  const selectedRunSnapshot = useMemo(() => (
    selectedRun?.runSnapshot && isRecord(selectedRun.runSnapshot) ? selectedRun.runSnapshot as Record<string, unknown> : null
  ), [selectedRun]);
  const selectedRunDefinitionSnapshot = useMemo(() => {
    const definition = selectedRunSnapshot?.definitionSnapshot;
    return definition && isRecord(definition) ? definition : null;
  }, [selectedRunSnapshot]);
  const selectedRunSnapshotDetails = useMemo(() => {
    const definitionNodes = Array.isArray(selectedRunDefinitionSnapshot?.nodes) ? selectedRunDefinitionSnapshot.nodes : [];
    const packageSnapshots = Array.isArray(selectedRunSnapshot?.nodePackageSnapshots) ? selectedRunSnapshot.nodePackageSnapshots : [];
    const runInputs = isRecord(selectedRunSnapshot?.runInputsSnapshot) ? selectedRunSnapshot.runInputsSnapshot : {};
    const profileSnapshot = isRecord(selectedRunSnapshot?.profileSnapshot) ? selectedRunSnapshot.profileSnapshot : {};
    const permissionSnapshot = isRecord(selectedRunSnapshot?.permissionSnapshot) ? selectedRunSnapshot.permissionSnapshot : {};
    return {
      hasSnapshot: Boolean(selectedRunSnapshot),
      workflowName: String(selectedRunSnapshot?.workflowName || selectedRunDefinitionSnapshot?.name || selectedRun?.workflowName || 'Workflow'),
      capturedAt: String(selectedRunSnapshot?.capturedAt || ''),
      resolverVersion: String(selectedRunSnapshot?.resolverVersion || selectedRun?.resolverVersion || ''),
      profileId: String(profileSnapshot.profileId || selectedRunDefinitionSnapshot?.profileId || ''),
      permissionPreset: String(permissionSnapshot.permissionPreset || selectedRunDefinitionSnapshot?.permissionPreset || ''),
      nodeCount: definitionNodes.length,
      packageCount: packageSnapshots.length,
      inputKeys: Object.keys(runInputs),
      packageLabels: packageSnapshots.map((entry) => isRecord(entry) ? String(entry.id || entry.type || 'package') : 'package').slice(0, 4),
    };
  }, [selectedRun, selectedRunDefinitionSnapshot, selectedRunSnapshot]);
  const selectedRunDefinitionDriftReasons = useMemo(() => {
    if (!selectedRunSnapshot || !selectedRunDefinitionSnapshot) return [];
    const reasons: string[] = [];
    if (selectedRunDefinitionSnapshot.name && selectedRunDefinitionSnapshot.name !== draft.name) reasons.push('name');
    if (selectedRunDefinitionSnapshot.profileId && selectedRunDefinitionSnapshot.profileId !== draft.profileId) reasons.push('profile');
    if (selectedRunDefinitionSnapshot.permissionPreset && selectedRunDefinitionSnapshot.permissionPreset !== draft.permissionPreset) reasons.push('permission');
    const snapshotNodes = Array.isArray(selectedRunDefinitionSnapshot.nodes) ? selectedRunDefinitionSnapshot.nodes : [];
    const snapshotNodeSignature = JSON.stringify(snapshotNodes.map((node) => isRecord(node) ? {
      id: node.id,
      type: node.type,
      title: node.title,
      prompt: node.prompt,
      command: node.command,
      toolName: node.toolName,
      agentId: node.agentId,
    } : node));
    const currentNodeSignature = JSON.stringify(draft.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      prompt: node.prompt,
      command: node.command,
      toolName: node.toolName,
      agentId: node.agentId,
    })));
    if (snapshotNodeSignature !== currentNodeSignature) reasons.push('nodes');
    const snapshotEdges = Array.isArray(selectedRunDefinitionSnapshot.edges) ? selectedRunDefinitionSnapshot.edges : [];
    const snapshotEdgeSignature = JSON.stringify(snapshotEdges.map((edge) => isRecord(edge) ? {
      from: edge.from,
      to: edge.to,
      mode: edge.mode,
      condition: edge.condition,
    } : edge));
    const currentEdgeSignature = JSON.stringify(draft.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      mode: edge.mode,
      condition: edge.condition,
    })));
    if (snapshotEdgeSignature !== currentEdgeSignature) reasons.push('edges');
    return reasons;
  }, [draft, selectedRunDefinitionSnapshot, selectedRunSnapshot]);
  const selectedRunDefinitionChanged = selectedRunDefinitionDriftReasons.length > 0;
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
    if (approval?.riskExplanation?.explain || approval?.riskExplanation?.reason) {
      return approval.riskExplanation.explain || `${approval.riskExplanation.riskLevel}: ${approval.riskExplanation.reason}`;
    }
    const riskyNodes = draft.nodes.filter((node) => riskyNodeTypes.has(node.type));
    return riskyNodes.length > 0
      ? riskyNodes.map((node) => `${node.title}: ${node.type} uses ${node.permission || draft.permissionPreset}`).join('; ')
      : 'No high-risk nodes in this workflow.';
  }, [approvalRequests, draft.nodes, draft.permissionPreset]);
  const approvalRequestedCapabilities = useMemo(() => {
    const approval = approvalRequests[0] as any;
    const capabilities = approval?.riskExplanation?.requestedCapabilities;
    return Array.isArray(capabilities) && capabilities.length > 0 ? capabilities.join(', ') : 'No elevated capability requested.';
  }, [approvalRequests]);
  const approvalRiskReasons = useMemo(() => {
    const approval = approvalRequests[0] as any;
    const reasons = approval?.riskExplanation?.riskReasons;
    return Array.isArray(reasons) && reasons.length > 0 ? reasons.join('; ') : 'No extra risk reason recorded.';
  }, [approvalRequests]);
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
  const permissionDryRunRows = useMemo<Array<{
    node: Partial<WorkflowNode> & { id: string; title: string; type: string };
    decision: string;
    reason: string;
    requestedCapabilities: string[];
    effectiveCapabilities: string[];
    riskReasons: string[];
  }>>(() => Array.isArray(workflowSecurity?.permissionDryRun?.rows)
    ? workflowSecurity.permissionDryRun.rows.map((row: any) => ({
      node: draft.nodes.find((node) => node.id === row.nodeId) || { id: row.nodeId, title: row.title, type: row.type },
      decision: row.decision,
      reason: row.reason,
      requestedCapabilities: Array.isArray(row.requestedCapabilities) ? row.requestedCapabilities : [],
      effectiveCapabilities: Array.isArray(row.effectiveCapabilities) ? row.effectiveCapabilities : [],
      riskReasons: Array.isArray(row.riskReasons) ? row.riskReasons : [],
    }))
    : draft.nodes.map((node) => {
    const risky = riskyNodeTypes.has(node.type);
    const decision = draft.permissionPreset === 'enterprise-safe' && risky ? 'deny' : risky ? node.permission || 'ask' : 'allow';
    return {
      node,
      decision,
      reason: risky ? `${node.type} requires explicit permission` : 'read-only/control node',
      requestedCapabilities: risky ? [`${node.type}.run`] : ['control-flow.read'],
      effectiveCapabilities: decision === 'deny' ? [] : (risky ? [`${node.type}.run`] : ['control-flow.read']),
      riskReasons: [risky ? `${node.type} requires explicit permission` : 'Read-only or control-flow capability'],
    };
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
  const agentTerminalRows = useMemo(() => Object.values(selectedRun?.nodeRuns || {})
    .filter((nodeRun) => nodeRun.type === 'agent' || nodeRun.type === 'subagent')
    .map((nodeRun) => {
      const output = isRecord(nodeRun.output) ? nodeRun.output : {};
      const sessionId = String(output.sessionId || output.subagentRunId || '');
      const sessionLink = String(output.sessionLink || (sessionId ? `#session=${encodeURIComponent(sessionId)}` : ''));
      const result = output.result ?? output.summary ?? '';
      const logs = [
        ...(Array.isArray(nodeRun.logs) ? nodeRun.logs : []),
        ...(Array.isArray(output.logs) ? output.logs.map((entry) => isRecord(entry) ? String(entry.message || '') : String(entry || '')) : []),
      ].filter(Boolean);
      return {
        nodeId: nodeRun.nodeId,
        title: nodeRun.title,
        type: nodeRun.type,
        status: nodeRun.status,
        summary: String(output.summary || (typeof result === 'string' ? result : stringifyValue(result)) || nodeRun.error || nodeRun.status),
        sessionId,
        sessionLink,
        diffRefs: Array.isArray(output.diffRefs) ? output.diffRefs.map((entry) => String(entry)) : [],
        artifactCount: (nodeRun.artifacts || []).length,
        logs,
        handoffInput: stringifyValue(nodeRun.input || {}).slice(0, 260),
      };
    }), [selectedRun]);
  const agentSessionLinks = useMemo(() => (Array.isArray(agentBridgeState?.sessionLinks) && agentBridgeState.sessionLinks.length > 0
    ? agentBridgeState.sessionLinks.map((link: any) => `${link.nodeId}: ${link.sessionLink || link.sessionId || link.status}`)
    : runs.flatMap((run) => Object.values(run.nodeRuns || {})
    .filter((nodeRun) => nodeRun.type === 'agent' || nodeRun.type === 'subagent')
    .map((nodeRun) => {
      const output = isRecord(nodeRun.output) ? nodeRun.output : {};
      return `${run.workflowName} / ${nodeRun.title}: ${String(output.sessionLink || output.sessionId || output.subagentRunId || nodeRun.status)}`;
    }))).slice(0, 4), [agentBridgeState, runs]);
  const agentPromptPreview = useMemo(() => {
    const backendNode = agentBridgeState?.agentNodes?.find((node: any) => node.nodeId === selectedNode?.id);
    return backendNode?.promptPreview || (selectedNode ? `${selectedNode.title}: ${selectedNode.prompt || selectedNode.command || selectedNode.condition || 'No prompt configured.'}` : 'Select an agent node to preview final prompt/context.');
  }, [agentBridgeState, selectedNode]);
  const agentResultContract = useMemo(() => (agentBridgeState?.agentNodes?.[0]?.resultContract || ['summary', 'artifacts', 'diffRefs', 'status', 'sessionId', 'sessionLink']).join(', '), [agentBridgeState]);
  const subagentPoolLimit = useMemo(() => agentBridgeState?.subagentPoolLimit || Math.max(1, Math.min(4, draft.maxConcurrency || 1)), [agentBridgeState, draft.maxConcurrency]);
  const subagentCancellationBridge = selectedRun ? `${selectedRun.workflowName}: cancel cascades to child subagent runs` : 'No active run selected.';
  const mcpToolCatalogSync = useMemo(() => workflowMcpCatalog.some((tool) => tool.enabled) ? workflowMcpCatalog.filter((tool) => tool.enabled).map((tool) => tool.toolName).join(', ') : nodeTypeDefinitions.filter((definition) => definition.type === 'mcp').length > 0 ? 'MCP catalog loaded; configure workflow allowlist to enable tools.' : 'MCP catalog waits for enabled server/tool definitions.', [nodeTypeDefinitions, workflowMcpCatalog]);
  const selectedMcpTool = useMemo(() => selectedNode?.type === 'mcp'
    ? workflowMcpCatalog.find((tool) => tool.toolName === selectedNode.toolName) || null
    : null, [selectedNode, workflowMcpCatalog]);
  const selectedMcpArgumentFields = useMemo(() => {
    const fields = selectedMcpTool?.argumentSchema?.fields;
    return Array.isArray(fields) ? fields : [];
  }, [selectedMcpTool]);
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
    ? `Export preview: ${templateProductState.exportPreview.workflowCount} workflow(s), ${templateProductState.exportPreview.packageId || 'workflow-package'} ${templateProductState.exportPreview.packageVersion || '1.0.0'}, ${templateProductState.exportPreview.packageSizeEstimateBytes} bytes.`
    : 'Export wizard collects workflow, dependencies, sample inputs, screenshots.';
  const packageManifestSummary = templateProductState?.exportPreview
    ? `manifestVersion 1 / trust ${templateProductState.exportPreview.trustLevel || 'local'} / deps ${Object.values(templateProductState.exportPreview.dependencies || {}).flat().filter(Boolean).join(', ') || 'none'}`
    : 'Manifest preview waits for export wizard input.';
  const packageImportPreview = templateProductState?.exportPreview?.importPreview
    ? `${templateProductState.exportPreview.importPreview.changes?.map((change: any) => `${change.id}:${change.action}`).join(', ') || 'no changes'} / missing ${(templateProductState.exportPreview.importPreview.missingDependencies || []).map((dependency: any) => dependency.id || dependency.name).join(', ') || 'none'}`
    : 'Import preview API lists added/overwritten workflows, packages, templates before writing.';
  const packageTrustSmokeState = templateProductState?.exportPreview
    ? `Trust ${templateProductState.exportPreview.trustLevel || 'local'} / smoke ${templateProductState.exportPreview.smoke?.status || 'not-run'}${templateProductState.exportPreview.smoke?.failureReason ? `: ${templateProductState.exportPreview.smoke.failureReason}` : ''}`
    : 'Trust and smoke governance waits for package preview.';
  const marketplaceTrustBadge = templateProductState?.detail?.trust ? `Trust: ${templateProductState.detail.trust}` : 'Trust: built-in / local enterprise / community / unsigned.';
  const enterpriseTemplatePack = workflows.filter((workflow) => ['recipe-crashsight-analysis', 'recipe-redmine-review', 'recipe-code-impact-analysis', 'recipe-pr-description'].includes(workflow.id)).map((workflow) => workflow.name).join(', ') || 'CrashSight Analysis, Redmine Review, Code Impact Analysis, Publish PR.';
  const eventTimelineCorrelation = useMemo(() => selectedRun ? `${selectedRun.id}: timeline events link back to run nodes` : 'No run selected.', [selectedRun]);
  const replayVisualizer = useMemo(() => selectedRun ? `${observabilityState?.evidenceBundle?.replay?.events?.length ?? (runEvents[selectedRun.id] || selectedRun.timelineEvents || []).length} events available for replay · ${selectedRun.runSnapshot ? 'snapshot loaded' : 'current definition only'} · status ${selectedRun.status}` : 'No replay events.', [observabilityState, runEvents, selectedRun]);
  const failureClassifier = useMemo(() => observabilityState?.failures?.failures?.length
    ? observabilityState.failures.failures.map((failure: any) => `${failure.nodeId}:${failure.category}`).join(', ')
    : Object.values(selectedRun?.nodeRuns || {}).some((nodeRun) => nodeRun.error) ? 'classified: permission / dependency / timeout / agent / mcp / shell / schema' : 'No failures to classify.', [observabilityState, selectedRun]);
  const recommendedRecoveryAction = useMemo(() => observabilityState?.recovery?.actions?.length
    ? observabilityState.recovery.actions.flatMap((item: any) => item.recommendations || []).slice(0, 3).join(', ')
    : failedRuns.length > 0 ? 'Retry node, retry from node, rollback checkpoint, or edit config.' : 'No recovery action needed.', [failedRuns.length, observabilityState]);
  const artifactGallery = useMemo(() => {
    const observedArtifacts = observabilityState?.artifacts?.artifacts;
    const runArtifacts = selectedRun?.artifacts;
    const rawArtifacts = (Array.isArray(observedArtifacts) && observedArtifacts.length > 0
      ? observedArtifacts
      : Array.isArray(runArtifacts)
        ? runArtifacts
        : []) as any[];
    return rawArtifacts
      .map((artifact, index) => ({
        id: String(artifact.id || `artifact-${index}`),
        title: String(artifact.title || artifact.path || artifact.id || `Artifact ${index + 1}`),
        type: String(artifact.type || artifact.kind || 'artifact'),
        nodeTitle: String(artifact.nodeTitle || artifact.nodeId || 'Run'),
        path: artifact.path ? String(artifact.path) : '',
        summary: String(artifact.summary || artifact.content || ''),
        createdAt: artifact.createdAt,
      }))
      .slice(0, 8);
  }, [observabilityState, selectedRun]);
  const copyArtifactReference = useCallback((artifact: { id: string; title: string; path?: string; type?: string }) => {
    const value = artifact.path || `${artifact.type || 'artifact'}:${artifact.id}`;
    void navigator.clipboard?.writeText(value);
  }, []);
  const attachArtifactEvidence = useCallback((artifact: { id: string; title: string; path?: string; type?: string }) => {
    const value = `workflow-artifact ${artifact.title} (${artifact.type || 'artifact'}): ${artifact.path || artifact.id}`;
    void navigator.clipboard?.writeText(value);
  }, []);
  const screenshotEvidenceViewer = observabilityState?.evidence?.screenshots?.length
    ? `${observabilityState.evidence.screenshots.length} screenshot evidence file(s) available.`
    : 'Run screenshots are available from output/playwright/screenshots with issue-linked filenames.';
  const benchmarkTrend = observabilityState?.trend?.results?.length
    ? `${observabilityState.trend.results.length} benchmark trend point(s), latest ${observabilityState.trend.results.at(-1)?.status || 'unknown'}.`
    : 'Benchmark trend tracks latest result, duration, and failure reason per smoke workflow.';
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
  const {
    releaseReadinessDetail,
    largeGraphPerformance,
    virtualizedRunLogs,
    offlineReadMode,
    importValidationSandbox,
    storageBackupRestore,
    dataRetentionPolicy,
    packageSizeGuard,
    releaseSmokeMatrix,
    releaseQualityGate,
    migrationDoctor,
    productionReadinessDashboard,
  } = useMemo(() => buildWorkflowReadinessSummaries({
    readinessState,
    observabilityState,
    releaseReadiness,
    templateProductState,
    draftNodeCount: draft.nodes.length,
    streamingLogRowCount: streamingLogRows.length,
  }), [draft.nodes.length, observabilityState, readinessState, releaseReadiness, streamingLogRows.length, templateProductState]);
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
    const selectedNodeMissingVariableBadges = selectedNode
      ? missingVariableDiagnostics
        .filter((diagnostic) => diagnostic.nodeId === selectedNode.id)
        .map((diagnostic) => `${diagnostic.field}: ${diagnostic.variable || diagnostic.code}`)
      : [];
    return (
      <WorkflowEditorCanvasShell
        editorRef={flowGramEditorRef}
        workflow={draft}
        selectedRun={run}
        runtimeVisualState={selectedWorkGraphRuntimeState}
        selectedNodeId={selectedNodeId}
        selectedEdgeId={selectedEdgeId}
        selectedCount={selectedCount}
        copiedNodeCount={copiedNodes.length}
        canUndoWorkflow={canUndoWorkflow}
        canRedoWorkflow={canRedoWorkflow}
        isSimpleMode={isSimpleMode}
        isDiagnosticsOpen={isDiagnosticsOpen}
        layoutMode={layoutMode}
        layoutModes={layoutModes}
        minimapFilter={minimapFilter}
        minimapFilters={minimapFilters}
        selectedLayoutLocked={selectedNodeIds.every((id) => lockedNodeIds.includes(id))}
        selectedNodeValidationBadges={selectedNode ? getNodeValidationBadges(draft, selectedNode, lockedNodeIds) : ['FlowGram validation ready']}
        selectedNodeMissingVariableBadges={selectedNodeMissingVariableBadges}
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
        onPasteSelection={pasteCopiedNodes}
        onDuplicateSelection={duplicateSelectedSubgraph}
        onDeleteSelection={deleteSelectedGraphItems}
        onUndo={undoWorkflowEdit}
        onRedo={redoWorkflowEdit}
        onLayoutModeChange={(value) => setLayoutMode(value as WorkflowLayoutMode)}
        onToggleLayoutLock={toggleLayoutLock}
        onMinimapFilterChange={(value) => setMinimapFilter(value as WorkflowMinimapFilter)}
        onAutoLayout={autoLayoutNodes}
      />
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
      <WorkflowCommandCenter
        activeView={activeView}
        views={views}
        draft={draft}
        selectedRunStatus={selectedRun?.status || null}
        uiMode={workflowUiMode}
        isSimpleMode={isSimpleMode}
        isBusy={isBusy}
        isMoreOpen={isCommandCenterMoreOpen}
        isDiagnosticsOpen={isDiagnosticsOpen}
        isRunSetupOpen={isRunSetupOpen}
        runInputs={runInputs}
        diagnostics={commandCenterDiagnostics}
        onSetActiveView={setActiveView}
        onAddStep={() => addNode('agent')}
        onSaveWorkflow={saveWorkflow}
        onOpenRunSetup={() => setIsRunSetupOpen(true)}
        onCloseRunSetup={() => setIsRunSetupOpen(false)}
        onStartRun={async () => {
          await startRun();
          setIsRunSetupOpen(false);
        }}
        onRunInputChange={(inputId, value) => setRunInputs((current) => ({ ...current, [inputId]: value }))}
        onToggleUiMode={() => setWorkflowUiMode((current) => current === 'simple' ? 'advanced' : 'simple')}
        onToggleMore={() => setIsCommandCenterMoreOpen((current) => !current)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onRefreshData={() => loadData().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Failed to refresh'))}
        onRunBenchmarks={runBenchmarks}
        onOpenHelp={() => setIsHelpOpen(true)}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        onToggleDiagnostics={() => setIsDiagnosticsOpen((current) => !current)}
        onOpenWorkflowDeepLink={openWorkflowDeepLink}
      />

      {error && (
        <div className="mx-5 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {activeView === 'Home' && (
        <WorkflowHomeView
          workflows={workflows}
          runs={runs}
          failedRuns={failedRuns}
          pendingApprovalRuns={pendingApprovalRuns}
          draft={draft}
          recentWorkflows={recentWorkflows}
          favoriteWorkflows={favoriteWorkflows}
          statusTaxonomy={statusTaxonomy}
          statusTone={statusTone}
          onOpenLibrary={() => setActiveView('Library')}
          onCreateBlankWorkflow={() => selectWorkflow(createBlankWorkflow(selectedProject))}
          onImportPackage={importFromClipboard}
          onOpenRunSetup={() => setIsRunSetupOpen(true)}
          onOpenWorkflow={(workflowId) => openWorkflowDeepLink(workflowId)}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onOpenRuns={() => setActiveView('Runs')}
          onOpenHelp={() => setIsHelpOpen(true)}
        />
      )}

      {activeView === 'Library' && (
        <WorkflowLibraryView
          draft={draft}
          filteredWorkflows={filteredWorkflows}
          selectedWorkflowId={selectedWorkflowId}
          favoriteWorkflowIds={favoriteWorkflowIds}
          libraryFilters={libraryFilters}
          libraryFilter={libraryFilter}
          templateSmokeStatusById={templateSmokeStatusById}
          getTemplateManifest={getTemplateManifest}
          onSelectWorkflow={selectWorkflow}
          onCreateBlankWorkflow={() => selectWorkflow(createBlankWorkflow(selectedProject))}
          onDuplicateWorkflow={duplicateWorkflow}
          onImportPackage={importFromClipboard}
          onSetLibraryFilter={setLibraryFilter}
          onToggleFavoriteWorkflow={toggleFavoriteWorkflow}
          onRunWorkflow={(workflow) => {
            selectWorkflow(workflow);
            setIsRunSetupOpen(true);
          }}
          onCloneWorkflow={cloneWorkflow}
          onSmokeTemplate={smokeTemplate}
        />
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
          <WorkflowNodePalette
            nodeSearch={nodeSearch}
            paletteGroups={paletteGroups}
            filteredNodeTypes={filteredNodeTypes}
            riskyNodeTypes={riskyNodeTypes}
            onNodeSearchChange={setNodeSearch}
            onAddNode={addNode}
          />
          )}

          <main className="min-h-0 overflow-auto p-3" data-testid="workflow-desktop-focus-layout">
            <WorkflowEditorSetupStrip
              isSimpleMode={isSimpleMode}
              isDiagnosticsOpen={isDiagnosticsOpen}
              isBusy={isBusy}
              draft={draft}
              humanNextAction={humanNextAction}
              agentOptions={agentOptions}
              validationMessages={validationMessages}
              dryRunMessages={dryRunMessages}
              missingVariableDiagnostics={missingVariableDiagnostics}
              dryRunPreview={dryRunPreview}
              stringifyValue={stringifyValue}
              onAddAgentStep={() => addNode('agent')}
              onOpenCustomNodeReview={() => setIsCustomNodeReviewOpen(true)}
              onOpenLibrary={() => setActiveView('Library')}
              onUpdateDraft={updateDraft}
              onSaveWorkflow={saveWorkflow}
              onValidateRun={validateRun}
              onExportDraft={exportDraft}
              onSelectMissingVariableDiagnostic={selectMissingVariableDiagnostic}
            />
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
                {selectedNode.type === 'tool' && (
                  <label className="block text-xs font-medium text-muted-foreground">
                    Tool
                    <input value={selectedNode.toolName || ''} onChange={(event) => updateNode(selectedNode.id, { toolName: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground" />
                  </label>
                )}
                {selectedNode.type === 'mcp' && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-muted-foreground">
                      MCP tool
                      <select
                        value={selectedNode.toolName || ''}
                        onChange={(event) => updateNode(selectedNode.id, { toolName: event.target.value })}
                        className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                        data-testid="workflow-mcp-tool-selector"
                      >
                        <option value="">Choose MCP tool...</option>
                        {workflowMcpCatalog.filter((tool) => tool.toolName).map((tool) => (
                          <option key={String(tool.toolName)} value={String(tool.toolName)} disabled={tool.available === false || tool.enabled === false}>
                            {String(tool.label || tool.toolName)}{tool.allowlisted === false ? ' (not allowlisted)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground" data-testid="workflow-mcp-dependency-status">
                      {selectedMcpTool
                        ? `${selectedMcpTool.available === false || selectedMcpTool.enabled === false ? 'Unavailable' : 'Available'} · ${selectedMcpTool.allowlisted === false ? 'not allowlisted' : 'allowlisted or open'}`
                        : 'Select an enabled MCP server.tool before running.'}
                    </div>
                    <div className="space-y-2 rounded-md border border-border bg-white p-2" data-testid="workflow-mcp-argument-form">
                      {selectedMcpArgumentFields.length > 0 ? selectedMcpArgumentFields.map((field: any) => (
                        <label key={String(field.name)} className="block text-xs font-medium text-muted-foreground">
                          {String(field.label || field.name)}{field.required ? ' *' : ''}
                          {field.type === 'json' ? (
                            <textarea
                              value={stringifyValue(selectedNode.config?.[field.name])}
                              onChange={(event) => updateNodeFormMetaValue(selectedNode, String(field.name), event.target.value)}
                              className="mt-1 min-h-16 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                              data-testid="workflow-mcp-argument-field"
                            />
                          ) : (
                            <input
                              type={field.type === 'number' ? 'number' : 'text'}
                              value={String(selectedNode.config?.[field.name] ?? '')}
                              onChange={(event) => updateNodeFormMetaValue(selectedNode, String(field.name), field.type === 'number' ? Number(event.target.value) : event.target.value)}
                              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                              data-testid="workflow-mcp-argument-field"
                            />
                          )}
                        </label>
                      )) : (
                        <div className="text-xs text-muted-foreground">Tool schema will render typed arguments here.</div>
                      )}
                    </div>
                  </div>
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
                    <div className="flex items-center justify-between gap-2">
                      <span className="block text-xs font-semibold text-foreground">Data lineage</span>
                      <span className="rounded border border-border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {lineageFieldRows.length} fields
                      </span>
                    </div>
                    <div className="mt-2 max-h-44 space-y-2 overflow-auto" data-testid="workflow-variable-debugger">
                      {lineageFieldRows.length > 0 ? lineageFieldRows.map((row) => {
                        const copyValue = row.sourceExpression ? `{{${row.sourceExpression}}}` : row.sourcePath;
                        return (
                          <div key={`${row.field}-${row.sourceExpression}-${row.status}`} className="rounded border border-border bg-background px-2 py-2 text-[11px]" data-testid="workflow-variable-debugger-row">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className="block font-semibold text-foreground">{row.field}</span>
                                <span className={cn('mt-1 inline-flex rounded border px-1.5 py-0.5 text-[10px]', row.status === 'missing' ? 'border-red-200 bg-red-50 text-red-700' : row.status === 'resolved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600')}>
                                  {row.status}
                                </span>
                              </div>
                              <button
                                type="button"
                                data-testid="workflow-variable-copy-expression"
                                disabled={!copyValue}
                                className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-40"
                                onClick={() => copyValue && void navigator.clipboard?.writeText(copyValue)}
                              >
                                Copy
                              </button>
                            </div>
                            <div className="mt-2 space-y-1 text-muted-foreground">
                              <div className="font-mono text-[10px] text-foreground">{row.sourceExpression ? `{{${row.sourceExpression}}}` : 'literal value'}</div>
                              {row.sourcePath && <div>Source: {row.sourcePath}</div>}
                              <div>Preview: {row.valuePreview}</div>
                              <div>Segments: {row.segmentCount}</div>
                              {row.errorMessage && <div className="text-red-700">Error: {row.errorMessage}</div>}
                            </div>
                          </div>
                        );
                      }) : (
                        <div className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground">Run dry check to resolve field-level lineage for this node.</div>
                      )}
                    </div>
                    <div className="mt-2 max-h-20 space-y-1 overflow-auto">
                      {dataLineageRows.length > 0 ? dataLineageRows.map((row) => (
                        <div key={row} className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground">{row}</div>
                      )) : null}
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
          <aside className="min-h-0 overflow-auto border-l border-border p-4">
          <WorkflowRunConsole
            selectedRun={selectedRun}
            runStory={runStory}
            selectedRunSnapshotDetails={selectedRunSnapshotDetails}
            selectedRunDefinitionChanged={selectedRunDefinitionChanged}
            selectedRunDefinitionDriftReasons={selectedRunDefinitionDriftReasons}
            previewConsistency={previewConsistency}
            previewChangedNodes={previewChangedNodes}
            activeApprovalNode={activeApprovalNode}
            approvalRequests={approvalRequests}
            approvalRiskExplanation={approvalRiskExplanation}
            approvalRequestedCapabilities={approvalRequestedCapabilities}
            approvalRiskReasons={approvalRiskReasons}
            approvalDiffSummary={approvalDiffSummary}
            effectiveApprovalTimeoutPolicy={effectiveApprovalTimeoutPolicy}
            effectiveApprovalDelegationTargets={effectiveApprovalDelegationTargets}
            approvalDelegationTarget={approvalDelegationTarget}
            setApprovalDelegationTarget={setApprovalDelegationTarget}
            approvalAuditExport={approvalAuditExport}
            onSaveApprovalDelegation={() => saveWorkflowSecurity({ delegation: { ...(workflowSecurity?.delegation || {}), target: approvalDelegationTarget } })}
            onDecideApproval={decideApproval}
            onControlNode={controlNode}
            isBusy={isBusy}
            isSimpleMode={isSimpleMode}
            isRunAdvancedOpen={isRunAdvancedOpen}
            setIsRunAdvancedOpen={setIsRunAdvancedOpen}
            streamingLogRows={streamingLogRows}
            runLogQuery={runLogQuery}
            setRunLogQuery={setRunLogQuery}
            stringifyValue={stringifyValue}
          />
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
            <WorkflowPermissionPanels
              permissionDryRunRows={permissionDryRunRows}
              permissionOverrideRequest={permissionOverrideRequest}
              setPermissionOverrideRequest={setPermissionOverrideRequest}
              createPermissionOverride={createPermissionOverride}
              isBusy={isBusy}
              workflowSecurity={workflowSecurity}
              secretVaultRefs={secretVaultRefs}
              mcpAllowlistRows={mcpAllowlistRows}
              dangerousCommandPolicy={dangerousCommandPolicy}
            />
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
                <div className="rounded border border-border p-2" data-testid="workflow-agent-node-result">
                  <span className="block font-semibold text-foreground">Agent terminal result</span>
                  {agentTerminalRows.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {agentTerminalRows.map((row) => (
                        <div key={row.nodeId} className="rounded border border-border bg-background/70 p-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-foreground">{row.title}</span>
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', statusTone[row.status] || statusTone.pending)}>{row.status}</span>
                          </div>
                          <p className="mt-1 text-foreground">{row.summary}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">Artifacts: {row.artifactCount} · Diff refs: {row.diffRefs.join(', ') || 'none'}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span>No agent or subagent terminal results yet.</span>
                  )}
                </div>
                <div className="rounded border border-border p-2" data-testid="workflow-agent-session-open">
                  <span className="block font-semibold text-foreground">Open agent sessions</span>
                  <span>{agentTerminalRows.map((row) => row.sessionLink || row.sessionId).filter(Boolean).join(' | ') || 'No terminal session links recorded.'}</span>
                </div>
                <div className="rounded border border-border p-2" data-testid="workflow-subagent-streaming-logs">
                  <span className="block font-semibold text-foreground">Subagent streaming logs</span>
                  <span>{agentTerminalRows.filter((row) => row.type === 'subagent').flatMap((row) => row.logs).slice(-4).join(' | ') || 'No subagent stream logs bridged yet.'}</span>
                </div>
                <div className="rounded border border-border p-2" data-testid="workflow-agent-handoff-output">
                  <span className="block font-semibold text-foreground">Agent handoff input</span>
                  <span>{agentTerminalRows.map((row) => `${row.title}: ${row.handoffInput}`).join(' | ') || 'No upstream output has been handed to an agent node yet.'}</span>
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
                <div className="rounded border border-border p-2" data-testid="workflow-package-manifest-summary">{packageManifestSummary}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-package-import-preview">{packageImportPreview}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-package-import-preview-governance">{packageImportPreview}</div>
                <div className="rounded border border-border p-2" data-testid="workflow-package-trust-smoke-state">{packageTrustSmokeState}</div>
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
                <WorkflowArtifactGallery
                  artifacts={artifactGallery}
                  onCopyArtifactReference={copyArtifactReference}
                  onAttachArtifactEvidence={attachArtifactEvidence}
                />
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
                <div className="rounded border border-border p-2" data-testid="workflow-release-quality-gate">{releaseQualityGate}</div>
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
                          {(() => {
                            const runLineageRows = getNodeRunLineageRows(nodeRun);
                            return (
                              <details className="rounded border border-border bg-muted/20 p-2" data-testid="workflow-run-lineage-detail">
                                <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">Variable lineage</summary>
                                <div className="mt-2 max-h-36 space-y-2 overflow-auto">
                                  {runLineageRows.length > 0 ? runLineageRows.map((row) => (
                                    <div key={`${nodeRun.nodeId}-${row.field}-${row.sourceExpression}-${row.status}`} className="rounded border border-border bg-background px-2 py-2 text-[11px]">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold text-foreground">{row.field}</span>
                                        <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', row.status === 'missing' ? 'border-red-200 bg-red-50 text-red-700' : row.status === 'resolved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600')}>
                                          {row.status}
                                        </span>
                                      </div>
                                      <div className="mt-1 font-mono text-[10px] text-foreground">{row.sourceExpression ? `{{${row.sourceExpression}}}` : 'literal value'}</div>
                                      {row.sourcePath && <div className="mt-1 text-muted-foreground">Source: {row.sourcePath}</div>}
                                      <div className="mt-1 text-muted-foreground">Preview: {row.valuePreview}</div>
                                      {row.errorMessage && <div className="mt-1 text-red-700">Error: {row.errorMessage}</div>}
                                    </div>
                                  )) : (
                                    <div className="rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">No lineage snapshot for this node yet.</div>
                                  )}
                                </div>
                              </details>
                            );
                          })()}
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
