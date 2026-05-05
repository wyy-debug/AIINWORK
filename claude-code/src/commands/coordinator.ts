/**
 * /coordinator — Toggle coordinator (multi-worker orchestration) mode.
 *
 * When enabled, the CLI becomes an orchestrator that dispatches tasks
 * to worker agents via spawn_agent({ agent_type: "worker" }).
 * The coordinator can use spawn_agent, wait_agent, send_input, list_agents,
 * close_agent, and resume_agent.
 */
import { feature } from 'bun:bundle'
import type { ToolUseContext } from '../Tool.js'
import type {
  Command,
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../types/command.js'

const coordinator = {
  type: 'local-jsx',
  name: 'coordinator',
  description: 'Toggle coordinator (multi-worker) mode',
  isEnabled: () => {
    if (feature('COORDINATOR_MODE')) {
      return true
    }
    return false
  },
  immediate: true,
  load: () =>
    Promise.resolve({
      async call(
        onDone: LocalJSXCommandOnDone,
        _context: ToolUseContext & LocalJSXCommandContext,
      ): Promise<React.ReactNode> {
        const mod =
          require('../coordinator/coordinatorMode.js') as typeof import('../coordinator/coordinatorMode.js')

        if (mod.isCoordinatorMode()) {
          // Disable: clear the env var
          delete process.env.MTL_CODE_COORDINATOR_MODE
          onDone('Coordinator mode disabled — back to normal mode', {
            display: 'system',
            metaMessages: [
              '<system-reminder>\nCoordinator mode is now disabled. You have access to all standard tools again. Work directly instead of dispatching to workers.\n</system-reminder>',
            ],
          })
        } else {
          // Enable: set the env var
          process.env.MTL_CODE_COORDINATOR_MODE = '1'
          onDone(
            'Coordinator mode enabled - use spawn_agent({ agent_type: "worker" }) to dispatch tasks',
            {
              display: 'system',
              metaMessages: [
                '<system-reminder>\nCoordinator mode is now enabled. You are an orchestrator. Use spawn_agent({ agent_type: "worker" }) to spawn workers, wait_agent to wait for results, send_input only for concrete new instructions with DONE/BLOCKED/NEED_PARENT_INPUT stop conditions, and close_agent to stop them. Do not use other tools directly.\n</system-reminder>',
              ],
            },
          )
        }
        return null
      },
    }),
} satisfies Command

export default coordinator
