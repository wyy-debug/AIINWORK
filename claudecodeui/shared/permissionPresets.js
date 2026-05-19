export const DEFAULT_PERMISSION_PRESET_ID = 'auto-edit';

const READ_TOOLS = Object.freeze([
  'Read',
  'Grep',
  'Glob',
  'TodoRead',
]);

const EDIT_TOOLS = Object.freeze([
  ...READ_TOOLS,
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Write',
  'TodoWrite',
]);

export const PERMISSION_PRESETS = Object.freeze([
  Object.freeze({
    id: 'suggest',
    name: 'Suggest',
    description: 'Read, inspect, and propose changes without directly editing files.',
    permissionMode: 'plan',
    allowedTools: READ_TOOLS,
    disallowedTools: Object.freeze(['Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Bash']),
    skipPermissions: false,
    risk: 'low',
    warning: '',
  }),
  Object.freeze({
    id: 'auto-edit',
    name: 'Auto Edit',
    description: 'Allow normal file edits while shell commands and risky tools remain policy-gated.',
    permissionMode: 'acceptEdits',
    allowedTools: EDIT_TOOLS,
    disallowedTools: Object.freeze([]),
    skipPermissions: false,
    risk: 'medium',
    warning: '',
  }),
  Object.freeze({
    id: 'full-auto',
    name: 'Full Auto',
    description: 'Permit broad autonomous execution in trusted local workspaces only.',
    permissionMode: 'bypassPermissions',
    allowedTools: Object.freeze([]),
    disallowedTools: Object.freeze([]),
    skipPermissions: true,
    risk: 'high',
    warning: 'High risk: this can bypass normal approval prompts. Use only in trusted repositories.',
  }),
  Object.freeze({
    id: 'enterprise-safe',
    name: 'Enterprise Safe',
    description: 'Keep provider approvals active and block destructive command patterns.',
    permissionMode: 'default',
    allowedTools: READ_TOOLS,
    disallowedTools: Object.freeze([
      'Bash(rm:*)',
      'Bash(git reset --hard:*)',
      'Bash(git clean:*)',
      'Bash(powershell Remove-Item -Recurse:*)',
    ]),
    skipPermissions: false,
    risk: 'low',
    warning: 'Never bypasses provider or enterprise safety controls.',
  }),
]);

const LEGACY_PRESET_ALIASES = new Map([
  ['default', 'enterprise-safe'],
  ['acceptedits', 'auto-edit'],
  ['accept-edits', 'auto-edit'],
  ['bypasspermissions', 'full-auto'],
  ['bypass-permissions', 'full-auto'],
  ['plan', 'suggest'],
  ['autoedit', 'auto-edit'],
  ['auto_edit', 'auto-edit'],
  ['fullauto', 'full-auto'],
  ['full_auto', 'full-auto'],
  ['enterprise', 'enterprise-safe'],
  ['safe', 'enterprise-safe'],
]);

const PRESET_BY_ID = new Map(PERMISSION_PRESETS.map((preset) => [preset.id, preset]));

export function normalizePermissionPresetId(value, fallback = DEFAULT_PERMISSION_PRESET_ID) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return fallback || '';
  }
  const token = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return PRESET_BY_ID.has(token) ? token : LEGACY_PRESET_ALIASES.get(token) || fallback || '';
}

export function getPermissionPreset(value, fallback = DEFAULT_PERMISSION_PRESET_ID) {
  const id = normalizePermissionPresetId(value, fallback);
  return PRESET_BY_ID.get(id) || null;
}

export function mergeToolSettingsWithPermissionPreset(toolSettings = {}, presetValue = DEFAULT_PERMISSION_PRESET_ID) {
  const preset = getPermissionPreset(presetValue);
  const source = toolSettings && typeof toolSettings === 'object' ? toolSettings : {};
  const appendUnique = (left = [], right = []) => {
    const seen = new Set();
    const result = [];
    for (const item of [...left, ...right]) {
      const value = typeof item === 'string' ? item.trim() : '';
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  };

  if (!preset) {
    return {
      ...source,
      allowedTools: Array.isArray(source.allowedTools) ? source.allowedTools : [],
      disallowedTools: Array.isArray(source.disallowedTools) ? source.disallowedTools : [],
      skipPermissions: source.skipPermissions === true,
    };
  }

  return {
    ...source,
    allowedTools: appendUnique(preset.allowedTools, source.allowedTools),
    disallowedTools: appendUnique(preset.disallowedTools, source.disallowedTools),
    skipPermissions: preset.skipPermissions === true || source.skipPermissions === true,
  };
}

export function buildPermissionPresetRuntimeSnapshot(value) {
  const preset = getPermissionPreset(value);
  if (!preset) {
    return null;
  }
  return {
    id: preset.id,
    name: preset.name,
    permissionMode: preset.permissionMode,
    allowedTools: [...preset.allowedTools],
    disallowedTools: [...preset.disallowedTools],
    skipPermissions: preset.skipPermissions,
    risk: preset.risk,
    warning: preset.warning,
  };
}
