import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type FreeLayoutPluginContext,
  type FreeLayoutProps,
  type WorkflowContentChangeEvent,
  type WorkflowJSON,
  type WorkflowNodeEntity,
} from '@flowgram.ai/free-layout-editor';
import { createFreeLinesPlugin, type LineRenderProps } from '@flowgram.ai/free-lines-plugin';
import { createFreeNodePanelPlugin, WorkflowNodePanelService } from '@flowgram.ai/free-node-panel-plugin';
import { createFreeSnapPlugin } from '@flowgram.ai/free-snap-plugin';
import { createFreeStackPlugin } from '@flowgram.ai/free-stack-plugin';
import { createMinimapPlugin } from '@flowgram.ai/minimap-plugin';
import { createNodeVariablePlugin } from '@flowgram.ai/node-variable-plugin';

import type { WorkflowDefinition, WorkflowNodeType, WorkflowRun } from '../../../../types/workflow';
import { createWorkflowNodeRegistry } from '../../model/workflowNodeRegistry';
import {
  flowGramWorkflowJSONToWorkflowDefinition,
  workflowDefinitionToFlowGramWorkflowJSON,
} from '../../model/workflowGraphAdapter';
import {
  buildFlowGramRuntimeVisualState,
  isDisabledLine,
  isErrorLine,
  isFlowingLine,
  setLineClassName,
} from './FlowGramRuntimeVisualBridge';
import {
  buildFlowGramWorkflowNodeRegistries,
  createFlowGramWorkflowNode,
  getFlowGramWorkflowNodeDefaultRegistry,
} from './FlowGramWorkflowNodeRegistry';
import { FlowGramWorkflowNode } from './FlowGramWorkflowNodeRenderer';
import { buildWorkflowFlowGramVariablePanelState } from './FlowGramWorkflowVariablePanelAdapter';
import { FlowGramLineInsertButton, FlowGramNodePanel } from './FlowGramWorkflowMaterials';
import type { WorkflowLineInsertRequest, WorkflowRuntimeVisualState } from './FlowGramWorkflowTypes';
import {
  canAddWorkflowLine,
  canDeleteWorkflowLine,
  canDeleteWorkflowNode,
  canResetWorkflowLine,
  getWorkflowLineId,
  getWorkflowPortNodeId,
} from './FlowGramWorkflowLineGuards';
import {
  workflowFlowGramI18n,
  workflowFlowGramLineColor,
  workflowFlowGramMinimap,
  workflowFlowGramScroll,
  workflowFlowGramSelectBox,
  workflowFlowGramSnap,
} from './FlowGramWorkflowVisualConfig';
import { workflowFlowGramHistory, workflowFlowGramShortcuts } from './FlowGramWorkflowShortcuts';

type WorkflowFlowGramEditorPropsInput = {
  workflow: WorkflowDefinition;
  selectedRun: WorkflowRun | null;
  runtimeVisualState?: WorkflowRuntimeVisualState | null;
  selectedNodeId: string;
  selectedEdgeId: string;
  onWorkflowChange: (workflow: WorkflowDefinition) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
};

function hashFlowGramJSON(json: WorkflowJSON) {
  return JSON.stringify({
    nodes: json.nodes.map((node) => [node.id, node.type, node.meta?.position, node.data?.title]),
    edges: json.edges.map((edge) => [edge.data?.id, edge.sourceNodeID, edge.targetNodeID, edge.data?.mode]),
  });
}

function insertNodeOnEdgeInWorkflow(
  workflow: WorkflowDefinition,
  edgeId: string,
  type: WorkflowNodeType,
) {
  const edge = workflow.edges.find((item) => item.id === edgeId);
  if (!edge) return workflow;
  const sourceNode = workflow.nodes.find((node) => node.id === edge.from);
  const targetNode = workflow.nodes.find((node) => node.id === edge.to);
  const position = sourceNode && targetNode
    ? {
      x: Math.round((sourceNode.position.x + targetNode.position.x) / 2),
      y: Math.round((sourceNode.position.y + targetNode.position.y) / 2),
    }
    : { x: 160 + workflow.nodes.length * 80, y: 160 };
  const flowNode = createFlowGramWorkflowNode(type, {
    nodeCount: workflow.nodes.length,
    position,
    registry: createWorkflowNodeRegistry(),
  });
  const node = flowNode.data?.workflowNode;
  if (!node) return workflow;
  const firstEdge = {
    ...edge,
    id: `${edge.from}-${node.id}`,
    to: node.id,
  };
  const secondEdge = {
    ...edge,
    id: `${node.id}-${edge.to}`,
    from: node.id,
    mode: 'success' as const,
    condition: '',
  };
  return {
    ...workflow,
    nodes: [...workflow.nodes, node],
    edges: workflow.edges.flatMap((item) => (item.id === edgeId ? [firstEdge, secondEdge] : [item])),
  };
}

export function useWorkflowFlowGramEditorProps({
  workflow,
  selectedRun,
  runtimeVisualState,
  selectedNodeId,
  selectedEdgeId,
  onWorkflowChange,
  onSelectNode,
  onSelectEdge,
}: WorkflowFlowGramEditorPropsInput) {
  const initialData = useMemo(() => workflowDefinitionToFlowGramWorkflowJSON(workflow), [workflow]);
  const flowGramContextRef = useRef<FreeLayoutPluginContext | null>(null);
  const lastContentHash = useRef(hashFlowGramJSON(initialData));
  const nodeRegistries = useMemo(() => buildFlowGramWorkflowNodeRegistries(createWorkflowNodeRegistry()), []);
  const firstInsertableType = workflow.nodes.find((node) => node.type !== 'join')?.type || 'agent';
  const resolvedRuntimeVisualState = useMemo(
    () => runtimeVisualState ?? buildFlowGramRuntimeVisualState(workflow, selectedRun),
    [runtimeVisualState, selectedRun, workflow],
  );
  const variablePanelState = useMemo(
    () => buildWorkflowFlowGramVariablePanelState(workflow, selectedNodeId),
    [selectedNodeId, workflow],
  );
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const syncHistoryState = useCallback((ctx = flowGramContextRef.current) => {
    setHistoryState({
      canUndo: ctx ? Boolean(ctx.history.canUndo()) : false,
      canRedo: ctx ? Boolean(ctx.history.canRedo()) : false,
    });
  }, []);

  const syncContextWorkflow = useCallback((ctx: FreeLayoutPluginContext | null) => {
    if (!ctx || ctx.document.disposed) return;
    const json = ctx.document.toJSON() as WorkflowJSON;
    lastContentHash.current = hashFlowGramJSON(json);
    onWorkflowChange(flowGramWorkflowJSONToWorkflowDefinition(workflow, json));
    syncHistoryState(ctx);
  }, [onWorkflowChange, syncHistoryState, workflow]);

  const insertNodeOnEdge = useCallback(async (edgeId: string, nodeType: WorkflowNodeType) => {
    const nextWorkflow = insertNodeOnEdgeInWorkflow(workflow, edgeId, nodeType);
    if (nextWorkflow === workflow) return false;
    onWorkflowChange(nextWorkflow);
    onSelectNode(nextWorkflow.nodes.at(-1)?.id || '');
    onSelectEdge('');
    return true;
  }, [onSelectEdge, onSelectNode, onWorkflowChange, workflow]);

  const handleContentChange = useCallback((ctx: FreeLayoutPluginContext, _event: WorkflowContentChangeEvent) => {
    flowGramContextRef.current = ctx;
    if (ctx.document.disposed) return;
    const json = ctx.document.toJSON() as WorkflowJSON;
    const nextHash = hashFlowGramJSON(json);
    if (lastContentHash.current === nextHash) return;
    lastContentHash.current = nextHash;
    onWorkflowChange(flowGramWorkflowJSONToWorkflowDefinition(workflow, json));
    syncHistoryState(ctx);
  }, [onWorkflowChange, syncHistoryState, workflow]);

  const editorProps = useMemo<FreeLayoutProps>(() => ({
    initialData,
    nodeRegistries,
    getNodeDefaultRegistry(type) {
      return getFlowGramWorkflowNodeDefaultRegistry(String(type));
    },
    background: true,
    readonly: false,
    twoWayConnection: true,
    enableReadonlyNodeDragging: false,
    allNodesDefaultExpanded: true,
    history: workflowFlowGramHistory,
    scroll: workflowFlowGramScroll,
    selectBox: workflowFlowGramSelectBox,
    i18n: workflowFlowGramI18n,
    constants: {
      workflowFlowGramShortcuts,
    },
    nodeEngine: {
      enable: true,
    },
    variableEngine: {
      enable: true,
    },
    lineColor: workflowFlowGramLineColor,
    materials: {
      renderDefaultNode: ({ node }: { node: WorkflowNodeEntity }) => (
        <FlowGramWorkflowNode
          node={node}
          selectedNodeId={selectedNodeId}
          selectedRun={selectedRun}
          runtimeVisualState={resolvedRuntimeVisualState}
          onSelectNode={onSelectNode}
        />
      ),
    },
    isFlowingLine: (_ctx, line) => isFlowingLine(resolvedRuntimeVisualState, getWorkflowLineId(line)),
    isErrorLine: (_ctx, fromPort, toPort) => {
      const edge = workflow.edges.find((item) => item.from === fromPort?.node?.id && item.to === toPort?.node?.id);
      return isErrorLine(resolvedRuntimeVisualState, edge?.id || '');
    },
    isDisabledLine: (_ctx, line) => isDisabledLine(resolvedRuntimeVisualState, getWorkflowLineId(line)),
    setLineClassName: (_ctx, line) => setLineClassName(resolvedRuntimeVisualState, getWorkflowLineId(line)),
    canAddLine: (_ctx, fromPort, toPort) => canAddWorkflowLine(workflow, getWorkflowPortNodeId(fromPort), getWorkflowPortNodeId(toPort)),
    canDeleteNode: (_ctx, node) => canDeleteWorkflowNode(workflow, String(node.id || '')),
    canDeleteLine: (_ctx, line) => canDeleteWorkflowLine(workflow, getWorkflowLineId(line)),
    canResetLine: (_ctx, oldLine, newLineInfo) => canResetWorkflowLine(
      workflow,
      getWorkflowLineId(oldLine),
      getWorkflowPortNodeId(newLineInfo.fromPort),
      getWorkflowPortNodeId(newLineInfo.toPort),
    ),
    canDropToNode: () => false,
    onDragLineEnd: async (ctx, params) => {
      const panel = ctx.get(WorkflowNodePanelService);
      await panel.call({
        panelPosition: (params as unknown as { position?: { x: number; y: number }; point?: { x: number; y: number } }).position
          || (params as unknown as { point?: { x: number; y: number } }).point
          || { x: 0, y: 0 },
        fromPort: (params as unknown as { fromPort?: never }).fromPort,
        toPort: (params as unknown as { toPort?: never }).toPort,
        enableBuildLine: true,
        enableSelectPosition: true,
      });
    },
    onContentChange: handleContentChange,
    onAllLayersRendered(ctx) {
      flowGramContextRef.current = ctx;
      syncHistoryState(ctx);
      void ctx.tools.fitView(false);
    },
    plugins: () => [
      createFreeStackPlugin({}),
      createFreeLinesPlugin({
        renderInsideLine: ({ line }: LineRenderProps) => (
          <FlowGramLineInsertButton
            line={line}
            selectedEdgeId={selectedEdgeId}
            firstInsertableType={firstInsertableType}
            onSelectEdge={onSelectEdge}
            onInsert={({ edgeId, nodeType }: WorkflowLineInsertRequest) => void insertNodeOnEdge(edgeId, nodeType)}
          />
        ),
      }),
      createFreeNodePanelPlugin({
        renderer: FlowGramNodePanel,
      }),
      createNodeVariablePlugin({}),
      createFreeSnapPlugin(workflowFlowGramSnap),
      createMinimapPlugin(workflowFlowGramMinimap),
    ],
  }), [firstInsertableType, handleContentChange, initialData, insertNodeOnEdge, nodeRegistries, onSelectEdge, onSelectNode, resolvedRuntimeVisualState, selectedEdgeId, selectedNodeId, selectedRun, syncHistoryState, workflow]);

  return {
    editorProps,
    flowGramContextRef,
    historyState,
    syncContextWorkflow,
    insertNodeOnEdge,
    variablePanelState,
  };
}
