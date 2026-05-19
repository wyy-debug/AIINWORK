import { lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

describe('codegraph service', () => {
  it('resolves the CodeGraph class from common ESM and CJS interop module shapes', async () => {
    const service = await import('../codegraph-service.js');
    const fakeCodeGraph = {
      open: vi.fn(),
      init: vi.fn(),
    };

    expect(service.resolveCodeGraphClass({ CodeGraph: fakeCodeGraph })).toBe(fakeCodeGraph);
    expect(service.resolveCodeGraphClass({ default: fakeCodeGraph })).toBe(fakeCodeGraph);
    expect(service.resolveCodeGraphClass({ default: { CodeGraph: fakeCodeGraph } })).toBe(fakeCodeGraph);
    expect(service.resolveCodeGraphClass({
      default: { CodeGraph: fakeCodeGraph },
      CodeGraph: fakeCodeGraph,
    })).toBe(fakeCodeGraph);
  });

  it('opens an existing CodeGraph index or initializes it on first use', async () => {
    const service = await import('../codegraph-service.js');
    const existingGraph = { getStats: vi.fn(), close: vi.fn() };
    const initializedGraph = { getStats: vi.fn(), close: vi.fn() };
    const CodeGraph = {
      isInitialized: vi.fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false),
      open: vi.fn(async () => existingGraph),
      init: vi.fn(async () => initializedGraph),
    };

    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'argus-codegraph-open-'));

    await expect(service.openOrInitCodeGraphProject(CodeGraph, projectRoot)).resolves.toBe(existingGraph);
    await expect(service.openOrInitCodeGraphProject(CodeGraph, projectRoot, { indexOnInit: false })).resolves.toBe(initializedGraph);

    expect(CodeGraph.open).toHaveBeenCalledWith(projectRoot, { sync: false });
    expect(CodeGraph.init).toHaveBeenCalledWith(projectRoot, { index: false, config: {} });
  });

  it('builds MCP config from the bundled CodeGraph CLI instead of requiring a global command', async () => {
    const service = await import('../codegraph-service.js');

    expect(service.buildCodeGraphMcpServerConfig({
      nodeCommand: 'C:/node/node.exe',
      cliPath: 'E:/app/node_modules/@colbymchenry/codegraph/dist/bin/codegraph.js',
    })).toEqual({
      type: 'stdio',
      command: 'C:/node/node.exe',
      args: [
        'E:/app/node_modules/@colbymchenry/codegraph/dist/bin/codegraph.js',
        'serve',
        '--mcp',
      ],
    });
  });

  it('reports whether the project MCP config points at the bundled CodeGraph CLI', async () => {
    const service = await import('../codegraph-service.js');
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'argus-codegraph-mcp-'));
    const configPath = path.join(projectRoot, '.mcp.json');
    await writeFile(configPath, JSON.stringify({
      mcpServers: {
        codegraph: {
          type: 'stdio',
          command: 'C:/node/node.exe',
          args: [
            'E:/app/node_modules/@colbymchenry/codegraph/dist/bin/codegraph.js',
            'serve',
            '--mcp',
          ],
        },
      },
    }), 'utf8');

    await expect(service.readCodeGraphMcpConfigStatus(projectRoot)).resolves.toMatchObject({
      mcpConfigured: true,
      mcpConfigPath: configPath,
      mcpUsesBundledCli: true,
    });
  });

  it('keeps physical CodeGraph files in the configured Argus storage root', async () => {
    const service = await import('../codegraph-service.js');
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'argus-codegraph-storage-'));
    const projectRoot = path.join(tempRoot, 'Project App');
    const storageRoot = path.join(tempRoot, 'central-codegraph');
    await mkdir(path.join(projectRoot, '.codegraph'), { recursive: true });
    await writeFile(path.join(projectRoot, '.codegraph', 'codegraph.db'), 'db', 'utf8');
    await writeFile(path.join(projectRoot, '.codegraph', 'config.json'), '{}', 'utf8');

    const result = await service.ensureCodeGraphProjectStorage(projectRoot, {
      config: { codegraphStorageRoot: storageRoot },
    });

    expect(result.storageRoot).toBe(path.resolve(storageRoot));
    expect(result.storagePath.startsWith(path.resolve(storageRoot))).toBe(true);
    expect(result.migrated).toBe(true);
    expect(await readFile(path.join(result.storagePath, 'codegraph.db'), 'utf8')).toBe('db');
    const linkStat = await lstat(path.join(projectRoot, '.codegraph'));
    expect(linkStat.isSymbolicLink()).toBe(true);
  });

  it('can prepare centralized storage without migrating an existing local index on chat start', async () => {
    const service = await import('../codegraph-service.js');
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'argus-codegraph-chat-storage-'));
    const projectRoot = path.join(tempRoot, 'Project App');
    const storageRoot = path.join(tempRoot, 'central-codegraph');
    await mkdir(path.join(projectRoot, '.codegraph'), { recursive: true });
    await writeFile(path.join(projectRoot, '.codegraph', 'codegraph.db'), 'db', 'utf8');

    const result = await service.ensureCodeGraphProjectStorage(projectRoot, {
      config: { codegraphStorageRoot: storageRoot },
      migrateExisting: false,
    });

    expect(result.linked).toBe(false);
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe('project-local-codegraph-present');
    expect(await readFile(path.join(projectRoot, '.codegraph', 'codegraph.db'), 'utf8')).toBe('db');
  });

  it('runs a one-time Argus full index marker before relying on incremental sync', async () => {
    const service = await import('../codegraph-service.js');
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'argus-codegraph-full-index-'));
    const runFullIndex = vi.fn(async () => ({ success: true, filesIndexed: 42 }));

    await expect(service.ensureArgusFullCodeGraphIndex(null, { projectRoot, runFullIndex })).resolves.toMatchObject({
      indexed: true,
      result: { filesIndexed: 42 },
    });
    await expect(service.ensureArgusFullCodeGraphIndex(null, { projectRoot, runFullIndex })).resolves.toMatchObject({
      skipped: true,
      reason: 'argus-full-index-present',
    });
    expect(runFullIndex).toHaveBeenCalledTimes(1);
  });

  it('records failed full indexes and cools down automatic retries', async () => {
    const service = await import('../codegraph-service.js');
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'argus-codegraph-full-index-fail-'));
    const runFullIndex = vi.fn(async () => {
      throw new Error('Fatal process out of memory: Zone');
    });

    await expect(service.ensureArgusFullCodeGraphIndex(null, { projectRoot, runFullIndex })).resolves.toMatchObject({
      skipped: true,
      reason: 'argus-full-index-failed',
      error: 'Fatal process out of memory: Zone',
    });
    await expect(service.ensureArgusFullCodeGraphIndex(null, { projectRoot, runFullIndex })).resolves.toMatchObject({
      skipped: true,
      reason: 'argus-full-index-recent-failure',
    });
    expect(runFullIndex).toHaveBeenCalledTimes(1);
  });

  it('builds native CodeGraph Obsidian notes with unique paths and real graph relationships', async () => {
    const service = await import('../codegraph-service.js');

    const documents = service.buildCodeGraphNativeDocuments({
      projectName: 'App',
      projectRoot: 'E:/work/app',
      packageVersion: '0.7.6',
      indexedAt: '2026-05-16T10:00:00.000Z',
      files: [{
        path: 'src/auth/index.ts',
        contentHash: 'file-hash',
        language: 'typescript',
        size: 128,
      }],
      nodes: [{
        id: 'class:LoginManager',
        kind: 'class',
        name: 'LoginManager',
        qualifiedName: 'auth.LoginManager',
        filePath: 'src/auth/index.ts',
        startLine: 1,
        endLine: 80,
        visibility: 'public',
      }, {
        id: 'method:on-enable-a',
        kind: 'method',
        name: 'OnEnable',
        qualifiedName: 'auth.LoginManager.OnEnable',
        filePath: 'src/auth/index.ts',
        startLine: 12,
        endLine: 20,
        visibility: 'public',
      }, {
        id: 'method:on-enable-b',
        kind: 'method',
        name: 'OnEnable',
        qualifiedName: 'auth.LoginManager.OnEnableClone',
        filePath: 'src/auth/index.ts',
        startLine: 30,
        endLine: 40,
        visibility: 'public',
      }, {
        id: 'variable:local-temp',
        kind: 'variable',
        name: '<init> temp?',
        qualifiedName: 'auth.LoginManager.OnEnable.<init> temp?',
        filePath: 'src/auth/index.ts',
        startLine: 14,
        endLine: 14,
        visibility: 'private',
      }, {
        id: 'field:private-config',
        kind: 'field',
        name: 'Config..',
        qualifiedName: 'auth.LoginManager.Config..',
        filePath: 'src/auth/index.ts',
        startLine: 5,
        endLine: 5,
        visibility: 'private',
      }, {
        id: 'field:public-state',
        kind: 'field',
        name: 'State',
        qualifiedName: 'auth.LoginManager.State',
        filePath: 'src/auth/index.ts',
        startLine: 6,
        endLine: 6,
        visibility: 'public',
      }],
      edges: [{
        source: 'class:LoginManager',
        target: 'method:on-enable-a',
        kind: 'contains',
      }, {
        source: 'class:LoginManager',
        target: 'method:on-enable-b',
        kind: 'contains',
      }, {
        source: 'class:LoginManager',
        target: 'field:private-config',
        kind: 'contains',
      }, {
        source: 'class:LoginManager',
        target: 'field:public-state',
        kind: 'contains',
      }, {
        source: 'method:on-enable-a',
        target: 'variable:local-temp',
        kind: 'contains',
      }, {
        source: 'method:on-enable-a',
        target: 'method:on-enable-b',
        kind: 'calls',
        line: 16,
        provenance: 'tree-sitter',
      }],
    });

    const paths = documents.map((document) => document.path);
    expect(paths).toContain('Argus/Wiki/App/CodeGraph/Index.md');
    expect(paths.some((entry) => /^Argus\/Wiki\/App\/CodeGraph\/Files\/auth-index-[a-f0-9]{10}\.md$/.test(entry))).toBe(true);
    expect(paths.filter((entry) => /\/Symbols\/method\/OnEnable-[a-f0-9]{12}\.md$/.test(entry))).toHaveLength(2);
    expect(paths.some((entry) => /\/Symbols\/field\/State-[a-f0-9]{12}\.md$/.test(entry))).toBe(true);
    expect(paths.some((entry) => entry.includes('Config'))).toBe(false);
    expect(paths.some((entry) => entry.includes('_init_'))).toBe(false);

    const firstOnEnable = documents.find((document) => (
      document.path.includes('/Symbols/method/OnEnable-')
      && document.content.includes('method:on-enable-a')
    ));
    const classNote = documents.find((document) => document.path.includes('/Symbols/class/LoginManager-'));
    const fileNote = documents.find((document) => document.path.includes('/Files/auth-index-'));

    expect(firstOnEnable?.content).toContain('## Native Node');
    expect(firstOnEnable?.content).toContain('## Call Relationships');
    expect(firstOnEnable?.content).toContain('## Outgoing Edges');
    expect(firstOnEnable?.content).toContain('### calls');
    expect(firstOnEnable?.content).toContain('line 16');
    expect(firstOnEnable?.content).toContain('tree-sitter');
    expect(firstOnEnable?.content).toContain('[[CodeGraph/Symbols/method/OnEnable-');
    expect(firstOnEnable?.content).toContain('## Local Symbols');
    expect(firstOnEnable?.content).toContain('<init> temp?');
    expect(firstOnEnable?.content).toContain('<details>');
    expect(firstOnEnable?.content).toContain('```json');
    expect(classNote?.content).toContain('## Members');
    expect(classNote?.content).toContain('Config..');
    expect(fileNote?.content).toContain('## Native File');
    expect(fileNote?.content).toContain('## Structural Symbols');
    expect(fileNote?.content).toContain('## Embedded Local Symbols');
  });

  it('sanitizes native note path segments for Windows and truncates only the readable name', async () => {
    const service = await import('../codegraph-service.js');

    expect(service.sanitizeNotePathSegment('<init>', 40, 'node')).toBe('_init_');
    expect(service.sanitizeNotePathSegment('List<String>', 40, 'node')).toBe('List_String_');
    expect(service.sanitizeNotePathSegment('IAuth.Login?', 40, 'node')).toBe('IAuth.Login_');
    expect(service.sanitizeNotePathSegment('MyClass .', 40, 'node')).toBe('MyClass');
    expect(service.sanitizeNotePathSegment('Config..', 40, 'node')).toBe('Config');

    const veryLongName = 'VeryLongGenericSymbolNameWithLotsOfTemplateArgumentsAndSuffix';
    const notePath = service.nodeNotePath('App', {
      id: 'method:case-sensitive-A',
      kind: 'method',
      name: veryLongName,
    });

    expect(notePath).toMatch(/^Argus\/Wiki\/App\/CodeGraph\/Symbols\/method\/VeryLongGenericSymbolNameWithLotsOfTempl-[a-f0-9]{12}\.md$/);
    expect(service.nodeNotePath('App', { id: 'symbol:LoginManager', kind: 'class', name: 'LoginManager' }))
      .not.toBe(service.nodeNotePath('App', { id: 'symbol:loginManager', kind: 'class', name: 'loginManager' }));
  });

  it('limits embedded native symbols and points AI back to CodeGraph MCP for deep internals', async () => {
    const service = await import('../codegraph-service.js');
    const locals = Array.from({ length: 5 }, (_, index) => ({
      id: `variable:local-${index}`,
      kind: 'variable',
      name: `local${index}`,
      filePath: 'src/auth/service.ts',
      startLine: 20 + index,
      endLine: 20 + index,
    }));
    const documents = service.buildCodeGraphNativeDocuments({
      projectName: 'App',
      indexedAt: '2026-05-16T10:00:00.000Z',
      maxEmbeddedSymbols: 2,
      files: [{ path: 'src/auth/service.ts', contentHash: 'file-hash' }],
      nodes: [{
        id: 'method:hydrate',
        kind: 'method',
        name: 'hydrate',
        filePath: 'src/auth/service.ts',
        startLine: 10,
        endLine: 40,
        visibility: 'public',
      }, ...locals],
      edges: locals.map((node) => ({
        source: 'method:hydrate',
        target: node.id,
        kind: 'contains',
      })),
    });
    const methodNote = documents.find((document) => document.path.includes('/Symbols/method/hydrate-'));

    expect(methodNote?.content).toContain('local0');
    expect(methodNote?.content).toContain('local1');
    expect(methodNote?.content).not.toContain('local2');
    expect(methodNote?.content).toContain('...and 3 more internal symbols omitted. Use CodeGraph MCP search for detailed internal scopes.');
  });

  it('writes all structural Symbol and File notes while keeping full-project coverage', async () => {
    const service = await import('../codegraph-service.js');
    const files = Array.from({ length: 12 }, (_, index) => ({
      path: `src/feature-${index}/index.ts`,
      contentHash: `file-${index}`,
    }));
    const nodes = files.map((file, index) => ({
      id: `class:Feature${index}`,
      kind: 'class',
      name: `Feature${index}`,
      filePath: file.path,
      startLine: 1,
      endLine: 10,
      visibility: 'public',
    }));

    const documents = service.buildCodeGraphNativeDocuments({
      projectName: 'HugeApp',
      files,
      nodes,
      edges: [],
      maxSymbolNotes: 3,
      maxFileNotes: 4,
    });

    expect(documents.filter((document) => document.path.includes('/CodeGraph/Symbols/'))).toHaveLength(12);
    expect(documents.filter((document) => document.path.includes('/CodeGraph/Files/'))).toHaveLength(12);
    expect(documents.filter((document) => document.path.includes('/CodeGraph/Coverage/'))).toHaveLength(1);
    expect(documents).toHaveLength(26);
    expect(documents.find((document) => document.path.endsWith('/CodeGraph/Index.md'))?.content).toContain('- Native symbol notes: 12');
    expect(documents.find((document) => document.path.endsWith('/CodeGraph/Index.md'))?.content).toContain('- Native files: 12');
    expect(documents.find((document) => document.path.endsWith('/CodeGraph/Index.md'))?.content).toContain('- Raw files indexed: 12');
    expect(documents.find((document) => document.path.includes('/CodeGraph/Coverage/'))?.content).toContain('src/feature-11/index.ts');
    expect(documents.filter((document) => document.path.includes('/CodeGraph/Symbols/')).map((document) => document.path).join('\n')).toContain('Feature11');
  });

  it('does not pass Symbol/File note caps into the native collector before building Obsidian notes', async () => {
    const service = await import('../codegraph-service.js');
    const collectSummary = vi.fn(async () => ({
      packageVersion: '0.7.6',
      stats: { nodes: 1000000 },
      files: [],
      nodes: [],
      edges: [],
    }));

    await service.exportCodeGraphSummariesToObsidian({
      projectName: 'HugeApp',
      projectRoot: 'E:/work/huge',
      maxSymbolNotes: 7,
      exportLevel: 'structural',
      collectSummary,
      upsertMarkdown: vi.fn(async () => ({})),
      queryNotes: vi.fn(async () => ({ results: [] })),
    });

    expect(collectSummary).toHaveBeenCalledWith({
      projectRoot: 'E:/work/huge',
      exportLevel: 'structural',
      scopePaths: [],
      onProgress: null,
    });
  });

  it('skips unchanged native CodeGraph notes by documentHash before upserting', async () => {
    const service = await import('../codegraph-service.js');
    const summary = {
      packageVersion: '0.7.6',
      stats: { nodes: 1 },
      files: [{ path: 'src/auth/index.ts', contentHash: 'file-hash' }],
      nodes: [{
        id: 'class:AuthManager',
        kind: 'class',
        name: 'AuthManager',
        filePath: 'src/auth/index.ts',
        startLine: 1,
        endLine: 20,
        visibility: 'public',
      }],
      edges: [],
    };
    const existingDocuments = service.buildCodeGraphNativeDocuments({
      projectName: 'App',
      projectRoot: 'E:/work/app',
      packageVersion: summary.packageVersion,
      indexedAt: '2026-05-16T10:00:00.000Z',
      files: summary.files,
      nodes: summary.nodes,
      edges: summary.edges,
    });
    const upsertMarkdown = vi.fn(async () => ({}));
    const result = await service.exportCodeGraphSummariesToObsidian({
      projectName: 'App',
      projectRoot: 'E:/work/app',
      collectSummary: vi.fn(async () => summary),
      upsertMarkdown,
      queryNotes: vi.fn(async () => ({
        results: existingDocuments.map((document) => ({
          path: document.path,
          content: document.content,
        })),
      })),
    });

    expect(upsertMarkdown).not.toHaveBeenCalled();
    expect(result.documents).toBe(existingDocuments.length);
    expect(result.written).toBe(0);
    expect(result.skippedUnchanged).toBe(existingDocuments.length);
  });

  it('logs native CodeGraph export progress so stuck Obsidian writes are diagnosable', async () => {
    const service = await import('../codegraph-service.js');
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };
    const summary = {
      packageVersion: '0.7.6',
      stats: { nodes: 1 },
      files: [{ path: 'src/auth/index.ts', contentHash: 'file-hash' }],
      nodes: [{
        id: 'class:AuthManager',
        kind: 'class',
        name: 'AuthManager',
        filePath: 'src/auth/index.ts',
        startLine: 1,
        endLine: 20,
        visibility: 'public',
      }],
      edges: [],
    };

    await service.exportCodeGraphSummariesToObsidian({
      projectName: 'App',
      projectRoot: 'E:/work/app',
      collectSummary: vi.fn(async () => summary),
      upsertMarkdown: vi.fn(async () => ({})),
      queryNotes: vi.fn(async () => ({ results: [] })),
      logger,
    });

    const logs = logger.log.mock.calls.map(([message]) => String(message)).join('\n');
    expect(logs).toContain('[CodeGraph Obsidian] export_start');
    expect(logs).toContain('[CodeGraph Obsidian] summary_collected');
    expect(logs).toContain('[CodeGraph Obsidian] documents_built');
    expect(logs).toContain('[CodeGraph Obsidian] upsert_progress');
    expect(logs).toContain('[CodeGraph Obsidian] export_complete');
    expect(logs).toContain('E:/work/app');
  });

  it('logs CodeGraph API and queue lifecycle events in debug builds', async () => {
    const service = await import('../codegraph-service.js');
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };
    service.logCodeGraphDebugEvent(logger, 'api_status_request', {
      projectName: 'App',
      projectRoot: 'E:/work/app',
    });
    const initialize = vi.fn(async () => ({ initialized: true }));
    const sync = vi.fn(async () => ({ filesAdded: 1 }));
    const exportObsidian = vi.fn(async () => ({ documents: 2 }));
    const codegraph = service.createCodeGraphService({
      initialize,
      sync,
      exportObsidian,
      retryDelayMs: 1,
      maxRetries: 0,
      logger,
    });

    codegraph.enqueueObsidianBuild({
      projectName: 'App',
      projectRoot: 'E:/work/app',
    });
    await codegraph.waitForIdle('E:/work/app');

    const logs = logger.log.mock.calls.map(([message]) => String(message)).join('\n');
    expect(logs).toContain('[CodeGraph Obsidian] api_status_request');
    expect(logs).toContain('[CodeGraph Obsidian] queue_enqueued');
    expect(logs).toContain('[CodeGraph Obsidian] job_start');
    expect(logs).toContain('[CodeGraph Obsidian] init_complete');
    expect(logs).toContain('[CodeGraph Obsidian] sync_complete');
    expect(logs).toContain('[CodeGraph Obsidian] job_complete');
  });

  it('skips Obsidian export when the bridge is not globally connected', async () => {
    const service = await import('../codegraph-service.js');

    expect(service.getCodeGraphObsidianExportSkipReason({
      enabled: false,
      codegraphWriteObsidianSummaries: true,
    })).toBe('Obsidian bridge disabled');
    expect(service.getCodeGraphObsidianExportSkipReason({
      enabled: true,
      token: '',
      codegraphWriteObsidianSummaries: true,
    })).toBe('Obsidian bridge token not configured');
    expect(service.getCodeGraphObsidianExportSkipReason({
      enabled: true,
      token: 'bridge-token',
      codegraphWriteObsidianSummaries: false,
    })).toBe('codegraphWriteObsidianSummaries disabled');
    expect(service.getCodeGraphObsidianExportSkipReason({
      enabled: true,
      token: 'bridge-token',
      codegraphWriteObsidianSummaries: true,
    })).toBe('');
  });

  it('marks inactive auto-generated notes as deprecated without touching manual notes', async () => {
    const service = await import('../codegraph-service.js');

    const result = service.planGhostNoteUpdates({
      activePaths: ['Argus/Wiki/App/CodeGraph/Symbols/AuthManager.md'],
      existingNotes: [{
        path: 'Argus/Wiki/App/CodeGraph/Symbols/LoginService.md',
        content: [
          '---',
          'tags:',
          '  - argus/auto-gen',
          'status: active',
          '---',
          '',
          '# LoginService',
        ].join('\n'),
      }, {
        path: 'Argus/Wiki/App/CodeGraph/Symbols/HandEdited.md',
        content: [
          '---',
          'tags:',
          '  - argus/auto-gen',
          'manual: true',
          'status: active',
          '---',
          '',
          '# HandEdited',
        ].join('\n'),
      }],
      deprecatedAt: '2026-05-16T10:05:00.000Z',
    });

    expect(result.deprecations).toHaveLength(1);
    expect(result.deprecations[0]).toMatchObject({
      path: 'Argus/Wiki/App/CodeGraph/Symbols/LoginService.md',
      status: 'deprecated',
    });
    expect(result.deprecations[0].content).toContain('status: deprecated');
    expect(result.deprecations[0].content).toContain('deprecatedAt: 2026-05-16T10:05:00.000Z');
    expect(result.deprecations[0].content).toContain('This auto-generated CodeGraph note is no longer active.');
    expect(result.staleCandidates).toEqual(['Argus/Wiki/App/CodeGraph/Symbols/HandEdited.md']);
  });

  it('deduplicates concurrent lazy LLM summaries for the same entity hash', async () => {
    const service = await import('../codegraph-service.js');
    let resolveSummary;
    const generateSummary = vi.fn(() => new Promise((resolve) => {
      resolveSummary = resolve;
    }));
    const writer = vi.fn(async () => ({ path: 'Argus/Wiki/App/CodeGraph/Modules/auth.md' }));
    const codegraph = service.createCodeGraphService({
      generateSummary,
      writeSemanticSummary: writer,
    });

    const payload = {
      projectRoot: 'E:/work/app',
      entityKind: 'module',
      entityId: 'auth',
      contentHash: 'hash-1',
      notePath: 'Argus/Wiki/App/CodeGraph/Modules/auth.md',
      sourceText: 'Auth module template summary',
    };

    const first = codegraph.requestLazyLlmSummary(payload);
    const second = codegraph.requestLazyLlmSummary(payload);

    expect(generateSummary).toHaveBeenCalledTimes(1);
    resolveSummary({ summary: 'Handles auth sessions.', model: 'small-model' });

    await expect(first).resolves.toMatchObject({ summary: 'Handles auth sessions.' });
    await expect(second).resolves.toMatchObject({ summary: 'Handles auth sessions.' });
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it('runs manual CodeGraph build outside the chat path and serializes work per project with retry', async () => {
    const service = await import('../codegraph-service.js');
    const attempts = [];
    const initialize = vi.fn(async () => ({ initialized: true, mcp: { serverName: 'codegraph' } }));
    const sync = vi.fn(async ({ projectRoot }) => {
      attempts.push(projectRoot);
      if (attempts.length === 1) {
        const error = new Error('database is locked');
        error.code = 'SQLITE_BUSY';
        throw error;
      }
      return { filesAdded: 1, filesModified: 0, filesRemoved: 0 };
    });
    const exportObsidian = vi.fn(async () => ({ documents: 1 }));
    const codegraph = service.createCodeGraphService({
      initialize,
      sync,
      exportObsidian,
      retryDelayMs: 1,
      maxRetries: 1,
    });

    const queued = codegraph.enqueueObsidianBuild({
      projectName: 'App',
      projectRoot: 'E:/work/app',
      scopePaths: ['E:/work/app/src/Auth.cs'],
    });

    expect(queued).toMatchObject({ queued: true, projectRoot: 'E:/work/app' });
    expect(codegraph.getStatus('E:/work/app')).toMatchObject({
      state: 'queued',
      progress: {
        stage: 'queued',
        percent: 5,
      },
    });
    await codegraph.waitForIdle('E:/work/app');

    const selectedScopePath = path.resolve('E:/work/app/src/Auth.cs');
    expect(initialize).toHaveBeenCalledWith({
      projectName: 'App',
      projectRoot: 'E:/work/app',
      scopePaths: [selectedScopePath],
      installMcp: true,
      ensureFullIndex: true,
      index: false,
    });
    expect(sync).toHaveBeenLastCalledWith({
      projectName: 'App',
      projectRoot: 'E:/work/app',
      scopePaths: [selectedScopePath],
    });
    expect(sync).toHaveBeenCalledTimes(2);
    expect(exportObsidian).toHaveBeenCalledWith(expect.objectContaining({
      projectName: 'App',
      projectRoot: 'E:/work/app',
      scopePaths: [selectedScopePath],
    }));
    expect(exportObsidian).toHaveBeenCalledTimes(1);
    expect(codegraph.getStatus('E:/work/app')).toMatchObject({
      state: 'success',
      progress: {
        stage: 'complete',
        percent: 100,
      },
      lastSync: {
        filesAdded: 1,
      },
    });
  });

  it('surfaces native Obsidian export progress in project status while the build is running', async () => {
    const service = await import('../codegraph-service.js');
    let releaseExport;
    let exportProgressReported;
    const exportProgress = new Promise((resolve) => {
      exportProgressReported = resolve;
    });
    const codegraph = service.createCodeGraphService({
      initialize: vi.fn(async () => ({ initialized: true })),
      sync: vi.fn(async () => ({ filesAdded: 1 })),
      exportObsidian: vi.fn(async ({ onProgress }) => {
        onProgress({
          stage: 'export',
          percent: 82,
          label: 'Writing CodeGraph note 10/20',
        });
        exportProgressReported();
        await new Promise((resolve) => {
          releaseExport = resolve;
        });
        return { documents: 20, written: 10 };
      }),
      retryDelayMs: 1,
      maxRetries: 0,
    });

    codegraph.enqueueObsidianBuild({
      projectName: 'App',
      projectRoot: 'E:/work/app',
    });
    const idle = codegraph.waitForIdle('E:/work/app');
    await exportProgress;

    expect(codegraph.getStatus('E:/work/app')).toMatchObject({
      state: 'syncing',
      progress: {
        stage: 'export',
        percent: 82,
        label: 'Writing CodeGraph note 10/20',
      },
    });

    releaseExport();
    await idle;
  });

  it('streams CodeGraph notes to Obsidian file-by-file instead of collecting the whole graph first', async () => {
    const service = await import('../codegraph-service.js');
    const events = [];
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'argus-codegraph-stream-cache-'));
    const upsertMarkdown = vi.fn(async ({ path: documentPath }) => {
      events.push(`write:${documentPath}`);
      return {};
    });
    const cg = {
      getFiles: vi.fn(() => [
        { path: 'Assets/Scripts/Auth/AFirst.cs', language: 'csharp' },
        { path: 'Assets/Scripts/Auth/ZSecond.cs', language: 'csharp' },
      ]),
      getNodesInFile: vi.fn((filePath) => {
        events.push(`nodes:${filePath}`);
        if (filePath === 'Assets/Scripts/Auth/ZSecond.cs') {
          expect(events.some((event) => event.startsWith('write:'))).toBe(true);
        }
        return [{
          id: `class:${filePath}`,
          kind: 'class',
          name: filePath.includes('AFirst') ? 'AFirst' : 'ZSecond',
          filePath,
          visibility: 'public',
          startLine: 1,
          endLine: 12,
        }];
      }),
      getIncomingEdges: vi.fn(() => []),
      getOutgoingEdges: vi.fn(() => []),
      getFileDependencies: vi.fn(() => []),
      getFileDependents: vi.fn(() => []),
      getStats: vi.fn(() => ({ fileCount: 2, nodeCount: 2 })),
      close: vi.fn(),
    };

    const result = await service.exportCodeGraphSummariesToObsidianStreaming({
      projectName: 'Soc',
      projectRoot: 'E:/work/Soc',
      codeGraphPackage: { CodeGraph: {}, mod: { version: '0.7.6' } },
      openGraph: vi.fn(async () => cg),
      exportCachePath: path.join(cacheDir, 'obsidian-export-cache.json'),
      upsertMarkdown,
      queryNotes: vi.fn(async () => ({ results: [] })),
      onProgress: vi.fn(),
    });

    expect(result.streaming).toBe(true);
    expect(cg.getNodesInFile).toHaveBeenCalledTimes(2);
    expect(upsertMarkdown).toHaveBeenCalled();
    expect(events.indexOf('nodes:Assets/Scripts/Auth/AFirst.cs')).toBeLessThan(
      events.findIndex((event) => event.startsWith('write:')),
    );
    expect(events.findIndex((event) => event.startsWith('write:'))).toBeLessThan(
      events.indexOf('nodes:Assets/Scripts/Auth/ZSecond.cs'),
    );
  });

  it('fails streaming export instead of hanging forever when an Obsidian note write stalls', async () => {
    const service = await import('../codegraph-service.js');
    const cg = {
      getFiles: vi.fn(() => [{ path: 'Assets/Scripts/Auth/AuthManager.cs', language: 'csharp' }]),
      getNodesInFile: vi.fn(() => [{
        id: 'class:AuthManager',
        kind: 'class',
        name: 'AuthManager',
        filePath: 'Assets/Scripts/Auth/AuthManager.cs',
        visibility: 'public',
        startLine: 1,
        endLine: 12,
      }]),
      getIncomingEdges: vi.fn(() => []),
      getOutgoingEdges: vi.fn(() => []),
      getFileDependencies: vi.fn(() => []),
      getFileDependents: vi.fn(() => []),
      getStats: vi.fn(() => ({ fileCount: 1, nodeCount: 1 })),
      close: vi.fn(),
    };
    const stalledUpsert = vi.fn(() => new Promise(() => {}));

    await expect(service.exportCodeGraphSummariesToObsidianStreaming({
      projectName: 'Soc',
      projectRoot: 'E:/work/Soc',
      codeGraphPackage: { CodeGraph: {}, mod: { version: '0.7.6' } },
      openGraph: vi.fn(async () => cg),
      upsertMarkdown: stalledUpsert,
      queryNotes: vi.fn(async () => ({ results: [] })),
      noteWriteTimeoutMs: 5,
    })).rejects.toMatchObject({
      code: 'CODEGRAPH_OPERATION_TIMEOUT',
    });

    expect(stalledUpsert).toHaveBeenCalled();
    expect(cg.close).toHaveBeenCalled();
  });

  it('yields between note writes for a large single-file streaming export', async () => {
    const service = await import('../codegraph-service.js');
    const events = [];
    const yieldToEventLoop = vi.fn(async () => {
      events.push('yield');
    });
    const cg = {
      getFiles: vi.fn(() => [{ path: 'Assets/Scripts/GodFile.cs', language: 'csharp' }]),
      getNodesInFile: vi.fn(() => Array.from({ length: 5 }, (_, index) => ({
        id: `class:GodFile:${index}`,
        kind: 'class',
        name: `GodFilePart${index}`,
        filePath: 'Assets/Scripts/GodFile.cs',
        visibility: 'public',
        startLine: index + 1,
        endLine: index + 10,
      }))),
      getIncomingEdges: vi.fn(() => []),
      getOutgoingEdges: vi.fn(() => []),
      getFileDependencies: vi.fn(() => []),
      getFileDependents: vi.fn(() => []),
      getStats: vi.fn(() => ({ fileCount: 1, nodeCount: 5 })),
      close: vi.fn(),
    };
    const upsertMarkdown = vi.fn(async ({ path: documentPath }) => {
      events.push(`write:${documentPath}`);
      return {};
    });

    await service.exportCodeGraphSummariesToObsidianStreaming({
      projectName: 'Soc',
      projectRoot: 'E:/work/Soc',
      codeGraphPackage: { CodeGraph: {}, mod: { version: '0.7.6' } },
      openGraph: vi.fn(async () => cg),
      upsertMarkdown,
      queryNotes: vi.fn(async () => ({ results: [] })),
      yieldToEventLoop,
      documentYieldEvery: 1,
    });

    expect(upsertMarkdown).toHaveBeenCalled();
    expect(yieldToEventLoop).toHaveBeenCalled();
    expect(events.some((event, index) => (
      event.startsWith('write:')
      && events[index + 1] === 'yield'
    ))).toBe(true);
  });

  it('skips unchanged files from the streaming export cache before reading nodes again', async () => {
    const service = await import('../codegraph-service.js');
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'argus-codegraph-export-cache-'));
    const exportCachePath = path.join(cacheDir, 'obsidian-export-cache.json');
    const cg = {
      getFiles: vi.fn(() => [
        {
          path: 'Assets/Scripts/Auth/AuthManager.cs',
          language: 'csharp',
          contentHash: 'file-hash-1',
        },
      ]),
      getNodesInFile: vi.fn(() => [{
        id: 'class:AuthManager',
        kind: 'class',
        name: 'AuthManager',
        filePath: 'Assets/Scripts/Auth/AuthManager.cs',
        visibility: 'public',
        startLine: 1,
        endLine: 12,
      }]),
      getIncomingEdges: vi.fn(() => []),
      getOutgoingEdges: vi.fn(() => []),
      getFileDependencies: vi.fn(() => []),
      getFileDependents: vi.fn(() => []),
      getStats: vi.fn(() => ({ fileCount: 1, nodeCount: 1 })),
      close: vi.fn(),
    };
    const openGraph = vi.fn(async () => cg);

    await service.exportCodeGraphSummariesToObsidianStreaming({
      projectName: 'Soc',
      projectRoot: 'E:/work/Soc',
      codeGraphPackage: { CodeGraph: {}, mod: { version: '0.7.6' } },
      openGraph,
      exportCachePath,
      upsertMarkdown: vi.fn(async () => ({})),
      queryNotes: vi.fn(async () => ({ results: [] })),
    });
    const second = await service.exportCodeGraphSummariesToObsidianStreaming({
      projectName: 'Soc',
      projectRoot: 'E:/work/Soc',
      codeGraphPackage: { CodeGraph: {}, mod: { version: '0.7.6' } },
      openGraph,
      exportCachePath,
      upsertMarkdown: vi.fn(async () => ({})),
      queryNotes: vi.fn(async () => ({ results: [] })),
    });

    expect(cg.getNodesInFile).toHaveBeenCalledTimes(1);
    expect(second.diffSkippedFiles).toBe(1);
    expect(second.paths.some((entry) => (
      /^Argus\/Wiki\/Soc\/CodeGraph\/Symbols\/class\/AuthManager-[a-f0-9]{12}\.md$/.test(entry)
    ))).toBe(true);
  });

  it('cancels a running manual CodeGraph build without waiting for export to finish', async () => {
    const service = await import('../codegraph-service.js');
    let exportStarted;
    const exportStartedPromise = new Promise((resolve) => {
      exportStarted = resolve;
    });
    const codegraph = service.createCodeGraphService({
      initialize: vi.fn(async () => ({ initialized: true })),
      sync: vi.fn(async () => ({ filesAdded: 0 })),
      exportObsidian: vi.fn(async ({ cancelSignal }) => {
        exportStarted();
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (cancelSignal?.cancelled) {
            throw new service.CodeGraphCancelledError('CodeGraph build cancelled.');
          }
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        return { documents: 1 };
      }),
      retryDelayMs: 1,
      maxRetries: 0,
    });

    codegraph.enqueueObsidianBuild({
      projectName: 'App',
      projectRoot: 'E:/work/app',
    });
    await exportStartedPromise;
    const cancelResult = codegraph.cancel('E:/work/app');
    await codegraph.waitForIdle('E:/work/app');

    expect(cancelResult).toMatchObject({ cancelled: true });
    expect(codegraph.getStatus('E:/work/app')).toMatchObject({
      state: 'cancelled',
      progress: {
        stage: 'cancelled',
        percent: 100,
      },
    });
  });

  it('keeps progress in the collecting stage before Obsidian writes begin', async () => {
    const service = await import('../codegraph-service.js');
    const progressEvents = [];
    let releaseCollect;
    let collectStarted;
    const collectStartedPromise = new Promise((resolve) => {
      collectStarted = resolve;
    });
    const exportPromise = service.exportCodeGraphSummariesToObsidian({
      projectName: 'HugeApp',
      projectRoot: 'E:/work/huge',
      collectSummary: vi.fn(async () => {
        collectStarted();
        await new Promise((resolve) => {
          releaseCollect = resolve;
        });
        return {
          packageVersion: '0.7.6',
          stats: { files: 10000, nodes: 500000 },
          files: [],
          nodes: [],
          edges: [],
        };
      }),
      upsertMarkdown: vi.fn(async () => ({})),
      queryNotes: vi.fn(async () => ({ results: [] })),
      onProgress: (event) => progressEvents.push(event),
    });

    await collectStartedPromise;
    expect(progressEvents.at(-1)).toMatchObject({
      stage: 'collect',
      percent: 55,
      label: 'Reading CodeGraph index for Obsidian export',
    });
    expect(progressEvents.at(-1)?.label).not.toContain('Writing');

    releaseCollect();
    await exportPromise;
  });

  it('reports native collector progress between CodeGraph export start and summary collection', async () => {
    const service = await import('../codegraph-service.js');
    const progressEvents = [];
    const calls = [];
    const cg = {
      getNodesByKind: vi.fn((kind) => {
        calls.push(kind);
        return [{
          id: `${kind}:One`,
          kind,
          name: `${kind}One`,
          filePath: `src/${kind}.ts`,
          visibility: 'public',
        }];
      }),
      getIncomingEdges: vi.fn(() => []),
      getOutgoingEdges: vi.fn(() => []),
      getFiles: vi.fn(() => [{ path: 'src/class.ts' }]),
      getStats: vi.fn(() => ({ fileCount: 1, nodeCount: 2 })),
      close: vi.fn(),
    };

    await service.collectCodeGraphSummaryFromGraph({
      cg,
      packageVersion: '0.7.6',
      exportLevel: 'structural',
      onProgress: (event) => progressEvents.push(event),
    });

    expect(calls.length).toBeGreaterThan(1);
    expect(progressEvents.map((event) => event.stage)).toContain('collect');
    expect(progressEvents.some((event) => String(event.label).includes('Collecting CodeGraph'))).toBe(true);
    expect(progressEvents.some((event) => String(event.label).includes('Reading CodeGraph relationships'))).toBe(true);
    expect(progressEvents.at(-1)).toMatchObject({
      stage: 'collect',
      percent: 67,
    });
  });

  it('yields during large native collector scans so status polling is not blocked', async () => {
    const service = await import('../codegraph-service.js');
    const yieldToEventLoop = vi.fn(async () => {});
    const nodes = Array.from({ length: 5 }, (_, index) => ({
      id: `method:${index}`,
      kind: 'method',
      name: `method${index}`,
      filePath: 'src/app.ts',
      visibility: 'public',
    }));
    const cg = {
      getNodesByKind: vi.fn((kind) => (kind === 'method' ? nodes : [])),
      getIncomingEdges: vi.fn(() => []),
      getOutgoingEdges: vi.fn(() => []),
      getFiles: vi.fn(() => [{ path: 'src/app.ts' }]),
      getStats: vi.fn(() => ({ fileCount: 1, nodeCount: nodes.length })),
      close: vi.fn(),
    };

    await service.collectCodeGraphSummaryFromGraph({
      cg,
      exportLevel: 'structural',
      yieldToEventLoop,
      yieldEveryNodes: 2,
    });

    expect(yieldToEventLoop).toHaveBeenCalled();
  });

  it('collects only user-selected CodeGraph script scope when scope paths are provided', async () => {
    const service = await import('../codegraph-service.js');
    const cg = {
      getFiles: vi.fn(() => [
        { path: 'Assets/Scripts/Auth/LoginService.cs' },
        { path: 'Assets/Editor/Generated/NoisyTool.cs' },
      ]),
      getNodesInFile: vi.fn((filePath) => (
        filePath === 'Assets/Scripts/Auth/LoginService.cs'
          ? [{
            id: 'class:login',
            kind: 'class',
            name: 'LoginService',
            filePath,
            visibility: 'public',
          }]
          : [{
            id: 'class:noisy',
            kind: 'class',
            name: 'NoisyTool',
            filePath,
            visibility: 'public',
          }]
      )),
      getNodesByKind: vi.fn(() => {
        throw new Error('scope collection should not scan all nodes by kind');
      }),
      getIncomingEdges: vi.fn(() => []),
      getOutgoingEdges: vi.fn(() => []),
      getFileDependencies: vi.fn(() => []),
      getFileDependents: vi.fn(() => []),
      getStats: vi.fn(() => ({ fileCount: 2, nodeCount: 2 })),
    };

    const summary = await service.collectCodeGraphSummaryFromGraph({
      cg,
      projectRoot: 'E:/work/app',
      scopePaths: ['E:/work/app/Assets/Scripts'],
      exportLevel: 'structural',
    });

    expect(summary.files.map((file) => file.path)).toEqual(['Assets/Scripts/Auth/LoginService.cs']);
    expect(summary.nodes.map((node) => node.name)).toEqual(['LoginService']);
    expect(cg.getNodesByKind).not.toHaveBeenCalled();
  });

  it('keeps background sync failures in status instead of rejecting the queue', async () => {
    const service = await import('../codegraph-service.js');
    const sync = vi.fn(async () => {
      throw new Error('CodeGraph.open is not a function');
    });
    const exportObsidian = vi.fn(async () => ({ documents: 1 }));
    const codegraph = service.createCodeGraphService({
      sync,
      exportObsidian,
      retryDelayMs: 1,
      maxRetries: 0,
    });

    const queued = codegraph.enqueueBackgroundSync({
      projectName: 'App',
      projectRoot: 'E:/work/app',
    });

    expect(queued).toMatchObject({ queued: true, projectRoot: 'E:/work/app' });
    await expect(codegraph.waitForIdle('E:/work/app')).resolves.toMatchObject({
      state: 'error',
      lastError: 'CodeGraph.open is not a function',
    });
    expect(exportObsidian).not.toHaveBeenCalled();
  });

  it('adds CodeGraph guidance to chat without queuing heavy Obsidian export work', async () => {
    const service = await import('../codegraph-service.js');
    const enqueueBackgroundSync = vi.fn(() => ({ queued: true }));
    const ensureMcpConfig = vi.fn(async () => ({ configPath: 'E:/work/app/.mcp.json', serverName: 'codegraph' }));
    const result = await service.applyCodeGraphRuntimeToChatCommand({
      type: 'claude-command',
      command: 'Refactor auth.',
      options: {
        projectName: 'App',
        projectPath: 'E:/work/app',
        appendSystemPrompt: 'Existing prompt.',
      },
    }, {
      readConfig: () => ({
        codegraphEnabled: true,
        codegraphBackgroundSyncEnabled: true,
        codegraphImpactMaxDepth: 2,
        codegraphImpactLimit: 50,
      }),
      enqueueBackgroundSync,
      ensureMcpConfig,
    });

    expect(ensureMcpConfig).toHaveBeenCalledWith('E:/work/app');
    expect(enqueueBackgroundSync).not.toHaveBeenCalled();
    expect(result.command).toBe('Refactor auth.');
    expect(result.options.appendSystemPrompt).toContain('Existing prompt.');
    expect(result.options.appendSystemPrompt).toContain('CodeGraph Runtime');
    expect(result.options.appendSystemPrompt).toContain('Optimize for fast answers first, then precision.');
    expect(result.options.appendSystemPrompt).toContain('Do not trigger CodeGraph build, sync, export, or any full-index construction during chat.');
    expect(result.options.appendSystemPrompt).toContain('If CodeGraph is missing, stale, slow, or returns weak results, immediately fall back to raw file search.');
    expect(result.options.appendSystemPrompt).not.toContain('Use CodeGraph first for precise code structure');
    expect(result.options.appendSystemPrompt).not.toContain('When locating code symbols, files, dependencies, or impact radius, use CodeGraph first.');
    expect(result.options.appendSystemPrompt).toContain('Do not pass a full natural-language task sentence directly to codegraph_context.');
    expect(result.options.appendSystemPrompt).toContain('Extract exact identifiers, class names, method names, and file terms first.');
    expect(result.options.appendSystemPrompt).toContain('When using CodeGraph, query narrowly: use codegraph_search separately for exact terms before codegraph_context or codegraph_explore.');
    expect(result.options.appendSystemPrompt).toContain('Use Obsidian only for durable project memory, decisions, summaries, and human-readable CodeGraph notes.');
    expect(result.options.appendSystemPrompt).toContain('maxDepth <= 2');
    expect(result.options.appendSystemPrompt).not.toContain('start with codegraph_files or codegraph_search');
    expect(result.options.codegraphContext).toMatchObject({
      enabled: true,
      backgroundSyncQueued: false,
      mcpConfigured: true,
      projectName: 'App',
      projectRoot: 'E:/work/app',
    });
  });

  it('does not inject CodeGraph runtime guidance when the saved global switch is off', async () => {
    const service = await import('../codegraph-service.js');
    const bridgeService = await import('../obsidian-bridge-service.js');
    let stored = null;
    bridgeService.setObsidianBridgeConfigStoreForTests({
      get: vi.fn(() => stored),
      set: vi.fn((_key, nextValue) => {
        stored = nextValue;
      }),
    });
    bridgeService.saveObsidianBridgeConfig({
      codegraphEnabled: false,
    });
    const ensureMcpConfig = vi.fn(async () => ({ configPath: 'E:/work/app/.mcp.json' }));

    const input = {
      type: 'claude-command',
      command: 'Find renderer code.',
      options: {
        projectName: 'App',
        projectPath: 'E:/work/app',
        appendSystemPrompt: 'Existing prompt.',
      },
    };
    const result = await service.applyCodeGraphRuntimeToChatCommand(input, {
      ensureMcpConfig,
    });

    expect(result).toBe(input);
    expect(ensureMcpConfig).not.toHaveBeenCalled();
    expect(result.options.appendSystemPrompt).toBe('Existing prompt.');
    expect(result.options.codegraphContext).toBeUndefined();
  });

  it('does not block chat when automatic CodeGraph MCP config provisioning fails', async () => {
    const service = await import('../codegraph-service.js');
    const result = await service.applyCodeGraphRuntimeToChatCommand({
      type: 'claude-command',
      command: 'Find renderer code.',
      options: {
        projectName: 'App',
        projectPath: 'E:/work/app',
      },
    }, {
      readConfig: () => ({
        codegraphEnabled: true,
        codegraphBackgroundSyncEnabled: true,
      }),
      enqueueBackgroundSync: vi.fn(() => ({ queued: true })),
      ensureMcpConfig: vi.fn(async () => {
        throw new Error('permission denied');
      }),
    });

    expect(result.command).toBe('Find renderer code.');
    expect(result.options.codegraphContext).toMatchObject({
      enabled: true,
      mcpConfigured: false,
      mcpError: 'permission denied',
    });
  });
});
