import type { WorkflowDefinition, WorkflowNodeTypeDefinition } from '../../../types/workflow';
import {
  analyzeWorkflowGraphCompatibility,
  flowGramDocumentToWorkflowDefinition,
  workflowDefinitionToFlowGramDocument,
} from './workflowGraphAdapter';

export type WorkflowMigrationDoctorFinding = {
  workflowId: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
};

export type WorkflowMigrationDoctorReport = {
  status: 'pass' | 'warning' | 'fail';
  checked: number;
  findings: WorkflowMigrationDoctorFinding[];
};

function sameNodeAndEdgeShape(left: WorkflowDefinition, right: WorkflowDefinition) {
  return left.nodes.length === right.nodes.length
    && left.edges.length === right.edges.length
    && left.nodes.every((node, index) => {
      const other = right.nodes[index];
      return other
        && node.id === other.id
        && node.type === other.type
        && node.title === other.title
        && node.position.x === other.position.x
        && node.position.y === other.position.y;
    })
    && left.edges.every((edge, index) => {
      const other = right.edges[index];
      return other
        && edge.id === other.id
        && edge.from === other.from
        && edge.to === other.to
        && (edge.mode || 'success') === (other.mode || 'success');
    });
}

export function buildWorkflowMigrationDoctorReport(
  workflows: WorkflowDefinition[],
  definitions: WorkflowNodeTypeDefinition[] = [],
): WorkflowMigrationDoctorReport {
  const findings: WorkflowMigrationDoctorFinding[] = [];

  for (const workflow of workflows) {
    const compatibility = analyzeWorkflowGraphCompatibility(workflow, definitions);
    for (const warning of compatibility.warnings) {
      findings.push({
        workflowId: workflow.id,
        severity: compatibility.ok ? 'warning' : 'error',
        message: warning,
      });
    }

    const document = workflowDefinitionToFlowGramDocument(workflow);
    const roundtrip = flowGramDocumentToWorkflowDefinition(document, workflow);
    if (!sameNodeAndEdgeShape(workflow, roundtrip)) {
      findings.push({
        workflowId: workflow.id,
        severity: 'error',
        message: 'Roundtrip changed node or edge shape.',
      });
    }
  }

  const hasError = findings.some((finding) => finding.severity === 'error');
  const hasWarning = findings.some((finding) => finding.severity === 'warning');
  return {
    status: hasError ? 'fail' : hasWarning ? 'warning' : 'pass',
    checked: workflows.length,
    findings,
  };
}
