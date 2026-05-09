import path from 'path';

import {
  buildObsidianContext as defaultBuildObsidianContext,
  getActiveObsidianNote as defaultGetActiveObsidianNote,
  readObsidianBridgeConfig as defaultReadObsidianBridgeConfig,
} from './obsidian-bridge-service.js';
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

const buildProjectScopedFolders = (projectName = '') => {
  const projectSegment = sanitizeVaultSegment(projectName, 'General');
  return [
    `Argus/Wiki/${projectSegment}`,
    'Argus/_Indexes',
    `Argus/AIMemory/${projectSegment}`,
  ];
};

const buildContextBlock = (context = '') => [
  'Argus Wiki Context',
  'Use the compiled Wiki as the source of truth only when it is relevant to the current user request.',
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

const appendToSystemPrompt = (existing = '', block = '') => (
  [readString(existing), block].filter(Boolean).join('\n\n')
);

export const applyObsidianContextToChatCommand = async (data = {}, {
  buildObsidianContext = defaultBuildObsidianContext,
  getActiveObsidianNote = defaultGetActiveObsidianNote,
  readObsidianBridgeConfig = defaultReadObsidianBridgeConfig,
  refineWikiReadbackContext = defaultRefineWikiReadbackContext,
} = {}) => {
  const command = typeof data.command === 'string' ? data.command : '';
  const options = data.options && typeof data.options === 'object' ? data.options : {};
  const config = readObsidianBridgeConfig();
  const readbackEnabled = config.wikiReadbackEnabled !== false
    || config.aiMemoryReadbackEnabled === true;
  if (!config.enabled || !readbackEnabled || !command.trim()) {
    return data;
  }

  const projectName = resolveProjectName(data);
  const scopedFolders = buildProjectScopedFolders(projectName);
  if (config.wikiReadbackIncludeRaw) {
    scopedFolders.push(`Argus/Raw/${sanitizeVaultSegment(projectName, 'General')}`);
  }
  const folders = config.aiMemoryProjectScopeEnabled
    || config.wikiReadbackProjectScopeEnabled !== false
    ? scopedFolders
    : config.readableVaultFolders;
  const limit = Number.isFinite(Number(config.wikiReadbackMaxResults))
    ? Number(config.wikiReadbackMaxResults)
    : Number.isFinite(Number(config.aiMemoryMaxResults))
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
    const result = await buildObsidianContext({
      query: command.slice(0, 2000),
      projectName,
      folders,
      limit,
    });
    const baseContext = readString(result?.context);
    const refinement = config.wikiReadbackRefineEnabled === false
      ? { refined: false, context: baseContext, sources: [] }
      : await refineWikiReadbackContext({
        query: command.slice(0, 2000),
        projectName,
        context: baseContext,
        activeNote,
        results: result?.results,
      });
    const context = readString(refinement?.context) || baseContext;
    const activeBlock = buildActiveNoteBlock(activeNote);
    const sources = refinement?.refined
      ? [
        ...buildSources({ activeNote, results: [] }),
        ...(Array.isArray(refinement.sources) ? refinement.sources : []),
      ]
      : buildSources({
        activeNote,
        results: result?.results,
      });
    if (!context && !activeBlock) {
      return {
        ...data,
        options: {
          ...options,
          obsidianContext: {
            used: false,
            resultCount: Array.isArray(result?.results) ? result.results.length : 0,
            source: 'wiki',
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
            resultCount: Array.isArray(result?.results) ? result.results.length : 0,
            projectName,
            source: 'wiki',
            refined: Boolean(refinement?.refined),
            refinementModel: refinement?.model || '',
            reranked: Boolean(refinement?.reranked || refinement?.refined),
            rerankModel: refinement?.rerankModel || refinement?.model || '',
            tokenBudgetUsed: Number(refinement?.tokenBudgetUsed) || 0,
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
          resultCount: Array.isArray(result?.results) ? result.results.length : 0,
          projectName,
          source: 'wiki',
          refined: Boolean(refinement?.refined),
          refinementModel: refinement?.model || '',
          reranked: Boolean(refinement?.reranked || refinement?.refined),
          rerankModel: refinement?.rerankModel || refinement?.model || '',
          tokenBudgetUsed: Number(refinement?.tokenBudgetUsed) || 0,
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
