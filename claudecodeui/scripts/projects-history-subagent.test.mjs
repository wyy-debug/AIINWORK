import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const originalMtlCodeConfigDir = process.env.MTL_CODE_CONFIG_DIR;
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;

async function writeJsonl(filePath, entries) {
  await fs.writeFile(
    filePath,
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

afterEach(() => {
  if (originalMtlCodeConfigDir === undefined) {
    delete process.env.MTL_CODE_CONFIG_DIR;
  } else {
    process.env.MTL_CODE_CONFIG_DIR = originalMtlCodeConfigDir;
  }

  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
  }
});

describe('project session history subagent restoration', () => {
  it('prefers persisted manager state over legacy agent sidecar jsonl tools', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mtl-history-subagent-'));
    const mtlHome = path.join(tempRoot, '.mtl-code');
    const legacyHome = path.join(tempRoot, '.claude');
    process.env.MTL_CODE_CONFIG_DIR = mtlHome;
    process.env.CLAUDE_CONFIG_DIR = legacyHome;

    const projectName = 'encoded-project';
    const sessionId = 'session-history-1';
    const projectDir = path.join(mtlHome, 'projects', projectName);
    await fs.mkdir(projectDir, { recursive: true });

    await writeJsonl(path.join(projectDir, `${sessionId}.jsonl`), [
      {
        sessionId,
        uuid: 'manager-progress',
        type: 'system',
        subtype: 'task_progress',
        timestamp: '2026-05-05T00:00:00.000Z',
        tool_use_id: 'tool-agent-1',
        task_id: 'task-1',
        subagent_snapshot: {
          taskId: 'task-1',
          agentId: 'legacy123',
          status: 'running',
          objective: 'canonical manager objective',
        },
      },
      {
        sessionId,
        uuid: 'legacy-launch-result',
        timestamp: '2026-05-05T00:00:01.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-agent-1',
              content: 'Async agent launched successfully. agentId: legacy123',
            },
          ],
        },
        toolUseResult: {
          agentId: 'legacy123',
        },
      },
    ]);

    await writeJsonl(path.join(projectDir, 'agent-legacy123.jsonl'), [
      {
        timestamp: '2026-05-05T00:00:02.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'legacy-read-tool',
              name: 'Read',
              input: { file_path: 'legacy.txt' },
            },
          ],
        },
      },
    ]);

    const { clearProjectDirectoryCache, getSessionMessages } = await import('../server/projects.js');
    clearProjectDirectoryCache();

    const result = await getSessionMessages(projectName, sessionId);
    const launchResult = result.messages.find((message) => message.uuid === 'legacy-launch-result');
    const managerProgress = result.messages.find((message) => message.uuid === 'manager-progress');

    expect(managerProgress?.subagent_snapshot?.objective).toBe('canonical manager objective');
    expect(launchResult?.toolUseResult?.agentId).toBe('legacy123');
    expect(launchResult?.subagentTools).toBeUndefined();
    expect(launchResult?.subagentRuntime).toBeUndefined();
  });
});
