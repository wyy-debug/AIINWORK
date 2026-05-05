export const SUBAGENTS_HARD_DISABLED = true

export function areSubagentsHardDisabled(): boolean {
  return SUBAGENTS_HARD_DISABLED
}

export function getSubagentHardDisabledMessage(): string {
  return 'Subagents are temporarily disabled in MTL-Code. This feature is being rebuilt and cannot be enabled until the new runtime is ready.'
}

export function assertSubagentsEnabled(): void {
  if (areSubagentsHardDisabled()) {
    throw new Error(getSubagentHardDisabledMessage())
  }
}
