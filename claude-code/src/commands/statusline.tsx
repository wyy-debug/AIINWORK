import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Command } from '../commands.js'
import { AGENT_SPAWN_TOOL_NAME } from '@mtl-code/builtin-tools/tools/AgentTool/constants.js'

const statusline = {
  type: 'prompt',
  description: "Set up MTL-Code's status line UI",
  contentLength: 0, // Dynamic content
  aliases: [],
  name: 'statusline',
  progressMessage: 'setting up statusLine',
  allowedTools: [
    AGENT_SPAWN_TOOL_NAME,
    'Read(~/**)',
    'Edit(~/.claude/settings.json)',
  ],
  source: 'builtin',
  disableNonInteractive: true,
  async getPromptForCommand(args): Promise<ContentBlockParam[]> {
    const prompt =
      args.trim() || 'Configure my statusLine from my shell PS1 configuration'
    return [
      {
        type: 'text',
        text: `Use ${AGENT_SPAWN_TOOL_NAME} with agent_type "statusline-setup" and message "${prompt}"`,
      },
    ]
  },
} satisfies Command

export default statusline
