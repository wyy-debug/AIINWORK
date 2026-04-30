import { PillBar, Pill } from '../../../../../../shared/view/ui';
import SessionProviderLogo from '../../../../../llm-logo-provider/SessionProviderLogo';
import type { AgentProvider } from '../../../../types/types';
import type { AgentSelectorSectionProps } from '../types';

const AGENT_NAMES: Record<AgentProvider, string> = {
  claude: 'MTLCode',
  cursor: 'Cursor',
  codex: 'Codex',
  gemini: 'Gemini',
};

export default function AgentSelectorSection({
  agents,
  selectedAgent,
  onSelectAgent,
}: AgentSelectorSectionProps) {
  return (
    <div className="sticky top-0 z-10 flex-shrink-0 border-b border-border bg-background/95 px-3 py-2 backdrop-blur md:px-4 md:py-3">
      <PillBar className="w-full md:w-auto">
        {agents.map((agent) => {
          const dotColor =
            agent === 'claude' ? 'bg-emerald-500' :
            agent === 'cursor' ? 'bg-purple-500' :
            agent === 'gemini' ? 'bg-indigo-500' : 'bg-foreground/60';

          return (
            <Pill
              key={agent}
              isActive={selectedAgent === agent}
              onClick={() => onSelectAgent(agent)}
              className="min-w-0 flex-1 justify-center md:flex-initial"
            >
              <SessionProviderLogo provider={agent} className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{AGENT_NAMES[agent]}</span>
              <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotColor}`} />
            </Pill>
          );
        })}
      </PillBar>
    </div>
  );
}
