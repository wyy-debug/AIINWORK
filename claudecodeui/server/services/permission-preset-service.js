const PRESET_IDS = ['suggest', 'auto-edit', 'full-auto', 'enterprise-safe'];

const DESTRUCTIVE_DENIES = [
  'Bash(git reset --hard)',
  'Bash(git checkout -- *)',
  'Bash(rm -rf *)',
  'Bash(del /s /q *)',
  'Bash(format *)',
];

const PRESETS = Object.freeze([
  {
    id: 'suggest',
    label: 'Suggest',
    description: 'Ask before edits and sensitive tool calls.',
    permissionMode: 'default',
    skipPermissions: false,
    allowedTools: [],
    disallowedTools: [],
  },
  {
    id: 'auto-edit',
    label: 'Auto Edit',
    description: 'Allow routine file edits while keeping shell and dangerous actions gated.',
    permissionMode: 'acceptEdits',
    skipPermissions: false,
    allowedTools: [],
    disallowedTools: DESTRUCTIVE_DENIES.slice(0, 2),
  },
  {
    id: 'full-auto',
    label: 'Full Auto',
    description: 'Let the agent run without confirmation for trusted local tasks.',
    permissionMode: 'bypassPermissions',
    skipPermissions: true,
    allowedTools: [],
    disallowedTools: [],
  },
  {
    id: 'enterprise-safe',
    label: 'Enterprise Safe',
    description: 'Keep confirmation on and block known destructive commands.',
    permissionMode: 'default',
    skipPermissions: false,
    allowedTools: [],
    disallowedTools: DESTRUCTIVE_DENIES,
  },
]);

function uniqStrings(...groups) {
  const seen = new Set();
  const result = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const entry of group) {
      const text = typeof entry === 'string' ? entry.trim() : '';
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      result.push(text);
    }
  }
  return result;
}

export function normalizePermissionPreset(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return PRESET_IDS.includes(normalized) ? normalized : 'suggest';
}

export function listPermissionPresets() {
  return PRESETS.map((preset) => ({
    ...preset,
    allowedTools: [...preset.allowedTools],
    disallowedTools: [...preset.disallowedTools],
  }));
}

export function getPermissionPreset(value) {
  const id = normalizePermissionPreset(value);
  return listPermissionPresets().find((preset) => preset.id === id) || listPermissionPresets()[0];
}

export function resolvePermissionPresetRuntime(value, baseOptions = {}) {
  const preset = getPermissionPreset(value);
  const baseToolSettings = baseOptions.toolsSettings && typeof baseOptions.toolsSettings === 'object'
    ? baseOptions.toolsSettings
    : {};

  const forceSafe = preset.id === 'enterprise-safe';
  const permissionMode = forceSafe
    ? preset.permissionMode
    : preset.permissionMode || baseOptions.permissionMode || 'default';
  const skipPermissions = forceSafe ? false : Boolean(preset.skipPermissions);

  return {
    permissionPreset: preset.id,
    permissionMode,
    skipPermissions,
    toolsSettings: {
      ...baseToolSettings,
      allowedTools: forceSafe
        ? uniqStrings(preset.allowedTools)
        : uniqStrings(baseToolSettings.allowedTools, preset.allowedTools),
      disallowedTools: forceSafe
        ? uniqStrings(baseToolSettings.disallowedTools, preset.disallowedTools)
        : uniqStrings(baseToolSettings.disallowedTools, preset.disallowedTools),
      skipPermissions,
      permissionMode,
    },
  };
}
