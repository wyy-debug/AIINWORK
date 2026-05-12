#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const hubUrl = (process.env.HUB_URL || process.argv[2] || 'http://localhost:4877').replace(/\/+$/, '');
const adminToken = process.env.HUB_ADMIN_TOKEN || process.env.MTL_CODE_HUB_ADMIN_TOKEN || '';
const overwrite = process.env.HUB_OVERWRITE !== 'false';
const maxFileBytes = 2 * 1024 * 1024;
const textExtensions = new Set(['.md', '.yaml', '.yml', '.json', '.js', '.mjs', '.txt']);
const ignoredDirectories = new Set(['node_modules', '.env', '.git', 'target']);

async function collectPackageFiles(rootDir, prefix = '') {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(rootDir, entry.name);
    const relative = path.join(prefix, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      files.push(...await collectPackageFiles(absolute, relative));
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.stat(absolute);
    if (stat.size > maxFileBytes) continue;
    const buffer = await fs.readFile(absolute);
    const ext = path.extname(entry.name).toLowerCase();
    const isText = textExtensions.has(ext) || !ext;
    files.push({
      path: relative,
      content: isText ? buffer.toString('utf8') : buffer.toString('base64'),
      encoding: isText ? 'utf8' : 'base64',
      size: stat.size,
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

const meta = JSON.parse(await fs.readFile(path.join(projectRoot, 'hub.mcp.json'), 'utf8'));
const response = await fetch(`${hubUrl}/api/agent-repository-server/items`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
  },
  body: JSON.stringify({
    overwrite,
    ...meta,
    packageFiles: await collectPackageFiles(projectRoot),
  }),
});
const data = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(data.details || data.error || `Hub returned HTTP ${response.status}`);
}
console.log(`Published ${meta.kind}: ${meta.name}`);
