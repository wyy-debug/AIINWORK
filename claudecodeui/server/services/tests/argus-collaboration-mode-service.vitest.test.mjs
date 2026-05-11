import { describe, expect, it } from 'vitest';

import {
  applyArgusCollaborationModeOptions,
} from '../argus-collaboration-mode-service.js';

describe('argus-collaboration-mode-service approved subagent dispatch', () => {
  it('includes the approved subagent dispatch plan in the runtime prompt', async () => {
    const command = applyArgusCollaborationModeOptions({
      type: 'claude-command',
      command: 'dispatch the approved plan',
      options: {
        subagentDispatch: true,
        subagentDispatchPlanApproved: true,
        subagentDispatchPlan: '# Subagent Dispatch Plan\n\n## Agent Dispatch\n- Explore/backend_review',
        subagentRuntimeSnapshot: {
          provider: 'claude',
          model: 'gpt-5.5',
          modelProfileId: 'model-parent',
          projectPath: 'E:\\AIINWORK',
          permissionMode: 'default',
          toolsSettings: {
            allowedTools: ['spawn_agent', 'Read'],
            disallowedTools: ['Bash(rm -rf *)'],
            skipPermissions: false,
          },
        },
        dispatchPlanId: 'dispatch:review-agent:approved-plan',
      },
    });

    expect(command.options.appendSystemPrompt).toMatch(/Approved subagent dispatch plan/i);
    expect(command.options.appendSystemPrompt).toMatch(/only dispatch the agents described/i);
    expect(command.options.appendSystemPrompt).toContain('Explore/backend_review');
    expect(command.options.appendSystemPrompt).toContain('Parent runtime snapshot');
    expect(command.options.appendSystemPrompt).toContain('dispatch:review-agent:approved-plan');
    expect(command.options.appendSystemPrompt).toContain('"allowedTools":["spawn_agent","Read"]');
    expect(command.options.appendSystemPrompt).toMatch(/do not spawn the same approved role twice/i);
    expect(command.options.appendSystemPrompt).toMatch(/append this instruction to every child agent task/i);
    expect(command.options.appendSystemPrompt).toMatch(/Do not call spawn_agent/i);
  });
});
