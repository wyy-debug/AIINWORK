import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'logout',
  description:
    'Native Claude logout is disabled; custom model credentials are managed by Argus',
  isEnabled: () => false,
  load: () => import('./logout.js'),
} satisfies Command
