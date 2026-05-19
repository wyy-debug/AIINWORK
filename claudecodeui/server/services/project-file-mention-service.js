import fs from 'fs/promises';
import path from 'path';

export const FILE_MENTION_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  '.vite',
  '.cache',
  '.gradle',
  '.idea',
  '.vs',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'Library',
  'Temp',
  'Obj',
  'Logs',
]);

const FILE_MENTION_MAX_VISITED_ENTRIES = 25000;
const FILE_SUFFIX_RESOLUTION_MAX_VISITED_ENTRIES = 300000;

const toProjectRelativePath = (projectRoot, filePath) => (
  path.relative(projectRoot, filePath).split(path.sep).join('/')
);

const normalizeMentionPathForScore = (relativePath = '') => String(relativePath).replace(/\/+$/g, '');
const normalizeSuffixPathForCompare = (relativePath = '') => (
  String(relativePath || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
);

export const scoreFileMention = (relativePath, query, order) => {
  if (!query) {
    return order;
  }

  const comparablePath = normalizeMentionPathForScore(relativePath);
  const normalizedPath = comparablePath.toLowerCase();
  const fileName = path.posix.basename(comparablePath).toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const queryParts = normalizedQuery.split(/[\\/._\-\s]+/).filter(Boolean);

  if (fileName === normalizedQuery) return 0;
  if (fileName.startsWith(normalizedQuery)) return 1;
  if (normalizedPath.startsWith(normalizedQuery)) return 2;
  if (fileName.includes(normalizedQuery)) return 3;
  if (normalizedPath.includes(normalizedQuery)) return 4;
  if (queryParts.length > 0 && queryParts.every((part) => normalizedPath.includes(part))) return 5;
  return -1;
};

export async function searchProjectMentionEntries(projectRoot, rawQuery, limit) {
  const normalizedRoot = path.resolve(projectRoot);
  const query = String(rawQuery || '').trim().replace(/^@+/, '').replace(/\\/g, '/');
  const queue = [normalizedRoot];
  const matches = [];
  let visitedEntries = 0;
  let order = 0;

  while (queue.length > 0 && visitedEntries < FILE_MENTION_MAX_VISITED_ENTRIES) {
    const currentDirectory = queue.shift();
    let entries;

    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'EACCES' && error?.code !== 'EPERM') {
        console.warn('[WARN] File mention search skipped directory:', currentDirectory, error?.message || error);
      }
      continue;
    }

    visitedEntries += entries.length;
    const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));
    const childDirectories = [];

    for (const entry of sortedEntries) {
      if (entry.isDirectory() && FILE_MENTION_IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      if (!entry.isDirectory() && !entry.isFile()) {
        continue;
      }

      const entryPath = path.join(currentDirectory, entry.name);
      const relativePath = toProjectRelativePath(normalizedRoot, entryPath);
      const mentionPath = entry.isDirectory() ? `${relativePath.replace(/\/+$/g, '')}/` : relativePath;
      const score = scoreFileMention(mentionPath, query, order);
      order += 1;

      if (entry.isDirectory()) {
        childDirectories.push(entryPath);
      }

      if (score < 0) {
        continue;
      }

      matches.push({
        name: entry.name,
        path: mentionPath,
        relativePath: mentionPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        score,
        order,
      });

      if (!query && matches.length >= limit) {
        break;
      }
    }

    if (!query && matches.length >= limit) {
      break;
    }

    queue.push(...childDirectories);
  }

  return matches
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
      if (left.path.length !== right.path.length) return left.path.length - right.path.length;
      return left.path.localeCompare(right.path);
    })
    .slice(0, limit)
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      relativePath: entry.relativePath,
      type: entry.type,
    }));
}

export async function findProjectPathsBySuffix(projectRoot, rawSuffix, limit = 10) {
  const normalizedRoot = path.resolve(projectRoot);
  const suffix = normalizeSuffixPathForCompare(rawSuffix);
  const maxMatches = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : 10;

  if (!suffix) {
    return [];
  }

  const queue = [normalizedRoot];
  const matches = [];
  let visitedEntries = 0;

  while (queue.length > 0 && visitedEntries < FILE_SUFFIX_RESOLUTION_MAX_VISITED_ENTRIES) {
    const currentDirectory = queue.shift();
    let entries;

    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'EACCES' && error?.code !== 'EPERM') {
        console.warn('[WARN] File suffix resolution skipped directory:', currentDirectory, error?.message || error);
      }
      continue;
    }

    visitedEntries += entries.length;
    const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));
    const childDirectories = [];

    for (const entry of sortedEntries) {
      if (entry.isDirectory() && FILE_MENTION_IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      if (!entry.isDirectory() && !entry.isFile()) {
        continue;
      }

      const entryPath = path.join(currentDirectory, entry.name);
      const relativePath = toProjectRelativePath(normalizedRoot, entryPath);
      const comparablePath = normalizeSuffixPathForCompare(relativePath);

      if (entry.isDirectory()) {
        childDirectories.push(entryPath);
      }

      if (comparablePath === suffix || comparablePath.endsWith(`/${suffix}`)) {
        matches.push({
          absolutePath: entryPath,
          relativePath,
          type: entry.isDirectory() ? 'directory' : 'file',
        });

        if (matches.length >= maxMatches) {
          break;
        }
      }
    }

    if (matches.length >= maxMatches) {
      break;
    }

    queue.push(...childDirectories);
  }

  return matches.sort((left, right) => {
    if (left.relativePath.length !== right.relativePath.length) {
      return left.relativePath.length - right.relativePath.length;
    }
    return left.relativePath.localeCompare(right.relativePath);
  });
}
