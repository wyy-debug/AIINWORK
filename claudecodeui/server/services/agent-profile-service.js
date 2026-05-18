import {
  normalizePermissionPreset as normalizePermissionPresetId,
  resolvePermissionPresetRuntime,
} from './permission-preset-service.js';

const PROFILE_KINDS = new Set(['plan', 'build', 'explore', 'review', 'debug', 'docs']);
const SAFE_DENIED_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash'];

export const AGENT_PROFILE_IDS = Object.freeze([
  'profile-plan',
  'profile-build',
  'profile-explore',
  'profile-review',
  'profile-debug',
  'profile-docs',
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

function profilePrompt(kind, focus) {
  return [
    `Profile contract: ${kind}.`,
    focus,
    'Respect the selected permission posture and available tools. Do not escalate permissions or bypass user confirmation.',
  ].join('\n');
}

const BUILT_IN_AGENT_PROFILES = Object.freeze([
  {
    id: 'profile-plan',
    name: 'Plan',
    shortName: 'Plan',
    description: 'Turn an ambiguous request into an implementation-ready plan without editing repo files.',
    profileKind: 'plan',
    permissionPreset: 'suggest',
    modelProfileId: '',
    defaultSkills: ['senior-architect', 'information-architect'],
    mcpServers: ['kanban'],
    systemPrompt: profilePrompt('plan', 'Explore read-only context, identify decisions, and produce a concrete plan with risks and tests.'),
    templateRuntime: {
      permissionMode: 'plan',
      tools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'AskUserQuestion'],
      disallowedTools: SAFE_DENIED_TOOLS,
    },
  },
  {
    id: 'profile-build',
    name: 'Build',
    shortName: 'Build',
    description: 'Implement scoped product or code changes using the existing project patterns.',
    profileKind: 'build',
    permissionPreset: 'auto-edit',
    modelProfileId: '',
    defaultSkills: ['test-driven-development'],
    mcpServers: ['kanban'],
    systemPrompt: profilePrompt('build', 'Make focused edits, keep changes tied to the active requirement, and verify with targeted tests.'),
    templateRuntime: {
      permissionMode: 'acceptEdits',
      tools: ['Read', 'Grep', 'Glob', 'Edit', 'MultiEdit', 'Write', 'Bash'],
      disallowedTools: ['Bash(git reset --hard)', 'Bash(git checkout -- *)'],
    },
  },
  {
    id: 'profile-explore',
    name: 'Explore',
    shortName: 'Explore',
    description: 'Inspect code, docs, and dependencies to answer questions without modifying files.',
    profileKind: 'explore',
    permissionPreset: 'suggest',
    modelProfileId: '',
    defaultSkills: [],
    mcpServers: ['kanban'],
    systemPrompt: profilePrompt('explore', 'Gather evidence, map relevant files and flows, and stop short of implementation.'),
    templateRuntime: {
      permissionMode: 'plan',
      tools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
      disallowedTools: SAFE_DENIED_TOOLS,
    },
  },
  {
    id: 'profile-review',
    name: 'Review',
    shortName: 'Review',
    description: 'Review diffs and code paths for bugs, regressions, risk, and missing tests.',
    profileKind: 'review',
    permissionPreset: 'suggest',
    modelProfileId: '',
    defaultSkills: ['code-review-security'],
    mcpServers: ['kanban'],
    systemPrompt: profilePrompt('review', 'Lead with findings, cite files and lines, and keep summaries secondary to risks.'),
    templateRuntime: {
      permissionMode: 'plan',
      tools: ['Read', 'Grep', 'Glob', 'Bash(git diff *)', 'Bash(git status *)'],
      disallowedTools: ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'],
    },
  },
  {
    id: 'profile-debug',
    name: 'Debug',
    shortName: 'Debug',
    description: 'Reproduce failures, isolate root cause, then apply the smallest verified fix.',
    profileKind: 'debug',
    permissionPreset: 'auto-edit',
    modelProfileId: '',
    defaultSkills: ['systematic-debugging', 'test-driven-development'],
    mcpServers: ['kanban'],
    systemPrompt: profilePrompt('debug', 'Reproduce the symptom first, trace the failing path, and preserve evidence in the fix.'),
    templateRuntime: {
      permissionMode: 'acceptEdits',
      tools: ['Read', 'Grep', 'Glob', 'Edit', 'MultiEdit', 'Bash'],
      disallowedTools: ['Bash(git reset --hard)', 'Bash(git checkout -- *)'],
    },
  },
  {
    id: 'profile-docs',
    name: 'Docs',
    shortName: 'Docs',
    description: 'Create and update accurate user-facing or engineering documentation.',
    profileKind: 'docs',
    permissionPreset: 'auto-edit',
    modelProfileId: '',
    defaultSkills: ['agent-file-engine'],
    mcpServers: ['kanban'],
    systemPrompt: profilePrompt('docs', 'Update docs from verified project facts and keep examples aligned with the current codebase.'),
    templateRuntime: {
      permissionMode: 'acceptEdits',
      tools: ['Read', 'Grep', 'Glob', 'Edit', 'MultiEdit', 'Write'],
      disallowedTools: ['Bash(git reset --hard)', 'Bash(git checkout -- *)'],
    },
  },
]);

export function normalizeAgentProfileKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  return PROFILE_KINDS.has(kind) ? kind : '';
}

export function normalizePermissionPreset(value) {
  const raw = String(value || '').trim();
  return raw ? normalizePermissionPresetId(raw) : '';
}

export function getBuiltInAgentProfiles() {
  return BUILT_IN_AGENT_PROFILES.map((profile) => ({
    status: 'enabled',
    scope: 'global',
    modelConfig: {
      provider: 'mtl-code',
      model: 'inherit',
      contextWindowTokens: 200_000,
      temperature: profile.profileKind === 'build' || profile.profileKind === 'debug' ? 0.2 : 0.1,
    },
    repository: `seed/built-in/${profile.id}`,
    channels: [],
    appBindings: profile.mcpServers.map((server) => ({
      slot: server,
      app: `MCP: ${server}`,
      status: 'optional',
    })),
    skills: profile.defaultSkills,
    memory: {
      enabled: false,
      namespace: `agent:${profile.id}:memory`,
      privacy: 'private',
      description: '',
    },
    tools: profile.templateRuntime.tools,
    guardrails: ['Do not bypass the selected permission mode.', 'Preserve unrelated user changes.'],
    triggerRules: {
      mode: 'manual',
      keywords: [profile.name, profile.shortName, profile.profileKind],
      confidenceThreshold: 1,
    },
    version: '1.0.0',
    ...profile,
  }));
}

export function isBuiltInAgentProfileId(value) {
  return AGENT_PROFILE_IDS.includes(String(value || '').trim());
}

export function resolveAgentProfileRuntimeOptions(agent, baseOptions = {}) {
  const runtime = agent?.templateRuntime && typeof agent.templateRuntime === 'object'
    ? agent.templateRuntime
    : {};
  const presetRuntime = agent?.permissionPreset
    ? resolvePermissionPresetRuntime(agent.permissionPreset, baseOptions)
    : null;
  const presetToolSettings = presetRuntime?.toolsSettings && typeof presetRuntime.toolsSettings === 'object'
    ? presetRuntime.toolsSettings
    : {};
  const permissionMode = runtime.permissionMode || presetRuntime?.permissionMode || baseOptions.permissionMode || '';
  const baseToolSettings = Object.keys(presetToolSettings).length > 0
    ? presetToolSettings
    : baseOptions.toolsSettings && typeof baseOptions.toolsSettings === 'object'
    ? baseOptions.toolsSettings
    : {};
  const toolsSettings = {
    ...baseToolSettings,
    allowedTools: uniqStrings(baseToolSettings.allowedTools, runtime.tools, runtime.allowedTools),
    disallowedTools: uniqStrings(baseToolSettings.disallowedTools, runtime.disallowedTools),
    skipPermissions: Boolean(presetRuntime?.skipPermissions),
    permissionMode,
  };

  return {
    permissionMode,
    toolsSettings,
    skipPermissions: Boolean(presetRuntime?.skipPermissions),
    ...(agent?.modelProfileId ? { modelProfileId: agent.modelProfileId } : {}),
    ...(Array.isArray(agent?.mcpServers) && agent.mcpServers.length > 0 ? { mcpServers: agent.mcpServers } : {}),
    ...(agent?.permissionPreset ? { permissionPreset: agent.permissionPreset } : {}),
  };
}
