import type { WorkflowNodeType, WorkflowNodeTypeDefinition } from '../../../types/workflow';

export type WorkflowPaletteGroupDefinition = {
  id: string;
  label: string;
  types: WorkflowNodeType[];
};

export type WorkflowNodeRegistry = {
  definitions: WorkflowNodeTypeDefinition[];
  groups: WorkflowPaletteGroupDefinition[];
  byType: Map<WorkflowNodeType, WorkflowNodeTypeDefinition>;
};

export const defaultWorkflowPaletteGroups: WorkflowPaletteGroupDefinition[] = [
  { id: 'agents', label: 'Agents', types: ['agent', 'subagent'] },
  { id: 'integrations', label: 'Integrations', types: ['mcp', 'tool'] },
  { id: 'execution', label: 'Execution', types: ['shell', 'approval'] },
  { id: 'control', label: 'Control Flow', types: ['condition', 'join'] },
  { id: 'outputs', label: 'Outputs', types: ['artifact'] },
];

export const defaultWorkflowNodeTypeDefinitions: WorkflowNodeTypeDefinition[] = [
  {
    type: 'agent',
    label: 'Agent',
    description: 'Run a primary agent step with the selected profile context.',
    ports: { inputs: ['context'], outputs: ['summary', 'artifacts', 'diffRefs', 'status'] },
    configSchema: {
      fields: [
        { name: 'agentId', label: 'Agent profile', type: 'agent', required: true },
        { name: 'prompt', label: 'Prompt', type: 'template', required: true },
      ],
    },
    outputSchema: {
      fields: [
        { name: 'summary', type: 'markdown', label: 'Summary' },
        { name: 'artifacts', type: 'artifact[]', label: 'Artifacts' },
        { name: 'diffRefs', type: 'diff[]', label: 'Diff refs' },
        { name: 'status', type: 'status', label: 'Status' },
      ],
    },
    ui: { schemaVersion: '1.0', materialGroup: 'agents' },
  },
  {
    type: 'subagent',
    label: 'Subagent',
    description: 'Run a focused subagent and return a terminal result.',
    ports: { inputs: ['task'], outputs: ['summary', 'artifacts', 'status'] },
    configSchema: {
      fields: [
        { name: 'agentId', label: 'Subagent', type: 'subagent', required: true },
        { name: 'prompt', label: 'Task prompt', type: 'template', required: true },
      ],
    },
    outputSchema: {
      fields: [
        { name: 'summary', type: 'markdown', label: 'Summary' },
        { name: 'artifacts', type: 'artifact[]', label: 'Artifacts' },
        { name: 'status', type: 'status', label: 'Status' },
      ],
    },
    ui: { schemaVersion: '1.0', materialGroup: 'agents' },
  },
  {
    type: 'mcp',
    label: 'MCP',
    description: 'Call an enabled MCP server tool with schema-driven arguments.',
    ports: { inputs: ['arguments'], outputs: ['result', 'status'] },
    permissions: { risky: true, action: 'mcp.call' },
    configSchema: {
      fields: [
        { name: 'toolName', label: 'MCP tool', type: 'mcp-tool', required: true },
        { name: 'arguments', label: 'Arguments', type: 'json' },
      ],
    },
    outputSchema: {
      fields: [
        { name: 'result', type: 'json', label: 'Result' },
        { name: 'status', type: 'status', label: 'Status' },
      ],
    },
    ui: { schemaVersion: '1.0', materialGroup: 'integrations' },
  },
  {
    type: 'tool',
    label: 'Tool',
    description: 'Run a built-in workflow tool such as Git Review or Artifact.',
    ports: { inputs: ['input'], outputs: ['summary', 'artifactId', 'status'] },
    permissions: { risky: true, action: 'tool.call' },
    configSchema: {
      fields: [
        { name: 'toolName', label: 'Tool', type: 'tool', required: true },
        { name: 'input', label: 'Input', type: 'template' },
      ],
    },
    outputSchema: {
      fields: [
        { name: 'summary', type: 'markdown', label: 'Summary' },
        { name: 'artifactId', type: 'string', label: 'Artifact ID' },
        { name: 'status', type: 'status', label: 'Status' },
      ],
    },
    ui: { schemaVersion: '1.0', materialGroup: 'integrations' },
  },
  {
    type: 'shell',
    label: 'Shell',
    description: 'Run a shell command through the workflow permission gate.',
    ports: { inputs: ['command'], outputs: ['stdout', 'stderr', 'exitCode', 'status'] },
    permissions: { risky: true, action: 'shell.exec' },
    configSchema: {
      fields: [
        { name: 'command', label: 'Command', type: 'template', required: true },
        { name: 'cwd', label: 'Working directory', type: 'path' },
        { name: 'timeoutMs', label: 'Timeout', type: 'number', defaultValue: 120000 },
      ],
    },
    outputSchema: {
      fields: [
        { name: 'stdout', type: 'string', label: 'stdout' },
        { name: 'stderr', type: 'string', label: 'stderr' },
        { name: 'exitCode', type: 'number', label: 'Exit code' },
        { name: 'status', type: 'status', label: 'Status' },
      ],
    },
    ui: { schemaVersion: '1.0', materialGroup: 'execution' },
  },
  {
    type: 'approval',
    label: 'Approval',
    description: 'Pause execution until a human approves or rejects the step.',
    ports: { inputs: ['context'], outputs: ['decision', 'status'] },
    configSchema: {
      fields: [
        { name: 'prompt', label: 'Approval prompt', type: 'template', required: true },
        { name: 'riskLevel', label: 'Risk level', type: 'select', options: ['low', 'medium', 'high'] },
      ],
    },
    outputSchema: {
      fields: [
        { name: 'decision', type: 'string', label: 'Decision' },
        { name: 'status', type: 'status', label: 'Status' },
      ],
    },
    ui: { schemaVersion: '1.0', materialGroup: 'execution' },
  },
  {
    type: 'condition',
    label: 'Condition',
    description: 'Route execution based on a typed expression.',
    ports: { inputs: ['input'], outputs: ['success', 'failure'] },
    configSchema: {
      fields: [
        { name: 'condition', label: 'Condition', type: 'expression', required: true },
      ],
    },
    outputSchema: {
      fields: [
        { name: 'matched', type: 'boolean', label: 'Matched' },
        { name: 'status', type: 'status', label: 'Status' },
      ],
    },
    ui: { schemaVersion: '1.0', materialGroup: 'control' },
  },
  {
    type: 'join',
    label: 'Join',
    description: 'Wait for multiple upstream branches before continuing.',
    ports: { inputs: ['branches'], outputs: ['merged', 'status'] },
    configSchema: { fields: [] },
    outputSchema: {
      fields: [
        { name: 'merged', type: 'json', label: 'Merged upstream outputs' },
        { name: 'status', type: 'status', label: 'Status' },
      ],
    },
    ui: { schemaVersion: '1.0', materialGroup: 'control' },
  },
  {
    type: 'artifact',
    label: 'Artifact',
    description: 'Create or collect a workflow artifact from upstream output.',
    ports: { inputs: ['content'], outputs: ['artifactId', 'summary', 'status'] },
    configSchema: {
      fields: [
        { name: 'prompt', label: 'Artifact content', type: 'template', required: true },
      ],
    },
    outputSchema: {
      fields: [
        { name: 'artifactId', type: 'string', label: 'Artifact ID' },
        { name: 'summary', type: 'markdown', label: 'Summary' },
        { name: 'status', type: 'status', label: 'Status' },
      ],
    },
    ui: { schemaVersion: '1.0', materialGroup: 'outputs' },
  },
];

export function createWorkflowNodeRegistry(
  overrides: WorkflowNodeTypeDefinition[] = [],
  groups: WorkflowPaletteGroupDefinition[] = defaultWorkflowPaletteGroups,
): WorkflowNodeRegistry {
  const merged = new Map<WorkflowNodeType, WorkflowNodeTypeDefinition>();
  for (const definition of defaultWorkflowNodeTypeDefinitions) {
    merged.set(definition.type, definition);
  }
  for (const override of overrides) {
    const existing = merged.get(override.type);
    merged.set(override.type, {
      ...existing,
      ...override,
      ports: { ...existing?.ports, ...override.ports },
      configSchema: {
        fields: override.configSchema?.fields || existing?.configSchema?.fields || [],
      },
      outputSchema: {
        fields: override.outputSchema?.fields || existing?.outputSchema?.fields || [],
      },
      ui: { ...existing?.ui, ...override.ui },
      layout: { ...existing?.layout, ...override.layout },
      permissions: { ...existing?.permissions, ...override.permissions },
    });
  }
  const definitions = Array.from(merged.values());
  return {
    definitions,
    groups,
    byType: new Map(definitions.map((definition) => [definition.type, definition])),
  };
}

export function getWorkflowNodeDefinition(
  registry: WorkflowNodeRegistry,
  type: WorkflowNodeType,
) {
  return registry.byType.get(type) || null;
}

export function getRequiredWorkflowNodeFields(definition: WorkflowNodeTypeDefinition | null) {
  return (definition?.configSchema?.fields || []).filter((field) => field.required);
}
