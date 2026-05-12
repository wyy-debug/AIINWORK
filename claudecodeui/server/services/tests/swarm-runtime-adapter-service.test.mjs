import { describe, expect, it, vi } from 'vitest';

import {
  buildSwarmCoordinatorPrompt,
  createSwarmRuntimeAdapter,
  extractSpawnAgentMappings,
} from '../swarm-runtime-adapter-service.js';

const template = {
  id: 'review-swarm',
  kind: 'swarm-template',
  roles: [
    { id: 'queen', label: 'Queen', agentTemplateId: 'review-queen', count: 1 },
    { id: 'reviewer', label: 'Reviewer', agentTemplateId: 'security-reviewer', count: 1 },
  ],
  topology: {
    type: 'queen',
    coordinatorRoleId: 'queen',
    edges: [{ from: 'queen', to: 'reviewer', topic: 'review.assignments' }],
  },
};

describe('swarm-runtime-adapter-service', () => {
  it('builds a coordinator prompt that instructs Claude to spawn every role with deterministic task names', () => {
    const prompt = buildSwarmCoordinatorPrompt({
      run: { id: 'run-1' },
      template,
      objective: 'Review authentication changes',
      launchAnswers: { risk: 'high' },
    });

    expect(prompt).toContain('spawn_agent');
    expect(prompt).toContain('Argus swarm task_name');
    expect(prompt).toContain('swarm_run_1__queen__0');
    expect(prompt).toContain('swarm_run_1__reviewer__0');
    expect(prompt).toContain('Review authentication changes');
    expect(prompt).toContain('"risk":"high"');
    expect(prompt).toContain('Do not write a user-visible summary');
    expect(prompt).not.toContain('After spawning, stop');
  });

  it('extracts role mappings from normalized spawn_agent tool messages', () => {
    const mappings = extractSpawnAgentMappings([
      {
        kind: 'tool_use',
        toolId: 'tool-1',
        toolName: 'spawn_agent',
        toolInput: { task_name: 'swarm:run-1:reviewer:0' },
        taskId: 'task-from-use',
      },
      {
        kind: 'tool_result',
        toolId: 'tool-1',
        toolUseResult: { taskId: 'task-reviewer', threadId: 'thread-reviewer' },
      },
    ]);

    expect(mappings.get('reviewer:0')).toMatchObject({
      roleId: 'reviewer',
      roleIndex: 0,
      taskId: 'task-reviewer',
      threadId: 'thread-reviewer',
    });
  });

  it('uses Claude-compatible task names and maps async task notifications back to roles', () => {
    const prompt = buildSwarmCoordinatorPrompt({
      run: { id: 'swarm_run_abc-123' },
      template,
      objective: 'Review authentication changes',
    });
    expect(prompt).toContain('swarm_swarm_run_abc_123__queen__0');
    expect(prompt).toContain('swarm_swarm_run_abc_123__reviewer__0');

    const mappings = extractSpawnAgentMappings([
      {
        kind: 'tool_use',
        toolId: 'tool-reviewer',
        toolName: 'spawn_agent',
        toolInput: { task_name: 'swarm_swarm_run_abc_123__reviewer__0' },
      },
      {
        kind: 'tool_result',
        toolId: 'tool-reviewer',
        content: '{"task_name":"/root/swarm_swarm_run_abc_123__reviewer__0","nickname":"general-purpose"}',
        toolUseResult: {
          isAsync: true,
          status: 'async_launched',
          task_name: '/root/swarm_swarm_run_abc_123__reviewer__0',
        },
      },
      {
        kind: 'task_notification',
        toolId: 'tool-reviewer',
        taskId: 'task-reviewer-real',
        status: 'completed',
        summary: 'Agent completed',
      },
    ]);

    expect(mappings.get('reviewer:0')).toMatchObject({
      roleId: 'reviewer',
      safeRoleId: 'reviewer',
      roleIndex: 0,
      taskId: 'task-reviewer-real',
      threadId: '/root/swarm_swarm_run_abc_123__reviewer__0',
    });
  });

  it('maps async task_started status events back to spawn_agent roles', () => {
    const mappings = extractSpawnAgentMappings([
      {
        kind: 'tool_use',
        toolId: 'tool-reviewer',
        toolName: 'spawn_agent',
        toolInput: {
          task_name: 'swarm_swarm_run_abc_123__reviewer__0',
          message: 'Review authentication changes',
          agent_type: 'worker',
        },
      },
      {
        kind: 'tool_result',
        toolId: 'tool-reviewer',
        content: '{"task_name":"/root/swarm_swarm_run_abc_123__reviewer__0","nickname":"worker"}',
      },
      {
        kind: 'status',
        status: 'subagent_started',
        toolId: 'tool-reviewer',
        taskId: 'task-reviewer-real',
        content: 'swarm_swarm_run_abc_123__reviewer__0',
      },
    ]);

    expect(mappings.get('reviewer:0')).toMatchObject({
      roleId: 'reviewer',
      roleIndex: 0,
      taskId: 'task-reviewer-real',
      threadId: '/root/swarm_swarm_run_abc_123__reviewer__0',
    });
  });

  it('maps spawn_agent roles when the tool only preserves task name in the message body', () => {
    const mappings = extractSpawnAgentMappings([
      {
        kind: 'tool_use',
        toolId: 'tool-reviewer',
        toolName: 'spawn_agent',
        toolInput: {
          agent_type: 'worker',
          message: [
            'Argus swarm task_name: swarm_swarm_run_abc_123__reviewer__0',
            'Role: Reviewer',
            'Review authentication changes.',
          ].join('\n'),
        },
      },
      {
        kind: 'tool_result',
        toolId: 'tool-reviewer',
        toolUseResult: {
          taskId: 'task-reviewer-real',
          threadId: 'thread-reviewer-real',
        },
      },
    ]);

    expect(mappings.get('reviewer:0')).toMatchObject({
      roleId: 'reviewer',
      roleIndex: 0,
      taskId: 'task-reviewer-real',
      threadId: 'thread-reviewer-real',
    });
  });

  it('does not treat assistant acknowledgement text as a spawned task', () => {
    const mappings = extractSpawnAgentMappings([
      {
        kind: 'text',
        role: 'assistant',
        content: 'All four agents have been acknowledged. My role as coordinator is done for now.',
      },
    ]);

    expect(mappings.size).toBe(0);
  });

  it('starts one headless coordinator session and returns mapped task ids for role spawns', async () => {
    const queryClaudeSDK = vi.fn(async (_command, _options, writer) => {
      writer.send({ kind: 'session_created', newSessionId: 'coordinator-session', sessionId: 'coordinator-session' });
      writer.send({
        kind: 'tool_use',
        toolId: 'tool-queen',
        toolName: 'spawn_agent',
        toolInput: { task_name: 'swarm:run-1:queen:0' },
      });
      writer.send({
        kind: 'tool_result',
        toolId: 'tool-queen',
        toolUseResult: { taskId: 'task-queen', threadId: 'thread-queen' },
      });
      writer.send({
        kind: 'tool_use',
        toolId: 'tool-reviewer',
        toolName: 'spawn_agent',
        toolInput: { task_name: 'swarm:run-1:reviewer:0' },
      });
      writer.send({
        kind: 'tool_result',
        toolId: 'tool-reviewer',
        toolUseResult: { taskId: 'task-reviewer', threadId: 'thread-reviewer' },
      });
      writer.send({ kind: 'complete', sessionId: 'coordinator-session' });
    });
    const adapter = createSwarmRuntimeAdapter({
      queryClaudeSDK,
      sendClaudeSDKTaskControl: vi.fn(),
      sendClaudeSDKGuidance: vi.fn(),
    });
    const run = { id: 'run-1' };

    const queen = await adapter.spawnAgent({
      run,
      template,
      role: template.roles[0],
      roleIndex: 0,
      objective: 'Review auth',
      projectPath: 'E:/repo',
    });
    const reviewer = await adapter.spawnAgent({
      run,
      template,
      role: template.roles[1],
      roleIndex: 0,
      objective: 'Review auth',
      projectPath: 'E:/repo',
    });

    expect(queryClaudeSDK).toHaveBeenCalledTimes(1);
    expect(queen).toMatchObject({
      taskId: 'task-queen',
      threadId: 'thread-queen',
      coordinatorSessionId: 'coordinator-session',
      mode: 'coordinator-subagents',
    });
    expect(reviewer).toMatchObject({ taskId: 'task-reviewer', threadId: 'thread-reviewer' });
  });

  it('passes parent runtime permissions to the headless coordinator session', async () => {
    const queryClaudeSDK = vi.fn(async (_command, _options, writer) => {
      writer.send({ kind: 'session_created', newSessionId: 'coordinator-session', sessionId: 'coordinator-session' });
      writer.send({
        kind: 'tool_use',
        toolId: 'tool-reviewer',
        toolName: 'spawn_agent',
        toolInput: { task_name: 'swarm:run-1:reviewer:0' },
      });
      writer.send({
        kind: 'tool_result',
        toolId: 'tool-reviewer',
        toolUseResult: { taskId: 'task-reviewer', threadId: 'thread-reviewer' },
      });
      writer.send({ kind: 'complete', sessionId: 'coordinator-session' });
    });
    const adapter = createSwarmRuntimeAdapter({
      queryClaudeSDK,
      sendClaudeSDKTaskControl: vi.fn(),
      sendClaudeSDKGuidance: vi.fn(),
    });

    await adapter.spawnAgent({
      run: {
        id: 'run-1',
        permissionMode: 'plan',
        toolsSettings: {
          allowedTools: ['Read'],
          disallowedTools: ['Bash'],
          skipPermissions: false,
        },
      },
      template,
      role: template.roles[1],
      roleIndex: 0,
      objective: 'Review auth',
      projectPath: 'E:/repo',
    });

    expect(queryClaudeSDK).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        permissionMode: 'plan',
        toolsSettings: {
          allowedTools: ['Read'],
          disallowedTools: ['Bash'],
          skipPermissions: false,
        },
      }),
      expect.any(Object),
    );
  });

  it('delivers a swarm message to a role task through subagent control with resume fallback', async () => {
    const queryClaudeSDK = vi.fn(async (_command, _options, writer) => {
      writer.send({ kind: 'complete', sessionId: 'coordinator-session' });
    });
    const adapter = createSwarmRuntimeAdapter({
      queryClaudeSDK,
      sendClaudeSDKTaskControl: vi.fn(() => ({ success: false, unsupported: true })),
      sendClaudeSDKGuidance: vi.fn(() => ({ success: false, error: 'inactive' })),
    });

    const result = await adapter.deliverMessage({
      run: { id: 'run-1', coordinatorSessionId: 'coordinator-session', projectPath: 'E:/repo' },
      agent: { id: 'agent-1', taskId: 'task-1' },
      message: { id: 'message-1', payload: { message: 'continue review' }, type: 'assignment' },
    });

    expect(result).toMatchObject({ success: true, mode: 'fallback-resume' });
    expect(queryClaudeSDK).toHaveBeenCalledWith(
      expect.stringContaining('send_message'),
      expect.objectContaining({ sessionId: 'coordinator-session', projectPath: 'E:/repo' }),
      expect.any(Object),
    );
  });
});
