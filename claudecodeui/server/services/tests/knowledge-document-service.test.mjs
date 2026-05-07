import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMemoryConfigStore = () => {
  let value = null;
  return {
    get: vi.fn(() => value),
    set: vi.fn((_key, nextValue) => {
      value = nextValue;
    }),
  };
};

describe('knowledge document service', () => {
  let bridgeService;
  let knowledgeService;

  beforeEach(async () => {
    bridgeService = await import('../obsidian-bridge-service.js');
    knowledgeService = await import('../knowledge-document-service.js');
    bridgeService.setObsidianBridgeConfigStoreForTests(createMemoryConfigStore());
  });

  it('identifies only knowledge-like artifacts for automatic export', () => {
    expect(knowledgeService.isKnowledgeArtifact({ kind: 'review-notes', metadata: {} })).toBe(true);
    expect(knowledgeService.isKnowledgeArtifact({ kind: 'automation-run', metadata: {} })).toBe(true);
    expect(knowledgeService.isKnowledgeArtifact({ kind: 'action-log', metadata: {} })).toBe(true);
    expect(knowledgeService.isKnowledgeArtifact({ kind: 'browser-screenshot', metadata: { source: 'browser' } })).toBe(false);
    expect(knowledgeService.isKnowledgeArtifact({ kind: 'visual-preview', metadata: {} })).toBe(false);
  });

  it('sends a normalized artifact document to Obsidian without fallback when the bridge succeeds', async () => {
    bridgeService.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:27177',
      token: 'bridge-token',
      fallbackToProjectKnowledge: true,
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        path: 'Argus/Projects/App/Review.md',
      }),
    }));

    const result = await knowledgeService.createKnowledgeDocumentFromArtifact({
      id: 'artifact-1',
      kind: 'review-notes',
      title: 'Review',
      projectName: 'App',
      sessionId: 'session-1',
      content: '# Review',
      metadata: { source: 'review' },
    }, { fetchImpl });

    expect(result).toMatchObject({
      success: true,
      destination: 'obsidian',
      path: 'Argus/Projects/App/Review.md',
      fallbackPath: '',
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      argusId: 'artifact:artifact-1',
      sourceArtifactId: 'artifact-1',
      kind: 'review-notes',
      projectName: 'App',
      sessionId: 'session-1',
    });
  });

  it('does not leak artifact sync bookkeeping into Obsidian document metadata', () => {
    const payload = knowledgeService.documentPayloadFromArtifact({
      id: 'artifact-2',
      kind: 'review-notes',
      title: 'Review',
      projectName: 'App',
      sessionId: 'session-1',
      content: '# Review',
      metadata: {
        source: 'review',
        status: 'draft',
        obsidianStatus: 'not_sent',
        obsidianBridge: { destination: 'fallback' },
        obsidianPath: 'Argus/Projects/App/Old.md',
        obsidianLastError: 'old failure',
      },
    });

    expect(payload.metadata).toMatchObject({
      source: 'review',
      sourceArtifactId: 'artifact-2',
      kind: 'review-notes',
    });
    expect(payload.metadata).not.toHaveProperty('obsidianStatus');
    expect(payload.metadata).not.toHaveProperty('obsidianBridge');
    expect(payload.metadata).not.toHaveProperty('obsidianPath');
    expect(payload.metadata).not.toHaveProperty('obsidianLastError');
    expect(payload.metadata.artifactMetadata).not.toContain('obsidianStatus');
  });

  it('falls back to docs/knowledge when Obsidian is unreachable', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'argus-knowledge-fallback-'));
    try {
      bridgeService.saveObsidianBridgeConfig({
        enabled: true,
        endpoint: 'http://127.0.0.1:27177',
        token: 'bridge-token',
        fallbackToProjectKnowledge: true,
      });
      const fetchImpl = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      });

      const result = await knowledgeService.createKnowledgeDocument({
        title: 'Sprint Summary',
        content: '# Sprint Summary',
        mode: 'project-knowledge',
        projectName: 'App',
        sessionId: 'session-1',
        argusId: 'summary-1',
        kind: 'project-summary',
        tags: ['summary'],
      }, { fetchImpl, projectRoot });

      expect(result).toMatchObject({
        success: true,
        destination: 'fallback',
        fallbackPath: expect.stringContaining('docs\\knowledge\\project-knowledge\\Sprint Summary.md'),
        errorCode: 'OBSIDIAN_BRIDGE_UNREACHABLE',
      });
      const markdown = await readFile(result.fallbackPath, 'utf8');
      expect(markdown).toContain('obsidianFallback: true');
      expect(markdown).toContain('targetMode: project-knowledge');
      expect(markdown).toContain('argusId: summary-1');
      expect(markdown).toContain('# Sprint Summary');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
