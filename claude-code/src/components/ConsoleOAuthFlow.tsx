import React from 'react'
import { Text } from '@anthropic/ink'

type ConsoleOAuthFlowProps = {
  onDone: () => void
  startingMessage?: string
  mode?: 'login' | 'setup-token'
  forceLoginMethod?: 'claudeai' | 'console'
}

export function ConsoleOAuthFlow({
  startingMessage,
}: ConsoleOAuthFlowProps): React.ReactNode {
  return (
    <Text>
      {startingMessage ??
        'Native Claude OAuth is disabled. Configure the custom model credentials in Argus settings.'}
    </Text>
  )
}
