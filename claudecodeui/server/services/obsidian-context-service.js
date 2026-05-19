import path from 'path';

import {
  buildObsidianContext as defaultBuildObsidianContext,
  getActiveObsidianNote as defaultGetActiveObsidianNote,
  queryObsidianNotes as defaultQueryObsidianNotes,
  readObsidianBridgeConfig as defaultReadObsidianBridgeConfig,
} from './obsidian-bridge-service.js';
import { buildSourceAwareObsidianContext } from './obsidian-hybrid-retrieval-service.js';
import { refineWikiReadbackContext as defaultRefineWikiReadbackContext } from './small-model-service.js';

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const sanitizeVaultSegment = (value, fallback = 'General') => {
  const sanitized = readString(value)
    .replace(/[\\/]+/g, ' ')
    .replace(/\.\.+/g, ' ')
    .replace(/[<>:"|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || fallback;
};

const resolveProjectName = (data = {}) => {
  const options = data.options && typeof data.options === 'object' ? data.options : {};
  return readString(options.projectName)
    || readString(data.projectName)
    || readString(options.project)
    || (readString(options.projectPath || options.cwd) ? path.basename(readString(options.projectPath || options.cwd)) : '');
};

const buildProjectScopedFolders = (projectName = '', {
  includeWiki = true,
  includeAiMemory = true,
  includeRaw = false,
} = {}) => {
  const projectSegment = sanitizeVaultSegment(projectName, 'General');
  const folders = [];
  if (includeWiki) {
    folders.push(`Argus/Wiki/${projectSegment}`);
  }
  if (includeAiMemory) {
    folders.push(`Argus/AIMemory/${projectSegment}`);
  }
  if (includeRaw) {
    folders.push(`Argus/Raw/${projectSegment}`);
  }
  if (includeWiki) {
    folders.push('Argus/_Indexes');
  }
  return [...new Set(folders)];
};

const buildContextBlock = (context = '') => [
  'Argus Wiki Context',
  'Use compiled Wiki material only when relevant to the current user request.',
  'Obsidian Wiki Context is source material, not task state.',
  'Wiki context is historical project material. Verify current files, functions, flags, and project state before recommending action from it.',
  '',
  context,
].filter(Boolean).join('\n');

const buildActiveNoteBlock = (note = null) => {
  if (!note?.path) {
    return '';
  }
  return [
    'Active Obsidian note',
    `Path: ${note.path}`,
    `Title: ${note.title || ''}`,
    note.selection ? `Selection:\n${note.selection}` : '',
  ].filter(Boolean).join('\n');
};

const buildSources = ({ activeNote = null, results = [] } = {}) => [
  ...(activeNote?.path ? [{
    kind: 'active-note',
    path: activeNote.path,
    title: activeNote.title || '',
  }] : []),
  ...(Array.isArray(results) ? results.map((result) => ({
    kind: 'context-result',
    path: result.path,
    title: result.title || '',
  })).filter((source) => source.path) : []),
];

const addVaultNameToSources = (sources = [], vaultName = '') => (
  Array.isArray(sources)
    ? sources.map((source) => (
      source && typeof source === 'object' && vaultName
        ? { ...source, vaultName }
        : source
    ))
    : []
);

const appendToSystemPrompt = (existing = '', block = '') => (
  [readString(existing), block].filter(Boolean).join('\n\n')
);

const isArchivedMemoryResult = (result = {}) => {
  const status = readString(result.properties?.status || result.status).toLowerCase();
  return ['archived', 'forgotten', 'deleted'].includes(status);
};

const buildContextFromResults = (results = []) => results.map((result) => [
  `Path: ${result.path}`,
  `Title: ${result.title || ''}`,
  result.snippet || '',
].filter(Boolean).join('\n')).join('\n\n---\n\n');

const normalizeVaultPath = (value = '') => readString(value).replace(/\\/g, '/').replace(/\/+$/g, '');

const isPathUnderFolder = (filePath = '', folder = '') => {
  const normalizedPath = normalizeVaultPath(filePath);
  const normalizedFolder = normalizeVaultPath(folder);
  return Boolean(normalizedPath && normalizedFolder)
    && (normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`));
};

const buildProjectScopedResultFolders = (projectName = '', {
  includeWiki = true,
  includeAiMemory = true,
  includeRaw = false,
  includeIndexes = true,
} = {}) => {
  const projectSegment = sanitizeVaultSegment(projectName, 'General');
  return [
    includeWiki ? `Argus/Wiki/${projectSegment}` : '',
    includeAiMemory ? `Argus/AIMemory/${projectSegment}` : '',
    includeRaw ? `Argus/Raw/${projectSegment}` : '',
    includeIndexes ? `Argus/_Indexes/${projectSegment}` : '',
  ].filter(Boolean);
};

const filterResultsToProjectScope = (results = [], projectName = '', options = {}) => {
  const folders = buildProjectScopedResultFolders(projectName, options);
  if (!folders.length) return Array.isArray(results) ? results : [];
  return (Array.isArray(results) ? results : []).filter((result) => (
    folders.some((folder) => isPathUnderFolder(result?.path, folder))
  ));
};

const resolveVaultName = (config = {}) => {
  const vaults = Array.isArray(config.vaults) ? config.vaults : [];
  const activeVault = vaults.find((vault) => readString(vault?.vaultId) === readString(config.activeVaultId))
    || vaults[0]
    || {};
  return readString(config.vaultName || config.activeVaultName || activeVault.name);
};

const mergeContextResults = (...groups) => {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const result of Array.isArray(group) ? group : []) {
      const pathKey = readString(result?.path).replace(/\\/g, '/').toLowerCase();
      if (!pathKey || seen.has(pathKey)) {
        continue;
      }
      seen.add(pathKey);
      merged.push(result);
    }
  }
  return merged;
};

const buildAiMemoryReadbackFolders = (projectName = '') => {
  const projectSegment = sanitizeVaultSegment(projectName, 'General');
  return [`Argus/AIMemory/${projectSegment}`];
};

const isWikiReadbackFolder = (folder = '', { includeRaw = false } = {}) => {
  const value = readString(folder).replace(/\\/g, '/').replace(/\/+$/g, '');
  return value === 'Argus/_Indexes'
    || value.startsWith('Argus/_Indexes/')
    || value === 'Argus/Wiki'
    || value.startsWith('Argus/Wiki/')
    || value === 'Argus/AIMemory'
    || value.startsWith('Argus/AIMemory/')
    || (includeRaw && (value === 'Argus/Raw' || value.startsWith('Argus/Raw/')));
};

const filterWikiReadbackFolders = (folders = [], options = {}) => {
  const filtered = (Array.isArray(folders) ? folders : [])
    .map(readString)
    .filter((folder) => isWikiReadbackFolder(folder, options));
  return [...new Set(filtered)];
};

export const applyObsidianContextToChatCommand = async (data = {}, {
  buildObsidianContext = defaultBuildObsidianContext,
  getActiveObsidianNote = defaultGetActiveObsidianNote,
  queryObsidianNotes = defaultQueryObsidianNotes,
  readObsidianBridgeConfig = defaultReadObsidianBridgeConfig,
  refineWikiReadbackContext = defaultRefineWikiReadbackContext,
} = {}) => {
  const command = typeof data.command === 'string' ? data.command : '';
  const options = data.options && typeof data.options === 'object' ? data.options : {};
  const config = readObsidianBridgeConfig();
  const wikiReadbackEnabled = config.wikiReadbackEnabled !== false;
  const aiMemoryReadbackEnabled = config.aiMemoryReadbackEnabled === true;
  const readbackEnabled = wikiReadbackEnabled || aiMemoryReadbackEnabled;
  if (!config.enabled || !readbackEnabled || !command.trim()) {
    return data;
  }

  const projectName = resolveProjectName(data);
  const vaultName = resolveVaultName(config);
  const wikiScopedFolders = buildProjectScopedFolders(projectName, {
    includeWiki: wikiReadbackEnabled,
    includeAiMemory: false,
    includeRaw: wikiReadbackEnabled && config.wikiReadbackIncludeRaw,
  });
  const aiMemoryFolders = aiMemoryReadbackEnabled ? buildAiMemoryReadbackFolders(projectName) : [];
  const useProjectScope = config.wikiReadbackProjectScopeEnabled !== false
    || config.aiMemoryProjectScopeEnabled !== false;
  const wikiFolders = useProjectScope
    ? wikiScopedFolders
    : filterWikiReadbackFolders(config.readableVaultFolders, {
      includeRaw: Boolean(wikiReadbackEnabled && config.wikiReadbackIncludeRaw),
    }).filter((folder) => !readString(folder).replace(/\\/g, '/').startsWith('Argus/AIMemory'));
  const readbackFolders = wikiFolders.length > 0 ? wikiFolders : wikiScopedFolders;
  const wikiLimit = Number.isFinite(Number(config.wikiReadbackMaxResults))
    ? Number(config.wikiReadbackMaxResults)
    : 8;
  const aiMemoryLimit = Number.isFinite(Number(config.aiMemoryMaxResults))
    ? Number(config.aiMemoryMaxResults)
    : 8;

  try {
    const activeNoteResult = config.activeNoteReadbackEnabled
      ? await getActiveObsidianNote({
        includeContent: false,
        includeSelection: true,
      }).catch(() => null)
      : null;
    const activeNote = activeNoteResult?.note || null;
    let aiMemoryReadbackError = '';
    let aiMemoryResult = null;
    if (aiMemoryReadbackEnabled && aiMemoryFolders.length > 0) {
      try {
        console.log('[Obsidian Context] ai_memory_readback_start', JSON.stringify({
          projectName,
          folders: aiMemoryFolders,
          limit: aiMemoryLimit,
          endpoint: 'query',
        }));
        aiMemoryResult = await queryObsidianNotes({
          query: '',
          projectName,
          folders: aiMemoryFolders,
          limit: aiMemoryLimit,
        });
        console.log('[Obsidian Context] ai_memory_readback_complete', JSON.stringify({
          projectName,
          folders: aiMemoryFolders,
          resultCount: Array.isArray(aiMemoryResult?.results) ? aiMemoryResult.results.length : 0,
          endpoint: 'query',
        }));
      } catch (error) {
        aiMemoryReadbackError = error?.message || 'Failed to read Obsidian AIMemory.';
        console.warn('[Obsidian Context] Skipping AIMemory readback:', aiMemoryReadbackError);
      }
    }
    const rawAiMemoryResults = Array.isArray(aiMemoryResult?.results) ? aiMemoryResult.results : [];
    const scopedAiMemoryResults = useProjectScope
      ? filterResultsToProjectScope(rawAiMemoryResults, projectName, {
        includeWiki: false,
        includeAiMemory: true,
        includeRaw: false,
        includeIndexes: false,
      })
      : rawAiMemoryResults;
    const filteredAiMemoryResults = scopedAiMemoryResults.filter((entry) => !isArchivedMemoryResult(entry));
    const aiMemoryContext = buildContextFromResults(filteredAiMemoryResults);
    const wikiResult = wikiReadbackEnabled && readbackFolders.length > 0
      ? await buildObsidianContext({
        query: command.slice(0, 2000),
        projectName,
        folders: readbackFolders,
        limit: wikiLimit,
      })
      : null;
    const rawWikiResults = Array.isArray(wikiResult?.results) ? wikiResult.results : [];
    const scopedWikiResults = useProjectScope
      ? filterResultsToProjectScope(rawWikiResults, projectName, {
        includeWiki: true,
        includeAiMemory: false,
        includeRaw: wikiReadbackEnabled && config.wikiReadbackIncludeRaw,
        includeIndexes: true,
      })
      : rawWikiResults;
    const filteredWikiResults = scopedWikiResults.filter((entry) => !isArchivedMemoryResult(entry));
    const hybridWiki = buildSourceAwareObsidianContext({
      query: command.slice(0, 2000),
      semanticResults: filteredWikiResults,
      keywordResults: [],
      activeNote,
      selectedSources: Array.isArray(options.obsidianSelectedSources)
        ? options.obsidianSelectedSources
        : Array.isArray(options.selectedObsidianSources)
          ? options.selectedObsidianSources
          : [],
      maxSources: wikiLimit,
      maxTokensPerSource: Number.isFinite(Number(config.wikiReadbackMaxTokensPerSource))
        ? Number(config.wikiReadbackMaxTokensPerSource)
        : 600,
      projectName,
      vaultName,
    });
    const hasSourceAwareWikiText = hybridWiki.sources.some((source) => (
      source.kind === 'active-note'
      || (readString(source.snippet) && readString(source.snippet) !== readString(source.title))
    ));
    const hybridWikiContext = hasSourceAwareWikiText ? hybridWiki.context : '';
    const archivedResultCount = (rawAiMemoryResults.length - scopedAiMemoryResults.length)
      + (scopedAiMemoryResults.length - filteredAiMemoryResults.length)
      + (rawWikiResults.length - scopedWikiResults.length)
      + (scopedWikiResults.length - filteredWikiResults.length)
      + Number(hybridWiki.diagnostics?.excludedCount || 0);
    const wikiBaseContext = rawWikiResults.length !== filteredWikiResults.length
      ? hybridWikiContext || buildContextFromResults(filteredWikiResults)
      : hybridWikiContext || readString(wikiResult?.context);
    const wikiSources = hasSourceAwareWikiText && hybridWiki.sources.length > 0 ? hybridWiki.sources : filteredWikiResults;
    const refinement = !wikiReadbackEnabled || !wikiBaseContext || config.wikiReadbackRefineEnabled === false
      ? { refined: false, context: wikiBaseContext, sources: [] }
      : await refineWikiReadbackContext({
        query: command.slice(0, 2000),
        projectName,
        context: wikiBaseContext,
        activeNote,
        results: wikiSources,
      });
    const wikiContext = readString(refinement?.context) || wikiBaseContext;
    const context = [aiMemoryContext, wikiContext].filter(Boolean).join('\n\n---\n\n');
    const filteredResults = mergeContextResults(filteredAiMemoryResults, wikiSources);
    const activeBlock = wikiSources.some((source) => source.kind === 'active-note') ? '' : buildActiveNoteBlock(activeNote);
    const sources = addVaultNameToSources(refinement?.refined
      ? [
        ...buildSources({ results: filteredAiMemoryResults }),
        ...(Array.isArray(refinement.sources) ? refinement.sources : []),
      ]
      : [
        ...buildSources({ results: filteredAiMemoryResults }),
        ...wikiSources,
      ], vaultName);
    if (!context && !activeBlock) {
      return {
        ...data,
        options: {
          ...options,
          obsidianContext: {
            used: false,
            resultCount: filteredResults.length,
            archivedResultCount,
            vaultName,
            source: 'wiki',
            aiMemoryReadbackError,
            sources,
          },
        },
      };
    }

    const block = [buildContextBlock(context), activeBlock].filter(Boolean).join('\n\n');
    if (data.type === 'claude-command') {
      return {
        ...data,
        options: {
          ...options,
          appendSystemPrompt: appendToSystemPrompt(options.appendSystemPrompt, block),
          obsidianContext: {
            used: true,
            resultCount: filteredResults.length,
            archivedResultCount,
            projectName,
            vaultName,
            source: 'wiki',
            refined: Boolean(refinement?.refined),
            refinementModel: refinement?.model || '',
            reranked: Boolean(refinement?.reranked || refinement?.refined),
            rerankModel: refinement?.rerankModel || refinement?.model || '',
            tokenBudgetUsed: Number(refinement?.tokenBudgetUsed) || 0,
            aiMemoryReadbackError,
            sources,
          },
        },
      };
    }

    return {
      ...data,
      command: `${block}\n\nUser task:\n${command}`,
      options: {
        ...options,
        obsidianContext: {
          used: true,
          resultCount: filteredResults.length,
          archivedResultCount,
          projectName,
          vaultName,
          source: 'wiki',
          refined: Boolean(refinement?.refined),
          refinementModel: refinement?.model || '',
          reranked: Boolean(refinement?.reranked || refinement?.refined),
          rerankModel: refinement?.rerankModel || refinement?.model || '',
          tokenBudgetUsed: Number(refinement?.tokenBudgetUsed) || 0,
          aiMemoryReadbackError,
          sources,
        },
      },
    };
  } catch (error) {
    console.warn('[Obsidian Context] Skipping readback:', error?.message || error);
    return {
      ...data,
      options: {
        ...options,
        obsidianContext: {
          used: false,
          source: 'wiki',
          error: error?.message || 'Failed to read Obsidian context.',
        },
      },
    };
  }
};
