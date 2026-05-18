export const DEFAULT_AGENT_PROFILE_KIND = 'build';

const READ_TOOLS = Object.freeze([
  'Read',
  'Grep',
  'Glob',
  'TodoRead',
]);

const EXPLORATION_TOOLS = Object.freeze([
  ...READ_TOOLS,
  'WebFetch',
  'WebSearch',
  'AskUserQuestion',
  'request_user_input',
]);

const EDIT_TOOLS = Object.freeze([
  ...READ_TOOLS,
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Write',
  'TodoWrite',
  'Bash',
]);

export const BUILT_IN_AGENT_PROFILES = Object.freeze([
  Object.freeze({
    kind: 'plan',
    name: 'Plan',
    shortName: 'Plan',
    description: 'Clarify scope and produce an implementation-ready plan before editing.',
    modelProfileId: '',
    permissionPreset: 'suggest',
    allowedTools: EXPLORATION_TOOLS,
    defaultSkills: Object.freeze([]),
    mcpServers: Object.freeze([]),
    aliases: Object.freeze(['planning', 'planner']),
    systemPrompt: [
      'Agent Profile: Plan.',
      'Work in planning mode. Explore only as needed, do not edit files, do not run mutating commands, and do not carry out the plan.',
      'Produce a concrete plan with assumptions and verification steps when the task is ready for implementation.',
    ].join('\n'),
  }),
  Object.freeze({
    kind: 'build',
    name: 'Build',
    shortName: 'Build',
    description: 'Implement focused changes and verify them with the smallest useful checks.',
    modelProfileId: '',
    permissionPreset: 'auto-edit',
    allowedTools: EDIT_TOOLS,
    defaultSkills: Object.freeze([]),
    mcpServers: Object.freeze([]),
    aliases: Object.freeze(['implement', 'code', 'dev']),
    systemPrompt: [
      'Agent Profile: Build.',
      'Implement the requested change using existing project patterns. Keep edits scoped, preserve user changes, and verify behavior with targeted checks.',
      'Use write/edit tools when the task requires code changes, but keep destructive or broad actions gated by normal permissions.',
    ].join('\n'),
  }),
  Object.freeze({
    kind: 'explore',
    name: 'Explore',
    shortName: 'Explore',
    description: 'Read and map the system without changing files.',
    modelProfileId: '',
    permissionPreset: 'suggest',
    allowedTools: EXPLORATION_TOOLS,
    defaultSkills: Object.freeze([]),
    mcpServers: Object.freeze([]),
    aliases: Object.freeze(['inspect', 'research', 'trace']),
    systemPrompt: [
      'Agent Profile: Explore.',
      'Prioritize source-of-truth inspection, architecture tracing, and concise findings. Do not edit files or run commands that intentionally mutate the workspace.',
      'When the user asks to proceed with implementation, provide the implementation path or ask for a switch to Build mode.',
    ].join('\n'),
  }),
  Object.freeze({
    kind: 'review',
    name: 'Review',
    shortName: 'Review',
    description: 'Review diffs and behavior with findings first.',
    modelProfileId: '',
    permissionPreset: 'suggest',
    allowedTools: EXPLORATION_TOOLS,
    defaultSkills: Object.freeze([]),
    mcpServers: Object.freeze([]),
    aliases: Object.freeze(['audit']),
    systemPrompt: [
      'Agent Profile: Review.',
      'Use a code-review stance. Lead with actionable bugs, regressions, security issues, and missing tests, grounded in file and line references when possible.',
      'Stay read-only first. Do not edit unless the user explicitly asks you to fix the findings after the review.',
    ].join('\n'),
  }),
  Object.freeze({
    kind: 'debug',
    name: 'Debug',
    shortName: 'Debug',
    description: 'Reproduce, isolate, fix, and verify defects.',
    modelProfileId: '',
    permissionPreset: 'auto-edit',
    allowedTools: EDIT_TOOLS,
    defaultSkills: Object.freeze([]),
    mcpServers: Object.freeze([]),
    aliases: Object.freeze(['bug', 'fix', 'diagnose']),
    systemPrompt: [
      'Agent Profile: Debug.',
      'Reproduce or localize the failure before changing code when feasible. Prefer narrow fixes, explain the root cause, and verify the failing path after the patch.',
    ].join('\n'),
  }),
  Object.freeze({
    kind: 'docs',
    name: 'Docs',
    shortName: 'Docs',
    description: 'Write or update documentation, guides, and release notes.',
    modelProfileId: '',
    permissionPreset: 'auto-edit',
    allowedTools: EDIT_TOOLS,
    defaultSkills: Object.freeze([]),
    mcpServers: Object.freeze([]),
    aliases: Object.freeze(['doc', 'documentation', 'guide']),
    systemPrompt: [
      'Agent Profile: Docs.',
      'Focus on accurate, maintainable documentation. Verify code-facing claims against the current repository and keep wording clear for the intended reader.',
    ].join('\n'),
  }),
]);

const PROFILE_BY_KIND = new Map();
const PROFILE_BY_TOKEN = new Map();

for (const profile of BUILT_IN_AGENT_PROFILES) {
  PROFILE_BY_KIND.set(profile.kind, profile);
  PROFILE_BY_TOKEN.set(profile.kind, profile);
  PROFILE_BY_TOKEN.set(String(profile.name).toLowerCase(), profile);
  PROFILE_BY_TOKEN.set(String(profile.shortName).toLowerCase(), profile);
  for (const alias of profile.aliases || []) {
    PROFILE_BY_TOKEN.set(String(alias).trim().toLowerCase(), profile);
  }
}

export function normalizeAgentProfileKind(value, fallback = DEFAULT_AGENT_PROFILE_KIND) {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!token) {
    return fallback || '';
  }

  const profile = PROFILE_BY_TOKEN.get(token);
  return profile?.kind || fallback || '';
}

export function getAgentProfile(value, fallback = DEFAULT_AGENT_PROFILE_KIND) {
  const kind = normalizeAgentProfileKind(value, fallback);
  return PROFILE_BY_KIND.get(kind) || null;
}

export function findAgentProfileByToken(value) {
  const token = String(value || '').trim().toLowerCase().replace(/^@+/, '');
  return PROFILE_BY_TOKEN.get(token) || null;
}

export function resolveAgentProfileInvocation(rawInput, selectedKind = DEFAULT_AGENT_PROFILE_KIND) {
  const input = typeof rawInput === 'string' ? rawInput : '';
  const selectedProfile = getAgentProfile(selectedKind, DEFAULT_AGENT_PROFILE_KIND);
  const trimmedStart = input.trimStart();
  const mentionMatch = trimmedStart.match(/^@([^\s]+)\s*/);

  if (!mentionMatch) {
    return {
      profile: selectedProfile,
      profileKind: selectedProfile?.kind || '',
      content: input,
      source: selectedProfile ? 'selected' : 'none',
      matched: false,
    };
  }

  const mentionedProfile = findAgentProfileByToken(mentionMatch[1]);
  if (!mentionedProfile) {
    return {
      profile: selectedProfile,
      profileKind: selectedProfile?.kind || '',
      content: input,
      source: selectedProfile ? 'selected' : 'none',
      matched: false,
    };
  }

  const content = trimmedStart.slice(mentionMatch[0].length);
  return {
    profile: mentionedProfile,
    profileKind: mentionedProfile.kind,
    content: content.trim() ? content : input,
    source: 'mention',
    matched: true,
  };
}

export function mergeAgentProfileSkillNames(skillNames = [], profile = null) {
  const result = [];
  const seen = new Set();
  for (const skill of [...(skillNames || []), ...(profile?.defaultSkills || [])]) {
    const value = typeof skill === 'string' ? skill.trim() : '';
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result.slice(0, 60);
}

export function buildAgentProfileSystemPrompt(profile) {
  if (!profile) {
    return '';
  }

  const lines = [
    profile.systemPrompt,
    '',
    'Profile runtime contract:',
    `- profileKind: ${profile.kind}`,
    `- permissionPreset: ${profile.permissionPreset}`,
    profile.modelProfileId ? `- modelProfileId: ${profile.modelProfileId}` : '',
    profile.allowedTools?.length ? `- allowedTools: ${profile.allowedTools.join(', ')}` : '',
    profile.defaultSkills?.length ? `- defaultSkills: ${profile.defaultSkills.join(', ')}` : '',
    profile.mcpServers?.length ? `- mcpServers: ${profile.mcpServers.join(', ')}` : '',
    'This profile narrows collaboration style; it does not grant permissions beyond the runtime permission mode and user approvals.',
  ].filter(Boolean);

  return lines.join('\n');
}

export function buildAgentProfileRuntimeOptionsSnapshot(profile) {
  if (!profile) {
    return null;
  }

  return {
    profileKind: profile.kind,
    name: profile.name,
    modelProfileId: profile.modelProfileId || '',
    permissionPreset: profile.permissionPreset,
    allowedTools: [...(profile.allowedTools || [])],
    defaultSkills: [...(profile.defaultSkills || [])],
    mcpServers: [...(profile.mcpServers || [])],
  };
}
