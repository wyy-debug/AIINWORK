#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const pluginId = 'argus-bridge';
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) {
    args.set(key, true);
  } else {
    args.set(key, next);
    index += 1;
  }
}

const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};

const findDefaultVault = async () => {
  const obsidianConfigPath = path.join(os.homedir(), 'AppData', 'Roaming', 'obsidian', 'obsidian.json');
  const config = await readJson(obsidianConfigPath, null);
  const vaults = config?.vaults && typeof config.vaults === 'object' ? Object.values(config.vaults) : [];
  const selected = vaults.find((vault) => vault?.open) || vaults[0];
  return selected?.path || '';
};

const vaultPath = path.resolve(String(args.get('vault') || await findDefaultVault() || ''));
const endpoint = String(args.get('endpoint') || 'http://127.0.0.1:27177').replace(/\/+$/, '');
const pluginData = await readJson(path.join(vaultPath, '.obsidian', 'plugins', pluginId, 'data.json'), {});
const token = String(args.get('token') || pluginData.token || '');

if (!token) {
  throw new Error('No pairing token found. Run npm run obsidian:install-bridge first or pass --token.');
}

const call = async (route, options = {}) => {
  const allowFailure = options.allowFailure === true;
  const { allowFailure: _allowFailure, ...requestOptions } = options;
  const response = await fetch(`${endpoint}${route}`, {
    ...requestOptions,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(requestOptions.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    if (allowFailure) {
      return {
        success: false,
        statusCode: response.status,
        error: data?.error || `${route} returned HTTP ${response.status}`,
      };
    }
    throw new Error(data?.error || `${route} returned HTTP ${response.status}`);
  }
  return data;
};

const status = await call('/argus/v1/status');
const suffix = Date.now().toString(36);
const documents = [
  { title: `Argus Smoke Project ${suffix}`, mode: 'project-knowledge', projectName: 'Argus Smoke', kind: 'project-summary' },
  { title: `Argus Smoke Brain ${suffix}`, mode: 'second-brain', projectName: 'Argus Smoke', kind: 'idea' },
  { title: `Argus Smoke Memory ${suffix}`, mode: 'ai-memory', projectName: 'Argus Smoke', kind: 'ai-memory' },
];

for (const doc of documents) {
  await call('/argus/v1/documents', {
    method: 'POST',
    body: JSON.stringify({
      ...doc,
      content: `# ${doc.title}\n\nSmoke test document from Argus Bridge.`,
      tags: ['argus', 'smoke'],
      argusId: `smoke:${doc.mode}:${suffix}`,
    }),
  });
}

const search = await call('/argus/v1/search', {
  method: 'POST',
  body: JSON.stringify({ query: suffix, limit: 10 }),
});
const context = await call('/argus/v1/context', {
  method: 'POST',
  body: JSON.stringify({ query: suffix, limit: 10 }),
});
const extended = {};
extended.query = await call('/argus/v1/query', {
  method: 'POST',
  allowFailure: true,
  body: JSON.stringify({
    query: suffix,
    sourceTypes: ['markdown', 'canvas', 'excalidraw'],
    limit: 10,
  }),
});
extended.patch = extended.query.success ? await call('/argus/v1/patch', {
  method: 'POST',
  allowFailure: true,
  body: JSON.stringify({
    target: { argusId: `smoke:project-knowledge:${suffix}` },
    operation: 'append-heading',
    heading: 'Smoke Patch',
    content: `Patched by Argus Bridge smoke ${suffix}.`,
    createHeading: true,
  }),
}) : { success: false, error: extended.query.error };
extended.periodic = extended.query.success ? await call('/argus/v1/periodic/append', {
  method: 'POST',
  allowFailure: true,
  body: JSON.stringify({
    content: `Argus Bridge smoke ${suffix}.`,
    heading: 'Argus',
  }),
}) : { success: false, error: extended.query.error };
extended.graph = extended.query.success ? await call('/argus/v1/graph', {
  method: 'POST',
  allowFailure: true,
  body: JSON.stringify({ projectName: 'Argus Smoke', limit: 20 }),
}) : { success: false, error: extended.query.error };
extended.active = extended.query.success ? await call('/argus/v1/active?includeContent=false&includeSelection=true', {
  allowFailure: true,
}) : { success: false, error: extended.query.error };
const extendedSuccess = Object.values(extended).every((result) => result.success !== false);

if (args.get('require-extended') === true && !extendedSuccess) {
  throw new Error(`Extended smoke failed. Reload Obsidian community plugins and retry. First error: ${Object.values(extended).find((result) => result.success === false)?.error || 'unknown'}`);
}

console.log(JSON.stringify({
  success: true,
  vaultName: status.vaultName,
  pluginVersion: status.pluginVersion,
  written: documents.length,
  searchResults: Array.isArray(search.results) ? search.results.length : 0,
  queryResults: Array.isArray(extended.query.results) ? extended.query.results.length : 0,
  contextLength: String(context.context || '').length,
  extendedSuccess,
  extendedError: extendedSuccess ? '' : Object.values(extended).find((result) => result.success === false)?.error || '',
  patchPath: extended.patch.path || '',
  periodicPath: extended.periodic.path || '',
  graphNodes: Array.isArray(extended.graph.nodes) ? extended.graph.nodes.length : 0,
  activeNote: extended.active.note?.path || '',
}, null, 2));
