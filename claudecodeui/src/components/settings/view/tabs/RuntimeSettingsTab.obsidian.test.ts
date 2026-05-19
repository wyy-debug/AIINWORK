import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const readLocalSource = (...segments: string[]) => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDir, ...segments), 'utf8');
};

describe('Runtime settings Obsidian bridge entry', () => {
  it('renders the Obsidian bridge settings content from the runtime tab', () => {
    const source = readLocalSource('RuntimeSettingsTab.tsx');

    expect(source).toContain('ObsidianBridgeSettingsContent');
    expect(source).toContain('./runtime-settings/ObsidianBridgeSettingsContent');
  });

  it('organizes runtime settings into top-level tabs like the agent page', () => {
    const source = readLocalSource('RuntimeSettingsTab.tsx');

    expect(source).toContain('RUNTIME_SETTINGS_TABS');
    expect(source).toContain("id: 'local-permissions'");
    expect(source).toContain("id: 'obsidian'");
    expect(source).toContain("id: 'brain'");
    expect(source).toContain('role="tablist"');
    expect(source).toContain('selectedRuntimeTab');
    expect(source).toContain('renderLocalPermissionsTab');
    expect(source).toContain('renderObsidianTab');
    expect(source).toContain('renderBrainTab');
    expect(source).not.toContain('OpenMythos');
  });

  it('wires Argus Brain as the runtime task memory surface', () => {
    const source = readLocalSource('runtime-settings', 'BrainRuntimeContent.tsx');

    expect(source).toContain('/api/settings/mtl-code-model');
    expect(source).toContain('/api/brain/project/');
    expect(source).toContain('brainRuntime');
    expect(source).toContain('Argus Brain');
    expect(source).toContain('Task memory and context restore');
    expect(source).toContain('Claude native memory handles preferences');
    expect(source).toContain('Obsidian remains a Wiki');
    expect(source).toContain('captureRawRefs');
    expect(source).toContain('compactEventThreshold');
    expect(source).toContain('maxInjectedTokens');
    expect(source).toContain('recallTimeoutMs');
    expect(source).not.toContain('openMythosRuntime');
    expect(source).not.toContain('MTL_CODE_OPENMYTHOS');
  });

  it('wires bridge settings to the main Memory and CodeGraph path only', () => {
    const source = readLocalSource('runtime-settings', 'ObsidianBridgeSettingsContent.tsx');

    expect(source).toContain('/api/settings/obsidian-bridge');
    expect(source).toContain('enabled: true');
    expect(source).toContain('/api/obsidian-bridge/test-connection');
    expect(source).toContain('/api/obsidian-bridge/vaults');
    expect(source).toContain('/api/obsidian-bridge/install-plugin');
    expect(source).toContain('/api/obsidian-bridge/select-vault');
    expect(source).toContain('/api/codegraph/status');
    expect(source).toContain('/api/codegraph/sync/background');
    expect(source).toContain('/api/codegraph/export-obsidian');
    expect(source).toContain('SettingsToggle');
    expect(source).toContain('enableMemory');
    expect(source).toContain('enableCodeGraph');
    expect(source).toContain('aiMemoryReadbackEnabled');
    expect(source).toContain('wikiReadbackEnabled');
    expect(source).toContain('codegraphEnabled');
    expect(source).toContain('codegraphBackgroundSyncEnabled');
    expect(source).toContain('codegraphWriteObsidianSummaries');
    expect(source).toContain('codegraphExportLevel');
    expect(source).toContain('codegraphMaxEmbeddedSymbols');
    expect(source).toContain('skippedUnchanged');
    expect(source).toContain('mcpConfigured');
    expect(source).toContain('activeProjectRoot');
    expect(source).toContain('projectRoot: activeProjectRoot');
    expect(source).toContain('codegraphStorageRoot');
    expect(source).toContain('selectDirectory');
    expect(source).toContain('handleSelectCodeGraphStorage');
    expect(source).toContain('CodeGraph 集中存储目录');
    expect(source).toContain('选择目录');
    expect(source).toContain('恢复默认目录');
    expect(source).toContain('开启后自动同步并接入 Claude Code');
    expect(source).toContain('全局开关');
    expect(source).toContain('立即重跑同步');
    expect(source).toContain('立即重新导出');
    expect(source).toContain('activeVaultId');
    expect(source).toContain('readableVaultFolders');
    expect(source).toContain('lastConnection');
    expect(source).toContain('pluginVersion');
    expect(source).toContain('CodeGraph/Index.md');
    expect(source).toContain('Native export level');
    expect(source).toContain('Embedded symbol limit');
    expect(source).toContain('loadCodeGraphStatus({ quiet: true, showSpinner: false })');
    expect(source).not.toContain('OBSIDIAN_BRIDGE_TABS');
    expect(source).not.toContain('selectedObsidianTab');
    expect(source).not.toContain('/api/obsidian-bridge/active');
    expect(source).not.toContain('/api/obsidian-bridge/query');
    expect(source).not.toContain('/api/obsidian-bridge/mcp/install');
    expect(source).not.toContain('/api/obsidian-bridge/memory/candidates');
    expect(source).not.toContain('/api/obsidian-bridge/memory/commit');
    expect(source).not.toContain('FolderBrowserModal');
    expect(source).not.toContain('/api/obsidian-bridge/search');
    expect(source).not.toContain('/api/obsidian-bridge/context');
    expect(source).not.toContain('/api/obsidian-bridge/duplicates/scan');
    expect(source).not.toContain('/api/obsidian-bridge/duplicates/archive');
    expect(source).not.toContain('/api/obsidian-bridge/auto-capture/backfill');
    expect(source).not.toContain('/api/obsidian-bridge/auto-capture/status');
    expect(source).not.toContain('mcpEnabled');
    expect(source).not.toContain('activeNoteReadbackEnabled');
    expect(source).not.toContain('onOpenSmallModelSettings');
  });

  it('removes manual Wiki upload, small-model, and migration controls from the Obsidian settings page', () => {
    const source = readLocalSource('runtime-settings', 'ObsidianBridgeSettingsContent.tsx');
    const settingsSource = readLocalSource('..', 'Settings.tsx');

    expect(source).toContain('Connect Obsidian');
    expect(source).toContain('Obsidian Memory');
    expect(source).toContain('CodeGraph');
    expect(source).toContain('Argus/Wiki');
    expect(source).toContain('Argus/AIMemory');
    expect(source).not.toContain('<details');
    expect(source).not.toContain('knowledgeUploadInputRef');
    expect(source).not.toContain('uploadKnowledgeFiles');
    expect(source).not.toContain('/api/obsidian-bridge/wiki/upload');
    expect(source).not.toContain('summaryType');
    expect(source).not.toContain('WIKI_SUMMARY_TYPES');
    expect(source).not.toContain('technical-review');
    expect(source).not.toContain('compileQualityStatus');
    expect(source).not.toContain('wikiReadbackPreview');
    expect(source).not.toContain('reranked');
    expect(source).not.toContain('rerankModel');
    expect(source).not.toContain("formData.append('files'");
    expect(source).not.toContain('wikiCompiler');
    expect(source).not.toContain('wikiCompileChunks');
    expect(source).not.toContain('extractionEngine');
    expect(source).not.toContain('pdfExtractedPages');
    expect(source).not.toContain('installMcp');
    expect(source).not.toContain('scanDuplicates');
    expect(source).not.toContain('archiveDuplicates');
    expect(source).not.toContain('runBackfill');
    expect(source).not.toContain('loadMemoryCandidates');
    expect(settingsSource).toContain('agentInitialCategory');
    expect(settingsSource).toContain('small-model');
  });

  it('keeps Results focused on manual Wiki upload and implemented artifact actions', () => {
    const source = readLocalSource('..', '..', '..', 'artifacts', 'view', 'ArtifactsPanel.tsx');

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
    const hookSource = readLocalSource('..', '..', '..', 'chat', 'hooks', 'useChatComposerState.ts');
    const composerSource = readLocalSource('..', '..', '..', 'chat', 'view', 'subcomponents', 'ChatComposer.tsx');
    const interfaceSource = readLocalSource('..', '..', '..', 'chat', 'view', 'ChatInterface.tsx');

    expect(hookSource).toContain('ingestAttachmentsToObsidian');
    expect(hookSource).toContain("formData.append('obsidianIngest'");
    expect(composerSource).toContain('\u540c\u65f6\u843d\u5e93\u5230 Obsidian');
    expect(interfaceSource).toContain('ingestAttachmentsToObsidian');
  });
});
