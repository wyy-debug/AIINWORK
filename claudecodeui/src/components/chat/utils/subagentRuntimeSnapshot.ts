import type { LLMProvider } from '../../../types/app';
import type { AgentAppBinding, AgentTemplateSelectedDependencies } from '../../../types/agent';
import type { PermissionMode } from '../types/types';

type ToolSettingsInput = {
  allowedTools?: unknown;
  disallowedTools?: unknown;
  skipPermissions?: unknown;
  permissionMode?: unknown;
  [key: string]: unknown;
};

export type SubagentRuntimeSnapshotInput = {
  provider: LLMProvider | string;
  model: string;
  modelProfileId?: string;
  projectPath?: string;
  permissionMode?: PermissionMode | string;
  toolsSettings?: ToolSettingsInput;
  sessionSkills?: string[];
  agentAppBindings?: AgentAppBinding[];
  selectedDependencies?: AgentTemplateSelectedDependencies;
};

export type SubagentRuntimeSnapshot = {
  provider: string;
  model: string;
  modelProfileId: string;
  projectPath: string;
  permissionMode: string;
  toolsSettings: {
    allowedTools: string[];
    disallowedTools: string[];
    skipPermissions: boolean;
    permissionMode: string;
  };
  sessionSkills: string[];
  agentAppBindings: AgentAppBinding[];
  selectedDependencies: {
    skills: string[];
    mcpServers: string[];
    modelProfiles: string[];
  };
};

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = normalizeString(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function compactIdentityText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildSubagentRuntimeSnapshot(input: SubagentRuntimeSnapshotInput): SubagentRuntimeSnapshot {
  const toolsSettings = input.toolsSettings || {};
  const permissionMode = normalizeString(input.permissionMode)
    || normalizeString(toolsSettings.permissionMode)
    || 'default';
  const selectedDependencies = input.selectedDependencies || {};

  return {
    provider: normalizeString(input.provider),
    model: normalizeString(input.model),
    modelProfileId: normalizeString(input.modelProfileId),
    projectPath: normalizeString(input.projectPath),
    permissionMode,
    toolsSettings: {
      allowedTools: normalizeStringList(toolsSettings.allowedTools),
      disallowedTools: normalizeStringList(toolsSettings.disallowedTools),
      skipPermissions: Boolean(toolsSettings.skipPermissions),
      permissionMode,
    },
    sessionSkills: normalizeStringList(input.sessionSkills),
    agentAppBindings: Array.isArray(input.agentAppBindings) ? input.agentAppBindings : [],
    selectedDependencies: {
      skills: normalizeStringList(selectedDependencies.skills),
      mcpServers: normalizeStringList(selectedDependencies.mcpServers),
      modelProfiles: normalizeStringList(selectedDependencies.modelProfiles),
    },
  };
}

export function getSubagentRuntimeDispatchPlanId({
  prompt,
  agentId,
  approvedPlan,
}: {
  prompt: string;
  agentId?: string;
  approvedPlan?: string;
}): string {
  const normalizedAgentId = compactIdentityText(agentId || '__default__');
  const normalizedPrompt = compactIdentityText(prompt || '');
  const normalizedPlan = compactIdentityText(approvedPlan || '');
  return `dispatch:${normalizedAgentId}:${normalizedPrompt}:${normalizedPlan}`;
}
