import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowNodeTypeDefinition,
} from '../../../types/workflow';
import { createWorkflowNodeRegistry } from './workflowNodeRegistry';

export type WorkflowFlowValue =
  | { kind: 'constant'; value: unknown }
  | { kind: 'ref'; path: string; valueType?: string }
  | { kind: 'template'; segments: WorkflowFlowValueSegment[] };

export type WorkflowFlowValueSegment =
  | { kind: 'text'; text: string }
  | { kind: 'ref'; path: string; valueType?: string };

export type FlowGramDocumentNode = {
  id: string;
  type: WorkflowNodeType;
  meta: {
    title: string;
    description?: string;
    position: { x: number; y: number };
  };
  data: {
    agentId?: string;
    toolName?: string;
    command?: string;
    prompt?: string;
    condition?: string;
    permission?: WorkflowNode['permission'];
    retryLimit?: number;
    timeoutMs?: number;
    config: Record<string, unknown>;
    flowValues: Record<string, WorkflowFlowValue>;
  };
};

export type FlowGramDocumentEdge = {
  id: string;
  sourceNodeID: string;
  targetNodeID: string;
  sourcePortID?: string;
  targetPortID?: string;
  data: {
    mode: NonNullable<WorkflowEdge['mode']>;
    condition?: string;
    routeStyle?: WorkflowEdge['routeStyle'];
  };
};

export type FlowGramDocument = {
  schemaVersion: 'mtl-flowgram-v1';
  id: string;
  name: string;
  description: string;
  profileId: string;
  permissionPreset: string;
  inputs: WorkflowDefinition['inputs'];
  outputs: WorkflowDefinition['outputs'];
  nodes: FlowGramDocumentNode[];
  edges: FlowGramDocumentEdge[];
  maxConcurrency: number;
  metadata: Record<string, unknown>;
  compatibility: {
    source: 'mtl-workflow-definition';
    unknownMetadataKeys: string[];
    warnings: string[];
  };
  createdAt?: string;
  updatedAt?: string;
};

export type WorkflowGraphCompatibilityReport = {
  ok: boolean;
  warnings: string[];
  unsupportedNodeTypes: string[];
  missingNodeDefinitionTypes: string[];
};

const flowFieldNames = ['prompt', 'command', 'condition'] as const;
const templateTokenPattern = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
const knownMetadataKeys = new Set([
  'templateManifest',
  'governance',
  'security',
  'agentBridge',
  'workGraph',
  'flowgram',
]);

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function asText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asPosition(value: unknown) {
  const position = value && typeof value === 'object' ? value as { x?: unknown; y?: unknown } : {};
  return {
    x: typeof position.x === 'number' && Number.isFinite(position.x) ? position.x : 0,
    y: typeof position.y === 'number' && Number.isFinite(position.y) ? position.y : 0,
  };
}

export function parseWorkflowFlowValue(value: unknown): WorkflowFlowValue {
  if (typeof value !== 'string') {
    return { kind: 'constant', value };
  }

  const exactRef = value.match(/^\s*\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}\s*$/);
  if (exactRef) {
    return { kind: 'ref', path: exactRef[1] };
  }

  const segments: WorkflowFlowValueSegment[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(templateTokenPattern)) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', text: value.slice(lastIndex, match.index) });
    }
    segments.push({ kind: 'ref', path: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (segments.length === 0) {
    return { kind: 'constant', value };
  }
  if (lastIndex < value.length) {
    segments.push({ kind: 'text', text: value.slice(lastIndex) });
  }
  return { kind: 'template', segments };
}

export function formatWorkflowFlowValue(value: WorkflowFlowValue | undefined): string {
  if (!value) return '';
  if (value.kind === 'constant') return typeof value.value === 'string' ? value.value : JSON.stringify(value.value ?? '');
  if (value.kind === 'ref') return `{{${value.path}}}`;
  return value.segments.map((segment) => (segment.kind === 'text' ? segment.text : `{{${segment.path}}}`)).join('');
}

function buildFlowValues(node: WorkflowNode) {
  const flowValues: Record<string, WorkflowFlowValue> = {};
  for (const field of flowFieldNames) {
    const value = node[field];
    if (value) flowValues[field] = parseWorkflowFlowValue(value);
  }
  for (const [key, value] of Object.entries(node.config || {})) {
    if (typeof value === 'string' && value.includes('{{')) {
      flowValues[`config.${key}`] = parseWorkflowFlowValue(value);
    }
  }
  return flowValues;
}

function applyFlowValues(node: WorkflowNode, flowValues: Record<string, WorkflowFlowValue>) {
  const next: WorkflowNode = { ...node, config: cloneRecord(node.config) };
  for (const field of flowFieldNames) {
    const value = flowValues[field];
    if (value) {
      next[field] = formatWorkflowFlowValue(value);
    }
  }
  for (const [key, value] of Object.entries(flowValues)) {
    if (!key.startsWith('config.')) continue;
    next.config = {
      ...next.config,
      [key.slice('config.'.length)]: formatWorkflowFlowValue(value),
    };
  }
  return next;
}

export function workflowDefinitionToFlowGramDocument(workflow: WorkflowDefinition): FlowGramDocument {
  const metadata = cloneRecord(workflow.metadata);
  const unknownMetadataKeys = Object.keys(metadata).filter((key) => !knownMetadataKeys.has(key));
  return {
    schemaVersion: 'mtl-flowgram-v1',
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    profileId: workflow.profileId,
    permissionPreset: workflow.permissionPreset,
    inputs: workflow.inputs || [],
    outputs: workflow.outputs || [],
    nodes: (workflow.nodes || []).map((node) => ({
      id: node.id,
      type: node.type,
      meta: {
        title: node.title,
        description: node.description,
        position: asPosition(node.position),
      },
      data: {
        agentId: node.agentId,
        toolName: node.toolName,
        command: node.command,
        prompt: node.prompt,
        condition: node.condition,
        permission: node.permission,
        retryLimit: node.retryLimit,
        timeoutMs: node.timeoutMs,
        config: cloneRecord(node.config),
        flowValues: buildFlowValues(node),
      },
    })),
    edges: (workflow.edges || []).map((edge) => ({
      id: edge.id,
      sourceNodeID: edge.from,
      targetNodeID: edge.to,
      sourcePortID: edge.mode || 'success',
      targetPortID: 'input',
      data: {
        mode: edge.mode || 'success',
        condition: edge.condition,
        routeStyle: edge.routeStyle,
      },
    })),
    maxConcurrency: workflow.maxConcurrency,
    metadata: {
      ...metadata,
      flowgram: {
        ...(cloneRecord(metadata.flowgram)),
        schemaVersion: 'mtl-flowgram-v1',
      },
    },
    compatibility: {
      source: 'mtl-workflow-definition',
      unknownMetadataKeys,
      warnings: unknownMetadataKeys.map((key) => `Preserved unknown metadata key: ${key}`),
    },
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

export function flowGramDocumentToWorkflowDefinition(
  document: FlowGramDocument,
  existing?: Partial<WorkflowDefinition>,
): WorkflowDefinition {
  return {
    id: document.id || existing?.id || 'workflow',
    name: document.name || existing?.name || 'Untitled workflow',
    description: document.description || existing?.description || '',
    profileId: document.profileId || existing?.profileId || 'build',
    permissionPreset: document.permissionPreset || existing?.permissionPreset || 'auto-edit',
    inputs: document.inputs || existing?.inputs || [],
    outputs: document.outputs || existing?.outputs || [],
    nodes: (document.nodes || []).map((node) => applyFlowValues({
      id: node.id,
      type: node.type,
      title: node.meta?.title || node.id,
      description: node.meta?.description || '',
      agentId: node.data?.agentId,
      toolName: node.data?.toolName,
      command: node.data?.command,
      prompt: node.data?.prompt,
      condition: node.data?.condition,
      permission: node.data?.permission || '',
      retryLimit: node.data?.retryLimit,
      timeoutMs: node.data?.timeoutMs,
      config: cloneRecord(node.data?.config),
      position: asPosition(node.meta?.position),
    }, node.data?.flowValues || {})),
    edges: (document.edges || []).map((edge) => ({
      id: edge.id,
      from: edge.sourceNodeID,
      to: edge.targetNodeID,
      mode: edge.data?.mode || 'success',
      condition: edge.data?.condition,
      routeStyle: edge.data?.routeStyle,
    })),
    maxConcurrency: document.maxConcurrency || existing?.maxConcurrency || 4,
    metadata: {
      ...cloneRecord(existing?.metadata),
      ...cloneRecord(document.metadata),
      workGraph: {
        adapter: 'flowgram',
        schemaVersion: document.schemaVersion,
      },
    },
    createdAt: document.createdAt || existing?.createdAt,
    updatedAt: document.updatedAt || existing?.updatedAt,
  };
}

export function analyzeWorkflowGraphCompatibility(
  workflow: WorkflowDefinition,
  definitions: WorkflowNodeTypeDefinition[] = [],
): WorkflowGraphCompatibilityReport {
  const registry = createWorkflowNodeRegistry(definitions);
  const unsupportedNodeTypes = Array.from(new Set(
    (workflow.nodes || [])
      .map((node) => node.type)
      .filter((type) => !registry.byType.has(type)),
  ));
  const missingNodeDefinitionTypes = Array.from(new Set(
    (workflow.nodes || [])
      .filter((node) => !registry.byType.get(node.type)?.configSchema)
      .map((node) => node.type),
  ));
  const warnings = [
    ...unsupportedNodeTypes.map((type) => `Unsupported node type: ${type}`),
    ...missingNodeDefinitionTypes.map((type) => `Missing node definition config schema: ${type}`),
  ];

  const document = workflowDefinitionToFlowGramDocument(workflow);
  warnings.push(...document.compatibility.warnings);

  return {
    ok: unsupportedNodeTypes.length === 0,
    warnings,
    unsupportedNodeTypes,
    missingNodeDefinitionTypes,
  };
}

export function getFlowGramDocumentNodeLabel(node: FlowGramDocumentNode) {
  return asText(node.meta?.title, node.id);
}
