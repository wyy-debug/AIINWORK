import { describe, expect, it, vi } from 'vitest';

import { createObsidianAutoCaptureOrchestrator } from '../obsidian-auto-capture-orchestrator.js';

describe('Obsidian auto-capture orchestrator', () => {
  it('derives the project name from projectPath before falling back to General', async () => {
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
      content: '# GPUDrivenStreaming 代码审查报告\n\n- Summary: project review result.',
    });

    expect(autoCaptureChatKnowledge).toHaveBeenCalledTimes(1);
    expect(capturedPayload).toMatchObject({
      projectName: 'AIINWORK',
      projectPath: 'E:\\AIINWORK',
    });
  });
});
