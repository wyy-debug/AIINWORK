import { describe, expect, it, vi } from 'vitest';

import { createObsidianAutoCaptureOrchestrator } from '../obsidian-auto-capture-orchestrator.js';

describe('Obsidian auto-capture orchestrator', () => {
  it('waits until turn complete before capturing assistant text', async () => {
    let capturedPayload = null;
    const autoCaptureChatKnowledge = vi.fn(async (payload) => {
      capturedPayload = payload;
      return {
        success: true,
        captured: true,
        mode: 'project-knowledge',
        obsidianBridge: { destination: 'obsidian', path: 'Argus/Projects/AIINWORK/Summary.md' },
      };
    });
    const orchestrator = createObsidianAutoCaptureOrchestrator({
      autoCaptureChatKnowledge,
      broadcast: () => undefined,
    });

    orchestrator.setContext({
      provider: 'claude',
      sessionId: 'session-1',
      projectPath: 'E:\\AIINWORK',
      userPrompt: 'review GPUDrivenStreaming',
    });

    await orchestrator.observeMessage({
      kind: 'text',
      role: 'assistant',
      provider: 'claude',
      sessionId: 'session-1',
      id: 'assistant-1',
      content: '# GPUDrivenStreaming code review\n\n- Summary: project review result.',
    });
    expect(autoCaptureChatKnowledge).not.toHaveBeenCalled();

    await orchestrator.observeMessage({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'session-1',
      id: 'complete-1',
    });

    expect(autoCaptureChatKnowledge).toHaveBeenCalledTimes(1);
    expect(capturedPayload).toMatchObject({
      sourceId: 'chat:session-1:turn:assistant-1',
      messageKey: 'assistant-1',
      projectName: 'AIINWORK',
      projectPath: 'E:\\AIINWORK',
    });
    expect(capturedPayload.content).toContain('Summary: project review result.');
  });

  it('captures all assistant text and stream chunks once when a turn completes', async () => {
    const autoCaptureChatKnowledge = vi.fn(async () => ({
      success: true,
      captured: true,
      obsidianBridge: { destination: 'obsidian' },
    }));
    const orchestrator = createObsidianAutoCaptureOrchestrator({
      autoCaptureChatKnowledge,
      broadcast: () => undefined,
    });
    orchestrator.setContext({ provider: 'claude', sessionId: 'session-2', projectName: 'App' });

    await orchestrator.observeMessage({
      kind: 'text',
      role: 'assistant',
      provider: 'claude',
      sessionId: 'session-2',
      id: 'assistant-a',
      content: 'First visible answer.',
    });
    await orchestrator.observeMessage({
      kind: 'stream_delta',
      provider: 'claude',
      sessionId: 'session-2',
      content: ' Streaming',
    });
    await orchestrator.observeMessage({
      kind: 'stream_delta',
      provider: 'claude',
      sessionId: 'session-2',
      content: ' answer.',
    });
    await orchestrator.observeMessage({ kind: 'stream_end', provider: 'claude', sessionId: 'session-2' });
    await orchestrator.observeMessage({
      kind: 'text',
      role: 'assistant',
      provider: 'claude',
      sessionId: 'session-2',
      id: 'assistant-b',
      content: 'Final visible answer.',
    });
    expect(autoCaptureChatKnowledge).not.toHaveBeenCalled();

    await orchestrator.observeMessage({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'session-2',
      id: 'turn-complete',
    });
    await orchestrator.observeMessage({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'session-2',
      id: 'turn-complete',
    });

    expect(autoCaptureChatKnowledge).toHaveBeenCalledTimes(1);
    expect(autoCaptureChatKnowledge.mock.calls[0][0]).toMatchObject({
      sourceId: 'chat:session-2:turn:assistant-b',
      messageKey: 'assistant-b',
      content: [
        'First visible answer.',
        'Streaming answer.',
        'Final visible answer.',
      ].join('\n\n'),
    });
  });

  it('broadcasts Obsidian AIMemory results independently from disabled Wiki capture', async () => {
    const broadcast = vi.fn();
    const autoCaptureChatKnowledge = vi.fn(async () => ({
      success: true,
      captured: false,
      reason: 'disabled',
    }));
    const autoCaptureTurnMemory = vi.fn(async () => ({
      success: true,
      captured: true,
      status: 'captured',
      reason: 'auto_memory',
      directCount: 1,
      candidateCount: 0,
      fallbackCount: 0,
      written: [{
        result: {
          wikiPath: 'Argus/AIMemory/Feedback/final-answer-style.md',
        },
      }],
    }));
    const orchestrator = createObsidianAutoCaptureOrchestrator({
      autoCaptureChatKnowledge,
      autoCaptureTurnMemory,
      broadcast,
    });
    orchestrator.setContext({
      provider: 'claude',
      sessionId: 'session-memory-broadcast',
      projectName: 'App',
      userPrompt: '记住：以后最终结论要简洁。',
    });

    await orchestrator.observeMessage({
      kind: 'text',
      role: 'assistant',
      provider: 'claude',
      sessionId: 'session-memory-broadcast',
      id: 'assistant-memory',
      content: '好的，我会按这个偏好处理。',
    });
    await orchestrator.observeMessage({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'session-memory-broadcast',
      id: 'complete-memory',
    });

    expect(autoCaptureTurnMemory).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0]).toMatchObject({
      event: 'obsidian_auto_capture_result',
      source: 'auto-memory',
      memoryResult: true,
      captured: true,
      status: 'synced',
      mode: 'ai-memory',
      routingMode: 'ai-memory',
      reason: 'auto_memory',
      directCount: 1,
      obsidianPath: 'Argus/AIMemory/Feedback/final-answer-style.md',
      obsidianPaths: {
        aiMemory: 'Argus/AIMemory/Feedback/final-answer-style.md',
      },
    });
  });

  it('syncs project MTL.md after a successful native Write tool result', async () => {
    const broadcast = vi.fn();
    const autoCaptureChatKnowledge = vi.fn();
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
      autoCaptureChatKnowledge,
      syncInstructionFile,
      broadcast,
    });
    orchestrator.setContext({
      provider: 'claude',
      sessionId: 'session-mtl',
      projectName: 'App',
      projectPath: 'E:\\repo',
      userPrompt: '/init',
    });

    await orchestrator.observeMessage({
      kind: 'tool_use',
      provider: 'claude',
      sessionId: 'session-mtl',
      toolId: 'tool-write-mtl',
      toolName: 'Write',
      toolInput: {
        file_path: 'E:\\repo\\MTL.md',
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
      filePath: 'E:\\repo\\MTL.md',
      projectPath: 'E:\\repo',
      projectName: 'App',
      sessionId: 'session-mtl',
      provider: 'claude',
      toolName: 'Write',
    }));
    expect(autoCaptureChatKnowledge).not.toHaveBeenCalled();
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

  it('scans project instruction files when a turn completes even without Write tool events', async () => {
    const broadcast = vi.fn();
    const autoCaptureChatKnowledge = vi.fn();
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
      autoCaptureChatKnowledge,
      syncProjectInstructionFiles,
      broadcast,
    });
    orchestrator.setContext({
      provider: 'claude',
      sessionId: 'session-mtl-scan',
      projectName: 'App',
      projectPath: 'E:\\repo',
      userPrompt: '/init',
    });

    await orchestrator.observeMessage({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'session-mtl-scan',
      id: 'complete-mtl-scan',
    });

    expect(syncProjectInstructionFiles).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: 'E:\\repo',
      projectName: 'App',
      sessionId: 'session-mtl-scan',
      provider: 'claude',
      trigger: 'turn_complete_scan',
    }));
    expect(autoCaptureChatKnowledge).not.toHaveBeenCalled();
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

  it('drops pending assistant content when the turn is aborted or failed', async () => {
    const autoCaptureChatKnowledge = vi.fn();
    const orchestrator = createObsidianAutoCaptureOrchestrator({
      autoCaptureChatKnowledge,
      broadcast: () => undefined,
    });

    await orchestrator.observeMessage({
      kind: 'text',
      role: 'assistant',
      provider: 'claude',
      sessionId: 'session-3',
      id: 'assistant-draft',
      content: 'Partial draft that should not be saved.',
    });
    await orchestrator.observeMessage({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'session-3',
      id: 'complete-aborted',
      aborted: true,
    });
    await orchestrator.observeMessage({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'session-3',
      id: 'complete-aborted',
    });

    expect(autoCaptureChatKnowledge).not.toHaveBeenCalled();
  });

  it('flushes pending assistant content before context compaction', async () => {
    const autoCaptureChatKnowledge = vi.fn(async () => ({
      success: true,
      captured: true,
      obsidianBridge: { destination: 'obsidian' },
    }));
    const orchestrator = createObsidianAutoCaptureOrchestrator({
      autoCaptureChatKnowledge,
      broadcast: () => undefined,
    });
    orchestrator.setContext({ provider: 'claude', sessionId: 'session-4', projectName: 'App' });

    await orchestrator.observeMessage({
      kind: 'text',
      role: 'assistant',
      provider: 'claude',
      sessionId: 'session-4',
      id: 'assistant-before-compact',
      content: 'Important summary before compaction.',
    });
    await orchestrator.observeMessage({
      kind: 'context_compaction',
      provider: 'claude',
      sessionId: 'session-4',
      id: 'compact-1',
      compactSummary: 'This compact summary should not be captured as content.',
    });

    expect(autoCaptureChatKnowledge).toHaveBeenCalledTimes(1);
    expect(autoCaptureChatKnowledge.mock.calls[0][0]).toMatchObject({
      sourceId: 'chat:session-4:turn:assistant-before-compact',
      messageKey: 'assistant-before-compact',
      autoCaptureReason: 'pre_compact_flush',
      content: 'Important summary before compaction.',
    });
    expect(autoCaptureChatKnowledge.mock.calls[0][0].content).not.toContain('compact summary');
  });

  it('keeps the pending buffer when capture fails so a later flush can retry', async () => {
    const autoCaptureChatKnowledge = vi.fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({
        success: true,
        captured: true,
        obsidianBridge: { destination: 'obsidian' },
      });
    const orchestrator = createObsidianAutoCaptureOrchestrator({
      autoCaptureChatKnowledge,
      broadcast: () => undefined,
    });

    await orchestrator.observeMessage({
      kind: 'text',
      role: 'assistant',
      provider: 'claude',
      sessionId: 'session-retry',
      id: 'assistant-retry',
      content: 'Retryable knowledge.',
    });

    await expect(orchestrator.observeMessage({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'session-retry',
      id: 'random-complete-id',
    })).rejects.toThrow('database unavailable');

    await expect(orchestrator.flushPendingCaptures({
      provider: 'claude',
      sessionId: 'session-retry',
      reason: 'retry_after_failure',
    })).resolves.toMatchObject({ captured: true });

    expect(autoCaptureChatKnowledge).toHaveBeenCalledTimes(2);
    expect(autoCaptureChatKnowledge.mock.calls[1][0]).toMatchObject({
      sourceId: 'chat:session-retry:turn:assistant-retry',
      messageKey: 'assistant-retry',
      autoCaptureReason: 'retry_after_failure',
      content: 'Retryable knowledge.',
    });
  });

  it('waits for an in-flight capture to settle before the next readback barrier continues', async () => {
    let resolveCapture;
    const autoCaptureChatKnowledge = vi.fn(async () => new Promise((resolve) => {
      resolveCapture = () => resolve({
        success: true,
        captured: true,
        obsidianBridge: { destination: 'obsidian' },
      });
    }));
    const orchestrator = createObsidianAutoCaptureOrchestrator({
      autoCaptureChatKnowledge,
      broadcast: () => undefined,
    });

    await orchestrator.observeMessage({
      kind: 'text',
      role: 'assistant',
      provider: 'claude',
      sessionId: 'session-barrier',
      id: 'assistant-barrier',
      content: 'Knowledge that should be visible next turn.',
    });
    const capturePromise = orchestrator.observeMessage({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'session-barrier',
      id: 'complete-barrier',
    });

    let settled = false;
    const waitPromise = orchestrator.waitForPendingCapture({
      provider: 'claude',
      sessionId: 'session-barrier',
      timeoutMs: 500,
    }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveCapture();
    await capturePromise;
    await waitPromise;
    expect(settled).toBe(true);
  });
});
