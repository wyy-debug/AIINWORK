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

  it('organizes runtime settings into top-level tabs like the agent page', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'RuntimeSettingsTab.tsx'), 'utf8');

    expect(source).toContain('RUNTIME_SETTINGS_TABS');
    expect(source).toContain("id: 'local-permissions'");
    expect(source).toContain("id: 'obsidian'");
    expect(source).toContain("id: 'openmythos'");
    expect(source).toContain('本地执行权限');
    expect(source).toContain('Obsidian 知识库');
    expect(source).toContain('OpenMythos 运行时');
    expect(source).toContain('role="tablist"');
    expect(source).toContain('selectedRuntimeTab');
    expect(source).toContain('renderLocalPermissionsTab');
    expect(source).toContain('renderObsidianTab');
    expect(source).toContain('renderOpenMythosTab');
    expect(source).toContain("selectedRuntimeTab === 'local-permissions'");
    expect(source).toContain("selectedRuntimeTab === 'obsidian'");
    expect(source).toContain("selectedRuntimeTab === 'openmythos'");
    expect(source).toContain('保存本地执行权限');
  });

  it('wires bridge settings to the public API and exposes the compact tab layout', () => {
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
    expect(source).toContain('aiMemoryReadbackEnabled');
    expect(source).toContain('aiMemoryMaxResults');
    expect(source).toContain('aiMemoryProjectScopeEnabled');
    expect(source).toContain('activeNoteReadbackEnabled');
    expect(source).toContain('activeVaultId');
    expect(source).toContain('mcpEnabled');
    expect(source).toContain('/api/obsidian-bridge/active');
    expect(source).toContain('/api/obsidian-bridge/query');
    expect(source).toContain('/api/obsidian-bridge/mcp/install');
    expect(source).toContain('/api/obsidian-bridge/memory/candidates');
    expect(source).toContain('/api/obsidian-bridge/memory/commit');
    expect(source).toContain('AI Memory 候选入口');
    expect(source).toContain('测试当前笔记');
    expect(source).toContain('安装 MCP');
    expect(source).toContain('readableVaultFolders');
    expect(source).toContain('lastConnection');
    expect(source).toContain('pluginVersion');
    expect(source).toContain('/api/obsidian-bridge/search');
    expect(source).toContain('/api/obsidian-bridge/context');
    expect(source).toContain('/api/obsidian-bridge/duplicates/scan');
    expect(source).toContain('/api/obsidian-bridge/duplicates/archive');
    expect(source).toContain('/api/obsidian-bridge/auto-capture/backfill');
    expect(source).toContain('/api/obsidian-bridge/auto-capture/status');
    expect(source).toContain('OBSIDIAN_BRIDGE_TABS');
    expect(source).toContain("id: 'connection'");
    expect(source).toContain("id: 'knowledge'");
    expect(source).toContain("id: 'advanced'");
    expect(source).toContain('连接');
    expect(source).toContain('知识库');
    expect(source).toContain('高级');
    expect(source).toContain('role="tablist"');
    expect(source).toContain('selectedObsidianTab');
    expect(source).toContain('最近错误');
    expect(source).toContain('重复笔记清理');
    expect(source).toContain('Obsidian 知识库');
    expect(source).not.toContain('Daily note 目录');
    expect(source).not.toContain('Daily note 标题');
    expect(source).not.toContain('默认写入形态');
    expect(source).not.toContain('测试自动路由');
    expect(source).not.toContain('Schema 目录');
    expect(source).not.toContain('Wiki Compiler');
  });

  it('keeps the Obsidian settings page compact and links to global small model settings', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(currentDir, 'runtime-settings', 'ObsidianBridgeSettingsContent.tsx'),
      'utf8',
    );
    const settingsSource = readFileSync(resolve(currentDir, '..', 'Settings.tsx'), 'utf8');

    expect(source).toContain('连接 Obsidian');
    expect(source).toContain('上传/保存成 Wiki');
    expect(source).toContain('Wiki 回读注入');
    expect(source).toContain('打开小模型设置');
    expect(source).toContain('高级诊断');
    expect(source).not.toContain('<details');
    expect(source).toContain('onOpenSmallModelSettings');
    expect(settingsSource).toContain('agentInitialCategory');
    expect(settingsSource).toContain('small-model');
  });

  it('exposes a direct knowledge-base upload entry from the Obsidian settings page', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(currentDir, 'runtime-settings', 'ObsidianBridgeSettingsContent.tsx'),
      'utf8',
    );

    expect(source).toContain('knowledgeUploadInputRef');
    expect(source).toContain('uploadKnowledgeFiles');
    expect(source).toContain('/api/obsidian-bridge/wiki/upload');
    expect(source).toContain('summaryType');
    expect(source).toContain('WIKI_SUMMARY_TYPES');
    expect(source).toContain('technical-review');
    expect(source).toContain('compileQualityStatus');
    expect(source).toContain('wikiReadbackPreview');
    expect(source).toContain('reranked');
    expect(source).toContain('rerankModel');
    expect(source).toContain("formData.append('files'");
    expect(source).toContain('wikiCompiler');
    expect(source).toContain('wikiCompileChunks');
    expect(source).toContain('extractionEngine');
    expect(source).toContain('pdfExtractedPages');
    expect(source).toContain('小模型编译');
    expect(source).toContain('fallback 编译');
    expect(source).toContain('上传现有文件');
    expect(source).toContain('Raw → Wiki → Index');
  });

  it('keeps Results focused on manual Wiki upload and implemented artifact actions', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(currentDir, '..', '..', '..', 'artifacts', 'view', 'ArtifactsPanel.tsx'),
      'utf8',
    );

    expect(source).toContain('/send-to-obsidian');
    expect(source).toContain('\u4fdd\u5b58\u5230 Wiki');
    expect(source).toContain('\u4e0a\u4f20\u6587\u4ef6\u5230 Wiki');
    expect(source).toContain('\u7ed3\u679c\u8be6\u60c5');
    expect(source).toContain('\u590d\u5236\u5185\u5bb9');
    expect(source).toContain('\u653e\u5165\u5bf9\u8bdd');
    expect(source).toContain('\u5220\u9664\u7ed3\u679c');
    expect(source).toContain('obsidianBridge');
    expect(source).toContain('\u5df2\u4fdd\u5b58\u5230 Wiki');
    expect(source).toContain('\u5df2\u56de\u9000\u5230 docs/knowledge');
    expect(source).toContain('\u540c\u6b65\u5931\u8d25');
    expect(source).toContain('\u672a\u4fdd\u5b58');
    expect(source).toContain('\u8bf4\u660e');
    expect(source).toContain('/api/obsidian-bridge/wiki/upload');
    expect(source).toContain('summaryType');
    expect(source).toContain('WIKI_SUMMARY_TYPES');
    expect(source).toContain('technical-review');
    expect(source).toContain('wikiCompiler');
    expect(source).toContain('extractionEngine');
    expect(source).toContain('pdfExtractedPages');
    expect(source).toContain('\u5c0f\u6a21\u578b\u603b\u7ed3');
    expect(source).toContain('fallback \u603b\u7ed3');
    expect(source).toContain('.pdf');
    expect(source).not.toContain('.docx');
    expect(source).not.toContain('.pptx');
    expect(source).not.toContain('SOURCE_FILTERS');
    expect(source).not.toContain('OBSIDIAN_MODES');
    expect(source).not.toContain('Obsidian Inbox');
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
