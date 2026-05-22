import type { WorkflowDefinition, WorkflowNode, WorkflowRun } from '../../../types/workflow';

export type WorkflowHumanHint = {
  title: string;
  body: string;
  actionLabel: string;
};

export type WorkflowReadinessSummaryInput = {
  readinessState?: Record<string, any> | null;
  observabilityState?: Record<string, any> | null;
  releaseReadiness?: Record<string, unknown> | null;
  templateProductState?: Record<string, any> | null;
  draftNodeCount: number;
  streamingLogRowCount: number;
};

export type WorkflowReadinessSummaries = {
  releaseReadinessDetail: string;
  largeGraphPerformance: string;
  virtualizedRunLogs: string;
  offlineReadMode: string;
  importValidationSandbox: string;
  storageBackupRestore: string;
  dataRetentionPolicy: string;
  packageSizeGuard: string;
  releaseSmokeMatrix: string;
  releaseQualityGate: string;
  migrationDoctor: string;
  productionReadinessDashboard: string;
};

function stringifyViewValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'None';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function buildWorkflowHumanNextAction(
  workflow: Pick<WorkflowDefinition, 'nodes'>,
  selectedNode: WorkflowNode | null,
): WorkflowHumanHint {
  if (workflow.nodes.length === 0) {
    return {
      title: 'Start with one step',
      body: 'Add an Agent or Subagent step, then connect approval or artifact only when you need it.',
      actionLabel: 'Add step',
    };
  }
  if (!selectedNode) {
    return {
      title: 'Choose a step to configure',
      body: 'Select a node on the canvas, or run this workflow if the path already looks right.',
      actionLabel: 'Select node',
    };
  }
  if (selectedNode.type === 'shell' || selectedNode.type === 'mcp' || selectedNode.type === 'tool') {
    return {
      title: 'Check risk before running',
      body: 'This step may need permission approval. Run a dry check before starting the workflow.',
      actionLabel: 'Dry check',
    };
  }
  if (selectedNode.type === 'approval') {
    return {
      title: 'Approval step is ready',
      body: 'Use this step to pause risky work and keep a human in control.',
      actionLabel: 'Review approvals',
    };
  }
  return {
    title: `Configure ${selectedNode.title || selectedNode.type}`,
    body: 'Set the minimum fields, then run the workflow or add the next step.',
    actionLabel: 'Configure',
  };
}

export function buildWorkflowRunStory(selectedRun: WorkflowRun | null): WorkflowHumanHint {
  if (!selectedRun) {
    return {
      title: 'No run yet',
      body: 'Start a run from the current workflow to see live progress, approvals, and outputs here.',
      actionLabel: 'Start run',
    };
  }
  const waitingNode = Object.values(selectedRun.nodeRuns || {}).find((nodeRun) => nodeRun.status === 'waiting_approval');
  const failedNode = Object.values(selectedRun.nodeRuns || {}).find((nodeRun) => nodeRun.status === 'failed');
  if (waitingNode) {
    return {
      title: `Waiting for approval: ${waitingNode.title}`,
      body: waitingNode.waitingReason || 'Review the context and continue or reject this node.',
      actionLabel: 'Continue or reject',
    };
  }
  if (failedNode) {
    return {
      title: `Stopped at ${failedNode.title}`,
      body: failedNode.error || 'Inspect the failed node, then retry this node or retry from here.',
      actionLabel: 'Diagnose failure',
    };
  }
  if (selectedRun.status === 'completed') {
    return {
      title: 'Run completed',
      body: `${selectedRun.workflowName} finished. Review artifacts and evidence before closing work.`,
      actionLabel: 'Review outputs',
    };
  }
  return {
    title: `Run is ${selectedRun.status}`,
    body: `${Object.keys(selectedRun.nodeRuns || {}).length} nodes are tracked in this run story.`,
    actionLabel: 'Watch progress',
  };
}

export function buildWorkflowPreviewConsistency(selectedRun: WorkflowRun | null): WorkflowHumanHint {
  if (!selectedRun) {
    return {
      title: 'Preview not checked',
      body: 'Start a run after dry check to compare the reviewed preview with execution inputs.',
      actionLabel: 'No run',
    };
  }
  if (selectedRun.previewChanged || selectedRun.previewDiff?.changed) {
    const reasons = selectedRun.previewDiff?.reasons?.join(', ') || 'execution inputs changed after preview';
    return {
      title: 'Preview changed before execution',
      body: reasons,
      actionLabel: 'Review diff',
    };
  }
  return {
    title: 'Preview matched execution',
    body: 'The reviewed dry-run snapshot matches the inputs used to create this run.',
    actionLabel: 'Matched',
  };
}

export function buildWorkflowReadinessSummaries({
  readinessState,
  observabilityState,
  releaseReadiness,
  templateProductState,
  draftNodeCount,
  streamingLogRowCount,
}: WorkflowReadinessSummaryInput): WorkflowReadinessSummaries {
  const releaseReadinessDetail = observabilityState?.evidenceBundle?.releaseReadiness
    ? stringifyViewValue(observabilityState.evidenceBundle.releaseReadiness).slice(0, 120)
    : releaseReadiness ? stringifyViewValue(releaseReadiness).slice(0, 120) : 'Readiness detail is waiting for the next gate run.';
  const largeGraphPerformance = readinessState?.performance
    ? `${readinessState.performance.nodeCount}/100 nodes, ${readinessState.performance.edgeCount} edges, ${readinessState.performance.status}`
    : `${draftNodeCount}/100 nodes visible; FlowGram keeps canvas interaction stable.`;
  const virtualizedRunLogs = readinessState?.virtualizedLogs
    ? `${readinessState.virtualizedLogs.rows?.length || 0}/${readinessState.virtualizedLogs.total || 0} virtualized log rows loaded`
    : `${streamingLogRowCount} log rows ready for virtualized rendering.`;
  const offlineReadMode = readinessState?.offline
    ? `${readinessState.offline.mode}: ${readinessState.offline.workflows?.length || 0} workflows, ${readinessState.offline.runs?.length || 0} runs`
    : 'Cached workflow and run summaries remain readable when backend is unavailable.';
  const importValidationSandbox = templateProductState?.exportPreview?.sizeGuard
    ? `Import/export sandbox ready; package ${templateProductState.exportPreview.sizeGuard.status}, ${templateProductState.exportPreview.sizeGuard.estimatedBytes} bytes`
    : 'Package imports validate in an isolated preview before writing project data.';
  const storageBackupRestore = readinessState?.production
    ? `Backup includes ${readinessState.production.performance?.length || 0} workflow performance records plus definitions, runs, packages.`
    : 'Backup covers definitions, templates, node packages, run summaries.';
  const dataRetentionPolicy = readinessState?.retention
    ? `Retention: ${readinessState.retention.maxRuns} runs, ${readinessState.retention.maxLogEntriesPerNode} logs/node, ${readinessState.retention.artifactRetentionDays} artifact days`
    : 'Retention controls run logs, artifacts, checkpoints, and evidence expiry.';
  const packageSizeGuard = readinessState?.sizeGuard
    ? `${readinessState.sizeGuard.status}: ${readinessState.sizeGuard.estimatedBytes}/${readinessState.sizeGuard.maxRecommendedBytes} bytes`
    : 'Export/import warns on oversized screenshots, logs, and artifacts.';
  const releaseSmokeMatrix = readinessState?.smokeMatrix
    ? `${readinessState.smokeMatrix.passed}/${readinessState.smokeMatrix.total} release smoke gates passed`
    : 'Release matrix covers dry-run, Python node, approval, artifact, retry, MCP, and Agent/Subagent evidence.';
  const releaseQualityGate = readinessState?.production?.releaseSmokeMatrix
    ? `${readinessState.production.status}: ${readinessState.production.releaseSmokeMatrix.passed}/${readinessState.production.releaseSmokeMatrix.total} gates; evidence manifest produced by npm run workflow:quality-gate`
    : 'Run npm run workflow:quality-gate before release packaging to produce the evidence manifest.';
  const migrationDoctor = readinessState?.migrationDoctor
    ? `${readinessState.migrationDoctor.status}: ${readinessState.migrationDoctor.findings?.length || 0} finding(s)`
    : 'Upgrade doctor checks workflow schema, node packages, templates, and compatibility.';
  const productionReadinessDashboard = readinessState?.production
    ? `${readinessState.production.status}: ${readinessState.production.recentFailures?.length || 0} recent failure(s), ${readinessState.production.security?.length || 0} security report(s)`
    : 'Production readiness combines performance, quality, dependencies, security, template smoke, recent failures.';

  return {
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
  };
}
