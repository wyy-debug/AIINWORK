import type { Command } from '../../commands.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description:
      'Native Claude login is disabled; configure the custom model in Argus settings',
    isEnabled: () => false,
    load: () => import('./login.js'),
  }) satisfies Command
