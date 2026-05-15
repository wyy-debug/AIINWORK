import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs = [];

const makeTempDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'argus-native-memory-'));
  tempDirs.push(dir);
  return dir;
};

const createStore = () => {
  const map = new Map();
  return {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
  };
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('Obsidian native auto-memory sync service', () => {
  it('syncs native topic memory files to Obsidian AIMemory and skips MEMORY.md', async () => {
    const service = await import('../obsidian-native-memory-sync-service.js');
    const memoryDir = await makeTempDir();
    await fs.writeFile(path.join(memoryDir, 'MEMORY.md'), '- [Style](feedback_style.md) - style\n', 'utf8');
    await fs.writeFile(path.join(memoryDir, 'feedback_style.md'), [
      '---',
      'name: concise responses',
      'description: The user wants concise final answers.',
      'type: feedback',
      '---',
      '',
      'Rule: Keep final answers concise.',
      'Why: The user dislikes long changelog-style responses.',
      'How to apply: Summarize only the important result.',
      '',
    ].join('\n'), 'utf8');

    const sendObsidianDocument = vi.fn(async () => ({
      path: 'Argus/AIMemory/AIINWORK/concise-responses.md',
    }));
    const sync = service.createObsidianNativeMemorySyncService({
      sendObsidianDocument,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        aiMemoryReadbackEnabled: true,
      }),
      stateStore: createStore(),
    });

    const result = await sync.syncNativeMemoryFiles({
      memoryDir,
      projectName: 'AIINWORK',
      projectPath: 'E:/AIINWORK',
      sessionId: 'session-1',
      provider: 'claude',
    });

    expect(result).toMatchObject({
      success: true,
      enabled: true,
      captured: true,
      syncedCount: 1,
      skippedCount: 1,
      failedCount: 0,
    });
    expect(sendObsidianDocument).toHaveBeenCalledTimes(1);
    expect(sendObsidianDocument).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'ai-memory',
      baseFolder: 'Argus',
      projectName: 'AIINWORK',
      kind: 'feedback',
      argusId: expect.stringContaining('native-auto-memory:'),
      content: expect.stringContaining('Keep final answers concise.'),
      metadata: expect.objectContaining({
        source: 'native-auto-memory',
        sourceId: expect.stringContaining('native-auto-memory:'),
        memoryType: 'feedback',
        memoryScope: 'global',
        nativeMemoryRelativePath: 'feedback_style.md',
        projectName: 'AIINWORK',
        projectPath: 'E:/AIINWORK',
      }),
    }));
  });

  it('skips unchanged synced memories and retries pending failures', async () => {
    const service = await import('../obsidian-native-memory-sync-service.js');
    const memoryDir = await makeTempDir();
    const topicPath = path.join(memoryDir, 'project_context.md');
    await fs.writeFile(topicPath, [
      '---',
      'name: rollout context',
      'description: Rollout context',
      'type: project',
      '---',
      '',
      'The project needs a staged rollout.',
      '',
    ].join('\n'), 'utf8');

    const sendObsidianDocument = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue({ path: 'Argus/AIMemory/App/rollout-context.md' });
    const sync = service.createObsidianNativeMemorySyncService({
      sendObsidianDocument,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        aiMemoryReadbackEnabled: true,
      }),
      stateStore: createStore(),
    });

    const first = await sync.syncNativeMemoryFiles({
      memoryDir,
      projectName: 'App',
      projectPath: 'D:/SOC/trunk',
      sessionId: 'session-1',
      provider: 'claude',
    });
    const second = await sync.syncNativeMemoryFiles({
      memoryDir,
      projectName: 'App',
      projectPath: 'D:/SOC/trunk',
      sessionId: 'session-2',
      provider: 'claude',
    });
    const third = await sync.syncNativeMemoryFiles({
      memoryDir,
      projectName: 'App',
      projectPath: 'D:/SOC/trunk',
      sessionId: 'session-3',
      provider: 'claude',
    });

    expect(first).toMatchObject({ success: false, enabled: true, failedCount: 1 });
    expect(second).toMatchObject({ success: true, enabled: true, syncedCount: 1 });
    expect(third).toMatchObject({ success: true, enabled: true, syncedCount: 0, skippedCount: 1 });
    expect(sendObsidianDocument).toHaveBeenCalledTimes(2);
  });
});
