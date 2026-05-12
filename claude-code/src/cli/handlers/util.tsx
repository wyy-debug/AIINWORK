/**
 * Miscellaneous subcommand handlers — extracted from main.tsx for lazy loading.
 * setup-token, doctor, install
 */
/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import { cwd } from 'process'
import React from 'react'
import { WelcomeV2 } from '../../components/LogoV2/WelcomeV2.js'
import { useManagePlugins } from '../../hooks/useManagePlugins.js'
import type { Root } from '@anthropic/ink'
import { Box, Text } from '@anthropic/ink'
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js'
import { logEvent } from '../../services/analytics/index.js'
import { MCPConnectionManager } from '../../services/mcp/MCPConnectionManager.js'
import { AppStateProvider } from '../../state/AppState.js'

export async function setupTokenHandler(root: Root): Promise<void> {
  logEvent('tengu_setup_token_command', {})

  root.render(
    <Box flexDirection="column" gap={1}>
      <WelcomeV2 />
      <Text>
        Native Claude token setup is disabled. Configure the custom model
        credentials in Argus settings.
      </Text>
    </Box>,
  )
  root.unmount()
  process.exit(1)
}

// DoctorWithPlugins wrapper + doctor handler
const DoctorLazy = React.lazy(() =>
  import('../../screens/Doctor.js').then(m => ({ default: m.Doctor })),
)

function DoctorWithPlugins({
  onDone,
}: {
  onDone: () => void
}): React.ReactNode {
  useManagePlugins()
  return (
    <React.Suspense fallback={null}>
      <DoctorLazy onDone={onDone} />
    </React.Suspense>
  )
}

export async function doctorHandler(root: Root): Promise<void> {
  logEvent('tengu_doctor_command', {})

  await new Promise<void>(resolve => {
    root.render(
      <AppStateProvider>
        <KeybindingSetup>
          <MCPConnectionManager
            dynamicMcpConfig={undefined}
            isStrictMcpConfig={false}
          >
            <DoctorWithPlugins
              onDone={() => {
                void resolve()
              }}
            />
          </MCPConnectionManager>
        </KeybindingSetup>
      </AppStateProvider>,
    )
  })
  root.unmount()
  process.exit(0)
}

// install handler
export async function installHandler(
  target: string | undefined,
  options: { force?: boolean },
): Promise<void> {
  const { setup } = await import('../../setup.js')
  await setup(cwd(), 'default', false, false, undefined, false)
  const { install } = await import('../../commands/install.js')
  await new Promise<void>(resolve => {
    const args: string[] = []
    if (target) args.push(target)
    if (options.force) args.push('--force')

    void install.call(
      result => {
        void resolve()
        process.exit(result.includes('failed') ? 1 : 0)
      },
      {},
      args,
    )
  })
}
