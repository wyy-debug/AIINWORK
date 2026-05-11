export type SpawnAgentForkOverrideInput = {
  fork_turns?: string
  agent_type?: string
  model?: string
  reasoning_effort?: string
}

function hasNonEmptyOverride(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

export function hasFullHistoryForkOverride(
  input: SpawnAgentForkOverrideInput,
): boolean {
  const forkTurns = input.fork_turns?.trim().toLowerCase()
  return (
    forkTurns === 'all' &&
    (hasNonEmptyOverride(input.agent_type) ||
      hasNonEmptyOverride(input.model) ||
      hasNonEmptyOverride(input.reasoning_effort))
  )
}

export function normalizeForkTurnsForOverrides(
  input: SpawnAgentForkOverrideInput,
): string | undefined {
  return hasFullHistoryForkOverride(input) ? 'none' : input.fork_turns
}
