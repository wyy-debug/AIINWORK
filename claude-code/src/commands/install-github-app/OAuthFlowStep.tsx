import React from 'react'
import { Box, Text } from '@anthropic/ink'

interface OAuthFlowStepProps {
  onSuccess: (token: string) => void
  onCancel: () => void
}

export function OAuthFlowStep(props: OAuthFlowStepProps): React.ReactNode {
  void props

  return (
    <Box flexDirection="column" gap={1}>
      <Text color="warning">Claude OAuth token creation is disabled.</Text>
      <Text dimColor>
        Configure your custom model credentials in Argus settings instead.
      </Text>
    </Box>
  )
}
