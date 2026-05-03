import {
  formatContextBudgetTooltip,
  formatTokenCount,
  type ContextBudget,
} from '../../utils/contextBudget';

type TokenUsagePieProps = {
  budget: ContextBudget | null;
};

export default function TokenUsagePie({ budget }: TokenUsagePieProps) {
  const used = budget?.current.used ?? 0;
  const total = budget?.current.total ?? 0;

  if (used == null || total == null || total <= 0) return null;

  const percentage = Math.min(100, budget?.current.percent ?? (used / total) * 100);
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  // Color based on usage level
  const getColor = () => {
    if (percentage < 50) return '#3b82f6'; // blue
    if (percentage < 75) return '#f59e0b'; // orange
    return '#ef4444'; // red
  };

  const title = budget ? formatContextBudgetTooltip(budget) : `${used.toLocaleString()} / ${total.toLocaleString()} tokens`;

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400" title={title}>
      <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90 transform">
        {/* Background circle */}
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-gray-300 dark:text-gray-600"
        />
        {/* Progress circle */}
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="font-medium">{percentage.toFixed(1)}%</span>
      {budget && (
        <span className="hidden max-w-[150px] truncate text-muted-foreground md:inline">
          当前 {formatTokenCount(budget.current.used)} / {formatTokenCount(budget.window.tokens)}
          <span className="mx-1">·</span>
          累计 {formatTokenCount(budget.cumulative.used)}
        </span>
      )}
    </div>
  );
}
