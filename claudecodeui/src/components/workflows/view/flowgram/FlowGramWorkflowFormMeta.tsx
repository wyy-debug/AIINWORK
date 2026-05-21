import { ValidateTrigger } from '@flowgram.ai/free-layout-editor';

import type { WorkflowDefinition } from '../../../../types/workflow';
import type { FlowGramNodeLike, FlowGramNodeData, WorkflowFlowGramFormValues } from './FlowGramWorkflowTypes';
import type { WorkflowFlowValue } from '../../model/workflowGraphAdapter';

type WorkflowNode = WorkflowDefinition['nodes'][number];

function cloneRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function getWorkflowNodeFromValue(value: unknown): WorkflowNode | null {
  const candidate = value && typeof value === 'object' ? value as { workflowNode?: WorkflowNode } : {};
  return candidate.workflowNode || null;
}

function getWorkflowNodeFromRawData(rawData: FlowGramNodeData | { data?: FlowGramNodeData } | null | undefined): WorkflowNode | null {
  const data = rawData && typeof rawData === 'object' && 'data' in rawData
    ? rawData.data
    : rawData as FlowGramNodeData | null | undefined;
  return data?.workflowNode || null;
}

function getWorkflowNodeFromContext(value: unknown, context?: { node?: FlowGramNodeLike }): WorkflowNode | null {
  return getWorkflowNodeFromValue(value) || getWorkflowNodeFromRawData(context?.node?.getJSONData?.()) || null;
}

export function buildWorkflowFlowGramFormValues(node: WorkflowNode | null | undefined): WorkflowFlowGramFormValues {
  const fallbackNode: WorkflowNode = node || {
    id: 'workflow-node',
    type: 'tool',
    title: 'Workflow node',
    description: '',
    agentId: '',
    toolName: '',
    command: '',
    prompt: '',
    condition: '',
    permission: '',
    retryLimit: 0,
    timeoutMs: 120000,
    config: {},
    position: { x: 0, y: 0 },
  };
  const config = cloneRecord(fallbackNode.config);
  return {
    title: fallbackNode.title || fallbackNode.id,
    description: fallbackNode.description || '',
    agentId: fallbackNode.agentId || '',
    toolName: fallbackNode.toolName || '',
    command: fallbackNode.command || '',
    prompt: fallbackNode.prompt || '',
    condition: fallbackNode.condition || '',
    permission: fallbackNode.permission || '',
    retryLimit: fallbackNode.retryLimit || 0,
    timeoutMs: fallbackNode.timeoutMs || 120000,
    config,
    flowValues: cloneRecord((fallbackNode as { flowValues?: unknown }).flowValues) as Record<string, WorkflowFlowValue>,
    workflowNode: fallbackNode,
  };
}

export function submitWorkflowFlowGramFormValues(
  values: Partial<WorkflowFlowGramFormValues> = {},
  context?: { node?: FlowGramNodeLike },
) {
  const baseNode = values.workflowNode || getWorkflowNodeFromContext(values, context);
  const formValues = buildWorkflowFlowGramFormValues(baseNode);
  const config = cloneRecord(values.config ?? formValues.config);
  const flowValues = cloneRecord(values.flowValues ?? formValues.flowValues) as Record<string, WorkflowFlowValue>;
  const workflowNode: WorkflowNode = {
    ...formValues.workflowNode,
    title: values.title ?? formValues.title,
    description: values.description ?? formValues.description,
    agentId: values.agentId ?? formValues.agentId,
    toolName: values.toolName ?? formValues.toolName,
    command: values.command ?? formValues.command,
    prompt: values.prompt ?? formValues.prompt,
    condition: values.condition ?? formValues.condition,
    permission: (values.permission ?? formValues.permission) as WorkflowNode['permission'],
    retryLimit: Number(values.retryLimit ?? formValues.retryLimit),
    timeoutMs: Number(values.timeoutMs ?? formValues.timeoutMs),
    config,
  };

  return {
    title: workflowNode.title,
    description: workflowNode.description,
    workflowNode,
    config,
    flowValues,
    runtime: {
      permission: workflowNode.permission,
      retryLimit: workflowNode.retryLimit,
      timeoutMs: workflowNode.timeoutMs,
    },
  };
}

export const workflowNodeFormMeta = {
  validateTrigger: ValidateTrigger.onChange,
  render: ({ form }: { form?: { values?: Partial<WorkflowFlowGramFormValues> } }) => {
    const values = form?.values || {};
    const configKeys = Object.keys(values.config || values.workflowNode?.config || {});
    const flowValues = Object.keys(values.flowValues || {});
    return (
      <div className="space-y-2 rounded-md border border-border bg-background p-2 text-[10px] text-muted-foreground" data-testid="workflow-flowgram-form-inspector">
        <div className="font-semibold uppercase tracking-wide text-foreground">{values.title || values.workflowNode?.title || 'Workflow node form'}</div>
        <div className="grid grid-cols-2 gap-1">
          <span className="rounded border border-border px-1.5 py-0.5">Config keys: {configKeys.length}</span>
          <span className="rounded border border-border px-1.5 py-0.5">Flow values: {flowValues.length}</span>
        </div>
        <div className="truncate">Permission: {values.permission || values.workflowNode?.permission || 'inherit'}</div>
      </div>
    );
  },
  defaultValues: (context: { node?: FlowGramNodeLike }) => buildWorkflowFlowGramFormValues(getWorkflowNodeFromContext(undefined, context)),
  formatOnInit: (value: unknown, context: { node?: FlowGramNodeLike }) => buildWorkflowFlowGramFormValues(getWorkflowNodeFromContext(value, context)),
  formatOnSubmit: (value: Partial<WorkflowFlowGramFormValues>, context: { node?: FlowGramNodeLike }) => submitWorkflowFlowGramFormValues(value, context),
  validate: {
    title: ({ value }: { value?: string }) => (value?.trim() ? undefined : 'Title is required'),
  },
};
