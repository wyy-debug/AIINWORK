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
  'subagent-general',
  'subagent-explore',
  'subagent-scout',
  'subagent-reviewer',
  'subagent-debugger',
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
    mode: 'primary',
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
    mode: 'primary',
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
    mode: 'primary',
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
    mode: 'primary',
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
    mode: 'primary',
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
    mode: 'primary',
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
  {
    id: 'subagent-general',
    name: 'General',
    shortName: 'General',
    description: 'General-purpose subagent for complex side tasks that may need multiple steps.',
    mode: 'subagent',
    profileKind: 'build',
    permissionPreset: 'auto-edit',
    modelProfileId: '',
    defaultSkills: [],
    mcpServers: ['kanban'],
    systemPrompt: profilePrompt('general subagent', 'Work independently on the delegated task and return a concise result with changed files, evidence, blockers, and next steps.'),
    templateRuntime: {
      permissionMode: 'acceptEdits',
      tools: ['Read', 'Grep', 'Glob', 'Edit', 'MultiEdit', 'Write', 'Bash'],
      disallowedTools: ['TodoWrite'],
    },
  },
  {
    id: 'subagent-explore',
    name: 'Explore',
    shortName: 'Explore',
    description: 'Fast read-only subagent for code search, file discovery, and architecture tracing.',
    mode: 'subagent',
    profileKind: 'explore',
    permissionPreset: 'suggest',
    modelProfileId: '',
    defaultSkills: [],
    mcpServers: ['kanban'],
    systemPrompt: profilePrompt('explore subagent', 'Stay read-only. Search the repo, summarize evidence, and avoid edits or mutating commands.'),
    templateRuntime: {
      permissionMode: 'plan',
      tools: ['Read', 'Grep', 'Glob'],
      disallowedTools: SAFE_DENIED_TOOLS,
    },
  },
  {
    id: 'subagent-scout',
    name: 'Scout',
    shortName: 'Scout',
    description: 'Read-only subagent for external docs, dependency research, and upstream comparison.',
    mode: 'subagent',
    profileKind: 'explore',
    permissionPreset: 'suggest',
    modelProfileId: '',
    defaultSkills: [],
    mcpServers: ['kanban'],
    systemPrompt: profilePrompt('scout subagent', 'Research external references and dependency behavior. Keep local workspace read-only.'),
    templateRuntime: {
      permissionMode: 'plan',
      tools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
      disallowedTools: SAFE_DENIED_TOOLS,
    },
  },
  {
    id: 'subagent-reviewer',
    name: 'Reviewer',
    shortName: 'Reviewer',
    description: 'Read-only subagent for code review, regression risk, and missing test analysis.',
    mode: 'subagent',
    profileKind: 'review',
    permissionPreset: 'suggest',
    modelProfileId: '',
    defaultSkills: ['code-review-security'],
    mcpServers: ['kanban'],
    systemPrompt: profilePrompt('reviewer subagent', 'Review with findings first. Cite files and lines and do not edit files.'),
    templateRuntime: {
      permissionMode: 'plan',
      tools: ['Read', 'Grep', 'Glob', 'Bash(git diff *)', 'Bash(git status *)'],
      disallowedTools: ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'],
    },
  },
  {
    id: 'subagent-debugger',
    name: 'Debugger',
    shortName: 'Debugger',
    description: 'Focused subagent for reproducing and isolating defects before a fix is applied.',
    mode: 'subagent',
    profileKind: 'debug',
    permissionPreset: 'auto-edit',
    modelProfileId: '',
    defaultSkills: ['systematic-debugging'],
    mcpServers: ['kanban'],
    systemPrompt: profilePrompt('debugger subagent', 'Reproduce or isolate the issue, then report root cause and a minimal fix path.'),
    templateRuntime: {
      permissionMode: 'acceptEdits',
      tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'MultiEdit'],
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
    mode: profile.mode || 'all',
    hidden: false,
    color: profile.mode === 'subagent' ? 'cyan' : '',
    maxTurns: 0,
    permission: profile.mode === 'primary'
      ? { task: { '*': 'ask', 'subagent-explore': 'allow', 'subagent-scout': 'allow', 'subagent-reviewer': 'ask', 'subagent-debugger': 'ask', 'subagent-general': 'ask' } }
      : {},
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
