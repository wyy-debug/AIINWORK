import { Bot, X } from 'lucide-react';

import type { AgentConfig } from '../../../../types/agent';
import { isDialogAnswersComplete, normalizeDialogAnswersForSubmit, type DialogAnswers } from '../../utils/agentTemplateDialogs';

import AgentTemplateDialogForm from './AgentTemplateDialogForm';

type AgentLaunchDialogProps = {
  agent: AgentConfig;
  answers: DialogAnswers;
  selectedPresetId: string;
  isLoading?: boolean;
  onAnswersChange: (answers: DialogAnswers) => void;
  onPresetChange: (presetId: string) => void;
  onCancel: () => void;
  onConfirm: (answers: DialogAnswers, launchPresetId: string) => void;
};

export default function AgentLaunchDialog({
  agent,
  answers,
  selectedPresetId,
  isLoading,
  onAnswersChange,
  onPresetChange,
  onCancel,
  onConfirm,
}: AgentLaunchDialogProps) {
  const schema = agent.templateDialogs?.launch;
  const canConfirm = isDialogAnswersComplete(schema, answers);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="break-words text-base font-semibold text-foreground">{agent.name} launch</h3>
              <p className="mt-1 break-words text-sm leading-5 text-muted-foreground">
                Configure this dispatch before the background agent is launched.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-w-0 overflow-y-auto p-5">
          <AgentTemplateDialogForm
            schema={schema}
            answers={answers}
            selectedPresetId={selectedPresetId}
            titleFallback="Launch configuration"
            onAnswersChange={onAnswersChange}
            onPresetChange={onPresetChange}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border p-5">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirm || isLoading}
            onClick={() => onConfirm(normalizeDialogAnswersForSubmit(answers), selectedPresetId)}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            Dispatch
          </button>
        </div>
      </div>
    </div>
  );
}
