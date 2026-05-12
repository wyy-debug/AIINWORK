import type { Command } from '../../commands.js'

const upgrade = {
  type: 'local-jsx',
  name: 'upgrade',
  description:
    'Native Claude plan upgrades are disabled for the custom model runtime',
  isEnabled: () => false,
  load: () => import('./upgrade.js'),
} satisfies Command

export default upgrade
