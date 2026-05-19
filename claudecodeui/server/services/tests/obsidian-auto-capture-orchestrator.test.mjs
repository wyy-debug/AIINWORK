import { describe, expect, it, vi } from 'vitest';

import { createObsidianAutoCaptureOrchestrator } from '../obsidian-auto-capture-orchestrator.js';

describe('Obsidian capture orchestrator', () => {
  it('ignores assistant text, stream chunks, and compaction events', async () => {
    const broadcast = vi.fn();
    const autoCaptureChatKnowledge = vi.fn();
    const syncProjectInstructionFiles = vi.fn(async () => ({
      success: true,
      captured: false,
      reason: 'unchanged_instruction_file',
    }));
    const orchestrator = createObsidianAutoCaptureOrchestrator({
      autoCaptureChatKnowledge,
      syncProjectInstructionFiles,
      broadcast,
    });

    orchestrator.setContext({
      provider: 'claude',
      sessionId: 'session-template-only',
      projectPath: 'E:/App',
    });

    await orchestrator.observeMessage({
      kind: 'text',
      role: 'assistant',
      provider: 'claude',
      sessionId: 'session-template-only',
      id: 'assistant-1',
      content: 'This stays in Claude Code native memory flow.',
    });
    await orchestrator.observeMessage({
      kind: 'stream_delta',
      provider: 'claude',
      sessionId: 'session-template-only',
      content: 'stream text',
    });
    await orchestrator.observeMessage({
      kind: 'context_compaction',
      provider: 'claude',
      sessionId: 'session-template-only',
      id: 'compact-1',
    });
    await orchestrator.observeMessage({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'session-template-only',
      id: 'complete-1',
    });

    expect(autoCaptureChatKnowledge).not.toHaveBeenCalled();
    expect(syncProjectInstructionFiles).toHaveBeenCalledTimes(1);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('syncs project MTL.md after a successful native Write tool result', async () => {
    const broadcast = vi.fn();
    const syncInstructionFile = vi.fn(async () => ({
      success: true,
      captured: true,
      status: 'captured',
      reason: 'instruction_file_synced',
      mode: 'project-knowledge',
      obsidianBridge: {
        destination: 'obsidian',
        path: 'Argus/Wiki/App/mtl-md.md',
      },
    }));
    const orchestrator = createObsidianAutoCaptureOrchestrator({
      syncInstructionFile,
      broadcast,
    });
    orchestrator.setContext({
      provider: 'claude',
      sessionId: 'session-mtl',
      projectName: 'App',
      projectPath: 'E:/repo',
      userPrompt: '/init',
    });

    await orchestrator.observeMessage({
      kind: 'tool_use',
      provider: 'claude',
      sessionId: 'session-mtl',
      toolId: 'tool-write-mtl',
      toolName: 'Write',
      toolInput: {
        file_path: 'E:/repo/MTL.md',
      },
    });
    await orchestrator.observeMessage({
      kind: 'tool_result',
      provider: 'claude',
      sessionId: 'session-mtl',
      toolId: 'tool-write-mtl',
      isError: false,
      content: 'created MTL.md',
    });

    expect(syncInstructionFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'E:/repo/MTL.md',
      projectPath: 'E:/repo',
      projectName: 'App',
      sessionId: 'session-mtl',
      provider: 'claude',
      toolName: 'Write',
    }));
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      event: 'obsidian_auto_capture_result',
      source: 'instruction-file',
      captured: true,
      status: 'synced',
      mode: 'project-knowledge',
      reason: 'instruction_file_synced',
      obsidianPath: 'Argus/Wiki/App/mtl-md.md',
    }));
  });

  it('scans project instruction files when a turn completes', async () => {
    const broadcast = vi.fn();
    const syncProjectInstructionFiles = vi.fn(async () => ({
      success: true,
      captured: true,
      reason: 'project_instruction_scan',
      results: [{
        success: true,
        captured: true,
        status: 'captured',
        reason: 'instruction_file_synced',
        mode: 'project-knowledge',
        obsidianBridge: {
          destination: 'obsidian',
          path: 'Argus/Wiki/App/mtl-md.md',
        },
      }],
    }));
    const orchestrator = createObsidianAutoCaptureOrchestrator({
      syncProjectInstructionFiles,
      broadcast,
    });
    orchestrator.setContext({
      provider: 'claude',
      sessionId: 'session-mtl-scan',
      projectName: 'App',
      projectPath: 'E:/repo',
      userPrompt: '/init',
    });

    await orchestrator.observeMessage({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'session-mtl-scan',
      id: 'complete-mtl-scan',
    });

    expect(syncProjectInstructionFiles).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: 'E:/repo',
      projectName: 'App',
      sessionId: 'session-mtl-scan',
      provider: 'claude',
      trigger: 'turn_complete_scan',
    }));
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      event: 'obsidian_auto_capture_result',
      source: 'instruction-file',
      captured: true,
      status: 'synced',
      mode: 'project-knowledge',
      reason: 'instruction_file_synced',
      obsidianPath: 'Argus/Wiki/App/mtl-md.md',
    }));
  });

  it('does not scan templates after an aborted or failed turn', async () => {
    const syncProjectInstructionFiles = vi.fn();
    const orchestrator = createObsidianAutoCaptureOrchestrator({
      syncProjectInstructionFiles,
      broadcast: () => undefined,
    });
    orchestrator.setContext({
      provider: 'claude',
      sessionId: 'session-aborted',
      projectPath: 'E:/repo',
    });

    await orchestrator.observeMessage({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'session-aborted',
      id: 'complete-aborted',
      aborted: true,
    });

    expect(syncProjectInstructionFiles).not.toHaveBeenCalled();
  });
});
