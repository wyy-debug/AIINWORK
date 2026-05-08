import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ARTIFACTS_TABLE_SQL,
  ARTIFACT_LINKS_TABLE_SQL,
} from '../../database/schema.js';

describe('artifact service', () => {
  let serviceModule;
  let database;
  let projectRoot;
  let ids;

  beforeEach(async () => {
    serviceModule = await import('../artifact-service.js');
    database = new Database(':memory:');
    database.exec(ARTIFACTS_TABLE_SQL);
    database.exec(ARTIFACT_LINKS_TABLE_SQL);
    projectRoot = await mkdtemp(join(tmpdir(), 'argus-artifact-service-'));
    ids = 0;
  });

  it('creates an artifact link and auto-exports knowledge artifacts through Obsidian metadata', async () => {
    const createKnowledgeDocumentFromArtifact = vi.fn(async () => ({
      success: true,
      destination: 'obsidian',
      path: 'Argus/Projects/App/Review.md',
      fallbackPath: '',
    }));
    const service = serviceModule.createArtifactService({
      db: database,
      createId: (prefix) => `${prefix}_${++ids}`,
      extractProjectDirectory: async () => projectRoot,
      createKnowledgeDocumentFromArtifact,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: true,
        defaultMode: 'ai-memory',
      }),
    });

    const result = await service.createArtifact({
      kind: 'review-notes',
      title: 'Review notes',
      projectName: 'App',
      sessionId: 'session-1',
      content: '# Review',
      metadata: { source: 'review', runId: 'run-1' },
    });

    expect(result.obsidianBridge).toMatchObject({
      destination: 'obsidian',
      path: 'Argus/Projects/App/Review.md',
      mode: 'ai-memory',
      automatic: true,
    });
    expect(result.artifact.metadata).toMatchObject({
      obsidianStatus: 'synced',
      obsidianMode: 'ai-memory',
      obsidianPath: 'Argus/Projects/App/Review.md',
      obsidianArgusId: `artifact:${result.artifact.id}`,
    });
    expect(createKnowledgeDocumentFromArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ id: result.artifact.id, content: '# Review' }),
      expect.objectContaining({ mode: 'ai-memory', projectRoot }),
    );
    const link = database.prepare('SELECT * FROM artifact_links WHERE artifact_id = ?').get(result.artifact.id);
    expect(link).toMatchObject({
      source_type: 'review',
      source_id: 'run-1',
      session_id: 'session-1',
      project_name: 'App',
    });
  });

  it('auto-exports knowledge artifacts through the Wiki Compiler primary pipeline', async () => {
    const createKnowledgeDocumentFromArtifact = vi.fn(async () => {
      throw new Error('direct Obsidian document writes should not be used');
    });
    const ingestKnowledgeSourceToWiki = vi.fn(async (payload) => ({
      destination: 'obsidian',
      rawPath: 'Argus/Raw/App/2026-05-08/Review notes.md',
      wikiPath: 'Argus/Wiki/App/Review notes.md',
      indexPaths: ['Argus/Projects/App/Index.md'],
      viewModes: ['project-knowledge'],
      mode: payload.metadata.obsidianMode,
      modes: payload.metadata.obsidianModes,
    }));
    const service = serviceModule.createArtifactService({
      db: database,
      createId: (prefix) => `${prefix}_${++ids}`,
      extractProjectDirectory: async () => projectRoot,
      createKnowledgeDocumentFromArtifact,
      ingestKnowledgeSourceToWiki,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: true,
        wikiPrimaryEnabled: true,
        defaultMode: 'project-knowledge',
      }),
    });

    const result = await service.createArtifact({
      kind: 'review-notes',
      title: 'Review notes',
      projectName: 'App',
      sessionId: 'session-1',
      content: '# Review',
      metadata: { source: 'review', runId: 'run-1' },
    });

    expect(createKnowledgeDocumentFromArtifact).not.toHaveBeenCalled();
    expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledWith(expect.objectContaining({
      artifact: expect.objectContaining({ id: result.artifact.id, title: 'Review notes' }),
      source: 'artifact',
      projectName: 'App',
      sessionId: 'session-1',
      metadata: expect.objectContaining({
        obsidianMode: 'project-knowledge',
        obsidianModes: ['project-knowledge'],
      }),
    }));
    expect(result.obsidianBridge).toMatchObject({
      destination: 'obsidian',
      wikiPath: 'Argus/Wiki/App/Review notes.md',
      indexPaths: ['Argus/Projects/App/Index.md'],
      viewModes: ['project-knowledge'],
      automatic: true,
    });
    expect(result.artifact.metadata).toMatchObject({
      obsidianStatus: 'synced',
      obsidianMode: 'project-knowledge',
      wikiPath: 'Argus/Wiki/App/Review notes.md',
      obsidianPath: 'Argus/Wiki/App/Review notes.md',
    });
  });

  it('marks non-knowledge artifacts as not sent without calling Obsidian', async () => {
    const createKnowledgeDocumentFromArtifact = vi.fn();
    const service = serviceModule.createArtifactService({
      db: database,
      createId: (prefix) => `${prefix}_${++ids}`,
      createKnowledgeDocumentFromArtifact,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: true,
        defaultMode: 'project-knowledge',
      }),
    });

    const result = await service.createArtifact({
      kind: 'browser-screenshot',
      title: 'Preview',
      content: 'data:image/png;base64,aaa',
      metadata: { source: 'browser' },
    });

    expect(createKnowledgeDocumentFromArtifact).not.toHaveBeenCalled();
    expect(result.obsidianBridge).toBeNull();
    expect(result.artifact.metadata).toMatchObject({
      obsidianStatus: 'not_sent',
    });
  });

  it('honors artifact obsidianMode metadata during automatic export', async () => {
    const createKnowledgeDocumentFromArtifact = vi.fn(async () => ({
      success: true,
      destination: 'obsidian',
      path: 'Argus/SecondBrain/2026/Idea.md',
      fallbackPath: '',
    }));
    const service = serviceModule.createArtifactService({
      db: database,
      createId: (prefix) => `${prefix}_${++ids}`,
      extractProjectDirectory: async () => projectRoot,
      createKnowledgeDocumentFromArtifact,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: true,
        defaultMode: 'project-knowledge',
      }),
    });

    const result = await service.createArtifact({
      kind: 'knowledge',
      title: 'SecondBrain idea',
      projectName: 'App',
      sessionId: 'session-1',
      content: '# Idea\n\n- Thought: keep this in the second brain.',
      metadata: {
        source: 'chat-auto-capture',
        obsidianMode: 'second-brain',
      },
    });

    expect(result.obsidianBridge).toMatchObject({
      mode: 'second-brain',
      destination: 'obsidian',
    });
    expect(result.artifact.metadata).toMatchObject({
      obsidianMode: 'second-brain',
    });
    expect(createKnowledgeDocumentFromArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ id: result.artifact.id }),
      expect.objectContaining({ mode: 'second-brain', projectRoot }),
    );
  });

  it('exports each matched Obsidian mode for multi-destination auto capture', async () => {
    const createKnowledgeDocumentFromArtifact = vi.fn(async (_artifact, options) => ({
      success: true,
      destination: 'obsidian',
      path: options.mode === 'second-brain'
        ? 'Argus/SecondBrain/2026/GPUScene.md'
        : 'Argus/Projects/App/GPUScene.md',
      fallbackPath: '',
    }));
    const service = serviceModule.createArtifactService({
      db: database,
      createId: (prefix) => `${prefix}_${++ids}`,
      extractProjectDirectory: async () => projectRoot,
      createKnowledgeDocumentFromArtifact,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: true,
        defaultMode: 'project-knowledge',
      }),
    });

    const result = await service.createArtifact({
      kind: 'knowledge',
      title: 'GPUScene 系统代码审查报告',
      projectName: 'App',
      sessionId: 'session-1',
      content: '# GPUScene 系统代码审查报告',
      metadata: {
        source: 'chat-auto-capture',
        obsidianMode: 'second-brain',
        obsidianModes: ['second-brain', 'project-knowledge'],
      },
    });

    expect(createKnowledgeDocumentFromArtifact).toHaveBeenCalledTimes(2);
    expect(createKnowledgeDocumentFromArtifact).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: result.artifact.id }),
      expect.objectContaining({
        mode: 'second-brain',
        argusId: `artifact:${result.artifact.id}:second-brain`,
      }),
    );
    expect(createKnowledgeDocumentFromArtifact).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: result.artifact.id }),
      expect.objectContaining({
        mode: 'project-knowledge',
        argusId: `artifact:${result.artifact.id}:project-knowledge`,
      }),
    );
    expect(result.obsidianBridge).toMatchObject({
      mode: 'second-brain',
      targets: [
        expect.objectContaining({ mode: 'second-brain', path: 'Argus/SecondBrain/2026/GPUScene.md' }),
        expect.objectContaining({ mode: 'project-knowledge', path: 'Argus/Projects/App/GPUScene.md' }),
      ],
    });
    expect(result.artifact.metadata).toMatchObject({
      obsidianMode: 'second-brain',
      obsidianModes: ['second-brain', 'project-knowledge'],
      obsidianPaths: {
        'second-brain': 'Argus/SecondBrain/2026/GPUScene.md',
        'project-knowledge': 'Argus/Projects/App/GPUScene.md',
      },
    });
  });

  it('lets manual auto resend keep every stored Obsidian mode', async () => {
    const createKnowledgeDocumentFromArtifact = vi.fn(async (_artifact, options) => ({
      success: true,
      destination: 'obsidian',
      path: options.mode === 'second-brain'
        ? 'Argus/SecondBrain/2026/GPUScene.md'
        : 'Argus/Projects/App/GPUScene.md',
      fallbackPath: '',
    }));
    const service = serviceModule.createArtifactService({
      db: database,
      createId: (prefix) => `${prefix}_${++ids}`,
      extractProjectDirectory: async () => projectRoot,
      createKnowledgeDocumentFromArtifact,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: false,
        defaultMode: 'project-knowledge',
      }),
    });

    const { artifact } = await service.createArtifact({
      kind: 'knowledge',
      title: 'GPUScene 系统代码审查报告',
      projectName: 'App',
      sessionId: 'session-1',
      content: '# GPUScene 系统代码审查报告',
      metadata: {
        source: 'chat-auto-capture',
        obsidianMode: 'second-brain',
        obsidianModes: ['second-brain', 'project-knowledge'],
      },
    }, { autoExport: false });

    const obsidianBridge = await service.exportArtifactToObsidianModes(artifact, {
      modes: artifact.metadata.obsidianModes,
      automatic: false,
    });

    expect(createKnowledgeDocumentFromArtifact).toHaveBeenCalledTimes(2);
    expect(obsidianBridge.targets).toEqual([
      expect.objectContaining({ mode: 'second-brain' }),
      expect.objectContaining({ mode: 'project-knowledge' }),
    ]);
    const updated = await service.getArtifact(artifact.id, { includeContent: true });
    expect(updated.metadata.obsidianPaths).toMatchObject({
      'second-brain': 'Argus/SecondBrain/2026/GPUScene.md',
      'project-knowledge': 'Argus/Projects/App/GPUScene.md',
    });
  });

  it('derives manual auto resend modes from old routing scores when routingModes are missing', async () => {
    const createKnowledgeDocumentFromArtifact = vi.fn(async (_artifact, options) => ({
      success: true,
      destination: 'obsidian',
      path: options.mode === 'second-brain'
        ? 'Argus/SecondBrain/2026/Legacy.md'
        : 'Argus/Projects/App/Legacy.md',
      fallbackPath: '',
    }));
    const service = serviceModule.createArtifactService({
      db: database,
      createId: (prefix) => `${prefix}_${++ids}`,
      extractProjectDirectory: async () => projectRoot,
      createKnowledgeDocumentFromArtifact,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: false,
        defaultMode: 'project-knowledge',
      }),
    });

    const { artifact } = await service.createArtifact({
      kind: 'knowledge',
      title: 'Legacy GPUScene report',
      projectName: 'App',
      sessionId: 'session-1',
      content: '# Legacy GPUScene report',
      metadata: {
        source: 'chat-auto-capture',
        obsidianMode: 'second-brain',
        routingScores: {
          'project-knowledge': 1,
          'second-brain': 1,
          'ai-memory': 0,
        },
      },
    }, { autoExport: false });

    const obsidianBridge = await service.exportArtifactToObsidianModes(artifact, {
      automatic: false,
    });

    expect(obsidianBridge.targets).toEqual([
      expect.objectContaining({ mode: 'second-brain' }),
      expect.objectContaining({ mode: 'project-knowledge' }),
    ]);
  });

  it('normalizes fallback export metadata for retry/status UI', async () => {
    const service = serviceModule.createArtifactService({
      db: database,
      createId: (prefix) => `${prefix}_${++ids}`,
      extractProjectDirectory: async () => projectRoot,
      createKnowledgeDocumentFromArtifact: vi.fn(async () => ({
        success: true,
        destination: 'fallback',
        fallbackPath: join(projectRoot, 'docs', 'knowledge', 'project-knowledge', 'Review.md'),
        error: 'Unable to reach Obsidian bridge.',
        errorCode: 'OBSIDIAN_BRIDGE_UNREACHABLE',
      })),
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: false,
        defaultMode: 'project-knowledge',
      }),
    });
    const { artifact } = await service.createArtifact({
      kind: 'review-notes',
      title: 'Review',
      projectName: 'App',
      content: '# Review',
    }, { autoExport: false });

    const obsidianBridge = await service.exportArtifactToObsidian(artifact, {
      mode: 'project-knowledge',
      automatic: false,
    });
    const updated = await service.getArtifact(artifact.id, { includeContent: true });

    expect(obsidianBridge).toMatchObject({
      destination: 'fallback',
      fallbackPath: expect.stringContaining('Review.md'),
      errorCode: 'OBSIDIAN_BRIDGE_UNREACHABLE',
      automatic: false,
    });
    expect(updated.metadata).toMatchObject({
      obsidianStatus: 'fallback',
      obsidianMode: 'project-knowledge',
      obsidianFallbackPath: expect.stringContaining('Review.md'),
      obsidianLastError: 'Unable to reach Obsidian bridge.',
    });
  });

  it('keeps route modules from directly inserting artifacts', async () => {
    const { readFile } = await import('node:fs/promises');
    const routeFiles = [
      'server/routes/artifacts.js',
      'server/routes/automations.js',
      'server/routes/project-actions.js',
      'server/routes/worktrees.js',
    ];

    for (const file of routeFiles) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(/INSERT\s+INTO\s+artifacts/i);
    }
  });

  it('auto-captures summary-like assistant replies as Obsidian knowledge artifacts', async () => {
    const captureModule = await import('../chat-knowledge-capture-service.js');
    const createArtifact = vi.fn(async (payload) => ({
      artifact: { id: 'artifact_1', ...payload },
      obsidianBridge: { destination: 'obsidian', path: 'Argus/Projects/App/Summary.md' },
    }));
    const service = captureModule.createChatKnowledgeCaptureService({
      createArtifact,
      findExistingCapture: () => null,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: true,
        defaultMode: 'project-knowledge',
      }),
    });

    const result = await service.autoCaptureChatKnowledge({
      sourceId: 'chat:session-1:message-1',
      projectName: 'App',
      sessionId: 'session-1',
      provider: 'codex',
      userPrompt: '总结一下今天的决策和后续计划',
      content: [
        '# Summary',
        '',
        '- Decision: keep the self-hosted Obsidian bridge.',
        '- Plan: write project knowledge into Argus/Projects.',
        '- Next: verify the smoke flow and document the install path.',
      ].join('\n'),
    });

    expect(result).toMatchObject({
      success: true,
      captured: true,
      mode: 'project-knowledge',
      kind: 'session-summary',
      obsidianBridge: { destination: 'obsidian' },
    });
    expect(createArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'session-summary',
        projectName: 'App',
        sessionId: 'session-1',
        metadata: expect.objectContaining({
          source: 'chat-auto-capture',
          sourceId: 'chat:session-1:message-1',
          obsidianMode: 'project-knowledge',
          provider: 'codex',
        }),
      }),
    );
  });

  it('skips ordinary short chat replies during automatic Obsidian capture', async () => {
    const captureModule = await import('../chat-knowledge-capture-service.js');
    const createArtifact = vi.fn();
    const service = captureModule.createChatKnowledgeCaptureService({
      createArtifact,
      findExistingCapture: () => null,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: true,
        defaultMode: 'project-knowledge',
      }),
    });

    const result = await service.autoCaptureChatKnowledge({
      sourceId: 'chat:session-1:message-2',
      projectName: 'App',
      sessionId: 'session-1',
      userPrompt: '这个 API 是什么？',
      content: '不是。这个 token 是 Argus Bridge 插件自己的配对 token，不是第三方 API key。',
    });

    expect(result).toMatchObject({
      success: true,
      captured: false,
      reason: 'not_knowledge',
    });
    expect(createArtifact).not.toHaveBeenCalled();
  });

  it('classifies explicit SecondBrain and AIMemory prompts into their target modes', async () => {
    const captureModule = await import('../chat-knowledge-capture-service.js');

    expect(captureModule.assessChatKnowledgeCapture({
      userPrompt: '保存到 SecondBrain',
      content: '# 想法整理\n\n- 这是一个长期主题想法。\n- 后续可以继续扩展成阅读笔记。',
      defaultMode: 'project-knowledge',
    })).toMatchObject({
      shouldCapture: true,
      mode: 'second-brain',
    });

    expect(captureModule.assessChatKnowledgeCapture({
      userPrompt: '保存成 AIMemory',
      content: '# 长期记忆\n\n- 用户偏好: 自动写入前需要稳定去重。\n- 事实: Obsidian vault 名称是 self。',
      defaultMode: 'project-knowledge',
    })).toMatchObject({
      shouldCapture: true,
      mode: 'ai-memory',
    });
  });

  it('infers SecondBrain and AIMemory modes from content without explicit target words', async () => {
    const captureModule = await import('../chat-knowledge-capture-service.js');

    expect(captureModule.assessChatKnowledgeCapture({
      userPrompt: 'summarize this',
      content: [
        '# Reading Notes: Personal Knowledge Systems',
        '',
        '- Idea: keep project output separate from evergreen thinking.',
        '- Person: Tiago Forte connects capture, organization, and expression.',
        '- Question: how should this become a reusable theme in the second layer of notes?',
        '- Insight: this belongs with reading notes and long-running ideas, not a single project.',
      ].join('\n'),
      defaultMode: 'project-knowledge',
    })).toMatchObject({
      shouldCapture: true,
      mode: 'second-brain',
    });

    expect(captureModule.assessChatKnowledgeCapture({
      userPrompt: 'summarize this',
      content: [
        '# Durable User Facts',
        '',
        '- User prefers automatic Obsidian routing without explicit commands.',
        '- When replying, remember that knowledge destination should be inferred from the content.',
        '- Future chat context should use this preference unless the user changes it.',
      ].join('\n'),
      defaultMode: 'project-knowledge',
    })).toMatchObject({
      shouldCapture: true,
      mode: 'ai-memory',
    });
  });

  it('keeps project implementation and review summaries in project knowledge', async () => {
    const captureModule = await import('../chat-knowledge-capture-service.js');

    expect(captureModule.assessChatKnowledgeCapture({
      userPrompt: '总结一下',
      content: [
        '# Obsidian Bridge 代码审查总结',
        '',
        '- Review: server/routes/obsidian-bridge.js now exposes auto-capture APIs.',
        '- Decision: artifact-service must honor obsidianMode metadata during automatic export.',
        '- Plan: run unit tests, typecheck, and package smoke before release.',
      ].join('\n'),
      defaultMode: 'project-knowledge',
    })).toMatchObject({
      shouldCapture: true,
      mode: 'project-knowledge',
    });
  });

  it('deduplicates chat auto-capture by content fingerprint when source ids drift', async () => {
    const captureModule = await import('../chat-knowledge-capture-service.js');
    const artifactService = serviceModule.createArtifactService({
      db: database,
      createId: (prefix) => `${prefix}_${++ids}`,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: false,
        defaultMode: 'project-knowledge',
      }),
    });
    const service = captureModule.createChatKnowledgeCaptureService({
      db: database,
      createArtifact: (payload) => artifactService.createArtifact(payload, { autoExport: false }),
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: true,
        defaultMode: 'project-knowledge',
      }),
    });
    const content = [
      '# GPUDrivenStreaming 代码审查总结',
      '',
      '- Summary: review found several ownership issues.',
      '- Decision: keep the current bridge route.',
      '- Plan: add stable dedupe for Obsidian writes.',
    ].join('\n');

    const first = await service.autoCaptureChatKnowledge({
      sourceId: 'chat:session-1:message-assistant-b77f2922-f8cd-46dc-834b-8eeeea568440_0',
      projectName: 'App',
      sessionId: 'session-1',
      provider: 'claude',
      previousUserPrompt: '总结一下',
      timestamp: '2026-05-07T11:21:46.862Z',
      content,
    });
    const second = await service.autoCaptureChatKnowledge({
      sourceId: 'chat:session-1:message-assistant-b77f2922-f8cd-46dc-834b-8eeeea568440_0-58',
      projectName: 'App',
      sessionId: 'session-1',
      provider: 'claude',
      previousUserPrompt: '总结一下',
      timestamp: '2026-05-07T11:21:46.862Z',
      content,
    });

    expect(first).toMatchObject({ captured: true });
    expect(second).toMatchObject({
      captured: false,
      reason: 'duplicate',
      artifactId: first.artifact.id,
    });
    const count = database.prepare('SELECT COUNT(*) AS count FROM artifacts').get().count;
    expect(count).toBe(1);
  });

  afterEach(async () => {
    database?.close();
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
