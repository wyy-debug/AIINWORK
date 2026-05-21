import type { WorkflowDefinition } from '../../../../types/workflow';
import { buildWorkflowFlowGramVariableCatalog } from './FlowGramWorkflowVariableCatalog';

export function buildWorkflowFlowGramVariablePanelState(workflow: WorkflowDefinition, selectedNodeId: string) {
  const variables = selectedNodeId ? buildWorkflowFlowGramVariableCatalog(workflow, selectedNodeId) : [];
  return {
    source: 'workflow-flowgram-variable-panel',
    selectedNodeId,
    variables,
    workflowInputs: (workflow.inputs || []).map((input) => ({
      id: input.id,
      label: input.label || input.id,
      type: input.type || 'text',
      token: `{{inputs.${input.id}}}`,
    })),
  };
}
