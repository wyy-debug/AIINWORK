import { describe, expect, it } from 'vitest';

import {
  createWorkflowNodeRegistry,
  defaultWorkflowPaletteGroups,
  getRequiredWorkflowNodeFields,
  getWorkflowNodeDefinition,
} from './workflowNodeRegistry';
import {
  buildFlowGramWorkflowNodeRegistries,
  createFlowGramWorkflowNode,
  defaultFlowGramWorkflowNodeMeta,
  flowGramWorkflowNodeTypes,
} from '../view/flowgram/FlowGramWorkflowNodeRegistry';

describe('workflowNodeRegistry', () => {
  it('exposes FlowGram-style node definitions and palette groups', () => {
    const registry = createWorkflowNodeRegistry();

    expect(defaultWorkflowPaletteGroups.map((group) => group.id)).toEqual([
      'agents',
      'integrations',
      'execution',
      'control',
      'outputs',
    ]);
    expect(registry.definitions.map((definition) => definition.type)).toContain('agent');
    expect(registry.definitions.map((definition) => definition.type)).toContain('condition');

    const shell = getWorkflowNodeDefinition(registry, 'shell');
    expect(shell?.permissions).toEqual({ risky: true, action: 'shell.exec' });
    expect(shell?.ports?.outputs).toContain('exitCode');
    expect(getRequiredWorkflowNodeFields(shell).map((field) => field.name)).toContain('command');
  });

  it('merges backend node type overrides without dropping default output schema', () => {
    const registry = createWorkflowNodeRegistry([
      {
        type: 'tool',
        label: 'Built-in Tool',
        description: 'Backend provided label',
        configSchema: { fields: [{ name: 'toolName', label: 'Tool name', type: 'tool', required: true }] },
        ui: { schemaVersion: '2.0' },
      },
    ]);

    const tool = getWorkflowNodeDefinition(registry, 'tool');
    expect(tool?.label).toBe('Built-in Tool');
    expect(tool?.ui?.schemaVersion).toBe('2.0');
    expect(tool?.outputSchema?.fields?.map((field) => field.name)).toContain('artifactId');
  });

  it('provides native FlowGram node registries and onAdd factories for every workflow node type', () => {
    expect(flowGramWorkflowNodeTypes).toEqual([
      'agent',
      'subagent',
      'mcp',
      'tool',
      'shell',
      'approval',
      'condition',
      'join',
      'artifact',
    ]);
    expect(defaultFlowGramWorkflowNodeMeta.defaultPorts).toEqual([
      { type: 'input' },
      { type: 'output' },
    ]);

    const registries = buildFlowGramWorkflowNodeRegistries(createWorkflowNodeRegistry());
    expect(registries.map((registry) => registry.type)).toEqual(flowGramWorkflowNodeTypes);
    expect(registries.every((registry) => typeof registry.onAdd === 'function')).toBe(true);

    const shell = createFlowGramWorkflowNode('shell', {
      nodeCount: 4,
      position: { x: 120, y: 220 },
    });
    expect(shell.type).toBe('shell');
    expect(shell.meta?.position).toEqual({ x: 120, y: 220 });
    expect(shell.data?.workflowNode?.type).toBe('shell');
    expect(shell.data?.workflowNode?.command).toBe('');
    expect(shell.data?.workflowNode?.config).toEqual({});
  });
});
