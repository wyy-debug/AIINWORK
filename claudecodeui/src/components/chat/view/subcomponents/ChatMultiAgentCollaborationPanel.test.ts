import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ChatMessage } from '../../types/types';

import { ChatMultiAgentCollaborationPanel } from './ChatMultiAgentCollaborationPanel';

const makeSubagent = (taskName: string): ChatMessage => ({
  type: 'assistant',
  timestamp: new Date(0),
  isToolUse: true,
  isSubagentContainer: true,
  toolName: 'spawn_agent',
  toolId: `tool-${taskName}`,
  toolInput: {
    agent_type: 'Explore',
    task_name: taskName,
    message: `review ${taskName}`,
  },
  subagentState: {
    taskId: `task-${taskName}`,
    childTools: [{
      toolId: `bash-${taskName}`,
      toolName: 'Bash',
      toolInput: { command: `echo ${taskName}` },
      toolResult: { content: `bash output for ${taskName}` },
      timestamp: new Date(1),
    }],
    currentToolIndex: 0,
    isComplete: false,
    runtimeStatus: 'RUNNING',
    lastToolSummary: `summary for ${taskName}`,
  },
});

describe('ChatMultiAgentCollaborationPanel', () => {
  it('renders embedded read-only child dialogs and reuses subagent message output', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatMultiAgentCollaborationPanel, {
        messages: [
          makeSubagent('review_backend_server'),
          makeSubagent('review_frontend_components'),
        ],
      }),
    );

    expect(html).toContain('data-subagent-dispatch-plan-id');
    expect(html).toContain('data-subagent-child-dialog');
    expect(html).toContain('多 Agent 对话协作');
    expect(html).toContain('Main Agent / Orchestrator');
    expect(html).toContain('Explore / review_backend_server');
    expect(html).toContain('review review_backend_server');
    expect(html).toContain('echo review_backend_server');
    expect(html).toContain('summary for review_backend_server');
    expect(html).not.toContain('Subagent / Explore');
    expect(html).not.toContain('<textarea');
  });

  it('renders blocked child dialogs as error state instead of success/online state', () => {
    const blocked = makeSubagent('backend_review');
    blocked.subagentState = {
      ...blocked.subagentState!,
      runtimeStatus: 'BLOCKED',
      resultSummary: 'Received two consecutive empty, no-match, or error-only tool results.',
    };

    const html = renderToStaticMarkup(
      React.createElement(ChatMultiAgentCollaborationPanel, {
        messages: [
          blocked,
          makeSubagent('frontend_review'),
        ],
      }),
    );

    expect(html).toContain('data-subagent-child-status="blocked"');
    expect(html).toContain('data-subagent-result-tone="blocked"');
    expect(html).toContain('已阻塞');
    expect(html).toContain('Received two consecutive empty, no-match, or error-only tool results.');
    expect(html).not.toContain('border-emerald-100 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800');
  });
});
