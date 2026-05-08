import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('Runtime settings Obsidian bridge entry', () => {
  it('renders the Obsidian bridge settings content from the runtime tab', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'RuntimeSettingsTab.tsx'), 'utf8');

    expect(source).toContain('ObsidianBridgeSettingsContent');
    expect(source).toContain('./runtime-settings/ObsidianBridgeSettingsContent');
  });

  it('wires bridge settings to the public API and exposes the three output modes', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(currentDir, 'runtime-settings', 'ObsidianBridgeSettingsContent.tsx'),
      'utf8',
    );

    expect(source).toContain('/api/settings/obsidian-bridge');
    expect(source).toContain('/api/obsidian-bridge/test-connection');
    expect(source).toContain('/api/obsidian-bridge/vaults');
    expect(source).toContain('/api/obsidian-bridge/install-plugin');
    expect(source).toContain('安装插件到 vault');
    expect(source).toContain('刷新 vault');
    expect(source).toContain('SettingsToggle');
    expect(source).toContain('autoExportKnowledgeArtifacts');
    expect(source).toContain('fallbackToProjectKnowledge');
    expect(source).toContain('aiMemoryReadbackEnabled');
    expect(source).toContain('aiMemoryMaxResults');
    expect(source).toContain('aiMemoryProjectScopeEnabled');
    expect(source).toContain('activeNoteReadbackEnabled');
    expect(source).toContain('activeVaultId');
    expect(source).toContain('dailyNoteFolder');
    expect(source).toContain('dailyNoteHeading');
    expect(source).toContain('mcpEnabled');
    expect(source).toContain('/api/obsidian-bridge/active');
    expect(source).toContain('/api/obsidian-bridge/query');
    expect(source).toContain('/api/obsidian-bridge/mcp/install');
    expect(source).toContain('/api/obsidian-bridge/memory/candidates');
    expect(source).toContain('/api/obsidian-bridge/memory/commit');
    expect(source).toContain('AI 记忆候选队列');
    expect(source).toContain('测试当前笔记');
    expect(source).toContain('安装 MCP');
    expect(source).toContain('readableVaultFolders');
    expect(source).toContain('lastConnection');
    expect(source).toContain('pluginVersion');
    expect(source).toContain('/api/obsidian-bridge/search');
    expect(source).toContain('/api/obsidian-bridge/context');
    expect(source).toContain('/api/obsidian-bridge/routing/preview');
    expect(source).toContain('/api/obsidian-bridge/duplicates/scan');
    expect(source).toContain('/api/obsidian-bridge/duplicates/archive');
    expect(source).toContain('/api/obsidian-bridge/auto-capture/backfill');
    expect(source).toContain('/api/obsidian-bridge/auto-capture/status');
    expect(source).toContain('/api/obsidian-bridge/wiki/compile');
    expect(source).toContain('/api/obsidian-bridge/wiki/lint');
    expect(source).toContain('wikiCompilerEnabled');
    expect(source).toContain('Wiki Compiler');
    expect(source).toContain('测试自动路由');
    expect(source).toContain('重复笔记清理');
    expect(source).toContain('Obsidian 知识库');
    expect(source).toContain('自动导出知识结果');
    expect(source).toContain('不可达时回退到项目文档');
    expect(source).toContain('project-knowledge');
    expect(source).toContain('second-brain');
    expect(source).toContain('ai-memory');
  });

  it('wires Results artifacts to manual Obsidian export controls', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(currentDir, '..', '..', '..', 'artifacts', 'view', 'ArtifactsPanel.tsx'),
      'utf8',
    );

    expect(source).toContain('/send-to-obsidian');
    expect(source).toContain('发送到 Obsidian');
    expect(source).toContain('obsidianBridge');
    expect(source).toContain('已写入 Obsidian');
    expect(source).toContain('已回退到 docs/knowledge');
    expect(source).toContain('同步失败');
    expect(source).toContain('未发送');
    expect(source).toContain('路由原因');
    expect(source).toContain('自动');
    expect(source).toContain('项目知识库');
    expect(source).toContain('第二大脑');
    expect(source).toContain('AI 记忆');
    expect(source).toContain('project-knowledge');
    expect(source).toContain('second-brain');
    expect(source).toContain('ai-memory');
    expect(source).toContain('/api/obsidian-bridge/wiki/upload');
    expect(source).toContain('上传到知识库');
    expect(source).toContain('自主落库');
  });

  it('wires chat file attachments to the Obsidian wiki ingest toggle', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const hookSource = readFileSync(
      resolve(currentDir, '..', '..', '..', 'chat', 'hooks', 'useChatComposerState.ts'),
      'utf8',
    );
    const composerSource = readFileSync(
      resolve(currentDir, '..', '..', '..', 'chat', 'view', 'subcomponents', 'ChatComposer.tsx'),
      'utf8',
    );
    const interfaceSource = readFileSync(
      resolve(currentDir, '..', '..', '..', 'chat', 'view', 'ChatInterface.tsx'),
      'utf8',
    );

    expect(hookSource).toContain('ingestAttachmentsToObsidian');
    expect(hookSource).toContain("formData.append('obsidianIngest'");
    expect(composerSource).toContain('同时落库到 Obsidian');
    expect(interfaceSource).toContain('ingestAttachmentsToObsidian');
  });
});
