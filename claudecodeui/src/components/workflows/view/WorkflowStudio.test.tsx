import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

function readFlowGramNativeSource() {
  return [
    'WorkflowFlowGramEditor.tsx',
    'flowgram/FlowGramWorkflowEditorShell.tsx',
    'flowgram/FlowGramWorkflowNodeRegistry.tsx',
    'flowgram/FlowGramWorkflowFormMeta.tsx',
    'flowgram/FlowGramWorkflowVariableCatalog.ts',
    'flowgram/FlowGramWorkflowVariablePanelAdapter.ts',
    'flowgram/FlowGramRuntimeVisualBridge.ts',
    'flowgram/FlowGramWorkflowNodeRenderer.tsx',
    'flowgram/FlowGramWorkflowEditorProps.tsx',
    'flowgram/FlowGramWorkflowMaterials.tsx',
    'flowgram/FlowGramWorkflowLineGuards.ts',
    'flowgram/FlowGramWorkflowVisualConfig.ts',
    'flowgram/FlowGramWorkflowShortcuts.ts',
    'flowgram/FlowGramWorkflowOperations.tsx',
  ].map((file) => readFileSync(resolve(currentDir, file), 'utf8')).join('\n');
}

describe('WorkflowStudio source contract', () => {
  it('keeps FlowGram code-level parity logic in dedicated native modules', () => {
    const studioSource = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8');
    const compatibilityWrapperSource = readFileSync(resolve(currentDir, 'WorkflowFlowGramEditor.tsx'), 'utf8');
    const shellSource = readFileSync(resolve(currentDir, 'flowgram/FlowGramWorkflowEditorShell.tsx'), 'utf8');
    const editorPropsSource = readFileSync(resolve(currentDir, 'flowgram/FlowGramWorkflowEditorProps.tsx'), 'utf8');
    const materialsSource = readFileSync(resolve(currentDir, 'flowgram/FlowGramWorkflowMaterials.tsx'), 'utf8');
    const operationsSource = readFileSync(resolve(currentDir, 'flowgram/FlowGramWorkflowOperations.tsx'), 'utf8');
    const registrySource = readFileSync(resolve(currentDir, 'flowgram/FlowGramWorkflowNodeRegistry.tsx'), 'utf8');
    const formMetaSource = readFileSync(resolve(currentDir, 'flowgram/FlowGramWorkflowFormMeta.tsx'), 'utf8');
    const variableSource = readFileSync(resolve(currentDir, 'flowgram/FlowGramWorkflowVariableCatalog.ts'), 'utf8');
    const runtimeBridgeSource = readFileSync(resolve(currentDir, 'flowgram/FlowGramRuntimeVisualBridge.ts'), 'utf8');

    expect(compatibilityWrapperSource).toContain('FlowGramWorkflowEditorShell');
    expect(compatibilityWrapperSource).not.toContain('function buildNodeRegistries');
    expect(compatibilityWrapperSource).not.toContain('function FlowGramLineInsertButton');
    expect(compatibilityWrapperSource).not.toContain('const workflowNodeFormMeta');

    expect(shellSource).toContain('FreeLayoutEditor');
    expect(shellSource).toContain('useWorkflowFlowGramEditorProps');
    expect(shellSource).not.toContain('useMemo<FreeLayoutProps>');
    expect(shellSource).not.toContain('function FlowGramLineInsertButton');
    expect(shellSource).not.toContain('function FlowGramNodePanel');
    expect(editorPropsSource).toContain('useWorkflowFlowGramEditorProps');
    expect(editorPropsSource).toContain('createFreeLinesPlugin');
    expect(editorPropsSource).toContain('createFreeNodePanelPlugin');
    expect(editorPropsSource).toContain('buildFlowGramWorkflowNodeRegistries');
    expect(editorPropsSource).toContain('createFlowGramWorkflowNode');
    expect(editorPropsSource).toContain('buildFlowGramRuntimeVisualState');
    expect(editorPropsSource).toContain('canAddWorkflowLine');
    expect(editorPropsSource).toContain('workflowFlowGramI18n');
    expect(editorPropsSource).toContain('workflowFlowGramShortcuts');
    expect(editorPropsSource).toContain('workflowFlowGramSelectBox');
    expect(materialsSource).toContain('FlowGramLineInsertButton');
    expect(materialsSource).toContain('FlowGramNodePanel');
    expect(operationsSource).toContain('FlowGramOperationToolbar');
    expect(operationsSource).toContain('FlowGramSelectionOperationPanel');
    expect(operationsSource).toContain('data-testid="workflow-flowgram-operation-toolbar"');
    expect(operationsSource).toContain('data-testid="workflow-selection-helper"');
    expect(operationsSource).toContain('data-testid="workflow-flowgram-primary-actions"');
    expect(operationsSource).toContain('data-testid="workflow-flowgram-more-actions"');
    expect(operationsSource).toContain('data-testid="workflow-flowgram-operation-toolbar"');
    expect(operationsSource).toContain('isMoreOpen');
    expect(operationsSource).toContain('No node selected');
    expect(operationsSource).toContain('Node selected');
    expect(operationsSource).not.toContain('Ctrl/Cmd D duplicate');
    expect(operationsSource).not.toContain('Ctrl/Cmd 0 fit');

    expect(registrySource).toContain('flowGramWorkflowNodeTypes');
    expect(registrySource).toContain('onAdd');
    expect(registrySource).toContain('defaultFlowGramWorkflowNodeMeta');
    expect(formMetaSource).toContain('validateTrigger');
    expect(formMetaSource).toContain('formatOnSubmit');
    expect(variableSource).toContain('buildWorkflowFlowGramVariableCatalog');
    expect(runtimeBridgeSource).toContain('setLineClassName');

    expect(studioSource).not.toContain('const [historyPast');
    expect(studioSource).not.toContain('const [historyFuture');
    expect(studioSource).not.toContain('const insertNodeOnEdge');
    expect(studioSource).not.toContain('historyPast.length > 0 || Boolean(flowGramEditorRef.current?.canUndo())');
  });

  it('keeps FlowGram MIT attribution visible for code-level architecture replication', () => {
    const notice = readFileSync(resolve(currentDir, '../../../../NOTICE'), 'utf8');

    expect(notice).toContain('FlowGram.AI');
    expect(notice).toContain('https://github.com/bytedance/flowgram.ai');
    expect(notice).toContain('licensed under the MIT License');
  });

  it('records the FlowGram parity audit as a closeable engineering artifact', () => {
    const audit = readFileSync(resolve(currentDir, '../../../../docs/workflow-flowgram-parity-audit.md'), 'utf8');

    expect(audit).toContain('REQ-197');
    expect(audit).toContain('FlowGram native');
    expect(audit).toContain('MTL runtime');
    expect(audit).toContain('WorkflowFlowGramEditor.tsx is a compatibility wrapper');
  });

  it('keeps the FlowGram migration clean and native-first', () => {
    const studioSource = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8');
    const flowGramSource = readFlowGramNativeSource();
    const packageJson = readFileSync(resolve(currentDir, '../../../../package.json'), 'utf8');

    expect(studioSource).not.toContain("from '@xyflow" + "/react'");
    expect(studioSource).not.toContain("'@xyflow" + "/react/dist/style.css'");
    expect(studioSource).not.toContain('<React' + 'Flow');
    expect(studioSource).not.toContain('workflow-react' + '-flow-canvas');
    expect(packageJson).not.toContain('"@xyflow' + '/react"');

    expect(studioSource).toContain("lazy(() => import('./WorkflowFlowGramEditor'))");
    expect(flowGramSource).toContain('createFreeNodePanelPlugin');
    expect(flowGramSource).toContain('createFreeNodePanelPlugin({');
    expect(flowGramSource).toContain('nodeEngine: {');
    expect(flowGramSource).toContain('enable: true');
    expect(flowGramSource).toContain('variableEngine: {');
    expect(flowGramSource).toContain('getNodeDefaultRegistry');
    expect(flowGramSource).toContain('formMeta');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-runtime-boundary"');
    expect(flowGramSource).not.toContain('createRuntimePlugin');
  });

  it('uses FlowGram-native form, variable, line insertion, history, runtime state, and route loading', () => {
    const studioSource = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8');
    const flowGramSource = readFlowGramNativeSource();
    const mainContentSource = readFileSync(resolve(currentDir, '../../main-content/view/MainContent.tsx'), 'utf8');

    expect(flowGramSource).toContain('WorkflowFlowGramEditorHandle');
    expect(flowGramSource).toContain('WorkflowFlowGramFormValues');
    expect(flowGramSource).toContain('WorkflowFlowGramVariableCatalog');
    expect(flowGramSource).toContain('WorkflowRuntimeVisualState');
    expect(flowGramSource).toContain('WorkflowLineInsertRequest');

    expect(flowGramSource).toContain('buildWorkflowFlowGramFormValues');
    expect(flowGramSource).toContain('buildWorkflowFlowGramVariableCatalog');
    expect(flowGramSource).toContain('buildWorkflowFlowGramVariablePanelState');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-form-inspector"');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-variable-catalog"');
    expect(flowGramSource).not.toContain('data-testid="workflow-flowgram-form-meta"');
    expect(flowGramSource).not.toContain('render: () => <div className="hidden"');

    expect(flowGramSource).toContain('renderInsideLine');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-line-insert"');
    expect(flowGramSource).not.toContain('workflow-line-add-node-overlay');
    expect(flowGramSource).not.toContain('edgeMidpoint');

    expect(flowGramSource).toContain('useImperativeHandle');
    expect(flowGramSource).toContain('ctx.history.undo');
    expect(flowGramSource).toContain('ctx.history.redo');
    expect(flowGramSource).toContain('ctx.history.canUndo');
    expect(flowGramSource).toContain('ctx.history.canRedo');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-history-state"');
    expect(studioSource).toContain('flowGramEditorRef');
    expect(studioSource).toContain('flowGramEditorRef.current?.undo');
    expect(studioSource).toContain('flowGramEditorRef.current?.redo');
    expect(studioSource).toContain('>Undo<');
    expect(studioSource).toContain('>Redo<');
    expect(studioSource).not.toContain('Definition undo');
    expect(studioSource).not.toContain('Definition redo');

    expect(flowGramSource).toContain('runtimeVisualState');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-runtime-node-state"');
    expect(flowGramSource).toContain('setLineClassName');
    expect(flowGramSource).toContain('isErrorLine');
    expect(flowGramSource).toContain('isDisabledLine');
    expect(flowGramSource).toContain('canDeleteWorkflowNode');
    expect(flowGramSource).toContain('canResetWorkflowLine');
    expect(flowGramSource).toContain('zoomIn');
    expect(flowGramSource).toContain('zoomOut');
    expect(flowGramSource).toContain('autoLayout');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-operation-toolbar"');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-primary-actions"');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-more-actions"');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-operation-toolbar"');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-shortcut-hints"');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-operation-feedback"');
    expect(flowGramSource).toContain('data-testid="workflow-selection-helper"');

    expect(mainContentSource).not.toContain("import WorkflowStudio from '../../workflows/view/WorkflowStudio'");
    expect(mainContentSource).toContain("lazy(() => import('../../workflows/view/WorkflowStudio'))");
    expect(mainContentSource).toContain('data-testid="workflow-route-lazy-boundary"');
    expect(studioSource).toContain("import type { WorkflowFlowGramEditorHandle } from './WorkflowFlowGramEditor'");
    expect(studioSource).not.toContain("import { buildFlowGramRuntimeVisualState, type WorkflowFlowGramEditorHandle } from './WorkflowFlowGramEditor'");
  });

  it('exposes visual DAG editor, runner, approval, and history hooks', () => {
    const source = [
      readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8'),
      readFlowGramNativeSource(),
    ].join('\n');

    expect(source).toContain('data-testid="workflow-studio"');
    expect(source).toContain("lazy(() => import('./WorkflowFlowGramEditor'))");
    expect(source).toContain('data-testid="workflow-flowgram-loading"');
    expect(source).toContain("from '@flowgram.ai/free-layout-editor'");
    expect(source).toContain('FreeLayoutEditor');
    expect(source).toContain('createFreeLinesPlugin');
    expect(source).toContain('createFreeSnapPlugin');
    expect(source).toContain('createMinimapPlugin');
    expect(source).toContain('data-testid="workflow-command-center"');
    expect(source).toContain('WorkflowFlowGramEditor');
    expect(source).toContain('data-testid="workflow-flowgram-free-layout-editor"');
    expect(source).toContain('data-testid="workflow-flowgram-adapter"');
    expect(source).toContain('data-testid="workflow-migration-compatibility"');
    expect(source).toContain('data-testid="workflow-migration-doctor-local"');
    expect(source).toContain('data-testid="workflow-runtime-state-bridge"');
    expect(source).toContain('data-testid="workflow-flowing-lines"');
    expect(source).toContain('data-testid="workflow-run-setup-drawer"');
    expect(source).toContain('data-testid="workflow-library-gallery"');
    expect(source).toContain('data-testid="workflow-template-preview"');
    expect(source).toContain('data-testid="workflow-inspector-tabs"');
    expect(source).toContain('data-testid="workflow-approval-inbox-panel"');
    expect(source).toContain('data-testid="workflow-run-diagnosis-panel"');
    expect(source).toContain('data-testid="workflow-editor"');
    expect(source).toContain('data-testid="workflow-dag-canvas"');
    expect(source).toContain('data-testid="workflow-add-node"');
    expect(source).toContain('workflow-flowgram-node-');
    expect(source).toContain('data-testid="workflow-approve-node"');
    expect(source).toContain('data-testid="workflow-run-card"');
    expect(source).toContain('data-testid="workflow-run-inputs"');
    expect(source).toContain('data-testid="workflow-run-input"');
    expect(source).toContain('data-testid="workflow-node-variables"');
    expect(source).toContain('data-testid="workflow-insert-variable"');
    expect(source).toContain('data-testid="workflow-invalid-variables"');
    expect(source).toContain('data-testid="workflow-node-run-details"');
    expect(source).toContain('data-testid="workflow-permission-source"');
    expect(source).toContain('data-testid="workflow-checkpoint-actions"');
    expect(source).toContain('rollbackCheckpoint');
    expect(source).toContain('data-testid="workflow-node-dependency-status"');
    expect(source).toContain('data-testid="workflow-dry-run-debugger"');
    expect(source).toContain('data-testid="workflow-dry-run-preview"');
    expect(source).toContain('dryRunPreview');
    expect(source).toContain('resolvedInput');
    expect(source).toContain('permissionDecision');
    expect(source).toContain('data-testid="workflow-run-console"');
    expect(source).toContain('data-testid="workflow-preview-consistency-chip"');
    expect(source).toContain('data-testid="workflow-preview-diff-panel"');
    expect(source).toContain('previewSnapshot: dryRunPreview || undefined');
    expect(source).toContain('previewChangedNodes');
    expect(source).toContain('data-testid="workflow-run-events"');
    expect(source).toContain('data-testid="workflow-node-logs"');
    expect(source).toContain('data-testid="workflow-retry-from-node"');
    expect(source).toContain('data-testid="workflow-template-manifest"');
    expect(source).toContain('data-testid="workflow-clone-template"');
    expect(source).toContain('data-testid="workflow-smoke-template"');
    expect(source).toContain('data-testid="workflow-template-smoke-status"');
    expect(source).toContain('data-testid="workflow-approval-inbox"');
    expect(source).toContain('data-testid="workflow-runtime-kernel"');
    expect(source).toContain('data-testid="workflow-failure-diagnosis"');
    expect(source).toContain('data-testid="workflow-release-readiness"');
    expect(source).toContain('data-testid="workflow-run-benchmarks"');
    expect(source).toContain('loadNodeTypes');
    expect(source).toContain('validateRun');
    expect(source).toContain('cloneWorkflow');
    expect(source).toContain('smokeTemplate');
    expect(source).toContain('runBenchmarks');
    expect(source).toContain('decideApproval');
    expect(source).toContain('workflowRunEvents');
    expect(source).toContain('workflowNodeLogs');
    expect(source).toContain('retryWorkflowFromNode');
    expect(source).toContain('data-testid="workflow-canvas-controls"');
    expect(source).toContain('data-testid="workflow-minimap"');
    expect(source).toContain('data-testid="workflow-edge-editor"');
    expect(source).toContain('data-testid="workflow-node-search"');
    expect(source).toContain('data-testid="workflow-form-meta-inspector"');
    expect(source).toContain('data-testid="workflow-form-meta-field"');
    expect(source).toContain('duplicateNode');
    expect(source).toContain('autoLayoutNodes');
    expect(source).toContain('data-testid="workflow-multi-select"');
    expect(source).toContain('data-testid="workflow-copy-paste"');
    expect(source).toContain('data-testid="workflow-duplicate-subgraph"');
    expect(source).toContain('data-testid="workflow-undo-redo"');
    expect(source).toContain('data-testid="workflow-layout-mode"');
    expect(source).toContain('data-testid="workflow-layout-lock"');
    expect(source).toContain('data-testid="workflow-edge-route-style"');
    expect(source).toContain('data-testid="workflow-edge-branch-labels"');
    expect(source).toContain('data-testid="workflow-edge-insert-node"');
    expect(source).toContain('data-testid="workflow-flowgram-line-insert"');
    expect(source).toContain('insertNodeOnEdge');
    expect(source).toContain('data-testid="workflow-minimap-filters"');
    expect(source).toContain('data-testid="workflow-graph-validation-badges"');
    expect(source).toContain('selectedNodeIds');
    expect(source).toContain('copySelectedNodes');
    expect(source).toContain('pasteCopiedNodes');
    expect(source).toContain('duplicateSelectedSubgraph');
    expect(source).toContain('undoWorkflowEdit');
    expect(source).toContain('redoWorkflowEdit');
    expect(source).toContain('onWorkflowEditorShortcut');
    expect(source).toContain('deleteSelectedGraphItems');
    expect(source).toContain('layoutMode');
    expect(source).toContain('lockedNodeIds');
    expect(source).toContain('edgeRouteStyle');
    expect(source).toContain('minimapFilter');
    expect(source).toContain('getNodeValidationBadges');
    expect(source).toContain('data-testid="workflow-node-schema-versioning"');
    expect(source).toContain('data-testid="workflow-node-config-presets"');
    expect(source).toContain('data-testid="workflow-required-field-guard"');
    expect(source).toContain('data-testid="workflow-secret-field-type"');
    expect(source).toContain('data-testid="workflow-json-config-editor"');
    expect(source).toContain('data-testid="workflow-typed-variable-picker"');
    expect(source).toContain('data-testid="workflow-flow-reference-validation"');
    expect(source).toContain('data-testid="workflow-mapping-preview"');
    expect(source).toContain('data-testid="workflow-transform-functions"');
    expect(source).toContain('data-testid="workflow-output-contract-test"');
    expect(source).toContain('data-testid="workflow-data-lineage-view"');
    expect(source).toContain('data-testid="workflow-variable-debugger"');
    expect(source).toContain('data-testid="workflow-variable-debugger-row"');
    expect(source).toContain('data-testid="workflow-variable-copy-expression"');
    expect(source).toContain('data-testid="workflow-run-lineage-detail"');
    expect(source).toContain('data-testid="workflow-missing-variable-diagnostics"');
    expect(source).toContain('data-testid="workflow-missing-variable-jump"');
    expect(source).toContain('data-testid="workflow-missing-variable-node-badge"');
    expect(source).toContain('data-testid="workflow-run-snapshot-badge"');
    expect(source).toContain('data-testid="workflow-run-definition-drift"');
    expect(source).toContain('data-testid="workflow-run-snapshot-details"');
    expect(source).toContain('selectedRunSnapshotDetails');
    expect(source).toContain('selectedRunDefinitionChanged');
    expect(source).toContain('missingVariableDiagnostics');
    expect(source).toContain('selectMissingVariableDiagnostic');
    expect(source).toContain('resolvedInputLineage');
    expect(source).toContain('inputLineage');
    expect(source).toContain('lineageFieldRows');
    expect(source).toContain('getNodeRunLineageRows');
    expect(source).toContain('schemaVersion');
    expect(source).toContain('saveNodeConfigPreset');
    expect(source).toContain('applyNodeConfigPreset');
    expect(source).toContain('requiredFieldErrors');
    expect(source).toContain('secretFieldDisplay');
    expect(source).toContain('jsonConfigText');
    expect(source).toContain('typedVariablePicker');
    expect(source).toContain('mappingPreview');
    expect(source).toContain('transformFunctions');
    expect(source).toContain('validateOutputContract');
    expect(source).toContain('dataLineageRows');
    expect(source).toContain('data-testid="workflow-run-live-polling-strategy"');
    expect(source).toContain('selectedRunId');
    expect(source).toContain('setSelectedRunId(run.id)');
    expect(source).toContain('aria-pressed={selectedRun?.id === run.id}');
    expect(source).toContain('data-testid="workflow-run-streaming-logs"');
    expect(source).toContain('data-testid="workflow-run-log-search"');
    expect(source).toContain('data-testid="workflow-run-compare-attempts"');
    expect(source).toContain('data-testid="workflow-retry-node-only"');
    expect(source).toContain('data-testid="workflow-retry-from-node-preview"');
    expect(source).toContain('data-testid="workflow-cancel-confirmation"');
    expect(source).toContain('data-testid="workflow-resume-banner"');
    expect(source).toContain('data-testid="workflow-run-pinning"');
    expect(source).toContain('data-testid="workflow-run-archive"');
    expect(source).toContain('runLogQuery');
    expect(source).toContain('pinnedRunIds');
    expect(source).toContain('archivedRunIds');
    expect(source).toContain('pollingStrategy');
    expect(source).toContain('streamingLogRows');
    expect(source).toContain('compareRunAttempts');
    expect(source).toContain('retryNodeOnly');
    expect(source).toContain('retryFromNodePreview');
    expect(source).toContain('cancelConfirmation');
    expect(source).toContain('resumeBannerRuns');
    expect(source).toContain('data-testid="workflow-approval-risk-explanation"');
    expect(source).toContain('data-testid="workflow-approval-requested-capabilities"');
    expect(source).toContain('data-testid="workflow-approval-risk-reasons"');
    expect(source).toContain('data-testid="workflow-approval-diff-summary"');
    expect(source).toContain('data-testid="workflow-approval-timeout-policy"');
    expect(source).toContain('data-testid="workflow-approval-delegation"');
    expect(source).toContain('data-testid="workflow-approval-audit-export"');
    expect(source).toContain('data-testid="workflow-permission-dry-run"');
    expect(source).toContain('data-testid="workflow-permission-override-request"');
    expect(source).toContain('data-testid="workflow-secret-vault-integration"');
    expect(source).toContain('data-testid="workflow-mcp-allowlist-ui"');
    expect(source).toContain('data-testid="workflow-dangerous-command-policy"');
    expect(source).toContain('approvalRiskExplanation');
    expect(source).toContain('approvalDiffSummary');
    expect(source).toContain('approvalTimeoutPolicy');
    expect(source).toContain('approvalDelegationTarget');
    expect(source).toContain('approvalAuditExport');
    expect(source).toContain('permissionDryRunRows');
    expect(source).toContain('requestedCapabilities');
    expect(source).toContain('effectiveCapabilities');
    expect(source).toContain('riskReasons');
    expect(source).toContain('permissionOverrideRequest');
    expect(source).toContain('secretVaultRefs');
    expect(source).toContain('mcpAllowlistRows');
    expect(source).toContain('dangerousCommandPolicy');
    [
      'workflow-agent-session-link',
      'workflow-agent-prompt-preview',
      'workflow-agent-result-contract',
      'workflow-subagent-pool-limit',
      'workflow-subagent-cancellation-bridge',
      'workflow-mcp-tool-catalog-sync',
      'workflow-mcp-argument-builder',
      'workflow-mcp-error-normalization',
      'workflow-tool-node-registry',
      'workflow-browser-screenshot-node',
      'workflow-template-detail-page',
      'workflow-template-dependency-check',
      'workflow-template-smoke-badge',
      'workflow-template-version-upgrade',
      'workflow-template-migration-notes',
      'workflow-template-fork',
      'workflow-package-export-wizard',
      'workflow-package-import-preview',
      'workflow-marketplace-trust-badge',
      'workflow-enterprise-template-pack',
      'workflow-event-timeline-correlation',
      'workflow-replay-visualizer',
      'workflow-failure-classifier',
      'workflow-recommended-recovery-action',
      'workflow-artifact-gallery',
      'workflow-screenshot-evidence-viewer',
      'workflow-benchmark-trend',
      'workflow-release-readiness-detail',
      'workflow-test-coverage-map',
      'workflow-evidence-export',
      'workflow-change-history',
      'workflow-draft-publish-flow',
      'workflow-review-request',
      'workflow-ownership-metadata',
      'workflow-deprecation-flow',
      'workflow-usage-analytics',
      'workflow-role-based-visibility',
      'workflow-compliance-labels',
      'workflow-audit-log-search',
      'workflow-policy-report',
      'workflow-large-graph-performance',
      'workflow-virtualized-run-logs',
      'workflow-offline-read-mode',
      'workflow-import-validation-sandbox',
      'workflow-storage-backup-restore',
      'workflow-data-retention-policy',
      'workflow-package-size-guard',
      'workflow-release-smoke-matrix',
      'workflow-migration-doctor',
      'workflow-production-readiness-dashboard',
    ].forEach((testId) => expect(source).toContain(`data-testid="${testId}"`));
    [
      'agentSessionLinks',
      'agentPromptPreview',
      'agentResultContract',
      'subagentPoolLimit',
      'subagentCancellationBridge',
      'mcpToolCatalogSync',
      'mcpArgumentBuilder',
      'mcpErrorNormalization',
      'toolNodeRegistry',
      'browserScreenshotNode',
      'templateDetailPage',
      'templateDependencyCheck',
      'templateSmokeBadge',
      'templateVersionUpgrade',
      'templateMigrationNotes',
      'templateFork',
      'packageExportWizard',
      'packageImportPreview',
      'marketplaceTrustBadge',
      'enterpriseTemplatePack',
      'eventTimelineCorrelation',
      'replayVisualizer',
      'failureClassifier',
      'recommendedRecoveryAction',
      'artifactGallery',
      'screenshotEvidenceViewer',
      'benchmarkTrend',
      'releaseReadinessDetail',
      'testCoverageMap',
      'evidenceExport',
      'workflowChangeHistory',
      'draftPublishFlow',
      'reviewRequest',
      'ownershipMetadata',
      'deprecationFlow',
      'usageAnalytics',
      'roleBasedVisibility',
      'complianceLabels',
      'auditLogSearch',
      'policyReport',
      'largeGraphPerformance',
      'virtualizedRunLogs',
      'offlineReadMode',
      'importValidationSandbox',
      'storageBackupRestore',
      'dataRetentionPolicy',
      'packageSizeGuard',
      'releaseSmokeMatrix',
      'migrationDoctor',
      'productionReadinessDashboard',
    ].forEach((symbol) => expect(source).toContain(symbol));
    expect(source).toContain('workflow-mobile-run');
    expect(source).toContain('Agent Workflow Studio');
    expect(source).toContain('data-testid="workflow-home-overview"');
    expect(source).toContain('data-testid="workflow-empty-state-guide"');
    expect(source).toContain('data-testid="workflow-first-run-wizard"');
    expect(source).toContain('data-testid="workflow-command-palette"');
    expect(source).toContain('data-testid="workflow-recent-objects"');
    expect(source).toContain('data-testid="workflow-favorites"');
    expect(source).toContain('data-testid="workflow-breadcrumb"');
    expect(source).toContain('data-testid="workflow-status-taxonomy"');
    expect(source).toContain('data-testid="workflow-help-overlay"');
    expect(source).toContain('data-testid="workflow-keyboard-shortcuts"');
    expect(source).toContain('toggleFavoriteWorkflow');
    expect(source).toContain('openWorkflowDeepLink');
  });

  it('keeps legacy swarm language out of the workflow UI', () => {
    const source = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8').toLowerCase();

    expect(source).not.toContain('swarm');
    expect(source).not.toContain('message bus');
    expect(source).not.toContain('topology');
  });

  it('defaults Workflow Studio to a simplified human-guided interaction model', () => {
    const studioSource = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8');
    const flowGramSource = readFlowGramNativeSource();

    expect(studioSource).toContain('WorkflowUiMode');
    expect(studioSource).toContain('workflowUiModeStorageKey');
    expect(studioSource).toContain('data-testid="workflow-simple-mode"');
    expect(studioSource).toContain('data-testid="workflow-advanced-toggle"');
    expect(studioSource).toContain('data-testid="workflow-human-next-action"');
    expect(studioSource).toContain('data-testid="workflow-guided-builder"');
    expect(studioSource).toContain('data-testid="workflow-diagnostics-drawer"');
    expect(studioSource).toContain('data-testid="workflow-inspector-essential-fields"');
    expect(studioSource).toContain('data-testid="workflow-inspector-advanced-sections"');
    expect(studioSource).toContain('data-testid="workflow-run-story"');
    expect(studioSource).toContain('data-testid="workflow-run-advanced-tabs"');
    expect(studioSource).toContain('Choose');
    expect(studioSource).toContain('Configure');
    expect(studioSource).toContain('Review');
    expect(studioSource).toContain('Build and run an agent workflow for this project');
    expect(studioSource).not.toContain('Compose Agent, Subagent, MCP, Tool, Shell, Artifact, Approval, Condition, and Join nodes as a visual DAG.');

    expect(flowGramSource).toContain('showDiagnostics');
    expect(flowGramSource).toContain('data-testid="workflow-flowgram-diagnostics-layer"');
    expect(flowGramSource).not.toContain('FlowGram edits / MTL runtime executes');
    expect(flowGramSource).not.toContain('{humanFeedback} 路 {operationFeedback}');
  });

  it('continues desktop-only Workflow Studio polish without mobile screenshot gates', () => {
    const studioSource = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8');
    const flowGramSource = readFlowGramNativeSource();
    const screenshotSpec = readFileSync(resolve(currentDir, '../../../../e2e/workflow-studio.screenshot.spec.ts'), 'utf8');

    expect(studioSource).toContain('data-testid="workflow-desktop-focus-layout"');
    expect(studioSource).toContain('data-testid="workflow-editor-setup-strip"');
    expect(studioSource).toContain('data-testid="workflow-runs-approval-focus"');
    expect(flowGramSource).toContain('data-testid="workflow-canvas-operation-polish"');
    expect(flowGramSource).toContain('data-testid="workflow-selection-helper"');
    expect(screenshotSpec).toContain('BUG-UI-019-editor-focus-layout.png');
    expect(screenshotSpec).toContain('BUG-UI-020-canvas-operation-polish.png');
    expect(screenshotSpec).toContain('BUG-UI-021-runs-approval-focus.png');
    expect(screenshotSpec).not.toContain('BUG-UI-019-mobile');
    expect(screenshotSpec).not.toContain('BUG-UI-020-mobile');
    expect(screenshotSpec).not.toContain('BUG-UI-021-mobile');
  });

  it('applies a modern desktop product shell without adding mobile gates', () => {
    const studioSource = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8');
    const flowGramSource = readFlowGramNativeSource();
    const nodeRendererSource = readFileSync(resolve(currentDir, 'flowgram/FlowGramWorkflowNodeRenderer.tsx'), 'utf8');
    const screenshotSpec = readFileSync(resolve(currentDir, '../../../../e2e/workflow-studio.screenshot.spec.ts'), 'utf8');

    expect(studioSource).toContain('data-testid="workflow-modern-desktop-shell"');
    expect(studioSource).toContain('data-testid="workflow-command-rail"');
    expect(studioSource).toContain('data-testid="workflow-editor-quick-path"');
    expect(studioSource).toContain('data-testid="workflow-properties-panel"');
    expect(studioSource).toContain('data-testid="workflow-inspector-node-summary"');
    expect(studioSource).toContain('data-testid="workflow-inspector-more-actions"');
    expect(flowGramSource).toContain('data-testid="workflow-canvas-surface-modern"');
    expect(flowGramSource).toContain('data-testid="workflow-canvas-surface-titlebar"');
    expect(nodeRendererSource).toContain('data-testid="workflow-node-modern-block"');
    expect(nodeRendererSource).toContain('workflow node status dot');
    expect(screenshotSpec).toContain('BUG-UI-022-modern-desktop-shell.png');
    expect(screenshotSpec).toContain('BUG-UI-023-inspector-properties-panel.png');
    expect(screenshotSpec).toContain('BUG-UI-024-canvas-surface-node-polish.png');
    expect(screenshotSpec).not.toContain('BUG-UI-022-mobile');
    expect(screenshotSpec).not.toContain('BUG-UI-023-mobile');
    expect(screenshotSpec).not.toContain('BUG-UI-024-mobile');
  });

  it('keeps the default Workflow Studio view low-noise and canvas first', () => {
    const studioSource = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8');
    const screenshotSpec = readFileSync(resolve(currentDir, '../../../../e2e/workflow-studio.screenshot.spec.ts'), 'utf8');

    expect(studioSource).toContain('data-testid="workflow-quiet-default-header"');
    expect(studioSource).toContain('data-testid="workflow-quiet-meta"');
    expect(studioSource).toContain('data-testid="workflow-canvas-first-rail"');
    expect(studioSource).toContain('data-testid="workflow-editor-metadata-details"');
    expect(studioSource).toContain('data-testid="workflow-inspector-low-noise-defaults"');
    expect(studioSource).toContain('data-density="compact"');
    expect(screenshotSpec).toContain('BUG-UI-025-quiet-default-header.png');
    expect(screenshotSpec).toContain('BUG-UI-026-canvas-first-simple-mode.png');
    expect(screenshotSpec).toContain('BUG-UI-027-low-noise-inspector.png');
    expect(screenshotSpec).not.toContain('BUG-UI-025-mobile');
    expect(screenshotSpec).not.toContain('BUG-UI-026-mobile');
    expect(screenshotSpec).not.toContain('BUG-UI-027-mobile');
  });

  it('exposes AI generated Python custom node review and install UI without generated TSX injection', () => {
    const studioSource = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8');
    const apiSource = readFileSync(resolve(currentDir, '../../../utils/api.js'), 'utf8');
    const screenshotSpec = readFileSync(resolve(currentDir, '../../../../e2e/workflow-studio.screenshot.spec.ts'), 'utf8');

    expect(apiSource).toContain('generateWorkflowNodePackageDraft');
    expect(apiSource).toContain('validateWorkflowNodePackageDraft');
    expect(apiSource).toContain('testWorkflowNodePackageDraft');
    expect(apiSource).toContain('workflowNodePackageImpact');
    expect(apiSource).toContain('disableWorkflowNodePackage');
    expect(apiSource).toContain('enableWorkflowNodePackage');
    expect(apiSource).toContain('uninstallWorkflowNodePackage');
    expect(studioSource).toContain('data-testid="workflow-generate-custom-node"');
    expect(studioSource).toContain('data-testid="workflow-ai-node-draft-review"');
    expect(studioSource).toContain('data-testid="workflow-custom-schema-node-form"');
    expect(studioSource).toContain('data-testid="workflow-python-node-test-result"');
    expect(studioSource).toContain('data-testid="workflow-python-node-test-matrix"');
    expect(studioSource).toContain('data-testid="workflow-python-node-test-case"');
    expect(studioSource).toContain('data-testid="workflow-python-node-assertion-failures"');
    expect(studioSource).toContain('data-testid="workflow-node-package-manager"');
    expect(studioSource).toContain('data-testid="workflow-node-package-state"');
    expect(studioSource).toContain('data-testid="workflow-node-package-impact-report"');
    expect(studioSource).toContain('data-testid="workflow-node-package-disable"');
    expect(studioSource).toContain('data-testid="workflow-node-package-enable"');
    expect(studioSource).toContain('data-testid="workflow-node-package-uninstall"');
    expect(studioSource).toContain('data-testid="workflow-node-package-upgrade-warning"');
    expect(studioSource).toContain('Custom');
    expect(studioSource).not.toContain('dangerouslySetInnerHTML');
    expect(screenshotSpec).toContain('REQ-207-ai-node-draft.png');
    expect(screenshotSpec).toContain('REQ-207-python-node-dependency-warning.png');
    expect(screenshotSpec).toContain('REQ-207-python-node-test-stdout-stderr.png');
    expect(screenshotSpec).toContain('REQ-207-custom-node-installed.png');
    expect(screenshotSpec).toContain('REQ-207-custom-node-run-output.png');
    expect(screenshotSpec).toContain('REQ-211C-package-manager-impact.png');
    expect(screenshotSpec).toContain('REQ-211C-package-manager-disabled.png');
    expect(screenshotSpec).toContain('REQ-211D-impact-report.png');
    expect(screenshotSpec).toContain('REQ-211D-disabled-state.png');
    expect(screenshotSpec).toContain('REQ-211D-incompatible-upgrade.png');
    expect(screenshotSpec).toContain('REQ-212C-test-review-matrix.png');
    expect(screenshotSpec).toContain('REQ-212D-test-matrix-pass.png');
    expect(screenshotSpec).toContain('REQ-212D-test-matrix-assertion-failure.png');
    expect(screenshotSpec).toContain('REQ-212D-test-matrix-runtime-error.png');
  });
});
