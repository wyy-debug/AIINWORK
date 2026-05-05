import type {
  SubagentActivityItem,
  SubagentActivitySummary,
  SubagentRegistryStatus,
  SubagentRuntimeStatus,
} from '../types/types';

import { getSubagentBlockerGuidance, type SubagentBlockerGuidance } from './subagentGuidance';

export interface SubagentDetailRow {
  id: string;
  taskId?: string;
  label: string;
  objective?: string;
  statusLabel: string;
  status?: SubagentRegistryStatus;
  runtimeStatus?: SubagentRuntimeStatus;
  currentStep?: number;
  maxSteps?: number;
  lastTool?: string;
  lastToolSummary?: string;
  stopReason?: string;
  resultSummary?: string;
  evidence?: string;
  nextAction?: string;
  blockers?: string;
  activeToolLabel?: string;
  terminal: boolean;
  outputting: boolean;
  meta: string;
  detail: string;
  guidance: SubagentBlockerGuidance | null;
  evidenceText: string;
  canStop: boolean;
  canReuse: boolean;
}

export type SubagentDetailMode = 'active' | 'history';

const STATUS_LABELS: Record<string, string> = {
  RUNNING: '运行中',
  DONE: '已完成',
  BLOCKED: '已阻塞',
  NEED_PARENT_INPUT: '等待输入',
  running: '运行中',
  completed: '已完成',
  blocked: '已阻塞',
  need_parent_input: '等待输入',
  failed: '已失败',
  cancelled: '已取消',
  interrupted: '已中断',
};

function compactJoin(parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ');
}

function resolveStatusLabel(item: SubagentActivityItem): string {
  const key = item.runtimeStatus || item.status || (item.terminal ? 'DONE' : 'RUNNING');
  return STATUS_LABELS[key] || key;
}

function isBlockedLike(item: SubagentActivityItem): boolean {
  return Boolean(
    item.runtimeStatus === 'BLOCKED'
    || item.runtimeStatus === 'NEED_PARENT_INPUT'
    || item.status === 'blocked'
    || item.status === 'failed'
    || item.status === 'cancelled'
    || item.status === 'interrupted'
    || item.stopReason
    || item.blockers,
  );
}

function buildMeta(item: SubagentActivityItem): string {
  const step = typeof item.currentStep === 'number' && typeof item.maxSteps === 'number'
    ? `${item.currentStep}/${item.maxSteps}`
    : undefined;
  return compactJoin([step, item.lastTool, item.lastToolSummary]);
}

function buildEvidenceText(item: SubagentActivityItem): string {
  return [item.evidence, item.resultSummary, item.nextAction, item.blockers]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join('\n\n');
}

function toDetailRow(item: SubagentActivityItem): SubagentDetailRow {
  const terminal = Boolean(item.terminal);
  const guidance = terminal && isBlockedLike(item)
    ? getSubagentBlockerGuidance({
      status: item.runtimeStatus || item.status,
      stopReason: item.stopReason,
      objective: item.objective || item.label,
      lastTool: item.lastTool,
      blockers: item.blockers,
      nextAction: item.nextAction,
    })
    : null;

  return {
    id: item.taskId || item.id || item.label,
    taskId: item.taskId,
    label: item.label,
    objective: item.objective,
    status: item.status,
    runtimeStatus: item.runtimeStatus,
    currentStep: item.currentStep,
    maxSteps: item.maxSteps,
    lastTool: item.lastTool,
    lastToolSummary: item.lastToolSummary,
    stopReason: item.stopReason,
    resultSummary: item.resultSummary,
    evidence: item.evidence,
    nextAction: item.nextAction,
    blockers: item.blockers,
    activeToolLabel: item.activeToolLabel,
    statusLabel: resolveStatusLabel(item),
    terminal,
    outputting: Boolean(item.outputting),
    meta: buildMeta(item),
    detail: item.objective || item.activeToolLabel || item.resultSummary || item.nextAction || '后台任务运行中',
    guidance,
    evidenceText: buildEvidenceText(item),
    canStop: Boolean(!terminal && item.taskId),
    canReuse: Boolean(terminal && (item.objective || item.label)),
  };
}

export function buildSubagentDetailRows(
  summary: SubagentActivitySummary | null | undefined,
  options: { mode: SubagentDetailMode },
): SubagentDetailRow[] {
  if (!summary) return [];
  const source = options.mode === 'history' ? summary.historyItems : summary.items;
  return source.map(toDetailRow);
}
