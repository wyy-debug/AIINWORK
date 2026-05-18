import { promises as fs } from 'fs';
import path from 'path';

const DEFAULT_EXCLUDES = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-server',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);

const COMMAND_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  'Makefile',
  'justfile',
  'pyproject.toml',
  'Cargo.toml',
];

function isRiskFile(filePath) {
  const lower = filePath.toLowerCase();
  return lower.includes('auth')
    || lower.includes('permission')
    || lower.includes('secret')
    || lower.includes('database')
    || lower.includes('migration')
    || lower.includes('security')
    || lower.endsWith('.env')
    || lower.endsWith('.env.example');
}

async function walkProject(root, dir = root, depth = 0, result = []) {
  if (depth > 3 || result.length > 240) {
    return result;
  }
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (DEFAULT_EXCLUDES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath).split(path.sep).join('/');
    if (entry.isDirectory()) {
      result.push({ type: 'dir', path: relativePath });
      await walkProject(root, fullPath, depth + 1, result);
    } else if (entry.isFile()) {
      result.push({ type: 'file', path: relativePath });
    }
  }
  return result;
}

function extractPackageCommands(packageJson) {
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object'
    ? packageJson.scripts
    : {};
  return Object.keys(scripts)
    .sort()
    .map((name) => `npm run ${name}`);
}

async function readPackageJson(projectPath) {
  try {
    return JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function buildModuleMap(entries) {
  const top = new Map();
  for (const entry of entries) {
    const first = entry.path.split('/')[0];
    if (!first) continue;
    const current = top.get(first) || { files: 0, dirs: 0 };
    if (entry.type === 'dir') current.dirs += 1;
    if (entry.type === 'file') current.files += 1;
    top.set(first, current);
  }
  return Array.from(top.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 30)
    .map(([name, stats]) => `- ${name}/ - ${stats.dirs} dirs, ${stats.files} files`);
}

function buildSimpleDiff(oldText, newText) {
  if (oldText === newText) return '';
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  return [
    '--- MTL.md',
    '+++ MTL.md',
    '@@ project profile @@',
    ...oldLines.slice(0, 200).map((line) => `-${line}`),
    ...newLines.slice(0, 240).map((line) => `+${line}`),
  ].join('\n');
}

export async function scanProjectProfile(projectPath) {
  const root = path.resolve(projectPath);
  const entries = await walkProject(root);
  const packageJson = await readPackageJson(root);
  const existingCommandFiles = [];
  for (const file of COMMAND_FILES) {
    try {
      await fs.access(path.join(root, file));
      existingCommandFiles.push(file);
    } catch {
      // absent
    }
  }
  const commands = [
    ...extractPackageCommands(packageJson),
    existingCommandFiles.includes('Makefile') ? 'make test' : '',
    existingCommandFiles.includes('justfile') ? 'just --list' : '',
  ].filter(Boolean);
  const testCommands = commands.filter((command) => /test|vitest|jest|playwright|lint|typecheck/i.test(command));
  const riskFiles = entries
    .filter((entry) => entry.type === 'file' && isRiskFile(entry.path))
    .map((entry) => entry.path)
    .slice(0, 40);

  return {
    root,
    packageName: packageJson?.name || path.basename(root),
    moduleMap: buildModuleMap(entries),
    commands: commands.slice(0, 40),
    testCommands: testCommands.slice(0, 30),
    riskFiles,
    recommendedWorkflows: [
      '/review for local diffs',
      '/recipe code-impact-analysis for risky changes',
      '/recipe pr-description before delivery',
    ],
  };
}

export function buildProjectProfileMarkdown(profile) {
  const now = new Date().toISOString();
  return [
    '# MTL Project Profile',
    '',
    `Generated: ${now}`,
    `Project: ${profile.packageName}`,
    `Root: ${profile.root}`,
    '',
    '## Structure',
    ...(profile.moduleMap.length ? profile.moduleMap : ['- No module map available.']),
    '',
    '## Common Commands',
    ...(profile.commands.length ? profile.commands.map((command) => `- \`${command}\``) : ['- No commands detected.']),
    '',
    '## Test Entrypoints',
    ...(profile.testCommands.length ? profile.testCommands.map((command) => `- \`${command}\``) : ['- No test commands detected.']),
    '',
    '## Risk Files',
    ...(profile.riskFiles.length ? profile.riskFiles.map((file) => `- ${file}`) : ['- No obvious risk files detected.']),
    '',
    '## Recommended Workflows',
    ...profile.recommendedWorkflows.map((workflow) => `- ${workflow}`),
    '',
    '## Maintenance Notes',
    '- Refresh this file when the project structure, commands, tests, or risk surface changes.',
    '- Treat this as project guidance, not a substitute for inspecting current code.',
    '',
  ].join('\n');
}

export async function createProjectProfileDraft({ projectPath }) {
  const profile = await scanProjectProfile(projectPath);
  const targetPath = path.join(profile.root, 'MTL.md');
  let existing = '';
  try {
    existing = await fs.readFile(targetPath, 'utf8');
  } catch {
    existing = '';
  }
  const content = buildProjectProfileMarkdown(profile);
  return {
    targetPath,
    exists: Boolean(existing),
    content,
    diff: buildSimpleDiff(existing, content),
    profile,
  };
}

export async function commitProjectProfileDraft({ projectPath, content }) {
  const draft = await createProjectProfileDraft({ projectPath });
  const targetContent = typeof content === 'string' && content.trim() ? content : draft.content;
  await fs.writeFile(draft.targetPath, targetContent, 'utf8');
  return {
    success: true,
    targetPath: draft.targetPath,
    content: targetContent,
  };
}
