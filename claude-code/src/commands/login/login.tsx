import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { Text } from '@anthropic/ink'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

const DISABLED_LOGIN_MESSAGE =
  'Native Claude login is disabled. Configure the custom model credentials in Argus settings.'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<React.ReactNode | null> {
  setTimeout(onDone, 0, DISABLED_LOGIN_MESSAGE)
  return null
}

export function Login(props: {
  onDone: (success: boolean, mainLoopModel: string) => void
  startingMessage?: string
}): React.ReactNode {
  React.useEffect(() => {
    props.onDone(false, 'custom-model')
  }, [props])

  return <Text>{props.startingMessage ?? DISABLED_LOGIN_MESSAGE}</Text>
}
