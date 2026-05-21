import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types/types';

import { getClaudePermissionSuggestion } from './chatPermissions';

function toolErrorMessage(content: string): ChatMessage {
  return {
    id: 'msg-1',
    type: 'assistant',
    timestamp: new Date().toISOString(),
    toolName: 'Bash',
    toolInput: JSON.stringify({ command: 'gh search repos "react dashboard vite typescript"' }),
    toolResult: {
      isError: true,
      content,
    },
  };
}

describe('chat permission suggestions', () => {
  it('does not suggest granting permissions for tool execution failures', () => {
    const suggestion = getClaudePermissionSuggestion(
      toolErrorMessage('<tool_use_error>Cancelled: parallel tool call Bash(gh search repos "react dashboard vite typescript") errored</tool_use_error>'),
      'claude',
    );

    expect(suggestion).toBeNull();
  });

  it('still suggests granting permissions for explicit permission failures', () => {
    const suggestion = getClaudePermissionSuggestion(
      toolErrorMessage('Permission denied: Tool disallowed by settings'),
      'claude',
    );

    expect(suggestion).toMatchObject({
      toolName: 'Bash',
      entry: 'Bash(gh:*)',
      isAllowed: false,
    });
  });
});
