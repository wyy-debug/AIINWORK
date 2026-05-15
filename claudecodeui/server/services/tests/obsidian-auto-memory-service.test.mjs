import { describe, expect, it, vi } from 'vitest';

describe('obsidian auto memory service', () => {
  it('writes high confidence memory directly to Obsidian AIMemory', async () => {
    const service = await import('../obsidian-auto-memory-service.js');
    const completeJson = vi.fn(async () => ({
      success: true,
      model: 'small-json',
      json: {
        memories: [{
          type: 'feedback',
          title: 'concise responses',
          text: 'The user wants concise final answers.',
          confidence: 0.93,
        }],
      },
    }));
    const ingestKnowledgeSourceToWiki = vi.fn(async () => ({
      wikiPath: 'Argus/AIMemory/Feedback/concise-responses.md',
    }));
    const createMemoryCandidates = vi.fn();

    const memory = service.createObsidianAutoMemoryService({
      completeJson,
      ingestKnowledgeSourceToWiki,
      createMemoryCandidates,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        aiMemoryReadbackEnabled: true,
        routingRules: {
          aiMemoryDirectWriteThreshold: 0.85,
          aiMemoryCandidateThreshold: 0.55,
        },
      }),
    });

    const result = await memory.captureObsidianAutoMemory({
      projectName: 'App',
      sessionId: 'session-1',
      provider: 'claude',
      previousUserPrompt: 'please remember my style',
      content: 'I will keep final answers concise from now on.',
    });

    expect(result).toMatchObject({
      success: true,
      captured: true,
      directCount: 1,
      candidateCount: 0,
      fallbackCount: 0,
    });
    expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledWith(expect.objectContaining({
      source: 'auto-memory',
      mode: 'ai-memory',
      modes: ['ai-memory'],
      projectName: 'Feedback',
      kind: 'feedback',
      metadata: expect.objectContaining({
        memoryType: 'feedback',
        memoryScope: 'global',
        obsidianMode: 'ai-memory',
      }),
    }));
    expect(createMemoryCandidates).not.toHaveBeenCalled();
  });

  it('keeps low confidence memory as a candidate instead of writing directly', async () => {
    const service = await import('../obsidian-auto-memory-service.js');
    const createMemoryCandidates = vi.fn(() => ({
      success: true,
      candidates: [{ id: 'candidate-1', status: 'pending' }],
    }));

    const memory = service.createObsidianAutoMemoryService({
      completeJson: vi.fn(async () => ({
        success: true,
        json: {
          memories: [{
            type: 'project',
            title: 'launch deadline',
            text: 'The project has a launch deadline next week.',
            confidence: 0.72,
          }],
        },
      })),
      ingestKnowledgeSourceToWiki: vi.fn(),
      createMemoryCandidates,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        aiMemoryReadbackEnabled: true,
        routingRules: {
          aiMemoryDirectWriteThreshold: 0.85,
          aiMemoryCandidateThreshold: 0.55,
        },
      }),
    });

    const result = await memory.captureObsidianAutoMemory({
      projectName: 'App',
      sessionId: 'session-1',
      provider: 'claude',
      previousUserPrompt: 'we need to ship next week',
      content: 'I will account for the launch deadline.',
    });

    expect(result).toMatchObject({
      success: true,
      captured: true,
      directCount: 0,
      candidateCount: 1,
      fallbackCount: 0,
    });
    expect(createMemoryCandidates).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [
        expect.objectContaining({
          kind: 'project',
          text: 'The project has a launch deadline next week.',
          confidence: 0.72,
          status: 'pending',
        }),
      ],
      source: expect.objectContaining({
        projectName: 'App',
        memoryType: 'project',
        memoryScope: 'project',
      }),
    }));
  });

  it('writes a pending local fallback when direct Obsidian write fails', async () => {
    const service = await import('../obsidian-auto-memory-service.js');
    const writeFallbackMemory = vi.fn(async () => ({
      path: 'C:/Users/yckui/.mtl-code/projects/App/memory/obsidian-fallback.md',
    }));

    const memory = service.createObsidianAutoMemoryService({
      completeJson: vi.fn(async () => ({
        success: true,
        json: {
          memories: [{
            type: 'user',
            title: 'role',
            text: 'The user maintains the Argus desktop app.',
            confidence: 0.91,
          }],
        },
      })),
      ingestKnowledgeSourceToWiki: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
      createMemoryCandidates: vi.fn(),
      writeFallbackMemory,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        aiMemoryReadbackEnabled: true,
      }),
    });

    const result = await memory.captureObsidianAutoMemory({
      projectName: 'App',
      projectPath: 'D:/SOC/trunk',
      sessionId: 'session-1',
      provider: 'claude',
      previousUserPrompt: 'remember this',
      content: 'The user maintains the Argus desktop app.',
    });

    expect(result).toMatchObject({
      success: true,
      captured: true,
      directCount: 0,
      fallbackCount: 1,
    });
    expect(writeFallbackMemory).toHaveBeenCalledWith(expect.objectContaining({
      memory: expect.objectContaining({
        type: 'user',
        scope: 'global',
        text: 'The user maintains the Argus desktop app.',
      }),
      projectName: 'App',
      projectPath: 'D:/SOC/trunk',
      error: expect.any(Error),
    }));
  });

  it('does not extract memory from init commands or templates', async () => {
    const service = await import('../obsidian-auto-memory-service.js');
    const completeJson = vi.fn();

    const memory = service.createObsidianAutoMemoryService({
      completeJson,
      ingestKnowledgeSourceToWiki: vi.fn(),
      createMemoryCandidates: vi.fn(),
      readObsidianBridgeConfig: () => ({
        enabled: true,
        aiMemoryReadbackEnabled: true,
      }),
    });

    const result = await memory.captureObsidianAutoMemory({
      projectName: 'App',
      sessionId: 'session-1',
      previousUserPrompt: '/init',
      content: 'Please analyze this codebase and create a MTL.md file.',
    });

    expect(result).toMatchObject({
      success: true,
      captured: false,
      reason: 'init_command',
    });
    expect(completeJson).not.toHaveBeenCalled();
  });
});
