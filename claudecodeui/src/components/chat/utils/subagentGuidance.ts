import type { SubagentRegistryStatus, SubagentRuntimeStatus } from '../types/types';

export interface SubagentBlockerInput {
  status?: SubagentRuntimeStatus | SubagentRegistryStatus | string;
  stopReason?: string;
  objective?: string;
  lastTool?: string;
  blockers?: string;
  nextAction?: string;
}

export interface SubagentBlockerGuidance {
  title: string;
  description: string;
  nextAction: string;
  tone: 'warning' | 'info' | 'neutral';
}

function normalizeText(...values: Array<string | undefined>): string {
  return values
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(' ')
    .toLowerCase();
}

function describeTarget(input: SubagentBlockerInput): string {
  const target = input.objective || input.lastTool || '后台 Agent';
  return target.trim();
}

export function getSubagentBlockerGuidance(input: SubagentBlockerInput): SubagentBlockerGuidance {
  const status = String(input.status || '').toLowerCase();
  const reasonText = normalizeText(input.stopReason, input.blockers, input.nextAction, input.lastTool);
  const target = describeTarget(input);

  if (status === 'cancelled' || /cancelled|canceled|user stopped|用户取消|已取消/.test(reasonText)) {
    return {
      title: '后台 Agent 已停止',
      description: `${target} 已停止，不会继续占用后台 Agent 并发额度。`,
      nextAction: '如果仍需要继续，请重新派发，并补充更明确的目标或输入数据。',
      tone: 'neutral',
    };
  }

  if (
    /401|403|unauthorized|forbidden|auth|login|cookie|session|token expired|认证|鉴权|登录|未登录|无权限|权限不足/.test(reasonText)
  ) {
    return {
      title: '需要登录或提供导出数据',
      description: `${target} 被登录态或访问权限挡住，后台 Agent 无法继续自动读取页面数据。`,
      nextAction: '请先在浏览器登录对应系统，或直接导出/粘贴页面数据后再继续分析。',
      tone: 'warning',
    };
  }

  if (
    /mcp|api[_-]?key|token|secret|env|environment|root|workspace|config|配置|密钥|环境变量|路径|根目录/.test(reasonText)
  ) {
    return {
      title: '需要补全 MCP 配置',
      description: `${target} 缺少必要的 MCP 配置或运行参数，当前结果不可继续依赖。`,
      nextAction: '请到 MCP 设置中补全必填字段，然后点击重新检测；检测通过后再重新派发。',
      tone: 'warning',
    };
  }

  if (/not found|no match|empty|missing|缺失|没有找到|空结果|无匹配/.test(reasonText)) {
    return {
      title: '需要补充信息',
      description: `${target} 没有找到足够证据，继续自动探索的收益很低。`,
      nextAction: '请补充更具体的文件、链接、错误日志或期望输出，再让 Agent 继续。',
      tone: 'info',
    };
  }

  return {
    title: '需要补充信息',
    description: `${target} 已阻塞，需要父任务或用户补充下一步条件。`,
    nextAction: input.nextAction?.trim() || '请补充缺失输入，或取消当前 Agent 后重新派发更明确的任务。',
    tone: 'info',
  };
}
