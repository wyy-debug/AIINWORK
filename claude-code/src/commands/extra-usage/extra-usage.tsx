import React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

const DISABLED_EXTRA_USAGE_MESSAGE =
  'Native Claude extra usage is disabled. Argus uses the configured custom model runtime.'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<React.ReactNode | null> {
  setTimeout(onDone, 0, DISABLED_EXTRA_USAGE_MESSAGE)
  return null
}
