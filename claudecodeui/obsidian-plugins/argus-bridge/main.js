const crypto = require('crypto');
const http = require('http');
const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');
const {
  appendToPeriodicContent,
  assertSafeVaultPath,
  buildKnowledgeGraph,
  buildContextFromSearchResults,
  buildDocumentPath,
  buildProjectIndex,
  buildWikiIndexPath,
  buildWikiPath,
  buildWikiRawPath,
  buildWikiSchemaPath,
  buildWikiUploadIndex,
  extractNoteMetadata,
  findPathByArgusId,
  formatDocument,
  formatWikiCompiledDocument,
  formatWikiSchemaDocument,
  formatWikiSourceDocument,
  normalizePayload,
  patchMarkdownContent,
  lintWikiFiles,
  planDuplicateArchives,
  queryReadableFiles,
  readProperty,
  resolveUniquePath,
  sanitizePathSegment,
} = require('./core.js');

const DEFAULT_SETTINGS = {
  port: 27177,
  token: '',
  baseFolder: 'Argus',
  readableFolders: ['Argus/Projects', 'Argus/AIMemory', 'Argus/SecondBrain'],
  templates: {
    'project-knowledge': '{{content}}',
    'second-brain': '{{content}}',
    'ai-memory': '{{content}}',
  },
  argusEndpoint: 'http://127.0.0.1:3001',
  dailyNoteFolder: 'Daily',
  dailyNoteDateFormat: 'YYYY-MM-DD',
  dailyNoteHeading: 'Argus',
  recentWrites: [],
  recentErrors: [],
  recentIngress: [],
};

const createToken = () => crypto.randomBytes(24).toString('hex');

const sendJson = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
};

const readRequestBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 10 * 1024 * 1024) {
      reject(new Error('Request body is too large.'));
      req.destroy();
    }
  });
  req.on('end', () => {
    if (!body) {
      resolve({});
      return;
    }
    try {
      resolve(JSON.parse(body));
    } catch {
      reject(new Error('Request body must be valid JSON.'));
    }
  });
  req.on('error', reject);
});

module.exports = class ArgusBridgePlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ArgusBridgeSettingTab(this.app, this));
    this.registerCommands();
    await this.startServer();
  }

  async onunload() {
    await this.stopServer();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    const parsedPort = Number.parseInt(String(this.settings.port || ''), 10);
    this.settings.port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_SETTINGS.port;
    let changed = false;
    if (!this.settings.token) {
      this.settings.token = createToken();
      changed = true;
    }
    const baseFolder = sanitizePathSegment(this.settings.baseFolder, DEFAULT_SETTINGS.baseFolder);
    if (baseFolder !== this.settings.baseFolder) {
      this.settings.baseFolder = baseFolder;
      changed = true;
    }
    if (!Array.isArray(this.settings.readableFolders) || this.settings.readableFolders.length === 0) {
      this.settings.readableFolders = DEFAULT_SETTINGS.readableFolders;
      changed = true;
    }
    this.settings.readableFolders = this.settings.readableFolders
      .map((folder) => this.normalizeVaultFolder(folder))
      .filter(Boolean);
    this.settings.templates = {
      ...DEFAULT_SETTINGS.templates,
      ...(this.settings.templates && typeof this.settings.templates === 'object' ? this.settings.templates : {}),
    };
    this.settings.argusEndpoint = this.normalizeLocalEndpoint(this.settings.argusEndpoint, DEFAULT_SETTINGS.argusEndpoint);
    this.settings.dailyNoteFolder = this.normalizeVaultFolder(this.settings.dailyNoteFolder || DEFAULT_SETTINGS.dailyNoteFolder)
      || DEFAULT_SETTINGS.dailyNoteFolder;
    this.settings.dailyNoteDateFormat = String(this.settings.dailyNoteDateFormat || DEFAULT_SETTINGS.dailyNoteDateFormat);
    this.settings.dailyNoteHeading = String(this.settings.dailyNoteHeading || DEFAULT_SETTINGS.dailyNoteHeading).trim()
      || DEFAULT_SETTINGS.dailyNoteHeading;
    this.settings.recentWrites = Array.isArray(this.settings.recentWrites) ? this.settings.recentWrites.slice(0, 20) : [];
    this.settings.recentErrors = Array.isArray(this.settings.recentErrors) ? this.settings.recentErrors.slice(0, 20) : [];
    this.settings.recentIngress = Array.isArray(this.settings.recentIngress) ? this.settings.recentIngress.slice(0, 20) : [];
    if (changed) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  registerCommands() {
    const commands = [
      {
        id: 'argus-bridge-start',
        name: 'Start bridge',
        callback: async () => {
          await this.startServer();
          new Notice('Argus Bridge started.');
        },
      },
      {
        id: 'argus-bridge-stop',
        name: 'Stop bridge',
        callback: async () => {
          await this.stopServer();
          new Notice('Argus Bridge stopped.');
        },
      },
      {
        id: 'argus-bridge-restart',
        name: 'Restart bridge',
        callback: async () => {
          await this.restartServer();
          new Notice('Argus Bridge restarted.');
        },
      },
      {
        id: 'argus-bridge-copy-token',
        name: 'Copy token',
        callback: async () => {
          await this.copyToken();
        },
      },
      {
        id: 'argus-bridge-send-current-note',
        name: 'Send current note to Argus',
        callback: async () => {
          await this.sendCurrentNoteToArgus('send-note');
        },
      },
      {
        id: 'argus-bridge-send-selected-text',
        name: 'Send selected text to Argus',
        callback: async () => {
          await this.sendCurrentNoteToArgus('send-selection');
        },
      },
      {
        id: 'argus-bridge-create-memory-from-selection',
        name: 'Create Argus memory from selection',
        callback: async () => {
          await this.sendCurrentNoteToArgus('create-memory');
        },
      },
      {
        id: 'argus-bridge-ask-about-note',
        name: 'Ask Argus about this note',
        callback: async () => {
          await this.sendCurrentNoteToArgus('ask-note');
        },
      },
      {
        id: 'argus-bridge-append-selection-to-daily',
        name: 'Append selection to Daily note',
        callback: async () => {
          await this.appendSelectionToDailyNote();
        },
      },
      {
        id: 'argus-bridge-archive-duplicates',
        name: 'Archive duplicate Argus notes',
        callback: async () => {
          const result = await this.archiveDuplicateNotes();
          new Notice(`Archived ${result.archived.length} duplicate Argus note(s).`);
        },
      },
    ];
    for (const command of commands) {
      this.addCommand(command);
    }
  }

  async regenerateToken() {
    this.settings.token = createToken();
    await this.saveSettings();
    new Notice('Argus Bridge token regenerated.');
  }

  async copyToken() {
    await navigator.clipboard.writeText(this.settings.token);
    new Notice('Argus Bridge token copied.');
  }

  async recordRecentError(error) {
    this.settings.recentErrors = [
      {
        message: error?.message || 'Argus Bridge error.',
        at: new Date().toISOString(),
      },
      ...(Array.isArray(this.settings.recentErrors) ? this.settings.recentErrors : []),
    ].slice(0, 20);
    await this.saveSettings();
  }

  async restartServer() {
    await this.stopServer();
    await this.startServer();
  }

  async startServer() {
    await this.stopServer();
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.settings.port, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    console.log(`[Argus Bridge] Listening on 127.0.0.1:${this.settings.port}`);
  }

  async stopServer() {
    if (!this.server) {
      return;
    }
    const currentServer = this.server;
    this.server = null;
    await new Promise((resolve) => currentServer.close(() => resolve()));
  }

  isAuthorized(req) {
    const expected = `Bearer ${this.settings.token}`;
    return Boolean(this.settings.token) && req.headers.authorization === expected;
  }

  async handleRequest(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (!this.isAuthorized(req)) {
        sendJson(res, 401, { success: false, error: 'Unauthorized.' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/argus/v1/status') {
        sendJson(res, 200, {
          success: true,
          plugin: 'argus-bridge',
          pluginVersion: this.manifest?.version || 'unknown',
          vaultName: this.app.vault.getName(),
          baseFolder: this.settings.baseFolder,
          readableFolders: this.settings.readableFolders,
          writableFolders: [this.settings.baseFolder, this.settings.dailyNoteFolder],
          capabilities: [
            'documents',
            'active',
            'patch',
            'query',
            'periodic',
            'graph',
            'duplicates',
            'ingress',
            'wiki',
          ],
          dailyNote: {
            folder: this.settings.dailyNoteFolder,
            dateFormat: this.settings.dailyNoteDateFormat,
            heading: this.settings.dailyNoteHeading,
          },
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/argus/v1/active') {
        const note = await this.getActiveNote({
          includeContent: url.searchParams.get('includeContent') !== 'false',
          includeSelection: url.searchParams.get('includeSelection') !== 'false',
        });
        sendJson(res, 200, { success: true, note });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/argus/v1/documents') {
        const payload = await readRequestBody(req);
        const result = await this.writeDocument(payload);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/argus/v1/patch') {
        const payload = await readRequestBody(req);
        const result = await this.patchNote(payload);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/argus/v1/query') {
        const payload = await readRequestBody(req);
        const results = await this.queryDocuments(payload);
        sendJson(res, 200, { success: true, results });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/argus/v1/periodic/append') {
        const payload = await readRequestBody(req);
        const result = await this.appendToPeriodicNote(payload);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/argus/v1/graph') {
        const payload = await readRequestBody(req);
        const result = await this.getGraph(payload);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/argus/v1/wiki/ingest') {
        const payload = await readRequestBody(req);
        const result = await this.writeWikiRawSource(payload);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/argus/v1/wiki/compile') {
        const payload = await readRequestBody(req);
        const result = await this.compileWikiSource(payload);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/argus/v1/wiki/lint') {
        const payload = await readRequestBody(req);
        const result = await this.lintWiki(payload);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/argus/v1/search') {
        const payload = await readRequestBody(req);
        const results = await this.searchDocuments(payload);
        sendJson(res, 200, { success: true, results });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/argus/v1/context') {
        const payload = await readRequestBody(req);
        const results = await this.searchDocuments(payload);
        sendJson(res, 200, {
          success: true,
          results,
          context: buildContextFromSearchResults(results),
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/argus/v1/duplicates/scan') {
        const payload = await readRequestBody(req);
        const result = await this.scanDuplicateNotes(payload);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/argus/v1/duplicates/archive') {
        const payload = await readRequestBody(req);
        const result = await this.archiveDuplicateNotes(payload);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/argus/v1/documents/')) {
        const id = decodeURIComponent(url.pathname.slice('/argus/v1/documents/'.length));
        const document = await this.readDocumentByArgusId(id);
        if (!document) {
          sendJson(res, 404, { success: false, error: 'Document not found.' });
          return;
        }
        sendJson(res, 200, { success: true, document });
        return;
      }

      sendJson(res, 404, { success: false, error: 'Not found.' });
    } catch (error) {
      console.error('[Argus Bridge] Request failed:', error);
      await this.recordRecentError(error);
      sendJson(res, 400, {
        success: false,
        error: error.message || 'Argus Bridge request failed.',
      });
    }
  }

  async writeDocument(payload) {
    const now = new Date();
    const document = normalizePayload(payload);
    const existingFile = document.argusId ? await this.findFileByArgusId(document.argusId) : null;

    if (existingFile) {
      await this.app.vault.process(existingFile, (previousContent) => {
        const created = readProperty(previousContent, 'created') || now.toISOString();
        return formatDocument(document, now, { created, templates: this.settings.templates });
      });
      await this.afterDocumentWrite(existingFile.path, document, true);
      return {
        path: existingFile.path,
        mode: document.mode,
        argusId: document.argusId,
        updated: true,
        vaultName: this.app.vault.getName(),
      };
    }

    const targetPath = assertSafeVaultPath(buildDocumentPath(document, now, {
      baseFolder: document.baseFolder || this.settings.baseFolder,
    }));
    const uniquePath = resolveUniquePath(targetPath, (candidate) => (
      Boolean(this.app.vault.getAbstractFileByPath(candidate))
    ));

    await this.ensureFolderForPath(uniquePath);
    await this.app.vault.create(uniquePath, formatDocument(document, now, {
      templates: this.settings.templates,
    }));
    await this.afterDocumentWrite(uniquePath, document, false);
    return {
      path: uniquePath,
      mode: document.mode,
      argusId: document.argusId,
      updated: false,
      vaultName: this.app.vault.getName(),
    };
  }

  async ensureWikiSchema() {
    const schemaPath = buildWikiSchemaPath({ baseFolder: this.settings.baseFolder });
    const existing = this.app.vault.getAbstractFileByPath(schemaPath);
    if (existing) {
      return schemaPath;
    }
    await this.ensureFolderForPath(schemaPath);
    await this.app.vault.create(schemaPath, formatWikiSchemaDocument(this.settings.baseFolder));
    return schemaPath;
  }

  async updateWikiImportIndex(entry = {}) {
    const indexPath = buildWikiIndexPath({ baseFolder: this.settings.baseFolder });
    await this.ensureFolderForPath(indexPath);
    const existing = this.app.vault.getAbstractFileByPath(indexPath);
    if (existing) {
      await this.app.vault.process(existing, (previousContent) => buildWikiUploadIndex({
        existingContent: previousContent,
        entries: [entry],
      }));
    } else {
      await this.app.vault.create(indexPath, buildWikiUploadIndex({ entries: [entry] }));
    }
    return indexPath;
  }

  async writeWikiRawSource(payload = {}) {
    const now = new Date();
    const title = String(payload.title || '').trim();
    if (!title) {
      throw new Error('Wiki source title is required.');
    }
    if (typeof payload.content !== 'string') {
      throw new Error('Wiki source content is required.');
    }
    const existingFile = payload.argusId ? await this.findFileByArgusId(payload.argusId) : null;
    const targetPath = assertSafeVaultPath(buildWikiRawPath(payload, now, {
      baseFolder: this.settings.baseFolder,
    }));
    let notePath = existingFile?.path || targetPath;
    let updated = Boolean(existingFile);
    if (existingFile) {
      await this.app.vault.process(existingFile, (previousContent) => {
        const created = readProperty(previousContent, 'created') || now.toISOString();
        return formatWikiSourceDocument({ ...payload, created }, now);
      });
    } else {
      notePath = resolveUniquePath(targetPath, (candidate) => Boolean(this.app.vault.getAbstractFileByPath(candidate)));
      await this.ensureFolderForPath(notePath);
      await this.app.vault.create(notePath, formatWikiSourceDocument(payload, now));
    }
    await this.ensureWikiSchema();
    await this.updateWikiImportIndex({
      title,
      rawPath: notePath,
      wikiStatus: 'raw',
    });
    await this.afterWikiWrite(notePath, {
      title,
      mode: 'raw',
      kind: 'raw-source',
      routingReason: payload.classificationReason || '',
    }, updated);
    return {
      path: notePath,
      rawPath: notePath,
      argusId: payload.argusId || '',
      updated,
      vaultName: this.app.vault.getName(),
    };
  }

  async compileWikiSource(payload = {}) {
    const now = new Date();
    const title = String(payload.title || '').trim();
    if (!title) {
      throw new Error('Wiki compile title is required.');
    }
    if (typeof payload.content !== 'string') {
      throw new Error('Wiki compile content is required.');
    }
    const existingFile = payload.argusId ? await this.findFileByArgusId(payload.argusId) : null;
    const targetPath = assertSafeVaultPath(buildWikiPath(payload, now, {
      baseFolder: this.settings.baseFolder,
    }));
    let wikiPath = existingFile?.path || targetPath;
    const updated = Boolean(existingFile);
    if (existingFile) {
      await this.app.vault.process(existingFile, (previousContent) => {
        const created = readProperty(previousContent, 'created') || now.toISOString();
        return formatWikiCompiledDocument({ ...payload, created }, now);
      });
    } else {
      wikiPath = resolveUniquePath(targetPath, (candidate) => Boolean(this.app.vault.getAbstractFileByPath(candidate)));
      await this.ensureFolderForPath(wikiPath);
      await this.app.vault.create(wikiPath, formatWikiCompiledDocument(payload, now));
    }

    if (payload.rawPath) {
      const rawFile = this.app.vault.getAbstractFileByPath(assertSafeVaultPath(payload.rawPath));
      if (rawFile) {
        await this.app.vault.process(rawFile, (previousContent) => patchMarkdownContent(previousContent, {
          operation: 'upsert-frontmatter',
          properties: {
            wikiPath,
            wikiStatus: 'compiled',
            updated: now.toISOString(),
          },
        }).content);
      }
    }

    await this.ensureWikiSchema();
    await this.updateWikiImportIndex({
      title,
      rawPath: payload.rawPath || '',
      wikiPath,
      wikiStatus: 'compiled',
    });
    await this.afterWikiWrite(wikiPath, {
      title,
      mode: 'wiki',
      kind: 'wiki-note',
      routingReason: payload.classificationReason || '',
    }, updated);
    return {
      path: wikiPath,
      wikiPath,
      rawPath: payload.rawPath || '',
      argusId: payload.argusId || '',
      updated,
      vaultName: this.app.vault.getName(),
    };
  }

  async lintWiki(payload = {}) {
    const folders = Array.isArray(payload.folders) && payload.folders.length > 0
      ? payload.folders.map((folder) => this.normalizeVaultFolder(folder)).filter(Boolean)
      : [`${this.settings.baseFolder}/Raw`, `${this.settings.baseFolder}/Wiki`];
    const files = await this.readMarkdownPayloads(folders);
    return lintWikiFiles(files, {
      baseFolder: this.settings.baseFolder,
    });
  }

  async ensureFolderForPath(notePath) {
    const parts = notePath.split('/').slice(0, -1);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async findFileByArgusId(argusId) {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const candidates = [];
    for (const file of markdownFiles) {
      const content = await this.app.vault.cachedRead(file);
      candidates.push({ path: file.path, content });
    }
    const matchPath = findPathByArgusId(candidates, argusId);
    return matchPath ? this.app.vault.getAbstractFileByPath(matchPath) : null;
  }

  getActiveEditor() {
    return this.app.workspace?.activeEditor?.editor || null;
  }

  async getActiveNote(options = {}) {
    const file = this.app.workspace?.getActiveFile?.();
    if (!file) {
      return null;
    }
    const editor = this.getActiveEditor();
    const content = options.includeContent === false ? '' : await this.app.vault.cachedRead(file);
    const selection = options.includeSelection === false ? undefined : editor?.getSelection?.();
    return extractNoteMetadata({
      vaultName: this.app.vault.getName(),
      path: file.path,
      content,
      selection,
      cursor: editor?.getCursor?.(),
    });
  }

  async resolveWritableMarkdownFile(target = {}) {
    if (target?.active) {
      const activeFile = this.app.workspace?.getActiveFile?.();
      if (!activeFile) {
        throw new Error('No active Obsidian note.');
      }
      assertSafeVaultPath(activeFile.path);
      return activeFile;
    }
    if (target?.argusId) {
      const file = await this.findFileByArgusId(target.argusId);
      if (!file) {
        throw new Error('No Obsidian note found for argusId.');
      }
      assertSafeVaultPath(file.path);
      return file;
    }
    const path = assertSafeVaultPath(target?.path || '');
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      throw new Error('Target Obsidian note was not found.');
    }
    return file;
  }

  async patchNote(payload = {}) {
    const file = await this.resolveWritableMarkdownFile(payload.target || {});
    let nextSummary = {};
    await this.app.vault.process(file, (previousContent) => {
      const result = patchMarkdownContent(previousContent, payload);
      nextSummary = result;
      return result.content;
    });
    return {
      path: file.path,
      changed: nextSummary.changed !== false,
      operation: payload.operation,
      matchedHeadingCount: nextSummary.matchedHeadingCount || 0,
      vaultName: this.app.vault.getName(),
    };
  }

  normalizeVaultFolder(folder) {
    return String(folder || '')
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .map((segment) => sanitizePathSegment(segment, ''))
      .filter(Boolean)
      .join('/');
  }

  normalizeLocalEndpoint(value, fallback) {
    try {
      const raw = String(value || fallback || '').trim();
      const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
      if (parsed.protocol !== 'http:') {
        return fallback;
      }
      if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname.toLowerCase())) {
        return fallback;
      }
      return `http://${parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname}:${parsed.port || '3001'}`;
    } catch {
      return fallback;
    }
  }

  isReadablePath(filePath, folders = this.settings.readableFolders) {
    const normalizedPath = String(filePath || '').replace(/\\/g, '/');
    return folders.some((folder) => {
      const normalizedFolder = this.normalizeVaultFolder(folder);
      return normalizedFolder && (normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`));
    });
  }

  async readMarkdownPayloads(folders = this.settings.readableFolders) {
    const files = this.app.vault.getMarkdownFiles().filter((file) => this.isReadablePath(file.path, folders));
    const payloads = [];
    for (const file of files) {
      payloads.push({
        path: file.path,
        content: await this.app.vault.cachedRead(file),
      });
    }
    return payloads;
  }

  async readDuplicatePayloads(folders = [this.settings.baseFolder]) {
    const files = this.app.vault.getMarkdownFiles().filter((file) => this.isReadablePath(file.path, folders));
    const payloads = [];
    for (const file of files) {
      payloads.push({
        path: file.path,
        content: await this.app.vault.cachedRead(file),
        mtime: file.stat?.mtime || 0,
      });
    }
    return payloads;
  }

  async scanDuplicateNotes(payload = {}) {
    const folders = Array.isArray(payload.folders) && payload.folders.length > 0
      ? payload.folders.map((folder) => this.normalizeVaultFolder(folder)).filter(Boolean)
      : [this.settings.baseFolder];
    const files = await this.readDuplicatePayloads(folders);
    return planDuplicateArchives(files, {
      archiveRoot: `${this.settings.baseFolder}/_duplicates`,
    });
  }

  async archiveDuplicateNotes(payload = {}) {
    const plan = await this.scanDuplicateNotes(payload);
    const archived = [];
    for (const move of plan.moves) {
      const file = this.app.vault.getAbstractFileByPath(move.from);
      if (!file) {
        continue;
      }
      await this.ensureFolderForPath(move.to);
      await this.app.vault.rename(file, move.to);
      archived.push(move);
    }
    return {
      groups: plan.groups,
      moves: plan.moves,
      archived,
      duplicateArchivedPaths: archived.map((entry) => entry.to),
    };
  }

  async readIndexablePayloads(folders = this.settings.readableFolders) {
    const files = typeof this.app.vault.getFiles === 'function'
      ? this.app.vault.getFiles()
      : this.app.vault.getMarkdownFiles();
    const indexable = files.filter((file) => (
      this.isReadablePath(file.path, folders)
      && (
        String(file.path).endsWith('.md')
        || String(file.path).endsWith('.canvas')
        || String(file.path).endsWith('.excalidraw')
      )
    ));
    const payloads = [];
    for (const file of indexable) {
      payloads.push({
        path: file.path,
        content: String(file.path).endsWith('.md')
          ? await this.app.vault.cachedRead(file)
          : await this.app.vault.read(file),
      });
    }
    return payloads;
  }

  async searchDocuments(payload = {}) {
    return this.queryDocuments({
      ...payload,
      sourceTypes: payload.sourceTypes || ['markdown'],
    });
  }

  async queryDocuments(payload = {}) {
    const folders = Array.isArray(payload.folders) && payload.folders.length > 0
      ? payload.folders.map((folder) => this.normalizeVaultFolder(folder)).filter((folder) => this.isReadablePath(folder))
      : this.settings.readableFolders;
    const files = await this.readIndexablePayloads(folders);
    return queryReadableFiles(files, {
      query: payload.query || '',
      readableFolders: folders,
      filters: payload.filters || [],
      sourceTypes: payload.sourceTypes || ['markdown', 'canvas', 'excalidraw'],
      limit: payload.limit || 10,
    });
  }

  formatPeriodicDate(date = new Date()) {
    const value = date instanceof Date ? date : new Date(date || Date.now());
    const yyyy = String(value.getFullYear());
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return String(this.settings.dailyNoteDateFormat || 'YYYY-MM-DD')
      .replace(/YYYY/g, yyyy)
      .replace(/MM/g, mm)
      .replace(/DD/g, dd);
  }

  async appendToPeriodicNote(payload = {}) {
    const folder = this.normalizeVaultFolder(payload.folder || this.settings.dailyNoteFolder);
    const heading = String(payload.heading || this.settings.dailyNoteHeading || 'Argus').trim();
    const title = this.formatPeriodicDate(payload.date || new Date());
    const notePath = assertSafeVaultPath(`${folder}/${title}.md`);
    await this.ensureFolderForPath(notePath);
    const existing = this.app.vault.getAbstractFileByPath(notePath);
    if (existing) {
      await this.app.vault.process(existing, (previousContent) => appendToPeriodicContent(previousContent, {
        title,
        heading,
        content: payload.content || '',
      }));
    } else {
      await this.app.vault.create(notePath, appendToPeriodicContent('', {
        title,
        heading,
        content: payload.content || '',
      }));
    }
    return {
      path: notePath,
      heading,
      vaultName: this.app.vault.getName(),
    };
  }

  async getGraph(payload = {}) {
    const folders = Array.isArray(payload.folders) && payload.folders.length > 0
      ? payload.folders.map((folder) => this.normalizeVaultFolder(folder)).filter((folder) => this.isReadablePath(folder))
      : this.settings.readableFolders;
    const files = await this.readIndexablePayloads(folders);
    return buildKnowledgeGraph(files, {
      readableFolders: folders,
      projectName: payload.projectName || '',
    });
  }

  async recordRecentIngress(entry) {
    this.settings.recentIngress = [
      {
        action: entry.action,
        title: entry.note?.title || entry.note?.path || '',
        at: new Date().toISOString(),
      },
      ...(Array.isArray(this.settings.recentIngress) ? this.settings.recentIngress : []),
    ].slice(0, 20);
    await this.saveSettings();
  }

  async sendToArgusIngress(action, note) {
    const route = action === 'ask-note'
      ? '/api/obsidian-bridge-ingress/ask'
      : action === 'create-memory'
        ? '/api/obsidian-bridge-ingress/memory-candidates'
        : '/api/obsidian-bridge-ingress/import';
    const response = await fetch(`${this.settings.argusEndpoint}${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.settings.token}`,
      },
      body: JSON.stringify({
        action,
        note,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
      throw new Error(data?.error || `Argus returned HTTP ${response.status}.`);
    }
    await this.recordRecentIngress({ action, note });
    return data;
  }

  async sendCurrentNoteToArgus(action) {
    const note = await this.getActiveNote({
      includeContent: action !== 'send-selection' && action !== 'create-memory',
      includeSelection: true,
    });
    if (!note) {
      new Notice('No active note to send to Argus.');
      return;
    }
    if ((action === 'send-selection' || action === 'create-memory') && !note.selection) {
      new Notice('Select text before sending it to Argus.');
      return;
    }
    await this.sendToArgusIngress(action, note);
    new Notice('Sent to Argus.');
  }

  async appendSelectionToDailyNote() {
    const note = await this.getActiveNote({
      includeContent: false,
      includeSelection: true,
    });
    if (!note?.selection) {
      new Notice('Select text before appending to the Daily note.');
      return;
    }
    const result = await this.appendToPeriodicNote({
      content: note.selection,
    });
    new Notice(`Appended to ${result.path}.`);
  }

  async readDocumentByArgusId(argusId) {
    const files = await this.readMarkdownPayloads(this.settings.readableFolders);
    const matchPath = findPathByArgusId(files, argusId);
    if (!matchPath || !this.isReadablePath(matchPath)) {
      return null;
    }
    const file = this.app.vault.getAbstractFileByPath(matchPath);
    if (!file) {
      return null;
    }
    return {
      id: argusId,
      path: matchPath,
      content: await this.app.vault.cachedRead(file),
    };
  }

  async afterDocumentWrite(notePath, document, updated) {
    this.settings.recentWrites = [
      {
        path: notePath,
        title: document.title,
        mode: document.mode,
        kind: document.kind || '',
        routingMode: document.metadata?.routingMode || document.mode,
        routingReason: document.metadata?.routingReason || '',
        routingSignals: Array.isArray(document.metadata?.routingSignals) ? document.metadata.routingSignals : [],
        updated,
        writtenAt: new Date().toISOString(),
      },
      ...this.settings.recentWrites,
    ].slice(0, 20);
    await this.saveSettings();
    if (document.mode === 'project-knowledge' && document.projectName) {
      await this.updateProjectIndex(document.projectName);
    }
  }

  async afterWikiWrite(notePath, document, updated) {
    this.settings.recentWrites = [
      {
        path: notePath,
        title: document.title,
        mode: document.mode,
        kind: document.kind || '',
        routingReason: document.routingReason || '',
        updated,
        writtenAt: new Date().toISOString(),
      },
      ...this.settings.recentWrites,
    ].slice(0, 20);
    await this.saveSettings();
  }

  async updateProjectIndex(projectName) {
    const projectFolder = `${this.settings.baseFolder}/Projects/${sanitizePathSegment(projectName, 'General')}`;
    const indexPath = `${projectFolder}/Index.md`;
    await this.ensureFolderForPath(`${indexPath}`);
    const entries = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(`${projectFolder}/`) || file.path === indexPath) {
        continue;
      }
      const content = await this.app.vault.cachedRead(file);
      entries.push({
        path: file.path,
        title: file.basename || file.path.split('/').pop()?.replace(/\.md$/i, '') || 'Untitled',
        kind: readProperty(content, 'kind'),
      });
    }
    const existing = this.app.vault.getAbstractFileByPath(indexPath);
    const nextContent = buildProjectIndex({
      projectName,
      entries,
      existingContent: existing ? await this.app.vault.cachedRead(existing) : '',
    });
    if (existing) {
      await this.app.vault.process(existing, () => nextContent);
      return;
    }
    await this.app.vault.create(indexPath, nextContent);
  }
};

class ArgusBridgeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Argus Bridge for Obsidian' });
    containerEl.createEl('p', {
      text: 'Accepts local Argus document writes and stores them as Markdown notes in this vault.',
    });

    new Setting(containerEl)
      .setName('Local port')
      .setDesc('The plugin binds to 127.0.0.1 only.')
      .addText((text) => text
        .setPlaceholder('27177')
        .setValue(String(this.plugin.settings.port))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) {
            this.plugin.settings.port = parsed;
            await this.plugin.saveSettings();
          }
        }))
      .addButton((button) => button
        .setButtonText('Restart')
        .onClick(async () => {
          await this.plugin.restartServer();
          new Notice('Argus Bridge restarted.');
        }));

    new Setting(containerEl)
      .setName('Base folder')
      .setDesc('Argus writes under this vault folder.')
      .addText((text) => text
        .setPlaceholder('Argus')
        .setValue(this.plugin.settings.baseFolder)
        .onChange(async (value) => {
          this.plugin.settings.baseFolder = sanitizePathSegment(value, DEFAULT_SETTINGS.baseFolder);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Argus endpoint')
      .setDesc('Used by Obsidian commands that send the current note or selection back to Argus.')
      .addText((text) => text
        .setPlaceholder('http://127.0.0.1:3001')
        .setValue(this.plugin.settings.argusEndpoint)
        .onChange(async (value) => {
          this.plugin.settings.argusEndpoint = this.plugin.normalizeLocalEndpoint(value, DEFAULT_SETTINGS.argusEndpoint);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Pairing token')
      .setDesc('Paste this token into Argus settings.')
      .addText((text) => text
        .setValue(this.plugin.settings.token)
        .setDisabled(true))
      .addButton((button) => button
        .setButtonText('Copy')
        .onClick(async () => {
          await this.plugin.copyToken();
        }))
      .addButton((button) => button
        .setButtonText('Regenerate')
        .setWarning()
        .onClick(async () => {
          await this.plugin.regenerateToken();
          this.display();
        }));

    new Setting(containerEl)
      .setName('Readable folders')
      .setDesc('Argus search/read APIs are limited to these folders.')
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text
          .setValue(this.plugin.settings.readableFolders.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.readableFolders = value
              .split(/\r?\n/)
              .map((folder) => this.plugin.normalizeVaultFolder(folder))
              .filter(Boolean);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Daily note')
      .setDesc('Append periodic Argus notes to this folder and heading.')
      .addText((text) => text
        .setPlaceholder('Daily')
        .setValue(this.plugin.settings.dailyNoteFolder)
        .onChange(async (value) => {
          this.plugin.settings.dailyNoteFolder = this.plugin.normalizeVaultFolder(value) || DEFAULT_SETTINGS.dailyNoteFolder;
          await this.plugin.saveSettings();
        }))
      .addText((text) => text
        .setPlaceholder('Argus')
        .setValue(this.plugin.settings.dailyNoteHeading)
        .onChange(async (value) => {
          this.plugin.settings.dailyNoteHeading = value.trim() || DEFAULT_SETTINGS.dailyNoteHeading;
          await this.plugin.saveSettings();
        }));

    for (const mode of ['project-knowledge', 'second-brain', 'ai-memory']) {
      new Setting(containerEl)
        .setName(`Template: ${mode}`)
        .setDesc('Available variables include {{title}}, {{content}}, {{projectName}}, {{sessionId}}, {{mode}}, and {{kind}}.')
        .addTextArea((text) => {
          text.inputEl.rows = 5;
          text
            .setValue(this.plugin.settings.templates[mode] || '{{content}}')
            .onChange(async (value) => {
              this.plugin.settings.templates[mode] = value || '{{content}}';
              await this.plugin.saveSettings();
            });
        });
    }

    if (this.plugin.settings.recentWrites.length > 0) {
      containerEl.createEl('h3', { text: 'Recent writes' });
      const list = containerEl.createEl('ul');
      for (const write of this.plugin.settings.recentWrites.slice(0, 8)) {
        list.createEl('li', {
          text: `${write.title || write.path} -> ${write.path}${write.mode ? ` (${write.mode})` : ''}${write.kind ? `, ${write.kind}` : ''}${write.routingReason ? ` - ${write.routingReason}` : ''}`,
        });
      }
    }

    new Setting(containerEl)
      .setName('Duplicate cleanup')
      .setDesc('Move duplicate Argus notes to _duplicates while keeping the latest note.')
      .addButton((button) => button
        .setButtonText('Archive duplicates')
        .onClick(async () => {
          const result = await this.plugin.archiveDuplicateNotes();
          new Notice(`Archived ${result.archived.length} duplicate Argus note(s).`);
        }));

    if (this.plugin.settings.recentIngress.length > 0) {
      containerEl.createEl('h3', { text: 'Recent Argus sends' });
      const list = containerEl.createEl('ul');
      for (const item of this.plugin.settings.recentIngress.slice(0, 8)) {
        list.createEl('li', {
          text: `${item.action || 'send'} -> ${item.title || 'Untitled'} ${item.at || ''}`.trim(),
        });
      }
    }

    if (this.plugin.settings.recentErrors.length > 0) {
      containerEl.createEl('h3', { text: 'Last error' });
      const list = containerEl.createEl('ul');
      for (const error of this.plugin.settings.recentErrors.slice(0, 5)) {
        list.createEl('li', {
          text: `${error.at || ''} ${error.message || 'Unknown error'}`.trim(),
        });
      }
    }
  }
}
