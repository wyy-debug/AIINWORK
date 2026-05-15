import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
});
