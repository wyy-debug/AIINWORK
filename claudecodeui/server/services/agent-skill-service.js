import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

import { parseFrontmatter } from '../utils/frontmatter.js';

const MTL_CODE_HOME_DIR = process.env.MTL_CODE_CONFIG_DIR || path.join(os.homedir(), '.mtl-code');
const LEGACY_CLAUDE_HOME_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const CODEX_HOME_DIR = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

function normalizeSkillId(value, fallback = 'skill') {
  const id = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return id || fallback;
}

function normalizeString(value, fallback = '', maxLength = 4000) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function normalizeStringArray(value, maxItems = 40, maxLength = 120) {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => normalizeString(entry, '', maxLength))
      .filter(Boolean)
      .slice(0, maxItems);
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeString(entry, '', maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function isUnderDirectory(base, target) {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function makeRoot(id, label, scope, provider, dir, workspacePath = '') {
  return {
    id,
    label,
    scope,
    provider,
    dir,
    workspacePath,
  };
}

function getSkillRoots(workspacePath = '') {
  const roots = [
    makeRoot('user:mtl-code', 'MTL-Code user skills', 'user', 'mtl-code', path.join(MTL_CODE_HOME_DIR, 'skills')),
    makeRoot('user:claude', 'Claude user skills', 'user', 'claude', path.join(LEGACY_CLAUDE_HOME_DIR, 'skills')),
    makeRoot('user:codex', 'Codex user skills', 'user', 'codex', path.join(CODEX_HOME_DIR, 'skills')),
  ];

  if (workspacePath && typeof workspacePath === 'string' && path.isAbsolute(workspacePath)) {
    const workspaceRoot = path.resolve(workspacePath);
    roots.push(
      makeRoot('project:mtl-code', 'Project MTL-Code skills', 'project', 'mtl-code', path.join(workspaceRoot, '.mtl-code', 'skills'), workspaceRoot),
      makeRoot('project:claude', 'Project Claude skills', 'project', 'claude', path.join(workspaceRoot, '.claude', 'skills'), workspaceRoot),
      makeRoot('project:codex', 'Project Codex skills', 'project', 'codex', path.join(workspaceRoot, '.codex', 'skills'), workspaceRoot),
    );
  }

  return roots;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function countPackageFiles(skillDir) {
  let count = 0;
  const folders = new Set();

  async function walk(dir, depth = 0) {
    if (depth > 5 || count > 500) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth === 0) folders.add(entry.name);
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }

  await walk(skillDir);
  return { fileCount: count, folders: Array.from(folders).sort() };
}

function firstMarkdownSummary(content) {
  return String(content || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line && !line.startsWith('---'))
    || '';
}

async function readSkillPackage(root, entry) {
  if (!entry.isDirectory()) return null;

  const skillDir = path.resolve(root.dir, entry.name);
  const rootDir = path.resolve(root.dir);
  if (!isUnderDirectory(rootDir, skillDir)) return null;

  const skillPath = path.join(skillDir, 'SKILL.md');
  if (!await pathExists(skillPath)) return null;

  const content = await fs.readFile(skillPath, 'utf8');
  const parsed = parseFrontmatter(content);
  const metadata = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
  const stats = await fs.stat(skillPath);
  const packageInfo = await countPackageFiles(skillDir);
  const name = normalizeSkillId(metadata.name || entry.name, entry.name);
  const description = normalizeString(
    metadata.description,
    firstMarkdownSummary(parsed.content),
    1000,
  );

  return {
    id: `${root.id}:${name}`,
    name,
    title: normalizeString(metadata.title, name, 160),
    description,
    version: normalizeString(metadata.version, '', 80),
    tags: normalizeStringArray(metadata.tags),
    scope: root.scope,
    provider: root.provider,
    source: root.label,
    workspacePath: root.workspacePath,
    path: skillDir,
    skillPath,
    callable: true,
    fileCount: packageInfo.fileCount,
    folders: packageInfo.folders,
    updatedAt: stats.mtime.toISOString(),
  };
}

async function scanSkillRoot(root) {
  try {
    const entries = await fs.readdir(root.dir, { withFileTypes: true });
    const skills = await Promise.all(entries.map((entry) => readSkillPackage(root, entry).catch(() => null)));
    return skills.filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EACCES') {
      return [];
    }
    throw error;
  }
}

export async function listInstalledSkills({ workspacePath = '' } = {}) {
  const roots = getSkillRoots(workspacePath);
  const rootResults = await Promise.all(
    roots.map((root) => scanSkillRoot(root).then(
      (skills) => ({ root, skills, error: null }),
      (error) => ({ root, skills: [], error: error.message || String(error) }),
    )),
  );

  const byKey = new Map();
  for (const { skills } of rootResults) {
    for (const skill of skills) {
      const key = `${skill.provider}:${skill.scope}:${skill.name}`.toLowerCase();
      byKey.set(key, skill);
    }
  }

  const skills = Array.from(byKey.values()).sort((a, b) => (
    a.name.localeCompare(b.name) || a.source.localeCompare(b.source)
  ));

  return {
    success: true,
    skills,
    roots: rootResults.map(({ root, skills, error }) => ({
      id: root.id,
      label: root.label,
      scope: root.scope,
      provider: root.provider,
      path: root.dir,
      workspacePath: root.workspacePath,
      skillCount: skills.length,
      error,
    })),
  };
}
