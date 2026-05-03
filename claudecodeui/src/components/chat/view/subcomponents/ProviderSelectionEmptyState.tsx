import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Check, ChevronDown } from "lucide-react";

import { CLAUDE_MODELS } from "../../../../../shared/modelConstants";
import type { ProjectSession, LLMProvider } from "../../../../types/app";
import type { AgentConfig } from "../../../../types/agent";
import { NextTaskBanner } from "../../../task-master";

import RuntimeModelSwitcher from "./RuntimeModelSwitcher";

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
  hasConversationContext?: boolean;
  selectedModelProfileId?: string;
  onModelProfileChange?: (profileId: string) => void;
};

type AgentChoiceDropdownProps = {
  agents: AgentConfig[];
  value: string;
  onChange: (agentId: string) => void;
};

const MTL_CODE_PROVIDER: LLMProvider = "claude";

function AgentChoiceDropdown({ agents, value, onChange }: AgentChoiceDropdownProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectedAgent = agents.find((agent) => agent.id === value) || agents[0] || null;

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={wrapperRef} className="relative mt-3">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-left text-xs shadow-sm transition-colors hover:bg-muted/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 truncate font-medium text-foreground">
            {selectedAgent?.shortName || selectedAgent?.name || "选择 Agent"}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-56 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-xl ring-1 ring-black/5">
          {agents.map((agent) => {
            const selected = agent.id === value;
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => {
                  onChange(agent.id);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <Bot className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {agent.shortName || agent.name}
                </span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  setProvider,
  textareaRef,
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
  hasConversationContext,
  selectedModelProfileId,
  onModelProfileChange,
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
                defaultValue: "Argus",
              })}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("providerSelection.mtlCodeDescription", {
                defaultValue: "Start a new conversation with Argus.",
              })}
            </p>
          </div>

          <RuntimeModelSwitcher
            variant="empty"
            selectedProfileId={selectedModelProfileId}
            onProfileChange={onModelProfileChange}
            onRequestInputFocus={() => textareaRef.current?.focus()}
            hasConversationContext={hasConversationContext}
          />

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

              <AgentChoiceDropdown
                agents={enabledAgents}
                value={draftAgentId}
                onChange={setDraftAgentId}
              />

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
              defaultValue: "Ready to use Argus. Start typing your message below.",
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

          <div className="mt-5">
            <RuntimeModelSwitcher
              variant="empty"
              selectedProfileId={selectedModelProfileId}
              onProfileChange={onModelProfileChange}
              onRequestInputFocus={() => textareaRef.current?.focus()}
              hasConversationContext={hasConversationContext}
            />
          </div>

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
