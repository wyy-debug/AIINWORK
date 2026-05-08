import type { Command } from '../../commands.js'

const goal = {
  type: 'local',
  name: 'goal',
  description: 'View, set, pause, resume, or clear the persistent thread goal',
  argumentHint: '[pause|resume|clear|<objective>]',
  supportsNonInteractive: true,
  load: () => import('./goal.js'),
} satisfies Command

export default goal
