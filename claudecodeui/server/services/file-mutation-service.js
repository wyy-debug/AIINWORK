import crypto from 'crypto';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';

const UI_DATA_DIR = process.env.APP_DATA_DIR
  || process.env.MTL_CODE_UI_DATA_DIR
  || path.join(os.homedir(), '.mtl-code-ui');
const MUTATION_LOG_PATH = path.join(UI_DATA_DIR, 'file-mutations.jsonl');
const fileMutationQueues = new Map();

export class FileMutationError extends Error {
  constructor(message, { statusCode = 500, code = 'FILE_MUTATION_ERROR', details = {} } = {}) {
    super(message);
    this.name = 'FileMutationError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const hashTextContent = (content = '') => (
  crypto.createHash('sha256').update(String(content), 'utf8').digest('hex')
);

const normalizeForCompare = (filePath) => {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

export const isPathInsideRoot = (projectRoot, targetPath) => {
  const root = normalizeForCompare(projectRoot);
  const target = normalizeForCompare(targetPath);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return target === root || target.startsWith(rootWithSeparator);
};

const toProjectRelativePath = (projectRoot, targetPath) => (
  path.relative(path.resolve(projectRoot), path.resolve(targetPath)).split(path.sep).join('/')
);

const readExistingTextSnapshot = async (filePath) => {
  try {
    const stats = await fsPromises.stat(filePath);

    if (!stats.isFile()) {
      throw new FileMutationError('Target path is not a file', {
        statusCode: 400,
        code: 'TARGET_NOT_FILE',
      });
    }

    const content = await fsPromises.readFile(filePath, 'utf8');
    return {
      exists: true,
      content,
      hash: hashTextContent(content),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mode: stats.mode,
    };
  } catch (error) {
    if (error instanceof FileMutationError) {
      throw error;
    }
    if (error?.code === 'ENOENT') {
      return {
        exists: false,
        content: '',
        hash: null,
        size: 0,
        mtimeMs: null,
        mode: null,
      };
    }
    throw error;
  }
};

const withFileMutationLock = async (filePath, task) => {
  const key = normalizeForCompare(filePath);
  const previous = fileMutationQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  fileMutationQueues.set(key, next);

  try {
    return await next;
  } finally {
    if (fileMutationQueues.get(key) === next) {
      fileMutationQueues.delete(key);
    }
  }
};

const buildSnapshotResponse = ({ projectRoot, resolvedPath, snapshot }) => ({
  content: snapshot.content,
  path: resolvedPath,
  relativePath: toProjectRelativePath(projectRoot, resolvedPath),
  hash: snapshot.hash,
  baseHash: snapshot.hash,
  size: snapshot.size,
  mtimeMs: snapshot.mtimeMs,
  encoding: 'utf8',
});

export const readProjectTextFileSnapshot = async ({ projectRoot, resolvedPath }) => {
  if (!isPathInsideRoot(projectRoot, resolvedPath)) {
    throw new FileMutationError('Path must be under project root', {
      statusCode: 403,
      code: 'PATH_OUTSIDE_PROJECT',
    });
  }

  const snapshot = await readExistingTextSnapshot(resolvedPath);
  if (!snapshot.exists) {
    throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
  }
  return buildSnapshotResponse({ projectRoot, resolvedPath, snapshot });
};

const appendMutationLog = async (event) => {
  try {
    await fsPromises.mkdir(path.dirname(MUTATION_LOG_PATH), { recursive: true, mode: 0o700 });
    await fsPromises.appendFile(MUTATION_LOG_PATH, `${JSON.stringify(event)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (error) {
    console.warn('[WARN] Failed to write file mutation log:', error?.message || error);
  }
};

const createConflictError = ({ baseHash, currentHash, resolvedPath }) => (
  new FileMutationError('File changed on disk. Reload before saving.', {
    statusCode: 409,
    code: 'FILE_WRITE_CONFLICT',
    details: {
      expectedHash: baseHash,
      currentHash,
      path: resolvedPath,
    },
  })
);

const writeTextFileAtomically = async ({ resolvedPath, content, mode }) => {
  const directory = path.dirname(resolvedPath);
  const tempPath = path.join(
    directory,
    `.argus-write-${process.pid}-${Date.now()}-${crypto.randomUUID()}.tmp`,
  );

  try {
    await fsPromises.mkdir(directory, { recursive: true });
    await fsPromises.writeFile(tempPath, content, {
      encoding: 'utf8',
      mode: mode || 0o666,
      flag: 'wx',
    });
    await fsPromises.rename(tempPath, resolvedPath);
  } catch (error) {
    await fsPromises.unlink(tempPath).catch(() => undefined);
    throw error;
  }
};

export const saveProjectTextFileWithGuard = async ({
  projectName,
  projectRoot,
  resolvedPath,
  content,
  baseHash,
  actor = 'ui:file-editor',
}) => {
  if (typeof content !== 'string') {
    throw new FileMutationError('Content must be a string', {
      statusCode: 400,
      code: 'INVALID_CONTENT',
    });
  }
  if (!isPathInsideRoot(projectRoot, resolvedPath)) {
    throw new FileMutationError('Path must be under project root', {
      statusCode: 403,
      code: 'PATH_OUTSIDE_PROJECT',
    });
  }

  return withFileMutationLock(resolvedPath, async () => {
    const before = await readExistingTextSnapshot(resolvedPath);
    const hasBaseHash = typeof baseHash === 'string' && baseHash.length > 0;
    if (hasBaseHash && before.hash !== baseHash) {
      throw createConflictError({ baseHash, currentHash: before.hash, resolvedPath });
    }

    const nextHash = hashTextContent(content);
    const mutationId = crypto.randomUUID();
    await writeTextFileAtomically({
      resolvedPath,
      content,
      mode: before.mode,
    });

    const after = await readExistingTextSnapshot(resolvedPath);
    if (after.hash !== nextHash) {
      throw new FileMutationError('File verification failed after write', {
        statusCode: 500,
        code: 'POST_WRITE_VERIFY_FAILED',
        details: {
          expectedHash: nextHash,
          currentHash: after.hash,
          path: resolvedPath,
        },
      });
    }

    const relativePath = toProjectRelativePath(projectRoot, resolvedPath);
    await appendMutationLog({
      id: mutationId,
      timestamp: new Date().toISOString(),
      operation: before.exists ? 'update-text-file' : 'create-text-file',
      actor,
      projectName,
      projectRoot: path.resolve(projectRoot),
      path: resolvedPath,
      relativePath,
      baseHash: hasBaseHash ? baseHash : null,
      previousHash: before.hash,
      nextHash,
      bytes: Buffer.byteLength(content, 'utf8'),
      guarded: hasBaseHash,
    });

    return {
      success: true,
      mutationId,
      path: resolvedPath,
      relativePath,
      hash: nextHash,
      baseHash: nextHash,
      previousHash: before.hash,
      size: after.size,
      mtimeMs: after.mtimeMs,
      guarded: hasBaseHash,
    };
  });
};

export const toFileMutationHttpError = (error) => {
  if (error instanceof FileMutationError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.message,
        code: error.code,
        ...error.details,
      },
    };
  }

  return null;
};

export const recordFileMutationEvent = async ({
  operation,
  actor = 'ui:file-tree',
  projectName = '',
  projectRoot = '',
  filePath = '',
  relativePath = '',
  metadata = {},
}) => {
  await appendMutationLog({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    operation,
    actor,
    projectName,
    projectRoot: projectRoot ? path.resolve(projectRoot) : '',
    path: filePath ? path.resolve(filePath) : '',
    relativePath,
    metadata,
  });
};
