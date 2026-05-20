import { describe, expect, it } from 'vitest';

import type { WorkflowDefinition } from '../../../types/workflow';
import {
  analyzeWorkflowGraphCompatibility,
  buildWorkflowFlowReferenceCatalog,
  collectWorkflowFlowValueRefs,
  flowGramDocumentToWorkflowDefinition,
  formatWorkflowFlowValue,
  parseWorkflowFlowValue,
  validateWorkflowFlowReferences,
  workflowDefinitionToFlowGramDocument,
} from './workflowGraphAdapter';

const sampleWorkflow: WorkflowDefinition = {
  id: 'wf-code-review',
  name: 'Code Review',
  description: 'Review a change request.',
  profileId: 'build',
  permissionPreset: 'auto-edit',
  inputs: [{ id: 'change_request', label: 'Change request', type: 'textarea', required: true }],
  outputs: [{ id: 'summary', label: 'Summary', type: 'markdown' }],
  nodes: [
    {
      id: 'explore',
      type: 'subagent',
      title: 'Explore',
      description: 'Read code',
      agentId: 'explore',
      prompt: 'Inspect {{inputs.change_request}}',
      permission: '',
      retryLimit: 1,
      timeoutMs: 120000,
      config: { note: 'Context {{inputs.change_request}}' },
      position: { x: 120, y: 160 },
    },
    {
      id: 'review',
      type: 'agent',
      title: 'Review',
      description: 'Review findings',
      agentId: 'review',
      prompt: '{{nodes.explore.output.summary}}',
      permission: '',
      retryLimit: 0,
      timeoutMs: 120000,
      config: {},
      position: { x: 440, y: 160 },
    },
  ],
  edges: [{ id: 'edge-explore-review', from: 'explore', to: 'review', mode: 'success', routeStyle: 'smoothstep' }],
  maxConcurrency: 2,
  metadata: {
    templateManifest: { version: '1.0.0' },
    customLegacyFlag: true,
  },
  createdAt: '2026-05-20T00:00:00.000Z',
  updatedAt: '2026-05-20T00:00:00.000Z',
};

describe('workflowGraphAdapter', () => {
  it('parses and formats constant, ref, and template flow values', () => {
    expect(parseWorkflowFlowValue('plain text')).toEqual({ kind: 'constant', value: 'plain text' });
    expect(parseWorkflowFlowValue('{{inputs.change_request}}')).toEqual({ kind: 'ref', path: 'inputs.change_request' });

    const template = parseWorkflowFlowValue('Review {{nodes.explore.output.summary}} for {{inputs.change_request}}');
    expect(template.kind).toBe('template');
    expect(collectWorkflowFlowValueRefs(template)).toEqual(['nodes.explore.output.summary', 'inputs.change_request']);
    expect(formatWorkflowFlowValue(template)).toBe('Review {{nodes.explore.output.summary}} for {{inputs.change_request}}');
  });

  it('roundtrips WorkflowDefinition through a FlowGram-style document without losing fields', () => {
    const document = workflowDefinitionToFlowGramDocument(sampleWorkflow);

    expect(document.schemaVersion).toBe('mtl-flowgram-v1');
    expect(document.nodes[0].meta.position).toEqual({ x: 120, y: 160 });
    expect(document.nodes[0].data.flowValues.prompt).toEqual({
      kind: 'template',
      segments: [
        { kind: 'text', text: 'Inspect ' },
        { kind: 'ref', path: 'inputs.change_request' },
      ],
    });
    expect(document.edges[0]).toMatchObject({
      sourceNodeID: 'explore',
      targetNodeID: 'review',
      data: { mode: 'success', routeStyle: 'smoothstep' },
    });
    expect(document.compatibility.unknownMetadataKeys).toEqual(['customLegacyFlag']);

    const roundtrip = flowGramDocumentToWorkflowDefinition(document);
    expect(roundtrip.nodes).toEqual(sampleWorkflow.nodes);
    expect(roundtrip.edges).toEqual(sampleWorkflow.edges);
    expect(roundtrip.metadata?.customLegacyFlag).toBe(true);
    expect(roundtrip.metadata?.workGraph).toEqual({ adapter: 'flowgram', schemaVersion: 'mtl-flowgram-v1' });
  });

  it('reports migration compatibility warnings while preserving loadability', () => {
    const report = analyzeWorkflowGraphCompatibility(sampleWorkflow);

    expect(report.ok).toBe(true);
    expect(report.unsupportedNodeTypes).toEqual([]);
    expect(report.warnings).toContain('Preserved unknown metadata key: customLegacyFlag');
  });

  it('builds typed reference catalog and validates missing refs for a selected node', () => {
    const catalog = buildWorkflowFlowReferenceCatalog(sampleWorkflow, 'review', [], {
      change_request: 'fix the issue',
    });

    expect(catalog.map((ref) => [ref.path, ref.source, ref.valueType])).toContainEqual([
      'inputs.change_request',
      'workflow-input',
      'textarea',
    ]);
    expect(catalog.map((ref) => ref.path)).toContain('nodes.explore.output.summary');
    expect(validateWorkflowFlowReferences(sampleWorkflow, 'review').valid).toBe(true);

    const invalidWorkflow: WorkflowDefinition = {
      ...sampleWorkflow,
      nodes: sampleWorkflow.nodes.map((node) => (
        node.id === 'review'
          ? { ...node, prompt: '{{nodes.missing.output.summary}}' }
          : node
      )),
    };
    expect(validateWorkflowFlowReferences(invalidWorkflow, 'review')).toEqual({
      valid: false,
      missing: [{ nodeId: 'review', field: 'prompt', path: 'nodes.missing.output.summary' }],
    });
  });
});
