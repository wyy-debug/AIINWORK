#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const skillsRoot = path.join(projectRoot, 'skills');

function parseFrontmatter(content, filePath) {
  if (!content.startsWith('---\n')) {
    throw new Error(`${filePath}: missing YAML frontmatter`);
  }

  const end = content.indexOf('\n---', 4);
  if (end < 0) {
    throw new Error(`${filePath}: frontmatter is not closed`);
  }

  const raw = content.slice(4, end);
  const fields = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      throw new Error(`${filePath}: unsupported frontmatter line "${line}"`);
    }
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return fields;
}

function assertSkillName(name, filePath) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/.test(name)) {
    throw new Error(`${filePath}: invalid skill name "${name}"`);
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateSkill(skillDir) {
  const dirName = path.basename(skillDir);
  const skillPath = path.join(skillDir, 'SKILL.md');
  if (!await pathExists(skillPath)) {
    throw new Error(`${skillDir}: missing SKILL.md`);
  }

  const content = await fs.readFile(skillPath, 'utf8');
  const frontmatter = parseFrontmatter(content, skillPath);
  const name = String(frontmatter.name || '').trim();
  const description = String(frontmatter.description || '').trim();

  if (!name) throw new Error(`${skillPath}: missing name`);
  if (!description) throw new Error(`${skillPath}: missing description`);
  if (/TODO/i.test(description)) throw new Error(`${skillPath}: description still contains TODO`);
  assertSkillName(name, skillPath);
  if (name !== dirName) {
    throw new Error(`${skillPath}: name "${name}" must match directory "${dirName}"`);
  }
  if (description.length < 40) {
    throw new Error(`${skillPath}: description is too short`);
  }

  const openaiPath = path.join(skillDir, 'agents', 'openai.yaml');
  if (!await pathExists(openaiPath)) {
    throw new Error(`${skillDir}: missing agents/openai.yaml`);
  }

  const openai = await fs.readFile(openaiPath, 'utf8');
  for (const key of ['display_name:', 'short_description:', 'default_prompt:']) {
    if (!openai.includes(key)) {
      throw new Error(`${openaiPath}: missing ${key}`);
    }
  }

  return { name, descriptionLength: description.length };
}

const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
const skillDirs = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(skillsRoot, entry.name))
  .sort();

if (skillDirs.length === 0) {
  throw new Error(`No skills found under ${skillsRoot}`);
}

const results = [];
for (const skillDir of skillDirs) {
  results.push(await validateSkill(skillDir));
}

for (const result of results) {
  console.log(`Skill is valid: ${result.name}`);
}
