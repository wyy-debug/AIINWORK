import { spawn } from 'child_process';

import { createArtifact as defaultCreateArtifact } from './artifact-service.js';
import { listSessionCheckpoints as defaultListSessionCheckpoints } from './session-checkpoint-service.js';

function spawnGit(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`git ${args.join(' ')} failed`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function parseDiffFiles(diff = '') {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('diff --git '))
    .map((line) => line.split(' b/')[1] || line.split(' a/')[1] || '')
    .filter(Boolean);
}

function summarizeDiff(diff = '') {
  const files = parseDiffFiles(diff);
  const additions = diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
  const deletions = diff.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
  return { files, additions, deletions };
}

export function buildReviewFlowArtifactContent({ diff = '', source = 'current-diff' } = {}) {
  if (!diff.trim()) {
    return {
      empty: true,
      content: 'No local diff is available for review.',
    };
  }
  const summary = summarizeDiff(diff);
  const fileList = summary.files.length
    ? summary.files.map((file) => `- ${file}`).join('\n')
    : '- No file headers detected.';
  const commitScope = summary.files[0]?.split('/')[0] || 'changes';
  const content = [
    '# Git-native Review Flow',
    '',
    `Source: ${source}`,
    '',
    '## Summary',
    `- Changed files: ${summary.files.length}`,
    `- Additions: ${summary.additions}`,
    `- Deletions: ${summary.deletions}`,
    '',
    '## Files',
    fileList,
    '',
    '## Risks',
    '- Review file boundaries and generated output before committing.',
    '- Verify any runtime, migration, permission, or auth-related changes manually.',
    '',
    '## Tests',
    '- Not run yet. Replace this with the exact validation commands before opening a PR.',
    '',
    '## Commit Message',
    `feat(${commitScope}): update local changes`,
    '',
    '## PR Body',
    '### Summary',
    `- Updates ${summary.files.length} file(s) from the current local diff.`,
    '',
    '### Risks',
    '- Local diff review required before delivery.',
    '',
    '### Tests',
    '- Not run yet.',
    '',
    '## Diff Preview',
    '```diff',
    diff.slice(0, 12000),
    diff.length > 12000 ? '\n[diff truncated]' : '',
    '```',
    '',
  ].join('\n');
  return { empty: false, content, summary };
}

export function createReviewFlowService({
  createArtifact = defaultCreateArtifact,
  listSessionCheckpoints = defaultListSessionCheckpoints,
  getCurrentDiff = null,
} = {}) {
  const loadDiff = async ({ projectPath = '', sessionId = '', provider = 'claude' } = {}) => {
    if (sessionId) {
      const checkpoints = listSessionCheckpoints({ sessionId, provider, limit: 1 });
      const checkpoint = checkpoints.find((entry) => entry.patch && entry.patch.trim());
      if (checkpoint) {
        return { diff: checkpoint.patch, source: `checkpoint:${checkpoint.id}` };
      }
    }
    if (getCurrentDiff) {
      return getCurrentDiff({ projectPath, sessionId, provider });
    }
    const { stdout } = await spawnGit(['diff', '--binary', 'HEAD', '--'], { cwd: projectPath });
    return { diff: stdout, source: 'current-diff' };
  };

  const createReviewArtifact = async ({
    projectName = '',
    projectPath = '',
    sessionId = '',
    provider = 'claude',
  } = {}) => {
    const loaded = await loadDiff({ projectPath, sessionId, provider });
    const built = buildReviewFlowArtifactContent(loaded);
    if (built.empty) {
      return {
        empty: true,
        message: built.content,
        artifact: null,
      };
    }
    const result = await createArtifact({
      kind: 'review-flow',
      title: `Review flow for ${projectName || 'project'}`,
      projectName,
      sessionId,
      content: built.content,
      metadata: {
        source: 'review-flow',
        diffSource: loaded.source,
        provider,
      },
    }, { autoExport: false });
    return {
      empty: false,
      artifact: result.artifact,
      content: built.content,
      summary: built.summary,
      source: loaded.source,
    };
  };

  return {
    buildReviewFlowArtifactContent,
    createReviewArtifact,
  };
}

export const reviewFlowService = createReviewFlowService();
export const createReviewFlowArtifact = (...args) => reviewFlowService.createReviewArtifact(...args);
