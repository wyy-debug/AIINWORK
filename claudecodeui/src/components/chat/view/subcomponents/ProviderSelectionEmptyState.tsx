import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";

import { CLAUDE_MODELS } from "../../../../../shared/modelConstants";
import type { ProjectSession, LLMProvider } from "../../../../types/app";
import { Card } from "../../../../shared/view/ui";
import type { AgentConfig } from "../../../../types/agent";
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
  isConversationSpace?: boolean;
  agents?: AgentConfig[];
  selectedAgentName?: string;
  agentChoiceState?: "pending" | "default" | "agent";
  onUseDefaultAgent?: () => void;
  onSelectConversationAgent?: (agentId: string) => void;
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
  agents = [],
  selectedAgentName,
  agentChoiceState = "default",
  onUseDefaultAgent,
  onSelectConversationAgent,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation("chat");
  const [draftAgentId, setDraftAgentId] = useState("");
  const enabledAgents = useMemo(
    () => agents.filter((agent) => agent.status === "enabled"),
    [agents],
  );

  useEffect(() => {
    setProvider(MTL_CODE_PROVIDER);
    setClaudeModel(CLAUDE_MODELS.DEFAULT);
    localStorage.setItem("selected-provider", MTL_CODE_PROVIDER);
    localStorage.setItem("claude-model", CLAUDE_MODELS.DEFAULT);
  }, [setClaudeModel, setProvider]);

  const nextTaskPrompt = t("tasks.nextTaskPrompt", {
    defaultValue: "Start the next task",
  });

  useEffect(() => {
    if (agentChoiceState !== "pending") {
      return;
    }
    if (!draftAgentId && enabledAgents.length > 0) {
      setDraftAgentId(enabledAgents[0].id);
    }
  }, [agentChoiceState, draftAgentId, enabledAgents]);

  const showAgentChoice =
    agentChoiceState === "pending" && !selectedAgentName && enabledAgents.length > 0;

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

          {showAgentChoice && (
            <div className="mx-auto mt-3 max-w-xs rounded-xl border border-border/70 bg-muted/25 p-3 text-left">
              <div className="flex items-start gap-2">
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground">这次新对话要使用 Agent 吗？</p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    项目对话始终使用默认配置；独立对话可以选择一个 Agent。
                  </p>
                </div>
              </div>

              {enabledAgents.length > 0 && (
                <select
                  value={draftAgentId}
                  onChange={(event) => setDraftAgentId(event.target.value)}
                  className="mt-3 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                >
                  {enabledAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.shortName || agent.name}
                    </option>
                  ))}
                </select>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onUseDefaultAgent}
                  className="h-9 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                >
                  否，默认对话
                </button>
                <button
                  type="button"
                  disabled={!draftAgentId || enabledAgents.length === 0}
                  onClick={() => draftAgentId && onSelectConversationAgent?.(draftAgentId)}
                  className="h-9 rounded-lg bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  是，使用 Agent
                </button>
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
