import {
  buildAgentProfileRuntimeOptionsSnapshot,
  buildAgentProfileSystemPrompt,
  getAgentProfile,
  mergeAgentProfileSkillNames,
  resolveAgentProfileInvocation,
} from '../../shared/agentProfiles.js';
import {
  buildPermissionPresetRuntimeSnapshot,
  getPermissionPreset,
  mergeToolSettingsWithPermissionPreset,
} from '../../shared/permissionPresets.js';

function appendPrompt(existing, addition) {
  const current = typeof existing === 'string' ? existing.trim() : '';
  const next = typeof addition === 'string' ? addition.trim() : '';
  if (!next) {
    return current || undefined;
  }
  if (!current) {
    return next;
  }
  return `${current}\n\n${next}`;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const normalized = typeof item === 'string' ? item.trim() : '';
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function shouldApplyProfile(data, invocation, selectedProfile) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  if (invocation?.matched) {
    return true;
  }
  return Boolean(selectedProfile && typeof data?.options?.agentProfileKind === 'string');
}

export function applyAgentProfileRuntimeToChatCommand(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const options = data.options && typeof data.options === 'object' ? data.options : {};
  const selectedProfile = getAgentProfile(options.agentProfileKind, '');
  const invocation = resolveAgentProfileInvocation(
    typeof data.command === 'string' ? data.command : '',
    selectedProfile?.kind || '',
  );
  const profile = invocation.matched ? invocation.profile : selectedProfile;

  if (!shouldApplyProfile(data, invocation, profile)) {
    return data;
  }

  const profilePrompt = buildAgentProfileSystemPrompt(profile);
  const sessionSkills = mergeAgentProfileSkillNames(
    normalizeStringList(options.sessionSkills),
    profile,
  );
  const profileSnapshot = buildAgentProfileRuntimeOptionsSnapshot(profile);
  const permissionPresetId = options.permissionPreset || profile.permissionPreset;
  const permissionPreset = getPermissionPreset(permissionPresetId);
  const toolsSettings = mergeToolSettingsWithPermissionPreset(options.toolsSettings, permissionPresetId);

  return {
    ...data,
    command: invocation.matched ? invocation.content : data.command,
    options: {
      ...options,
      agentProfileKind: profile.kind,
      agentProfileSource: invocation.matched ? 'mention' : 'selected',
      agentProfile: profileSnapshot,
      permissionPreset: permissionPreset?.id || permissionPresetId || '',
      permissionPresetSnapshot: buildPermissionPresetRuntimeSnapshot(permissionPresetId),
      permissionMode: permissionPreset?.permissionMode || options.permissionMode,
      toolsSettings,
      skipPermissions: toolsSettings.skipPermissions === true || options.skipPermissions === true,
      ...(profile.modelProfileId && !options.modelProfileId ? { modelProfileId: profile.modelProfileId } : {}),
      sessionSkills,
      appendSystemPrompt: appendPrompt(options.appendSystemPrompt, profilePrompt),
    },
  };
}
