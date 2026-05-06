import { feature } from 'bun:bundle'
import React from 'react'
import { AgentTool } from '@mtl-code/builtin-tools/tools/AgentTool/AgentTool.js'
import { isInForkChild } from '@mtl-code/builtin-tools/tools/AgentTool/forkSubagent.js'
import { logForDebugging } from '../../utils/debug.js'
import type { LocalJSXCommandOnDone, LocalJSXCommandContext } from '../../types/command.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  // Check feature flag
  if (!feature('FORK_SUBAGENT')) {
    onDone('Fork subagent feature is not enabled. Set FEATURE_FORK_SUBAGENT=1 to enable.', { display: 'system' })
    return null
  }

  // Recursive fork guard
  if (isInForkChild(context.messages)) {
    onDone('Fork is not available inside a forked worker. Complete your task directly using your tools.', { display: 'system' })
    return null
  }

  const directive = args.trim()
  if (!directive) {
    onDone('Usage: /fork <directive>\nExample: /fork Fix the null check in validate.ts', { display: 'system' })
    return null
  }

  // Find the last assistant message to fork from
  const lastAssistantMessage = [...context.messages].reverse().find(
    m => m.type === 'assistant'
  ) as any // Type assertion to avoid complex type import

  if (!lastAssistantMessage) {
    onDone('Cannot fork: no assistant response in conversation history.', { display: 'system' })
    return null
  }

  try {
    const slug = directive
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48)
    const taskName = `fork_${slug || 'task'}`

    // Reuse Codex-style spawn_agent with explicit fork_turns.
    const input = {
      message: directive,
      task_name: taskName,
      fork_turns: 'all',
    }

    // Call AgentTool with proper parameters:
    // - input: the Codex-style spawn_agent parameters
    // - toolUseContext: the current context (ToolUseContext)
    // - canUseTool: permission-check function from context
    // - assistantMessage: the last assistant message to fork from
    AgentTool.call(
      input,
      context,
      context.canUseTool!,
      lastAssistantMessage
    ).catch(error => {
      logForDebugging(`Fork subagent async error: ${error}`, { level: 'error' })
    })

    // Notify user that fork has been started
    onDone(`Forked subagent started with directive: "${directive}"`, { display: 'system' })
    return null
  } catch (error) {
    // Catches synchronous setup errors only
    logForDebugging(`Fork command setup error: ${error}`, { level: 'error' })
    onDone(`Fork failed: ${error instanceof Error ? error.message : String(error)}`, { display: 'system' })
    return null
  }
}
