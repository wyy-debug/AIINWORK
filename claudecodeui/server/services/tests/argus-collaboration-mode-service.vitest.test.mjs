import { describe, expect, it } from 'vitest';

import {
  applyArgusCollaborationModeOptions,
} from '../argus-collaboration-mode-service.js';

describe('argus-collaboration-mode-service', () => {
  it('ignores retired subagent dispatch options', async () => {
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

    expect(command.options.appendSystemPrompt).toBeUndefined();
    expect(command.options.coordinatorMode).toBeUndefined();
  });
});
