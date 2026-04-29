#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const hubUrl = (process.env.HUB_URL || process.argv[2] || 'http://localhost:4877').replace(/\/+$/, '');
const adminToken = process.env.HUB_ADMIN_TOKEN || process.env.MTL_CODE_HUB_ADMIN_TOKEN || '';
const overwrite = process.env.HUB_OVERWRITE !== 'false';
const maxFileBytes = 2 * 1024 * 1024;
const excludeDirs = new Set(['.git', 'node_modules', 'dist', 'coverage', '.cache']);
const textExtensions = new Set(['.js', '.mjs', '.json', '.md', '.txt', '.yml', '.yaml', '.toml']);

async function collectFiles(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && excludeDirs.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const relative = path.join(prefix, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolute, relative));
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.stat(absolute);
    if (stat.size > maxFileBytes) continue;
    const buffer = await fs.readFile(absolute);
    const extension = path.extname(entry.name).toLowerCase();
    const isText = textExtensions.has(extension) || !extension;
    files.push({
      path: relative,
      content: isText ? buffer.toString('utf8') : buffer.toString('base64'),
      encoding: isText ? 'utf8' : 'base64',
      size: stat.size,
    });
  }
  return files;
}

const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, 'hub.mcp.json'), 'utf8'));
const payload = { ...manifest, overwrite, packageFiles: await collectFiles(projectRoot) };
const response = await fetch(`${hubUrl}/api/agent-repository-server/items`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
  },
  body: JSON.stringify(payload),
});

const data = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(data.details || data.error || `Hub returned HTTP ${response.status}`);
}

console.log(`Published ${manifest.name} to ${hubUrl}`);
