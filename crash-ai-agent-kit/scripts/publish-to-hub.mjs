#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const hubUrl = (process.env.HUB_URL || process.argv[2] || 'http://localhost:4877').replace(/\/+$/, '');
const adminToken = process.env.HUB_ADMIN_TOKEN || process.env.MTL_CODE_HUB_ADMIN_TOKEN || '';
const overwrite = process.env.HUB_OVERWRITE !== 'false';
const maxFileBytes = 2 * 1024 * 1024;
const textExtensions = new Set(['.md', '.yaml', '.yml', '.json', '.js', '.mjs', '.txt']);

async function collectPackageFiles(rootDir, prefix = '') {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.env') continue;
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
  return files.sort((a, b) => {
    if (a.path === 'SKILL.md') return -1;
    if (b.path === 'SKILL.md') return 1;
    return a.path.localeCompare(b.path);
  });
}

async function publishItem(payload) {
  const response = await fetch(`${hubUrl}/api/agent-repository-server/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
    },
    body: JSON.stringify({ overwrite, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.details || data.error || `Hub returned HTTP ${response.status}`);
  }
  console.log(`Published ${payload.kind}: ${payload.name}`);
}

for (const mcpName of ['crash-ai-crashsight', 'crash-ai-obsidian']) {
  const mcpRoot = path.join(projectRoot, 'mcp-servers', mcpName);
  const mcpMeta = JSON.parse(await fs.readFile(path.join(mcpRoot, 'hub.mcp.json'), 'utf8'));
  await publishItem({
    ...mcpMeta,
    packageFiles: await collectPackageFiles(mcpRoot),
  });
}

await publishItem({
  kind: 'skill',
  name: 'crash-ai-daily-investigation',
  title: 'CrashAI Daily Investigation',
  description: '按日期或精确时间段巡检 CrashSight，保留跨版本重复命中，关联 Redmine 链接、状态和负责人，并写入 Obsidian Markdown 报告。',
  author: 'AIINWORK',
  version: '1.2.4',
  tags: ['crashsight', 'crash', 'redmine', 'daily', 'investigation', 'soc'],
  capabilities: [
    'Scan CrashSight crashes by date, date range, or exact time range',
    'Paginate CrashSight results without using rows as a report limit',
    'Keep cross-version duplicate issue rows in the report',
    'Show CrashSight entries as clickable links instead of raw issueId values',
    'Use total crash/device counts and application version in detail rows',
    'Output every CrashSight item as its own detail row without grouped ranges',
    'Extract Redmine refs and render clickable Redmine links',
    'Compare version continuation and possible resolution',
    'Write Markdown investigation reports to Obsidian',
  ],
  packageFiles: await collectPackageFiles(path.join(projectRoot, 'skills', 'crash-ai-daily-investigation')),
});

const agentContent = await fs.readFile(path.join(projectRoot, 'agents', 'crash-ai-agent.md'), 'utf8');
await publishItem({
  kind: 'agent-template',
  name: 'crash-ai-agent',
  title: 'CrashAIAgent',
  description: 'CrashSight 排查 Agent：按日期或精确时间段扫描 crash，保留跨版本重复命中，关联 Redmine 链接、状态和负责人，并写入 Obsidian Markdown 报告。',
  author: 'AIINWORK',
  version: '1.2.4',
  tags: ['crashsight', 'crash', 'redmine', 'daily', 'investigation', 'soc'],
  icon: 'activity',
  capabilities: [
    'Daily, date-range, or exact-time CrashSight crash investigation',
    'Paginated CrashSight collection without rows as a report cap',
    'Cross-version duplicate issue rows are kept',
    'Clickable CrashSight and Redmine links without raw issueId display',
    'Total crash/device counts and application version detail columns',
    'Full per-crash detail rows without grouped shortcuts',
    'Redmine status and owner lookup',
    'Obsidian Markdown report generation with Argus backend port fallback',
    'Single-crash deep analysis handoff',
  ],
  dependencies: {
    skills: [
      { name: 'crash-ai-daily-investigation' },
      { name: 'crashsight-single-crash-analysis' },
    ],
    mcpServers: [
      { name: 'crash-ai-crashsight' },
      { name: 'crash-ai-obsidian' },
      { name: 'soc-redmine' },
    ],
  },
  supportedApps: [
    { id: 'crash-ai-crashsight', label: 'MCP: crash-ai-crashsight', category: 'MCP' },
    { id: 'crash-ai-obsidian', label: 'MCP: crash-ai-obsidian', category: 'MCP' },
    { id: 'soc-redmine', label: 'MCP: soc-redmine', category: 'MCP' },
  ],
  appSlots: [
    {
      id: 'crashsight',
      label: 'CrashAI CrashSight MCP',
      required: true,
      placeholder: 'Select crash-ai-crashsight MCP',
      options: [{ id: 'crash-ai-crashsight', label: 'MCP: crash-ai-crashsight' }],
    },
    {
      id: 'obsidian',
      label: 'CrashAI Obsidian MCP',
      required: true,
      placeholder: 'Select crash-ai-obsidian MCP',
      options: [{ id: 'crash-ai-obsidian', label: 'MCP: crash-ai-obsidian' }],
    },
    {
      id: 'redmine',
      label: 'SOC Redmine MCP',
      required: false,
      placeholder: 'Select soc-redmine MCP',
      options: [{ id: 'soc-redmine', label: 'MCP: soc-redmine' }],
    },
  ],
  content: agentContent,
});
