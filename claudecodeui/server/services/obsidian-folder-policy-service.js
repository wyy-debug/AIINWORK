const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const cleanFolder = (value = '') => readString(value)
  .replace(/\\/g, '/')
  .replace(/\/+/g, '/')
  .replace(/^\/+|\/+$/g, '');

const projectSegment = (value = '') => cleanFolder(value).replace(/[<>:"|?*\x00-\x1f]/g, ' ').trim() || 'General';

export const DEFAULT_OBSIDIAN_READABLE_FOLDERS = ['Argus/Wiki', 'Argus/_Indexes'];
export const LEGACY_OBSIDIAN_READONLY_FOLDERS = ['Argus/AIMemory'];

export const buildObsidianFolderPolicy = ({ projectName = '' } = {}) => {
  const project = projectSegment(projectName);
  return {
    currentFolders: {
      wiki: `Argus/Wiki/${project}`,
      raw: `Argus/Raw/${project}`,
      indexes: 'Argus/_Indexes',
      archive: 'Argus/Archive',
    },
    defaultReadableFolders: [...DEFAULT_OBSIDIAN_READABLE_FOLDERS],
    legacyReadOnlyFolders: [...LEGACY_OBSIDIAN_READONLY_FOLDERS],
    rules: [
      'Wiki stores curated compiled notes by project.',
      'Raw stores imported source material by project.',
      'Indexes stores generated lookup pages.',
      'Archive stores legacy generated notes and cleanup output.',
      'AIMemory is legacy read-only migration input, not default readback.',
    ],
  };
};

export const validateObsidianFolderPolicy = (config = {}) => {
  const readableFolders = (Array.isArray(config.readableVaultFolders) ? config.readableVaultFolders : [])
    .map(cleanFolder)
    .filter(Boolean);
  const states = [];
  const repairActions = [];
  if (readableFolders.some((folder) => folder === 'Argus/AIMemory' || folder.startsWith('Argus/AIMemory/'))) {
    states.push('legacy-aimemory-readback');
    repairActions.push({ id: 'remove-aimemory-readback', label: 'Remove AIMemory from readback', safe: true, enabled: true });
  }
  for (const required of DEFAULT_OBSIDIAN_READABLE_FOLDERS) {
    if (!readableFolders.includes(required)) {
      states.push(`missing-${required.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
      repairActions.push({ id: `add-${required.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label: `Add ${required}`, safe: true, enabled: true });
    }
  }
  return {
    status: states.length > 0 ? 'needs-cleanup' : 'ok',
    states,
    readableFolders,
    repairActions,
    policy: buildObsidianFolderPolicy({ projectName: config.projectName }),
  };
};

const isManualWiki = (note = {}) => {
  const source = readString(note.properties?.source || note.source).toLowerCase();
  return cleanFolder(note.path).startsWith('Argus/Wiki/') && source && source !== 'argus';
};

const fileName = (path = '') => cleanFolder(path).split('/').pop() || 'Note.md';

export const previewObsidianLegacyMigration = ({ notes = [], projectName = '' } = {}) => {
  const project = projectSegment(projectName);
  const actions = [];
  const skipped = [];
  for (const note of Array.isArray(notes) ? notes : []) {
    const notePath = cleanFolder(note.path);
    if (!notePath) continue;
    if (isManualWiki(note)) {
      skipped.push({ path: notePath, reason: 'manual-wiki-note' });
      continue;
    }
    if (notePath === 'Argus/AIMemory' || notePath.startsWith('Argus/AIMemory/')) {
      const relative = notePath.replace(/^Argus\/AIMemory\/?/, '');
      actions.push({
        action: 'relabel-legacy-aimemory',
        fromPath: notePath,
        toPath: `Argus/Archive/Legacy/AIMemory/${relative || fileName(notePath)}`,
        safe: true,
      });
      continue;
    }
    if (notePath === 'Argus/Projects' || notePath.startsWith('Argus/Projects/')) {
      actions.push({
        action: 'move-generated-project-note',
        fromPath: notePath,
        toPath: `Argus/Wiki/${project}/${fileName(notePath)}`,
        safe: true,
      });
      continue;
    }
    skipped.push({ path: notePath, reason: 'outside-legacy-generated-folders' });
  }
  return {
    success: true,
    dryRun: true,
    actions,
    skipped,
    summary: {
      actionCount: actions.length,
      skippedCount: skipped.length,
    },
  };
};
