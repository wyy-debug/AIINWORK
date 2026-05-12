import { gracefulShutdown } from 'src/utils/gracefulShutdown.js'
import { writeToStdout } from 'src/utils/process.js'

export async function update() {
  writeToStdout(
    'Native Claude Code updater is disabled. Manage Argus and model runtime updates outside the Claude Code updater.\n',
  )
  await gracefulShutdown(0)
}
