import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";

import { CLAUDE_MODELS } from "../../../../../shared/modelConstants";
import type { ProjectSession, LLMProvider } from "../../../../types/app";
import { Card } from "../../../../shared/view/ui";
import SessionProviderLogo from "../../../llm-logo-provider/SessionProviderLogo";
import { NextTaskBanner } from "../../../task-master";

type ProviderSelectionEmptyStateProps = {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  setProvider: (next: LLMProvider) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  cursorModel: string;
  setCursorModel: (model: string) => void;
  codexModel: string;
  setCodexModel: (model: string) => void;
  geminiModel: string;
  setGeminiModel: (model: string) => void;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  selectedAgentName?: string;
};

const MTL_CODE_PROVIDER: LLMProvider = "claude";
const MTL_CODE_MODEL_LABEL = CLAUDE_MODELS.OPTIONS[0]?.label || "MTLCode";

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  setProvider,
  setClaudeModel,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
  selectedAgentName,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation("chat");

  useEffect(() => {
    setProvider(MTL_CODE_PROVIDER);
    setClaudeModel(CLAUDE_MODELS.DEFAULT);
    localStorage.setItem("selected-provider", MTL_CODE_PROVIDER);
    localStorage.setItem("claude-model", CLAUDE_MODELS.DEFAULT);
  }, [setClaudeModel, setProvider]);

  const nextTaskPrompt = t("tasks.nextTaskPrompt", {
    defaultValue: "Start the next task",
  });

  if (!selectedSession && !currentSessionId) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {t("providerSelection.mtlCodeTitle", {
                defaultValue: "MTLCode",
              })}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("providerSelection.mtlCodeDescription", {
                defaultValue: "Start a new conversation with MTLCode.",
              })}
            </p>
          </div>

          <Card className="mx-auto max-w-xs border-border/60">
            <div className="flex items-center gap-2 p-3">
              <SessionProviderLogo
                provider={MTL_CODE_PROVIDER}
                className="h-5 w-5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-foreground">
                    MTL-Code
                  </span>
                  <span className="text-xs text-muted-foreground">/</span>
                  <span className="truncate text-xs text-foreground">
                    {MTL_CODE_MODEL_LABEL}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t("providerSelection.singleModel", {
                    defaultValue: "Single MTLCode model",
                  })}
                </p>
              </div>
            </div>
          </Card>

          {selectedAgentName && (
            <div className="mx-auto mt-3 flex max-w-xs items-center gap-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-left">
              <Bot className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-primary">Agent</div>
                <div className="truncate text-xs font-semibold text-foreground">{selectedAgentName}</div>
              </div>
            </div>
          )}

          <p className="mt-4 text-center text-sm text-muted-foreground/70">
            {t("providerSelection.readyPrompt.mtlCode", {
              defaultValue: "Ready to use MTLCode. Start typing your message below.",
            })}
          </p>

          {tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner
                onStartTask={() => setInput(nextTaskPrompt)}
                onShowAllTasks={onShowAllTasks}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (selectedSession) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md px-6 text-center">
          <p className="mb-1.5 text-lg font-semibold text-foreground">
            {t("session.continue.title")}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("session.continue.description")}
          </p>

          {tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner
                onStartTask={() => setInput(nextTaskPrompt)}
                onShowAllTasks={onShowAllTasks}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
