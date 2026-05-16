import crypto from 'crypto';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

import {
  patchObsidianNote,
  queryObsidianNotes,
  readObsidianBridgeConfig,
  upsertObsidianMarkdownFile,
} from './obsidian-bridge-service.js';
import { completeSmallModelJson } from './small-model-service.js';

const require = createRequire(import.meta.url);
const ACTIVE_FILES_START = '<!-- argus-codegraph:active-files:start -->';
const ACTIVE_FILES_END = '<!-- argus-codegraph:active-files:end -->';
const AUTO_GEN_TAG = 'argus/auto-gen';
const CODEGRAPH_TAG = 'argus/codegraph';
const CODEGRAPH_DIR_NAME = '.codegraph';
const ARGUS_CODEGRAPH_STORAGE_ENV = 'ARGUS_CODEGRAPH_STORAGE_DIR';
const ARGUS_FULL_INDEX_MARKER = 'argus-full-index.json';
const ARGUS_FULL_INDEX_FAILURE_MARKER = 'argus-full-index-failed.json';
const ARGUS_FULL_INDEX_FAILURE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CODEGRAPH_COVERAGE_SHARD_SIZE = 500;
const MAX_NATIVE_EDGES_PER_NODE = 250;
const DEFAULT_CODEGRAPH_SCRIPT_INCLUDE = '**/*.cs';
const CODEGRAPH_STREAM_FILE_YIELD_EVERY = 10;
const CODEGRAPH_STREAM_PROGRESS_EVERY = 25;

const DEFAULT_SETTINGS = {
  codegraphEnabled: true,
  codegraphBackgroundSyncEnabled: true,
  codegraphWriteObsidianSummaries: true,
  codegraphLazyLlmSummaries: false,
  codegraphMaxSymbolNotes: 50,
  codegraphImpactMaxDepth: 2,
  codegraphImpactLimit: 50,
  codegraphGhostPolicy: 'deprecate',
  codegraphAutoDeleteGhostNotes: false,
  codegraphStorageRoot: '',
  codegraphExportLevel: 'structural',
  codegraphMaxEmbeddedSymbols: 200,
};

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const yieldToEventLoopDefault = () => new Promise((resolve) => {
  if (typeof setImmediate === 'function') {
    setImmediate(resolve);
  } else {
    setTimeout(resolve, 0);
  }
});

const stableHash = (value = '') => (
  crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
);

const stableStringify = (value) => {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`;
};

const sanitizeVaultSegment = (value, fallback = 'General') => {
  const sanitized = readString(value)
    .replace(/[\\/]+/g, ' ')
    .replace(/\.\.+/g, ' ')
    .replace(/[<>:"|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || fallback;
};

const slugify = (value, fallback = 'item') => {
  const slug = readString(value)
    .replace(/\\/g, '/')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || fallback;
};

const expandHomePath = (value = '') => {
  const raw = readString(value);
  if (!raw) return '';
  if (raw === '~') return os.homedir();
  if (raw.startsWith(`~${path.sep}`) || raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
};

const defaultCodeGraphStorageRoot = () => (
  expandHomePath(process.env[ARGUS_CODEGRAPH_STORAGE_ENV])
  || path.join(
    expandHomePath(process.env.MTL_CODE_CONFIG_DIR) || path.join(os.homedir(), '.mtl-code'),
    'codegraph',
  )
);

export const resolveCodeGraphStorageRoot = (config = {}) => (
  path.resolve(expandHomePath(config?.codegraphStorageRoot) || defaultCodeGraphStorageRoot())
);

const comparablePath = (value = '') => {
  const normalized = path.resolve(readString(value)).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const sameResolvedPath = (left = '', right = '') => (
  Boolean(left && right) && comparablePath(left) === comparablePath(right)
);

const toCodeGraphRelativePath = (projectRoot = '', filePath = '') => {
  const root = readString(projectRoot);
  const rawPath = readString(filePath).replace(/\\/g, '/');
  if (!root || !rawPath) return rawPath.replace(/^\/+/, '');
  const absolute = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
  const relative = path.relative(path.resolve(root), absolute).replace(/\\/g, '/');
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : '';
};

export const normalizeCodeGraphScopePaths = (projectRoot = '', scopePaths = []) => {
  const root = readString(projectRoot);
  if (!root || !Array.isArray(scopePaths)) return [];
  const rootComparable = comparablePath(root);
  const seen = new Set();
  return scopePaths
    .map((entry) => {
      const rawPath = readString(entry);
      if (!rawPath) return null;
      const absolutePath = path.isAbsolute(rawPath)
        ? path.resolve(rawPath)
        : path.resolve(root, rawPath);
      const comparable = comparablePath(absolutePath);
      if (comparable !== rootComparable && !comparable.startsWith(`${rootComparable}${path.sep}`)) {
        return null;
      }
      const relativePath = toCodeGraphRelativePath(root, absolutePath);
      const kind = path.extname(absolutePath).toLowerCase() === '.cs' ? 'file' : 'directory';
      const key = `${kind}:${comparable}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        kind,
        absolutePath,
        relativePath,
      };
    })
    .filter(Boolean);
};

const createCodeGraphScopeMatcher = (projectRoot = '', scopePaths = []) => {
  const scopes = normalizeCodeGraphScopePaths(projectRoot, scopePaths);
  if (scopes.length === 0) {
    return {
      hasScope: false,
      scopes,
      exactFilePaths: new Set(),
      matches: () => true,
    };
  }
  const exactFilePaths = new Set(scopes
    .filter((scope) => scope.kind === 'file' && scope.relativePath)
    .map((scope) => scope.relativePath.toLowerCase()));
  const exactFileRelativePaths = scopes
    .filter((scope) => scope.kind === 'file' && scope.relativePath)
    .map((scope) => scope.relativePath);
  const directoryPrefixes = scopes
    .filter((scope) => scope.kind === 'directory')
    .map((scope) => scope.relativePath.replace(/\/+$/, '').toLowerCase());
  return {
    hasScope: true,
    scopes,
    exactFilePaths,
    exactFileRelativePaths,
    matches: (filePath = '') => {
      const relativePath = toCodeGraphRelativePath(projectRoot, filePath).toLowerCase();
      if (!relativePath) return false;
      if (exactFilePaths.has(relativePath)) return true;
      return directoryPrefixes.some((prefix) => (
        !prefix
          ? relativePath.endsWith('.cs')
          : relativePath === prefix || relativePath.startsWith(`${prefix}/`)
      ));
    },
  };
};

export const buildCodeGraphScopeConfigPatch = (projectRoot = '', scopePaths = []) => {
  const scopes = normalizeCodeGraphScopePaths(projectRoot, scopePaths);
  if (scopes.length === 0) return {};
  const include = [...new Set(scopes.map((scope) => {
    if (scope.kind === 'file') return scope.relativePath;
    return scope.relativePath ? `${scope.relativePath.replace(/\/+$/, '')}/**/*.cs` : DEFAULT_CODEGRAPH_SCRIPT_INCLUDE;
  }).filter(Boolean))];
  return include.length > 0 ? { include } : {};
};

export const getCodeGraphProjectStoragePath = (projectRoot = '', config = {}) => {
  const rawRoot = readString(projectRoot);
  if (!rawRoot) return '';
  const root = path.resolve(rawRoot);
  const projectKey = `${slugify(path.basename(root), 'project')}-${stableHash(comparablePath(root))}`;
  return path.join(resolveCodeGraphStorageRoot(config), 'projects', projectKey);
};

const pathExists = async (targetPath = '') => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const directoryIsEmpty = async (targetPath = '') => {
  try {
    const entries = await fs.readdir(targetPath);
    return entries.length === 0;
  } catch {
    return true;
  }
};

const moveDirectory = async (sourcePath, targetPath) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    await fs.cp(sourcePath, targetPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await fs.rm(sourcePath, { recursive: true, force: true });
  }
};

const ensureCodeGraphIgnored = async (projectRoot = '') => {
  const excludePath = path.join(projectRoot, '.git', 'info', 'exclude');
  try {
    await fs.access(path.dirname(excludePath));
  } catch {
    return;
  }
  let current = '';
  try {
    current = await fs.readFile(excludePath, 'utf8');
  } catch {
    current = '';
  }
  const lines = current.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(CODEGRAPH_DIR_NAME) || lines.includes(`${CODEGRAPH_DIR_NAME}/`)) {
    return;
  }
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  await fs.writeFile(excludePath, `${current}${prefix}${CODEGRAPH_DIR_NAME}/\n`, 'utf8');
};

export const ensureCodeGraphProjectStorage = async (projectRoot = '', {
  config = {},
  storageRoot = '',
  migrateExisting = true,
} = {}) => {
  const rawRoot = readString(projectRoot);
  if (!rawRoot) throw new Error('projectRoot is required.');
  const root = path.resolve(rawRoot);
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`projectRoot is not a directory: ${root}`);
  }

  const effectiveConfig = storageRoot ? { ...config, codegraphStorageRoot: storageRoot } : config;
  const resolvedStorageRoot = resolveCodeGraphStorageRoot(effectiveConfig);
  const storagePath = getCodeGraphProjectStoragePath(root, effectiveConfig);
  const linkPath = path.join(root, CODEGRAPH_DIR_NAME);
  await fs.mkdir(resolvedStorageRoot, { recursive: true });
  await ensureCodeGraphIgnored(root);

  let linkStat = null;
  try {
    linkStat = await fs.lstat(linkPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (linkStat?.isSymbolicLink()) {
    let targetPath = '';
    try {
      targetPath = await fs.realpath(linkPath);
    } catch {
      try {
        const rawTarget = await fs.readlink(linkPath);
        targetPath = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(root, rawTarget);
      } catch {
        targetPath = '';
      }
    }
    if (targetPath && !sameResolvedPath(targetPath, storagePath)) {
      if (!migrateExisting) {
        return {
          projectRoot: root,
          storageRoot: resolvedStorageRoot,
          storagePath,
          linkPath,
          linked: false,
          migrated: false,
          reason: 'project-codegraph-link-points-elsewhere',
        };
      }
      if (await pathExists(storagePath)) {
        if (!(await directoryIsEmpty(storagePath))) {
          throw new Error(`CodeGraph storage path already contains data: ${storagePath}`);
        }
        await fs.rm(storagePath, { recursive: true, force: true });
      }
      await fs.rm(linkPath, { force: true });
      if (await pathExists(targetPath)) {
        await moveDirectory(targetPath, storagePath);
      } else {
        await fs.mkdir(storagePath, { recursive: true });
      }
      await fs.symlink(storagePath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      return {
        projectRoot: root,
        storageRoot: resolvedStorageRoot,
        storagePath,
        linkPath,
        linked: true,
        migrated: true,
      };
    }
    await fs.mkdir(storagePath, { recursive: true });
    return {
      projectRoot: root,
      storageRoot: resolvedStorageRoot,
      storagePath,
      linkPath,
      linked: true,
      migrated: false,
    };
  }

  if (linkStat) {
    if (!linkStat.isDirectory()) {
      throw new Error(`${CODEGRAPH_DIR_NAME} exists but is not a directory: ${linkPath}`);
    }
    if (!migrateExisting) {
      return {
        projectRoot: root,
        storageRoot: resolvedStorageRoot,
        storagePath,
        linkPath,
        linked: false,
        migrated: false,
        reason: 'project-local-codegraph-present',
      };
    }
    if (await pathExists(storagePath)) {
      if (!(await directoryIsEmpty(storagePath))) {
        throw new Error(`CodeGraph storage path already contains data: ${storagePath}`);
      }
      await fs.rm(storagePath, { recursive: true, force: true });
    }
    await moveDirectory(linkPath, storagePath);
    await fs.symlink(storagePath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    return {
      projectRoot: root,
      storageRoot: resolvedStorageRoot,
      storagePath,
      linkPath,
      linked: true,
      migrated: true,
    };
  }

  await fs.mkdir(storagePath, { recursive: true });
  await fs.symlink(storagePath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  return {
    projectRoot: root,
    storageRoot: resolvedStorageRoot,
    storagePath,
    linkPath,
    linked: true,
    migrated: false,
  };
};

const quoteYaml = (value) => JSON.stringify(String(value ?? ''));

const yamlScalar = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const stringValue = String(value ?? '');
  return /[#\[\]{},"\n]|^\s|\s$|^-/.test(stringValue) ? quoteYaml(stringValue) : stringValue;
};

const yamlValueLines = (key, value) => {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return [];
  if (Array.isArray(value)) {
    return [`${key}:`, ...value.map((entry) => `  - ${yamlScalar(entry)}`)];
  }
  return [`${key}: ${yamlScalar(value)}`];
};

const formatFrontmatter = (properties = {}) => [
  '---',
  ...Object.entries(properties).flatMap(([key, value]) => yamlValueLines(key, value)),
  '---',
].join('\n');

const noteLink = (targetPath, _label = '') => {
  const cleanTarget = readString(targetPath)
    .replace(/\\/g, '/')
    .replace(/^Argus\/Wiki\/[^/]+\//, '')
    .replace(/\.md$/i, '');
  return `[[${cleanTarget}]]`;
};

const ALL_NATIVE_NODE_KINDS = [
  'file',
  'module',
  'class',
  'struct',
  'interface',
  'trait',
  'protocol',
  'function',
  'method',
  'property',
  'field',
  'variable',
  'constant',
  'enum',
  'enum_member',
  'type_alias',
  'namespace',
  'parameter',
  'import',
  'export',
  'route',
  'component',
];

const STRUCTURAL_NODE_KINDS = new Set([
  'module',
  'class',
  'struct',
  'interface',
  'trait',
  'protocol',
  'function',
  'method',
  'enum',
  'type_alias',
  'namespace',
  'route',
  'component',
]);

const DEFAULT_OBSIDIAN_COLLECT_KINDS = [
  'module',
  'class',
  'struct',
  'interface',
  'trait',
  'protocol',
  'function',
  'method',
  'enum',
  'type_alias',
  'namespace',
  'route',
  'component',
  'property',
  'field',
  'constant',
];

const EMBED_ONLY_NODE_KINDS = new Set(['parameter', 'import', 'export']);
const MEMBER_NODE_KINDS = new Set(['property', 'field', 'constant', 'enum_member']);
const LOCAL_NODE_KINDS = new Set(['variable', 'parameter']);
const PLACEHOLDER_FILE_NAMES = new Set(['index', 'page', 'layout', 'route', '__init__', 'mod', 'main']);
const NATIVE_GRAPH_SUMMARY = '\u{1F916} Native Graph Data (For AI Context)';

const getNativeField = (entry = {}, camelKey = '', snakeKey = '') => (
  entry?.[camelKey] ?? (snakeKey ? entry?.[snakeKey] : undefined)
);

const normalizeNativeKind = (value = '', fallback = 'symbol') => (
  readString(value).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || fallback
);

export const sanitizeNotePathSegment = (value, maxLength = 40, fallback = 'node') => {
  let sanitized = readString(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .trim()
    .replace(/^[ .]+/g, '')
    .replace(/[ .]+$/g, '');
  if (Number(maxLength) > 0 && sanitized.length > Number(maxLength)) {
    sanitized = sanitized.slice(0, Number(maxLength)).trim().replace(/^[ .]+/g, '').replace(/[ .]+$/g, '');
  }
  return sanitized || fallback;
};

const shortHash = (value = '', length = 12) => stableHash(value).slice(0, length);

const normalizeFilePath = (file = {}) => readString(file.path || file.filePath || file.relativePath || file.file_path);

export const fileNotePath = (projectSegment, file = {}) => {
  const filePath = typeof file === 'string' ? file : normalizeFilePath(file);
  const normalizedPath = readString(filePath).replace(/\\/g, '/');
  const parts = normalizedPath.split('/').filter(Boolean);
  const basename = parts.pop() || 'file';
  const parent = parts.pop() || '';
  const extensionless = basename.replace(/\.[^.]+$/i, '') || basename;
  const readableName = PLACEHOLDER_FILE_NAMES.has(extensionless.toLowerCase()) && parent
    ? `${parent}-${extensionless}`
    : extensionless;
  const safeName = sanitizeNotePathSegment(readableName, 60, 'file');
  return `Argus/Wiki/${projectSegment}/CodeGraph/Files/${safeName}-${shortHash(normalizedPath || safeName, 10)}.md`;
};

const fileCoverageNotePath = (projectSegment, shardIndex = 1) => (
  `Argus/Wiki/${projectSegment}/CodeGraph/Coverage/Files-${String(shardIndex).padStart(3, '0')}.md`
);

export const nodeNotePath = (projectSegment, node = {}) => {
  const kind = normalizeNativeKind(node.kind, 'symbol');
  const id = readString(node.id || node.nodeId || node.qualifiedName || node.name || kind);
  const safeName = sanitizeNotePathSegment(node.name || node.qualifiedName || id, 40, 'node');
  return `Argus/Wiki/${projectSegment}/CodeGraph/Symbols/${kind}/${safeName}-${shortHash(id, 12)}.md`;
};

const moduleNotePath = (projectSegment, moduleId) => (
  `Argus/Wiki/${projectSegment}/CodeGraph/Modules/${slugify(moduleId, 'module')}.md`
);

const symbolNotePath = (projectSegment, symbolName) => (
  `Argus/Wiki/${projectSegment}/CodeGraph/Symbols/${slugify(symbolName, 'symbol')}.md`
);

const relationshipTargetPath = (projectSegment, target = '') => {
  const clean = readString(target);
  if (!clean) return '';
  if (clean.includes('/') || clean.includes('\\')) {
    return moduleNotePath(projectSegment, clean);
  }
  return symbolNotePath(projectSegment, clean);
};

const buildRelationshipLines = (relationships = [], projectSegment) => {
  const lines = (Array.isArray(relationships) ? relationships : [])
    .map((relationship) => {
      const kind = readString(relationship.kind || relationship.type || 'related');
      const target = readString(relationship.target || relationship.name || relationship.to);
      const targetPath = relationshipTargetPath(projectSegment, target);
      return targetPath ? `- ${kind}: ${noteLink(targetPath, target)}` : '';
    })
    .filter(Boolean);
  return lines.length > 0 ? lines : ['- No direct relationships recorded.'];
};

const normalizeModule = (entry = {}) => {
  const id = readString(entry.id || entry.path || entry.name);
  const name = readString(entry.name || path.posix.basename(id.replace(/\\/g, '/')) || id);
  const hash = readString(entry.hash) || stableHash(JSON.stringify(entry));
  return {
    ...entry,
    id,
    name,
    path: readString(entry.path || id),
    hash,
  };
};

const normalizeSymbol = (entry = {}) => {
  const name = readString(entry.name || entry.id);
  const id = readString(entry.id || name);
  const hash = readString(entry.hash) || stableHash(JSON.stringify(entry));
  return {
    ...entry,
    id,
    name,
    kind: readString(entry.kind || 'symbol'),
    filePath: readString(entry.filePath || entry.path),
    startLine: Number(entry.startLine) || 0,
    endLine: Number(entry.endLine) || 0,
    hash,
  };
};

const buildDocument = ({ path: notePath, properties, title, sections }) => ({
  path: notePath,
  content: [
    formatFrontmatter(properties),
    '',
    `# ${title}`,
    '',
    ...sections,
    '',
  ].join('\n'),
});

export const buildAstSummaryDocuments = ({
  projectName = 'General',
  projectRoot = '',
  packageVersion = '',
  indexedAt = new Date().toISOString(),
  modules = [],
  symbols = [],
} = {}) => {
  const projectSegment = sanitizeVaultSegment(projectName, 'General');
  const projectRootHash = stableHash(projectRoot || projectSegment);
  const normalizedModules = modules.map(normalizeModule).filter((entry) => entry.id);
  const normalizedSymbols = symbols.map(normalizeSymbol).filter((entry) => entry.name);
  const activeEntries = [
    ...normalizedModules.map((entry) => ({
      kind: 'module',
      id: entry.id,
      hash: entry.hash,
      path: moduleNotePath(projectSegment, entry.id),
      label: entry.name,
    })),
    ...normalizedSymbols.map((entry) => ({
      kind: 'symbol',
      id: entry.id,
      hash: entry.hash,
      path: symbolNotePath(projectSegment, entry.name),
      label: entry.name,
    })),
  ];

  const baseProperties = {
    type: 'wiki-note',
    source: 'codegraph',
    project: projectSegment,
    codegraphVersion: packageVersion,
    projectRootHash,
    generatedFrom: '.codegraph/codegraph.db',
    indexedAt,
    updated: indexedAt,
    tags: [AUTO_GEN_TAG, CODEGRAPH_TAG],
    status: 'active',
  };

  const indexPath = `Argus/Wiki/${projectSegment}/CodeGraph/Index.md`;
  const indexContentHash = stableHash(activeEntries.map((entry) => `${entry.kind}:${entry.id}:${entry.hash}`).join('\n'));
  const index = buildDocument({
    path: indexPath,
    title: `${projectSegment} CodeGraph Index`,
    properties: {
      ...baseProperties,
      codegraphKind: 'project-map',
      contentHash: indexContentHash,
      related: activeEntries.slice(0, 20).map((entry) => noteLink(entry.path, entry.label)),
    },
    sections: [
      '## Overview',
      '#argus/auto-gen #argus/codegraph',
      '',
      `- Modules indexed: ${normalizedModules.length}`,
      `- Symbols indexed: ${normalizedSymbols.length}`,
      `- Generated from project root hash: ${projectRootHash}`,
      '',
      '## Active Files',
      ACTIVE_FILES_START,
      ...activeEntries.map((entry) => `- ${noteLink(entry.path, entry.label)} \`${entry.kind}:${entry.id}\` hash:${entry.hash}`),
      ACTIVE_FILES_END,
      '',
      '## Relationships',
      ...activeEntries.slice(0, 20).map((entry) => `- active: ${noteLink(entry.path, entry.label)}`),
    ],
  });

  const moduleDocs = normalizedModules.map((entry) => {
    const notePath = moduleNotePath(projectSegment, entry.id);
    return buildDocument({
      path: notePath,
      title: entry.name,
      properties: {
        ...baseProperties,
        codegraphKind: 'module-map',
        contentHash: entry.hash,
        moduleId: entry.id,
        sourcePath: entry.path,
        related: (entry.relationships || [])
          .map((relationship) => relationshipTargetPath(projectSegment, relationship.target))
          .filter(Boolean)
          .map((targetPath) => noteLink(targetPath)),
      },
      sections: [
        '## Overview',
        '#argus/auto-gen #argus/codegraph',
        '',
        `- Path: \`${entry.path}\``,
        `- Symbols: ${Number(entry.symbolCount) || 0}`,
        '',
        '## Entry Points',
        '- Generated from CodeGraph AST and file metadata.',
        '',
        '## Relationships',
        ...buildRelationshipLines(entry.relationships, projectSegment),
      ],
    });
  });

  const symbolDocs = normalizedSymbols.map((entry) => {
    const notePath = symbolNotePath(projectSegment, entry.name);
    return buildDocument({
      path: notePath,
      title: entry.name,
      properties: {
        ...baseProperties,
        codegraphKind: 'symbol-map',
        contentHash: entry.hash,
        symbolId: entry.id,
        symbolKind: entry.kind,
        sourcePath: entry.filePath,
        related: (entry.relationships || [])
          .map((relationship) => relationshipTargetPath(projectSegment, relationship.target))
          .filter(Boolean)
          .map((targetPath) => noteLink(targetPath)),
      },
      sections: [
        '## Overview',
        '#argus/auto-gen #argus/codegraph',
        '',
        `- Kind: \`${entry.kind}\``,
        `- Location: \`${entry.filePath}${entry.startLine ? `:${entry.startLine}` : ''}\``,
        entry.endLine ? `- End line: ${entry.endLine}` : '',
        '',
        '## Relationships',
        ...buildRelationshipLines(entry.relationships, projectSegment),
      ].filter((line) => line !== ''),
    });
  });

  return [index, ...moduleDocs, ...symbolDocs];
};

const normalizeBoolean = (value) => (
  value === true || value === 1 || String(value || '').toLowerCase() === 'true'
);

const normalizeArrayValue = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
  }
  return [];
};

const normalizeNativeNode = (node = {}) => {
  const id = readString(getNativeField(node, 'id', 'id') || node.nodeId);
  const kind = normalizeNativeKind(getNativeField(node, 'kind', 'kind'), 'symbol');
  const name = readString(getNativeField(node, 'name', 'name') || id || kind);
  const filePath = readString(getNativeField(node, 'filePath', 'file_path') || node.path);
  return {
    raw: node,
    id,
    kind,
    name,
    qualifiedName: readString(getNativeField(node, 'qualifiedName', 'qualified_name')),
    filePath,
    language: readString(getNativeField(node, 'language', 'language')),
    startLine: Number(getNativeField(node, 'startLine', 'start_line')) || 0,
    endLine: Number(getNativeField(node, 'endLine', 'end_line')) || 0,
    startColumn: Number(getNativeField(node, 'startColumn', 'start_column')) || 0,
    endColumn: Number(getNativeField(node, 'endColumn', 'end_column')) || 0,
    docstring: readString(getNativeField(node, 'docstring', 'docstring')),
    signature: readString(getNativeField(node, 'signature', 'signature')),
    visibility: readString(getNativeField(node, 'visibility', 'visibility')),
    isExported: normalizeBoolean(getNativeField(node, 'isExported', 'is_exported')),
    isAsync: normalizeBoolean(getNativeField(node, 'isAsync', 'is_async')),
    isStatic: normalizeBoolean(getNativeField(node, 'isStatic', 'is_static')),
    isAbstract: normalizeBoolean(getNativeField(node, 'isAbstract', 'is_abstract')),
    decorators: normalizeArrayValue(getNativeField(node, 'decorators', 'decorators')),
    typeParameters: normalizeArrayValue(getNativeField(node, 'typeParameters', 'type_parameters')),
  };
};

const normalizeNativeEdge = (edge = {}) => ({
  raw: edge,
  source: readString(edge.source || edge.sourceId || edge.from),
  target: readString(edge.target || edge.targetId || edge.to),
  kind: normalizeNativeKind(edge.kind || edge.type, 'references'),
  metadata: edge.metadata || null,
  line: Number(edge.line) || 0,
  col: Number(edge.col || edge.column) || 0,
  provenance: readString(edge.provenance),
});

const normalizeNativeFile = (file = {}) => {
  const filePath = normalizeFilePath(file);
  return {
    raw: file,
    path: filePath,
    contentHash: readString(getNativeField(file, 'contentHash', 'content_hash') || file.hash),
    language: readString(getNativeField(file, 'language', 'language')),
    size: Number(getNativeField(file, 'size', 'size')) || 0,
    modifiedAt: readString(getNativeField(file, 'modifiedAt', 'modified_at')),
    indexedAt: readString(getNativeField(file, 'indexedAt', 'indexed_at')),
    nodeCount: Number(getNativeField(file, 'nodeCount', 'node_count')) || Number(file.nodes) || 0,
    errors: normalizeArrayValue(getNativeField(file, 'errors', 'errors')),
  };
};

const edgeIdentity = (edge = {}) => [
  edge.source,
  edge.target,
  edge.kind,
  edge.line || 0,
  edge.col || 0,
  edge.provenance || '',
].join('|');

const groupEdgesByNode = (edges = [], field = 'source') => {
  const grouped = new Map();
  for (const edge of edges) {
    const key = readString(edge[field]);
    if (!key) continue;
    const current = grouped.get(key) || [];
    current.push(edge);
    grouped.set(key, current);
  }
  return grouped;
};

const relationListFromMap = (mapLike = {}, key = '') => {
  if (!mapLike) return [];
  if (mapLike instanceof Map) return mapLike.get(key) || [];
  if (Array.isArray(mapLike)) return [];
  return mapLike[key] || [];
};

const nodeLocation = (node = {}) => {
  const range = node.startLine
    ? `${node.filePath || 'unknown'}:${node.startLine}${node.endLine && node.endLine !== node.startLine ? `-${node.endLine}` : ''}`
    : node.filePath || 'unknown';
  return range;
};

const nativeNodePayload = (node = {}) => ({
  id: node.id,
  kind: node.kind,
  name: node.name,
  qualifiedName: node.qualifiedName,
  filePath: node.filePath,
  range: {
    startLine: node.startLine,
    endLine: node.endLine,
    startColumn: node.startColumn,
    endColumn: node.endColumn,
  },
  signature: node.signature,
  docstring: node.docstring,
  modifiers: {
    visibility: node.visibility,
    isExported: node.isExported,
    isAsync: node.isAsync,
    isStatic: node.isStatic,
    isAbstract: node.isAbstract,
    decorators: node.decorators,
    typeParameters: node.typeParameters,
  },
});

const nativeFilePayload = (file = {}) => ({
  path: file.path,
  contentHash: file.contentHash,
  language: file.language,
  size: file.size,
  modifiedAt: file.modifiedAt,
  indexedAt: file.indexedAt,
  nodeCount: file.nodeCount,
  errors: file.errors,
});

const hasGraphEdges = (node = {}, incoming = [], outgoing = []) => (
  [...incoming, ...outgoing].some((edge) => edge.kind !== 'contains')
);

const isPublicOrExported = (node = {}) => {
  const visibility = readString(node.visibility).toLowerCase();
  return node.isExported === true || node.isStatic === true || visibility === 'public';
};

const shouldExportNativeNode = (node = {}, { exportLevel = 'structural', incoming = [], outgoing = [] } = {}) => {
  if (!node.id || node.kind === 'file') return false;
  if (EMBED_ONLY_NODE_KINDS.has(node.kind)) return false;
  if (exportLevel === 'all') return true;
  if (STRUCTURAL_NODE_KINDS.has(node.kind)) return true;
  if (['property', 'field', 'constant', 'variable'].includes(node.kind)) {
    return isPublicOrExported(node) || hasGraphEdges(node, incoming, outgoing);
  }
  return false;
};

const sortNodesForDisplay = (nodes = []) => [...nodes].sort((left, right) => (
  (left.filePath || '').localeCompare(right.filePath || '')
  || (left.startLine || 0) - (right.startLine || 0)
  || (left.name || '').localeCompare(right.name || '')
  || (left.id || '').localeCompare(right.id || '')
));

const sortEdgesForDisplay = (edges = []) => [...edges].sort((left, right) => (
  (left.kind || '').localeCompare(right.kind || '')
  || (left.line || 0) - (right.line || 0)
  || (left.source || '').localeCompare(right.source || '')
  || (left.target || '').localeCompare(right.target || '')
));

const renderNodeReference = (nodeId = '', { nodesById, pathByNodeId } = {}) => {
  const node = nodesById.get(nodeId);
  const notePath = pathByNodeId.get(nodeId);
  if (notePath) return `${noteLink(notePath)} \`${nodeId}\``;
  if (node) return `\`${node.kind}:${node.name}\` \`${nodeId}\``;
  return `\`${nodeId}\``;
};

const renderEmbeddedSymbols = (nodes = [], {
  maxEmbeddedSymbols = DEFAULT_SETTINGS.codegraphMaxEmbeddedSymbols,
  nodesById = new Map(),
  pathByNodeId = new Map(),
} = {}) => {
  const sorted = sortNodesForDisplay(nodes);
  if (sorted.length === 0) return ['- None recorded.'];
  const limit = Math.max(1, Math.min(Number(maxEmbeddedSymbols) || DEFAULT_SETTINGS.codegraphMaxEmbeddedSymbols, 1000));
  const visible = sorted.slice(0, limit);
  const lines = visible.map((node) => {
    const identity = node.id ? ` \`${node.id}\`` : '';
    const location = node.startLine ? ` at \`${nodeLocation(node)}\`` : '';
    const link = pathByNodeId.has(node.id) ? `${noteLink(pathByNodeId.get(node.id))} ` : '';
    const qualified = node.qualifiedName && node.qualifiedName !== node.name ? ` (${node.qualifiedName})` : '';
    return `- ${link}\`${node.kind}\` ${node.name}${qualified}${location}${identity}`;
  });
  if (sorted.length > visible.length) {
    lines.push(`- *...and ${sorted.length - visible.length} more internal symbols omitted. Use CodeGraph MCP search for detailed internal scopes.*`);
  }
  return lines;
};

const renderNodeList = (nodeIds = [], context = {}) => {
  const uniqueIds = [...new Set(nodeIds.filter(Boolean))];
  if (uniqueIds.length === 0) return ['- None recorded.'];
  return uniqueIds.map((nodeId) => `- ${renderNodeReference(nodeId, context)}`);
};

const renderEdgeGroups = (edges = [], direction = 'outgoing', context = {}) => {
  const sorted = sortEdgesForDisplay(edges);
  if (sorted.length === 0) return ['- None recorded.'];
  const groups = new Map();
  for (const edge of sorted) {
    const current = groups.get(edge.kind) || [];
    current.push(edge);
    groups.set(edge.kind, current);
  }
  const lines = [];
  for (const [kind, group] of groups.entries()) {
    lines.push(`### ${kind}`);
    for (const edge of group) {
      const otherId = direction === 'incoming' ? edge.source : edge.target;
      const line = edge.line ? ` line ${edge.line}` : '';
      const col = edge.col ? ` col ${edge.col}` : '';
      const provenance = edge.provenance ? ` provenance ${edge.provenance}` : '';
      lines.push(`- ${renderNodeReference(otherId, context)}${line}${col}${provenance}`);
    }
    lines.push('');
  }
  return lines.filter((line, index, all) => line || all[index + 1]);
};

const renderFileLinks = (filePaths = [], filePathByPath = new Map()) => {
  const uniquePaths = [...new Set((Array.isArray(filePaths) ? filePaths : []).map(readString).filter(Boolean))];
  if (uniquePaths.length === 0) return ['- None recorded.'];
  return uniquePaths.map((filePath) => {
    const notePath = filePathByPath.get(filePath);
    return notePath ? `- ${noteLink(notePath)} \`${filePath}\`` : `- \`${filePath}\``;
  });
};

const parseNoteDocumentHash = (note = {}) => {
  const direct = readString(note.documentHash || note.properties?.documentHash || note.properties?.document_hash);
  if (direct) return direct.replace(/^['"]|['"]$/g, '');
  const match = String(note.content || '').match(/^\s*documentHash:\s*("?)([^"\n\r]+)\1\s*$/im);
  return match ? readString(match[2]) : '';
};

const buildExistingNoteHashMap = (notes = []) => {
  const hashes = new Map();
  for (const note of Array.isArray(notes) ? notes : []) {
    const notePath = readString(note.path);
    const documentHash = parseNoteDocumentHash(note);
    if (notePath && documentHash) hashes.set(notePath.toLowerCase(), documentHash);
  }
  return hashes;
};

export const buildCodeGraphNativeDocuments = ({
  projectName = 'General',
  projectRoot = '',
  packageVersion = '',
  indexedAt = new Date().toISOString(),
  files = [],
  nodes = [],
  edges = [],
  fileDependencies = {},
  fileDependents = {},
  exportLevel = DEFAULT_SETTINGS.codegraphExportLevel,
  maxEmbeddedSymbols = DEFAULT_SETTINGS.codegraphMaxEmbeddedSymbols,
} = {}) => {
  const projectSegment = sanitizeVaultSegment(projectName, 'General');
  const projectRootHash = stableHash(projectRoot || projectSegment);
  const normalizedNodes = (Array.isArray(nodes) ? nodes : [])
    .map(normalizeNativeNode)
    .filter((node) => node.id && node.name);
  const nodesById = new Map(normalizedNodes.map((node) => [node.id, node]));
  const dedupedEdges = new Map();
  for (const edge of (Array.isArray(edges) ? edges : []).map(normalizeNativeEdge)) {
    if (!edge.source || !edge.target) continue;
    dedupedEdges.set(edgeIdentity(edge), edge);
  }
  const normalizedEdges = [...dedupedEdges.values()];
  const incomingByNodeId = groupEdgesByNode(normalizedEdges, 'target');
  const outgoingByNodeId = groupEdgesByNode(normalizedEdges, 'source');
  const containsParentByNodeId = new Map();
  const containsChildrenByNodeId = new Map();
  for (const edge of normalizedEdges.filter((entry) => entry.kind === 'contains')) {
    containsParentByNodeId.set(edge.target, edge.source);
    const children = containsChildrenByNodeId.get(edge.source) || [];
    children.push(edge.target);
    containsChildrenByNodeId.set(edge.source, children);
  }

  const filesByPath = new Map();
  for (const file of (Array.isArray(files) ? files : []).map(normalizeNativeFile)) {
    if (file.path) filesByPath.set(file.path, file);
  }
  for (const node of normalizedNodes) {
    if (node.filePath && !filesByPath.has(node.filePath)) {
      filesByPath.set(node.filePath, normalizeNativeFile({ path: node.filePath }));
    }
  }
  const normalizedFiles = [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  const filePathByPath = new Map(normalizedFiles.map((file) => [file.path, fileNotePath(projectSegment, file)]));

  const exportCandidateIds = new Set();
  for (const node of normalizedNodes) {
    if (shouldExportNativeNode(node, {
      exportLevel,
      incoming: incomingByNodeId.get(node.id) || [],
      outgoing: outgoingByNodeId.get(node.id) || [],
    })) {
      exportCandidateIds.add(node.id);
    }
  }
  const exportedNodes = sortNodesForDisplay(normalizedNodes.filter((node) => exportCandidateIds.has(node.id)));
  const exportedNodeIds = new Set(exportedNodes.map((node) => node.id));
  const pathByNodeId = new Map();
  for (const node of exportedNodes) {
    pathByNodeId.set(node.id, nodeNotePath(projectSegment, node));
  }
  const context = { nodesById, pathByNodeId };

  const findNearestExportedAncestor = (nodeId = '') => {
    const seen = new Set();
    let current = containsParentByNodeId.get(nodeId);
    while (current && !seen.has(current)) {
      if (exportedNodeIds.has(current)) return current;
      seen.add(current);
      current = containsParentByNodeId.get(current);
    }
    return '';
  };

  const embeddedByNodeId = new Map();
  const embeddedByFilePath = new Map();
  for (const node of normalizedNodes) {
    if (exportedNodeIds.has(node.id)) continue;
    const parentId = findNearestExportedAncestor(node.id);
    if (parentId) {
      const current = embeddedByNodeId.get(parentId) || [];
      current.push(node);
      embeddedByNodeId.set(parentId, current);
      continue;
    }
    if (node.filePath) {
      const current = embeddedByFilePath.get(node.filePath) || [];
      current.push(node);
      embeddedByFilePath.set(node.filePath, current);
    }
  }

  const baseProperties = {
    type: 'wiki-note',
    source: 'codegraph',
    project: projectSegment,
    codegraphVersion: packageVersion,
    projectRootHash,
    generatedFrom: '.codegraph/codegraph.db',
    indexedAt,
    updated: indexedAt,
    exportLevel,
    tags: [AUTO_GEN_TAG, CODEGRAPH_TAG],
    status: 'active',
  };

  const symbolDocuments = exportedNodes
    .map((node) => {
      const notePath = pathByNodeId.get(node.id);
      const incoming = incomingByNodeId.get(node.id) || [];
      const outgoing = outgoingByNodeId.get(node.id) || [];
      const childIds = containsChildrenByNodeId.get(node.id) || [];
      const exportedChildren = childIds.filter((childId) => exportedNodeIds.has(childId));
      const parentId = containsParentByNodeId.get(node.id) || '';
      const embedded = embeddedByNodeId.get(node.id) || [];
      const members = embedded.filter((entry) => MEMBER_NODE_KINDS.has(entry.kind));
      const locals = embedded.filter((entry) => LOCAL_NODE_KINDS.has(entry.kind));
      const otherEmbedded = embedded.filter((entry) => !MEMBER_NODE_KINDS.has(entry.kind) && !LOCAL_NODE_KINDS.has(entry.kind));
      const callers = incoming.filter((edge) => edge.kind === 'calls').map((edge) => edge.source);
      const callees = outgoing.filter((edge) => edge.kind === 'calls').map((edge) => edge.target);
      const visibleIncoming = incoming.filter((edge) => !(edge.kind === 'contains' && !exportedNodeIds.has(edge.source)));
      const visibleOutgoing = outgoing.filter((edge) => !(edge.kind === 'contains' && !exportedNodeIds.has(edge.target)));
      const nativeEmbeddedLimit = Math.max(1, Math.min(Number(maxEmbeddedSymbols) || DEFAULT_SETTINGS.codegraphMaxEmbeddedSymbols, 1000));
      const visibleEmbeddedForNative = sortNodesForDisplay(embedded).slice(0, nativeEmbeddedLimit);
      const fileNote = node.filePath ? filePathByPath.get(node.filePath) : '';
      const siblingIds = node.filePath
        ? normalizedNodes
          .filter((entry) => entry.id !== node.id && entry.filePath === node.filePath && exportedNodeIds.has(entry.id))
          .slice(0, 12)
          .map((entry) => entry.id)
        : [];
      const documentHash = stableHash(stableStringify({
        node: nativeNodePayload(node),
        incoming,
        outgoing,
        parentId,
        childIds,
        embedded: embedded.map(nativeNodePayload),
        siblingIds,
      }));
      const sections = [
        '## Native Node',
        `- ID: \`${node.id}\``,
        `- Kind: \`${node.kind}\``,
        `- Name: ${node.name}`,
        node.qualifiedName ? `- Qualified name: \`${node.qualifiedName}\`` : '',
        `- Location: \`${nodeLocation(node)}\``,
        node.signature ? `- Signature: \`${node.signature}\`` : '',
        node.docstring ? `- Docstring: ${node.docstring}` : '',
        `- Visibility: \`${node.visibility || 'unknown'}\``,
        `- Exported: ${node.isExported ? 'true' : 'false'}`,
        node.isStatic ? '- Static: true' : '',
        node.isAsync ? '- Async: true' : '',
        node.isAbstract ? '- Abstract: true' : '',
        node.decorators.length ? `- Decorators: ${node.decorators.map((entry) => `\`${entry}\``).join(', ')}` : '',
        '',
        '## File Context',
        fileNote ? `- File note: ${noteLink(fileNote)} \`${node.filePath}\`` : `- File: \`${node.filePath || 'unknown'}\``,
        '- Same-file structural nodes:',
        ...renderNodeList(siblingIds, context),
        '',
        '## Containment',
        `- Parent: ${parentId ? renderNodeReference(parentId, context) : 'None recorded.'}`,
        '- Children:',
        ...renderNodeList(exportedChildren, context),
        '',
        '## Members',
        ...renderEmbeddedSymbols(members, { maxEmbeddedSymbols, ...context }),
        '',
        '## Local Symbols',
        ...renderEmbeddedSymbols(locals, { maxEmbeddedSymbols, ...context }),
        '',
        '## Embedded Local Symbols',
        ...renderEmbeddedSymbols(otherEmbedded, { maxEmbeddedSymbols, ...context }),
        '',
        '## Call Relationships',
        '### Callers',
        ...renderNodeList(callers, context),
        '',
        '### Callees',
        ...renderNodeList(callees, context),
        '',
        '## Incoming Edges',
        ...renderEdgeGroups(visibleIncoming, 'incoming', context),
        '',
        '## Outgoing Edges',
        ...renderEdgeGroups(visibleOutgoing, 'outgoing', context),
        '',
        '## Native Graph Data',
        '<details>',
        `<summary>${NATIVE_GRAPH_SUMMARY}</summary>`,
        '',
        '```json',
        JSON.stringify({
          node: nativeNodePayload(node),
          incomingEdges: visibleIncoming,
          outgoingEdges: visibleOutgoing,
          parentId,
          childIds: exportedChildren,
          embeddedSymbols: visibleEmbeddedForNative.map(nativeNodePayload),
          embeddedSymbolsOmitted: Math.max(0, embedded.length - visibleEmbeddedForNative.length),
        }, null, 2),
        '```',
        '',
        '</details>',
      ].filter((line) => line !== '');
      return {
        ...buildDocument({
          path: notePath,
          title: node.name,
          properties: {
            ...baseProperties,
            codegraphKind: 'native-symbol',
            documentHash,
            nodeId: node.id,
            symbolId: node.id,
            symbolKind: node.kind,
            sourcePath: node.filePath,
            related: [
              parentId ? pathByNodeId.get(parentId) : '',
              ...exportedChildren.map((childId) => pathByNodeId.get(childId)),
              ...incoming.map((edge) => pathByNodeId.get(edge.source)),
              ...outgoing.map((edge) => pathByNodeId.get(edge.target)),
            ].filter(Boolean).slice(0, 30).map((targetPath) => noteLink(targetPath)),
          },
          sections,
        }),
        documentHash,
        legacyPaths: [symbolNotePath(projectSegment, node.name)],
      };
    });

  const exportedFilePaths = new Set(exportedNodes.map((node) => node.filePath).filter(Boolean));
  const filesForExport = normalizedFiles
    .filter((file) => exportedFilePaths.has(file.path));
  const fileDocuments = filesForExport.map((file) => {
    const notePath = filePathByPath.get(file.path);
    const structuralNodes = sortNodesForDisplay(exportedNodes.filter((node) => (
      node.filePath === file.path && exportedNodeIds.has(node.id)
    )));
    const embedded = embeddedByFilePath.get(file.path) || [];
    const dependencies = relationListFromMap(fileDependencies, file.path);
    const dependents = relationListFromMap(fileDependents, file.path);
    const documentHash = stableHash(stableStringify({
      file: nativeFilePayload(file),
      structuralNodeIds: structuralNodes.map((node) => node.id),
      embedded: embedded.map(nativeNodePayload),
      dependencies,
      dependents,
    }));
    const sections = [
      '## Native File',
      `- Path: \`${file.path}\``,
      file.language ? `- Language: \`${file.language}\`` : '',
      file.contentHash ? `- Content hash: \`${file.contentHash}\`` : '',
      file.size ? `- Size: ${file.size}` : '',
      file.modifiedAt ? `- Modified: ${file.modifiedAt}` : '',
      file.indexedAt ? `- Indexed: ${file.indexedAt}` : '',
      `- Node count: ${file.nodeCount || structuralNodes.length + embedded.length}`,
      '',
      '## Structural Symbols',
      ...renderNodeList(structuralNodes.map((node) => node.id), context),
      '',
      '## Embedded Local Symbols',
      ...renderEmbeddedSymbols(embedded, { maxEmbeddedSymbols, ...context }),
      '',
      '## File Dependencies',
      ...renderFileLinks(dependencies, filePathByPath),
      '',
      '## File Dependents',
      ...renderFileLinks(dependents, filePathByPath),
      '',
      '## Native Graph Data',
      '<details>',
      `<summary>${NATIVE_GRAPH_SUMMARY}</summary>`,
      '',
      '```json',
      JSON.stringify({
        file: nativeFilePayload(file),
        structuralNodeIds: structuralNodes.map((node) => node.id),
        embeddedSymbols: embedded.map(nativeNodePayload),
        dependencies,
        dependents,
      }, null, 2),
      '```',
      '',
      '</details>',
    ].filter((line) => line !== '');
    return {
      ...buildDocument({
        path: notePath,
        title: file.path.split(/[\\/]/).pop() || file.path,
        properties: {
          ...baseProperties,
          codegraphKind: 'native-file',
          documentHash,
          filePath: file.path,
          related: structuralNodes.map((node) => pathByNodeId.get(node.id)).filter(Boolean).slice(0, 30).map((targetPath) => noteLink(targetPath)),
        },
        sections,
      }),
      documentHash,
      legacyPaths: [],
    };
  });

  const exportedFileNotePaths = new Set(fileDocuments.map((document) => document.path));
  const coverageDocuments = [];
  const coverageShardSize = DEFAULT_CODEGRAPH_COVERAGE_SHARD_SIZE;
  for (let index = 0; index < normalizedFiles.length; index += coverageShardSize) {
    const shardFiles = normalizedFiles.slice(index, index + coverageShardSize);
    const shardIndex = Math.floor(index / coverageShardSize) + 1;
    const notePath = fileCoverageNotePath(projectSegment, shardIndex);
    const documentHash = stableHash(stableStringify({
      shardIndex,
      totalFiles: normalizedFiles.length,
      files: shardFiles.map(nativeFilePayload),
    }));
    const sections = [
      '## File Coverage',
      `- Raw files indexed: ${normalizedFiles.length}`,
      `- Shard: ${shardIndex} of ${Math.max(1, Math.ceil(normalizedFiles.length / coverageShardSize))}`,
      `- Files in this shard: ${shardFiles.length}`,
      '- CodeGraph sync checks the full project. Rich File/Symbol notes are intentionally capped to keep Obsidian fast.',
      '',
      '## Files',
      ...shardFiles.map((file) => {
        const richFileNote = filePathByPath.get(file.path);
        const label = exportedFileNotePaths.has(richFileNote) ? `${noteLink(richFileNote)} ` : '';
        const language = file.language ? ` language:${file.language}` : '';
        const hash = file.contentHash ? ` hash:${file.contentHash}` : '';
        const nodes = file.nodeCount ? ` nodes:${file.nodeCount}` : '';
        return `- ${label}\`${file.path}\`${language}${nodes}${hash}`;
      }),
      '',
      '## Native Graph Data',
      '<details>',
      `<summary>${NATIVE_GRAPH_SUMMARY}</summary>`,
      '',
      '```json',
      JSON.stringify({
        shardIndex,
        totalFiles: normalizedFiles.length,
        files: shardFiles.map(nativeFilePayload),
      }, null, 2),
      '```',
      '',
      '</details>',
    ];
    coverageDocuments.push({
      ...buildDocument({
        path: notePath,
        title: `${projectSegment} CodeGraph File Coverage ${shardIndex}`,
        properties: {
          ...baseProperties,
          codegraphKind: 'native-file-coverage',
          documentHash,
          shardIndex,
          totalFiles: normalizedFiles.length,
          related: shardFiles
            .map((file) => filePathByPath.get(file.path))
            .filter((notePathForFile) => exportedFileNotePaths.has(notePathForFile))
            .slice(0, 30)
            .map((targetPath) => noteLink(targetPath)),
        },
        sections,
      }),
      documentHash,
      legacyPaths: [],
    });
  }

  const activeEntries = [
    ...coverageDocuments.map((document) => ({
      kind: 'coverage',
      id: document.path,
      path: document.path,
      hash: document.documentHash,
    })),
    ...fileDocuments.map((document) => ({
      kind: 'file',
      id: document.path,
      path: document.path,
      hash: document.documentHash,
    })),
    ...symbolDocuments.map((document) => ({
      kind: 'symbol',
      id: document.path,
      path: document.path,
      hash: document.documentHash,
    })),
  ];
  const indexPath = `Argus/Wiki/${projectSegment}/CodeGraph/Index.md`;
  const indexDocumentHash = stableHash(stableStringify({
    activeEntries: activeEntries.map((entry) => [entry.kind, entry.path, entry.hash]),
    exportLevel,
    maxEmbeddedSymbols,
    rawFileCount: normalizedFiles.length,
  }));
  const manifestEntries = activeEntries.slice(0, 500);
  const index = {
    ...buildDocument({
      path: indexPath,
      title: `${projectSegment} CodeGraph Native Index`,
      properties: {
        ...baseProperties,
        codegraphKind: 'native-index',
        documentHash: indexDocumentHash,
        related: activeEntries.slice(0, 30).map((entry) => noteLink(entry.path)),
      },
      sections: [
        '## Overview',
        '#argus/auto-gen #argus/codegraph',
        '',
        `- Raw files indexed: ${normalizedFiles.length}`,
        `- File coverage shards: ${coverageDocuments.length}`,
        `- Native files: ${fileDocuments.length}`,
        `- Native symbol notes: ${symbolDocuments.length}`,
        `- Raw nodes considered: ${normalizedNodes.length}`,
        `- Raw edges considered: ${normalizedEdges.length}`,
        `- Export level: \`${exportLevel}\``,
        `- Max embedded symbols per note: ${maxEmbeddedSymbols}`,
        `- Generated from project root hash: ${projectRootHash}`,
        '',
        '## Active Native Notes',
        ACTIVE_FILES_START,
        ...manifestEntries.map((entry) => `- ${noteLink(entry.path)} \`${entry.kind}\` hash:${entry.hash}`),
        activeEntries.length > manifestEntries.length
          ? `- ...and ${activeEntries.length - manifestEntries.length} more active notes omitted from Index. Use CodeGraph MCP or export metadata for the full set.`
          : '',
        ACTIVE_FILES_END,
        '',
        '## Relationships',
        ...activeEntries.slice(0, 30).map((entry) => `- active: ${noteLink(entry.path)}`),
      ].filter((line) => line !== ''),
    }),
    documentHash: indexDocumentHash,
    legacyPaths: [`Argus/Wiki/${projectSegment}/CodeGraph/Index.md`],
  };

  return [index, ...coverageDocuments, ...fileDocuments, ...symbolDocuments];
};

const isNativeIndexDocument = (document = {}) => (
  readString(document.path).endsWith('/CodeGraph/Index.md')
);

const isNativeCoverageDocument = (document = {}) => (
  readString(document.path).includes('/CodeGraph/Coverage/')
);

const documentKindFromPath = (documentPath = '') => {
  const normalized = readString(documentPath);
  if (normalized.includes('/CodeGraph/Files/')) return 'file';
  if (normalized.includes('/CodeGraph/Symbols/')) return 'symbol';
  if (normalized.includes('/CodeGraph/Coverage/')) return 'coverage';
  if (normalized.endsWith('/CodeGraph/Index.md')) return 'index';
  return 'note';
};

const buildStreamingCodeGraphIndexDocument = ({
  projectName = 'General',
  projectRoot = '',
  packageVersion = '',
  indexedAt = new Date().toISOString(),
  exportLevel = DEFAULT_SETTINGS.codegraphExportLevel,
  maxEmbeddedSymbols = DEFAULT_SETTINGS.codegraphMaxEmbeddedSymbols,
  activeEntries = [],
  rawFileCount = 0,
  processedFileCount = 0,
  stats = null,
} = {}) => {
  const projectSegment = sanitizeVaultSegment(projectName, 'General');
  const projectRootHash = stableHash(projectRoot || projectSegment);
  const normalizedEntries = (Array.isArray(activeEntries) ? activeEntries : [])
    .filter((entry) => entry?.path)
    .map((entry) => ({
      kind: readString(entry.kind) || documentKindFromPath(entry.path),
      path: readString(entry.path),
      hash: readString(entry.hash),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const indexPath = `Argus/Wiki/${projectSegment}/CodeGraph/Index.md`;
  const indexDocumentHash = stableHash(stableStringify({
    activeEntries: normalizedEntries.map((entry) => [entry.kind, entry.path, entry.hash]),
    exportLevel,
    maxEmbeddedSymbols,
    rawFileCount,
    processedFileCount,
    stats,
  }));
  const manifestEntries = normalizedEntries.slice(0, 500);
  return {
    ...buildDocument({
      path: indexPath,
      title: `${projectSegment} CodeGraph Native Index`,
      properties: {
        type: 'wiki-note',
        source: 'codegraph',
        project: projectSegment,
        codegraphVersion: packageVersion,
        projectRootHash,
        generatedFrom: '.codegraph/codegraph.db',
        indexedAt,
        updated: indexedAt,
        exportLevel,
        tags: [AUTO_GEN_TAG, CODEGRAPH_TAG],
        status: 'active',
        codegraphKind: 'native-index',
        documentHash: indexDocumentHash,
        related: normalizedEntries.slice(0, 30).map((entry) => noteLink(entry.path)),
      },
      sections: [
        '## Overview',
        '#argus/auto-gen #argus/codegraph',
        '',
        `- Raw files indexed: ${rawFileCount}`,
        `- Files processed in this export: ${processedFileCount}`,
        `- Active native notes: ${normalizedEntries.length}`,
        `- Native files: ${normalizedEntries.filter((entry) => entry.kind === 'file').length}`,
        `- Native symbol notes: ${normalizedEntries.filter((entry) => entry.kind === 'symbol').length}`,
        `- Export level: \`${exportLevel}\``,
        `- Max embedded symbols per note: ${maxEmbeddedSymbols}`,
        `- Generated from project root hash: ${projectRootHash}`,
        '',
        '## Active Native Notes',
        ACTIVE_FILES_START,
        ...manifestEntries.map((entry) => `- ${noteLink(entry.path)} \`${entry.kind}\` hash:${entry.hash}`),
        normalizedEntries.length > manifestEntries.length
          ? `- ...and ${normalizedEntries.length - manifestEntries.length} more active notes omitted from Index. Use CodeGraph MCP for the full graph.`
          : '',
        ACTIVE_FILES_END,
        '',
        '## Relationships',
        ...normalizedEntries.slice(0, 30).map((entry) => `- active: ${noteLink(entry.path)}`),
      ].filter((line) => line !== ''),
    }),
    documentHash: indexDocumentHash,
    legacyPaths: [indexPath],
  };
};

const upsertCodeGraphDocumentIfChanged = async ({
  document,
  existingHashes,
  upsertMarkdown,
  logger,
} = {}) => {
  if (!document?.path) {
    return { action: 'skip_invalid' };
  }
  if (document.documentHash && existingHashes?.get(document.path.toLowerCase()) === document.documentHash) {
    return { action: 'skip_unchanged' };
  }
  await upsertMarkdown({
    path: document.path,
    content: document.content,
    kind: documentKindFromPath(document.path) === 'index' ? 'codegraph-index' : 'codegraph',
    title: path.posix.basename(document.path).replace(/\.md$/i, ''),
  }, { logger });
  return { action: 'written' };
};

export const exportCodeGraphSummariesToObsidianStreaming = async ({
  projectName = 'General',
  projectRoot = '',
  exportLevel = '',
  maxEmbeddedSymbols = 0,
  scopePaths = [],
  upsertMarkdown = upsertObsidianMarkdownFile,
  queryNotes = queryObsidianNotes,
  codeGraphPackage = null,
  openGraph = openOrInitCodeGraphProject,
  logger = console,
  onProgress = null,
} = {}) => {
  const startedAt = Date.now();
  const indexedAt = new Date().toISOString();
  const root = readString(projectRoot);
  if (!root) throw new Error('projectRoot is required.');
  const config = readObsidianBridgeConfig();
  const effectiveExportLevel = ['structural', 'all'].includes(exportLevel)
    ? exportLevel
    : config.codegraphExportLevel || DEFAULT_SETTINGS.codegraphExportLevel;
  const effectiveMaxEmbeddedSymbols = Number(maxEmbeddedSymbols) > 0
    ? Number(maxEmbeddedSymbols)
    : config.codegraphMaxEmbeddedSymbols || DEFAULT_SETTINGS.codegraphMaxEmbeddedSymbols;
  const normalizedScopes = normalizeCodeGraphScopePaths(root, scopePaths);
  const scope = createCodeGraphScopeMatcher(root, normalizedScopes);
  const projectSegment = sanitizeVaultSegment(projectName, 'General');
  const { CodeGraph, mod } = codeGraphPackage || await loadCodeGraphPackage();
  const bridgeConfig = readObsidianBridgeConfig();
  const cg = await openGraph(CodeGraph, root, {
    indexOnInit: false,
    config: bridgeConfig,
    scopePaths: normalizedScopes,
  });

  const report = (event) => {
    if (typeof onProgress === 'function') onProgress(event);
  };

  logCodeGraphObsidian(logger, 'stream_export_start', {
    projectName,
    projectRoot: root,
    exportLevel: effectiveExportLevel,
    maxEmbeddedSymbols: effectiveMaxEmbeddedSymbols,
    scopeCount: normalizedScopes.length,
  });

  try {
    report({
      stage: 'export',
      percent: 55,
      label: 'Loading existing CodeGraph notes before streaming export',
    });
    const existingQueryStartedAt = Date.now();
    const existingResult = await queryNotes({
      query: '',
      projectName: projectSegment,
      folders: [`Argus/Wiki/${projectSegment}/CodeGraph`],
      filters: [{ field: 'tags', op: 'contains', value: AUTO_GEN_TAG }],
      sourceTypes: ['markdown'],
      limit: 10000,
    }, { logger }).catch((error) => {
      logCodeGraphObsidian(logger, 'existing_notes_query_failed', {
        projectName,
        projectRoot: root,
        message: error?.message || String(error),
        durationMs: Date.now() - existingQueryStartedAt,
      }, 'warn');
      return { results: [] };
    });
    const existingNotes = Array.isArray(existingResult?.results) ? existingResult.results : [];
    const existingHashes = buildExistingNoteHashMap(existingNotes);
    logCodeGraphObsidian(logger, 'existing_notes_loaded', {
      projectName,
      projectRoot: root,
      existingNoteCount: existingNotes.length,
      durationMs: Date.now() - existingQueryStartedAt,
    });

    report({
      stage: 'export',
      percent: 58,
      label: 'Reading CodeGraph file list for streaming export',
    });
    await yieldToEventLoopDefault();

    let files = [];
    if (typeof cg.getFiles === 'function') {
      files = (cg.getFiles() || [])
        .map(normalizeNativeFile)
        .filter((file) => file.path && (!scope.hasScope || scope.matches(file.path)));
    }
    if (scope.hasScope) {
      for (const filePath of scope.exactFileRelativePaths) {
        if (!files.some((file) => file.path === filePath)) files.push(normalizeNativeFile({ path: filePath }));
      }
    }
    files = files.sort((left, right) => left.path.localeCompare(right.path));
    const totalFiles = files.length;
    let processedFiles = 0;
    let documents = 0;
    let written = 0;
    let skippedUnchanged = 0;
    const activeEntriesByPath = new Map();
    const replacementsByPath = {};

    const rememberDocument = (document) => {
      if (!document?.path || isNativeIndexDocument(document) || isNativeCoverageDocument(document)) return;
      activeEntriesByPath.set(document.path, {
        kind: documentKindFromPath(document.path),
        path: document.path,
        hash: document.documentHash || '',
      });
      for (const legacyPath of document.legacyPaths || []) {
        if (legacyPath && legacyPath !== document.path) replacementsByPath[legacyPath] = document.path;
      }
    };

    for (const file of files) {
      processedFiles += 1;
      if (processedFiles === 1 || processedFiles === totalFiles || processedFiles % CODEGRAPH_STREAM_PROGRESS_EVERY === 0) {
        report({
          stage: 'export',
          percent: Math.min(95, 58 + Math.floor((processedFiles / Math.max(1, totalFiles)) * 37)),
          label: `Writing CodeGraph notes to Obsidian ${processedFiles}/${totalFiles}`,
        });
        logCodeGraphObsidian(logger, 'stream_file_progress', {
          projectName,
          projectRoot: root,
          processedFiles,
          totalFiles,
          documents,
          written,
          skippedUnchanged,
          filePath: file.path,
        });
      }
      if (processedFiles % CODEGRAPH_STREAM_FILE_YIELD_EVERY === 0) {
        await yieldToEventLoopDefault();
      }

      let fileNodes = [];
      try {
        fileNodes = typeof cg.getNodesInFile === 'function' ? cg.getNodesInFile(file.path) || [] : [];
      } catch {
        fileNodes = [];
      }
      const normalizedNodes = fileNodes
        .map(normalizeNativeNode)
        .filter((node) => node.id && node.name && (!scope.hasScope || scope.matches(node.filePath || file.path)));
      if (normalizedNodes.length === 0) {
        continue;
      }
      const exportedCandidateNodes = normalizedNodes.filter((node) => (
        effectiveExportLevel === 'all'
        || STRUCTURAL_NODE_KINDS.has(node.kind)
        || isPublicOrExported(node)
      ));
      const edgeMap = new Map();
      const addEdges = (items = []) => {
        let count = 0;
        for (const edge of Array.isArray(items) ? items : []) {
          if (count >= MAX_NATIVE_EDGES_PER_NODE) break;
          count += 1;
          const normalized = normalizeNativeEdge(edge);
          if (normalized.source && normalized.target) edgeMap.set(edgeIdentity(normalized), normalized);
        }
      };
      for (const node of exportedCandidateNodes) {
        try {
          addEdges(typeof cg.getIncomingEdges === 'function' ? cg.getIncomingEdges(node.id) : []);
        } catch {
          // Relationship helpers are best-effort during streaming export.
        }
        try {
          addEdges(typeof cg.getOutgoingEdges === 'function' ? cg.getOutgoingEdges(node.id) : []);
        } catch {
          // Relationship helpers are best-effort during streaming export.
        }
      }

      const fileDependencies = {};
      const fileDependents = {};
      try {
        fileDependencies[file.path] = typeof cg.getFileDependencies === 'function' ? cg.getFileDependencies(file.path) : [];
      } catch {
        fileDependencies[file.path] = [];
      }
      try {
        fileDependents[file.path] = typeof cg.getFileDependents === 'function' ? cg.getFileDependents(file.path) : [];
      } catch {
        fileDependents[file.path] = [];
      }

      const batchDocuments = buildCodeGraphNativeDocuments({
        projectName,
        projectRoot: root,
        packageVersion: mod?.version || '',
        indexedAt,
        files: [file],
        nodes: normalizedNodes,
        edges: [...edgeMap.values()],
        fileDependencies,
        fileDependents,
        exportLevel: effectiveExportLevel,
        maxEmbeddedSymbols: effectiveMaxEmbeddedSymbols,
      }).filter((document) => !isNativeIndexDocument(document) && !isNativeCoverageDocument(document));

      for (const document of batchDocuments) {
        documents += 1;
        rememberDocument(document);
        const result = await upsertCodeGraphDocumentIfChanged({
          document,
          existingHashes,
          upsertMarkdown,
          logger,
        });
        if (result.action === 'written') {
          written += 1;
        } else if (result.action === 'skip_unchanged') {
          skippedUnchanged += 1;
        }
      }
    }

    report({
      stage: 'export',
      percent: 96,
      label: 'Writing CodeGraph native index',
    });
    const activeEntries = [...activeEntriesByPath.values()];
    const indexDocument = buildStreamingCodeGraphIndexDocument({
      projectName,
      projectRoot: root,
      packageVersion: mod?.version || '',
      indexedAt,
      exportLevel: effectiveExportLevel,
      maxEmbeddedSymbols: effectiveMaxEmbeddedSymbols,
      activeEntries,
      rawFileCount: typeof cg.getStats === 'function' ? Number(cg.getStats()?.fileCount || cg.getStats()?.files || totalFiles) || totalFiles : totalFiles,
      processedFileCount: processedFiles,
      stats: typeof cg.getStats === 'function' ? cg.getStats() : null,
    });
    documents += 1;
    activeEntriesByPath.set(indexDocument.path, {
      kind: 'index',
      path: indexDocument.path,
      hash: indexDocument.documentHash || '',
    });
    const indexResult = await upsertCodeGraphDocumentIfChanged({
      document: indexDocument,
      existingHashes,
      upsertMarkdown,
      logger,
    });
    if (indexResult.action === 'written') written += 1;
    if (indexResult.action === 'skip_unchanged') skippedUnchanged += 1;

    let ghostPlan = { deprecations: [], staleCandidates: [] };
    if (!scope.hasScope) {
      report({
        stage: 'export',
        percent: 98,
        label: 'Finalizing CodeGraph ghost-note cleanup',
      });
      ghostPlan = planGhostNoteUpdates({
        activePaths: [...activeEntriesByPath.keys()],
        existingNotes,
        deprecatedAt: indexedAt,
        replacementsByPath,
      });
      for (const deprecation of ghostPlan.deprecations || []) {
        await upsertMarkdown({
          path: deprecation.path,
          content: deprecation.content,
          kind: 'codegraph-deprecated',
          title: path.posix.basename(deprecation.path).replace(/\.md$/i, ''),
        }, { logger });
        await yieldToEventLoopDefault();
      }
    } else {
      logCodeGraphObsidian(logger, 'ghost_cleanup_skipped_for_scope', {
        projectName,
        projectRoot: root,
        scopeCount: normalizedScopes.length,
      });
    }

    logCodeGraphObsidian(logger, 'export_complete', {
      projectName,
      projectRoot: root,
      documents,
      written,
      skippedUnchanged,
      deprecated: ghostPlan.deprecations?.length || 0,
      staleCandidates: ghostPlan.staleCandidates?.length || 0,
      durationMs: Date.now() - startedAt,
      streaming: true,
    });
    return {
      documents,
      written,
      skippedUnchanged,
      deprecated: ghostPlan.deprecations?.length || 0,
      staleCandidates: ghostPlan.staleCandidates?.length || 0,
      exportLevel: effectiveExportLevel,
      maxEmbeddedSymbols: effectiveMaxEmbeddedSymbols,
      paths: [...activeEntriesByPath.keys()],
      ghostPlan,
      stats: typeof cg.getStats === 'function' ? cg.getStats() : null,
      streaming: true,
    };
  } finally {
    if (typeof cg.close === 'function') cg.close();
  }
};

const hasAutoGeneratedTag = (content = '') => (
  String(content).includes(AUTO_GEN_TAG)
  || String(content).includes('#argus/auto-gen')
);

const noteHasAutoGeneratedTag = (note = {}) => (
  hasAutoGeneratedTag(note.content)
  || (Array.isArray(note.tags) && note.tags.includes(AUTO_GEN_TAG))
  || (Array.isArray(note.properties?.tags) && note.properties.tags.includes(AUTO_GEN_TAG))
);

const hasManualFlag = (note = {}) => (
  /^\s*manual:\s*true\s*$/im.test(String(note.content || ''))
  || note.properties?.manual === true
  || String(note.properties?.manual || '').toLowerCase() === 'true'
);

const upsertFrontmatterValue = (content = '', updates = {}) => {
  const text = String(content || '');
  const bodyStart = text.startsWith('---\n') ? text.indexOf('\n---', 4) : -1;
  const body = bodyStart >= 0 ? text.slice(bodyStart + 4).replace(/^\n/, '') : text;
  const nextFrontmatter = formatFrontmatter(updates);
  return `${nextFrontmatter}\n\n${body}`;
};

export const planGhostNoteUpdates = ({
  activePaths = [],
  existingNotes = [],
  deprecatedAt = new Date().toISOString(),
  replacedBy = '',
  replacementsByPath = {},
} = {}) => {
  const active = new Set((Array.isArray(activePaths) ? activePaths : []).map((entry) => readString(entry).toLowerCase()));
  const deprecations = [];
  const staleCandidates = [];

  for (const note of Array.isArray(existingNotes) ? existingNotes : []) {
    const notePath = readString(note.path);
    if (!notePath || active.has(notePath.toLowerCase())) continue;
    if (!noteHasAutoGeneratedTag(note) || hasManualFlag(note)) {
      staleCandidates.push(notePath);
      continue;
    }
    const replacementPath = readString(replacementsByPath[notePath] || replacementsByPath[notePath.toLowerCase()] || replacedBy);
    const replacementLine = replacementPath ? `Replaced by: ${noteLink(replacementPath)}` : 'No replacement was detected in the latest CodeGraph export.';
    const nextContent = [
      upsertFrontmatterValue('', {
        type: 'wiki-note',
        source: 'codegraph',
        codegraphKind: 'deprecated',
        status: 'deprecated',
        deprecatedAt,
        replacedBy: replacementPath,
        tags: [AUTO_GEN_TAG, CODEGRAPH_TAG],
      }),
      '# Deprecated CodeGraph Note',
      '',
      'This auto-generated CodeGraph note is no longer active.',
      replacementLine,
      '',
    ].join('\n');
    deprecations.push({
      path: notePath,
      status: 'deprecated',
      content: nextContent,
    });
  }

  return { deprecations, staleCandidates };
};

const isRetryableError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  return code === 'SQLITE_BUSY'
    || code === 'SQLITE_LOCKED'
    || message.includes('database is locked')
    || message.includes('write conflict')
    || message.includes('busy');
};

const shouldEmitCodeGraphDebugLog = (logger) => Boolean(
  logger
    && (
      logger !== console
      || process.env.ARGUS_OBSIDIAN_DEBUG === '1'
      || process.env.ARGUS_CODEGRAPH_DEBUG === '1'
      || process.env.ARGUS_DEBUG_PACKAGE === '1'
      || process.env.ARGUS_PACKAGE_CHANNEL === 'debug'
    ),
);

const logCodeGraphObsidian = (logger, event, details = {}, level = 'log') => {
  if (!shouldEmitCodeGraphDebugLog(logger)) return;
  const writer = level === 'warn'
    ? logger.warn || logger.log || logger.info
    : logger.log || logger.info || logger.warn;
  if (typeof writer !== 'function') return;
  writer.call(logger, `[CodeGraph Obsidian] ${event} ${JSON.stringify({
    at: new Date().toISOString(),
    ...details,
  })}`);
};

export const logCodeGraphDebugEvent = logCodeGraphObsidian;

const withRetry = async (operation, { maxRetries = 2, retryDelayMs = 100 } = {}) => {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableError(error)) throw error;
      attempt += 1;
      await sleep(retryDelayMs * attempt);
    }
  }
};

export const createCodeGraphService = ({
  initialize = async () => ({ initialized: false }),
  sync = async () => ({ filesAdded: 0, filesModified: 0, filesRemoved: 0 }),
  exportObsidian = async () => ({ documents: 0 }),
  generateSummary = async () => ({ summary: '', model: '' }),
  writeSemanticSummary = async () => ({}),
  retryDelayMs = 100,
  maxRetries = 2,
  logger = console,
} = {}) => {
  const projectQueues = new Map();
  const projectStatuses = new Map();
  const lazySummaryInflight = new Map();

  const setStatus = (projectRoot, patch) => {
    const key = readString(projectRoot);
    projectStatuses.set(key, {
      state: 'idle',
      projectRoot: key,
      updatedAt: new Date().toISOString(),
      ...(projectStatuses.get(key) || {}),
      ...patch,
    });
  };

  const runSyncJob = async ({
    projectName = '',
    projectRoot = '',
    exportToObsidian = false,
    scopePaths = [],
  } = {}) => {
    const startedAt = Date.now();
    const normalizedScopePaths = normalizeCodeGraphScopePaths(projectRoot, scopePaths).map((scope) => scope.absolutePath);
    logCodeGraphObsidian(logger, 'job_start', {
      projectName,
      projectRoot,
      exportToObsidian,
      scopeCount: normalizedScopePaths.length,
    });
    setStatus(projectRoot, {
      state: 'syncing',
      projectName,
      progress: {
        stage: 'init',
        percent: 10,
        label: 'Preparing CodeGraph and MCP',
      },
    });
    try {
      const initialized = await withRetry(
        () => initialize({
          projectName,
          projectRoot,
          scopePaths: normalizedScopePaths,
          installMcp: true,
          ensureFullIndex: true,
          index: false,
        }),
        { maxRetries, retryDelayMs },
      );
      logCodeGraphObsidian(logger, 'init_complete', {
        projectName,
        projectRoot,
        exportToObsidian,
      });
      setStatus(projectRoot, {
        state: 'syncing',
        projectName,
        initialized,
        progress: {
          stage: 'sync',
          percent: 35,
          label: 'Indexing project with CodeGraph',
        },
      });
      const lastSync = await withRetry(
        () => sync({ projectName, projectRoot, scopePaths: normalizedScopePaths }),
        { maxRetries, retryDelayMs },
      );
      logCodeGraphObsidian(logger, 'sync_complete', {
        projectName,
        projectRoot,
        exportToObsidian,
        lastSync,
      });
      setStatus(projectRoot, {
        state: 'syncing',
        projectName,
        initialized,
        lastSync,
        progress: {
          stage: exportToObsidian ? 'collect' : 'complete',
          percent: exportToObsidian ? 55 : 95,
          label: exportToObsidian ? 'Reading CodeGraph index for Obsidian export' : 'CodeGraph sync complete',
        },
      });
      const exportResult = exportToObsidian
        ? await withRetry(
          () => exportObsidian({
            projectName,
            projectRoot,
            scopePaths: normalizedScopePaths,
            lastSync,
            onProgress: (progress = {}) => {
              setStatus(projectRoot, {
                state: 'syncing',
                projectName,
                initialized,
                lastSync,
                progress: {
                  stage: readString(progress.stage) || 'export',
                  percent: Math.max(0, Math.min(99, Number(progress.percent) || 55)),
                  label: readString(progress.label) || 'Processing CodeGraph Obsidian export',
                },
              });
            },
          }),
          { maxRetries, retryDelayMs },
        )
        : { skipped: true, reason: 'manual-export-required' };
      logCodeGraphObsidian(logger, exportToObsidian ? 'export_complete' : 'export_skipped', {
        projectName,
        projectRoot,
        exportToObsidian,
        exportResult,
      });
      setStatus(projectRoot, {
        state: 'success',
        projectName,
        initialized,
        lastSync,
        lastExport: exportResult,
        lastError: '',
        progress: {
          stage: 'complete',
          percent: 100,
          label: exportToObsidian ? 'CodeGraph imported to Obsidian' : 'CodeGraph sync complete',
        },
      });
      logCodeGraphObsidian(logger, 'job_complete', {
        projectName,
        projectRoot,
        exportToObsidian,
        durationMs: Date.now() - startedAt,
      });
      return { lastSync, lastExport: exportResult };
    } catch (error) {
      setStatus(projectRoot, {
        state: 'error',
        projectName,
        lastError: error?.message || String(error),
        progress: {
          stage: 'error',
          percent: 100,
          label: error?.message || String(error),
        },
      });
      logCodeGraphObsidian(logger, 'job_error', {
        projectName,
        projectRoot,
        exportToObsidian,
        message: error?.message || String(error),
        durationMs: Date.now() - startedAt,
      }, 'warn');
      throw error;
    }
  };

  const enqueueBackgroundSync = ({
    projectName = '',
    projectRoot = '',
    exportToObsidian = false,
    scopePaths = [],
  } = {}) => {
    const key = readString(projectRoot);
    const normalizedScopePaths = normalizeCodeGraphScopePaths(projectRoot, scopePaths).map((scope) => scope.absolutePath);
    const previous = projectQueues.get(key) || Promise.resolve();
    logCodeGraphObsidian(logger, 'queue_enqueued', {
      projectName,
      projectRoot: key,
      exportToObsidian,
      scopeCount: normalizedScopePaths.length,
      queueAlreadyPending: projectQueues.has(key),
    });
    const job = previous
      .catch(() => undefined)
      .then(() => runSyncJob({
        projectName,
        projectRoot,
        exportToObsidian,
        scopePaths: normalizedScopePaths,
      }));
    const guarded = job.catch(() => undefined).finally(() => {
      if (projectQueues.get(key) === guarded) projectQueues.delete(key);
    });
    projectQueues.set(key, guarded);
    setStatus(projectRoot, {
      state: 'queued',
      projectName,
      progress: {
        stage: 'queued',
        percent: 5,
        label: exportToObsidian
          ? `Queued CodeGraph build for ${normalizedScopePaths.length || 'selected'} script scope and Obsidian import`
          : 'Queued CodeGraph sync',
      },
      scopePaths: normalizedScopePaths,
    });
    return { queued: true, projectRoot: key };
  };

  const enqueueObsidianBuild = ({ projectName = '', projectRoot = '', scopePaths = [] } = {}) => enqueueBackgroundSync({
    projectName,
    projectRoot,
    scopePaths,
    exportToObsidian: true,
  });

  const waitForIdle = async (projectRoot = '') => {
    const key = readString(projectRoot);
    const queue = projectQueues.get(key);
    if (queue) await queue.catch(() => undefined);
    return projectStatuses.get(key) || { state: 'idle', projectRoot: key };
  };

  const requestLazyLlmSummary = async ({
    projectRoot = '',
    entityKind = '',
    entityId = '',
    contentHash = '',
    notePath = '',
    sourceText = '',
  } = {}) => {
    const key = [
      stableHash(projectRoot),
      readString(entityKind),
      readString(entityId),
      readString(contentHash),
    ].join(':');
    if (lazySummaryInflight.has(key)) return lazySummaryInflight.get(key);
    const promise = (async () => {
      const result = await generateSummary({
        projectRoot,
        entityKind,
        entityId,
        contentHash,
        sourceText,
      });
      await writeSemanticSummary({
        notePath,
        summary: result.summary || '',
        model: result.model || '',
        entityKind,
        entityId,
        contentHash,
      });
      return result;
    })().finally(() => {
      lazySummaryInflight.delete(key);
    });
    lazySummaryInflight.set(key, promise);
    return promise;
  };

  return {
    enqueueObsidianBuild,
    enqueueBackgroundSync,
    ensureInitialized: initialize,
    exportAstSummaryToObsidian: exportObsidian,
    getStatus: (projectRoot = '') => projectStatuses.get(readString(projectRoot)) || {
      state: 'idle',
      projectRoot: readString(projectRoot),
    },
    requestLazyLlmSummary,
    waitForIdle,
  };
};

export const defaultCodeGraphSettings = () => ({ ...DEFAULT_SETTINGS });

const appendPrompt = (existing = '', addition = '') => (
  [readString(existing), readString(addition)].filter(Boolean).join('\n\n')
);

const buildCodeGraphRuntimePrompt = ({ impactMaxDepth = 2, impactLimit = 50 } = {}) => [
  'CodeGraph Runtime',
  'Optimize for fast answers first, then precision.',
  'CodeGraph is a manually built project index. Do not trigger CodeGraph build, sync, export, or any full-index construction during chat.',
  'For code lookup, use the fastest available path. If CodeGraph MCP is already available and responds quickly, use it for structure, symbols, dependencies, and impact hints.',
  'If CodeGraph is missing, stale, slow, or returns weak results, immediately fall back to raw file search. Do not wait for indexing and do not ask the user to build unless they explicitly want CodeGraph refresh.',
  'Use raw file search when the user needs exact source text, when the likely file path is obvious, or when a quick grep/read will answer faster than graph traversal.',
  'Do not pass a full natural-language task sentence directly to codegraph_context.',
  'Extract exact identifiers, class names, method names, and file terms first.',
  'When using CodeGraph, query narrowly: use codegraph_search separately for exact terms before codegraph_context or codegraph_explore.',
  'For file or folder discovery, use codegraph_files with a narrow path or pattern. For a known symbol, use codegraph_node with includeCode=false first.',
  'For dependency and blast-radius questions, prefer bounded CodeGraph calls only after identifying exact symbols; otherwise use raw search to establish candidates first.',
  'Use Obsidian only for durable project memory, decisions, summaries, and human-readable CodeGraph notes.',
  'Only use codegraph_context or codegraph_explore after search has identified relevant names, and keep the query to exact names plus short domain terms.',
  `Keep impact queries bounded: maxDepth <= ${impactMaxDepth}, limit <= ${impactLimit}, maxNodes <= 30. If the graph is large, split the query by module or symbol instead of requesting one huge result.`,
].join('\n');

export const applyCodeGraphRuntimeToChatCommand = async (data = {}, {
  readConfig = () => DEFAULT_SETTINGS,
  ensureMcpConfig = installCodeGraphMcpConfig,
} = {}) => {
  const options = data.options && typeof data.options === 'object' ? data.options : {};
  const config = readConfig() || {};
  const codegraphEnabled = Object.prototype.hasOwnProperty.call(config, 'codegraphEnabled')
    ? config.codegraphEnabled === true
    : DEFAULT_SETTINGS.codegraphEnabled;
  if (!codegraphEnabled) {
    return data;
  }

  const projectRoot = readString(options.projectPath || options.cwd);
  const projectName = readString(options.projectName || data.projectName) || (projectRoot ? path.basename(projectRoot) : '');
  let mcpConfigured = false;
  let mcpError = '';
  if (projectRoot && typeof ensureMcpConfig === 'function') {
    try {
      await ensureMcpConfig(projectRoot);
      mcpConfigured = true;
    } catch (error) {
      mcpError = error?.message || String(error);
    }
  }
  const backgroundSyncQueued = false;
  const prompt = buildCodeGraphRuntimePrompt({
    impactMaxDepth: config.codegraphImpactMaxDepth || DEFAULT_SETTINGS.codegraphImpactMaxDepth,
    impactLimit: config.codegraphImpactLimit || DEFAULT_SETTINGS.codegraphImpactLimit,
  });

  if (data.type === 'claude-command') {
    return {
      ...data,
      options: {
        ...options,
        appendSystemPrompt: appendPrompt(options.appendSystemPrompt, prompt),
        codegraphContext: {
          enabled: true,
          backgroundSyncQueued,
          mcpConfigured,
          mcpError,
          projectName,
          projectRoot,
        },
      },
    };
  }

  return {
    ...data,
    command: `${prompt}\n\nUser task:\n${data.command || ''}`,
    options: {
      ...options,
      codegraphContext: {
        enabled: true,
        backgroundSyncQueued,
        mcpConfigured,
        mcpError,
        projectName,
        projectRoot,
      },
    },
  };
};

export const resolveCodeGraphClass = (mod = {}) => {
  const candidates = [
    mod.CodeGraph,
    mod.default?.CodeGraph,
    mod.default,
  ];
  return candidates.find((candidate) => (
    candidate
      && typeof candidate.open === 'function'
      && typeof candidate.init === 'function'
  )) || null;
};

const loadCodeGraphPackage = async () => {
  try {
    const mod = await import('@colbymchenry/codegraph');
    const CodeGraph = resolveCodeGraphClass(mod);
    if (!CodeGraph) {
      throw new Error('The @colbymchenry/codegraph package did not expose CodeGraph.');
    }
    return { mod, CodeGraph };
  } catch (error) {
    throw new Error(`CodeGraph package is unavailable. Install @colbymchenry/codegraph first. ${error?.message || ''}`.trim());
  }
};

export const openOrInitCodeGraphProject = async (
  CodeGraph,
  projectRoot = '',
  { indexOnInit = false, config = {}, prepareStorage = true, scopePaths = [] } = {},
) => {
  const root = readString(projectRoot);
  if (!root) throw new Error('projectRoot is required.');
  if (!CodeGraph || typeof CodeGraph.open !== 'function' || typeof CodeGraph.init !== 'function') {
    throw new Error('The CodeGraph package did not expose a usable CodeGraph class.');
  }
  if (prepareStorage) {
    await ensureCodeGraphProjectStorage(root, { config });
  }
  const scopeConfigPatch = buildCodeGraphScopeConfigPatch(root, scopePaths);
  const codeGraphConfig = Object.keys(scopeConfigPatch).length > 0
    ? { ...config, ...scopeConfigPatch }
    : config;
  if (typeof CodeGraph.isInitialized === 'function' && !CodeGraph.isInitialized(root)) {
    return CodeGraph.init(root, { index: indexOnInit, config: codeGraphConfig });
  }
  const cg = await CodeGraph.open(root, { sync: false });
  if (Object.keys(scopeConfigPatch).length > 0 && typeof cg.updateConfig === 'function') {
    cg.updateConfig(scopeConfigPatch);
  }
  return cg;
};

export const resolveCodeGraphCliPath = () => {
  try {
    return require.resolve('@colbymchenry/codegraph/dist/bin/codegraph.js');
  } catch {
    return '';
  }
};

export const buildCodeGraphMcpServerConfig = ({
  nodeCommand = resolveNodeRuntimeCommand(),
  cliPath = resolveCodeGraphCliPath(),
} = {}) => {
  const resolvedCliPath = readString(cliPath);
  if (!resolvedCliPath) {
    return {
      type: 'stdio',
      command: 'codegraph',
      args: ['serve', '--mcp'],
    };
  }
  return {
    type: 'stdio',
    command: readString(nodeCommand) || 'node',
    args: [resolvedCliPath, 'serve', '--mcp'],
  };
};

export const resolveNodeRuntimeCommand = () => {
  const candidates = [
    process.env.ARGUS_NODE_RUNTIME,
    process.env.NODE_EXE,
    process.execPath && /node(?:\.exe)?$/i.test(path.basename(process.execPath)) ? process.execPath : '',
    path.resolve(process.cwd(), 'electron-resources', 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
    path.resolve(path.dirname(process.execPath || ''), '..', 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
    'node',
  ];
  return candidates.find((candidate) => {
    const command = readString(candidate);
    return command === 'node' || (command && existsSync(command));
  }) || 'node';
};

export const installCodeGraphMcpConfig = async (projectRoot = '') => {
  const root = readString(projectRoot);
  if (!root) throw new Error('projectRoot is required.');
  const bridgeConfig = readObsidianBridgeConfig();
  const storage = await ensureCodeGraphProjectStorage(root, {
    config: bridgeConfig,
    migrateExisting: false,
  });
  const configPath = path.join(root, '.mcp.json');
  let config = {};
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch {
    config = {};
  }
  config.mcpServers = {
    ...(config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {}),
    codegraph: buildCodeGraphMcpServerConfig(),
  };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { configPath, serverName: 'codegraph', storage };
};

export const readCodeGraphMcpConfigStatus = async (projectRoot = '') => {
  const root = readString(projectRoot);
  const bridgeConfig = readObsidianBridgeConfig();
  const storageRoot = resolveCodeGraphStorageRoot(bridgeConfig);
  const storagePath = root ? getCodeGraphProjectStoragePath(root, bridgeConfig) : '';
  if (!root) {
    return {
      mcpConfigured: false,
      mcpError: 'projectRoot is required.',
      codegraphStorageRoot: storageRoot,
      codegraphStoragePath: storagePath,
    };
  }
  const configPath = path.join(root, '.mcp.json');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw);
    const server = config?.mcpServers?.codegraph;
    if (!server || typeof server !== 'object') {
      return {
        mcpConfigured: false,
        mcpConfigPath: configPath,
        codegraphStorageRoot: storageRoot,
        codegraphStoragePath: storagePath,
      };
    }
    const args = Array.isArray(server.args) ? server.args.map(readString) : [];
    const mcpUsesBundledCli = args.some((arg) => (
      arg.replace(/\\/g, '/').includes('@colbymchenry/codegraph/dist/bin/codegraph.js')
    ));
    return {
      mcpConfigured: true,
      mcpConfigPath: configPath,
      mcpUsesBundledCli,
      codegraphStorageRoot: storageRoot,
      codegraphStoragePath: storagePath,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        mcpConfigured: false,
        mcpConfigPath: configPath,
        codegraphStorageRoot: storageRoot,
        codegraphStoragePath: storagePath,
      };
    }
    return {
      mcpConfigured: false,
      mcpConfigPath: configPath,
      mcpError: error?.message || String(error),
      codegraphStorageRoot: storageRoot,
      codegraphStoragePath: storagePath,
    };
  }
};

const argusFullIndexMarkerPath = (projectRoot = '') => (
  path.join(projectRoot, '.codegraph', ARGUS_FULL_INDEX_MARKER)
);

const argusFullIndexFailureMarkerPath = (projectRoot = '') => (
  path.join(projectRoot, '.codegraph', ARGUS_FULL_INDEX_FAILURE_MARKER)
);

const readJsonFile = async (filePath = '') => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const writeJsonFile = async (filePath = '', value = {}) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

export const runCodeGraphFullIndexChild = async (projectRoot = '', {
  nodeCommand = resolveNodeRuntimeCommand(),
  cliPath = resolveCodeGraphCliPath(),
  timeoutMs = 20 * 60 * 1000,
  config = {},
  scopePaths = [],
} = {}) => {
  const root = readString(projectRoot);
  const command = readString(nodeCommand);
  const script = readString(cliPath);
  if (!root) throw new Error('projectRoot is required.');
  if (!command) throw new Error('Node runtime is unavailable.');
  if (!script) throw new Error('Bundled CodeGraph CLI is unavailable.');
  await ensureCodeGraphProjectStorage(root, { config });
  const scopeConfigPatch = buildCodeGraphScopeConfigPatch(root, scopePaths);
  if (Object.keys(scopeConfigPatch).length > 0) {
    const configPath = path.join(root, CODEGRAPH_DIR_NAME, 'config.json');
    const currentConfig = await readJsonFile(configPath);
    if (currentConfig && typeof currentConfig === 'object') {
      await writeJsonFile(configPath, {
        ...currentConfig,
        ...scopeConfigPatch,
      });
    }
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, [script, 'index', root, '--force', '--quiet'], {
      cwd: root,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CodeGraph full index timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }
      reject(new Error((stderr || stdout || `CodeGraph full index exited with code ${code}`).trim()));
    });
  });
};

export const ensureArgusFullCodeGraphIndex = async (cg, {
  projectRoot = '',
  force = false,
  runFullIndex = runCodeGraphFullIndexChild,
  failureCooldownMs = ARGUS_FULL_INDEX_FAILURE_COOLDOWN_MS,
  config = {},
  scopePaths = [],
} = {}) => {
  const root = readString(projectRoot);
  if (!root) throw new Error('projectRoot is required.');
  const storage = await ensureCodeGraphProjectStorage(root, { config });
  const markerPath = argusFullIndexMarkerPath(root);
  const failureMarkerPath = argusFullIndexFailureMarkerPath(root);
  if (!force) {
    try {
      await fs.access(markerPath);
      return { skipped: true, reason: 'argus-full-index-present', markerPath, storage };
    } catch {
      // Missing marker means this project still needs the first full background index.
    }
    const previousFailure = await readJsonFile(failureMarkerPath);
    const failedAt = Date.parse(previousFailure?.failedAt || '');
    if (Number.isFinite(failedAt) && Date.now() - failedAt < failureCooldownMs) {
      return {
        skipped: true,
        reason: 'argus-full-index-recent-failure',
        markerPath,
        failureMarkerPath,
        error: readString(previousFailure?.error),
        storage,
      };
    }
  }
  try {
    const result = await runFullIndex(root, { cg, config, scopePaths });
    if (result?.success === false) {
      throw new Error('CodeGraph full index failed.');
    }
    await writeJsonFile(markerPath, {
      indexedAt: new Date().toISOString(),
      filesIndexed: result?.filesIndexed ?? null,
      nodesCreated: result?.nodesCreated ?? null,
      edgesCreated: result?.edgesCreated ?? null,
    });
    await fs.rm(failureMarkerPath, { force: true }).catch(() => undefined);
    return { indexed: true, markerPath, result, storage };
  } catch (error) {
    const message = error?.message || String(error);
    await writeJsonFile(failureMarkerPath, {
      failedAt: new Date().toISOString(),
      error: message,
    });
    return {
      skipped: true,
      reason: 'argus-full-index-failed',
      markerPath,
      failureMarkerPath,
      error: message,
      storage,
    };
  }
};

export const initializeCodeGraphProject = async ({
  projectRoot = '',
  installMcp = true,
  ensureFullIndex = false,
  index = true,
  scopePaths = [],
} = {}) => {
  const root = readString(projectRoot);
  if (!root) throw new Error('projectRoot is required.');
  const bridgeConfig = readObsidianBridgeConfig();
  const { CodeGraph } = await loadCodeGraphPackage();
  let initialized = false;
  let result = null;
  let fullIndex = null;
  let cg = await openOrInitCodeGraphProject(CodeGraph, root, {
    indexOnInit: index,
    config: bridgeConfig,
    scopePaths,
  });
  initialized = true;
  try {
    if (ensureFullIndex) {
      if (typeof cg?.close === 'function') cg.close();
      cg = null;
      fullIndex = await ensureArgusFullCodeGraphIndex(null, {
        projectRoot: root,
        config: bridgeConfig,
        scopePaths,
      });
      cg = await openOrInitCodeGraphProject(CodeGraph, root, {
        indexOnInit: false,
        config: bridgeConfig,
        scopePaths,
      });
    }
    result = typeof cg.getStats === 'function' ? cg.getStats() : null;
  } finally {
    if (typeof cg?.close === 'function') cg.close();
  }
  const mcp = installMcp ? await installCodeGraphMcpConfig(root) : null;
  return {
    initialized,
    stats: result,
    fullIndex,
    mcp,
    storage: fullIndex?.storage || mcp?.storage || null,
  };
};

export const syncCodeGraphProject = async ({ projectRoot = '', scopePaths = [] } = {}) => {
  const root = readString(projectRoot);
  if (!root) throw new Error('projectRoot is required.');
  const bridgeConfig = readObsidianBridgeConfig();
  const { CodeGraph } = await loadCodeGraphPackage();
  const cg = await openOrInitCodeGraphProject(CodeGraph, root, {
    indexOnInit: false,
    config: bridgeConfig,
    scopePaths,
  });
  try {
    return await cg.sync();
  } finally {
    if (typeof cg.close === 'function') cg.close();
  }
};

const moduleIdForFile = (filePath = '') => {
  const parts = readString(filePath).replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] || 'root';
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/');
};

const summarizeModulesFromFiles = (cg, files = []) => {
  const modules = new Map();
  for (const file of files) {
    const filePath = normalizeFilePath(file);
    if (!filePath) continue;
    const id = moduleIdForFile(filePath);
    const current = modules.get(id) || {
      id,
      name: id.split('/').pop() || id,
      path: id,
      symbolCount: 0,
      relationships: [],
      files: [],
    };
    current.files.push(filePath);
    current.symbolCount += Number(file.symbolCount || file.nodes || 0);
    modules.set(id, current);
  }

  for (const module of modules.values()) {
    const targets = new Set();
    for (const filePath of module.files.slice(0, 20)) {
      try {
        for (const dependency of cg.getFileDependencies?.(filePath) || []) {
          const target = moduleIdForFile(dependency);
          if (target && target !== module.id) targets.add(target);
        }
      } catch {
        // Some CodeGraph backends may not expose file dependency helpers for every language.
      }
    }
    module.relationships = [...targets].slice(0, 12).map((target) => ({ kind: 'imports', target }));
    module.hash = stableHash(`${module.id}:${module.files.join('|')}:${module.relationships.map((entry) => entry.target).join('|')}`);
  }

  return [...modules.values()].sort((a, b) => a.id.localeCompare(b.id));
};

const collectSymbols = (cg, { maxSymbolNotes = 50 } = {}) => {
  const kinds = ['class', 'interface', 'type', 'function', 'method', 'route', 'component'];
  const symbols = [];
  for (const kind of kinds) {
    let nodes = [];
    try {
      nodes = typeof cg.getNodesByKind === 'function' ? cg.getNodesByKind(kind) : [];
    } catch {
      nodes = [];
    }
    for (const node of nodes) {
      const name = readString(node.name);
      if (!name) continue;
      symbols.push({
        id: readString(node.id || name),
        name,
        kind: readString(node.kind || kind),
        filePath: readString(node.filePath || node.path),
        startLine: Number(node.startLine) || 0,
        endLine: Number(node.endLine) || 0,
        relationships: [],
        hash: stableHash(JSON.stringify({
          id: node.id,
          name,
          kind,
          filePath: node.filePath,
          startLine: node.startLine,
          endLine: node.endLine,
        })),
      });
    }
  }
  return symbols
    .sort((a, b) => (a.filePath || '').localeCompare(b.filePath || '') || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(Number(maxSymbolNotes) || 50, 200)));
};

export const collectCodeGraphSummary = async ({
  projectRoot = '',
  exportLevel = DEFAULT_SETTINGS.codegraphExportLevel,
  scopePaths = [],
  onProgress = null,
} = {}) => {
  const root = readString(projectRoot);
  if (!root) throw new Error('projectRoot is required.');
  const bridgeConfig = readObsidianBridgeConfig();
  const { CodeGraph, mod } = await loadCodeGraphPackage();
  const cg = await openOrInitCodeGraphProject(CodeGraph, root, {
    indexOnInit: false,
    config: bridgeConfig,
    scopePaths,
  });
  try {
    return await collectCodeGraphSummaryFromGraph({
      cg,
      projectRoot: root,
      packageVersion: mod?.version || '',
      exportLevel,
      scopePaths,
      onProgress,
    });
  } finally {
    if (typeof cg.close === 'function') cg.close();
  }
};

export const collectCodeGraphSummaryFromGraph = async ({
  cg,
  projectRoot = '',
  packageVersion = '',
  exportLevel = DEFAULT_SETTINGS.codegraphExportLevel,
  scopePaths = [],
  onProgress = null,
  yieldToEventLoop = yieldToEventLoopDefault,
  yieldEveryNodes = 5000,
} = {}) => {
  if (!cg) throw new Error('CodeGraph instance is required.');
  const report = (event) => {
    if (typeof onProgress === 'function') onProgress(event);
  };
  const nodes = [];
  const effectiveExportLevel = ['structural', 'all'].includes(exportLevel) ? exportLevel : DEFAULT_SETTINGS.codegraphExportLevel;
  const collectionKinds = effectiveExportLevel === 'all'
    ? ALL_NATIVE_NODE_KINDS.filter((kind) => !EMBED_ONLY_NODE_KINDS.has(kind))
    : DEFAULT_OBSIDIAN_COLLECT_KINDS;
  const scope = createCodeGraphScopeMatcher(projectRoot, scopePaths);
  const seenNodeIds = new Set();
  const scopedFileRecords = [];
  if (scope.hasScope && typeof cg.getFiles === 'function') {
    report({
      stage: 'collect',
      percent: 56,
      label: `Finding CodeGraph files in selected script scope (${scope.scopes.length} selection${scope.scopes.length === 1 ? '' : 's'})`,
    });
    await yieldToEventLoop();
    try {
      for (const file of cg.getFiles() || []) {
        const filePath = normalizeFilePath(file);
        if (filePath && scope.matches(filePath)) scopedFileRecords.push(file);
      }
    } catch {
      // Scoped export can still use exact selected files below.
    }
  }

  if (scope.hasScope && typeof cg.getNodesInFile === 'function') {
    const filePaths = new Set([
      ...scopedFileRecords.map(normalizeFilePath).filter(Boolean),
      ...scope.exactFileRelativePaths,
    ]);
    let fileIndex = 0;
    for (const filePath of filePaths) {
      fileIndex += 1;
      if (fileIndex === 1 || fileIndex === filePaths.size || fileIndex % Math.max(1, Math.floor(yieldEveryNodes / 20)) === 0) {
        report({
          stage: 'collect',
          percent: Math.min(63, 56 + Math.floor((fileIndex / Math.max(1, filePaths.size)) * 7)),
          label: `Collecting CodeGraph nodes from selected scripts ${fileIndex}/${filePaths.size}`,
        });
        await yieldToEventLoop();
      }
      try {
        const fileNodes = cg.getNodesInFile(filePath) || [];
        for (const node of Array.isArray(fileNodes) ? fileNodes : []) {
          const normalized = normalizeNativeNode(node);
          if (!collectionKinds.includes(normalized.kind)) continue;
          if (!normalized.id || !normalized.name || seenNodeIds.has(normalized.id)) continue;
          if (effectiveExportLevel !== 'all' && !STRUCTURAL_NODE_KINDS.has(normalized.kind) && !isPublicOrExported(normalized)) {
            continue;
          }
          seenNodeIds.add(normalized.id);
          nodes.push(node);
        }
      } catch {
        // File-level helpers can fail for stale paths; keep the rest of the selected scope.
      }
    }
  } else {
    for (const [index, kind] of collectionKinds.entries()) {
      report({
        stage: 'collect',
        percent: Math.min(63, 56 + Math.floor((index / Math.max(1, collectionKinds.length)) * 7)),
        label: `Collecting CodeGraph ${kind} nodes (${index + 1}/${collectionKinds.length})`,
      });
      await yieldToEventLoop();
      try {
        const kindNodes = typeof cg.getNodesByKind === 'function' ? cg.getNodesByKind(kind) : [];
        for (const node of Array.isArray(kindNodes) ? kindNodes : []) {
          const normalized = normalizeNativeNode(node);
          if (scope.hasScope && !scope.matches(normalized.filePath)) continue;
          if (!normalized.id || !normalized.name || seenNodeIds.has(normalized.id)) continue;
          if (effectiveExportLevel !== 'all' && !STRUCTURAL_NODE_KINDS.has(normalized.kind) && !isPublicOrExported(normalized)) {
            continue;
          }
          seenNodeIds.add(normalized.id);
          nodes.push(node);
        }
      } catch {
        // Some CodeGraph versions may not support every native kind for every language.
      }
    }
  }

  const edgeMap = new Map();
  const addEdges = (items = [], limit = MAX_NATIVE_EDGES_PER_NODE) => {
    let count = 0;
    for (const edge of Array.isArray(items) ? items : []) {
      if (count >= limit) break;
      count += 1;
      const normalized = normalizeNativeEdge(edge);
      if (normalized.source && normalized.target) edgeMap.set(edgeIdentity(normalized), normalized);
    }
  };
  const relationshipYieldEvery = Math.max(1, Number(yieldEveryNodes) || 5000);
  for (const [index, node] of nodes.entries()) {
    const nodeId = readString(node.id);
    if (!nodeId) continue;
    if (index === 0 || index === nodes.length - 1 || index % relationshipYieldEvery === 0) {
      report({
        stage: 'collect',
        percent: Math.min(66, 63 + Math.floor((index / Math.max(1, nodes.length)) * 3)),
        label: `Reading CodeGraph relationships ${index + 1}/${nodes.length}`,
      });
      await yieldToEventLoop();
    }
    try {
      addEdges(typeof cg.getIncomingEdges === 'function' ? cg.getIncomingEdges(nodeId) : []);
    } catch {
      // Relationship helpers can be language/backend dependent.
    }
    try {
      addEdges(typeof cg.getOutgoingEdges === 'function' ? cg.getOutgoingEdges(nodeId) : []);
    } catch {
      // Relationship helpers can be language/backend dependent.
    }
  }

  const selectedFilePaths = new Set(nodes.map((node) => normalizeNativeNode(node).filePath).filter(Boolean));
  const files = [];
  report({
    stage: 'collect',
    percent: 66,
    label: `Reading CodeGraph files for ${selectedFilePaths.size} symbol-bearing paths`,
  });
  await yieldToEventLoop();
  if (scope.hasScope && scopedFileRecords.length > 0) {
    files.push(...scopedFileRecords);
  } else if (typeof cg.getFiles === 'function') {
    try {
      for (const file of cg.getFiles() || []) {
        const filePath = normalizeFilePath(file);
        if (filePath && (!scope.hasScope || scope.matches(filePath))) files.push(file);
      }
    } catch {
      // File metadata is best-effort; selected node file paths are enough to build rich file cards.
    }
  }
  for (const filePath of selectedFilePaths) {
    if (!files.some((file) => normalizeFilePath(file) === filePath)) {
      files.push({ path: filePath });
    }
  }

  const fileDependencies = {};
  const fileDependents = {};
  let dependencyIndex = 0;
  for (const filePath of selectedFilePaths) {
    if (!filePath) continue;
    if (dependencyIndex > 0 && dependencyIndex % relationshipYieldEvery === 0) {
      report({
        stage: 'collect',
        percent: 66,
        label: `Reading CodeGraph file dependencies ${dependencyIndex}/${selectedFilePaths.size}`,
      });
      await yieldToEventLoop();
    }
    dependencyIndex += 1;
    try {
      fileDependencies[filePath] = typeof cg.getFileDependencies === 'function' ? cg.getFileDependencies(filePath) : [];
    } catch {
      fileDependencies[filePath] = [];
    }
    try {
      fileDependents[filePath] = typeof cg.getFileDependents === 'function' ? cg.getFileDependents(filePath) : [];
    } catch {
      fileDependents[filePath] = [];
    }
  }

  report({
    stage: 'collect',
    percent: 67,
    label: `Collected ${files.length} files, ${nodes.length} nodes, ${edgeMap.size} edges`,
  });
  return {
    packageVersion,
    files,
    nodes,
    edges: [...edgeMap.values()],
    fileDependencies,
    fileDependents,
    stats: typeof cg.getStats === 'function' ? cg.getStats() : null,
  };
};

export const scanCodeGraphGhostNotes = async ({
  projectName = 'General',
  activePaths = [],
  queryNotes = queryObsidianNotes,
  deprecatedAt = new Date().toISOString(),
} = {}) => {
  const projectSegment = sanitizeVaultSegment(projectName, 'General');
  const result = await queryNotes({
    query: '',
    projectName: projectSegment,
    folders: [`Argus/Wiki/${projectSegment}/CodeGraph`],
    filters: [{ field: 'tags', op: 'contains', value: AUTO_GEN_TAG }],
    sourceTypes: ['markdown'],
    limit: 10000,
  });
  return planGhostNoteUpdates({
    activePaths,
    existingNotes: Array.isArray(result?.results) ? result.results : [],
    deprecatedAt,
  });
};

export const exportCodeGraphSummariesToObsidian = async ({
  projectName = 'General',
  projectRoot = '',
  maxSymbolNotes = 50,
  exportLevel = '',
  maxEmbeddedSymbols = 0,
  scopePaths = [],
  collectSummary = collectCodeGraphSummary,
  upsertMarkdown = upsertObsidianMarkdownFile,
  queryNotes = queryObsidianNotes,
  logger = console,
  onProgress = null,
} = {}) => {
  const startedAt = Date.now();
  const indexedAt = new Date().toISOString();
  logCodeGraphObsidian(logger, 'export_start', {
    projectName,
    projectRoot,
    exportLevel,
    maxEmbeddedSymbols,
    scopeCount: normalizeCodeGraphScopePaths(projectRoot, scopePaths).length,
  });
  if (collectSummary === collectCodeGraphSummary) {
    return exportCodeGraphSummariesToObsidianStreaming({
      projectName,
      projectRoot,
      exportLevel,
      maxEmbeddedSymbols,
      scopePaths,
      upsertMarkdown,
      queryNotes,
      logger,
      onProgress,
    });
  }
  const config = readObsidianBridgeConfig();
  const effectiveExportLevel = ['structural', 'all'].includes(exportLevel)
    ? exportLevel
    : config.codegraphExportLevel || DEFAULT_SETTINGS.codegraphExportLevel;
  const effectiveMaxEmbeddedSymbols = Number(maxEmbeddedSymbols) > 0
    ? Number(maxEmbeddedSymbols)
    : config.codegraphMaxEmbeddedSymbols || DEFAULT_SETTINGS.codegraphMaxEmbeddedSymbols;
  if (typeof onProgress === 'function') {
    onProgress({
      stage: 'collect',
      percent: 55,
      label: 'Reading CodeGraph index for Obsidian export',
    });
  }
  await yieldToEventLoopDefault();
  const summary = await collectSummary({
    projectRoot,
    exportLevel: effectiveExportLevel,
    scopePaths,
    onProgress,
  });
  logCodeGraphObsidian(logger, 'summary_collected', {
    projectName,
    projectRoot,
    fileCount: Array.isArray(summary.files) ? summary.files.length : 0,
    nodeCount: Array.isArray(summary.nodes) ? summary.nodes.length : 0,
    edgeCount: Array.isArray(summary.edges) ? summary.edges.length : 0,
    stats: summary.stats || null,
    symbolFileCaps: 'disabled',
  });
  if (typeof onProgress === 'function') {
    onProgress({
      stage: 'collect',
      percent: 62,
      label: `Collected CodeGraph summary for ${Array.isArray(summary.files) ? summary.files.length : 0} files`,
    });
  }
  await yieldToEventLoopDefault();
  const documents = buildCodeGraphNativeDocuments({
    projectName,
    projectRoot,
    packageVersion: summary.packageVersion || '',
    indexedAt,
    files: summary.files || [],
    nodes: summary.nodes || [],
    edges: summary.edges || [],
    fileDependencies: summary.fileDependencies || {},
    fileDependents: summary.fileDependents || {},
    exportLevel: effectiveExportLevel,
    maxEmbeddedSymbols: effectiveMaxEmbeddedSymbols,
  });
  logCodeGraphObsidian(logger, 'documents_built', {
    projectName,
    projectRoot,
    documentCount: documents.length,
    exportLevel: effectiveExportLevel,
    maxEmbeddedSymbols: effectiveMaxEmbeddedSymbols,
  });
  if (typeof onProgress === 'function') {
    onProgress({
      stage: 'export',
      percent: 70,
      label: `Built ${documents.length} Obsidian CodeGraph notes`,
    });
  }
  const existingQueryStartedAt = Date.now();
  const existingResult = await queryNotes({
    query: '',
    projectName: sanitizeVaultSegment(projectName, 'General'),
    folders: [`Argus/Wiki/${sanitizeVaultSegment(projectName, 'General')}/CodeGraph`],
    filters: [{ field: 'tags', op: 'contains', value: AUTO_GEN_TAG }],
    sourceTypes: ['markdown'],
    limit: 10000,
  }, { logger }).catch((error) => {
    logCodeGraphObsidian(logger, 'existing_notes_query_failed', {
      projectName,
      projectRoot,
      message: error?.message || String(error),
      durationMs: Date.now() - existingQueryStartedAt,
    }, 'warn');
    return { results: [] };
  });
  const existingNotes = Array.isArray(existingResult?.results) ? existingResult.results : [];
  logCodeGraphObsidian(logger, 'existing_notes_loaded', {
    projectName,
    projectRoot,
    existingNoteCount: existingNotes.length,
    durationMs: Date.now() - existingQueryStartedAt,
  });
  if (typeof onProgress === 'function') {
    onProgress({
      stage: 'export',
      percent: 74,
      label: `Loaded ${existingNotes.length} existing CodeGraph notes`,
    });
  }
  const existingHashes = buildExistingNoteHashMap(existingNotes);
  let written = 0;
  let skippedUnchanged = 0;
  let processed = 0;
  for (const document of documents) {
    processed += 1;
    if (document.documentHash && existingHashes.get(document.path.toLowerCase()) === document.documentHash) {
      skippedUnchanged += 1;
      if (processed === 1 || processed === documents.length || processed % 25 === 0) {
        logCodeGraphObsidian(logger, 'upsert_progress', {
          projectName,
          projectRoot,
          processed,
          total: documents.length,
          written,
          skippedUnchanged,
          currentPath: document.path,
          action: 'skip_unchanged',
        });
        if (typeof onProgress === 'function') {
          onProgress({
            stage: 'export',
            percent: Math.min(96, 75 + Math.floor((processed / Math.max(1, documents.length)) * 20)),
            label: `Checked CodeGraph note ${processed}/${documents.length}`,
          });
        }
      }
      continue;
    }
    const upsertStartedAt = Date.now();
    await upsertMarkdown({
      path: document.path,
      content: document.content,
      kind: 'codegraph',
      title: path.posix.basename(document.path).replace(/\.md$/i, ''),
    }, { logger });
    written += 1;
    logCodeGraphObsidian(logger, 'upsert_progress', {
      projectName,
      projectRoot,
      processed,
      total: documents.length,
      written,
      skippedUnchanged,
      currentPath: document.path,
      action: 'written',
      durationMs: Date.now() - upsertStartedAt,
    });
    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'export',
        percent: Math.min(96, 75 + Math.floor((processed / Math.max(1, documents.length)) * 20)),
        label: `Wrote CodeGraph note ${processed}/${documents.length}`,
      });
    }
  }
  const replacementsByPath = Object.fromEntries(documents.flatMap((document) => (
    (document.legacyPaths || [])
      .filter((legacyPath) => legacyPath && legacyPath !== document.path)
      .map((legacyPath) => [legacyPath, document.path])
  )));
  const ghostPlan = planGhostNoteUpdates({
    activePaths: documents.map((document) => document.path),
    existingNotes,
    deprecatedAt: indexedAt,
    replacementsByPath,
  });
  for (const deprecation of ghostPlan.deprecations || []) {
    const deprecationStartedAt = Date.now();
    await upsertMarkdown({
      path: deprecation.path,
      content: deprecation.content,
      kind: 'codegraph-deprecated',
      title: path.posix.basename(deprecation.path).replace(/\.md$/i, ''),
    }, { logger });
    logCodeGraphObsidian(logger, 'ghost_deprecated', {
      projectName,
      projectRoot,
      path: deprecation.path,
      durationMs: Date.now() - deprecationStartedAt,
    });
  }
  if (typeof onProgress === 'function') {
    onProgress({
      stage: 'export',
      percent: 98,
      label: 'Finalizing CodeGraph ghost-note cleanup',
    });
  }
  logCodeGraphObsidian(logger, 'export_complete', {
    projectName,
    projectRoot,
    documents: documents.length,
    written,
    skippedUnchanged,
    deprecated: ghostPlan.deprecations?.length || 0,
    staleCandidates: ghostPlan.staleCandidates?.length || 0,
    durationMs: Date.now() - startedAt,
  });
  return {
    documents: documents.length,
    written,
    skippedUnchanged,
    deprecated: ghostPlan.deprecations?.length || 0,
    staleCandidates: ghostPlan.staleCandidates?.length || 0,
    exportLevel: effectiveExportLevel,
    maxEmbeddedSymbols: effectiveMaxEmbeddedSymbols,
    paths: documents.map((document) => document.path),
    ghostPlan,
    stats: summary.stats || null,
  };
};

export const buildImpactSummary = async ({
  symbol = '',
  projectRoot = '',
  depth = DEFAULT_SETTINGS.codegraphImpactMaxDepth,
  limit = DEFAULT_SETTINGS.codegraphImpactLimit,
} = {}) => {
  const root = readString(projectRoot);
  const query = readString(symbol);
  if (!root) throw new Error('projectRoot is required.');
  if (!query) throw new Error('symbol is required.');
  const bridgeConfig = readObsidianBridgeConfig();
  const { CodeGraph } = await loadCodeGraphPackage();
  const cg = await openOrInitCodeGraphProject(CodeGraph, root, {
    indexOnInit: false,
    config: bridgeConfig,
  });
  try {
    const maxDepth = Math.max(1, Math.min(Number(depth) || DEFAULT_SETTINGS.codegraphImpactMaxDepth, 5));
    const maxResults = Math.max(1, Math.min(Number(limit) || DEFAULT_SETTINGS.codegraphImpactLimit, 200));
    const matches = typeof cg.searchNodes === 'function' ? cg.searchNodes(query, { limit: 5 }) : [];
    const nodes = [];
    for (const match of matches) {
      const node = match.node || match;
      if (!node?.id || typeof cg.getImpactRadius !== 'function') continue;
      const impact = cg.getImpactRadius(node.id, maxDepth);
      for (const impacted of impact.nodes?.values?.() || []) {
        nodes.push({
          id: impacted.id,
          name: impacted.name,
          kind: impacted.kind,
          filePath: impacted.filePath,
          startLine: impacted.startLine,
        });
        if (nodes.length >= maxResults) break;
      }
      if (nodes.length >= maxResults) break;
    }
    return {
      symbol: query,
      maxDepth,
      limit: maxResults,
      truncated: nodes.length >= maxResults,
      nodes,
    };
  } finally {
    if (typeof cg.close === 'function') cg.close();
  }
};

export const generateLazySemanticSummary = async ({
  entityKind = '',
  entityId = '',
  sourceText = '',
} = {}) => {
  const result = await completeSmallModelJson({
    purpose: 'wiki-readback',
    maxTokens: 500,
    systemPrompt: 'Return JSON only: {"summary":"concise technical summary","signals":["important symbol or dependency"]}.',
    userPrompt: [
      `Entity kind: ${readString(entityKind)}`,
      `Entity id: ${readString(entityId)}`,
      '',
      'CodeGraph AST summary:',
      String(sourceText || '').slice(0, 8000),
    ].join('\n'),
  });
  return {
    summary: readString(result?.json?.summary || result?.summary),
    model: result?.model || '',
    success: result?.success !== false,
    reason: result?.reason || '',
  };
};

export const writeLazySemanticSummaryToObsidian = async ({
  notePath = '',
  summary = '',
  model = '',
  entityKind = '',
  entityId = '',
  contentHash = '',
} = {}) => {
  const generatedAt = new Date().toISOString();
  const cleanSummary = readString(summary) || 'No semantic summary was generated.';
  const content = [
    cleanSummary,
    '',
    `- summarySource: llm`,
    model ? `- summaryModel: ${model}` : '',
    `- summaryGeneratedAt: ${generatedAt}`,
    entityKind ? `- entityKind: ${entityKind}` : '',
    entityId ? `- entityId: ${entityId}` : '',
    contentHash ? `- contentHash: ${contentHash}` : '',
  ].filter(Boolean).join('\n');
  return patchObsidianNote({
    target: { path: notePath },
    operation: 'replace-heading',
    heading: 'Semantic Summary',
    createHeading: true,
    content,
  });
};

export const getCodeGraphObsidianExportSkipReason = (config = {}) => {
  if (config.codegraphWriteObsidianSummaries === false) {
    return 'codegraphWriteObsidianSummaries disabled';
  }
  if (config.enabled !== true) {
    return 'Obsidian bridge disabled';
  }
  if (!readString(config.token)) {
    return 'Obsidian bridge token not configured';
  }
  return '';
};

export const codeGraphService = createCodeGraphService({
  initialize: initializeCodeGraphProject,
  sync: syncCodeGraphProject,
  generateSummary: generateLazySemanticSummary,
  writeSemanticSummary: writeLazySemanticSummaryToObsidian,
  exportObsidian: async ({ projectName, projectRoot, scopePaths, onProgress }) => {
    const config = readObsidianBridgeConfig({ includeToken: true });
    const skipReason = getCodeGraphObsidianExportSkipReason(config);
    if (skipReason) {
      return { skipped: true, reason: skipReason };
    }
    return exportCodeGraphSummariesToObsidian({
      projectName,
      projectRoot,
      scopePaths,
      exportLevel: config.codegraphExportLevel,
      maxEmbeddedSymbols: config.codegraphMaxEmbeddedSymbols,
      onProgress,
    });
  },
});
