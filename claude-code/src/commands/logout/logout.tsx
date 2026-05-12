import * as React from 'react'
import { clearTrustedDeviceTokenCache } from '../../bridge/trustedDevice.js'
import { Text } from '@anthropic/ink'
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js'
import {
  getGroveNoticeConfig,
  getGroveSettings,
} from '../../services/api/grove.js'
import { clearPolicyLimitsCache } from '../../services/policyLimits/index.js'
import { clearRemoteManagedSettingsCache } from '../../services/remoteManagedSettings/index.js'
import { getClaudeAIOAuthTokens } from '../../utils/auth.js'
import { clearBetasCaches } from '../../utils/betas.js'
import { clearToolSchemaCache } from '../../utils/toolSchemaCache.js'
import { resetUserCache } from '../../utils/user.js'

const DISABLED_LOGOUT_MESSAGE =
  'Native Claude logout is disabled. Custom model credentials are managed in Argus settings.'

export async function performLogout({
  clearOnboarding = false,
}): Promise<void> {
  void clearOnboarding
  await clearAuthRelatedCaches()
}

// clearing anything memoized that must be invalidated when user/session/auth changes
export async function clearAuthRelatedCaches(): Promise<void> {
  getClaudeAIOAuthTokens.cache?.clear?.()
  clearTrustedDeviceTokenCache()
  clearBetasCaches()
  clearToolSchemaCache()

  resetUserCache()
  refreshGrowthBookAfterAuthChange()

  getGroveNoticeConfig.cache?.clear?.()
  getGroveSettings.cache?.clear?.()

  await clearRemoteManagedSettingsCache()
  await clearPolicyLimitsCache()
}

export async function call(): Promise<React.ReactNode> {
  await performLogout({ clearOnboarding: true })
  return <Text>{DISABLED_LOGOUT_MESSAGE}</Text>
}
