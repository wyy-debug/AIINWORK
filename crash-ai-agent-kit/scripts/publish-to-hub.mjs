#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const hubUrl = (process.env.HUB_URL || process.argv[2] || 'http://localhost:4877').replace(/\/+$/, '');
const adminToken = process.env.HUB_ADMIN_TOKEN || process.env.MTL_CODE_HUB_ADMIN_TOKEN || '';
const overwrite = process.env.HUB_OVERWRITE !== 'false';
const maxFileBytes = 30 * 1024 * 1024;
const skippedDirs = new Set(['node_modules', 'target', '.git', '.cache']);
const textExtensions = new Set(['.md', '.yaml', '.yml', '.json', '.js', '.mjs', '.txt', '.toml', '.rs', '.lock']);

async function collectPackageFiles(rootDir, prefix = '') {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (skippedDirs.has(entry.name) || entry.name === '.env' || entry.name.startsWith('.env.')) continue;
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
  description: 'Call the Rust-backed MCP to collect CrashSight facts, then output only current filed issues and missing-unfiled issues by platform.',
  author: 'AIINWORK',
  version: '1.3.8',
  tags: ['crashsight', 'crash', 'redmine', 'daily', 'investigation', 'soc'],
  capabilities: [
    'Call generate_crash_ai_report as the only daily/range data tool',
    'Read CRASH_AI_DIRECT_REPORT and CRASH_AI_AGENT_CONTEXT_JSON directly from the same tool response',
    'Generate current filed issues and missing-unfiled issue lists by platform',
    'Include owner/fixer, application version, and CrashSight link for every issue item',
    'Separate rows with Redmine refs from rows without Redmine refs',
    'Avoid fact tables, summaries, recent-close sections, and omitted-row shortcuts',
  ],
  packageFiles: await collectPackageFiles(path.join(projectRoot, 'skills', 'crash-ai-daily-investigation')),
});

const agentContent = await fs.readFile(path.join(projectRoot, 'agents', 'crash-ai-agent.md'), 'utf8');
await publishItem({
  kind: 'agent-template',
  name: 'crash-ai-agent',
  title: 'CrashAIAgent',
  description: 'CrashSight investigation Agent: call the Rust-backed MCP to collect facts, then output only current filed issues and missing-unfiled issues by platform.',
  author: 'AIINWORK',
  version: '1.3.8',
  tags: ['crashsight', 'crash', 'redmine', 'daily', 'investigation', 'soc'],
  icon: 'activity',
  capabilities: [
    'Daily, date-range, or exact-time CrashSight crash investigation through one MCP call',
    'Generate current filed issues and missing-unfiled issue lists by platform',
    'Include owner/fixer, application version, and CrashSight link for every issue item',
    'Separate rows with Redmine refs from rows without Redmine refs',
    'No fact tables, summaries, recent-close sections, or omitted-row shortcuts',
    'No Python/PowerShell/Bash/Read extraction of saved tool-result files',
  ],
  dependencies: {
    skills: [
      { name: 'crash-ai-daily-investigation' },
      { name: 'crashsight-single-crash-analysis' },
    ],
    mcpServers: [
      { name: 'crash-ai-crashsight' },
      { name: 'soc-redmine' },
    ],
  },
  supportedApps: [
    { id: 'crash-ai-crashsight', label: 'MCP: crash-ai-crashsight', category: 'MCP' },
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
      id: 'redmine',
      label: 'SOC Redmine MCP',
      required: false,
      placeholder: 'Select soc-redmine MCP',
      options: [{ id: 'soc-redmine', label: 'MCP: soc-redmine' }],
    },
  ],
  content: agentContent,
});
