import { gracefulShutdown } from '../utils/gracefulShutdown.js'
import { writeToStdout } from '../utils/process.js'

export async function updateMTLCode(): Promise<void> {
  writeToStdout(
    'Native MTL-Code update is disabled. Manage Argus and model runtime updates outside the Claude Code updater.\n',
  )
  await gracefulShutdown(0)
}
