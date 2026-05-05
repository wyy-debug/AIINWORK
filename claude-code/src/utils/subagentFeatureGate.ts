import { isEnvTruthy } from './envUtils.js'

export function areSubagentsEnabled(): boolean {
  return isEnvTruthy(process.env.MTL_CODE_SUBAGENTS_ENABLED)
}

export function areSubagentsHardDisabled(): boolean {
  return !areSubagentsEnabled()
}

export function getSubagentHardDisabledMessage(): string {
  return 'Subagents are disabled for this Argus session. Enable them in Runtime settings or with /subagents, then start a new session.'
}

export function assertSubagentsEnabled(): void {
  if (areSubagentsHardDisabled()) {
    throw new Error(getSubagentHardDisabledMessage())
  }
}
