import { isEnvTruthy } from './envUtils.js'

export function areGoalsEnabled(): boolean {
  return isEnvTruthy(process.env.MTL_CODE_GOALS_ENABLED)
}

export function areGoalsHardDisabled(): boolean {
  return !areGoalsEnabled()
}

export function getGoalsHardDisabledMessage(): string {
  return 'Goals are disabled for this Argus session. Enable them in Runtime settings, then start a new session.'
}

export function assertGoalsEnabled(): void {
  if (areGoalsHardDisabled()) {
    throw new Error(getGoalsHardDisabledMessage())
  }
}
