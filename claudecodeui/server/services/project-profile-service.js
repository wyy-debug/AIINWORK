import { promises as fs } from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo']);
const MODULE_DIRS = ['src', 'server', 'app', 'packages', 'apps', 'lib', 'shared', 'tests', 'test', 'scripts', 'docs'];
const RISK_FILE_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.env',
  '.env.local',
  'Dockerfile',
  'docker-compose.yml',
  'tsconfig.json',
]);

function validateProjectPath(projectPath) {
  const resolved = path.resolve(String(projectPath || '').trim());
  if (!resolved || resolved === path.parse(resolved).root) {
    throw new Error('Invalid project path');
  }
  return resolved;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function toPosix(relativePath) {
  return relativePath.replace(/\\/g, '/');
}

async function listTopModules(projectPath) {
  const entries = await fs.readdir(projectPath, { withFileTypes: true });
  const modules = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
    if (!MODULE_DIRS.includes(entry.name)) continue;
    modules.push({
      path: entry.name,
      description: `${entry.name} module`,
    });
  }
  return modules.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectFiles(projectPath, dir = projectPath, depth = 0, result = []) {
  if (depth > 3) return result;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.env.local') continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = toPosix(path.relative(projectPath, fullPath));
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await collectFiles(projectPath, fullPath, depth + 1, result);
      }
      continue;
    }
    result.push(relativePath);
  }
  return result;
}

function collectCommands(packageJson) {
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object'
    ? packageJson.scripts
    : {};
  return ['dev', 'build', 'test', 'typecheck', 'lint']
    .filter((name) => typeof scripts[name] === 'string')
    .map((name) => ({ name, command: `npm run ${name}` }));
}

function collectTestEntrypoints(files) {
  return files
    .filter((file) => /(^|\/)(tests?|__tests__)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file))
    .sort()
    .slice(0, 40);
}

function collectRiskFiles(files) {
  return files
    .filter((file) => RISK_FILE_NAMES.has(path.basename(file)) || /(^|\/)(auth|security|permissions?|secrets?)\b/i.test(file))
    .sort()
    .slice(0, 40);
}

export async function analyzeProjectProfile({ projectPath }) {
  const resolvedProjectPath = validateProjectPath(projectPath);
  if (!await pathExists(resolvedProjectPath)) {
    throw new Error(`Project path not found: ${resolvedProjectPath}`);
  }
  const packageJson = await readJson(path.join(resolvedProjectPath, 'package.json'));
  const files = await collectFiles(resolvedProjectPath);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectPath: resolvedProjectPath,
    packageName: packageJson?.name || path.basename(resolvedProjectPath),
    modules: await listTopModules(resolvedProjectPath),
    commands: collectCommands(packageJson),
    testEntrypoints: collectTestEntrypoints(files),
    riskFiles: collectRiskFiles(files),
  };
}

function renderList(items, formatter) {
  if (!items || items.length === 0) return '- None detected\n';
  return items.map(formatter).join('\n') + '\n';
}

export function renderMtlProjectProfile(profile) {
  return [
    '# MTL Project Profile',
    '',
    'Generated from local project scan. Re-run project profile init after major structure or tooling changes.',
    '',
    `Project: ${profile.packageName || path.basename(profile.projectPath || '')}`,
    `Path: ${profile.projectPath || ''}`,
    `Updated: ${profile.generatedAt || new Date().toISOString()}`,
    '',
    '## Module Map',
    renderList(profile.modules, (module) => `- ${module.path}: ${module.description || 'module'}`).trimEnd(),
    '',
    '## Common Commands',
    renderList(profile.commands, (command) => `- ${command.name}: \`${command.command}\``).trimEnd(),
    '',
    '## Test Entrypoints',
    renderList(profile.testEntrypoints, (entry) => `- ${entry}`).trimEnd(),
    '',
    '## Risk Files',
    renderList(profile.riskFiles, (entry) => `- ${entry}`).trimEnd(),
    '',
  ].join('\n');
}

export async function writeMtlProjectProfile({ projectPath }) {
  const profile = await analyzeProjectProfile({ projectPath });
  const markdown = renderMtlProjectProfile(profile);
  const filePath = path.join(profile.projectPath, 'MTL.md');
  await fs.writeFile(filePath, markdown, 'utf8');
  return { filePath, profile };
}
