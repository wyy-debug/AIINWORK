import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowNodeTypeDefinition,
} from '../../../types/workflow';
import type { WorkflowJSON } from '@flowgram.ai/free-layout-editor';
import { createWorkflowNodeRegistry } from './workflowNodeRegistry';

export type WorkflowFlowReference = {
  path: string;
  source: 'workflow-input' | 'upstream-node-output';
  valueType: string;
  label: string;
  example: unknown;
  nodeId?: string;
  fieldName?: string;
};

export type WorkflowFlowReferenceValidation = {
  valid: boolean;
  missing: Array<{ nodeId: string; field: string; path: string }>;
};

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

export function collectWorkflowFlowValueRefs(value: WorkflowFlowValue | undefined): string[] {
  if (!value) return [];
  if (value.kind === 'ref') return [value.path];
  if (value.kind === 'template') {
    return value.segments.flatMap((segment) => (segment.kind === 'ref' ? [segment.path] : []));
  }
  return [];
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

export function buildWorkflowFlowReferenceCatalog(
  workflow: WorkflowDefinition,
  nodeId: string,
  definitions: WorkflowNodeTypeDefinition[] = [],
  inputExamples: Record<string, unknown> = {},
): WorkflowFlowReference[] {
  const registry = createWorkflowNodeRegistry(definitions);
  const inputRefs: WorkflowFlowReference[] = (workflow.inputs || []).map((input) => ({
    path: `inputs.${input.id}`,
    source: 'workflow-input',
    valueType: input.type || 'string',
    label: input.label || input.id,
    example: inputExamples[input.id] ?? input.defaultValue ?? 'user input',
    fieldName: input.id,
  }));
  const upstreamIds = (workflow.edges || [])
    .filter((edge) => edge.to === nodeId)
    .map((edge) => edge.from);
  const upstreamRefs = upstreamIds.flatMap((upstreamId) => {
    const upstreamNode = workflow.nodes.find((node) => node.id === upstreamId);
    if (!upstreamNode) return [];
    const definition = registry.byType.get(upstreamNode.type);
    const fields = definition?.outputSchema?.fields?.length
      ? definition.outputSchema.fields
      : [
        { name: 'summary', type: 'markdown', label: 'Summary' },
        { name: 'artifactId', type: 'string', label: 'Artifact ID' },
        { name: 'stdout', type: 'string', label: 'stdout' },
      ];
    return fields.map((field) => ({
      path: `nodes.${upstreamId}.output.${field.name}`,
      source: 'upstream-node-output' as const,
      valueType: field.type || 'string',
      label: `${upstreamNode.title || upstreamId} / ${field.label || field.name}`,
      example: field.type === 'markdown' ? 'completed summary' : field.name === 'exitCode' ? 0 : 'completed output',
      nodeId: upstreamId,
      fieldName: field.name,
    }));
  });
  return [...inputRefs, ...upstreamRefs];
}

export function validateWorkflowFlowReferences(
  workflow: WorkflowDefinition,
  nodeId: string,
  definitions: WorkflowNodeTypeDefinition[] = [],
): WorkflowFlowReferenceValidation {
  const node = workflow.nodes.find((item) => item.id === nodeId);
  if (!node) return { valid: false, missing: [{ nodeId, field: 'node', path: nodeId }] };
  const available = new Set(buildWorkflowFlowReferenceCatalog(workflow, nodeId, definitions).map((ref) => ref.path));
  const flowValues = buildFlowValues(node);
  const missing = Object.entries(flowValues).flatMap(([field, value]) => (
    collectWorkflowFlowValueRefs(value)
      .filter((path) => !available.has(path))
      .map((path) => ({ nodeId, field, path }))
  ));
  return { valid: missing.length === 0, missing };
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

export function workflowDefinitionToFlowGramWorkflowJSON(workflow: WorkflowDefinition): WorkflowJSON {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      meta: {
        position: asPosition(node.position),
        defaultExpanded: true,
        size: { width: 250, height: 112 },
        defaultPorts: [
          { type: 'input' },
          { type: 'output' },
        ],
      },
      data: {
        title: node.title || node.type,
        description: node.description || '',
        workflowNode: node,
        runtime: {
          permission: node.permission,
          retryLimit: node.retryLimit,
          timeoutMs: node.timeoutMs,
        },
        config: cloneRecord(node.config),
        flowValues: buildFlowValues(node),
      },
    })),
    edges: workflow.edges.map((edge) => ({
      sourceNodeID: edge.from,
      targetNodeID: edge.to,
      data: {
        id: edge.id,
        mode: edge.mode || 'success',
        condition: edge.condition,
        routeStyle: edge.routeStyle,
      },
    })),
  };
}

export function flowGramWorkflowJSONToWorkflowDefinition(
  workflow: WorkflowDefinition,
  json: WorkflowJSON,
): WorkflowDefinition {
  const baseNodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const nextNodes = (json.nodes || []).map((node) => {
    const base = baseNodes.get(node.id);
    const workflowNode = node.data?.workflowNode && typeof node.data.workflowNode === 'object'
      ? node.data.workflowNode as WorkflowNode
      : undefined;
    const source = base || workflowNode;
    if (!source) return undefined;
    return applyFlowValues({
      ...source,
      title: asText(node.data?.title, source.title),
      description: asText(node.data?.description, source.description),
      position: asPosition(node.meta?.position || source.position),
      config: {
        ...cloneRecord(source.config),
        ...cloneRecord(node.data?.config),
      },
    } satisfies WorkflowNode, cloneRecord(node.data?.flowValues) as Record<string, WorkflowFlowValue>);
  }).filter(Boolean) as WorkflowNode[];

  return {
    ...workflow,
    nodes: nextNodes.length > 0 ? nextNodes : workflow.nodes,
    edges: (json.edges || []).map((edge, index) => ({
      id: asText(edge.data?.id, `${edge.sourceNodeID}-${edge.targetNodeID}-${index}`),
      from: edge.sourceNodeID,
      to: edge.targetNodeID,
      mode: edge.data?.mode || 'success',
      condition: asText(edge.data?.condition),
      routeStyle: edge.data?.routeStyle,
    })),
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
