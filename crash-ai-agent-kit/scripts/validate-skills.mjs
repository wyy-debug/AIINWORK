#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const skillsRoot = path.join(projectRoot, 'skills');

function parseFrontmatter(content, file) {
  if (!content.startsWith('---\n')) {
    throw new Error(`${file}: missing YAML frontmatter`);
  }
  const end = content.indexOf('\n---', 4);
  if (end === -1) throw new Error(`${file}: unclosed YAML frontmatter`);
  const raw = content.slice(4, end).trim();
  const fields = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) throw new Error(`${file}: invalid frontmatter line: ${line}`);
    fields[match[1]] = match[2].replace(/^"(.*)"$/, '$1').trim();
  }
  return fields;
}

const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');
  const content = await fs.readFile(skillPath, 'utf8');
  const fields = parseFrontmatter(content, skillPath);
  if (fields.name !== entry.name) {
    throw new Error(`${skillPath}: name "${fields.name}" must match folder "${entry.name}"`);
  }
  if (!/^[a-z0-9-]+$/.test(fields.name)) {
    throw new Error(`${skillPath}: invalid skill name "${fields.name}"`);
  }
  if (!fields.description) {
    throw new Error(`${skillPath}: description is required`);
  }
  console.log(`Validated skill: ${fields.name}`);
}
