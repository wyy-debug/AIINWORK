export type ContextBudgetBreakdown = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

export type ContextBudgetSection = {
  used: number;
  total: number;
  percent: number;
  breakdown: ContextBudgetBreakdown;
};

export type ContextBudget = {
  current: ContextBudgetSection;
  cumulative: ContextBudgetSection;
  window: {
    tokens: number;
    model: string | null;
    modelProfileId: string | null;
    source: string;
  };
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeBreakdown(value: unknown): ContextBudgetBreakdown {
  const data = isRecord(value) ? value : {};
  return {
    input: readNumber(data.input),
    output: readNumber(data.output),
    cacheRead: readNumber(data.cacheRead),
    cacheCreation: readNumber(data.cacheCreation),
  };
}

function normalizeSection(value: unknown, fallbackTotal = 0): ContextBudgetSection {
  const data = isRecord(value) ? value : {};
  const used = readNumber(data.used);
  const total = readNumber(data.total, fallbackTotal);
  return {
    used,
    total,
    percent: readNumber(data.percent, total > 0 ? Math.round((used / total) * 10_000) / 100 : 0),
    breakdown: normalizeBreakdown(data.breakdown),
  };
}

export function normalizeContextBudget(value: unknown): ContextBudget | null {
  const envelope = isRecord(value) && isRecord(value.contextBudget)
    ? value.contextBudget
    : value;

  if (isRecord(envelope) && isRecord(envelope.current) && isRecord(envelope.cumulative)) {
    const windowData = isRecord(envelope.window) ? envelope.window : {};
    const tokens = readNumber(windowData.tokens, readNumber(envelope.current.total, 0));
    return {
      current: normalizeSection(envelope.current, tokens),
      cumulative: normalizeSection(envelope.cumulative, tokens),
      window: {
        tokens,
        model: typeof windowData.model === 'string' && windowData.model.trim() ? windowData.model : null,
        modelProfileId: typeof windowData.modelProfileId === 'string' && windowData.modelProfileId.trim()
          ? windowData.modelProfileId
          : null,
        source: typeof windowData.source === 'string' && windowData.source.trim() ? windowData.source : 'unknown',
      },
      updatedAt: typeof envelope.updatedAt === 'string' ? envelope.updatedAt : new Date().toISOString(),
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const used = readNumber(value.used);
  const total = readNumber(value.total);
  if (total <= 0) {
    return null;
  }

  const breakdown = normalizeBreakdown(value.breakdown);
  const current = {
    used,
    total,
    percent: Math.round((used / total) * 10_000) / 100,
    breakdown,
  };

  return {
    current,
    cumulative: current,
    window: {
      tokens: total,
      model: null,
      modelProfileId: null,
      source: 'legacy',
    },
    updatedAt: new Date().toISOString(),
  };
}

export function formatTokenCount(value: unknown): string {
  const numeric = readNumber(value);
  if (numeric >= 1_000_000) {
    return `${Number((numeric / 1_000_000).toFixed(numeric % 1_000_000 === 0 ? 0 : 1))}M`;
  }
  if (numeric >= 1_000) {
    return `${Number((numeric / 1_000).toFixed(numeric % 1_000 === 0 ? 0 : 1))}K`;
  }
  return numeric.toLocaleString();
}

export function formatFullTokenCount(value: unknown): string {
  return readNumber(value).toLocaleString();
}

export function formatContextBudgetTooltip(budget: ContextBudget): string {
  const current = budget.current.breakdown;
  const cumulative = budget.cumulative.breakdown;
  return [
    `当前上下文: ${formatFullTokenCount(budget.current.used)} / ${formatFullTokenCount(budget.current.total)} (${budget.current.percent.toFixed(2)}%)`,
    `  input ${formatFullTokenCount(current.input)} | cache read ${formatFullTokenCount(current.cacheRead)} | cache create ${formatFullTokenCount(current.cacheCreation)}`,
    `累计消耗: ${formatFullTokenCount(budget.cumulative.used)} tokens`,
    `  input ${formatFullTokenCount(cumulative.input)} | output ${formatFullTokenCount(cumulative.output)} | cache read ${formatFullTokenCount(cumulative.cacheRead)} | cache create ${formatFullTokenCount(cumulative.cacheCreation)}`,
    `窗口: ${formatTokenCount(budget.window.tokens)} | 模型: ${budget.window.model || '未知'} | 来源: ${budget.window.source}`,
  ].join('\n');
}
