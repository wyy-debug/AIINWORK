export const AGENT_TOOL_NAME = 'Agent'
export const AGENT_SPAWN_TOOL_NAME = 'AgentSpawn'
// Legacy wire name for backward compat (permission rules, hooks, resumed sessions)
export const LEGACY_AGENT_TOOL_NAME = 'Task'
export const VERIFICATION_AGENT_TYPE = 'verification'

// Built-in agents that run once and return a report. The parent should not
// continue them with legacy SendMessage-style polling or expose runtime ids.
export const ONE_SHOT_BUILTIN_AGENT_TYPES: ReadonlySet<string> = new Set([
  'Explore',
  'Plan',
])
