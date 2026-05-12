import type { Command } from '../../commands.js'

function isExtraUsageAllowed(): boolean {
  return false
}

export const extraUsage = {
  type: 'local-jsx',
  name: 'extra-usage',
  description:
    'Native Claude extra usage is disabled for the custom model runtime',
  isEnabled: () => isExtraUsageAllowed(),
  load: () => import('./extra-usage.js'),
} satisfies Command

export const extraUsageNonInteractive = {
  type: 'local',
  name: 'extra-usage',
  supportsNonInteractive: true,
  description:
    'Native Claude extra usage is disabled for the custom model runtime',
  isEnabled: () => isExtraUsageAllowed(),
  isHidden: true,
  load: () => import('./extra-usage-noninteractive.js'),
} satisfies Command
