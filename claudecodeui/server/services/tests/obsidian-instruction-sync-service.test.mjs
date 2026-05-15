import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createObsidianInstructionSyncService } from '../obsidian-instruction-sync-service.js';

describe('Obsidian instruction sync service', () => {
  it('syncs project MTL.md writes to Obsidian project Wiki', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'argus-mtl-sync-'));
    const filePath = join(projectPath, 'MTL.md');
    await writeFile(filePath, '# MTL.md\n\nUse bun for Claude Code package tasks.\n', 'utf8');

    const ingestKnowledgeSourceToWiki = vi.fn(async () => ({
      success: true,
      destination: 'obsidian',
      wikiPath: 'Argus/Wiki/App/mtl-md.md',
    }));
    const service = createObsidianInstructionSyncService({
      ingestKnowledgeSourceToWiki,
      readObsidianBridgeConfig: () => ({ enabled: true }),
    });

    try {
      const result = await service.syncInstructionFile({
        filePath,
        projectPath,
        projectName: 'App',
        sessionId: 'session-1',
        provider: 'claude',
        toolName: 'Write',
      });

      expect(result).toMatchObject({
        success: true,
        captured: true,
        status: 'captured',
        reason: 'instruction_file_synced',
        mode: 'project-knowledge',
        obsidianBridge: {
          destination: 'obsidian',
          path: 'Argus/Wiki/App/mtl-md.md',
        },
      });
      expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledWith(expect.objectContaining({
        source: 'project-instructions',
        sourceId: expect.stringContaining('MTL.md'),
        title: 'App MTL.md',
        projectName: 'App',
        sessionId: 'session-1',
        content: expect.stringContaining('Use bun for Claude Code package tasks.'),
        kind: 'project-instructions',
        modes: ['project-knowledge'],
        forceRecompile: true,
        metadata: expect.objectContaining({
          source: 'project-instructions',
          instructionFile: true,
          instructionFileName: 'MTL.md',
          relativePath: 'MTL.md',
          obsidianMode: 'project-knowledge',
          obsidianModes: ['project-knowledge'],
          provider: 'claude',
          toolName: 'Write',
        }),
      }));
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  it('does not sync personal MTL.local.md files', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'argus-mtl-local-'));
    const filePath = join(projectPath, 'MTL.local.md');
    await writeFile(filePath, '# MTL.local.md\n\nPersonal sandbox details.\n', 'utf8');

    const ingestKnowledgeSourceToWiki = vi.fn();
    const service = createObsidianInstructionSyncService({
      ingestKnowledgeSourceToWiki,
      readObsidianBridgeConfig: () => ({ enabled: true }),
    });

    try {
      const result = await service.syncInstructionFile({
        filePath,
        projectPath,
        projectName: 'App',
        sessionId: 'session-1',
        provider: 'claude',
        toolName: 'Write',
      });

      expect(result).toMatchObject({
        success: true,
        captured: false,
        reason: 'unsupported_instruction_path',
      });
      expect(ingestKnowledgeSourceToWiki).not.toHaveBeenCalled();
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  it('scans a project for MTL.md as a post-turn fallback', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'argus-mtl-scan-'));
    await writeFile(join(projectPath, 'MTL.md'), '# MTL.md\n\nProject guidance from /init.\n', 'utf8');

    const ingestKnowledgeSourceToWiki = vi.fn(async () => ({
      success: true,
      destination: 'obsidian',
      wikiPath: 'Argus/Wiki/App/mtl-md.md',
    }));
    const service = createObsidianInstructionSyncService({
      ingestKnowledgeSourceToWiki,
      readObsidianBridgeConfig: () => ({ enabled: true }),
    });

    try {
      const result = await service.syncProjectInstructionFiles({
        projectPath,
        projectName: 'App',
        sessionId: 'session-2',
        provider: 'claude',
        trigger: 'turn_complete_scan',
      });

      expect(result).toMatchObject({
        success: true,
        captured: true,
        reason: 'project_instruction_scan',
      });
      expect(result.results).toHaveLength(1);
      expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledTimes(1);

      const duplicate = await service.syncProjectInstructionFiles({
        projectPath,
        projectName: 'App',
        sessionId: 'session-2',
        provider: 'claude',
        trigger: 'turn_complete_scan',
      });

      expect(duplicate).toMatchObject({
        success: true,
        captured: false,
        reason: 'project_instruction_scan',
      });
      expect(duplicate.results[0]).toMatchObject({
        captured: false,
        reason: 'unchanged_instruction_file',
      });
      expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledTimes(1);
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  it('syncs Claude-compatible instruction files into Obsidian project Wiki', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'argus-claude-md-sync-'));
    await writeFile(join(projectPath, 'CLAUDE.md'), '# CLAUDE.md\n\nUse PowerShell examples on Windows.\n', 'utf8');
    await mkdir(join(projectPath, '.claude'), { recursive: true });
    await writeFile(join(projectPath, '.claude', 'CLAUDE.md'), '# Nested CLAUDE.md\n\nPrefer focused patches.\n', 'utf8');

    const ingestKnowledgeSourceToWiki = vi.fn(async ({ metadata }) => ({
      success: true,
      destination: 'obsidian',
      wikiPath: `Argus/Wiki/App/${metadata.topicKey}.md`,
    }));
    const service = createObsidianInstructionSyncService({
      ingestKnowledgeSourceToWiki,
      readObsidianBridgeConfig: () => ({ enabled: true }),
    });

    try {
      const result = await service.syncProjectInstructionFiles({
        projectPath,
        projectName: 'App',
        sessionId: 'session-claude',
        provider: 'claude',
        trigger: 'turn_complete_scan',
      });

      expect(result).toMatchObject({
        success: true,
        captured: true,
        reason: 'project_instruction_scan',
      });
      expect(result.results).toHaveLength(2);
      expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledTimes(2);
      expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledWith(expect.objectContaining({
        sourceId: expect.stringContaining('CLAUDE.md'),
        title: 'App CLAUDE.md',
        content: expect.stringContaining('Use PowerShell examples on Windows.'),
        topicKey: 'claude-md',
        metadata: expect.objectContaining({
          instructionFileName: 'CLAUDE.md',
          relativePath: 'CLAUDE.md',
          topicKey: 'claude-md',
        }),
      }));
      expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledWith(expect.objectContaining({
        sourceId: expect.stringContaining('.claude/CLAUDE.md'),
        content: expect.stringContaining('Prefer focused patches.'),
        topicKey: 'claude-claude-md',
        metadata: expect.objectContaining({
          instructionFileName: 'CLAUDE.md',
          relativePath: '.claude/CLAUDE.md',
          topicKey: 'claude-claude-md',
        }),
      }));
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  it('creates a project MTL.md before syncing when no instruction files exist', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'argus-mtl-autocreate-'));

    const ingestKnowledgeSourceToWiki = vi.fn(async () => ({
      success: true,
      destination: 'obsidian',
      wikiPath: 'Argus/Wiki/App/mtl-md.md',
    }));
    const service = createObsidianInstructionSyncService({
      ingestKnowledgeSourceToWiki,
      readObsidianBridgeConfig: () => ({ enabled: true }),
    });

    try {
      const result = await service.syncProjectInstructionFiles({
        projectPath,
        projectName: 'App',
        sessionId: 'session-create',
        provider: 'claude',
        trigger: 'turn_complete_scan',
      });

      const createdFile = join(projectPath, 'MTL.md');
      await expect(stat(createdFile)).resolves.toMatchObject({ isFile: expect.any(Function) });
      await expect(readFile(createdFile, 'utf8')).resolves.toContain('# MTL.md');
      expect(result).toMatchObject({
        success: true,
        captured: true,
        reason: 'project_instruction_scan',
        generated: true,
      });
      expect(result.results[0]).toMatchObject({
        captured: true,
        reason: 'instruction_file_synced',
      });
      expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledTimes(1);
      expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledWith(expect.objectContaining({
        title: 'App MTL.md',
        content: expect.stringContaining('This file provides guidance to Argus'),
        metadata: expect.objectContaining({
          generatedInstructionFile: true,
          relativePath: 'MTL.md',
        }),
      }));
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  it('ensures a project MTL.md exists before a project conversation starts', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'argus-mtl-preflight-'));
    const service = createObsidianInstructionSyncService({
      ingestKnowledgeSourceToWiki: vi.fn(),
      readObsidianBridgeConfig: () => ({ enabled: true }),
    });

    try {
      const result = await service.ensureProjectInstructionFile({
        projectPath,
        projectName: 'App',
        provider: 'claude',
        trigger: 'preflight_project_conversation',
      });

      expect(result).toMatchObject({
        success: true,
        created: true,
        reason: 'instruction_file_created',
        relativePath: 'MTL.md',
      });
      await expect(readFile(join(projectPath, 'MTL.md'), 'utf8')).resolves.toContain('# MTL.md');

      const second = await service.ensureProjectInstructionFile({
        projectPath,
        projectName: 'App',
        provider: 'claude',
        trigger: 'preflight_project_conversation',
      });
      expect(second).toMatchObject({
        success: true,
        created: false,
        reason: 'instruction_file_exists',
        relativePath: 'MTL.md',
      });
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });
});
