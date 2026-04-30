import { useTranslation } from 'react-i18next';

import { cn } from '../../../../../../lib/utils';
import { AGENT_CATEGORIES } from '../../../../constants/constants';
import type { AgentCategoryTabsSectionProps } from '../types';

export default function AgentCategoryTabsSection({
  selectedCategory,
  onSelectCategory,
}: AgentCategoryTabsSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="z-10 flex-shrink-0 border-b border-border bg-background/95 backdrop-blur">
      <div role="tablist" className="flex overflow-x-auto px-2 md:px-4">
        {AGENT_CATEGORIES.map((category) => (
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
            {category === 'model' && t('tabs.model', { defaultValue: 'Model' })}
            {category === 'runtime' && t('tabs.runtime', { defaultValue: 'Runtime' })}
            {category === 'permissions' && t('tabs.permissions')}
            {category === 'mcp' && t('tabs.mcpServers')}
            {category === 'repository' && t('tabs.repository', { defaultValue: 'Repository' })}
          </button>
        ))}
      </div>
    </div>
  );
}
