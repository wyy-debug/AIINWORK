import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ARTIFACTS_TABLE_SQL,
  ARTIFACT_LINKS_TABLE_SQL,
  OBSIDIAN_AUTO_CAPTURE_KEYS_TABLE_SQL,
} from '../../database/schema.js';

describe('chat knowledge capture service', () => {
  let captureModule;
  let database;

  beforeEach(async () => {
    captureModule = await import('../chat-knowledge-capture-service.js');
    database = new Database(':memory:');
    database.exec(ARTIFACTS_TABLE_SQL);
    database.exec(ARTIFACT_LINKS_TABLE_SQL);
    database.exec(OBSIDIAN_AUTO_CAPTURE_KEYS_TABLE_SQL);
  });

  it('returns visible routing scores, signals, and reason for automatic mode decisions', () => {
    const assessment = captureModule.assessChatKnowledgeCapture({
      userPrompt: 'summarize this reading note',
      content: [
        '# Reading Notes: Knowledge Systems',
        '',
        '- Idea: separate evergreen thoughts from project implementation notes.',
        '- Person: Tiago Forte frames capture and expression as a long-running theme.',
        '- Reflection: this belongs in a second brain, not a project change log.',
      ].join('\n'),
      defaultMode: 'project-knowledge',
    });

    expect(assessment).toMatchObject({
      shouldCapture: true,
      mode: 'second-brain',
      routingMode: 'second-brain',
      routingReason: expect.stringContaining('路由到'),
      routingConfidence: expect.any(Number),
    });
    expect(assessment.routingReason).toContain('reading');
    expect(assessment.routingScores).toMatchObject({
      'project-knowledge': expect.any(Number),
      'second-brain': expect.any(Number),
      'ai-memory': expect.any(Number),
    });
    expect(assessment.routingSignals).toEqual(expect.arrayContaining([
      expect.stringMatching(/reading|idea|person|reflection/i),
    ]));
  });

  it('keeps every matched Obsidian destination instead of dropping tied modes', () => {
    const assessment = captureModule.assessChatKnowledgeCapture({
      userPrompt: 'review GPUScene',
      content: [
        '# GPUScene 系统代码审查报告',
        '',
        '- Project: review the implementation and architecture.',
        '- Second brain: this also contains a reusable rendering-system idea.',
      ].join('\n'),
      defaultMode: 'project-knowledge',
    });

    expect(assessment).toMatchObject({
      shouldCapture: true,
      routingMode: 'second-brain',
      routingModes: ['second-brain', 'project-knowledge'],
    });
  });

  it('uses the auto-capture key table to make concurrent captures idempotent', async () => {
    let ids = 0;
    const createArtifact = vi.fn(async (payload) => ({
      artifact: { id: `artifact_${++ids}`, ...payload },
      obsidianBridge: { destination: 'obsidian', path: 'Argus/Projects/App/Summary.md' },
    }));
    const service = captureModule.createChatKnowledgeCaptureService({
      db: database,
      createArtifact,
      findExistingCapture: () => null,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: true,
        defaultMode: 'project-knowledge',
      }),
    });
    const payload = {
      sourceId: 'chat:session-1:message-assistant-1',
      projectName: 'App',
      sessionId: 'session-1',
      provider: 'claude',
      previousUserPrompt: 'summarize this',
      timestamp: '2026-05-07T11:21:46.862Z',
      content: [
        '# Project Summary',
        '',
        '- Summary: implemented backend Obsidian capture.',
        '- Decision: keep automatic export server-side.',
        '- Plan: verify routing and duplicate behavior.',
      ].join('\n'),
    };

    const [first, second] = await Promise.all([
      service.autoCaptureChatKnowledge(payload),
      service.autoCaptureChatKnowledge(payload),
    ]);

    expect(first.captured || second.captured).toBe(true);
    expect(createArtifact).toHaveBeenCalledTimes(1);
    const rows = database.prepare('SELECT * FROM obsidian_auto_capture_keys').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source_id: payload.sourceId,
      status: 'captured',
    });
  });

  it('routes captured assistant knowledge through the Wiki Compiler primary pipeline', async () => {
    const createArtifact = vi.fn(async () => {
      throw new Error('direct artifact creation should not be used by wiki-primary capture');
    });
    const ingestKnowledgeSourceToWiki = vi.fn(async (payload) => ({
      success: true,
      captured: true,
      artifact: { id: 'artifact_wiki_1', metadata: payload.metadata },
      artifactId: 'artifact_wiki_1',
      obsidianBridge: {
        destination: 'obsidian',
        rawPath: 'Argus/Raw/App/2026-05-08/Summary.md',
        wikiPath: 'Argus/Wiki/App/Summary.md',
        indexPaths: ['Argus/Projects/App/Index.md'],
        viewModes: ['project-knowledge'],
      },
    }));
    const service = captureModule.createChatKnowledgeCaptureService({
      db: database,
      createArtifact,
      ingestKnowledgeSourceToWiki,
      findExistingCapture: () => null,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: true,
        wikiPrimaryEnabled: true,
        defaultMode: 'project-knowledge',
      }),
    });

    const result = await service.autoCaptureChatKnowledge({
      sourceId: 'chat:session-1:message-wiki-primary',
      projectName: 'App',
      sessionId: 'session-1',
      provider: 'claude',
      previousUserPrompt: 'summarize this project decision',
      timestamp: '2026-05-08T09:10:11.000Z',
      content: [
        '# Project Summary',
        '',
        '- Summary: Wiki Compiler is now the canonical knowledge layer.',
        '- Decision: Projects should only maintain index links.',
        '- Plan: inject Wiki context in future chat requests.',
      ].join('\n'),
    });

    expect(result).toMatchObject({
      success: true,
      captured: true,
      artifactId: 'artifact_wiki_1',
      obsidianBridge: {
        wikiPath: 'Argus/Wiki/App/Summary.md',
        indexPaths: ['Argus/Projects/App/Index.md'],
      },
    });
    expect(createArtifact).not.toHaveBeenCalled();
    expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledWith(expect.objectContaining({
      source: 'chat-auto-capture',
      title: 'Project Summary',
      projectName: 'App',
      sessionId: 'session-1',
      metadata: expect.objectContaining({
        source: 'chat-auto-capture',
        sourceId: 'chat:session-1:message-wiki-primary',
        obsidianModes: expect.arrayContaining(['project-knowledge']),
      }),
    }));
  });

  it('lets small model classification drive Obsidian capture when rules would skip', async () => {
    const ingestKnowledgeSourceToWiki = vi.fn(async (payload) => ({
      success: true,
      captured: true,
      artifact: { id: 'artifact_ai_routed', metadata: payload.metadata },
      artifactId: 'artifact_ai_routed',
      obsidianBridge: {
        destination: 'obsidian',
        wikiPath: 'Argus/Wiki/App/AI-Routed.md',
      },
    }));
    const classifyKnowledgeWithSmallModel = vi.fn(async ({ ruleAssessment }) => ({
      used: true,
      model: 'gpt-5.4-mini',
      assessment: {
        ...ruleAssessment,
        shouldCapture: true,
        reason: 'knowledge',
        mode: 'second-brain',
        routingMode: 'second-brain',
        routingModes: ['second-brain'],
        routingReason: '小模型判断这是可沉淀总结。',
        routingSignals: ['small model decision'],
        confidence: 0.88,
        routingConfidence: 0.88,
        aiRoutingUsed: true,
        aiRoutingModel: 'gpt-5.4-mini',
      },
    }));
    const service = captureModule.createChatKnowledgeCaptureService({
      db: database,
      createArtifact: vi.fn(),
      ingestKnowledgeSourceToWiki,
      classifyKnowledgeWithSmallModel,
      findExistingCapture: () => null,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        autoExportKnowledgeArtifacts: true,
        wikiPrimaryEnabled: true,
        defaultMode: 'project-knowledge',
      }),
    });

    const result = await service.autoCaptureChatKnowledge({
      sourceId: 'chat:session-small-model:turn-1',
      projectName: 'App',
      sessionId: 'session-small-model',
      provider: 'claude',
      previousUserPrompt: '总结一下',
      timestamp: '2026-05-08T10:10:00.000Z',
      content: '短总结。',
    });

    expect(result).toMatchObject({
      success: true,
      captured: true,
      artifactId: 'artifact_ai_routed',
      mode: 'second-brain',
      aiRoutingUsed: true,
    });
    expect(classifyKnowledgeWithSmallModel).toHaveBeenCalled();
    expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        routingMode: 'second-brain',
        aiRoutingUsed: true,
        aiRoutingModel: 'gpt-5.4-mini',
      }),
    }));
  });
});
