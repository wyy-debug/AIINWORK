import path from 'path';
import { promises as fs } from 'fs';

const MAX_DIFF_PREVIEW = 16000;
export const MAX_UNTRACKED_FILE_PREVIEW_BYTES = 64 * 1024;
export const MAX_UNTRACKED_FILE_PREVIEW_LINES = 800;
const RISK_PATTERNS = [
  { pattern: /(auth|login|permission|security|credential|token|secret)/i, label: 'Security or permission-sensitive code changed' },
  { pattern: /(migration|schema|database|db\/|sql)/i, label: 'Database or schema behavior changed' },
  { pattern: /(package-lock|pnpm-lock|yarn.lock|package.json|vite.config|tsconfig|build|ci|workflow)/i, label: 'Build, dependency, or CI surface changed' },
  { pattern: /(server\/routes|api|endpoint|router)/i, label: 'API route behavior changed' },
  { pattern: /(checkpoint|rollback|git|diff)/i, label: 'Source-control or rollback workflow changed' },
];

function normalizeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function changedLineCount(diff) {
  return String(diff || '')
    .split('\n')
    .filter((line) => (line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---')))
    .length;
}

export function isLikelyBinaryBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  if (buffer.includes(0)) return true;
  const sampleLength = Math.min(buffer.length, 8000);
  let suspicious = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = buffer[index];
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13;
    if (byte < 32 && !isAllowedControl) suspicious += 1;
  }
  return suspicious / sampleLength > 0.1;
}

export async function buildUntrackedFileDiff(repositoryRootPath, filePath, {
  stat = fs.stat,
  readFile = fs.readFile,
} = {}) {
  const root = path.resolve(repositoryRootPath);
  const resolved = path.resolve(root, filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Untracked file path is outside the repository');
  }

  const stats = await stat(resolved);
  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  if (stats.isDirectory()) {
    return `diff --git a/${normalizedPath} b/${normalizedPath}\nnew directory: ${normalizedPath}\n`;
  }

  if (stats.size > MAX_UNTRACKED_FILE_PREVIEW_BYTES) {
    return [
      `diff --git a/${normalizedPath} b/${normalizedPath}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${normalizedPath}`,
      '@@ -0,0 +1 @@',
      `+Preview skipped: untracked file is ${stats.size} bytes, above the ${MAX_UNTRACKED_FILE_PREVIEW_BYTES} byte review preview limit.`,
    ].join('\n');
  }

  const buffer = await readFile(resolved);
  if (isLikelyBinaryBuffer(buffer)) {
    return [
      `diff --git a/${normalizedPath} b/${normalizedPath}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${normalizedPath}`,
      '@@ -0,0 +1 @@',
      `+Preview skipped: untracked file appears to be binary (${stats.size} bytes).`,
    ].join('\n');
  }

  const content = buffer.toString('utf8');
  const allLines = content.split('\n');
  const lines = allLines.slice(0, MAX_UNTRACKED_FILE_PREVIEW_LINES);
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${normalizedPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    allLines.length > lines.length ? '+... file preview truncated ...' : '',
  ].filter(Boolean).join('\n');
}

function fileKindCounts(files) {
  const counts = { added: 0, modified: 0, deleted: 0, untracked: 0 };
  for (const file of files) {
    const kind = normalizeString(file.kind, 'modified');
    if (Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind] += 1;
  }
  return counts;
}

function inferModules(files) {
  return unique(files.map((file) => {
    const filePath = normalizeString(file.path);
    if (!filePath) return '';
    const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts[0] === 'src' || parts[0] === 'server') return parts.slice(0, 3).join('/');
    return parts.slice(0, 2).join('/');
  })).slice(0, 12);
}

function inferCommitType(files) {
  if (files.length > 0 && files.every((file) => /\.(md|mdx|txt)$/i.test(file.path))) return 'docs';
  if (files.length > 0 && files.every((file) => /\.test\.(mjs|ts|tsx|js|jsx)$/i.test(file.path))) return 'test';
  if (files.some((file) => /(package|lock|vite|tsconfig|workflow|ci)/i.test(file.path))) return 'chore';
  if (files.some((file) => file.kind === 'added' || file.kind === 'untracked')) return 'feat';
  return 'fix';
}

function sentenceFromFiles(files) {
  const modules = inferModules(files);
  if (modules.length === 0) return 'local changes';
  if (modules.length === 1) return modules[0].replace(/[\/_-]+/g, ' ');
  return `${modules[0].replace(/[\/_-]+/g, ' ')} and related areas`;
}

function buildRisks({ files, diff }) {
  const risks = [];
  for (const rule of RISK_PATTERNS) {
    const matchingFiles = files.filter((file) => rule.pattern.test(file.path));
    if (matchingFiles.length > 0 || rule.pattern.test(diff)) {
      risks.push({
        title: rule.label,
        files: matchingFiles.map((file) => file.path).slice(0, 8),
        mitigation: 'Review behavior manually and run targeted regression checks before delivery.',
      });
    }
  }
  const lines = changedLineCount(diff);
  if (lines > 1200) {
    risks.push({
      title: 'Large diff size',
      files: [],
      mitigation: `Diff touches ${lines} changed lines; review in smaller file groups and prefer focused verification.`,
    });
  }
  if (!files.some((file) => /\.test\.(mjs|ts|tsx|js|jsx)$/i.test(file.path))) {
    risks.push({
      title: 'No dedicated test file changed',
      files: [],
      mitigation: 'Confirm existing tests cover the behavior, or add targeted tests for the changed workflow.',
    });
  }
  return risks.slice(0, 8);
}

function buildTestSuggestions(files) {
  const suggestions = ['npm run typecheck', 'npm run build'];
  if (files.some((file) => file.path.startsWith('server/'))) {
    suggestions.unshift('npm run test:unit -- server/services/tests/<changed-area>.test.mjs');
  }
  if (files.some((file) => file.path.startsWith('src/'))) {
    suggestions.unshift('npm run test:unit -- src/**/*.test.ts');
  }
  if (!suggestions.includes('npm run test:unit')) {
    suggestions.unshift('npm run test:unit');
  }
  return unique(suggestions).slice(0, 6);
}

function formatBulletList(values, fallback = '- None') {
  if (!values || values.length === 0) return fallback;
  return values.map((value) => `- ${value}`).join('\n');
}

function formatRisks(risks) {
  if (risks.length === 0) return '- No obvious high-risk surface detected by heuristics.';
  return risks.map((risk) => {
    const files = risk.files?.length ? `\n  Files: ${risk.files.join(', ')}` : '';
    return `- ${risk.title}${files}\n  Mitigation: ${risk.mitigation}`;
  }).join('\n');
}

function buildPrBody({ summary, risks, tests, impact }) {
  return [
    '## Summary',
    formatBulletList(summary),
    '',
    '## Impact',
    formatBulletList(impact),
    '',
    '## Risks',
    formatRisks(risks),
    '',
    '## Tests',
    tests.map((test) => `- [ ] ${test}`).join('\n') || '- [ ] Manual review',
  ].join('\n');
}

export function buildGitNativeReviewFlow({
  projectName = '',
  branch = '',
  files = [],
  diff = '',
  diffSource = 'current',
} = {}) {
  const normalizedFiles = asArray(files)
    .map((file) => ({
      path: normalizeString(file.path || file.filePath || file.name),
      kind: normalizeString(file.kind || 'modified'),
      status: normalizeString(file.status || ''),
    }))
    .filter((file) => file.path);
  const normalizedDiff = normalizeString(diff);
  const counts = fileKindCounts(normalizedFiles);
  const modules = inferModules(normalizedFiles);
  const hasChanges = normalizedFiles.length > 0 || normalizedDiff.length > 0;

  if (!hasChanges) {
    return {
      hasChanges: false,
      summary: [],
      risks: [],
      tests: [],
      impact: [],
      commitMessage: '',
      prBody: '',
      content: 'No local diff or checkpoint diff was found. There is nothing to review yet.',
      metadata: {
        projectName,
        branch,
        diffSource,
        changedFiles: 0,
      },
    };
  }

  const changeSummary = [
    `Review package for ${projectName || 'project'} on ${branch || 'unknown branch'}.`,
    `Changed files: ${normalizedFiles.length} (${counts.added} added, ${counts.modified} modified, ${counts.deleted} deleted, ${counts.untracked} untracked).`,
    modules.length > 0 ? `Primary impact areas: ${modules.join(', ')}.` : 'Primary impact areas could not be inferred from file paths.',
  ];
  const impact = [
    ...modules.map((moduleName) => `${moduleName}: changed by this diff`),
    normalizedDiff.length > MAX_DIFF_PREVIEW ? 'Diff preview was truncated in the artifact; inspect full git diff before final review.' : '',
  ].filter(Boolean);
  const risks = buildRisks({ files: normalizedFiles, diff: normalizedDiff });
  const tests = buildTestSuggestions(normalizedFiles);
  const type = inferCommitType(normalizedFiles);
  const commitMessage = `${type}(${projectName || 'review'}): update ${sentenceFromFiles(normalizedFiles)}`.slice(0, 96);
  const prBody = buildPrBody({ summary: changeSummary, risks, tests, impact });
  const diffPreview = normalizedDiff.length > MAX_DIFF_PREVIEW
    ? `${normalizedDiff.slice(0, MAX_DIFF_PREVIEW)}\n\n... diff truncated in review artifact ...`
    : normalizedDiff;
  const content = [
    `# Git-native Review Flow: ${projectName || 'Project'}`,
    '',
    `Branch: ${branch || 'unknown'}`,
    `Source: ${diffSource}`,
    '',
    '## Change Summary',
    formatBulletList(changeSummary),
    '',
    '## Impact Scope',
    formatBulletList(impact),
    '',
    '## Risk Points',
    formatRisks(risks),
    '',
    '## Test Suggestions',
    tests.map((test) => `- [ ] ${test}`).join('\n'),
    '',
    '## Commit Message',
    '```text',
    commitMessage,
    '```',
    '',
    '## PR Description',
    prBody,
    '',
    '## Diff Preview',
    '```diff',
    diffPreview,
    '```',
  ].join('\n');

  return {
    hasChanges: true,
    summary: changeSummary,
    risks,
    tests,
    impact,
    commitMessage,
    prBody,
    content,
    metadata: {
      projectName,
      branch,
      diffSource,
      changedFiles: normalizedFiles.length,
      changedLines: changedLineCount(normalizedDiff),
      modules,
    },
  };
}
