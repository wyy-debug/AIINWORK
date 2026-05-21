import type { WorkflowJSON, WorkflowNodeRegistry } from '@flowgram.ai/free-layout-editor';

import type { WorkflowDefinition, WorkflowNodeType } from '../../../../types/workflow';
import type { WorkflowNodeRegistry as MtlWorkflowNodeRegistry } from '../../model/workflowNodeRegistry';
import { workflowNodeFormMeta } from './FlowGramWorkflowFormMeta';

type WorkflowNode = WorkflowDefinition['nodes'][number];
type FlowGramWorkflowNodeJSON = WorkflowJSON['nodes'][number];

export type FlowGramWorkflowNodeRegistry = WorkflowNodeRegistry & {
  onAdd: (params?: { nodeCount?: number; position?: { x: number; y: number } }) => FlowGramWorkflowNodeJSON;
};

export const flowGramWorkflowNodeTypes: WorkflowNodeType[] = [
  'agent',
  'subagent',
  'mcp',
  'tool',
  'shell',
  'approval',
  'condition',
  'join',
  'artifact',
];

export const defaultFlowGramWorkflowNodeMeta = {
  defaultExpanded: true,
  size: { width: 250, height: 112 },
  defaultPorts: [
    { type: 'input' },
    { type: 'output' },
  ],
} satisfies NonNullable<WorkflowNodeRegistry['meta']>;

function makeNodeId(type: WorkflowNodeType, nodeCount = 0) {
  return `workflow-${type}-${nodeCount + 1}`;
}

function defaultNodeTitle(type: WorkflowNodeType) {
  return type === 'mcp'
    ? 'MCP Tool'
    : type.split('-').map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ');
}

function nodeTitle(type: WorkflowNodeType, registry?: MtlWorkflowNodeRegistry) {
  return registry?.byType.get(type)?.label || defaultNodeTitle(type);
}

function configDefaults(type: WorkflowNodeType, registry?: MtlWorkflowNodeRegistry) {
  const definition = registry?.byType.get(type);
  return Object.fromEntries((definition?.configSchema?.fields || [])
    .filter((field) => field.defaultValue !== undefined)
    .map((field) => [field.name, field.defaultValue]));
}

export function createFlowGramWorkflowNode(
  type: WorkflowNodeType,
  options: {
    nodeCount?: number;
    position?: { x: number; y: number };
    registry?: MtlWorkflowNodeRegistry;
  } = {},
): FlowGramWorkflowNodeJSON {
  const id = makeNodeId(type, options.nodeCount || 0);
  const position = options.position || { x: 180 + (options.nodeCount || 0) * 80, y: 180 };
  const defaults = configDefaults(type, options.registry);
  const workflowNode: WorkflowNode = {
    id,
    type,
    title: nodeTitle(type, options.registry),
    description: options.registry?.byType.get(type)?.description || '',
    agentId: '',
    toolName: '',
    command: '',
    prompt: '',
    condition: '',
    permission: '',
    retryLimit: 0,
    timeoutMs: 120000,
    config: defaults,
    position,
  };

  return {
    id,
    type,
    meta: {
      ...defaultFlowGramWorkflowNodeMeta,
      position,
    },
    data: {
      title: workflowNode.title,
      description: workflowNode.description,
      workflowNode,
      runtime: {
        permission: workflowNode.permission,
        retryLimit: workflowNode.retryLimit,
        timeoutMs: workflowNode.timeoutMs,
      },
      config: defaults,
      flowValues: {},
    },
  };
}

export function buildFlowGramWorkflowNodeRegistries(
  registry?: MtlWorkflowNodeRegistry,
): FlowGramWorkflowNodeRegistry[] {
  const nodeTypes = registry?.definitions?.length
    ? registry.definitions.map((definition) => definition.type)
    : flowGramWorkflowNodeTypes;

  return nodeTypes.map((type) => ({
    type,
    meta: defaultFlowGramWorkflowNodeMeta,
    formMeta: workflowNodeFormMeta,
    onAdd: (params) => createFlowGramWorkflowNode(type, {
      registry,
      nodeCount: params?.nodeCount,
      position: params?.position,
    }),
  }));
}

export function getFlowGramWorkflowNodeDefaultRegistry(type: string, registry?: MtlWorkflowNodeRegistry): FlowGramWorkflowNodeRegistry {
  const requestedType = type as WorkflowNodeType;
  const normalizedType = registry?.byType.has(requestedType) || flowGramWorkflowNodeTypes.includes(requestedType)
    ? requestedType
    : 'tool';
  return {
    type,
    meta: defaultFlowGramWorkflowNodeMeta,
    formMeta: workflowNodeFormMeta,
    onAdd: (params) => createFlowGramWorkflowNode(normalizedType, {
      registry,
      nodeCount: params?.nodeCount,
      position: params?.position,
    }),
  };
}
