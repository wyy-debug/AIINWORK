import { useTranslation } from 'react-i18next';

import { cn } from '../../../../../../lib/utils';
import { AGENT_CATEGORIES } from '../../../../constants/constants';
import type { AgentCategory } from '../../../../types/types';
import type { AgentCategoryTabsSectionProps } from '../types';

const CATEGORY_LABELS: Record<AgentCategory, { key: string; defaultValue: string }> = {
  model: { key: 'tabs.model', defaultValue: 'Model' },
  permissions: { key: 'tabs.permissions', defaultValue: 'Permissions' },
  mcp: { key: 'tabs.mcpServers', defaultValue: 'MCP Servers' },
  marketplace: { key: 'tabs.marketplace', defaultValue: 'Marketplace' },
  repository: { key: 'tabs.repository', defaultValue: 'Repository' },
  usage: { key: 'tabs.usage', defaultValue: 'Usage' },
};

export default function AgentCategoryTabsSection({
  selectedCategory,
  onSelectCategory,
}: AgentCategoryTabsSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="z-10 flex-shrink-0 border-b border-border bg-background/95 backdrop-blur">
      <div role="tablist" className="flex overflow-x-auto px-2 md:px-4">
        {AGENT_CATEGORIES.map((category) => {
          const label = CATEGORY_LABELS[category];

          return (
            <button
              key={category}
              role="tab"
              aria-selected={selectedCategory === category}
              onClick={() => onSelectCategory(category)}
              className={cn(
                'whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium touch-manipulation transition-colors duration-150',
                selectedCategory === category
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(label.key, { defaultValue: label.defaultValue })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
