#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/validate-capability.mjs <path>');
  process.exit(2);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseFrontmatter(content, filePath) {
  if (!content.startsWith('---\n')) {
    throw new Error(`${filePath}: missing YAML frontmatter`);
  }
  const end = content.indexOf('\n---', 4);
  if (end < 0) {
    throw new Error(`${filePath}: frontmatter is not closed`);
  }
  const fields = {};
  for (const line of content.slice(4, end).split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) throw new Error(`${filePath}: unsupported frontmatter line "${line}"`);
    fields[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return fields;
}

function assertSlug(name, label) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) {
    throw new Error(`${label}: invalid slug "${name}"`);
  }
}

function assertNoSecrets(text, label) {
  const patterns = [
    /REDMINE_API_KEY\s*[:=]\s*['"]?[A-Za-z0-9_-]{12,}/i,
    /HUB_ADMIN_TOKEN\s*[:=]\s*['"]?[A-Za-z0-9_-]{8,}/i,
    /api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i,
    /token\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i,
    /secret\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i,
  ];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      throw new Error(`${label}: possible secret detected`);
    }
  }
}

async function validateSkill(root) {
  const skillPath = path.join(root, 'SKILL.md');
  if (!await exists(skillPath)) throw new Error(`${root}: missing SKILL.md`);
  const content = await fs.readFile(skillPath, 'utf8');
  assertNoSecrets(content, skillPath);
  const frontmatter = parseFrontmatter(content, skillPath);
  if (!frontmatter.name) throw new Error(`${skillPath}: missing name`);
  if (!frontmatter.description) throw new Error(`${skillPath}: missing description`);
  assertSlug(frontmatter.name, skillPath);
  if (frontmatter.name !== path.basename(root)) {
    throw new Error(`${skillPath}: name must match directory name`);
  }
  const openaiPath = path.join(root, 'agents', 'openai.yaml');
  if (!await exists(openaiPath)) throw new Error(`${root}: missing agents/openai.yaml`);
  const openai = await fs.readFile(openaiPath, 'utf8');
  assertNoSecrets(openai, openaiPath);
  for (const key of ['display_name:', 'short_description:', 'default_prompt:']) {
    if (!openai.includes(key)) throw new Error(`${openaiPath}: missing ${key}`);
  }
  return `Skill valid: ${frontmatter.name}`;
}

async function validateMcp(root) {
  const hubPath = path.join(root, 'hub.mcp.json');
  const packagePath = path.join(root, 'package.json');
  if (!await exists(hubPath)) throw new Error(`${root}: missing hub.mcp.json`);
  if (!await exists(packagePath)) throw new Error(`${root}: missing package.json`);
  const hub = JSON.parse(await fs.readFile(hubPath, 'utf8'));
  assertNoSecrets(JSON.stringify(hub), hubPath);
  if (hub.kind !== 'mcp-server') throw new Error(`${hubPath}: kind must be mcp-server`);
  assertSlug(String(hub.name || ''), hubPath);
  if (!hub.mcp?.serverName) throw new Error(`${hubPath}: missing mcp.serverName`);
  if (!hub.mcp?.command) throw new Error(`${hubPath}: missing mcp.command`);
  if (!Array.isArray(hub.mcp?.args)) throw new Error(`${hubPath}: mcp.args must be an array`);
  return `MCP package valid: ${hub.name}`;
}

async function validateAgentFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  assertNoSecrets(content, filePath);
  const frontmatter = parseFrontmatter(content, filePath);
  if (!frontmatter.name) throw new Error(`${filePath}: missing name`);
  if (!frontmatter.description) throw new Error(`${filePath}: missing description`);
  assertSlug(frontmatter.name, filePath);
  return `Agent template valid: ${frontmatter.name}`;
}

const resolved = path.resolve(target);
const stat = await fs.stat(resolved);
let result;
if (stat.isDirectory()) {
  if (await exists(path.join(resolved, 'SKILL.md'))) {
    result = await validateSkill(resolved);
  } else if (await exists(path.join(resolved, 'hub.mcp.json'))) {
    result = await validateMcp(resolved);
  } else {
    throw new Error(`${resolved}: not a recognized Skill or MCP package`);
  }
} else {
  result = await validateAgentFile(resolved);
}

console.log(result);
