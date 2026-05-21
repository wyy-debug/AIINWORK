import type { WorkflowDefinition } from '../../../../types/workflow';
import {
  buildWorkflowFlowReferenceCatalog,
  type WorkflowFlowReference,
} from '../../model/workflowGraphAdapter';
import type { WorkflowFlowGramVariableCatalog } from './FlowGramWorkflowTypes';

export function buildWorkflowFlowGramVariableCatalog(
  workflow: WorkflowDefinition,
  nodeId: string,
  runInputs: Record<string, unknown> = {},
): WorkflowFlowGramVariableCatalog[] {
  return buildWorkflowFlowReferenceCatalog(workflow, nodeId, [], runInputs).map((variable: WorkflowFlowReference) => ({
    ...variable,
    token: `{{${variable.path}}}`,
  }));
}
